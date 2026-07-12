# AI-trim heal-sweep kolliderede med præmie-udbetaling og standings-recalc

**Dato:** 2026-07-12 · **Issue:** #2389 · **PR:** #2390 · **Sentry:** CYCLINGZONE-26/2E/2F

## Symptom

Auto-prize cron-monitoren blev ved med at gå rød ("regressed", 38 events over 8 dage),
og to nye fejl dukkede op med få minutters mellemrum: `Team <uuid> not found` (P0002)
i payout-sweepen og en `season_standings_team_id_fkey`-violation i `updateStandings`
midt i etape-afvikling. To løb ("Tour of the Isles", "Vuelta a los Picos") fik deres
finalization aborteret og hang i finalization-pending indtil recovery-stien samlede op.

## Rod-årsag

`aiTeamTrimHealSweep` (#2187) slettede udskudte AI-hold så snart det blokerende løb
var *kørt færdigt* — men **før** auto-prize-sweepen havde udbetalt løbets præmier.
Guarden dækkede kun race_entries i igangværende løb, ikke race_results i uudbetalte.
Kombineret med minutter-lange cron-ticks (stale reads) ramte hver sletning med høj
sandsynlighed en anden cron midt i arbejdet:

1. Payout havde læst preview inkl. holdet → kreditering kastede P0002 → **hele**
   ticket aborteret (alle løb uudbetalte det tick).
2. `updateStandings` havde læst race_results med holdets rækker → upsert efter
   delete-commit → FK-violation → løbets finalization aborteret.

## Fix (tre lag, #2390)

- Trim-guard: uudbetalte præmier (race_results m. prize_money>0 i løb m.
  `prize_paid_at IS NULL`) udskyder trim — samme pending_removal-mekanik.
- Payout: P0002 pr. hold-kreditering → skip + log (void præmie), resten fortsætter.
- Standings: live-re-tjek af teams umiddelbart før upsert.

## Læringer

1. **Sletning af en entitet skal guarde mod ALLE udestående forpligtelser, ikke kun
   den der bed sidst.** #2187-guarden dækkede inflight-entries (DB-triggeren der bed);
   præmie-forpligtelsen var usynlig indtil den bed. Backwards-check: findes der andre
   asynkrone forbrugere af teams (sponsor-indkomst, board)? Sponsor-krediteringen kører
   i samme sweep og er dækket af samme guard-vindue.
2. **Per-dag-dedupe af fejl-captures skjuler vedvarende fejl.** Schedulerens seenKeys
   (én capture pr. løb pr. dag) betød at Isles' gentagne finalization-fejl var usynlige
   i både Sentry og logs. Sentry viste "2 events" hvor virkeligheden var fejl hvert tick.
   Kig ALTID i Railway-loggen ved cron-fejl — den viste mønstret (nyt hold pr. trim-tick)
   som Sentry ikke kunne.
3. **Crons der muterer delt tilstand (delete) + crons med lange ticks (stale reads) =
   kollisionsvindue på minutter, ikke millisekunder.** "Det når aldrig at ske samtidigt"
   holder ikke når et scheduler-tick tager 35+ min (se P2-observationen i #2389-analysen:
   updateStandings fuld-sæson-recalc efter hver etape er flaskehalsen).
