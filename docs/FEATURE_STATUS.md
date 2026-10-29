# FEATURE STATUS

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-feature-status.mjs`
> Flag-gate mod prod: `node scripts/check-feature-registry-flags.mjs`

<<<<<<< HEAD
118 poster: live 93 · dormant 7 · building 9 · spec 1 · idea 2 · retired 6. Tilstand afledes af kode og prod-flag, aldrig af prosa.
=======
117 poster: live 92 · dormant 7 · building 9 · spec 1 · idea 2 · retired 6. Tilstand afledes af kode og prod-flag, aldrig af prosa.
>>>>>>> origin/main

Epic-numre er issues i NicolaiDolmer/CyclingZone. Flag er noegler i prod `app_config`.
Live vises samlet (navn + dato) pr. omraade; fulde raekker (flag/SSOT/epic/note) er kun for ikke-live (#5430).

## race-engine

**live:** Form and fatigue in scoring (`form-and-fatigue`) 2026-09-06 · All out on the decisive climb (`race-all-out-7280`) 2026-10-27 · Profile hills in the race engine (`race-engine-profile-hills`) 2026-10-28 · S5 engine rules (s5_profiles_v3) (`race-engine-s5-profiles`) 2026-10-26 · Race engine v3 (`race-engine-v3`) 2026-10-04 · v3 scoring components (`race-engine-v3-scoring`) 2026-10-04 · Race engine v4 (`race-engine-v4`) 2026-10-04 · Resumable race finalisation (step markers) (`race-finalize-resumable`) 2026-09-25 · Form peaks in races (`race-form-peaks`) 2026-10-27 · Stage intention choice (`race-intention-choice`) 2026-10-27 · Async delivery of race result posts (`race-notify-outbox`) 2026-09-25 · Team selection, captain and breakaway (`team-selection-and-roles`) 2026-09-30

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Luxury helper (`luxury-helper-role`) | building | - | - | #5982 | 2026-10-27 | - |
| Day form with causes (`race-day-form-6649`) | building | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #6649 | 2026-10-27 | Tændes med ejer-go. |
| Official time persistence revision (`race-official-times-v1`) | retired | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #6284 | 2026-10-16 | Frosset prototype. |

## race-day

**live:** Automatic race entries (`auto-entry-generator`) 2026-09-14 · Race day development (`race-day-development`) 2026-09-28 · Race day engine (`race-day-engine`) 2026-09-06 · Race page (`race-detail-page`) 2026-09-07 · Race page as tabs (v2) (`race-page-tabs-v2`) 2026-09-07 · Stage replay and timeline film (`race-replay`) 2026-09-06 · Role picker scope (stage N to the end / stage N only) (`role-scope-choice`) 2026-10-06 · Stage page 2.0 (stage tabs, real elevation profile, your day) (`stage-page-v2`) 2026-10-24 · Stage plan along the route (`stage-plan-v1`) 2026-10-27 · Stage scheduler (`stage-scheduler`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Engine breakaway forecast (`race-breakaway-outlook`) | building | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #6912 | 2026-10-29 | Stadie-flag race_breakaway_outlook (off, beta eller on) har ingen app_config-række; fravær = off. Tænding og regnekraft er et separat ejer-go (#7277). |

## market

**live:** Auctions with proxy bidding (`auctions`) 2026-09-06 · Direct transfers and offers (`direct-transfers`) 2026-09-06 · Rider swaps (`rider-swaps`) 2026-09-06 · Rider value on the same abilities as the rating (`rider-valuation-v5`) 2026-10-04

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Auction entry gate (`auction-entry-gate`) | dormant | `auction_entry_gate_enabled` | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #3134 | 2026-10-15 | Bygget; #3134 lukket af ejeren 18/8. Flaget står false i prod (læst 15/10); kun ejeren flipper. |
| AI and unsolicited bids (`ai-unsolicited-bids`) | idea | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1310 | 2026-09-06 | Findes ikke i kode. |
| Market value blend sweep (`market-value-blend`) | retired | - | [ECONOMY_RULES](ECONOMY_RULES.md) | #3448 | 2026-10-15 | Afløst af v6 (#4449). |
| Rider loans (`rider-loans`) | retired | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1994 | 2026-09-06 | Afviklet; kun lån findes. |

## squad

**live:** Contracts, renewal and expiry (`contracts`) 2026-09-06 · Rider comparison and watchlist (`rider-compare-and-watchlist`) 2026-09-06 · Rating shows best role now (`rider-rating-best-role-display`) 2026-09-27 · Squad management (`squad-management`) 2026-09-06 · U23 team and Junior team pages (`youth-squad-pages`) 2026-09-26

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Teamwork and Leadership abilities (`mental-abilities-teamwork-leadership`) | building | - | [holdarbejde-og-lederskab-evner-design](superpowers/specs/2026-09-15-holdarbejde-og-lederskab-evner-design.md) | #1177 | 2026-09-15 | Data-only (#5268), resten senere. |
| New riders' primary type from the target distribution (`rider-primary-type-from-distribution`) | building | - | [RIDER_GENERATION](RIDER_GENERATION.md) | #5327 | 2026-09-23 | Kontakt (off); flip er ejer-gated. |

## training

**live:** Max +1 per ability per date (`ability-cap-per-date`) 2026-10-26 · Form and fatigue 2.0 (`condition-model-v2`) 2026-10-26 · Daily training (`daily-training`) 2026-10-27 · Peak planner (`peak-planner`) 2026-10-17 · Potential as one estimated number (`potential-single-number`) 2026-10-26 · Season fatigue and form reset (`season-fatigue-reset`) 2026-10-27 · Set the training day for several riders at once (`training-bulk-day`) 2026-10-24 · Training condition settled per date (`training-condition-per-date`) 2026-10-26 · Daily rider training receipt (`training-daily-receipt`) 2026-10-04 · Today's decision card on the Training page (`training-decision-card`) 2026-10-26 · Fatigue limit (player-set rules) (`training-fatigue-rules`) 2026-10-04 · Training groups (`training-groups`) 2026-10-14 · Hard sessions for cobbles, echelons and attacks (`training-hard-sessions-cobbles-echelon-attack`) 2026-09-15 · Training page on mobile (`training-mobile-table`) 2026-09-24 · Training cells per race day (35 cells) (`training-program-cells`) 2026-10-04 · Training programs per race day (`training-programs`) 2026-10-14 · Training score 1-99 (`training-score`) 2026-09-24 · Training tick per race day (`training-tick-per-race-day`) 2026-09-28 · Training tick system (`training-tick-system`) 2026-10-16 · Train now (no bonus) (`training-train-now`) 2026-10-14

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Development Score B in the engine (`development-score-b-engine`) | dormant | `development_score_v2` | [TRAINING_RULES](TRAINING_RULES.md) | #6110 | 2026-10-25 | Ejer, med Udvikling 2.0. |
| Catch-up via racing (`race-day-catchup`) | dormant | `race_day_catchup_enabled` | [TRAINING_RULES](TRAINING_RULES.md) | #6950 | 2026-10-25 | Ejer, med Udvikling 2.0. |
| Development curve B (level and potential drive development, not age) (`development-curve-b`) | building | `development_curve_b` | [TRAINING_RULES](TRAINING_RULES.md) | #3564 | 2026-10-29 | Off 29/10 (ejer-go): blødt loft gav 0 fremgang over loftet (mur, #7316). Tændes igen når rettelsen er live. |
| Train now B (the click settles the rider's whole known date) (`train-now-whole-day`) | building | - | [TRAINING_RULES](TRAINING_RULES.md) | #6461 | 2026-10-26 | PR #7191 åben; flag seedes off af migrationen. Ejer-go. |

## academy

**live:** Academy (`academy`) 2026-09-06 · Academy intake pull (`academy-intake-pull`) 2026-10-16 · Sunday talent drip (`academy-sunday-drip`) 2026-09-06 · Intake offer expiry (`intake-offer-expiry`) 2026-09-06 · Awaiting promotion instead of auto-sale when the next squad is full (`promotion-pending`) 2026-10-24 · Scouting (`scout-system`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| AI academy pull (`academy-ai-weekly-pull`) | dormant | - | [YOUTH_RULES](YOUTH_RULES.md) | #6666 | 2026-10-25 | Flag academy_ai_weekly_pull_enabled; ikke nu. |
| Academy reminders (`academy-pull-reminder`) | dormant | - | [YOUTH_RULES](YOUTH_RULES.md) | #6666 | 2026-10-25 | Flag academy_pull_reminder_enabled; ejeren tænder (#7177). |
| Season academy intake (`season-academy-intake`) | dormant | `season_academy_intake_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | #2911 | 2026-10-15 | Sikkerhedsventil efter ejer-beslutning (#2911); off i prod (læst 15/10), kun ejeren flipper. |
| Three squads (`three-squads`) | spec | - | [YOUTH_RULES](YOUTH_RULES.md) | #2492 | 2026-09-06 | Slice 0 er leveret; resten er spec. |

