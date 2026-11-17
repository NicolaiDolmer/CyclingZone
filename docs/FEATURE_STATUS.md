# FEATURE STATUS

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-feature-status.mjs`
> Flag-gate mod prod: `node scripts/check-feature-registry-flags.mjs`

155 poster: live 119 · beta 1 · dormant 10 · building 15 · spec 1 · idea 2 · retired 7. Tilstand afledes af kode og prod-flag, aldrig af prosa.

Epic-numre er issues i NicolaiDolmer/CyclingZone. Flag er noegler i prod `app_config`.
Live vises samlet (navn + dato) pr. omraade; fulde raekker (flag/SSOT/epic/note) er kun for ikke-live (#5430).
Arkiv = live verificeret over 14 dage foer registrets nyeste dato: kun id (#5319).

## race-engine

**live:** Luxury helper (`luxury-helper-role`) 2026-11-02 · All out on the decisive climb (`race-all-out-7280`) 2026-11-02 · Day form in words after the stage (`race-day-words-7725`) 2026-11-08 · Stage intention choice (`race-intention-choice`) 2026-11-02 · Time trials without the extra day roll (`race-itt-no-day-roll-7726`) 2026-11-06 · The chase is decided by the teams chasing (`race-team-chase-7730`) 2026-11-06

**arkiv:** `form-and-fatigue` · `race-day-form-6649` · `race-descent-task-7380` · `race-engine-profile-hills` · `race-engine-s5-profiles` · `race-engine-v3` · `race-engine-v3-scoring` · `race-engine-v4` · `race-final-km-boundary-7383` · `race-finalize-resumable` · `race-form-peaks` · `race-itt-save-7332` · `race-itt-terrain-6595` · `race-notify-outbox` · `team-selection-and-roles`

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|Long descent chase cap (`race-descent-regroup-cap-7644`)|dormant|`descent_regroup_cap_7644`|[RACE_ENGINE_RULES](RACE_ENGINE_RULES.md)|#7644|2026-11-04|Slukket; tændes af ejeren.|
|Jersey hunt in the stage plan (`race-jersey-hunt-7855`)|dormant|`jersey_hunt_7855`|[RACE_ENGINE_RULES](RACE_ENGINE_RULES.md)|#7855|2026-11-13|Off i prod 13/11 (#8052); ejer tænder, efter dommer.|
|Tired riders can miss the time limit, with a warning (`race-time-limit-fatigue-7715`)|building|-|[RACE_ENGINE_RULES](RACE_ENGINE_RULES.md)|#7715|2026-11-07|Nøgle time_limit_fatigue_7715 uden række (off).|
|Official time persistence revision (`race-official-times-v1`)|retired|-|[RACE_ENGINE_RULES](RACE_ENGINE_RULES.md)|#6284|2026-10-16|Frosset prototype.|

## race-day

**live:** Stage replay and timeline film (`race-replay`) 2026-11-04 · Why? button beside riders in Your day (`rider-why-button`) 2026-11-05 · Team plans (`tactics-ready`) 2026-11-13

**arkiv:** `auto-entry-generator` · `race-day-development` · `race-day-engine` · `race-detail-page` · `race-page-tabs-v2` · `role-scope-choice` · `stage-page-v2` · `stage-plan-v1` · `stage-scheduler`

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|Race page v6, step 1 (results for a ridden stage) (`race-page-v6`)|building|`race_page_v6`|[RACE_ENGINE_RULES](RACE_ENGINE_RULES.md)|#7778|2026-11-13|#7778: trin 1 af 5 bygget; off i prod.|
|Spoiler shield (`spoiler-shield`)|building|`spoiler_shield_7859`|[RACE_ENGINE_RULES](RACE_ENGINE_RULES.md)|#7778|2026-11-16|#7859: seedes off.|
|Engine breakaway forecast (`race-breakaway-outlook`)|retired|-|[RACE_ENGINE_RULES](RACE_ENGINE_RULES.md)|#6912|2026-11-13|Fjernet 13/11 (ejer); kode i #7277/#7343.|

## market

**live:** Auto-accept price (`market-auto-accept`) 2026-11-15 · Bid commitment gate (`market-commitment`) 2026-11-12 · Sale escrow (`sale-escrow`) 2026-11-15

**arkiv:** `auctions` · `direct-transfers` · `rider-swaps` · `rider-valuation-v5`

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|Release waits for the end of a stage race (`release-defer-stage-race`)|building|-|[TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md)|#8153|2026-11-15|release_defer_8153 (seed off) følger migrationen; slukket = som i dag.|
|AI and unsolicited bids (`ai-unsolicited-bids`)|idea|-|[TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md)|#1310|2026-09-06|Findes ikke i kode.|
|Market value blend sweep (`market-value-blend`)|retired|-|[ECONOMY_RULES](ECONOMY_RULES.md)|#3448|2026-10-15|Afløst af v6 (#4449).|
|Rider loans (`rider-loans`)|retired|-|[TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md)|#1994|2026-09-06|Afviklet; kun lån findes.|

## squad

**live:** Champion jerseys beside rider names (`champion-jerseys`) 2026-11-07 · Rider card (`rider-hover-card`) 2026-11-11 · Talent marks (`talent-marks`) 2026-11-07

**arkiv:** `contracts` · `rider-compare-and-watchlist` · `rider-rating-best-role-display` · `squad-management` · `youth-squad-pages`

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|Teamwork and Leadership abilities (`mental-abilities-teamwork-leadership`)|building|-|[holdarbejde-og-lederskab-evner-design](superpowers/specs/2026-09-15-holdarbejde-og-lederskab-evner-design.md)|#1177|2026-11-04|Kun data bygget (#5268); motor (#5348), mentorpar (#5349) mangler.|
|New riders' primary type (`rider-primary-type-from-distribution`)|building|-|[RIDER_GENERATION](RIDER_GENERATION.md)|#5327|2026-09-23|Kontakt (off); flip er ejer-gated.|

## training

**live:** Race date as full training day (`condition-v2-race-date-training-day`) 2026-11-04 · Same potential band everywhere (`potential-single-number`) 2026-11-04 · Train now straight away (`train-now-instant`) 2026-11-16 · Train now B (`train-now-whole-day`) 2026-11-02 · Bulk training day (`training-bulk-day`) 2026-11-02 · Train now (no bonus) (`training-train-now`) 2026-11-13

**arkiv:** `ability-cap-per-date` · `condition-model-v2` · `daily-training` · `development-curve-b` · `peak-planner` · `race-day-role-yield` · `season-fatigue-reset` · `training-catalog-v3` · `training-condition-per-date` · `training-daily-receipt` · `training-decision-card` · `training-fatigue-rules` · `training-groups` · `training-hard-sessions-cobbles-echelon-attack` · `training-mobile-table` · `training-program-cells` · `training-programs` · `training-score` · `training-tick-per-race-day` · `training-tick-system`

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|Train now bonus (`train-now-bonus`)|beta|`training_train_now_bonus`|[TRAINING_RULES](TRAINING_RULES.md)|#7737|2026-11-16|Beta i prod (#8268, 16/11): kun beta-testeres egne tryk. "on" kræver ejer-go.|
|Development Score B in the engine (`development-score-b-engine`)|dormant|`development_score_v2`|[TRAINING_RULES](TRAINING_RULES.md)|#6110|2026-11-13|Parkeret (ejer 31/10) til Udvikling 2.0. Aldrig samtidig med XP. Før tænding: #7584.|
|Development XP (`development-xp-model`)|dormant|`development_xp_model`|[TRAINING_RULES](TRAINING_RULES.md)|#6110|2026-11-13|Off i prod 13/11 (#8041); ejer tænder, efter dommer + development_xp_from_date.|
|One potential source (`potential-estimate-display`)|dormant|`potential_estimate_display`|[6110-potentiale-et-tal-samlet-design](superpowers/specs/2026-10-23-6110-potentiale-et-tal-samlet-design.md)|#6110|2026-11-05|Trin 4 (#7684): fladerne læser potentialEstimateRead.js, når flaget er på.|
|Catch-up via racing (`race-day-catchup`)|dormant|`race_day_catchup_enabled`|[TRAINING_RULES](TRAINING_RULES.md)|#6950|2026-10-25|Ejer, med Udvikling 2.0.|
|Race day role base day (`race-day-role-base-day`)|dormant|`race_day_role_base_day_enabled`|[TRAINING_RULES](TRAINING_RULES.md)|#6110|2026-11-03|#5950 løsning A (ejer 3/11), underkontakt til race-day-role-yield. Off.|
|Stored potential estimates (`potential-estimate-writes`)|building|-|[6110-potentiale-et-tal-samlet-design](superpowers/specs/2026-10-23-6110-potentiale-et-tal-samlet-design.md)|#6110|2026-11-05|Trin 5 (#7685): søndagsjob, holdskifte og nye kig; flaget seedes off.|
|Injuries heal over the off-season (`season-injury-reset`)|building|`season_injury_reset_mode`|[TRAINING_RULES](TRAINING_RULES.md)|#5865|2026-11-16|Bag season_injury_reset_mode = off; ejer vælger clear/cap/light før S6.|
|Race session settles when the stage is decided (`settle-race-session-after-stage`)|building|-|[TRAINING_RULES](TRAINING_RULES.md)|#7982|2026-11-15|Off i prod 15/11 (#8195). Kun med fatigue_now_7801 (ejer). Skærmdelen mangler.|
|Fatigue now counts today's earlier stages (`training-fatigue-now-7801`)|building|-|[TRAINING_RULES](TRAINING_RULES.md)|#7801|2026-11-13|fatigue_now_7801 ikke i prod app_config (13/11) = slukket; ejer tænder.|

## academy

**arkiv:** `academy` · `academy-intake-pull` · `academy-pull-reminder` · `academy-sunday-drip` · `intake-offer-expiry` · `promotion-pending` · `scout-system`

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|AI academy pull (`academy-ai-weekly-pull`)|dormant|-|[YOUTH_RULES](YOUTH_RULES.md)|#6666|2026-10-25|Flag academy_ai_weekly_pull_enabled; ikke nu.|
|Season academy intake (`season-academy-intake`)|dormant|`season_academy_intake_enabled`|[YOUTH_RULES](YOUTH_RULES.md)|#2911|2026-10-15|Sikkerhedsventil (#2911); off i prod, ejer flipper.|
|Academy page with tabs and age focus (`academy-page-v2-8081`)|building|-|[YOUTH_RULES](YOUTH_RULES.md)|#8081|2026-11-16|Slukket; trækket læser ikke aldersfokus.|
|Three squads (`three-squads`)|spec|-|[YOUTH_RULES](YOUTH_RULES.md)|#2492|2026-09-06|Slice 0 er leveret; resten er spec.|

## season

**arkiv:** `ai-pool-retirement-v2` · `ai-team-retire` · `development-v2-aging` · `season-end-recap` · `season-matrix-mobile` · `season-signup` · `season-transition`

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|Auto-generated season calendar (`auto-calendar`)|building|-|[CALENDAR_RULES](CALENDAR_RULES.md)|-|2026-11-13|Ingen række i prod (= off). Ejer 13/11: spørg igen mandag 16/11.|
|One planning page (`planning-workbench`)|building|-|[PLANNING_CENTER_RULES](PLANNING_CENTER_RULES.md)|#7535|2026-11-14|Kontakt planning_workbench ikke seedet = slukket.|
|Season documentary (LLM) (`season-documentary-llm`)|building|`season_documentary_llm_enabled`|-|-|2026-09-06|-|
|Automatic season transition cron (`season-auto-transition`)|retired|-|[SEASON_CUTOVER_RUNBOOK](SEASON_CUTOVER_RUNBOOK.md)|#1155|2026-10-17|Fjernet 17/10 (#6796); sæsonskiftet er manuelt.|

## economy

**arkiv:** `auto-prize` · `economy-no-upkeep` · `finance-overview` · `rider-values-bulk-write` · `sponsors` · `upkeep-per-race-day`

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|Youth squad upkeep switch at season change (`academy-drift-kill-switch`)|dormant|`academy_drift_enabled`|[SEASON_CUTOVER_RUNBOOK](SEASON_CUTOVER_RUNBOOK.md)|#5741|2026-10-26|B 18/10 (#6775): slukket i S5. Hjælp må ikke love drift.|

## club

**arkiv:** `facilities` · `staff`

## board

**live:** Board mandate model (`board-mandate-model`) 2026-11-13

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|Firing and season review (`board-firing-and-review`)|idea|-|[BOARD_RULES](BOARD_RULES.md)|-|2026-09-06|Findes ikke i kode.|

## social

**arkiv:** `forum` · `forum-pulse` · `notifications`

## stats

**live:** Calendar race card and race history library (`race-library-v2`) 2026-11-03 · Independent ranking shadow pass (`ranking-shadow-decoupled`) 2026-11-14

**arkiv:** `profiles` · `results-archive` · `standings-and-rankings`

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|Hall of Fame (`hall-of-fame`)|retired|-|-|#2359|2026-09-06|Redirecter til /standings.|

## onboarding

**arkiv:** `first-race-card` · `onboarding-first-session` · `season-start-guide`

## comms

**arkiv:** `discord-welcome-inbox` · `email-loop` · `in-app-survey` · `manager-dm-v1` · `push-notifications` · `roadmap-hub`

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|Patch notes by area, week by week (`patch-notes-v2`)|building|-|[PATCH_NOTES_RULES](PATCH_NOTES_RULES.md)|#954|2026-11-16|Bag patch_notes_v2_8049, slukket.|

## billing

**arkiv:** `alunta-reconcile` · `cz-pro`

## ops

**live:** Discord bot DM switch (`discord-player-dm-switch`) 2026-11-13

**arkiv:** `ranking-shadow` · `rider-reputation`

|Feature|State|Flag|SSOT|Epic|Verified|Note|
|-|-|-|-|-|-|-|
|Survey banner (`survey-banner`)|retired|-|-|#2467|2026-10-15|SurveyBanner.jsx slettet (#2467).|
