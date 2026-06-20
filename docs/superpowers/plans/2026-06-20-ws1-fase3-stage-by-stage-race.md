# WS1 Fase 3 — Stage-by-Stage Race Afvikling: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status (2026-06-20):** Dette plan **erstatter og omdefinerer** WS1 Fase 3 i `docs/superpowers/plans/2026-06-19-ws1-race-automation.md`. Fase 1 (auto-prize) og Fase 2 (season-cron) fra det originale WS1-plan er LANDET (PR #1566). Fase 3 er GATED af ejer-beslutninger (Fase 0 nedenfor) **og** kræver at PR #1566 er merged (deler `backend/cron.js`).
>
> **Ejer-direktiv (20/6, verbatim):** "Det er 1-5 etaper om dagen, alt efter hvilke øvrige løb der køres. Systemet skal kunne køre 5 etaper om dagen, men på 5 forskellige tidspunkter på den dag. Så afviklinger fra nu af, er altid en etape af gangen."
>
> **Kilder:** Kodebase-læsning 2026-06-20 (arkitekt-agent) · `backend/lib/raceRunner.js` (verificeret) · `backend/lib/adminSimulateRace.js` · `database/schema.sql:125-136` · forlæg-format: `docs/superpowers/plans/2026-06-19-ws1-race-automation.md`.

**Goal:** Omsætte ejerens direktiv til et komplet, test-drevet system der komponerer rent med de allerede-byggede WS1 Fase 1/2-komponenter og ikke bryder finalization-korrekthed (GC/jersey/præmier/Discord/bestyrelse).

**Architecture:** En ny `simulateStageByIndex` i `raceRunner.js` kører resim-from-scratch op til og med etape N (udnytter full determinism), persisterer kun den nyeste etape, og gates en ny `stages_completed`-tæller på `races`. En daily `stageScheduler.js`-cron finder alle aktive multistage-løb + dagens 1-dags-løb, beregner deterministiske stagger-slots pr. `(race.id, in-game-date)`, kører op til 5 stages pr. in-game-dag, og gater hele finalization-pipelinen bag `isFinalStage`.

---

## Arkitektur-analyse: Nøgle-facts der driver designet

### Determinisme muliggør "resim-to-stage-N"
`buildRaceResults` (`raceRunner.js:110-265`) kører altid hele løbet fra etape 1 til N. Seed = `stableSeed(`${race.id}:${stageNumber}`)` (linje 196) er deterministisk. At køre etape 3 af et 7-etapers løb er identisk med at køre 1-2-3 og smide 1-2 bort. Cost: O(k) simuleringer for etape k; for 21 etaper × ~200 ryttere < 100ms/etape (in-memory). Resim-modellen er gratis og korrekt.

### Idempotens er allerede per-stage i DB-laget
`simulateRace` linje 527-529: `delete().eq("race_id", race.id).in("stage_number", stagesInRun)`. `persistRuns` (462-463) identisk. Skriver vi kun etape N's rækker, rører vi ikke etape 1..N-1.

### `races.status` binary-modellen er barrieren
`schema.sql:133` — `status CHECK (status IN ('scheduled','active','completed'))`. Et delvist afviklet løb har ingen repræsenterbar tilstand. `adminSimulateRace.js:89` kaster 409 hvis completed. **Løsning:** tilføj `stages_completed INT DEFAULT 0 NOT NULL` (aldrig ændre status-enum). Status forbliver `'scheduled'` under afvikling, skifter til `'completed'` kun når `stages_completed === race.stages`.

### Finalization er allerede delvist gated bag `isFinal`
`raceRunner.js:195` setter `const isFinal = i === stagesSorted.length - 1`. Mellem- vs slut-etape-resultater er allerede splittet (240-243 vs 248-253). Problemet: `simulateRace`'s efterorkestrering (541, 556, 562-576, 578-584) kaldte `status='completed'`, `recomputeSeasonRaceDays`, `processBoardWeekend`, `notifyDiscord` for hele løbet → skal nu gates bag `isFinalStage`.

