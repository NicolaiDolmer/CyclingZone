# Postmortem · 2026-10-04 · Hvid side ved boot når localStorage er blokeret (#6168)

## Hvad skete der?
Sentry CYCLINGZONE-8V: en besøgende på `/login` med blokeret site-data fik en uhåndteret `SecurityError: Failed to read the 'localStorage' property from 'Window'`. Fejlen kom fra `captureFirstTouch()` på boot i `main.jsx`, så modulet stoppede og React mountede aldrig: hvid side.

## Root cause
`captureFirstTouch({ storage = window.localStorage } = {})` havde `try/catch` om selve storage-kaldene, men default-parameteren evalueres FØR funktionskroppen, altså uden for `try`. I browsere med blokeret site-data kaster selve property-opslaget `window.localStorage`, ikke kun `getItem`/`setItem`. Samme mønster i `getAttribution`, `getAttributionForBackend` (signup) og `getAnonymousId`.

## Fix
`frontend/src/lib/attribution.js` + `frontend/src/lib/anonymousId.js`: storage resolves dovent (`storage ?? window.localStorage`) inde i hver `try`. Regressionstests stubber et `window`, hvis `localStorage`-getter kaster; de fejler uden fixet.

## Forhindret-fremover
Testene dækker nu "opslaget kaster", ikke kun "getItem kaster" (den gamle test injicerede en storage hvis metoder kastede, og ramte derfor aldrig default-parameteren).

## Læring
`try/catch` i en funktionskrop beskytter IKKE default-parametre. Browser-API'er der kan kaste ved selve opslaget (`localStorage`, `sessionStorage`, `indexedDB`, `document.cookie` i sandboxede iframes) må aldrig stå som default-værdi; slå dem op inde i `try`. Samme klasse som #5159 (sessionStorage), som kun lukkede den ene halvdel.
