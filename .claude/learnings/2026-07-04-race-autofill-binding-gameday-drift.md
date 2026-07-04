# 2026-07-04 · Race-motor "No start list": autofill-binding driftede til kalenderdag-nøgling

## Symptom
Sentry CYCLINGZONE-23: `Error: No start list for race <id>` fra `simulateStageByIndex`
(raceRunner.js:1137), 11+ events, stadig aktiv. Ramte race blev planlagt korrekt (6
etape-profiler + 6 schedule-rows) men havde **0 race_entries** → tomt startfelt → kast.
Relateret CYCLINGZONE-24 (stall-watchdog) = downstream-symptom.

## Rod-årsag
`loadFieldBindingContext` (runtime auto-fill-stien i raceRunner.js) hentede `scheduled_at`
men **ikke `game_day`** fra `race_stage_schedule` (linje 326 + 347). `raceBindingWindow`
(raceBinding.js:56) vælger in-game-dag-nøgling KUN hvis hver row har et endeligt `game_day`
— ellers falder den tavst tilbage til real-kalenderdag-ordinalen. Efter kalender-rebuilden
(#1945, commit 40079c50, 2026-06-27) er mange in-game-dage komprimeret til få real-
eftermiddage → i kalenderdag-rummet overlapper ALLE løb → `excludeBoundRiders` udelukker
hele feltet → autopick returnerer [] pr. hold → tomt felt.

Commit 40079c50 indførte game_day-nøglingen OG migrerede søster-stien
`loadTeamBindingContext` (manuel holdudtagelse) til at selecte `game_day` — men rørte
ALDRIG `raceRunner.js`. Så auto-fill-stien blev efterladt på det gamle keyspace.

## Fix (PR #2168)
Tilføj `game_day` til de to `race_stage_schedule`-selects i `loadFieldBindingContext`.
Additivt, ingen migration, ingen datamutation. Scheduleren self-healede på næste tick:
verificeret i prod at det ramte løb gik 0 → 165 entries + etape 1 kørt.
Forward-guard: `raceRunnerBindingContract.test.js` source-scanner at auto-fill-bindingen
selecter `game_day`, + regressionstest på at game_day-nøgling adskiller ellers-kalenderdag-
overlappende løb.

## Læring / mønster at huske
- **Delt-invariant-drift ved dobbelt-sti:** når to kodestier implementerer samme regel
  (her: binding), og en refactor migrerer den ene, driver den anden lydløst bagud. Den
  fejlende sti var den mindst-observerede (auto-fill for AI-hold) → opdaget først via
  Sentry uger senere. Ved keyspace-/kontrakt-ændringer: grep ALLE forbrugere, ikke kun
  den man rører.
- **Tavst fallback = tavs bug:** `useGameDay = rows.every(finite game_day)` falder til et
  andet (forkert) keyspace uden fejl når kolonnen mangler. En manglende SELECT-kolonne
  giver ingen exception — kun forkert adfærd. Forward-guarden asserter nu kolonnen findes.
- **Verificér heal, ikke bare merge:** "No start list" bekræftet fikset ved at query'e det
  konkrete løbs entry-count i prod efter tick (0→165), ikke kun ved grønne tests.

## Bemærk (undgå fremtidig forveksling)
Monuments ligger BEVIDST på `game_day` 100000+ (`MONUMENT_GAMEDAY_BASE`, binding-fri per
spec 2026-06-28). Det er IKKE datakorruption. Design-genovervejelse tracked i #2170 —
ikke en del af dette fix.
