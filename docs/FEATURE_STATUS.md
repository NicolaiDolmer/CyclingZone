# FEATURE STATUS

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-feature-status.mjs`
> Flag-gate mod prod: `node scripts/check-feature-registry-flags.mjs`

123 poster: live 102 · dormant 5 · building 7 · spec 1 · idea 2 · retired 6. Tilstand afledes af kode og prod-flag, aldrig af prosa.

Epic-numre er issues i NicolaiDolmer/CyclingZone. Flag er noegler i prod `app_config`.
Live vises samlet (navn + dato) pr. omraade; fulde raekker (flag/SSOT/epic/note) er kun for ikke-live (#5430).
Arkiv = live verificeret over 30 dage foer registrets nyeste dato: kun id (#5319).

## race-engine

**live:** All out on the decisive climb (`race-all-out-7280`) 2026-10-27 · Day form with causes (`race-day-form-6649`) 2026-10-30 · Descent attacks respect the rider's task (`race-descent-task-7380`) 2026-11-01 · Profile hills in the race engine (`race-engine-profile-hills`) 2026-10-28 · S5 engine rules (s5_profiles_v3) (`race-engine-s5-profiles`) 2026-10-26 · Race engine v3 (`race-engine-v3`) 2026-10-04 · v3 scoring components (`race-engine-v3-scoring`) 2026-10-04 · Race engine v4 (`race-engine-v4`) 2026-10-04 · Stage plan switches exactly 10 km from the finish (`race-final-km-boundary-7383`) 2026-10-31 · Form peaks in races (`race-form-peaks`) 2026-10-27 · Stage intention choice (`race-intention-choice`) 2026-10-27 · Saving effort in individual time trials (`race-itt-save-7332`) 2026-11-01 · Time trial terrain weight (`race-itt-terrain-6595`) 2026-10-31

**arkiv:** `form-and-fatigue` · `race-finalize-resumable` · `race-notify-outbox` · `team-selection-and-roles`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Luxury helper (`luxury-helper-role`) | building | - | - | #5982 | 2026-10-27 | - |
| Official time persistence revision (`race-official-times-v1`) | retired | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #6284 | 2026-10-16 | Frosset prototype. |

## race-day

**live:** Role picker scope (stage N to the end / stage N only) (`role-scope-choice`) 2026-10-06 · Stage page 2.0 (stage tabs, real elevation profile, your day) (`stage-page-v2`) 2026-11-01 · Stage plan along the route (`stage-plan-v1`) 2026-10-27

**arkiv:** `auto-entry-generator` · `race-day-development` · `race-day-engine` · `race-detail-page` · `race-page-tabs-v2` · `race-replay` · `stage-scheduler`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Engine breakaway forecast (`race-breakaway-outlook`) | building | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #6912 | 2026-10-29 | Ingen app_config-række (fravær = off). Ejer-go til tænding. |

## market

**live:** Rider value on the same abilities as the rating (`rider-valuation-v5`) 2026-10-04

**arkiv:** `auctions` · `direct-transfers` · `rider-swaps`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| AI and unsolicited bids (`ai-unsolicited-bids`) | idea | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1310 | 2026-09-06 | Findes ikke i kode. |
| Market value blend sweep (`market-value-blend`) | retired | - | [ECONOMY_RULES](ECONOMY_RULES.md) | #3448 | 2026-10-15 | Afløst af v6 (#4449). |
| Rider loans (`rider-loans`) | retired | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1994 | 2026-09-06 | Afviklet; kun lån findes. |

## squad

**live:** Rating shows best role now (`rider-rating-best-role-display`) 2026-10-31

**arkiv:** `contracts` · `rider-compare-and-watchlist` · `squad-management` · `youth-squad-pages`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Teamwork and Leadership abilities (`mental-abilities-teamwork-leadership`) | building | - | [holdarbejde-og-lederskab-evner-design](superpowers/specs/2026-09-15-holdarbejde-og-lederskab-evner-design.md) | #1177 | 2026-09-15 | Data-only (#5268), resten senere. |
| New riders' primary type from the target distribution (`rider-primary-type-from-distribution`) | building | - | [RIDER_GENERATION](RIDER_GENERATION.md) | #5327 | 2026-09-23 | Kontakt (off); flip er ejer-gated. |

## training

**live:** Max +1 per ability per date (`ability-cap-per-date`) 2026-10-26 · Form and fatigue 2.0 (`condition-model-v2`) 2026-10-26 · Daily training (`daily-training`) 2026-10-27 · Development curve B (level and potential drive development, not age) (`development-curve-b`) 2026-10-30 · Peak planner (`peak-planner`) 2026-10-17 · Potential as one estimated number (`potential-single-number`) 2026-10-31 · Race day = hard day plus a role-weighted extra in the stage abilities (`race-day-role-yield`) 2026-11-01 · Season fatigue and form reset (`season-fatigue-reset`) 2026-10-27 · Train now B (the click settles the rider's whole known date) (`train-now-whole-day`) 2026-10-30 · Set the training day for several riders at once (`training-bulk-day`) 2026-10-24 · Training catalog v3 (`training-catalog-v3`) 2026-10-30 · Training condition settled per date (`training-condition-per-date`) 2026-10-26 · Daily rider training receipt (`training-daily-receipt`) 2026-10-04 · Today's decision card on the Training page (`training-decision-card`) 2026-10-26 · Fatigue limit (player-set rules) (`training-fatigue-rules`) 2026-10-04 · Training groups (`training-groups`) 2026-10-14 · Training cells per race day (35 cells) (`training-program-cells`) 2026-10-04 · Training programs per race day (`training-programs`) 2026-10-14 · Training tick system (`training-tick-system`) 2026-10-16 · Train now (no bonus) (`training-train-now`) 2026-10-14

**arkiv:** `training-hard-sessions-cobbles-echelon-attack` · `training-mobile-table` · `training-score` · `training-tick-per-race-day`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Development Score B in the engine (`development-score-b-engine`) | dormant | `development_score_v2` | [TRAINING_RULES](TRAINING_RULES.md) | #6110 | 2026-10-25 | Ejer, med Udvikling 2.0. |
| Catch-up via racing (`race-day-catchup`) | dormant | `race_day_catchup_enabled` | [TRAINING_RULES](TRAINING_RULES.md) | #6950 | 2026-10-25 | Ejer, med Udvikling 2.0. |

## academy

**live:** Academy intake pull (`academy-intake-pull`) 2026-10-16 · Academy reminders (`academy-pull-reminder`) 2026-10-30 · Awaiting promotion instead of auto-sale when the next squad is full (`promotion-pending`) 2026-10-24

**arkiv:** `academy` · `academy-sunday-drip` · `intake-offer-expiry` · `scout-system`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| AI academy pull (`academy-ai-weekly-pull`) | dormant | - | [YOUTH_RULES](YOUTH_RULES.md) | #6666 | 2026-10-25 | Flag academy_ai_weekly_pull_enabled; ikke nu. |
| Season academy intake (`season-academy-intake`) | dormant | `season_academy_intake_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | #2911 | 2026-10-15 | Sikkerhedsventil efter ejer-beslutning (#2911); off i prod (læst 15/10), kun ejeren flipper. |
| Three squads (`three-squads`) | spec | - | [YOUTH_RULES](YOUTH_RULES.md) | #2492 | 2026-09-06 | Slice 0 er leveret; resten er spec. |

