# FEATURE STATUS

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-feature-status.mjs`
> Flag-gate mod prod: `node scripts/check-feature-registry-flags.mjs`

77 poster: live 53 · beta 3 · dormant 5 · building 11 · spec 1 · idea 2 · retired 2. Tilstand afledes af kode og prod-flag, aldrig af prosa.

Epic-numre er issues i NicolaiDolmer/CyclingZone. Flag er noegler i prod `app_config`.
Live vises samlet (navn + dato) pr. omraade; fulde raekker (flag/SSOT/epic/note) er kun for ikke-live (#5430).

## race-engine

**live:** Form and fatigue in scoring (`form-and-fatigue`) 2026-09-06 · Race engine v3 (`race-engine-v3`) 2026-09-06 · v3 scoring components (`race-engine-v3-scoring`) 2026-09-06 · Resumable race finalisation (step markers) (`race-finalize-resumable`) 2026-09-25 · Async delivery of race result posts (`race-notify-outbox`) 2026-09-25 · Team selection, captain and breakaway (`team-selection-and-roles`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Race engine v4 (`race-engine-v4`) | dormant | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #3855 | 2026-09-07 | Off i prod (#4951). |
| Stage intention choice (`race-intention-choice`) | building | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #4632 | 2026-09-07 | UI live; effekt venter v4-flip. |

## race-day

**live:** Automatic race entries (`auto-entry-generator`) 2026-09-14 · Race day engine (`race-day-engine`) 2026-09-06 · Race page (`race-detail-page`) 2026-09-07 · Race page as tabs (v2) (`race-page-tabs-v2`) 2026-09-07 · Stage replay and timeline film (`race-replay`) 2026-09-06 · Stage scheduler (`stage-scheduler`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Race day development (`race-day-development`) | dormant | `race_day_development_enabled` | [PROGRESSION_RULES](PROGRESSION_RULES.md) | #4850 | 2026-09-24 | Variant A/S1 (etapens profil som mellem-pas, +1 pr. evne pr. løbsdag, planen ikke input; PR #5640 + #5654). Flippes off → on 28/9 sammen med training_tick_per_race_day, ejer-go. |

## market

**live:** Auctions with proxy bidding (`auctions`) 2026-09-06 · Direct transfers and offers (`direct-transfers`) 2026-09-06 · Rider swaps (`rider-swaps`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Market value blend sweep (`market-value-blend`) | dormant | `market_value_sweep_enabled` | [ECONOMY_RULES](ECONOMY_RULES.md) | #3448 | 2026-09-07 | Afventer ejer-go (#4449). |
| Rider value on the same abilities as the rating (`rider-valuation-v5`) | dormant | `rider_valuation_model` | [ECONOMY_RULES](ECONOMY_RULES.md) | #5443 | 2026-09-21 | PR #5446, nøglen står på v4. Ejer flipper til v5 + ekstraordinær kørsel (runbook 5443); lønnen har egen nøgle rider_production_value_model. |
| Auction entry gate (`auction-entry-gate`) | building | `auction_entry_gate_enabled` | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | - | 2026-09-06 | - |
| AI and unsolicited bids (`ai-unsolicited-bids`) | idea | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1310 | 2026-09-06 | Findes ikke i kode. |
| Rider loans (`rider-loans`) | retired | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1994 | 2026-09-06 | Afviklet; kun lån findes. |

## squad

**live:** Contracts, renewal and expiry (`contracts`) 2026-09-06 · Rider comparison and watchlist (`rider-compare-and-watchlist`) 2026-09-06 · Squad management (`squad-management`) 2026-09-06 · U23 team and Junior team pages (`youth-squad-pages`) 2026-09-26

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Rating shows best role now (`rider-rating-best-role-display`) | beta | `rider_best_role_display` | [ryttertype-visning-og-punch-loft-design](superpowers/specs/2026-09-11-ryttertype-visning-og-punch-loft-design.md) | #5435 | 2026-09-24 | Beta 24/9 kl. 19:05 (ejer: test med beta-testerne foerst); til alle sammen med vaerdiskiftet #5443/#5497 (ejer-gated). |
| Teamwork and Leadership abilities (`mental-abilities-teamwork-leadership`) | building | - | [holdarbejde-og-lederskab-evner-design](superpowers/specs/2026-09-15-holdarbejde-og-lederskab-evner-design.md) | #1177 | 2026-09-15 | Data-only (#5268), resten senere. |
| New riders' primary type from the target distribution (`rider-primary-type-from-distribution`) | building | - | [RIDER_GENERATION](RIDER_GENERATION.md) | #5327 | 2026-09-23 | Kontakt rider_primary_type_from_distribution (off) koblet paa start-trup, AI-hold og relaunch; flag-feltet saettes naar raekken er verificeret i prod efter merge. Flip er ejer-gated. |

## training

**live:** Daily training (`daily-training`) 2026-09-06 · Peak planner (`peak-planner`) 2026-09-06 · Season fatigue and form reset (`season-fatigue-reset`) 2026-09-06 · Hard sessions for cobbles, echelons and attacks (`training-hard-sessions-cobbles-echelon-attack`) 2026-09-15 · Training page on mobile (`training-mobile-table`) 2026-09-24 · Training score 1-99 (`training-score`) 2026-09-24

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Training tick per race day (`training-tick-per-race-day`) | building | - | [TRAINING_RULES](TRAINING_RULES.md) | #4846 | 2026-09-15 | A2 merget 15/9, flag off (§13.3). B4-udløser (samlet sweep ved dagens lukning) bygget bag samme flag; mangler ejer-flip. |
| Training tick system (`training-tick-system`) | building | - | [TRAINING_RULES](TRAINING_RULES.md) | #4850 | 2026-09-06 | - |

## academy

**live:** Academy (`academy`) 2026-09-06 · Sunday talent drip (`academy-sunday-drip`) 2026-09-06 · Intake offer expiry (`intake-offer-expiry`) 2026-09-06 · Scouting (`scout-system`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Academy intake pull (`academy-intake-pull`) | dormant | `academy_intake_pull_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | #3550 | 2026-09-07 | Erstatter søndagsdrip (#3550). |
| Season academy intake (`season-academy-intake`) | building | `season_academy_intake_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | - | 2026-09-06 | - |
| Three squads (`three-squads`) | spec | - | [YOUTH_RULES](YOUTH_RULES.md) | #2492 | 2026-09-06 | Slice 0 er leveret; resten er spec. |

## season

**live:** AI team retirement (`ai-team-retire`) 2026-09-06 · Season recap (`season-end-recap`) 2026-09-06 · Season signup (`season-signup`) 2026-09-24 · Season transition (`season-transition`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| AI pool retirement (`ai-pool-retirement-v2`) | building | - | - | - | 2026-09-09 | v2-flag: off, afventer ejer-go. |
| Season documentary (LLM) (`season-documentary-llm`) | building | `season_documentary_llm_enabled` | - | - | 2026-09-06 | - |

## economy

**live:** Youth squad upkeep switch at season change (`academy-drift-kill-switch`) 2026-09-25 · Automatic prize money (`auto-prize`) 2026-09-06 · Finance overview (`finance-overview`) 2026-09-06 · Bulk rider value writes (`rider-values-bulk-write`) 2026-09-06 · Sponsors (`sponsors`) 2026-09-06

## club

**live:** Facilities (`facilities`) 2026-09-06 · Staff (`staff`) 2026-09-06

## board

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Board mandate model (`board-mandate-model`) | beta | `board_mandate_model_enabled` | [BOARD_RULES](BOARD_RULES.md) | #3514 | 2026-09-06 | Mandat, vision, tillid, bonus, DNA. |
| Firing and season review (`board-firing-and-review`) | idea | - | [BOARD_RULES](BOARD_RULES.md) | - | 2026-09-06 | Findes ikke i kode. |

## social

**live:** Forum (`forum`) 2026-09-06 · Forum pulse (`forum-pulse`) 2026-09-06 · In-app notifications (`notifications`) 2026-09-06

## stats

**live:** Rider, manager and team profiles (`profiles`) 2026-09-06 · Results and race history (`results-archive`) 2026-09-06 · Standings and rankings (`standings-and-rankings`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Hall of Fame (`hall-of-fame`) | retired | - | - | #2359 | 2026-09-06 | Redirecter til /standings. |

## onboarding

**live:** First session onboarding (`onboarding-first-session`) 2026-09-06 · Season start guide (`season-start-guide`) 2026-09-06

## comms

**live:** Discord welcome inbox notification (`discord-welcome-inbox`) 2026-09-15 · In-app player survey (`in-app-survey`) 2026-09-08 · Manager-to-manager DM (`manager-dm-v1`) 2026-09-17

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Email retention loop (`email-loop`) | beta | - | [EMAIL_LOOP_GO_LIVE_RUNBOOK](EMAIL_LOOP_GO_LIVE_RUNBOOK.md) | #4616 | 2026-09-14 | Win-back afventer ejer-go (#2760). |

## billing

**live:** Alunta reconciliation (`alunta-reconcile`) 2026-09-06 · CZ Pro (`cz-pro`) 2026-09-06

## ops

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Rider reputation (`rider-reputation`) | building | `rider_reputation_enabled` | - | - | 2026-09-10 | - |
| Survey banner (`survey-banner`) | building | `survey_banner_enabled` | - | - | 2026-09-06 | - |
