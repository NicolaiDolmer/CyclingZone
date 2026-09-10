// Moenstre der KUN kan stamme fra en fejlet modul-/chunk-load. Sikre nok til
// beslutninger hvor en falsk positiv koster noget — se isUnambiguousChunkLoadError.
const UNAMBIGUOUS_CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk \d+ failed/i,
  /chunkloaderror/i,
  /module script.*mime type/i,
  /expected a javascript module script/i,
  // #4595: Vites preload-helper kaster denne naar en <link rel="stylesheet">
  // for et async-chunk ikke kan hentes ("Unable to preload CSS for <url>").
  // Den kan kun komme derfra. Uden moensteret ville en fejlet CSS-preload
  // blive klassificeret som render_error og give fuldskaerms-fallbacken, i
  // stedet for det ene stille retry der faktisk redder den (Vites `seen`-map
  // springer dep'en over anden gang, saa modulet loader).
  /unable to preload css for/i,
];

// React.lazy's INTERNE fejl efter en fejlet dynamic import (#881/#906). De er den
// dominerende signatur i praksis, men de samme strenge kan komme fra almindelig
// kode der laeser .default paa undefined. De hoerer derfor kun til i recovery,
// hvor prisen for en falsk positiv er ét unoedigt reload — ikke i klassifikation,
// hvor prisen er et aegte crash begravet i chunk-bunken (#4545).
//   Firefox/Safari: "e._result is undefined" / "evaluating 'e._result.default'".
//   V8/Chromium (Chrome/Edge): "Cannot read properties of undefined (reading 'default')"
//   — den dominerende, U-genkendte signatur i Sentry (#906, CYCLINGZONE-D).
const AMBIGUOUS_CHUNK_ERROR_PATTERNS = [
  /_result is undefined/i,
  /_result\.default/i,
  /cannot read properties of undefined \(reading 'default'\)/i,
];

const CHUNK_ERROR_PATTERNS = [
  ...UNAMBIGUOUS_CHUNK_ERROR_PATTERNS,
  ...AMBIGUOUS_CHUNK_ERROR_PATTERNS,
];

export function getErrorText(error) {
  if (!error) return "";
  const parts = [
    error.name,
    error.message,
    error.stack,
    error.cause?.message,
  ].filter(Boolean);
  return parts.join("\n");
}