## season

**live:** AI pool retirement (`ai-pool-retirement-v2`) 2026-10-15 · AI team retirement (`ai-team-retire`) 2026-09-06 · Development 2.0 part 1 (decline at season change, only manager teams develop) (`development-v2-aging`) 2026-10-26 · Season recap (`season-end-recap`) 2026-09-06 · Season matrix on mobile (`season-matrix-mobile`) 2026-10-06 · Season signup (`season-signup`) 2026-09-24 · Season transition (`season-transition`) 2026-10-17

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Auto-generated season calendar at forever transitions (`auto-calendar`) | building | - | [CALENDAR_RULES](CALENDAR_RULES.md) | - | 2026-10-26 | Ingen række i prod (= off). |
| Season documentary (LLM) (`season-documentary-llm`) | building | `season_documentary_llm_enabled` | - | - | 2026-09-06 | - |
| Automatic season transition cron (`season-auto-transition`) | retired | - | [SEASON_CUTOVER_RUNBOOK](SEASON_CUTOVER_RUNBOOK.md) | #1155 | 2026-10-17 | Fjernet 17/10 (#6796); sæsonskiftet er manuelt. |

## economy

**live:** Automatic prize money (`auto-prize`) 2026-09-06 · No running costs from season 5 (`economy-no-upkeep`) 2026-10-20 · Finance overview (`finance-overview`) 2026-09-06 · Bulk rider value writes (`rider-values-bulk-write`) 2026-09-06 · Sponsors (`sponsors`) 2026-09-06 · Upkeep paid per senior race day (Travel & staff) (`upkeep-per-race-day`) 2026-09-27

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Youth squad upkeep switch at season change (`academy-drift-kill-switch`) | dormant | `academy_drift_enabled` | [SEASON_CUTOVER_RUNBOOK](SEASON_CUTOVER_RUNBOOK.md) | #5741 | 2026-10-26 | Afgjort B 18/10 (#6775): slukket i S5. Hjælp må ikke love drift. |

