# FEATURE STATUS

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-feature-status.mjs`
> Flag-gate mod prod: `node scripts/check-feature-registry-flags.mjs`

75 poster: live 46 · beta 4 · dormant 7 · building 13 · spec 1 · idea 2 · retired 2. Tilstand afledes af kode og prod-flag, aldrig af prosa.

Epic-numre er issues i NicolaiDolmer/CyclingZone. Flag er noegler i prod `app_config`.

## race-engine

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Form and fatigue in scoring (`form-and-fatigue`) | live | - | [TRAINING_RULES](TRAINING_RULES.md) | #2353 | 2026-09-06 | Reel vægt via formRaceWeightV3. |
| Race engine v3 (`race-engine-v3`) | live | `race_engine_v2_enabled` | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #1306 | 2026-09-06 | Autoritativ; flagnavn historisk. |
| v3 scoring components (`race-engine-v3-scoring`) | live | `race_engine_v3_scoring` | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #2353 | 2026-09-06 | 4 score-faktorer i raceSimulator. |
| Team selection, captain and breakaway (`team-selection-and-roles`) | live | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #1307 | 2026-09-06 | - |
| Race engine v4 (`race-engine-v4`) | dormant | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #3855 | 2026-09-07 | Off i prod (#4951). |
| Async delivery of race result posts (`race-notify-outbox`) | dormant | - | [3624-loebsforsinkelser](audits/2026-09-18-3624-loebsforsinkelser.md) | #3624 | 2026-09-18 | Off i prod; flip er ejer-only. |
| Stage intention choice (`race-intention-choice`) | building | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #4632 | 2026-09-07 | UI live; effekt venter v4-flip. |

## race-day

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Automatic race entries (`auto-entry-generator`) | live | `auto_entry_generator_enabled` | [CALENDAR_RULES](CALENDAR_RULES.md) | - | 2026-09-14 | late_fill (12t) #5136. |
| Race day engine (`race-day-engine`) | live | `race_day_engine_enabled` | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | - | 2026-09-06 | - |
| Race page (`race-detail-page`) | live | - | - | - | 2026-09-07 | Hero + faner (#4913). |
| Race page as tabs (v2) (`race-page-tabs-v2`) | live | - | - | #4613 | 2026-09-07 | PR #4913, 6/9; patch note 7.259. |
| Stage replay and timeline film (`race-replay`) | live | `race_stage_timeline` | - | - | 2026-09-06 | 3 replay-komponenter i UI. |
| Stage scheduler (`stage-scheduler`) | live | `stage_scheduler_enabled` | [CALENDAR_RULES](CALENDAR_RULES.md) | - | 2026-09-06 | - |
| Race day development (`race-day-development`) | dormant | `race_day_development_enabled` | [PROGRESSION_RULES](PROGRESSION_RULES.md) | #4850 | 2026-09-07 | Bygget (D2); afventer #4850. |

## market

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Auctions with proxy bidding (`auctions`) | live | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | - | 2026-09-06 | - |
| Direct transfers and offers (`direct-transfers`) | live | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | - | 2026-09-06 | - |
| Rider swaps (`rider-swaps`) | live | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | - | 2026-09-06 | Knap på profilen, ikke egen fane. |
| Market value blend sweep (`market-value-blend`) | dormant | `market_value_sweep_enabled` | [ECONOMY_RULES](ECONOMY_RULES.md) | #3448 | 2026-09-07 | Afventer ejer-go (#4449). |
| Rider value on the same abilities as the rating (`rider-valuation-v5`) | dormant | `rider_valuation_model` | [ECONOMY_RULES](ECONOMY_RULES.md) | #5443 | 2026-09-21 | PR #5446, nøglen står på v4. Ejer flipper til v5 + ekstraordinær kørsel (runbook 5443); lønnen har egen nøgle rider_production_value_model. |
| Auction entry gate (`auction-entry-gate`) | building | `auction_entry_gate_enabled` | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | - | 2026-09-06 | - |
| AI and unsolicited bids (`ai-unsolicited-bids`) | idea | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1310 | 2026-09-06 | Findes ikke i kode. |
| Rider loans (`rider-loans`) | retired | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1994 | 2026-09-06 | Afviklet; kun lån findes. |

## squad

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Contracts, renewal and expiry (`contracts`) | live | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1310 | 2026-09-06 | Tre kontrakt-stier ved sæsonskifte. |
| Rider comparison and watchlist (`rider-compare-and-watchlist`) | live | - | - | - | 2026-09-06 | - |
| Squad management (`squad-management`) | live | - | - | - | 2026-09-06 | 4 faner i TeamPage. |
| Teamwork and Leadership abilities (`mental-abilities-teamwork-leadership`) | building | - | [holdarbejde-og-lederskab-evner-design](superpowers/specs/2026-09-15-holdarbejde-og-lederskab-evner-design.md) | #1177 | 2026-09-15 | Data-only (#5268), resten senere. |
| New riders' primary type from the target distribution (`rider-primary-type-from-distribution`) | building | - | [RIDER_GENERATION](RIDER_GENERATION.md) | #5327 | 2026-09-23 | Kontakt rider_primary_type_from_distribution (off) koblet paa start-trup, AI-hold og relaunch; flag-feltet saettes naar raekken er verificeret i prod efter merge. Flip er ejer-gated. |
| Rating shows best role now (`rider-rating-best-role-display`) | building | `rider_best_role_display` | [ryttertype-visning-og-punch-loft-design](superpowers/specs/2026-09-11-ryttertype-visning-og-punch-loft-design.md) | #5435 | 2026-09-22 | Merget 22/9 (#5501), app_config-raekken verificeret off i prod; flippes med vaerdiskiftet #5443/#5497 (ejer-gated). |
| U23 team and Junior team pages (`youth-squad-pages`) | building | - | [HANDOFF](design/youth-tiers/HANDOFF.md) | #2492 | 2026-09-23 | Flag-noegle youth_squad_pages (#5519, default off); flyttes til flag-feltet naar app_config-raekken er applied efter merge. Ejer flipper efter visuelt go. |

## training

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Daily training (`daily-training`) | live | `daily_training_enabled` | [TRAINING_RULES](TRAINING_RULES.md) | - | 2026-09-06 | - |
| Peak planner (`peak-planner`) | live | `peak_planner_enabled` | [TRAINING_RULES](TRAINING_RULES.md) | #2224 | 2026-09-06 | - |
| Season fatigue and form reset (`season-fatigue-reset`) | live | `season_fatigue_reset_enabled` | [TRAINING_RULES](TRAINING_RULES.md) | - | 2026-09-06 | - |
| Hard sessions for cobbles, echelons and attacks (`training-hard-sessions-cobbles-echelon-attack`) | live | - | [TRAINING_RULES](TRAINING_RULES.md) | #4874 | 2026-09-15 | PR #5265; TRAINING_RULES §3.2. |
| Training page on mobile (`training-mobile-table`) | beta | - | [TRAINING_RULES](TRAINING_RULES.md) | #3643 | 2026-09-19 | Flag training_mobile_table; sat naar raekken er i prod. |
| Training score 1-99 (`training-score`) | beta | `training_score_visible` | [TRAINING_RULES](TRAINING_RULES.md) | #4851 | 2026-09-21 | Flag beta. Graf, mobilside, tooltip og UI-test rettet 21/9 (#5451, #5453); mangler ejer-flip til alle. |
| Training tick per race day (`training-tick-per-race-day`) | building | - | [TRAINING_RULES](TRAINING_RULES.md) | #4846 | 2026-09-15 | A2 merget 15/9, flag off (§13.3). B4-udløser (samlet sweep ved dagens lukning) bygget bag samme flag; mangler ejer-flip. |
| Training tick system (`training-tick-system`) | building | - | [TRAINING_RULES](TRAINING_RULES.md) | #4850 | 2026-09-06 | - |

## academy

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Academy (`academy`) | live | `academy_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | #932 | 2026-09-06 | - |
| Sunday talent drip (`academy-sunday-drip`) | live | - | [YOUTH_RULES](YOUTH_RULES.md) | #2064 | 2026-09-06 | - |
| Intake offer expiry (`intake-offer-expiry`) | live | `intake_offer_expiry_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | - | 2026-09-06 | - |
| Scouting (`scout-system`) | live | `scout_system_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | - | 2026-09-06 | - |
| Academy intake pull (`academy-intake-pull`) | dormant | `academy_intake_pull_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | #3550 | 2026-09-07 | Erstatter søndagsdrip (#3550). |
| Season academy intake (`season-academy-intake`) | building | `season_academy_intake_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | - | 2026-09-06 | - |
| Three squads (`three-squads`) | spec | - | [YOUTH_RULES](YOUTH_RULES.md) | #2492 | 2026-09-06 | Slice 0 er leveret; resten er spec. |

