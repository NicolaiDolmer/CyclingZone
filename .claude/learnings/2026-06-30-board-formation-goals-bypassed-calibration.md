# Formations-board-mål omgik den dynamiske kalibrering (dannelse før trup)

**Dato:** 2026-06-30
**Issue/PR:** #2022 fase 2 / PR #2026
**Type:** lifecycle-ordering-bug + parallel kode-sti der omgik en eksisterende fix

## Symptom
Et nyt holds bestyrelse fik **statiske** fallback-mål: `min_riders 15` (på en
8-rytters start-trup → strukturelt uopnåeligt), `top_n 4`, `stage_wins 2`. Målene
bedømmes faktisk (kun `is_baseline` springes over) → straffer satisfaction uden at
manageren kan nå dem. Præcis det mønster #1267 fiksede for de *dynamiske* mål.

## Rod-årsag
To ting i kombination:
1. **Rækkefølge:** `ensureBoardProfile` (board-oprettelse) kører i
   `upsertOwnTeamProfile` FØR `allocateStarterSquad`. På oprettelses-tidspunktet
   har holdet 0 ryttere → `generateBoardGoals` kan ikke kalibrere mod en trup der
   ikke findes endnu → `useDynamicTargets=false` → statiske fallback-mål.
2. **Parallel sti omgik fixet:** #1267 kalibrerede relaunch/forhandlings-stien,
   men dannelses-stien (`createInitialBoardProfile`) kaldte `generateBoardGoals`
   uden `team`/`riders` og fik aldrig samme behandling.

## Fix
`ensureBoardGoalsCalibrated` kører EFTER allokeringen (samme post-allokerings-slot
som fase 1's `ensureSeasonIdentityBasis`) og recalibrerer det pending formations-
boards mål via den SAMME `generateBoardGoals` med trup-kontekst. Ingen ny tuning —
genbruger den kalibrering der allerede fandtes. Idempotent + defensiv (tom trup →
no-op) + ikke-fatal. Backfill af 15 eksisterende pending-boards (min_riders 15→9,
unreachable 11→0) verificeret mod prod, backup-tabel som rollback.

## Lære (forward-guard)
- **Kalibrering der afhænger af entity-state (her: truppen) skal køre EFTER at den
  state er etableret**, ikke ved en tidligere oprettelses-pind. Når en
  default/onboarding-værdi afhænger af noget der seedes senere i samme flow →
  recalibrér post-seed (eller reorder), ellers fryser default'en en tom-tilstand ind.
- **Når en fix retter ÉN sti (her #1267 på forhandlings-stien): søg efter parallelle
  kode-stier der producerer samme artefakt og omgår fixet.** `generateBoardGoals`
  havde to call-sites; kun den ene var kalibreret. `grep` på funktionens call-sites
  ved enhver kalibrerings-fix.
- Simulér-før-ship holdt: read-only dry-run mod ægte population (15 pending boards +
  syntetisk entry-hold) gav ejeren før/efter FØR både kode-ship og prod-backfill.
Relaterer [[2026-06-30-board-onboarding-hardcoded-to-season-1]] (fase 1's søster-bug)
+ feedback_match_ui_filter_for_capacity_logic + feedback_simulate_before_ship_balance.
