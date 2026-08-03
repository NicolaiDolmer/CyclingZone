# Postmortem · 2026-08-03 · Global Rank viste forkert rækkefølge + AI-hold i ranglisten

## Hvad skete der?
To koblede issues: (1) #2792 — AI-fyld-hold optog pladser i Global Rank (kun badge-markeret, ikke ekskluderet). (2) #3193 — Discord-bug (@thelamba 31/7): Global rank-rækkefølgen matchede ikke de viste tal for et hold (Wander Riders), skulle ligge nr. 4 men gjorde ikke.

## Root cause
1. #2792: `database/2026-07-17-global-rank.sql`s `base`-CTE filtrerede `is_test_account`/`is_frozen`/`is_bank` men manglede `is_ai = false` — matview'et brugte kun en DELVIS udgave af den kanoniske menneske-hold-diskriminator (`backend/lib/humanTeamFilter.js`, #2852).
2. #3193: `global_rank_mv`'s egen `RANK()`-logik var bevist selv-konsistent (rang matcher altid `global_points` inden for samme snapshot, verificeret mod prod execute_sql 3/8 — ingen sorterings-/tiebreak-bug). Den egentlige rod-årsag var refresh-KADENCE: `/standings` læser `season_standings` LIVE, mens Global Rank læser `global_rank_mv` (periodisk matview-snapshot). I `backend/lib/raceRunner.js` blev `season_standings` opdateret tidligt (via `applyRaceResults`/`updateStandings`), men `refreshRankingMatviewsSafe()` blev først kaldt HELT SIDST i finalization — efter `processBoardWeekend` + en ekstern Discord-webhook-notifikation + in-app-notifikation. I det vindue kunne to sider vise forskellige tal for samme hold.

## Fix
- Migration `database/2026-08-03-2792-3193-global-rank-humans-only.sql`: DROP+CREATE `global_rank_mv` med `AND t.is_ai = false` tilføjet til base-CTE'ens WHERE + friske uge-/sæsonstart-snapshots (undgår falsk engangshop i bevægelsespilene).
- `backend/lib/raceRunner.js`: `refreshRankingMatviewsSafe()`-kaldet flyttet til LIGE EFTER `applyRaceResults`/`updateStandings` i begge finalization-stier (fuld-løb + stage-by-stage), i stedet for efter board-weekend/Discord/in-app-notify. Ny regressionstest (`raceRunner.test.js`) beviser rækkefølgen med et `supabase.rpc`-kald-spy.
- `GlobalRankPage.jsx` + `globalRank.json` (en/da): AI-badge + `aiBadge`-nøgle fjernet (dødt efter matview-filtreringen).

## Forhindret-fremover
Ny test `simulateRace: refresher rangliste-matviews FØR notifyDiscord/notifyInApp (#3193)` i `backend/lib/raceRunner.test.js` asserter den eksakte call-rækkefølge — en fremtidig regression (nogen flytter refresh-kaldet tilbage efter notify) fanges direkte.

## Læring
"Samme data, to kilder, forskellig friskhed" er et generelt mønster i denne kodebase (live tabel vs. periodisk matview) — når man debugger et "tallene stemmer ikke"-bug, spørg altid FØRST om de to sider faktisk læser fra samme kilde med samme friskhed, før man leder efter en sorterings-/beregningsfejl. Placeringen af et best-effort refresh-/cache-invalideringskald i en lang async-kæde (notifikationer, webhooks) betyder reelt "denne cache er stale indtil ALLE de foregående trin er færdige" — refresh bør ligge lige efter den skrivning den skal spejle, ikke efter sideeffekter der intet har med cachen at gøre.
