# Telemetri uden egen boundary tog hele appen ned (CYCLINGZONE-5B)

**Dato:** 2026-09-05 (fundet af den daglige Sentry/Railway-triage)
**Issue:** #4823 · **Sentry:** CYCLINGZONE-5B · **Rod-aarsag:** #2423 (deploy-skew)

## Symptom

4 spillere, 19 events, 4/9 06:17-13:01: fuldskaerms-fejlside i stedet for spillet.
`Error: useConsent must be used within ConsentProvider`, kastet i
`clarityIntegration.jsx:107`.

## Rod-aarsag

Sentry-eventets komponent-trae viser at `ConsentProvider` ER en forfader til
`ClarityIntegration`. En tom context kan derfor kun opstaa hvis den lazy-loadede
analytics-chunk har faaet en ANDEN modul-instans af `consent.jsx` end
provider-traeet: spillerens hovedbundle stammer fra ét deploy, den efterspurgte
chunk fra et andet. Deploy-skew — samme rod som chunk-stormen CYCLINGZONE-56.
Skew protection er slaaet fra (#2423), saa vinduet staar aabent.

## Hvad der gjorde det dyrt

To forstaerkere, uafhaengige af rod-aarsagen:

1. **Ingen isolation.** Analytics-blokken laa direkte under `SentryBoundary`, som
   omkranser hele appen. Et kast i en telemetri-komponent tog spillet ned.
2. **Selvhelingen greb ikke.** Fejlen klassificeres `render_error`, ikke chunk-fejl,
   saa #4595's chunk-reload udloeste ikke. Spilleren sad fast indtil manuelt reload.

## Fix

`AnalyticsBoundary` i `lib/sentry.jsx` — tavs boundary (`fallback={null}`) om
Clarity, WebVitals, Vercel Analytics, GA og TrafficBeacon. Fejlen rapporteres
fortsat med `frontend_error_scope: analytics`.

## Laering

**En ikke-kritisk komponent skal have sin egen error boundary — ellers arver den
den kritiske boundarys blast radius.** Lazy + client-only + valgfri (telemetri,
beacons, widgets) er praecis den klasse hvor et kast aldrig maa naa spilleren.
Gennemgang vaerd: er der andre valgfrie komponenter direkte under `SentryBoundary`?

**Sekundaert:** en dedupe-/selvhelings-mekanisme der virker paa ÉN fejlklassifikation
(chunk) daekker ikke naboklassen (render) selv naar rod-aarsagen er den samme. Naar
man klassificerer fejl for at style recovery, skal man maale om samme rod-aarsag kan
lande i en anden bakke.
