// SSOT for de offentlige ruter der prerendres ved build (#5494).
//
// Listen skal matche de cyclingzone.org-URL'er i frontend/public/sitemap.xml
// der IKKE rewrites til marketing-deploymentet (/how-it-works, /da/... hører
// til marketing/app og har deres eget sitemap). Forward-guard:
// frontend/tests/e2e/seo-public-routes.spec.js sammenholder de to.
//
// Forbrugere:
//   • frontend/scripts/prerender.mjs        — renderer og skriver filerne
//   • scripts/compare-build-manifests.mjs   — HTML må variere mellem builds
//   • frontend/tests/e2e/seo-public-routes.spec.js — rå-HTML-guarden
//
// `lang` er det sprog ruten prerendres på: EN-first, undtagen de to danske
// juridiske ruter som ER danske sider (egne URL'er, hreflang-parret med deres
// engelske søskende).
export const ORIGIN = "https://cyclingzone.org";

const PRIVACY_ALTERNATES = { en: "/privacy-policy", da: "/privatlivspolitik" };
const TERMS_ALTERNATES = { en: "/terms", da: "/handelsbetingelser" };

export const PRERENDER_ROUTES = [
  { path: "/", lang: "en" },
  { path: "/login", lang: "en" },
  { path: "/founder-supporter", lang: "en" },
  { path: "/privacy-policy", lang: "en", alternates: PRIVACY_ALTERNATES },
  { path: "/privatlivspolitik", lang: "da", alternates: PRIVACY_ALTERNATES },
  { path: "/terms", lang: "en", alternates: TERMS_ALTERNATES },
  { path: "/handelsbetingelser", lang: "da", alternates: TERMS_ALTERNATES },
  { path: "/help", lang: "en" },
  { path: "/rules", lang: "en" },
  { path: "/roadmap", lang: "en" },
  { path: "/patch-notes", lang: "en" },
];

/**
 * Filen ruten skrives til, relativt til dist/.
 *
 * "/" bliver dist/index.html fordi Vercel serverer en statisk fil FØR rewrites
 * og "/" derfor altid rammer den. De øvrige bliver dist/<rute>/index.html —
 * samme filsystem-match slår rewriten til /app.html (samme mekanik som
 * sitemap.xml).
 */
export function outputFileFor(routePath) {
  return routePath === "/" ? "index.html" : `${routePath.replace(/^\//, "")}/index.html`;
}

/** Alle dist-relative HTML-filer prerenderen producerer. */
export const PRERENDERED_HTML_FILES = PRERENDER_ROUTES.map((route) => outputFileFor(route.path));
