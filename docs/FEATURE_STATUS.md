# FEATURE STATUS

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-feature-status.mjs`
> Flag-gate mod prod: `node scripts/check-feature-registry-flags.mjs`

93 poster: live 72 · beta 2 · dormant 6 · building 6 · spec 1 · idea 2 · retired 4. Tilstand afledes af kode og prod-flag, aldrig af prosa.

Epic-numre er issues i NicolaiDolmer/CyclingZone. Flag er noegler i prod `app_config`.
Live vises samlet (navn + dato) pr. omraade; fulde raekker (flag/SSOT/epic/note) er kun for ikke-live (#5430).

## race-engine

**live:** Form and fatigue in scoring (`form-and-fatigue`) 2026-09-06 · Race engine v3 (`race-engine-v3`) 2026-10-04 · v3 scoring components (`race-engine-v3-scoring`) 2026-10-04 · Race engine v4 (`race-engine-v4`) 2026-10-04 · Resumable race finalisation (step markers) (`race-finalize-resumable`) 2026-09-25 · Async delivery of race result posts (`race-notify-outbox`) 2026-09-25 · Team selection, captain and breakaway (`team-selection-and-roles`) 2026-09-30

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Stage intention choice (`race-intention-choice`) | building | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #6641 | 2026-10-15 | UI live; v4 er on, men flaget race_day_intention_enabled findes ikke i prod (læst 15/10). Kalibrering + beta i #6641. |
| Official time persistence revision (`race-official-times-v1`) | building | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #6284 | 2026-10-15 | official_times_v1 er nu en frosset prototype; linjen fortsætter i official_times_v2-v4 (timeModel.ts, segmentLoop.ts). Prod 15/10: løb bundet til v2, v3 og v4 (flest v4) via races.engine_rules_revision (#6642). |

## race-day

**live:** Automatic race entries (`auto-entry-generator`) 2026-09-14 · Race day development (`race-day-development`) 2026-09-28 · Race day engine (`race-day-engine`) 2026-09-06 · Race page (`race-detail-page`) 2026-09-07 · Race page as tabs (v2) (`race-page-tabs-v2`) 2026-09-07 · Stage replay and timeline film (`race-replay`) 2026-09-06 · Role picker scope (stage N to the end / stage N only) (`role-scope-choice`) 2026-10-06 · Stage scheduler (`stage-scheduler`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Stage page 2.0 (stage tabs, real elevation profile, your day) (`stage-page-v2`) | beta | `stage_page_v2` | - | #6570 | 2026-10-15 | PR #6633; beta siden 15/10 efter ejer-go (læst i prod 15/10). |

## market

**live:** Auctions with proxy bidding (`auctions`) 2026-09-06 · Direct transfers and offers (`direct-transfers`) 2026-09-06 · Rider swaps (`rider-swaps`) 2026-09-06 · Rider value on the same abilities as the rating (`rider-valuation-v5`) 2026-10-04

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Auction entry gate (`auction-entry-gate`) | dormant | `auction_entry_gate_enabled` | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #3134 | 2026-10-15 | Bygget; #3134 lukket af ejeren 18/8. Flaget står false i prod (læst 15/10); kun ejeren flipper. |
| AI and unsolicited bids (`ai-unsolicited-bids`) | idea | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1310 | 2026-09-06 | Findes ikke i kode. |
| Market value blend sweep (`market-value-blend`) | retired | - | [ECONOMY_RULES](ECONOMY_RULES.md) | #3448 | 2026-10-15 | Afløst af værdimodel v6 (#4449 lukket af ejeren 12/10); sweep-koden fjernet i #6642. app_config-rækken market_value_sweep_enabled står stadig off. |
| Rider loans (`rider-loans`) | retired | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1994 | 2026-09-06 | Afviklet; kun lån findes. |

## squad

**live:** Contracts, renewal and expiry (`contracts`) 2026-09-06 · Rider comparison and watchlist (`rider-compare-and-watchlist`) 2026-09-06 · Rating shows best role now (`rider-rating-best-role-display`) 2026-09-27 · Squad management (`squad-management`) 2026-09-06 · U23 team and Junior team pages (`youth-squad-pages`) 2026-09-26

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Teamwork and Leadership abilities (`mental-abilities-teamwork-leadership`) | building | - | [holdarbejde-og-lederskab-evner-design](superpowers/specs/2026-09-15-holdarbejde-og-lederskab-evner-design.md) | #1177 | 2026-09-15 | Data-only (#5268), resten senere. |
| New riders' primary type from the target distribution (`rider-primary-type-from-distribution`) | building | - | [RIDER_GENERATION](RIDER_GENERATION.md) | #5327 | 2026-09-23 | Kontakt rider_primary_type_from_distribution (off) koblet paa start-trup, AI-hold og relaunch; flag-feltet saettes naar raekken er verificeret i prod efter merge. Flip er ejer-gated. |

## training

**live:** Daily training (`daily-training`) 2026-09-06 · Peak planner (`peak-planner`) 2026-10-04 · Season fatigue and form reset (`season-fatigue-reset`) 2026-09-06 · Daily rider training receipt (`training-daily-receipt`) 2026-10-04 · Fatigue limit (player-set rules) (`training-fatigue-rules`) 2026-10-04 · Training groups (`training-groups`) 2026-10-14 · Hard sessions for cobbles, echelons and attacks (`training-hard-sessions-cobbles-echelon-attack`) 2026-09-15 · Training page on mobile (`training-mobile-table`) 2026-09-24 · Training cells per race day (35 cells) (`training-program-cells`) 2026-10-04 · Training programs per race day (`training-programs`) 2026-10-14 · Training score 1-99 (`training-score`) 2026-09-24 · Training tick per race day (`training-tick-per-race-day`) 2026-09-28 · Train now (no bonus) (`training-train-now`) 2026-10-14

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Set the training day for several riders at once (`training-bulk-day`) | beta | `training_bulk_day` | [TRAINING_RULES](TRAINING_RULES.md) | #6523 | 2026-10-15 | PR #6533 (12/10); beta siden 15/10 10:16 UTC efter ejer-go på før/efter-billedet (læst tilbage i prod). |
| Training tick system (`training-tick-system`) | building | - | [TRAINING_RULES](TRAINING_RULES.md) | #4850 | 2026-09-06 | - |

## academy

**live:** Academy (`academy`) 2026-09-06 · Sunday talent drip (`academy-sunday-drip`) 2026-09-06 · Intake offer expiry (`intake-offer-expiry`) 2026-09-06 · Scouting (`scout-system`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Academy intake pull (`academy-intake-pull`) | dormant | `academy_intake_pull_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | #3550 | 2026-09-07 | Erstatter søndagsdrip (#3550). |
| Season academy intake (`season-academy-intake`) | dormant | `season_academy_intake_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | #2911 | 2026-10-15 | Sikkerhedsventil efter ejer-beslutning (#2911); off i prod (læst 15/10), kun ejeren flipper. |
| Three squads (`three-squads`) | spec | - | [YOUTH_RULES](YOUTH_RULES.md) | #2492 | 2026-09-06 | Slice 0 er leveret; resten er spec. |

## season

**live:** AI pool retirement (`ai-pool-retirement-v2`) 2026-10-15 · AI team retirement (`ai-team-retire`) 2026-09-06 · Season recap (`season-end-recap`) 2026-09-06 · Season matrix on mobile (`season-matrix-mobile`) 2026-10-06 · Season signup (`season-signup`) 2026-09-24 · Season transition (`season-transition`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Development 2.0 part 1 (decline at season change, only manager teams develop) (`development-v2-aging`) | dormant | `development_v2_aging_enabled` | - | #6499 | 2026-10-15 | PR #6501 (11/10); off i prod (læst 15/10). Fail-safe off, beta læses som off; kun ejeren flipper. |
| Season documentary (LLM) (`season-documentary-llm`) | building | `season_documentary_llm_enabled` | - | - | 2026-09-06 | - |

## economy

**live:** Automatic prize money (`auto-prize`) 2026-09-06 · Finance overview (`finance-overview`) 2026-09-06 · Bulk rider value writes (`rider-values-bulk-write`) 2026-09-06 · Sponsors (`sponsors`) 2026-09-06 · Upkeep paid per senior race day (Travel & staff) (`upkeep-per-race-day`) 2026-09-27

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Youth squad upkeep switch at season change (`academy-drift-kill-switch`) | dormant | `academy_drift_enabled` | [SEASON_CUTOVER_RUNBOOK](SEASON_CUTOVER_RUNBOOK.md) | #5741 | 2026-09-28 | Off målt read-only i prod 28/9 efter S3→S4-cutover; fremtidig sats og nyt flip afventer ejerbeslutning. |

## club

**live:** Facilities (`facilities`) 2026-09-06 · Staff (`staff`) 2026-09-06

## board

**live:** Board mandate model (`board-mandate-model`) 2026-09-28

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Firing and season review (`board-firing-and-review`) | idea | - | [BOARD_RULES](BOARD_RULES.md) | - | 2026-09-06 | Findes ikke i kode. |

## social

**live:** Forum (`forum`) 2026-09-06 · Forum pulse (`forum-pulse`) 2026-09-06 · In-app notifications (`notifications`) 2026-09-06

## stats

**live:** Rider, manager and team profiles (`profiles`) 2026-09-06 · Results and race history (`results-archive`) 2026-09-06 · Standings and rankings (`standings-and-rankings`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Hall of Fame (`hall-of-fame`) | retired | - | - | #2359 | 2026-09-06 | Redirecter til /standings. |

## onboarding

**live:** Your first race card on the dashboard (new teams) (`first-race-card`) 2026-10-15 · First session onboarding (`onboarding-first-session`) 2026-09-06 · Season start guide (`season-start-guide`) 2026-09-06

## comms

**live:** Discord welcome inbox notification (`discord-welcome-inbox`) 2026-09-15 · Email retention loop (`email-loop`) 2026-10-15 · In-app player survey (`in-app-survey`) 2026-09-08 · Manager-to-manager DM (`manager-dm-v1`) 2026-09-17 · Roadmap hub (five tabs) (`roadmap-hub`) 2026-10-04

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Push notifications (`push-notifications`) | dormant | `push_enabled` | - | #6590 | 2026-10-15 | PR #6591 (14/10) bag slukket flag; off i prod (læst 15/10), kun ejeren flipper. |

## billing

**live:** Alunta reconciliation (`alunta-reconcile`) 2026-09-06 · CZ Pro (`cz-pro`) 2026-09-06

## ops

**live:** Rider reputation (`rider-reputation`) 2026-10-04

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Survey banner (`survey-banner`) | retired | - | - | #2467 | 2026-10-15 | SurveyBanner.jsx slettet (#2467); kun seed-rækkerne survey_banner_enabled/survey_banner_url står tilbage i app_config. |
