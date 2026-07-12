# 2026-07-12 — Sentry-hærdning: svaltede catches + genganger-bug i søster-callsite

## Hvad skete

1. **#2392:** `updateRiderValues` fejlede ved hver præmie-udbetaling med `TypeError: fetch failed`
   — én `.in("race_id", …)`-query med tusindvis af race-UUID'er sprængte URL-grænsen.
   Præcis samme bug blev fixet i `updateStandings` (P0 2/7, IN_CHUNK=120) — men søster-
   funktionen i SAMME fil blev aldrig tjekket. Fejlen levede videre i ugevis, fordi
   catch-grenen i `prizePayoutEngine` kun console.error'ede (ingen Sentry-capture).
2. **Audit (A2):** ~20 catch-steder i backend/lib + cron.js slugte fejl uden capture,
   heriblandt sæson-transition (mest forretningskritiske flow), alle heal-sweeps,
   betalings-checkout og to HELT tavse notifikations-catches (end ikke console).
3. **Gruppering (A3):** Supabase-fejl er plain objects (ikke `Error`) → `throw someError;`
   + capture gav "captureException"/"<unknown>"-titler og forkert gruppering.

## Rod-årsager

- **Symptom-fix uden backwards-check:** URL-grænse-fixet i `updateStandings` blev aldrig
  fulgt op med "hvor ELLERS bygger vi en ubegrænset `.in()`-liste?" — én grep havde fundet
  `updateRiderValues` med det samme.
- **Konvention uden guard:** "console.error er nok i best-effort-catches" var udbredt
  praksis; der var ingen regel/review-tjekliste for hvornår en catch SKAL capture.
- **Manglende central normalisering:** hvert callsite skulle selv huske `new Error(...)`
  omkring Supabase-fejl; de fleste gjorde det ikke.

## Fixes (PR fix/2389-sentry-hardening)

- `updateRiderValues`: chunket `.in()` (delt `RACE_IDS_IN_CHUNK`), delt retry-`fetchAllRows`,
  `withSupabaseRetry` på PATCH-loopet, capture i payout-catchen.
- `toSentryError()` i lib/sentry.js: alle captures normaliseres centralt (besked + code
  bevares, syntetisk stack strippes så Sentry grupperer på besked).
- Captures tilføjet på alle "BØR captures"-fund; eskalering (3t) i stage-scheduler-dedupen;
  Sentry-monitors på alle periodiske cron-jobs; Railway start-command kører nu `--import
  instrument.mjs` (Express-instrumentering virkede aldrig i prod).

## Læring / forward-guard

- **Ved enhver `.in(col, ids)`:** spørg altid "kan ids-listen vokse med data?" → chunk fra
  start (brug `dbChunk.selectInChunks` eller RACE_IDS_IN_CHUNK-mønstret).
- **Ved bugfix i én funktion:** grep for søster-forekomster af samme mønster i samme
  commit (backwards-check-reglen — den ramte os her for anden gang).
- **Catch-regel:** en catch der kun logger er KUN ok når fejlen er ren best-effort-kosmetik
  (Discord-embed, activity-feed). Alt der kan skjule databrud, mistet spil-konsekvens eller
  penge SKAL capture. Tvivls-sites + lint-guard-idé er trackes i opfølgnings-issue.