### Auto-prize betaler kun completed løb (ingen ændring nødvendig)
`prizePayoutEngine.getSeasonPrizePreview` (`:15`) queryer `WHERE status='completed'`. Delvist afviklet løb (`status='scheduled'`) fremgår aldrig → præmier betales kun ved final stage. **Ingen kode-ændring i prizePayoutEngine.**

### `recomputeSeasonRaceDays` summer `stages WHERE status='completed'`
`seasonRaceDays.js:13-17`. Delvist løb tæller 0; counter hopper med hele etapeantal ved final-stage. Acceptabelt/korrekt (alternativet = ny incrementel counter der kan desyncs).

---

## Fil-struktur

| Fil | Ansvar | Fase |
|-----|--------|------|
| `database/<dato>-races-stage-progress.sql` (ny, **ejer merger**) | `races.stages_completed` + `races.scheduled_for` + indekser + GRANT | 3.1 |
| `backend/scripts/backfillRaceScheduledFor.js` (ny) | Backfill `scheduled_for` for live-sæson (Beslutning C) | 3.2 |
| `backend/lib/stageSchedulerFlag.js` (ny) | Runtime-flag `stage_scheduler_enabled` | 3.3 |
| `backend/lib/raceRunner.js` (ændr) | Ny `simulateStageByIndex` (resim-to-N, persist kun N, isFinalStage-gate) | 3.4 |
| `backend/lib/adminSimulateRace.js` (ændr) | `runAdminSimulateStage` for manuel etape-fremtvingelse | 3.4 |
| `backend/lib/stageScheduler.js` (ny) | Cron-sweep: due stages, stagger, max-5-cap | 3.5 |
| `backend/cron.js` (ændr) | Registrér `stageScheduler` (kræver #1566 merged) | 3.6 |
| `backend/api.js` (ændr) | `POST /admin/races/:id/simulate-stage` | 3.7 |
| `*.test.js` (ny pr. modul) | TDD-tests | 3.x |

---

## Fase 0 — Ejer-beslutninger (afgør FØR Fase 3 bygges)

### Beslutning A — Stagger-mekanisme
- **(A) Faste tids-slots** (fx 10:00/12:30/15:00/18:00/21:00 CET) — spillerne ser præcise tidspunkter; kræver `scheduled_at` pr. stage + hyppig scheduler.
- **(B) Deterministisk offset fra 22:00-vinduet** — `offsetMin = stableSeed(`stagesched:${race.id}:${date}`) % N`; ingen scheduled_at-kolonne; spillerne ser ikke præcist tidspunkt.
- **BESLUTTET (20/6): A — synlige faste tidspunkter.** Ejer vil have spillerne kan se pr.-etape-tider ('Etape 3 kl. 15:00'). → Beslutning B = `race_stage_schedule`-tabel (ikke deterministisk offset).

### Beslutning B — Stagger-opbevaring
- **(B) `race_stage_schedule`-tabel** (`race_id`, `stage_number`, `scheduled_at`) — ren separation; player-facing RLS.
- **(C) `scheduled_for` på `races` + runtime-beregning** — laveste schema-overhead; matcher original WS1 Fase 3-plan.
- **BESLUTTET (20/6): B — ny `race_stage_schedule`-tabel** (`race_id`, `stage_number`, `scheduled_at TIMESTAMPTZ`, PK (`race_id`,`stage_number`)), player-facing SELECT. Følger af synlige tider (Beslutning A).

### Beslutning C — Live retrofit vs reset-only
- **(A) Retrofit live beta-sæson** — backfill-script sætter `scheduled_for` på scheduled races fra i morgen og frem. Nødvendig for forever-gate §6.1 stress-test. Ændrer hvordan nuværende beta-sæson afvikles.
- **(B) Reset-only** — nuværende sæson køres manuelt til slut; scheduler aktiveres ved forever-relaunch. Zero retrofit-risiko.
- **BESLUTTET (20/6): A — retrofit live beta nu** (backfill `scheduled_for` + stage-tider på resterende løb). "Afviklinger fra nu af" = live.

### Beslutning D — Daglig cap-semantik
- **(A) 1 stage per aktivt løb, maks 5 løb/dag** — matcher "5 løb på 5 tidspunkter".
- **(B) Maks 5 stages totalt uanset fordeling.**
- **BESLUTTET: A** (matcher ejer-direktivet præcist).

### Beslutning E — `stages_completed`-backfill for completede løb
- **BESLUTTET: A** — `UPDATE races SET stages_completed = stages WHERE status='completed'` i migrationen (harmløst, korrekt audit-semantik).

### Implementerings-delta efter ejer-beslutninger (20/6)
Da **A=synlige tider + B=tabel** er valgt, ændres to tasks fra plan-defaulten:
- **Task 3.1 (schema):** tilføj OGSÅ `race_stage_schedule`-tabel (`race_id`, `stage_number`, `scheduled_at TIMESTAMPTZ`, PK (`race_id`,`stage_number`)) med `SELECT TO authenticated USING (true)` (player-facing kalender). `races.scheduled_for` beholdes som "løbets startdag". 
- **Task 3.2 (backfill):** udfyld BÅDE `races.scheduled_for` OG én `race_stage_schedule`-række pr. etape med et fast dansk tids-slot (fordel etaper over dage; flere etaper samme dag → forskellige slots, fx 12:30/15:00/18:00/21:00 CET).
- **Task 3.5 (scheduler):** find due stages via `race_stage_schedule WHERE scheduled_at <= now() AND stage_number = races.stages_completed + 1` (i stedet for deterministisk offset). Bevar max-5/dag-cap + loop-guard.
- **Follow-on (separat PR):** player-facing etape-kalender-UI der viser `scheduled_at`-tiderne. Forever-blockeren er backend-automatiseringen (kører etaper på de lagrede tider); UI'et er fast-follow.

---

## Fase 3 — Stage-by-Stage Afvikling *(MEDIUM-HØJ risiko · GATED af Fase 0 + #1566 merged)*

> **Byg IKKE før Beslutning A+B+C er truffet, #1566 er merged, og stress-test-vindue er aftalt.**

### Task 3.1: Schema — `races.stages_completed` + `races.scheduled_for` *(ejer merger)*
```sql
-- Stage-by-stage afvikling (#WS1 Fase 3):
ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS stages_completed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS races_scheduled_for_active_idx
  ON public.races (scheduled_for, season_id) WHERE status != 'completed';

-- Beslutning E: korrekt audit-semantik for allerede-completede løb.
UPDATE public.races SET stages_completed = stages WHERE status = 'completed';

-- Player-facing kalender (#1162-mønster — verificér races' RLS-model FØR):
GRANT SELECT (scheduled_for, stages_completed) ON public.races TO anon, authenticated;
```
- [ ] Verificér GRANT-mønster mod prod-klon (`\dp public.races` via Supabase MCP): table-level RLS (som `race_stage_profiles`) vs kolonne-privilegier. Kolonne-GRANT er redundant-men-ufarlig ved table-level RLS.
- [ ] Commit migration — **ejer merger selv** (auto-applies i prod).

### Task 3.2: Backfill-script (kun hvis Beslutning C-A)
`backend/scripts/backfillRaceScheduledFor.js` — fordel alle `status='scheduled'`-løb i aktiv sæson over kommende dage (ét løb/dag fra i morgen, sortér på `name` for determinisme). `--dry-run` flag. Kør dry-run → verificér → live (ejer godkender).

### Task 3.3: Runtime-flag `stage_scheduler_enabled`
`backend/lib/stageSchedulerFlag.js` — spejl `raceEngineFlag.js`, key `stage_scheduler_enabled`, fail-safe OFF. TDD. Commit.

### Task 3.4: `simulateStageByIndex` i `raceRunner.js` + `runAdminSimulateStage`
Kernen. Resimulerer etaper 0..stageIndex (via `buildRaceResults`), persisterer KUN etape `stageIndex+1`. Kontrakt:
```js
export async function simulateStageByIndex({
  supabase, race, stageIndex, dryRun = false,
  applyRaceResults, ensureSeasonStandings, updateStandings,
  recomputeRaceDays, processBoardWeekend, notifyDiscord, applyFatigue,
}) // → { stageNumber, isFinalStage, rowsImported, entrants, stages }
```
Nøglepunkter (se arkitekt-agentens fulde kode i transcript / regenerér):
- `isFinalStage = stageIndex === (race.stages-1)`; `stageNumber = stageIndex+1`.
- Resim 0..stageIndex via `buildRaceResults`, **filtrér til kun `stage_number === stageNumber`** før persist.
- Idempotent `delete().eq("race_id").eq("stage_number", stageNumber)` før insert.
- **`applyFatigue` KUN for `thisStageProfile`** (ikke alle 1..N — de kørte i tidligere runs; ellers dobbelt-akkumulering). KRITISK.
- `persist = (stageIndex === 0)` for `loadEntrantsForRace` auto-fill (entries persisteres kun ved første etape).
- `UPDATE races SET stages_completed = stageNumber [, status='completed' IF isFinalStage]`.
- Finalization (`recomputeRaceDays`, `processBoardWeekend`, `notifyDiscord` med HELE løbets `race_results` hentet fra DB) KUN ved `isFinalStage`.
- TDD-tests: stageIndex=0 persisterer kun etape 1; final-stage kalder recompute+board; mellem-stage gør IKKE; status=completed kun ved final; **determinisme-test: etape-3-via-simulateStageByIndex == etape-3-fra-helt-løb (bit-for-bit)**; applyFatigue-kald == 1 pr. invokation.
- `runAdminSimulateStage`: henter race inkl. `stages_completed`, `stageIndex = stages_completed`, 409 hvis completed eller alle etaper kørt, flag-check som `runAdminSimulateRace`.

### Task 3.5: Stage-scheduler `backend/lib/stageScheduler.js`
`runStageScheduler({ supabase, now, isEnabled, runStageFn, stableSeedFn })`:
1. `copenhagenHour(now) >= 22` ellers `before_window`.
2. `stage_scheduler_enabled` flag (fail-safe OFF).
3. `isRaceEngineV2Enabled` (ekstra lag).
4. `countStagesDoneToday >= 5` → `daily_cap_reached` (loop-prævention; proxy via `race_simulation_runs.generated_at >= today-midnight-CET` — **verificér kolonnenavn i schema**).
5. Find due races: `scheduled_for::date <= today AND status != 'completed'`, sortér `scheduled_for` så `name`.
6. Pr. race: deterministisk `offsetMin = stableSeed(`stagesched:${race.id}:${today}`) % 90`; skip hvis `minutesIntoWindow < offsetMin` (`awaiting_offset`); ellers `simulateStageByIndex(stageIndex = stages_completed)`. Cap ved 5.
TDD-tests: flag-off; before-window; daily-cap; kører næste stage for hvert due løb op til cap; deterministisk offset-skip. Commit.

### Task 3.6: Hægt på `cron.js` (KRÆVER #1566 merged)
`setInterval(trackedTick("stage scheduler", runStageSchedulerCron), 5*60*1000)` ved siden af training/graduation sweeps. INGEN immediate-run. `verify-local.ps1` grøn. Commit.

### Task 3.7: `POST /admin/races/:id/simulate-stage`
Manuel fallback + test-trigger. Spejl eksisterende simulate-race-route, kald `runAdminSimulateStage`. Commit.

### Task 3.8: Beta-stress-test (manuel, ejer/ops — forever-gate §6.1)
Backfill live → tænd `stage_scheduler_enabled` + `auto_prize_enabled` + `race_engine_v2`. Observér ≥1 fuld cyklus: etape 1 → `stages_completed=1`, `race_results` kun etape 1, `status='scheduled'` → næste dag etape 2 → ... → final → `status='completed'` + recompute + board → inden for 5 min auto-prize udbetaler. Verificér Sentry, dagskvote ≤5, idempotens (to ticks samme vindue = ingen dobbelt-kørsel).

---

## Finalization Call Sites — gating-inventar

| Call site | Fil | Ny gate |
|-----------|-----|---------|
| `UPDATE status='completed'` | `raceRunner.js:541` | kun `isFinalStage` |
| `recomputeSeasonRaceDays` | `:556` | kun `isFinalStage` |
| `processBoardWeekendFinalization` | `:562` | kun `isFinalStage` |
| `notifyDiscord` | `:578` | kun `isFinalStage` (embed = hele løbets `race_results` fra DB) |
| `applyFatigue` | `:549-553` | KUN `thisStageProfile` (ikke 1..N) |
| `paySeasonPrizesToDate` | `autoPrizeSweep.js` | uændret (finder kun `status='completed'`) |

---

## Correctness/Balance Risks

1. **Fatigue-dobbeltoptælling** ved resim-to-N → `applyFatigue` KUN for stage N. Test tæller kald == 1.
2. **GC-korrekthed** ved resim → determinisme-test: stageStageByIndex(N) == helt-løb filtreret til N.
3. **Double-finalization** ved re-kør af final → `runAdminSimulateStage` 409 hvis completed; recompute/board er idempotente/konvergerende.
4. **`stages_completed` desync** (fejl efter results-write før counter-update) → idempotent delete-then-insert re-kører samme etape sikkert. Ingen korruption.
5. **Season-days desync** → step-funktion ved final; board bruger previous vs new race_days_completed-checkpoint korrekt.
6. **Loop-prævention** → `countStagesDoneToday >= 5` hard-stop + `trackedTick` Sentry + engine-flag-lag.
7. **Auto-prize før final** → ikke en risiko (kun `status='completed'`).
8. **Discord-embed** ved final → hent hele løbets `race_results` (ét ekstra DB-opslag, acceptabelt).
9. **`loadEntrantsForRace` auto-fill** → `persist = (stageIndex===0)`; senere etaper rører ikke entries.

---

## Ejer-beslutninger — Samlet

| # | Beslutning | Anbefaling | Status |
|---|-----------|------------|--------|
| A | Stagger: faste slots vs deterministisk offset | Synlige faste tider | **BESLUTTET: A (synlige tider)** |
| B | Opbevaring: `race_stage_schedule`-tabel vs `scheduled_for` på races | Tabel (følger af A) | **BESLUTTET: B (tabel)** |
| C | Live retrofit vs reset-only | Retrofit (stress-test) | **BESLUTTET: A (retrofit nu)** |
| D | Cap: 1/aktivt løb maks 5 vs hård 5 | 1/aktivt løb, maks 5 | **BESLUTTET: A** |
| E | Backfill completede løb | Ja | **BESLUTTET: A** |

## Kompositions-tjekliste (WS1)
| Komponent | Interaktion | Status |
|-----------|-------------|--------|
| Fase 1 auto-prize | Finder kun `status='completed'` → betaler kun ved final. | Klar |
| Fase 2 season-cron | Readiness checker uafsluttede løb; delvist løb = `scheduled` = blokerer transition korrekt. | Klar |
| `trackedTick` + `featureStage` | Stage-scheduler bruger samme mønster; fail-safe OFF. | Task 3.3/3.6 |
| Loop-prævention | `countStagesDoneToday` + trackedTick + engine-flag. | Task 3.5 |
