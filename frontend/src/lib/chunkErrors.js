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
// Reload'en er UDSKUDT (delayMs), ikke synkron: når browseren navigerer til et nyt
// dokument, aborterer den det gamle dokuments igangværende chunk-loads, og WebKit
// melder aborten som præcis samme fejl som en ægte stale chunk ("Importing a module
// script failed"). Et synkront reload i det døende dokument kaprer så den ægte
// navigation (bruger-navigation væk fra appen; deterministisk reproduceret som
// mobile-webkit e2e-flake: "Navigation to /dashboard is interrupted by another
// navigation to /dashboard", 5/25 lokalt på Windows). Deferral betyder at det
// gamle dokument dør — og timeren med det — før reload'en kan fyre; pagehide-
// flaget dækker vinduet mellem commit og destruction. Ved en ÆGTE stale chunk
// navigerer ingen andre, så reload'en fyrer stadig, blot delayMs senere.
// (Bevidst pagehide og IKKE beforeunload: en beforeunload-listener kan gøre
// siden ineligible til bfcache.)
//
// Returnerer en cleanup-funktion (afregistrerer listeners) — primært for tests.
export function installChunkReloadHandlers({ target, release, storage, reload, delayMs = 250, schedule } = {}) {
  if (!target?.addEventListener) return () => {};

  const key = getChunkReloadKey(release);
  const scheduleFn = schedule ?? ((fn, ms) => setTimeout(fn, ms));
  // Per-load-guard ud over storage-nøglen: dækker private browsing hvor
  // sessionStorage kaster, så vi aldrig reloader to gange i samme page-load.
  let reloadedThisLoad = false;
  let unloading = false;
  let pending = false;

  const fireReload = () => {
    pending = false;
    if (reloadedThisLoad || unloading) return;
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
    scheduleFn(fireReload, delayMs);
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