## club

**live:** Facilities (`facilities`) 2026-09-06 · Staff (`staff`) 2026-09-06

## board

**live:** Board mandate model (`board-mandate-model`) 2026-09-28

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Firing and season review (`board-firing-and-review`) | idea | - | [BOARD_RULES](BOARD_RULES.md) | - | 2026-09-06 | Findes ikke i kode. |

## social

**live:** Forum (`forum`) 2026-09-06 · Forum pulse (`forum-pulse`) 2026-09-06 · In-app notifications (`notifications`) 2026-09-06

## stats

**live:** Rider, manager and team profiles (`profiles`) 2026-09-06 · Results and race history (`results-archive`) 2026-09-06 · Standings and rankings (`standings-and-rankings`) 2026-09-06

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Calendar race card and race history library (`race-library-v2`) | building | `race_library_v2` | [CALENDAR_RULES](CALENDAR_RULES.md) | #6514 | 2026-10-26 | #6680 + #7217 merget; off i prod; PR #6636 åben. |
| Hall of Fame (`hall-of-fame`) | retired | - | - | #2359 | 2026-09-06 | Redirecter til /standings. |

## onboarding

**live:** Your first race card on the dashboard (new teams) (`first-race-card`) 2026-10-15 · First session onboarding (`onboarding-first-session`) 2026-09-06 · Season start guide (`season-start-guide`) 2026-09-06

## comms

**live:** Discord welcome inbox notification (`discord-welcome-inbox`) 2026-09-15 · Email retention loop (`email-loop`) 2026-10-15 · In-app player survey (`in-app-survey`) 2026-09-08 · Manager-to-manager DM (`manager-dm-v1`) 2026-09-17 · Push notifications (`push-notifications`) 2026-10-24 · Roadmap hub (five tabs) (`roadmap-hub`) 2026-10-04

## billing

**live:** Alunta reconciliation (`alunta-reconcile`) 2026-09-06 · CZ Pro (`cz-pro`) 2026-09-06

## ops

**live:** Ranking shadow (`ranking-shadow`) 2026-10-26 · Rider reputation (`rider-reputation`) 2026-10-04

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Survey banner (`survey-banner`) | retired | - | - | #2467 | 2026-10-15 | SurveyBanner.jsx slettet (#2467). |