## season

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| AI team retirement (`ai-team-retire`) | live | `ai_team_retire_enabled` | - | - | 2026-09-06 | On; v2 kræver særskilt go. |
| Season recap (`season-end-recap`) | live | - | - | #1311 | 2026-09-06 | SeasonEndPage m. recap. |
| Season transition (`season-transition`) | live | - | [SEASON_TRANSITION_CHECKLIST](SEASON_TRANSITION_CHECKLIST.md) | - | 2026-09-06 | - |
| Season signup (`season-signup`) | dormant | `season_signup_enabled` | [CALENDAR_RULES](CALENDAR_RULES.md) | - | 2026-09-07 | Dormant til S4-cutover (#452). |
| AI pool retirement (`ai-pool-retirement-v2`) | building | - | - | - | 2026-09-09 | v2-flag: off, afventer ejer-go. |
| Season documentary (LLM) (`season-documentary-llm`) | building | `season_documentary_llm_enabled` | - | - | 2026-09-06 | - |

## economy

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Automatic prize money (`auto-prize`) | live | `auto_prize_enabled` | [ECONOMY_RULES](ECONOMY_RULES.md) | - | 2026-09-06 | - |
| Finance overview (`finance-overview`) | live | - | [ECONOMY_RULES](ECONOMY_RULES.md) | - | 2026-09-06 | - |
| Bulk rider value writes (`rider-values-bulk-write`) | live | `rider_values_bulk_write_enabled` | [ECONOMY_RULES](ECONOMY_RULES.md) | - | 2026-09-06 | - |
| Sponsors (`sponsors`) | live | - | [SPONSOR_RULES](SPONSOR_RULES.md) | #1663 | 2026-09-06 | Fase 2 er live. |

## club

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Facilities (`facilities`) | live | `facilities_enabled` | - | - | 2026-09-06 | Træning/scouting live, resten ikke. |
| Staff (`staff`) | live | - | - | - | 2026-09-06 | - |

## board

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Board mandate model (`board-mandate-model`) | beta | `board_mandate_model_enabled` | [BOARD_RULES](BOARD_RULES.md) | #3514 | 2026-09-06 | Mandat, vision, tillid, bonus, DNA. |
| Firing and season review (`board-firing-and-review`) | idea | - | [BOARD_RULES](BOARD_RULES.md) | - | 2026-09-06 | Findes ikke i kode. |

## social

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Forum (`forum`) | live | - | [FORUM_RULES](FORUM_RULES.md) | #3199 | 2026-09-06 | - |
| Forum pulse (`forum-pulse`) | live | - | [FORUM_RULES](FORUM_RULES.md) | #4238 | 2026-09-06 | - |
| In-app notifications (`notifications`) | live | - | [SOCIAL_RULES](SOCIAL_RULES.md) | - | 2026-09-06 | ~55 typer, notificationTypes.js. |

## stats

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Rider, manager and team profiles (`profiles`) | live | - | - | - | 2026-09-06 | - |
| Results and race history (`results-archive`) | live | - | - | - | 2026-09-06 | 3 historik-sider. |
| Standings and rankings (`standings-and-rankings`) | live | - | - | - | 2026-09-06 | - |
| Hall of Fame (`hall-of-fame`) | retired | - | - | #2359 | 2026-09-06 | Redirecter til /standings. |

## onboarding

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| First session onboarding (`onboarding-first-session`) | live | - | - | - | 2026-09-06 | ProgressCard + Tour, 3 sider. |
| Season start guide (`season-start-guide`) | live | - | - | - | 2026-09-06 | - |

## comms

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Discord welcome inbox notification (`discord-welcome-inbox`) | live | - | - | #5130 | 2026-09-15 | PR #5211, 15/9; hold backfillet. |
| In-app player survey (`in-app-survey`) | live | - | [SURVEY_SYSTEM](SURVEY_SYSTEM.md) | #4943 | 2026-09-08 | Skemaet åbnet 8/9 (241 inviteret). |
| Manager-to-manager DM (`manager-dm-v1`) | live | - | [manager-dm-v1-design](superpowers/specs/2026-09-08-manager-dm-v1-design.md) | #5019 | 2026-09-17 | PR #5019, 8/9; ingen flag. |
| Email retention loop (`email-loop`) | beta | - | [EMAIL_LOOP_GO_LIVE_RUNBOOK](EMAIL_LOOP_GO_LIVE_RUNBOOK.md) | #4616 | 2026-09-14 | Win-back afventer ejer-go (#2760). |

## billing

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Alunta reconciliation (`alunta-reconcile`) | live | `alunta_reconcile_enabled` | [ALUNTA_OPS](ALUNTA_OPS.md) | - | 2026-09-06 | - |
| CZ Pro (`cz-pro`) | live | - | [BILLING_STACK](BILLING_STACK.md) | - | 2026-09-06 | Live; EUR-checkout åbent (#4616). |

## ops

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Rider reputation (`rider-reputation`) | building | `rider_reputation_enabled` | - | - | 2026-09-10 | - |
| Survey banner (`survey-banner`) | building | `survey_banner_enabled` | - | - | 2026-09-06 | - |
