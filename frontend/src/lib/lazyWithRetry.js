import { lazy } from "react";
import { getErrorText, getRecentPreloadError, isChunkLoadError } from "./chunkErrors.js";

// Wraps React.lazy så stale-chunk-fejl efter et deploy bliver recoverable.
//
// Problemet (#881): når en bruger har en gammel index.html i cachen og lazy-loader
// et route-chunk hvis hash er roteret væk af et nyt deploy, fejler import(). React.lazy
// efterlades i en tilstand hvor dens interne `_result` er undefined, og under render
// kaster den en opak "Cannot read properties of undefined (reading 'default')" /
// "e._result is undefined". Den streng matcher IKKE isChunkLoadError() → error-boundary
// klassificerer den som render_error → ingen auto-reload, dårlig UX, og Sentry-støj.
//
// Fix: fang import-fejlen i factory'en. Ét stille retry (dækker transiente netværks-blips
// / mid-deploy races); ved vedvarende fejl kast en *genkendelig* ChunkLoadError, så
// SentryBoundary + vite:preloadError-reload-stien engagerer korrekt.
//
// #4595: fejlen der kastes skal være browserens EGEN — den er den eneste der
// bærer URL'en på det chunk der fejlede. Se validateModule nedenfor og
// onPreloadError i chunkErrors.js.
function validateModule(module, options = {}) {
  if (module?.default != null) return module;

  // #4595: et tomt modul er næsten altid en preload-fejl der blev slugt —
  // Vites helper returnerer `undefined` fra sit `.catch()`, hvis nogen har
  // preventDefault'et `vite:preloadError`. Den ægte fejl (MED chunk-URL'en)
  // ligger i `event.payload` og er gemt af chunkErrors.js. Kast DEN, ikke en
  // syntetisk streng uden URL: ellers har hverken retry'et eller cache-purgen
  // noget at arbejde med, og Sentry ser vores egen tekst i stedet for
  // browserens (CYCLINGZONE-56).
  const preloadError = options.preloadError ?? getRecentPreloadError();
  if (preloadError) return Promise.reject(preloadError);

  // Ingen preload-fejl i nærheden ⇒ modulet manglede reelt sin default-export.
  // Navnet holdes som ChunkLoadError, så recovery-stien stadig engagerer.
  const error = new Error(
    "Failed to fetch dynamically imported module: resolved to an invalid module without a default export",
  );
  error.name = "ChunkLoadError";
  return Promise.reject(error);
}

// #4595: URL'en på det chunk der fejlede. Vite/browserne lægger den i selve
// fejlteksten ("Failed to fetch dynamically imported module: https://.../X-hash.js"),
// hvilket er den præcise URL vi skal rense cachen for. Findes den ikke (React.lazy's
// interne "_result"-varianter bærer ingen URL), falder vi tilbage til dokumentets
// modul-URL'er.
export function chunkUrlFromError(error) {
  const match = getErrorText(error).match(/https?:\/\/[^\s"')]+?\.m?js(?:\?[^\s"')]*)?/i);
  return match ? match[0] : null;
}

export function moduleUrlsFromDocument(doc) {
  if (!doc || typeof doc.querySelectorAll !== "function") return [];
  const nodes = doc.querySelectorAll('link[rel="modulepreload"][href], script[type="module"][src]');
  const urls = [];
  for (const node of nodes) {
    const url = node.href || node.src;
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

// Renser browser-cachen FØR vi beder om et reload (#4595).
//
// Hvorfor det er nødvendigt: en 404 fra edgen midt i et deploy bliver stemplet
// `max-age=31536000, immutable` af /assets/(.*)-header-reglen, fordi Vercels
// headers matcher på sti og ikke på status. En immutable-cachet respons
// revalideres IKKE af location.reload() — reload'en henter samme 404 fra disken
// (målt: responseStatus 404, deliveryType "cache", transferSize 0), og siden
// bliver ved med at være sort. `cache: "reload"` er den eneste vej udenom:
// den springer cachen over på vej ud OG overskriver posten med det nye svar.
//
// Best-effort: hver fetch swallower sin egen fejl, og hele operationen har en
// timeout, så en død forbindelse ikke udskyder recovery-stien.
export async function purgeStaleChunkFromCache(error, options = {}) {
  const doc = options.doc ?? (typeof document === "undefined" ? null : document);
  // Uden et dokument er der ingen browser-cache at rense — og ingen grund til at
  // lade en unit-test ramme netværket. `fetch` bindes: en løs reference kaldt
  // uden `this` giver "Illegal invocation" i Chromium.
  const fetchFn =
    options.fetchFn ?? (doc && typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const timeoutMs = options.timeoutMs ?? 3000;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  if (typeof fetchFn !== "function") return [];

  // #4595: fejlteksten først, derefter den gemte `vite:preloadError`-payload
  // (den bærer URL'en når fejlen nåede os uden den, fx React.lazy's interne
  // "_result"-varianter), og først til sidst dokumentets modul-URL'er.
  const direct =
    chunkUrlFromError(error) ??
    chunkUrlFromError(options.preloadError ?? getRecentPreloadError());
  const urls = direct ? [direct] : moduleUrlsFromDocument(doc);
  if (urls.length === 0) return [];

  const refetch = Promise.all(
    urls.map(async (url) => {
      try {
        await fetchFn(url, { cache: "reload", credentials: "same-origin" });
      } catch {
        // best-effort: en fejlende refetch må ikke blokere reload-stien. Selve
        // reload'et er stadig den bedste chance vi har.
      }
    }),
  );
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  let timer;
  try {
    await Promise.race([
      refetch,
      new Promise((resolve) => {
        timer = setTimer(resolve, timeoutMs);
      }),
    ]);
  } finally {
    // Uden dette holder timeren event-loopet i live efter racet er afgjort.
    clearTimer(timer);
  }
  return urls;
}

export async function loadWithRetry(importFn, options = {}) {
  try {
    return await validateModule(await importFn(), options);
  } catch (err) {
    if (!isChunkLoadError(err)) throw err;
    try {
      // Transient? Ét retry. Hjælper ikke hvis chunk-hash'en permanent er væk
      // (browserens module map husker en fejlet modul-load) — men det redder
      // den fejlede CSS-preload: Vites `seen`-map springer dep'en over anden
      // gang, så modulet loader. Ved vedvarende fejl kaster vi nedenfor en
      // genkendelig fejl der trigger reload (frisk index.html).
      return await validateModule(await importFn(), options);
    } catch (retryErr) {
      // #4595: rens en evt. cachet 404 ud af browser-cachen FØR fejlen bobler op
      // til reload-stien. Uden dette reloader vi ind i præcis samme cachede 404.
      try {
        await purgeStaleChunkFromCache(retryErr, options);
      } catch {
        // best-effort: recovery må aldrig maskere den oprindelige chunk-fejl.
      }
      const wrapped = new Error(
        `Failed to fetch dynamically imported module (chunk reload needed): ${retryErr?.message || retryErr}`,
      );
      wrapped.name = "ChunkLoadError";
      wrapped.cause = retryErr;
      throw wrapped;
    }
  }
}

export function lazyWithRetry(importFn) {
  return lazy(() => loadWithRetry(importFn));
}
