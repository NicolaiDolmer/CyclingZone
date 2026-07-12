# Aggregering i app-laget ved at streame N rækker = latency-fælde (#2391)

**Dato:** 2026-07-12
**Symptom:** Stage-scheduler-tick tog >35 min → overlap-guard (#2090) sprang næste tick over → voksende backlog → etaper afviklet timevis for sent (Sentry CYCLINGZONE-24 stall-watchdog).

## Rod-årsag

`updateStandings` (backend/lib/economyEngine.js) var en fuld sæson-re-derivation: den hentede **HELE sæsonens `race_results`** over PostgREST — chunket på race-id + pagineret (fetchAllRows, 1000/side) + en nested `rider:rider_id(team_id)`-join — og aggregerede i JS. Den kaldes efter **hver etape af hvert løb**.

Issue'et estimerede ~2,2k rækker. Prod havde faktisk **166.299** (den gamle estimat var fra sæson-start). 166k rækker = ~166 paginerede round-trips + join → **40-120 s pr. kald**. ~20 etaper/tick × ~60 s = 20+ min bare på standings.

## Fix

Flyt aggregeringen til databasen: `recompute_season_standings`-RPC gør hele recomputen til ét set-baseret Postgres-statement. **~190 ms** (EXPLAIN ANALYZE mod prod, hele sæsonen) vs 40-120 s. `updateStandings` kalder RPC'en med graceful Node-fallback (PGRST202 = funktion mangler → Node-sti), så koden er adfærds-identisk indtil migrationen anvendes.

## Læringer

1. **Streaming af et helt datasæt til app-laget for at aggregere skalerer med datasættet, ikke med det du beder om.** Når et "opdatér X"-kald re-læser hele historikken, er latency en funktion af sæsonlængde — den vokser stille indtil den vælter en cron. Aggregér i DB'en (RPC/view), ikke i Node.
2. **Verificér datamængden mod prod før du stoler på et issue-estimat.** 2,2k vs 166k ændrede hele diagnosen. `select count(*)` er billigt.
3. **Bevis ækvivalens read-only før ship.** Kørte den nye aggregering mod prod og diffede mod den nuværende `season_standings`: 0 diff på points/wins/races (368 hold); alle 90 rank-forskelle var lige-point-ties (0 ægte fejl). Rulled-back transaktion validerede upsert-syntaks uden at mutere prod.
4. **Debounce var det oplagte (issue-forslag A) men forkert:** board-weekend-finalization læser `season_standings` INDE i hver final-etape → forældede standings = forkert bestyrelses-tilfredshed persisteret. Den hurtige-men-friske RPC løser begge. Tjek altid hvem der læser data mellem "udskyd" og "kør".
5. **Set-baseret RPC lukkede en bonus-bug:** læsning+upsert i ÉN transaktion fjerner #2389's FK-vindue (hold slettet af AI-trim midt i en lang Node-recompute kunne vælte upsert'et).

**Cluster:** [2026-07-02-updatestandings-url-limit-p0.md](2026-07-02-updatestandings-url-limit-p0.md) (samme funktion, tidligere skalerings-P0 — `.in()` med alle race-ids sprængte URL-længden). Samme funktion har nu ramt skalerings-loftet to gange; RPC-versionen fjerner hele klassen.
