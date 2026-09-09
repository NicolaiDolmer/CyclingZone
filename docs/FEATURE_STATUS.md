# FEATURE STATUS

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-feature-status.mjs`
> Flag-gate mod prod: `node scripts/check-feature-registry-flags.mjs`

62 poster: live 43 · beta 2 · dormant 5 · building 7 · spec 1 · idea 2 · retired 2. Tilstand afledes af kode og prod-flag, aldrig af prosa.

Epic-numre er issues i NicolaiDolmer/CyclingZone. Flag er noegler i prod `app_config`.

## race-engine

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Form and fatigue in scoring (`form-and-fatigue`) | live | - | [TRAINING_RULES.md](TRAINING_RULES.md) | #2353 | 2026-09-06 | Vægter reelt ind via formRaceWeightV3, ikke neutrale 0-stubs. |
| Race engine v3 (`race-engine-v3`) | live | `race_engine_v2_enabled` | [RACE_ENGINE_RULES.md](RACE_ENGINE_RULES.md) | #1306 | 2026-09-06 | Autoritativ motor i prod; flagnavnet er historisk (v2-æraen). |
| v3 scoring components (`race-engine-v3-scoring`) | live | `race_engine_v3_scoring` | [RACE_ENGINE_RULES.md](RACE_ENGINE_RULES.md) | #2353 | 2026-09-06 | Dagsform, jour sans, arbejdsomkostning og rolle-opløsning i raceSimulator. |
| Team selection, captain and breakaway (`team-selection-and-roles`) | live | - | [RACE_ENGINE_RULES.md](RACE_ENGINE_RULES.md) | #1307 | 2026-09-06 | - |
| Race engine v4 (`race-engine-v4`) | dormant | - | [RACE_ENGINE_RULES.md](RACE_ENGINE_RULES.md) | #3855 | 2026-09-07 | Række race_engine_v4 = "off" i prod (#4951). Flip planlagt 28/9, ejer-only. |
| Stage intention choice (`race-intention-choice`) | building | - | [RACE_ENGINE_RULES.md](RACE_ENGINE_RULES.md) | #4632 | 2026-09-07 | UI er live i Taktik-fanen (RaceTacticsTab, #4913); motoreffekten venter på v4-flip (dormant nøgle race_day_intention_enabled). |

## race-day

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Automatic race entries (`auto-entry-generator`) | live | `auto_entry_generator_enabled` | [CALENDAR_RULES.md](CALENDAR_RULES.md) | - | 2026-09-06 | - |
| Race day engine (`race-day-engine`) | live | `race_day_engine_enabled` | [RACE_ENGINE_RULES.md](RACE_ENGINE_RULES.md) | - | 2026-09-06 | - |
| Race page (`race-detail-page`) | live | - | - | - | 2026-09-07 | RaceDetailPage som hero + faner (Overblik/Hold/Taktik/Etaper/Resultater) siden #4913. |
| Race page as tabs (v2) (`race-page-tabs-v2`) | live | - | - | #4613 | 2026-09-07 | PR #4913 merget 6/9 kl. 18:57; patch note 7.259. |
| Stage replay and timeline film (`race-replay`) | live | `race_stage_timeline` | - | - | 2026-09-06 | FinalKilometrePlayback, TimelineFilmPlayer og StageFilmScrubber. |
| Stage scheduler (`stage-scheduler`) | live | `stage_scheduler_enabled` | [CALENDAR_RULES.md](CALENDAR_RULES.md) | - | 2026-09-06 | - |
| Race day development (`race-day-development`) | dormant | `race_day_development_enabled` | [PROGRESSION_RULES.md](PROGRESSION_RULES.md) | #4850 | 2026-09-07 | Bygget (D2); flaget åbnes når træningstick-omlægningen (#4850) er klar, senest S4 28/9. |

## market

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Auctions with proxy bidding (`auctions`) | live | - | [TRANSFER_MARKET_RULES.md](TRANSFER_MARKET_RULES.md) | - | 2026-09-06 | - |
| Direct transfers and offers (`direct-transfers`) | live | - | [TRANSFER_MARKET_RULES.md](TRANSFER_MARKET_RULES.md) | - | 2026-09-06 | - |
| Rider swaps (`rider-swaps`) | live | - | [TRANSFER_MARKET_RULES.md](TRANSFER_MARKET_RULES.md) | - | 2026-09-06 | Knap på rytterprofilen; den separate fane er fjernet. |
| Market value blend sweep (`market-value-blend`) | dormant | `market_value_sweep_enabled` | [ECONOMY_RULES.md](ECONOMY_RULES.md) | #3448 | 2026-09-07 | Bygget; flaget åbnes efter ejer-go (#4449, global vægt 0,15). Kun ren måling kører i dag (#4419). |
| Auction entry gate (`auction-entry-gate`) | building | `auction_entry_gate_enabled` | [TRANSFER_MARKET_RULES.md](TRANSFER_MARKET_RULES.md) | - | 2026-09-06 | - |
| AI and unsolicited bids (`ai-unsolicited-bids`) | idea | - | [TRANSFER_MARKET_RULES.md](TRANSFER_MARKET_RULES.md) | #1310 | 2026-09-06 | Findes ikke i kode. |
| Rider loans (`rider-loans`) | retired | - | [TRANSFER_MARKET_RULES.md](TRANSFER_MARKET_RULES.md) | #1994 | 2026-09-06 | Afviklet; kun finansielle lån findes i dag. |

## squad

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Contracts, renewal and expiry (`contracts`) | live | - | [TRANSFER_MARKET_RULES.md](TRANSFER_MARKET_RULES.md) | #1310 | 2026-09-06 | extend-contract, contractExpiryRelease og aiContractAutoRenewal i sæsonskiftet. |
| Rider comparison and watchlist (`rider-compare-and-watchlist`) | live | - | - | - | 2026-09-06 | - |
| Squad management (`squad-management`) | live | - | - | - | 2026-09-06 | TeamPage med trup, løn, kontrakter og udviklingsfane. |

## training

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Daily training (`daily-training`) | live | `daily_training_enabled` | [TRAINING_RULES.md](TRAINING_RULES.md) | - | 2026-09-06 | - |
| Peak planner (`peak-planner`) | live | `peak_planner_enabled` | [TRAINING_RULES.md](TRAINING_RULES.md) | #2224 | 2026-09-06 | - |
| Season fatigue and form reset (`season-fatigue-reset`) | live | `season_fatigue_reset_enabled` | [TRAINING_RULES.md](TRAINING_RULES.md) | - | 2026-09-06 | - |
| Training tick system (`training-tick-system`) | building | - | [TRAINING_RULES.md](TRAINING_RULES.md) | #4850 | 2026-09-06 | - |

## academy

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Academy (`academy`) | live | `academy_enabled` | [YOUTH_RULES.md](YOUTH_RULES.md) | #932 | 2026-09-06 | - |
| Sunday talent drip (`academy-sunday-drip`) | live | - | [YOUTH_RULES.md](YOUTH_RULES.md) | #2064 | 2026-09-06 | - |
| Intake offer expiry (`intake-offer-expiry`) | live | `intake_offer_expiry_enabled` | [YOUTH_RULES.md](YOUTH_RULES.md) | - | 2026-09-06 | - |
| Scouting (`scout-system`) | live | `scout_system_enabled` | [YOUTH_RULES.md](YOUTH_RULES.md) | - | 2026-09-06 | - |
| Academy intake pull (`academy-intake-pull`) | dormant | `academy_intake_pull_enabled` | [YOUTH_RULES.md](YOUTH_RULES.md) | #3550 | 2026-09-07 | Bygget; erstatter søndagsdrippet når flaget flippes ved cutover (#3550). |
| Season academy intake (`season-academy-intake`) | building | `season_academy_intake_enabled` | [YOUTH_RULES.md](YOUTH_RULES.md) | - | 2026-09-06 | - |
| Three squads (`three-squads`) | spec | - | [YOUTH_RULES.md](YOUTH_RULES.md) | #2492 | 2026-09-06 | Slice 0 er leveret; resten er spec. |

## season

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| AI team retirement (`ai-team-retire`) | live | `ai_team_retire_enabled` | - | - | 2026-09-06 | #4753: flag on genmålt 9/9; atomisk reservation, dræning og pulje-sweep lokalt verificeret, prod-release afventer ejer-go. |
| Season recap (`season-end-recap`) | live | - | - | #1311 | 2026-09-06 | SeasonEndPage med recap og hædersbevisninger. |
| Season transition (`season-transition`) | live | - | [SEASON_TRANSITION_CHECKLIST.md](SEASON_TRANSITION_CHECKLIST.md) | - | 2026-09-06 | - |
| Season signup (`season-signup`) | dormant | `season_signup_enabled` | [CALENDAR_RULES.md](CALENDAR_RULES.md) | - | 2026-09-07 | Bygget; flaget åbnes ved S4-cutover 27-28/9 (#452, #4592). |
| Season documentary (LLM) (`season-documentary-llm`) | building | `season_documentary_llm_enabled` | - | - | 2026-09-06 | - |

## economy

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Automatic prize money (`auto-prize`) | live | `auto_prize_enabled` | [ECONOMY_RULES.md](ECONOMY_RULES.md) | - | 2026-09-06 | - |
| Finance overview (`finance-overview`) | live | - | [ECONOMY_RULES.md](ECONOMY_RULES.md) | - | 2026-09-06 | - |
| Bulk rider value writes (`rider-values-bulk-write`) | live | `rider_values_bulk_write_enabled` | [ECONOMY_RULES.md](ECONOMY_RULES.md) | - | 2026-09-06 | - |
| Sponsors (`sponsors`) | live | - | [SPONSOR_RULES.md](SPONSOR_RULES.md) | #1663 | 2026-09-06 | Fase 2 er live. |

## club

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Facilities (`facilities`) | live | `facilities_enabled` | - | - | 2026-09-06 | Trænings- og scoutingeffekter er live; medical og commercial er ikke bygget. |
| Staff (`staff`) | live | - | - | - | 2026-09-06 | - |

## board

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Board mandate model (`board-mandate-model`) | beta | `board_mandate_model_enabled` | [BOARD_RULES.md](BOARD_RULES.md) | #3514 | 2026-09-06 | Mandat, vision, tillid, bonus og DNA-valg i Boardroom. |
| Firing and season review (`board-firing-and-review`) | idea | - | [BOARD_RULES.md](BOARD_RULES.md) | - | 2026-09-06 | Findes ikke i kode. |

## social

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Forum (`forum`) | live | - | [FORUM_RULES.md](FORUM_RULES.md) | #3199 | 2026-09-06 | - |
| Forum pulse (`forum-pulse`) | live | - | [FORUM_RULES.md](FORUM_RULES.md) | #4238 | 2026-09-06 | - |
| In-app notifications (`notifications`) | live | - | [SOCIAL_RULES.md](SOCIAL_RULES.md) | - | 2026-09-06 | Cirka 55 typer i backend/lib/notificationTypes.js. |

## stats

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Rider, manager and team profiles (`profiles`) | live | - | - | - | 2026-09-06 | - |
| Results and race history (`results-archive`) | live | - | - | - | 2026-09-06 | RaceHistoryPage, ResultaterPage og AuctionHistoryPage. |
| Standings and rankings (`standings-and-rankings`) | live | - | - | - | 2026-09-06 | - |
| Hall of Fame (`hall-of-fame`) | retired | - | - | #2359 | 2026-09-06 | Redirecter til /standings. |

## onboarding

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| First session onboarding (`onboarding-first-session`) | live | - | - | - | 2026-09-06 | OnboardingProgressCard (4 trin) og OnboardingTour på riders, auctions og board. |
| Season start guide (`season-start-guide`) | live | - | - | - | 2026-09-06 | - |

## comms

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| In-app player survey (`in-app-survey`) | live | - | [SURVEY_SYSTEM.md](SURVEY_SYSTEM.md) | #4943 | 2026-09-08 | Skemaet 2026-09-features åbnet 8/9 14:15 (241 inviteret via indbakken); admin-resultatside /admin/surveys/:slug live (#5043). |
| Email retention loop (`email-loop`) | beta | - | [EMAIL_LOOP_GO_LIVE_RUNBOOK.md](EMAIL_LOOP_GO_LIVE_RUNBOOK.md) | #4616 | 2026-09-08 | welcome + day1 = "on" i prod siden 8/9 18:07 (ejer-go, #2853), race_digest stadig "off". Første rigtige welcome leveret 8/9 18:07. Webhook (email_events) afventer RESEND_WEBHOOK_SECRET fra ejeren. |

## billing

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Alunta reconciliation (`alunta-reconcile`) | live | `alunta_reconcile_enabled` | [ALUNTA_OPS.md](ALUNTA_OPS.md) | - | 2026-09-06 | - |
| CZ Pro (`cz-pro`) | live | - | [BILLING_STACK.md](BILLING_STACK.md) | - | 2026-09-06 | Betalingsrails og Founder Supporter live; checkout-sprog og EUR er åbent (#4616). |

## ops

| Feature | State | Flag | SSOT | Epic | Verified | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Rider reputation (`rider-reputation`) | building | `rider_reputation_enabled` | - | - | 2026-09-06 | - |
| Survey banner (`survey-banner`) | building | `survey_banner_enabled` | - | - | 2026-09-06 | - |
