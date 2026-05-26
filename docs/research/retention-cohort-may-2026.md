# Retention-baseline — open beta cohort 2026-05-08 til 2026-05-15

> Etableret 2026-05-26. Read-only Supabase audit udført af Codex (session 2026-05-26).
> Refs [#674](https://github.com/NicolaiDolmer/CyclingZone/issues/674), [#680](https://github.com/NicolaiDolmer/CyclingZone/issues/680) (TdF Launch Sprint epic), [#670](https://github.com/NicolaiDolmer/CyclingZone/issues/670) (Clarity audit, ikke krydstjekket endnu).

## TL;DR

- **D7 retention = 20%** (exact + plus), **under TdF post-launch target på 30%** per [#680](https://github.com/NicolaiDolmer/CyclingZone/issues/680).
- **Cohort er for lille** (5 brugere) til hård beslutning — directionally indicative.
- **Instrumentation hul:** Kun 2/5 cohort-users har `session_started`-events. Presence-baseret retention (`users.last_seen`) viser lignende billede.
- **Auction-engagement findes hos retainede users** — det suggerer "activation/return loop weak or under-instrumented", ikke "auction-flow har ingen interesse".

## Method

- **Cohort:** Brugere med `auth.users.created_at` lokal dato Europe/Copenhagen fra **2026-05-08** til og med **2026-05-15**, ekskl. deleted users.
- **Activity-kilde:** `public.player_events` hvor `event_name = 'session_started'` (per #674 issue-body).
- **As-of date:** 2026-05-26.
- **Retention-definitioner:**
  - `exact`: session på præcis signup-dag + N kalenderdage.
  - `plus`: session på eller efter signup-dag + N, helt frem til 2026-05-26.

## Cohort-størrelse

| Signup date | Signups | Users med `session_started` | Distinct session days |
|---|---:|---:|---:|
| 2026-05-08 | 4 | 1 | 4 |
| 2026-05-11 | 1 | 1 | 10 |
| **Total** | **5** | **2** | **14** |

Bemærk: Ingen signups i datointervallet faldt på 2026-05-09, -10, -12, -13, -14 eller -15.

## Overall retention fra `session_started`

| Metric | Exact | Plus / returned by now |
|---|---:|---:|
| D1 | 1/5 = **20%** | 2/5 = **40%** |
| D7 | 1/5 = **20%** | 1/5 = **20%** |
| D14 | 0/5 = **0%** | 1/5 = **20%** |

Alle 5 cohort-users er D14-eligible per 2026-05-26 (signups var 2026-05-08 og 2026-05-11).

## By signup date

| Signup date | Signups | D1 exact | D1+ | D7 exact | D7+ | D14 exact | D14+ |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-05-08 | 4 | 0 | 1 | 0 | 0 | 0 | 0 |
| 2026-05-11 | 1 | 1 | 1 | 1 | 1 | 0 | 1 |

## Cross-check mod presence / auth-signaler

Presence (`public.users.last_seen`) giver lignende, lidt mere generøst billede:

| Signup date | Signups | presence D1+ | presence D7+ | presence D14+ | auth `last_sign_in_at` D1+ | auth D7+ | auth D14+ |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-05-08 | 4 | 1 | 0 | 0 | 1 | 0 | 0 |
| 2026-05-11 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |

**Interpretation:** `session_started`-data er plausibel til retention, men small-sample og instrumentation-afhængig. Kun 2/5 cohort-users har overhovedet `session_started`-events — sandsynligvis fordi analytics/event-logging afhænger af frontend-adfærd og/eller consent. Presence (`last_seen`) er nyttig som fallback for "var aktiv overhovedet".

## Event-mix for cohorten

| Event | Events | Users | First date | Last date |
|---|---:|---:|---|---|
| `session_started` | 440 | 2 | 2026-05-11 | 2026-05-26 |
| `auction_view` | 63 | 2 | 2026-05-11 | 2026-05-22 |
| `auction_bid_placed` | 5 | 2 | 2026-05-11 | 2026-05-12 |
| `feature_finance_forecast_card_viewed` | 3 | 2 | 2026-05-14 | 2026-05-22 |
| `feature_rider_development_tab_opened` | 1 | 1 | 2026-05-12 | 2026-05-12 |

## Interpretation

- Cohort er **for lille til en hård produktbeslutning**, men signalet er directionally nyttigt: **D7 exact/plus = 20%**, under post-TdF target D7 ≥ 30% i [#680](https://github.com/NicolaiDolmer/CyclingZone/issues/680).
- Den sundeste single user returnerede frem til D14+, men 3/5 users har ingen tracked `session_started`-events efter signup-range.
- Auction-engagement findes blandt de retainede users → problemet er sandsynligvis mindre "auction-flow har ingen interesse" og mere **"activation/return loop er svag eller under-instrumented"**.

## Caveats / follow-ups

- **Microsoft Clarity cross-check er ikke gjort.** Codex' session havde ingen Clarity-connector. Denne PC (EmmaPC) HAR Clarity MCP — kan køres som follow-up.
- **Anbefalet næste investigation:** Kombiner med [#670](https://github.com/NicolaiDolmer/CyclingZone/issues/670) Clarity-audit og inspicér first-session drop-off for `signup → team setup → first auction bid`.
- **Anbefalet måling-forbedring:** For launch validation: rapportér både `session_started`-retention **og** presence-baseret retention side om side indtil event-coverage er tæt på 100%.
- **Instrumentation-issue:** Kun 2/5 cohort-users har `session_started`-events. Bør filed som separat investigation (verify session_started event coverage på tværs af signup-flow).

## Status

- Codex postede rapport som comment på [#674](https://github.com/NicolaiDolmer/CyclingZone/issues/674) 2026-05-26 15:27 UTC (kunne ikke skrive denne fil pga. session constraint).
- Filen her er Claude-Code's persisting af samme rapport per issue's accept-criterium.
