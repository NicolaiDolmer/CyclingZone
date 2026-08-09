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
//   - WebKit-maskeret extension-injektion (CYCLINGZONE-4B): Safari/iOS
//     eksponerer IKKE en extensions rigtige URL til siden — den erstattes af
//     "webkit-masked-url://hidden/". Derfor slap iOS-extensions forbi
//     safari-extension:-moensteret ovenfor (prod 7-8/8: "Cannot destructure
//     property 'tabId' from null or undefined" i en frame ved navn
//     setupExtension — tredjeparts-kode, ikke vores). Moensteret er sikkert
//     bredt: WebKit maskerer kun scripts hvis URL ikke maa eksponeres til
//     siden (extensions/user scripts). Vores egen bundle serveres fra
//     cyclingzone.org og maskeres aldrig, og appen indlaeser ingen scripts fra
//     blob:-URL'er (de eneste createObjectURL-kald er CSV-downloads), saa en
//     aegte app-fejl kan ikke faa en maskeret blame-frame.
export const DENY_URLS = [
  /^chrome-extension:\/\//,
  /^moz-extension:\/\//,
  /^safari-(web-)?extension:\/\//,
  /^webkit-masked-url:\/\//,
  /\/_next-live\/feedback\/instrument/,
];

// Reproducerer Sentrys denyUrls-semantik: et event droppes hvis MINDST ét
// moenster matcher URL'en (typisk stacktracens sidste in-app frame). Sentry
// selv anvender DENY_URLS-arrayet i init(); denne helper bruges af unit-testen.
export function isDeniedUrl(url) {
  if (!url) return false;
  return DENY_URLS.some((pattern) => pattern.test(url));
}
