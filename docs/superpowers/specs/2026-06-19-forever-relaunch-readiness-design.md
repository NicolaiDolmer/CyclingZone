# Forever-relaunch readiness — design

> **Status:** Godkendt design (2026-06-19, ejer-godkendt forks + a/b). Næste: writing-plans → implementeringsplan.
> **⚠️ Erratum 2026-06-20 (#1595):** WS2-beslutning **a (PCM "slet helt")** er nedjusteret til **Option B** (ejer-godkendt). `stat_*`-kolonnerne BEVARES — `abilityDerivation.js:213-217` læser dem ubetinget for 5 evner. Den permanente, gate-styrede udfasning af PCM/`uci_points` lever i `plans/2026-06-20-pcm-uci-permanent-retirement-plan.md`. Se opdateret WS2 §4 + Appendix A nedenfor.
> **Relateret:** [`docs/PLAN.md`](../../PLAN.md) (dengang sekvenserings-plan; superseded 23/7 af [`docs/MASTERPLAN.md`](../../MASTERPLAN.md)), [`2026-06-17-relaunch-hybrid-engine-1307-design.md`](2026-06-17-relaunch-hybrid-engine-1307-design.md) (18/6-relaunch-stien), epic #1105.
> **Skelnen:** Dette er IKKE 18/6-relaunchen (frisk beta-sæson 1, allerede live). Dette er **forever-relaunch** = ét sidste destruktivt reset, hvorefter vi committer til ALDRIG at nulstille igen.

## 1. Mål & definition

Et **permanent commit til no-reset**: efter forever-vinduet kan ægte nye spillere stole på, at deres progression aldrig nulstilles. Ét sidste destruktivt reset lægger den endelige starttilstand.

**Pejlemærke: før TdF 4/7** — ikke en hård deadline. Vinduet fyres kun når forever-gaten (§6) er grøn.

## 2. Ejer-godkendte beslutninger (2026-06-19)

| # | Beslutning | Valg |
|---|---|---|
| 1 | Reset-model | **Ét sidste reset → forever** (aldrig igen) |
| 2 | Forever-bar | **Drifts-bar**: reset-krævende + automatisering (B) skal være på plads i/før vinduet. Discord-pukkel + engine-dybde glider efter. |
| 3 | Pejlemærke | **Før TdF 4/7** (blødt, gate-styret) |
| 4 | Sekvensering | **Risiko-først**: byg B nu, stress-test på nuværende beta-sæson; A+C+result_type-afklaring parallelt; granit-frys + vindue sidst |
| a | PCM-udfasning | **Slet helt** — hele PCM-import-pipelinen + `stat_*`-kolonnerne fjernes; ingen vej tilbage |
| b | Granit-frys | **Eksplicit ejer-gate**: en separat ejer-session (§7) hvor ejeren ser de kalibrerede tal og godkender dem som endelige, før vinduet kan fyres |

## 3. Arkitektur-indsigt (fra completeness-audit 2026-06-19)

Fundamentet er allerede **granit og reproducerbart**. Hele spil-semantikken er en kæde:

```
seed=2026 → physiology → abilities → rider_types → base_value → market_value → løn/økonomi
```

Røres ét led retroaktivt, skal hele populationen re-deriveres = reset. Derfor er forever-readiness primært et **frysnings- og oprydnings-arbejde**, ikke et byggeprojekt. Det eneste reelt store *byggestykke* er automatiseringen (B). Fuld reset-krævende inventory: Appendix A.

## 4. Workstreams

### WS1 — Automatisering (B) [STOR — bygges først, testes på beta]
Driftsmæssig forudsætning for at slippe spillet til ægte spillere uden manuel afvikling.
- **Race-scheduler**: cron der afvikler dagens løb automatisk (random ± timing så ikke alt kl. 22:00, error-handling, Sentry-alert ved fejl). I dag 100% manuelt (`raceRunner.js` via admin-trigger).
- **Auto-prize**: udbetal præmier efter løb-completion (genbrug `prizePayoutEngine.js`, idempotent via `races.prize_paid_at`). I dag manuelt admin-endpoint.
- **Re-enable season-transition-cron**: `SEASON_AUTO_TRANSITION_ENABLED=false` i dag (deaktiveret efter loop-bug 2026-05-21). Loop-guarden findes (`runDailySeasonCountCheck`); re-enable forsigtigt med monitorering.
- **Stress-test live på den nuværende beta-sæson** før forever — den eneste store ukendte bevist tidligt.
- Filer: `backend/cron.js`, `backend/lib/seasonAutoTransition.js`, `backend/lib/prizePayoutEngine.js`, `backend/lib/economyConstants.js:97`, `backend/scripts/executeSeasonTransition.js`.

### WS2 — PCM-udfasning (C) [MIDDEL]

> **⚠️ OPTION A ("slet helt") SUPERSEDET 2026-06-20 → Option B (ejer-godkendt, #1595).** Den oprindelige "slet de 14 `stat_*`-kolonner + PRIMARY_STAT-fallback; fallbacken er reelt død"-plan var **faktuelt forkert**. `backend/lib/abilityDerivation.js:213-217` læser `stat_ned`/`stat_bro`/`stat_fl`/`stat_ftr` **UBETINGET** (uden for `if (fromPhysiology)`-gaten) for 5 tekniske/mentale evner: `descending`, `cobblestone`, `positioning`, `aggression`, `tactics`. `rider_physiology_profiles` indeholder KUN fysiske watt-metrics (`PHYS_ANCHORS`) — ingen skill-stats. Selv en fuld-fysiologi-rytter henter altså disse 5 evner fra `stat_*`. Sletning ville nulstille 5 evner for HELE populationen = balance-brydende + reset-krævende, og strider mod ejer-direktiv #1529 ("PCM ud af VISNING, ikke ud af data — bliver derive-kilde"). Den permanente udfasnings-sti (med eksplicitte gates før noget slettes) lever nu i `docs/superpowers/plans/2026-06-20-pcm-uci-permanent-retirement-plan.md`.

**Option B-scope (denne workstream — ingen migration, intet `stat_*`/`pcm_id` røres):**
- **BEVAR** de 14 `riders.stat_*`-kolonner + `pcm_id` som tavs derive-kilde + fiktiv-vs-ægte-diskriminator. Ingen migration.
- **BEVAR** PCM-resultat-pipelinen (`pcmResultsImport.js`, `pcmResultsParser.js`, `pcmRiderMatcher.js`, `pcmRiderAliases.js`, `pcmTeamAliases.js`) + admin-endpoint `POST /admin/import-results-pcm` (api.js ~6172) **indtil WS1 Fase 3 stage-automatisering er bevist på beta** (#1596). Endpointet er den ENESTE manuelle løbsresultat-recovery-sti; dets fjernelse er sekvenseret EFTER WS1 (forever-gate §6.1 kræver alligevel WS1 bevist). UI-indgangen er allerede fjernet (#1532/#1545).
- `pcmRiderMatcher.js` eksporterer desuden `foldNameNordic`, der bruges af ikke-PCM-kode (`academyIntake.js`, `fictionalRiderGenerator.js`, `relaunchOrchestrator.js`, `starterSquadAllocator.js`, `generateFictionalRiders.js`) — kan IKKE slettes uafhængigt af pipelinen.
- `uci_points`-kolonnen: afkoblet fra værdi siden #1101, men **stadig live læst** af `boardIdentity.js:367` (`calculateRiderStarScore`, "sidste funktionelle læser" jf. #1208). Må ikke droppes før #1208 kalibrerer star-score væk fra den.
- `pcm_id IS NULL`-som-fictional-markør er en **live diskriminator** (`api.js`, `youthMarket.js`, `legacyRiderRetirement.js`'s relaunch-pensionering) — ikke et dødt artefakt. Forbliver indtil populationen er 100% fiktiv post-forever.
- **NB:** `legacyRiderRetirement.js` (relaunch trin 1) bruger `pcm_id IS NOT NULL` til at pensionere legacy-ryttere. PCM-oprydning må ikke fjerne `pcm_id` før forever-vinduet er kørt.

### WS3 — Egne løb (A) [LILLE]
- Erstat real-world-navne i `scripts/race_pool_seed.csv` med egne fiktive navne + kør `node backend/scripts/seedRacePool.js`.
- Ruteprofiler (`raceStageProfileGenerator.js`) er **allerede egne/generiske** (seedet fra race-UUID, ikke historiske data) → urørt. Valgfri tuning af `DEMAND_VECTORS` er glide-arbejde (ikke reset-krævende).

### WS4 — Frys-pakken [LILLE kode + ejer-beslutning]
- **Granit-frys** (ejer-session, §7): ejeren godkender at de kalibrerede tal (Appendix A) er endelige.
- **SSOT-guard**: automatisk test der fanger hvis `STAR_RIDER_MARKET_VALUE` (8M) divergerer fra `LAUNCH_VALUE_BANDS[superstjerne].lo` (koblet 3 steder: `economyConstants.js:55`, `fictionalLaunchPopulation.js:37-42`, `2026-06-10-star-threshold-8m.sql`).
- **Parameterisér START_DATE**: hardcoded `2026-06-20` i `relaunchSeason1.js:23` + `dev/run-relaunch-rehearsal.mjs:7` → ny vindue-dato som parameter.
- **result_type-afklaring** (undersøgelse): afgør om udbruds-status (#1499) kan være et separat felt på `race_results` frem for en ny `result_type`-enum-værdi. **Hypotese:** felt, ikke enum → ikke reset-krævende. Point/bjerg pr. etape (#959 V2) er allerede dækket af eksisterende `points_day`/`mountain_day`. Hvis udbrud KRÆVER ny enum-værdi → skal ind før frys.

## 5. Sekvensering (risiko-først)

```
Nu ───────────────────────────────────────► Frys ──► Vindue (≈ før TdF 4/7)
 │
 ├─ WS1 automatisering ──► live-test på beta-sæson ──► bevist ─┐
 ├─ WS3 egne løbsnavne (lille) ──────────────────────────────┤
 ├─ WS2 PCM slettes helt ────────────────────────────────────┤
 └─ WS4 result_type-undersøgelse + START_DATE-param ─────────┘
                                                              ▼
                                  granit ejer-session (§7) + verificeret backup
                                                              ▼
                                              ejer-kørt destruktivt reset-vindue
```

## 6. Forever-gate (exit-kriterier — alt grønt før vinduet fyres)

> **✅ GATEN LUKKET — vinduet FYRET 2026-06-22 (ejer-superviseret).** Permanent frisk sæson 1 er live. Backup `cyclingzone-20260622-153339` (`db:verify-restore`: VERIFIED, 0 issues) + PITR (archive_mode=on) = recovery-net. Post-verify grøn: 7 live puljer per-division-kalender (101 løb scheduled + 432 profiler/etape-tider), AI-fyld 143×8, 25 managers i div 3 (div 4 tom headroom), frisk marked 799, founder-badges 25, board pending_5yr, flags on, #1137-progression aktiveret (PR #1711, peakAge=28). Post-verify fandt + fiksede 2 issues: 886 gamle 18/6-test-ryttere retired (frisk marked) + 564 strandede AI-academy-kuld ryddet (`academyHealSweep` is_ai-fix, PR #1711). **Eneste resterende gate-punkt: spiller-comms (#1278) — bevidst udskudt til ejer-koordinering (ejer-valg 22/6).**

1. **WS1 bevist på beta**: løb afvikles + præmier udbetales + sæson-skift kører ≥1 fuld cyklus uden manuel indgriben.
2. **WS2 + WS3 merged + deployet**.
3. **WS4**: granit ejer-frosset (§7) + result_type afklaret + START_DATE parameteriseret.
4. **Verificeret DB-backup** umiddelbart før (eksisterende off-site backup-rutine, `db:verify-restore` grøn).
5. **Spiller-comms klar** (#1278) — hvad forever-resettet betyder for de nuværende beta-testere.

## 7. Granit-frys-sessionen (separat ejer-session — planlagt)

En dedikeret session hvor ejeren ser de kalibrerede tal og eksplicit godkender dem som endelige. Efter forever kan de ikke ændres uden et nyt reset. Listen ejeren skal se (detaljer + fil:linje i Appendix A):

- **Værdimodel**: `riderValuationModel.json` (v3-fit) + `riderValuationAnchors.json` (26 ankers, fx Pogačar=189M)
- **Ability-derivation**: CONTRAST-params (k=1.52, floor=8) i `abilityDerivation.js`
- **Ryttertyper**: `riderTypesBaseline.json` (z-score pop-mean) + `RIDER_TYPES`-vægte (8 typer) + LAUNCH_TYPE_FLOORS
- **Population**: `LAUNCH_POPULATION` (seed=2026, count=800, value-bands, type-floors)
- **Start-trupper**: `STARTER_POOL_STAT_WINDOW [50,57]` (#1487) + snake-draft (8 = 4 youth + 4 domestique)
- **Økonomi**: sponsor (600/400/340k), upkeep (440/140/40k), løn-rate (0.067), startsaldo (800k), gældslofter (1.2/0.9/0.6M), sponsor-loft, stjerne-tærskel (8M)
- **Race-scoring**: race-points-lookup + `result_type`-enum
- **Akademi/progression**: ACADEMY-konstanter, GRADUATION (alder 22), PROGRESSION_CONFIG (peak 28, retirement 36-40)

## 8. Reset-vinduet

Genbrug den **eksisterende relaunch-orchestrator** (`relaunchSeason1.js`, allerede P4-rehearsal-testet grøn 18/6) med de nye params (egne løbsnavne, ny START_DATE). Verificeret backup først, ejer-kørt destruktivt vindue (`--target-prod --confirm` + ack-flags). Reset-stien er FK-audit-hærdet (#1472).

## 9. Glider efter forever (no-reset)

Discord-feedback-pukkel (7 nye #1531-#1537 + jeppek-5 + øvrige), engine-dybde (#1021 fysiologi → taktik → spectation #959 V2), progression-tuning (sæson 2+, flag off i dag), result_type-udvidelser *hvis* ikke-reset-krævende, økonomi-tuning af glide-konstanter (DIVISION_BONUSES, PRIZE_PER_POINT, renter, squad-størrelser).

## 10. Risici & åbne spørgsmål

- **result_type/udbrud (#1499)**: afklares i WS4-undersøgelsen. Hvis det viser sig at kræve ny enum-værdi, skal #1499 ind i vinduet — ellers er den umulig uden reset #2.
- **Beta-testeres data**: forever-reset nulstiller de 22 testeres nuværende sæson. Founder-badges + comms (#1278) håndteres som del af vinduet.
- **Race-scheduler-robusthed**: ny komponent; loop-bug-historik (2026-05-21) gør grundig test + monitorering kritisk. Re-enable af season-cron skal ske med `runDailySeasonCountCheck`-sikkerhedsnet aktivt.
- **PCM-sletning vs. retirement-sti**: `legacyRiderRetirement.js` afhænger af `pcm_id` — rækkefølge: pensionér legacy FØR/i vinduet, ryd så PCM-koden. **Opdatering 2026-06-20 (#1595):** `stat_*` BEVARES (Option B) — kun resultat-pipelinen + endpoint fjernes, og dét sekvenseres efter WS1-bevis (#1596). Fuld gate-styret plan: `plans/2026-06-20-pcm-uci-permanent-retirement-plan.md`.

## Appendix A — Reset-krævende inventory (fra completeness-audit 2026-06-19)

Konstanter/tilstand der SKAL være rigtige før forever-vinduet (ændring senere = tvunget reset). Kilde: 5 parallelle domæne-scannere.

**Ryttere / evner / værdi**
- `riderValuationModel.json` (v3 anchor-fit) — stor. `backend/lib/riderValuationModel.json`
- `riderValuationAnchors.json` (26 ejer-benchmarks) — lille
- CONTRAST-params (k=1.52, floor=8, CONTRAST_ABILITIES) — stor. `abilityDerivation.js:15-52`
- `riderTypesBaseline.json` (z-score pop-mean, 8.989 ryttere) — stor
- `RIDER_TYPES`-vægte (8 typer) + LAUNCH_TYPE_FLOORS (gc≥30, sprinter≥40) — stor. `riderTypes.js:36-45`
- `LAUNCH_POPULATION` (seed=2026, count=800, value-bands, type-floors) — stor. `fictionalLaunchPopulation.js:26-47`
- PCM-skill-stats i derivation — **stor (BEVARES, IKKE slettes — Option A superset 2026-06-20)**. `abilityDerivation.js:213-217` læser `stat_ned`/`stat_bro`/`stat_fl`/`stat_ftr` UBETINGET for `descending`/`cobblestone`/`positioning`/`aggression`/`tactics`. Den fysiologi-løse PRIMARY_STAT-fallback (`abilityDerivation.js:93-100`, linje 191-200) er separat og reelt død for forever-ryttere, men skill-stat-læsningen er det IKKE. `stat_*` fjernes først efter native fysiologi (#1021) erstatter dem som derive-kilde — se retirement-planen.

**Økonomi** (alle E2-tunet mod `moneySupplyScorecard --synthetic`)
- `SPONSOR_INCOME_BY_DIVISION` (600/400/340k) — stor. `economyConstants.js:22`
- `UPKEEP_BY_DIVISION` (440/140/40k) — stor. `economyConstants.js:33`
- `INITIAL_BALANCE` (800k) — stor. `economyConstants.js:42`
- `SALARY_RATE` (0.067, frossen ved signering) — stor. `economyConstants.js:116`
- `DEBT_CEILING_BY_DIVISION` (1.2/0.9/0.6M) — lille. `economyConstants.js:65`
- `FINAL_SPONSOR_PAYOUT_CEILING` (S1 720k / S2+ 900k) — lille. `economyConstants.js:38`
- `STAR_RIDER_MARKET_VALUE` (8M, SSOT-koblet 3 steder) — lille. `economyConstants.js:55`
- `market_value` GENERATED fra `base_value` (post-#1101) + salary FROSSEN INTEGER (post-#1309) — stor (skema). `schema.sql:62-66`

**Start-trupper / akademi / progression**
- `STARTER_POOL_STAT_WINDOW [50,57]` (#1487) — lille/stor. `starterSquadAllocator.js:44`
- Snake-draft (SQUAD_SIZE=8, 4 youth + 4 domestique) — stor. `starterSquadAllocator.js:24-33`
- ACADEMY-konstanter (SLOTS=8, MIN/MAX_AGE, rates) — lille. `academyFlag.js:8-25`
- GRADUATION (GRADUATE_AGE=22, DEADLINE_DAYS=7) — lille. `academyGraduation.js:17-20`
- PROGRESSION_CONFIG (peak=28, retirement 36-40, headroom) — stor. `riderProgression.js:24-61`
- `ability_caps` lazy-init — stor. `riderProgressionEngine.js:156-162`

**Race / resultater**
- race-points-lookup (result_type→rank→points pr. race_class) — stor. `raceResultsEngine.js:42-53`
- `result_type`-enum (CHECK-constraint) — stor. `schema.sql:134`

**Schema / reset-stier**
- Season 0 UUID (hardcoded `00000000-...-0`) — stor. `2026-05-09-season-zero-finance-tx-backfill.sql`, `seasonTransition.js:124-130`
- `FIRST_VARIABLE_SPONSOR_SEASON=2` + `FIRST_PROMOTION_RELEGATION_SEASON=3` — stor. `sponsorEngine.js:3`, `economyConstants.js:85`
- `START_DATE` (2026-06-20, hardcoded) — lille (parameteriseres, WS4). `relaunchSeason1.js:23`
- board_profiles baseline-tilstand ('observation') — lille. `betaResetService.js:234-307`
- `DEFAULT_BETA_BALANCE` (800k) + `DEFAULT_BETA_DIVISION` (3) — stor. `betaResetService.js:5-6`

## Appendix B — Glider trygt efter forever (no-reset, ren kode)

Race Engine v2-simulator-params (GAP_MODEL, NOISE, FORM/FATIGUE-weights, så længe løb ikke er simuleret endnu); raceRunner-aggregering/tiebreakers/autopick; display-labels + i18n; DIVISION_BONUSES, PRIZE_PER_POINT (1500), rente (10%), squad-størrelse/soft-caps; board-motorer; auction/transfer/loan-logik; notifikationer/Discord/audit-log; progression-formler (sæson 2+, flag off); kolonne-privilege-RLS (fail-closed på nye kolonner).
