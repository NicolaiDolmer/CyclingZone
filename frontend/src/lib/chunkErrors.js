const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk \d+ failed/i,
  /chunkloaderror/i,
  /module script.*mime type/i,
  /expected a javascript module script/i,
  // React.lazy intern-state efter en fejlet dynamic import (#881), Firefox/Safari:
  // "e._result is undefined" / "undefined is not an object (evaluating 'e._result.default')".
  /_result is undefined/i,
  /_result\.default/i,
  // Samme React.lazy-fejl i V8/Chromium (Chrome/Edge): "Cannot read properties of
  // undefined (reading 'default')". Var den dominerende, U-genkendte signatur i
  // Sentry (#906, CYCLINGZONE-D) → blev fejlklassificeret som render_error-støj.
  /cannot read properties of undefined \(reading 'default'\)/i,
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
//      eller dynamic-import fejler. preventDefault() stopper at Vite selv kaster,
//      så VI styrer recovery (ét kontrolleret reload til frisk index.html).
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

  const onPreloadError = (event) => {
    event?.preventDefault?.();
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
