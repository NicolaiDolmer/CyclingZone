// Sentry denyUrls-moenstre + matcher — udskilt i en ren .js-fil (ingen JSX,
// ingen @sentry/react-import) saa unit-tests kan importere og koere de AEGTE
// regexes under `node --test` (sentry.jsx kan ikke parses af Node's ESM-loader
// pga. JSX). sentry.jsx importerer DENY_URLS herfra og giver det til
// Sentry.init({ denyUrls }).
//
// denyUrls dropper et event hvis "blame"-framens URL matcher et af disse
// moenstre:
//   - Extension-injektion (#1792): tredjeparts-extensions (fx TronLink →
//     CYCLINGZONE-15) kaster i deres egen kontekst paa vores sider.
//   - Vercel Live Feedback / Toolbar (#2018): preview/live-toolbaren injicerer
//     /_next-live/feedback/instrument.js og kaster tredjeparts-fejl
//     (CYCLINGZONE-18/19/1A/1B/1C: "items is undefined",
//     "NS_ERROR_NOT_INITIALIZED", "window.parent is null"). Ankeret paa stien
//     "/_next-live/feedback/instrument" er bevidst SNAEVERT — det matcher kun
//     toolbar-bundlen, ikke vores egen app-kode, saa aegte fejl stadig fanges.
export const DENY_URLS = [
  /^chrome-extension:\/\//,
  /^moz-extension:\/\//,
  /^safari-(web-)?extension:\/\//,
  /\/_next-live\/feedback\/instrument/,
];

// Reproducerer Sentrys denyUrls-semantik: et event droppes hvis MINDST ét
// moenster matcher URL'en (typisk stacktracens sidste in-app frame). Sentry
// selv anvender DENY_URLS-arrayet i init(); denne helper bruges af unit-testen.
export function isDeniedUrl(url) {
  if (!url) return false;
  return DENY_URLS.some((pattern) => pattern.test(url));
}