export function isChunkLoadError(error) {
  const text = getErrorText(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

// Snaevrere end isChunkLoadError: kun moenstre der ikke kan vaere andet end en
// fejlet modul-load. Brug denne naar en falsk positiv er dyr — fx til at gruppere
// og daempe events i Sentry, hvor et fejlklassificeret crash forsvinder ned i en
// arkiveret chunk-gruppe i stedet for at blive set (#4545).
export function isUnambiguousChunkLoadError(error) {
  const text = getErrorText(error);
  return UNAMBIGUOUS_CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

// #4595: den ÆGTE fejl fra Vites preload-helper.
//
// `handlePreloadError` (vite 8.2.2, `node_modules/vite/dist/node/chunks/node.js`)
// lægger den i `event.payload` og kaster den KUN hvis ingen har preventDefault'et:
//
//   function handlePreloadError(err) {
//     const e = new Event("vite:preloadError", { cancelable: true });
//     e.payload = err;
//     window.dispatchEvent(e);
//     if (!e.defaultPrevented) throw err;          // <- kaster kun uden preventDefault
//   }
//   return promise.then((res) => {
//     ...
//     return baseModule().catch(handlePreloadError);  // <- slugt fejl => resolver undefined
//   });
//
// `event.payload` er den ENESTE kilde til URL'en på det chunk der faktisk
// fejlede. Vi gemmer den, så cache-purgen og loaderen har den også når fejlen
// når os ad en anden vej end en rejection.
let recentPreloadError = null;

export function recordPreloadError(error, now = Date.now()) {
  recentPreloadError = error ? { error, at: now } : null;
  return recentPreloadError?.error ?? null;
}

// Kun FRISKE payloads bruges. Vite dispatcher eventet synkront lige før
// import()-promisen afgøres, så den rigtige payload er mikrosekunder gammel;
// et gammelt record må omvendt aldrig maskere en senere, ubeslægtet fejl (fx et
// modul der reelt mangler default-export).
export function getRecentPreloadError({ maxAgeMs = 2000, now = Date.now() } = {}) {
  if (!recentPreloadError) return null;
  return now - recentPreloadError.at > maxAgeMs ? null : recentPreloadError.error;
}

export function getChunkReloadKey(release = "unknown") {
  return `cz:chunk-reload-attempted:${release || "unknown"}`;
}

export function shouldAttemptChunkReload({ error, release, storage } = {}) {
  if (!isChunkLoadError(error) || !storage) return false;
  const key = getChunkReloadKey(release);
  try {
    if (storage.getItem(key) === "1") return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

// Kausal navigations-guard (#3602) — delt af BEGGE recovery-stier (denne fil og
// error-boundary'en i lib/sentry.jsx).
//
// Problemet: når browseren begynder at navigere væk fra dokumentet, aborterer
// den dokumentets igangværende chunk-loads — og WebKit melder den abort med
// PRÆCIS samme fejlstreng som en ægte stale chunk ("Importing a module script
// failed"). Begge recovery-stier troede derfor på en stale chunk og reloadede et
// dokument der allerede var på vej ud. Reload'en kaprede den ægte navigation:
// "Navigation to /academy is interrupted by another navigation to /dashboard".
//
// Guarden var før TEMPORAL: et fast 250 ms-vindue plus et pagehide-flag, altså et
// gæt på hvor lang tid en document-commit tager. Målt med kunstigt forsinket
// commit: abort ved t+0, boundary-reload t+39 ms, deferred reload t+250 ms,
// commit (pagehide) først t+1463 ms. På en hurtig maskine holder gættet; på
// CI-runneren gør det ikke.
//
// Guarden er nu KAUSAL. En navigation-in-flight afviser også NYE fetches — målt i
// WebKit: `fetch(location.href)` afvises med TypeError "Load failed" efter ~16 ms,
// mens den i et dokument der bliver liggende svarer 200. Vi spørger derfor
// dokumentet direkte "kan du stadig hente noget?" lige før vi reloader.
//
// Fail-closed: kan vi ikke bekræfte det (afvist, timeout, ingen fetch), reloader
// vi IKKE. Prisen ved et forkert reload er en kapret navigation — eller en
// browser-fejlside hvis netværket er nede. Prisen ved et sprunget reload er den
// brandede fallback med sin manuelle "Genindlæs siden"-knap. Den er billigere.
export async function documentIsStillLoadable({ fetchFn, url, timeoutMs = 3000, timers } = {}) {
  if (typeof fetchFn !== "function" || !url) return false;
  const setTimer = timers?.set ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = timers?.clear ?? ((handle) => clearTimeout(handle));
  let handle;
  try {
    return await Promise.race([
      // no-store: tvinger et rigtigt netværkskald. En cache-hit ville kunne
      // resolve selv under en igangværende navigation → falsk "i live".
      //
      // ENHVER resolved response tæller — også 404/502. Spørgsmålet vi stiller
      // er "kan dette dokument stadig hente noget?", ikke "er serveren rask".
      // Et svar, uanset status, beviser at ingen navigation har revet
      // request-stien væk, og det er præcis det reload'en skal vide. At gate på
      // res.ok ville blande et sundhedstjek ind og kunne undertrykke legitim
      // recovery på hosts hvor netop denne URL svarer anderledes end chunks.
      Promise.resolve()
        .then(() => fetchFn(url, { cache: "no-store" }))
        .then(() => true, () => false),
      new Promise((resolve) => { handle = setTimer(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    clearTimer(handle);
  }
}

// Globalt net for stale-chunk-fejl der aldrig når React's error-boundary (#906).
// To kilder:
//   1. `vite:preloadError` — Vite's helper dispatcher dette når en modulepreload
//      eller dynamic-import fejler. Vi gemmer `event.payload` (den ægte fejl med
//      chunk-URL'en) og lader Vite kaste videre — se onPreloadError nedenfor.
//   2. `unhandledrejection` — dynamic imports der IKKE ligger bag React.lazy
//      (fx import("@e965/xlsx") i RacesPage, import("@microsoft/clarity")) kan
//      reject uden for render-stien → de når aldrig boundary'en.
//
// Begge deler den samme per-release sessionStorage-nøgle som error-boundary'en,
// så der sker MAKS ét reload pr. release på tværs af alle tre stier (loop-guard).
//
// Reload'en er UDSKUDT (delayMs) og navigations-guarded, ikke synkron. Tre lag,
// i den rækkefølge de fanger:
//   1. delayMs — lader et hurtigt teardown nå at fyre pagehide først.
//   2. pagehide-flaget — dækker vinduet mellem commit og destruction.
//      (Bevidst pagehide og IKKE beforeunload: en beforeunload-listener kan gøre
//      siden ineligible til bfcache.)
//   3. documentIsStillLoadable() — den KAUSALE guard (#3602), som dækker det
//      vindue lag 1+2 ikke kunne: navigationen er startet, men endnu ikke
//      committet, så pagehide er ikke fyret og delayMs er udløbet. Det var
//      præcis det vindue der gjorde mobile-webkit rød i CI.
// Ved en ÆGTE stale chunk navigerer ingen andre: canary'en svarer 200 og
// reload'en fyrer, blot delayMs + én round-trip senere.
//
// Returnerer en cleanup-funktion (afregistrerer listeners) — primært for tests.
export function installChunkReloadHandlers({ target, release, storage, reload, delayMs = 250, schedule, fetchFn, url, probeTimeoutMs } = {}) {
  if (!target?.addEventListener) return () => {};

  const key = getChunkReloadKey(release);
  const scheduleFn = schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const probeFetch = fetchFn ?? (typeof target.fetch === "function" ? target.fetch.bind(target) : undefined);
  const probeUrl = () => url ?? target.location?.href;
  // Per-load-guard ud over storage-nøglen: dækker private browsing hvor
  // sessionStorage kaster, så vi aldrig reloader to gange i samme page-load.
  let reloadedThisLoad = false;
  let unloading = false;
  let pending = false;

  const fireReload = async () => {
    pending = false;
    if (reloadedThisLoad || unloading) return;
    // Kausal guard FØR vi brænder loop-guard-nøglen: en afbrudt navigation må
    // ikke stjæle det ene reload en senere, ægte stale chunk har brug for.
    const alive = await documentIsStillLoadable({
      fetchFn: probeFetch,
      url: probeUrl(),
      ...(probeTimeoutMs === undefined ? {} : { timeoutMs: probeTimeoutMs }),
    });
    if (!alive || reloadedThisLoad || unloading) return;
    try {
      if (storage?.getItem(key) === "1") return;
      storage?.setItem(key, "1");
    } catch {
      // sessionStorage utilgængelig (privat browsing) — fald tilbage til per-load-guard.
    }
    reloadedThisLoad = true;
    reload?.();
  };

  const reloadOncePerRelease = () => {
    if (reloadedThisLoad || unloading || pending) return;
    pending = true;
    // fireReload er async (canary'en) → swallow, så en fejl i recovery-stien
    // ikke bliver en unhandledrejection som vores egen handler så ser igen.
    scheduleFn(() => fireReload().catch(() => {}), delayMs);
  };

  const onPagehide = () => { unloading = true; };
  // bfcache-restore: siden lever videre efter pagehide → gør recovery mulig igen.
  const onPageshow = () => { unloading = false; };

  // #4595 — rod-årsagen til CYCLINGZONE-56 (954 events / 50 spillere på 7 dage).
  //
  // Her stod `event.preventDefault()`. Konsekvensen var IKKE at "vi styrer
  // recovery" — den var at Vites `handlePreloadError` ikke kastede, at
  // `baseModule().catch(handlePreloadError)` dermed returnerede `undefined`, og
  // at hele `__vitePreload(...)`-promisen RESOLVEDE med `undefined`. Så nåede
  // `lazyWithRetry.validateModule()` frem til et tomt modul og mintede sin egen
  // syntetiske fejl ("resolved to an invalid module without a default export")
  // — uden URL. Retry'et ramte samme sti, og cache-purgen havde intet chunk at
  // rense, fordi den ægte fejl (med URL) blev smidt væk sammen med kastet.
  //
  // Derfor: gem payload'en og lad Vite kaste. Så bobler den rigtige fejl op ad
  // den sti den hører til (rejection → loadWithRetry → purge → boundary /
  // unhandledrejection-handleren nedenfor). Recovery-reloadet er uændret: det
  // kaldes her uanset, præcis som før.
  const onPreloadError = (event) => {
    recordPreloadError(event?.payload);
    reloadOncePerRelease();
  };

  const onUnhandledRejection = (event) => {
    // KUN chunk-fejl — ellers ville vi skjule ægte uhåndterede rejections.
    if (!isChunkLoadError(event?.reason)) return;
    event?.preventDefault?.();
    reloadOncePerRelease();
  };

  target.addEventListener("vite:preloadError", onPreloadError);
  target.addEventListener("unhandledrejection", onUnhandledRejection);
  target.addEventListener("pagehide", onPagehide);
  target.addEventListener("pageshow", onPageshow);

  return () => {
    target.removeEventListener("vite:preloadError", onPreloadError);
    target.removeEventListener("unhandledrejection", onUnhandledRejection);
    target.removeEventListener("pagehide", onPagehide);
    target.removeEventListener("pageshow", onPageshow);
  };
}
