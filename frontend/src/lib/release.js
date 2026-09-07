// Release-id'et (commit-sha) LÆSES fra HTML'en, aldrig fra bundlen (#4595).
//
// Hvorfor: alt hvad der bages ind i en hashet asset ændrer assetens indhold og
// dermed dens Rollup-hash. Da sha'en er unik pr. deploy, roterede entry-chunkens
// navn på HVERT deploy — også på et docs- eller backend-only commit der ikke rørte
// en eneste frontend-fil. Alle route-chunks importerer entry'en, så hele
// asset-træet roterede med, og enhver spiller med en åben fane sad på en index.html
// der pegede på filer der ikke længere fandtes (CYCLINGZONE-56).
//
// Meta-tagget injiceres i index.html af `cz-release-meta`-pluginet i vite.config.js
// (`transformIndexHtml`), som kun rører HTML — ikke hashede assets. HTML'en er
// kort-cachet, så den følger deployet; assets er `immutable` og skal derfor være
// byte-identiske når koden er uændret.
//
// Fallback-værdier: "dev" under `npm run dev` (intet build-env), "unknown" hvis
// meta-tagget mangler i et prod-build (bør ikke ske — determinisme-vagten i
// scripts/check-build-determinism.mjs fejler hvis det gør).

const META_NAME = "cz-release";

/**
 * Rå-værdien fra <meta name="cz-release">. Tom streng hvis den ikke findes
 * (inkl. i SSR/prerender og under `node --test`, hvor der ikke er et document).
 * @returns {string}
 */
export function readReleaseMeta() {
  if (typeof document === "undefined" || !document?.querySelector) return "";
  const content = document.querySelector(`meta[name="${META_NAME}"]`)?.getAttribute("content");
  return typeof content === "string" ? content.trim() : "";
}

/**
 * Release-id til klient-side brug hvor der ALTID skal være en værdi — fx den
 * per-release sessionStorage-nøgle der loop-guarder chunk-reloadet (chunkErrors.js).
 * @returns {string} sha, "dev" eller "unknown"
 */
export function getRelease() {
  return readReleaseMeta() || (import.meta.env?.DEV ? "dev" : "unknown");
}

/**
 * Release-id til Sentry. Returnerer `undefined` når sha'en ikke kendes, så Sentry
 * ikke opretter en syntetisk release ved navn "unknown" som ingen source maps
 * hører til.
 * @returns {string|undefined}
 */
export function getSentryRelease() {
  return readReleaseMeta() || undefined;
}
