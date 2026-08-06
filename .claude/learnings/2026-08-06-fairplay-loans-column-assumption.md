# Fair-play-sweepet antog `loans.amount` — kolonnen hedder `principal` (#3138)

**Symptom:** Første live dry-run efter merge af PR #3409 fejlede med `column loans.amount does not exist`. Det daglige cron-sweep ville være fejlet identisk (Sentry-fejl pr. tick, tom flags-tabel) i stedet for at skippe roligt.

**Rod-årsag:** `fairplayFlagsCron.js` SELECT'ede `team_id, amount, created_at` fra `loans` uden at verificere kolonnenavne mod skemaet. `loans` har `principal`/`amount_remaining`, ikke `amount`. Oveni: `amount` blev slet ikke FORBRUGT af logikken (signal 3 er ren timing: lån-dato vs. salgs-dato) — kolonnen var med "for en sikkerheds skyld" og var dermed ren risiko uden funktion.

**Hvorfor testene ikke fangede det:** Mock-supabase'en validerer ikke select-strenge mod et skema — præcis fælden fra [[feedback_test_real_endpoint_not_just_mocked]] (bidt 25/6, #1840). Memory-reglen fandtes; den blev fulgt for `fairplay_flags`-skrivesiden (probe + upsert-test) men IKKE for læsesidens 8 SELECT'er.

**Fix:** Select kun det der forbruges (`team_id, created_at`), PR #3420. Dry-run mod prod genkørt grøn: #2221-parret topscorer 1,861, 10 kandidater over tærsklen 0,35.

**Læring/forward-guard:**
1. En ny multi-tabel-læser skal dry-runnes mod ægte DB FØR merge — det READ-ONLY dry-run-script fandtes allerede og fangede fejlen på 30 sekunder; det skulle bare have været kørt før PR'en, ikke efter (var bevidst udskudt pga. parallel-sessionens no-prod-regel — men en read-only SELECT-verifikation af kolonnenavne havde været inden for reglen).
2. SELECT aldrig kolonner "til senere brug" — hver kolonne i en select-streng er en skema-antagelse der kan knække.