## season

**live:** AI pool retirement (`ai-pool-retirement-v2`) 2026-10-15 · Development 2.0 part 1 (decline at season change, only manager teams develop) (`development-v2-aging`) 2026-10-26 · Season matrix on mobile (`season-matrix-mobile`) 2026-10-06 · Season transition (`season-transition`) 2026-10-17

**arkiv:** `ai-team-retire` · `season-end-recap` · `season-signup`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Auto-generated season calendar at forever transitions (`auto-calendar`) | building | - | [CALENDAR_RULES](CALENDAR_RULES.md) | - | 2026-10-26 | Ingen række i prod (= off). |
| Season documentary (LLM) (`season-documentary-llm`) | building | `season_documentary_llm_enabled` | - | - | 2026-09-06 | - |
| Automatic season transition cron (`season-auto-transition`) | retired | - | [SEASON_CUTOVER_RUNBOOK](SEASON_CUTOVER_RUNBOOK.md) | #1155 | 2026-10-17 | Fjernet 17/10 (#6796); sæsonskiftet er manuelt. |

## economy

**live:** No running costs from season 5 (`economy-no-upkeep`) 2026-10-20

**arkiv:** `auto-prize` · `finance-overview` · `rider-values-bulk-write` · `sponsors` · `upkeep-per-race-day`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Youth squad upkeep switch at season change (`academy-drift-kill-switch`) | dormant | `academy_drift_enabled` | [SEASON_CUTOVER_RUNBOOK](SEASON_CUTOVER_RUNBOOK.md) | #5741 | 2026-10-26 | Afgjort B 18/10 (#6775): slukket i S5. Hjælp må ikke love drift. |

## club

**arkiv:** `facilities` · `staff`

## board

**arkiv:** `board-mandate-model`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Firing and season review (`board-firing-and-review`) | idea | - | [BOARD_RULES](BOARD_RULES.md) | - | 2026-09-06 | Findes ikke i kode. |

## social

**arkiv:** `forum` · `forum-pulse` · `notifications`

## stats

**arkiv:** `profiles` · `results-archive` · `standings-and-rankings`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Calendar race card and race history library (`race-library-v2`) | building | `race_library_v2` | [CALENDAR_RULES](CALENDAR_RULES.md) | #6514 | 2026-10-26 | #6680 + #7217 merget; off i prod; PR #6636 åben. |
| Hall of Fame (`hall-of-fame`) | retired | - | - | #2359 | 2026-09-06 | Redirecter til /standings. |

## onboarding

**live:** Your first race card on the dashboard (new teams) (`first-race-card`) 2026-10-15

**arkiv:** `onboarding-first-session` · `season-start-guide`

## comms

**live:** Email retention loop (`email-loop`) 2026-10-15 · Push notifications (`push-notifications`) 2026-10-24 · Roadmap hub (five tabs) (`roadmap-hub`) 2026-10-04

**arkiv:** `discord-welcome-inbox` · `in-app-survey` · `manager-dm-v1`

## billing

**arkiv:** `alunta-reconcile` · `cz-pro`

## ops

**live:** Ranking shadow (`ranking-shadow`) 2026-10-26 · Rider reputation (`rider-reputation`) 2026-10-04

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Survey banner (`survey-banner`) | retired | - | - | #2467 | 2026-10-15 | SurveyBanner.jsx slettet (#2467). |
