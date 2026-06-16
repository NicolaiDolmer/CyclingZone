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
// Returnerer en cleanup-funktion (afregistrerer listeners) — primært for tests.
export function installChunkReloadHandlers({ target, release, storage, reload } = {}) {
  if (!target?.addEventListener) return () => {};

  const key = getChunkReloadKey(release);
  // Per-load-guard ud over storage-nøglen: dækker private browsing hvor
  // sessionStorage kaster, så vi aldrig reloader to gange i samme page-load.
  let reloadedThisLoad = false;

  const reloadOncePerRelease = () => {
    if (reloadedThisLoad) return;
    try {
      if (storage?.getItem(key) === "1") return;
      storage?.setItem(key, "1");
    } catch {
      // sessionStorage utilgængelig (privat browsing) — fald tilbage til per-load-guard.
    }
    reloadedThisLoad = true;
    reload?.();
  };

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

  return () => {
    target.removeEventListener("vite:preloadError", onPreloadError);
    target.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
