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
//
// #4499 (rettet — se isKnownExtensionNoise nedenfor): "webkit-masked-url://"
// var IKKE i dette array laengere. CYCLINGZONE-4B (7-8/8) antog fejlagtigt at
// maskeringen var extension-specifik, men WebKit maskerer "blame"-URL'en for
// ALLE ES-module-script-fejl (dynamisk `import()`, som vores lazy-loadede
// routes bruger) — ikke kun tredjeparts-extensions. Et denyUrls-match paa
// selve skemaet er derfor blindt for FORSKELLEN mellem "en extension kastede"
// og "vores egen RaceDetailPage-chunk kastede": begge faar praecis samme
// culprit-URL, "webkit-masked-url://hidden/". Fra denne regel landede
// (a4856b689, 9/8) og frem droppede den derfor STILLE alle WebKit-fejl fra
// lazy-loadede sider — Sentry saa 0 events fra Firefox/iOS 25.-31/8, mens
// Clarity registrerede 50 JS-fejl samme periode/platform paa netop de
// lazy-loadede ruter (/training, /planning, /races/*, /riders). Se postmortem
// .claude/learnings/2026-09-03-webkit-masked-url-denylist-blind-spot.md.
// #5694 (CYCLINGZONE-68, triage 24/9): Google Translate-proxyen serverer siden
// under et andet origin (fx cyclingzone-org.translate.goog) og omskriver URL'en
// med _x_tr_sl/_x_tr_tl-parametre. Vores egen history.replaceState-kode kaster
// SecurityError der, fordi mismatchet mellem document.location og den URL vi
// forsøger at skrive udløser browserens same-origin-guard — proxyen er ikke
// vores app, og fejlen kan ikke rettes i vores kode (vi kontrollerer ikke
// proxyens origin). Matcher paa BLAME-URL'en (samme mekanisme som _next-live-
// moensteret ovenfor): alt paa .translate.goog-domaenet er proxy-serveret kode.
export const DENY_URLS = [
  /^chrome-extension:\/\//,
  /^moz-extension:\/\//,
  /^safari-(web-)?extension:\/\//,
  /\/_next-live\/feedback\/instrument/,
  /\.translate\.goog\//,
];

// #5694 (CYCLINGZONE-68): supplerer denyUrls (som kun ser blame-frame-URL'en,
// og derfor kan misse hvis stacktracen mangler frames eller peger andetsteds).
// beforeSend tjekker i stedet det AKTUELLE dokuments hostname direkte — hele
// siden kører under proxyens origin, saa ENHVER fejl derfra er proxy-stoej.
export function isProxiedOrigin(hostname) {
  if (!hostname) return false;
  return /\.translate\.goog$/i.test(hostname);
}

// Reproducerer Sentrys denyUrls-semantik: et event droppes hvis MINDST ét
// moenster matcher URL'en (typisk stacktracens sidste in-app frame). Sentry
// selv anvender DENY_URLS-arrayet i init(); denne helper bruges af unit-testen.
export function isDeniedUrl(url) {
  if (!url) return false;
  return DENY_URLS.some((pattern) => pattern.test(url));
}

// #4499: CYCLINGZONE-4B-stoejen ("Cannot destructure property 'tabId' from
// null or undefined" i en frame ved navn setupExtension — en 3.-parts
// browser-extension, IKKE vores kode) filtreres nu paa FEJLBESKEDEN, ikke
// paa den maskerede URL. WebKit maskerer URL'en, men IKKE selve beskeden
// eller frame-funktionsnavnet, saa det er det eneste sikre anker der ikke
// ogsaa rammer aegte app-fejl. "tabId" er ikke et begreb i vores kodebase
// (grep bekraeftet #4499) — moensteret kan derfor ikke ramme egen kode.
export const EXTENSION_NOISE_MESSAGE_PATTERNS = [
  /Cannot destructure property 'tabId' from null or undefined/,
];

export function isKnownExtensionNoise(message) {
  if (!message) return false;
  return EXTENSION_NOISE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}
