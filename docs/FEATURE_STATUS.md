# FEATURE STATUS

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-feature-status.mjs`
> Flag-gate mod prod: `node scripts/check-feature-registry-flags.mjs`

135 poster: live 107 · beta 1 · dormant 9 · building 9 · spec 1 · idea 2 · retired 6. Tilstand afledes af kode og prod-flag, aldrig af prosa.

Epic-numre er issues i NicolaiDolmer/CyclingZone. Flag er noegler i prod `app_config`.
Live vises samlet (navn + dato) pr. omraade; fulde raekker (flag/SSOT/epic/note) er kun for ikke-live (#5430).
Arkiv = live verificeret over 14 dage foer registrets nyeste dato: kun id (#5319).

## race-engine

**live:** Luxury helper (`luxury-helper-role`) 2026-11-02 · All out on the decisive climb (`race-all-out-7280`) 2026-11-02 · Day form with causes (`race-day-form-6649`) 2026-10-30 · Descent attacks respect the rider's task (`race-descent-task-7380`) 2026-11-01 · Profile hills in the race engine (`race-engine-profile-hills`) 2026-10-28 · S5 engine rules (s5_profiles_v3) (`race-engine-s5-profiles`) 2026-10-26 · Stage plan 10 km switch (`race-final-km-boundary-7383`) 2026-10-31 · Form peaks in races (`race-form-peaks`) 2026-10-27 · Stage intention choice (`race-intention-choice`) 2026-11-02 · Time trials without the extra day roll (`race-itt-no-day-roll-7726`) 2026-11-06 · Saving effort in individual time trials (`race-itt-save-7332`) 2026-11-01 · Time trial terrain weight (`race-itt-terrain-6595`) 2026-10-31 · The chase is decided by the teams chasing (`race-team-chase-7730`) 2026-11-06

**arkiv:** `form-and-fatigue` · `race-engine-v3` · `race-engine-v3-scoring` · `race-engine-v4` · `race-finalize-resumable` · `race-notify-outbox` · `team-selection-and-roles`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Day form in words after the stage (`race-day-words-7725`) | dormant | `day_words_7725` | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #7725 | 2026-11-06 | Slukket; kræver day_form_6649. |
| Long descent chase cap (`race-descent-regroup-cap-7644`) | dormant | `descent_regroup_cap_7644` | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #7644 | 2026-11-04 | Slukket; tændes af ejeren. |
| Official time persistence revision (`race-official-times-v1`) | retired | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #6284 | 2026-10-16 | Frosset prototype. |

## race-day

**live:** Stage replay and timeline film (`race-replay`) 2026-11-04 · Stage page 2.0 (`stage-page-v2`) 2026-11-01 · Stage plan along the route (`stage-plan-v1`) 2026-10-27

**arkiv:** `auto-entry-generator` · `race-day-development` · `race-day-engine` · `race-detail-page` · `race-page-tabs-v2` · `role-scope-choice` · `stage-scheduler`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Why? button beside riders in Your day (`rider-why-button`) | beta | `rider_why_button` | - | #7716 | 2026-11-05 | #7717: seedet off, kun visning. Ejeren flytter flaget efter visuelt go. |
| Engine breakaway forecast (`race-breakaway-outlook`) | building | - | [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md) | #6912 | 2026-10-29 | Ingen app_config-række (fravær = off). Ejer-go til tænding. |

## market

**arkiv:** `auctions` · `direct-transfers` · `rider-swaps` · `rider-valuation-v5`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Sale escrow (`sale-escrow`) | building | - | - | #6181 | 2026-11-07 | Kontakt sale_escrow_enabled. |
| AI and unsolicited bids (`ai-unsolicited-bids`) | idea | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1310 | 2026-09-06 | Findes ikke i kode. |
| Market value blend sweep (`market-value-blend`) | retired | - | [ECONOMY_RULES](ECONOMY_RULES.md) | #3448 | 2026-10-15 | Afløst af v6 (#4449). |
| Rider loans (`rider-loans`) | retired | - | [TRANSFER_MARKET_RULES](TRANSFER_MARKET_RULES.md) | #1994 | 2026-09-06 | Afviklet; kun lån findes. |

## squad

**live:** Rating shows best role now (`rider-rating-best-role-display`) 2026-10-31

**arkiv:** `contracts` · `rider-compare-and-watchlist` · `squad-management` · `youth-squad-pages`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Teamwork and Leadership abilities (`mental-abilities-teamwork-leadership`) | building | - | [holdarbejde-og-lederskab-evner-design](superpowers/specs/2026-09-15-holdarbejde-og-lederskab-evner-design.md) | #1177 | 2026-11-04 | Kun data er bygget (#5268); motor (#5348) og mentorpar (#5349) mangler, arbejdet står stille. |
| New riders' primary type (`rider-primary-type-from-distribution`) | building | - | [RIDER_GENERATION](RIDER_GENERATION.md) | #5327 | 2026-09-23 | Kontakt (off); flip er ejer-gated. |

## training

**live:** Max +1 per ability per date (`ability-cap-per-date`) 2026-10-26 · Form and fatigue 2.0 (`condition-model-v2`) 2026-10-26 · Race date as full training day (`condition-v2-race-date-training-day`) 2026-11-04 · Daily training (`daily-training`) 2026-10-27 · Development curve B (`development-curve-b`) 2026-10-30 · Same potential band everywhere (`potential-single-number`) 2026-11-04 · Race day as a hard training day (`race-day-role-yield`) 2026-11-01 · Season fatigue and form reset (`season-fatigue-reset`) 2026-10-27 · Train now B (`train-now-whole-day`) 2026-11-02 · Bulk training day (`training-bulk-day`) 2026-11-02 · Training catalog v3 (`training-catalog-v3`) 2026-10-30 · Training condition settled per date (`training-condition-per-date`) 2026-10-26 · Today's decision card on the Training page (`training-decision-card`) 2026-10-26

**arkiv:** `peak-planner` · `training-daily-receipt` · `training-fatigue-rules` · `training-groups` · `training-hard-sessions-cobbles-echelon-attack` · `training-mobile-table` · `training-program-cells` · `training-programs` · `training-score` · `training-tick-per-race-day` · `training-tick-system` · `training-train-now`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Development Score B in the engine (`development-score-b-engine`) | dormant | `development_score_v2` | [TRAINING_RULES](TRAINING_RULES.md) | #6110 | 2026-11-04 | Ejer 31/10 (#6110): parkeret, indtil grundtalentet (spec 23/10, byggetrin 2) er bygget; ingen frist. Forudsætning før tænding: #7584. |
| One potential source (`potential-estimate-display`) | dormant | `potential_estimate_display` | [6110-potentiale-et-tal-samlet-design](superpowers/specs/2026-10-23-6110-potentiale-et-tal-samlet-design.md) | #6110 | 2026-11-05 | Byggetrin 4 (#7684): estimates, scouting-rapport, development-projection og akademi svarer fra potentialEstimateRead.js, når flaget er tændt. |
| Catch-up via racing (`race-day-catchup`) | dormant | `race_day_catchup_enabled` | [TRAINING_RULES](TRAINING_RULES.md) | #6950 | 2026-10-25 | Ejer, med Udvikling 2.0. |
| Race day role base day (`race-day-role-base-day`) | dormant | `race_day_role_base_day_enabled` | [TRAINING_RULES](TRAINING_RULES.md) | #6110 | 2026-11-03 | #5950 løsning A (ejer-valg 3/11), underkontakt til race-day-role-yield. Off. |
| Development XP (`development-xp-model`) | building | - | [TRAINING_RULES](TRAINING_RULES.md) | #6110 | 2026-11-07 | Kontakter development_xp_model + development_xp_from_date; tændes efter kalibrering. |
| Stored potential estimates (`potential-estimate-writes`) | building | - | [6110-potentiale-et-tal-samlet-design](superpowers/specs/2026-10-23-6110-potentiale-et-tal-samlet-design.md) | #6110 | 2026-11-05 | Trin 5 (#7685): søndagsjob, holdskifte og nye kig skriver bag flaget potential_estimate_writes (seedes off). |
| Fatigue now counts today's earlier stages (`training-fatigue-now-7801`) | building | - | [TRAINING_RULES](TRAINING_RULES.md) | #7801 | 2026-11-07 | Kontakt fatigue_now_7801 (ikke seedet = slukket); ejer tænder. |

## academy

**live:** Academy reminders (`academy-pull-reminder`) 2026-10-30 · Awaiting promotion instead of auto-sale (`promotion-pending`) 2026-10-24

**arkiv:** `academy` · `academy-intake-pull` · `academy-sunday-drip` · `intake-offer-expiry` · `scout-system`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| AI academy pull (`academy-ai-weekly-pull`) | dormant | - | [YOUTH_RULES](YOUTH_RULES.md) | #6666 | 2026-10-25 | Flag academy_ai_weekly_pull_enabled; ikke nu. |
| Season academy intake (`season-academy-intake`) | dormant | `season_academy_intake_enabled` | [YOUTH_RULES](YOUTH_RULES.md) | #2911 | 2026-10-15 | Sikkerhedsventil efter ejer-beslutning (#2911); off i prod, kun ejeren flipper. |
| Three squads (`three-squads`) | spec | - | [YOUTH_RULES](YOUTH_RULES.md) | #2492 | 2026-09-06 | Slice 0 er leveret; resten er spec. |

## season

**live:** Development 2.0 part 1 (`development-v2-aging`) 2026-10-26

**arkiv:** `ai-pool-retirement-v2` · `ai-team-retire` · `season-end-recap` · `season-matrix-mobile` · `season-signup` · `season-transition`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Auto-generated season calendar (`auto-calendar`) | building | - | [CALENDAR_RULES](CALENDAR_RULES.md) | - | 2026-10-26 | Ingen række i prod (= off). |
| Season documentary (LLM) (`season-documentary-llm`) | building | `season_documentary_llm_enabled` | - | - | 2026-09-06 | - |
| Automatic season transition cron (`season-auto-transition`) | retired | - | [SEASON_CUTOVER_RUNBOOK](SEASON_CUTOVER_RUNBOOK.md) | #1155 | 2026-10-17 | Fjernet 17/10 (#6796); sæsonskiftet er manuelt. |

## economy

**arkiv:** `auto-prize` · `economy-no-upkeep` · `finance-overview` · `rider-values-bulk-write` · `sponsors` · `upkeep-per-race-day`

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

**live:** Calendar race card and race history library (`race-library-v2`) 2026-11-03

**arkiv:** `profiles` · `results-archive` · `standings-and-rankings`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Hall of Fame (`hall-of-fame`) | retired | - | - | #2359 | 2026-09-06 | Redirecter til /standings. |

## onboarding

**arkiv:** `first-race-card` · `onboarding-first-session` · `season-start-guide`

## comms

**live:** Push notifications (`push-notifications`) 2026-10-24

**arkiv:** `discord-welcome-inbox` · `email-loop` · `in-app-survey` · `manager-dm-v1` · `roadmap-hub`

## billing

**arkiv:** `alunta-reconcile` · `cz-pro`

## ops

**live:** Ranking shadow (`ranking-shadow`) 2026-10-26

**arkiv:** `rider-reputation`

| Feature | State | Flag | SSOT | Epic | Verified | Note |
|-|-|-|-|-|-|-|
| Survey banner (`survey-banner`) | retired | - | - | #2467 | 2026-10-15 | SurveyBanner.jsx slettet (#2467). |
