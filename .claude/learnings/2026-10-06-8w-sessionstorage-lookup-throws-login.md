# Postmortem · 2026-10-06 · Login-siden væltede når sessionStorage-opslaget kastede (CYCLINGZONE-8W)

## Hvad skete der?
Sentry CYCLINGZONE-8W (3 events 5/10, Chrome på Linux med blokeret site-data): `SecurityError: Failed to read the 'sessionStorage' property from 'Window'` fra `peekSessionExpiredFlash()` i `frontend/src/lib/sessionExpiry.js`. LoginPage kalder den i en `useState`-initializer, så fejlen ramte React-renderen og SentryBoundary viste fejlsiden i stedet for login.

## Root cause
`storageOrNull()` tjekkede `typeof sessionStorage === "undefined"` og returnerede derefter `sessionStorage`. Begge opslag står UDEN FOR funktionens `try`. I browsere der blokerer site-data kaster selve property-getteren på `window`, også bag `typeof`. Den eksisterende test injicerede en storage hvis metoder kastede, og ramte derfor aldrig den implicitte default-vej.

Samme fejlklasse som #6168 (`localStorage` som default-parameter, 4/10) og #5159 (chunkErrors). Mønsteret er nu lukket tre steder.

## Fix
`storageOrNull()` slår `sessionStorage` op inde i `try/catch` og returnerer `null` ved kast. Regressionstest stubber `globalThis.sessionStorage` med en getter der kaster `DOMException("SecurityError")` og kalder peek/mark/clear uden argument; den fejler mod den gamle kode (1 fail, SecurityError) og er grøn med fixet.

## Forhindret-fremover
- `grep -rn "sessionStorage\|localStorage" frontend/src` ved hver ny storage-læsning: opslaget skal stå inde i `try`, aldrig som default-parameter eller bag `typeof` uden for `try`.
- `frontend/src/lib/sessionId.js` har stadig `window.sessionStorage` som default-parameter, men den eneste kalder (`logEvent.js`) wrapper kaldet i `try/catch`, så der er ingen crash-vej. Ryd op næste gang filen røres.

## Læring
`typeof x` beskytter mod *udefineret*, ikke mod *kastende* globale accessors. Browser-storage-API'er skal altid læses inde i `try`.
