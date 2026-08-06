# 2026-08-06 — entrant_key-navnekollision låste AI-trim fast i 5-min-fejlloop (#3416)

## Symptom

Tusindvis af `duplicate key value violates unique constraint "race_results_entrant_unique"`-fejl i Supabase Postgres-loggen — præcis én pr. 5. minut, døgnet rundt, siden #3022-constrainten blev appliceret 5/8 (~288/døgn). Ejeren opdagede det via dashboard-fejltælleren, ikke via alarm.

## Rodårsag — tre lag der skulle mødes

1. **Latent data-bug (28/7):** `generateFictionalRiders` KOPIEREDE det medsendte `existingFoldedNames`-set. Kerne- og hale-kaldet i `buildWeakStarterPool`-stien (tier 3/4 AI-trupper + rigtige startertrupper) delte derfor ikke navne-unikhed → 21 hold fik to ryttere med identisk navn. Bemærk: `generateAiRiderBatchWithCap` (tier 1/2-stien) var allerede fixet 1/7 for en NÆSTEN identisk bug (accepterede navne på tværs af runder) — fixet blev dengang ikke ført videre til søster-stien.
2. **Design-blind-vinkel (5/8, #3022):** `entrant_key` er en genereret kolonne med navne-fallback når FK er NULL. FK'erne er `ON DELETE SET NULL` → nøglen SKIFTER værdi midt i et slette-statement. Pre-flighten ved constraint-apply tjekkede kun rækkernes DAVÆRENDE nøgler (id-baserede, unikke) — den kunne strukturelt ikke se fremtidige kollisioner efter FK-nulstilling.
3. **Retry uden eskalationseffekt:** `aiTeamTrimHealSweep` retryede samme umulige delete hvert tick. Sentry-events fandtes (per-tick + >48t stale-alarm), men ingen kanal tvang det frem for ejeren.

## Læringer

- **En genereret nøgle må ikke kunne SKIFTE værdi på en levende række.** Fallback-kæder i generated columns skal evalueres for "hvad sker der når input-kolonnen muterer" — specielt FK'er med SET NULL. Fixet (entrant_uid-snapshot i BEFORE DELETE-triggerne) gør nøglen immutabel hen over sletning.
- **Backwards-check ved bug-fix i én kodesti: find søster-stierne.** 1/7-fixet af navne-dubletter i `generateAiRiderBatchWithCap` ramte ikke `buildWeakStarterPool`-mønstret — samme klasse, andet callsite. Grep efter mønstret (delt mutable state sendt til flere kald), ikke kun efter symptomet.
- **Set-parametre der skal bære unikhed på tværs af kald SKAL muteres, ikke kopieres** — og kontrakten skal stå i JSDoc. En kopi er en tavs unikheds-løgn.
- **Et permanent fejlende 5-min-retry-loop er en alarm-klasse, ikke en log-klasse.** 288 identiske DB-fejl/døgn stod i 1,5 døgn uden at nå ejeren. Opfølgning anbefalet: Sentry alert-rule → Discord-webhook på nye/eskalerede cron-fejl (kræver ejer-adgang til Sentry UI; Sentry MCP var unauth i sessionen).

## Verifikation af fixet

PGlite-integrationstest kører den ÆGTE migrations-SQL og reproducerer prod-scenariet (to "Minjun Han" på samme hold → delete væltede; nu lykkes den, begge historikrækker beholder distinkte, uændrede nøgler). Post-merge: migration appliceret mod prod, det fastlåste hold healet af næste sweep-tick, fejlstrømmen stoppet.

Refs #3416 (analyse + prod-evidens), #3022, #2481, #2187.
