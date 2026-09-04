# Postmortem: webkit-masked-url denyUrls gjorde Sentry blind paa Firefox/Safari-iOS (#4499)

## Hvad skete der

Clarity registrerede 50 JS-fejl paa Firefox/iOS 25.-31/8 paa `/training`,
`/planning`, `/races/*`, `/riders`. Sentry havde 0 events fra samme
platform/periode. Sentry-eksport (90d, `os.name:iOS`) bekraeftede: alle
ChunkLoadError/TypeError-events fra iOS stoppede haardt efter 2026-08-09 og
kom aldrig tilbage, mens Clarity fortsatte med at se fejl paa de samme ruter.

## Rod-aarsag

`frontend/src/lib/sentryDenyUrls.js` fik (a4856b689, 9/8, #3555) tilfoejet
`/^webkit-masked-url:\/\//` til `DENY_URLS` for at filtrere en 3.-parts
extension-fejl (CYCLINGZONE-4B: "Cannot destructure property 'tabId' from
null or undefined" i en `setupExtension`-frame). Antagelsen var at
maskeringen var extension-specifik.

Den er ikke. WebKit maskerer "blame"-URL'en (`webkit-masked-url://hidden/`)
for ALLE fejl der opstaar inde i et ES-modul (`<script type="module">` +
dynamisk `import()`), uanset om koden er en 3.-parts extension eller appens
egen lazy-loadede route-chunk. Appen bruger `React.lazy`
(`frontend/src/lib/lazyWithRetry.js`) til alle route-sider, saa enhver fejl
der opstaar EFTER en side er lazy-loaded faar samme maskerede URL som
extension-stoejen — og Sentrys `denyUrls` dropper eventet FOER `beforeSend`
naar som helst en `blame`-URL matcher, uanset fejlbesked.

Fra 9/8 og frem droppede regelen derfor stille alle WebKit-fejl fra
lazy-loadede sider paa Firefox-iOS og Safari-iOS — ikke kun de 2
extension-events den var lavet til at ramme.

## Hvorfor det ikke blev opdaget foer

`denyUrls` er en Sentry-SDK-mekanik der dropper HELE eventet foer det naar
Sentry — der er intet "dropped event"-signal at se i Sentry selv. Ugentlig
Clarity/Sentry-triage (indfoert efter #4733-braandet) var det foerste sted
diskrepansen blev synlig, fordi Clarity maaler paa klientsiden uafhaengigt af
Sentrys eget filter.

## Fix

- Fjernet `/^webkit-masked-url:\/\//` fra `DENY_URLS` (URL-baseret, blankt).
- Ny `isKnownExtensionNoise(message)` i samme fil matcher paa selve
  fejlbeskeden ("Cannot destructure property 'tabId' ...") — WebKit maskerer
  URL'en, IKKE beskeden eller frame-funktionsnavnet. `tabId` er ikke et
  begreb i appens kodebase (grep-bekraeftet), saa moensteret kan ikke ramme
  egen kode.
- Kaldes fra `beforeSend` i `frontend/src/lib/sentry.jsx` i stedet for
  `denyUrls`.

## Generel laering

**Enhver `denyUrls`/URL-baseret Sentry-filtreringsregel der stammer fra et
WebKit-specifikt symptom, skal mistaenkes for at vaere for bred.** WebKit
maskerer script-URL'er i flere situationer end extension-injektion (bl.a.
ALLE ES-module-fejl) — filtrér paa fejlbeskeden/stack-frame-navnet, ikke paa
URL-skemaet, naar kilden er WebKit. Tjek altid en ny `denyUrls`/`ignoreErrors`
-regel mod Sentrys event-volumen for den ramte platform i ugerne efter den
lander (ikke kun ved indfoerelsen) — en regel der "virker" (ingen stoej) kan
ogsaa betyde den slog en hel platform blind.

## Maaling af effekt

Ingen iOS-enhed til raadighed for manuel verifikation. Maal effekten ved at
sammenligne Sentry-event-volumen fra `os.name:iOS` (saerligt
`browser.name:"Firefox iOS"`) i ugen efter denne PR er deployet mod ugen foer
— en stigning fra ~0 til et niveau der matcher Clarity's uge-tal (~50) er
beviset paa at hullet er lukket.
