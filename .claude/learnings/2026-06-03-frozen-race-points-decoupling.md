# Frosne race_points → ranglisten reagerede ikke på admin-config-ændringer

**Dato:** 2026-06-03
**Symptom:** Admin ændrede pointtal i `race_points`-editoren, men ranglisten + præmiesummerne opdaterede sig ikke — kun config-visningen (der læser `race_points` direkte) ændrede sig.

## Rod-årsag

`race_points` er en **opskrift**, ikke en live-kilde for ranglisten. Værdierne læses kun i import-øjeblikket:

- `buildRaceResultsFromPending` (raceResultsEngine.js) slår point op via `buildRacePointsLookup` og **fryser** `points_earned` + `prize_money` ind i `race_results`.
- `updateStandings` (economyEngine.js) re-summerer kun de frosne `points_earned` — den kigger aldrig på `race_points`.
- PUT `/admin/race-points/:id` opdaterer kun tabellen + `admin_log`; "↻ Standings" re-summerer de samme frosne tal.

→ En config-ændring efter import ramte aldrig eksisterende `race_results`.

## Fix

`rederiveSeasonRacePoints(seasonId)`: re-mapper hver eksisterende `race_results`-række via dens gemte `(result_type, rank)` gennem en frisk lookup, og kalder `updateStandings`. Eksponeret som `POST /admin/seasons/:id/rederive-points` + knap "↻ Point fra config". Løb med `prize_paid_at` sat springes over (bevarer konsistens med bogførte `finance_transactions`).

## Generaliserbar lære

Når en config-tabel **materialiseres** ind i frosne data-rækker (her: race_points → race_results.points_earned), skab en eksplicit **re-derivér-sti** fra config → frosne rækker. Ellers bliver config-redigering en stille no-op på eksisterende data. Samme fælde lurer i race-point-model-kaskaden (#894) og enhver fremtidig "satser/priser"-tabel der kun læses ved skrive-tidspunkt.
