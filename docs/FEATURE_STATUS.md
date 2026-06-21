# FEATURE STATUS

_Slim live-state. Historical implementation detail lives in `docs/archive/`._

Last reviewed: 2026-06-17 (audit-pass — race v2 + value-model status). GitHub issues are the source of truth for active work.

## Product direction

- The approved [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) centers the game on four engines: racing, training, youth development, and transfers/auctions.
- The hard relaunch target is 2026-06-20; [docs/NOW.md](NOW.md) carries the current delivery sequence.
- Runtime status below is intentionally high-level. Use linked issues and archive files for implementation history.

## Live

- **Core manager loop:** Supabase auth, manager/team setup, rider database, profiles, comparison, watchlist, notifications, and DA/EN localization. Finance legacy rows and Deadline Day countdown/warnings are locale-aware (#1352/#1353).
- **Market:** auctions with proxy bidding and finalization, direct transfers, swaps, transfer listings, and rider loans. Confirmed closed-window transfers are queued for the next window.
- **Squad and riders:** squad limits, dynamic market values, rider abilities, potential, retirement state, and rider popularity tracking. **Rider contracts (#1309):** `riders.salary` is now frozen at signing (no longer a generated column); `contract_length` (1-3 seasons) and `contract_end_season` are set at acquisition and carried unchanged on trade. Owned riders always have a contract; free agents show an estimated salary until signed. Contract flows (renewal, expiry-to-auction, release, re-signing formula) are fast-follow in the market package (#1310).
- **Economy:** 800K initial balance, division-scaled sponsor (D1 600K / D2 400K / D3 340K after Fase 1, E2 strict_fair_v1), variable sponsor from season two (0-150K performance bonus), salary at 6.7% of market value frozen at signing, interest/payroll processing, loans, finance ledger, forecast, and risk tiers. **Fase 1 anti-inflation (#1441, on branch pending relaunch review):** seasonal upkeep sink (D1 440K / D2 140K / D3 40K per season), sponsor payout hard-capped at 900K (720K season 1) post-modifier, emergency loan ceiling = division ceiling (D1 1.2M / D2 900K / D3 600K, hard-clamped), escalating debt enforcement (transfer freeze at 1 season over ceiling; forced highest-value rider sale at 2 consecutive seasons over ceiling).
- **Economy Fase 2 — renown-scaled, negotiable sponsor ([#1663](https://github.com/NicolaiDolmer/CyclingZone/issues/1663), on branch):** sponsor income now scales with a club's renown (`renownEngine.js`: division + recent-season results) instead of a flat per-division base, so a fresh/low-standing club is roughly unchanged while a strong, established club earns a bigger sponsor. Sponsors are **negotiable** at season start: three offers (`sponsorOffers.js` — `predictable` / `activity` / `long` variants) trade a guaranteed base against a per-race-day rate and a 1-3 season contract length; the choice is made on the Board page (`SponsorOfferModal`) and the active deal is shown on the Finance Sponsor tab (`SponsorContractPanel`). Contracts persist in a new **`sponsor_contracts`** table (`sponsorContractsService.js`), are auto-renewed at season transition, and back `GET /api/sponsor/contract`, `GET /api/sponsor/offers`, and `POST /api/sponsor/offers/accept`. **New per-race-day income:** a fixed amount per race day the team competes in, credited as races finalize (the per-race-day rate is set by the chosen sponsor deal). Behind the balance harness/calibration gate.
- **Season and competition:** season lifecycle, race catalogue/import, standings, prize payouts, board goals, season snapshots, and admin transition tooling.
- **Operations:** Sentry/Clarity instrumentation, player events, admin tools, migration automation, CI guards, and reproducible race-engine calibration gates.

### Economy slice 07 archive

- 07a stale fallbacks and sponsor drift: [details](archive/feature-status-slice-07a.md)
- 07b TOCTOU and idempotency: [details](archive/feature-status-slice-07b.md)
- 07c atomic balance updates: [details](archive/feature-status-slice-07c.md)
- 07d finance/admin audit trail: [details](archive/feature-status-slice-07d.md)
- 07e admin economy dashboard: [details](archive/feature-status-slice-07e.md)
- 07f variable sponsor: [details](archive/feature-status-slice-07f.md)
- 07g finance forecast and risk tier: [details](archive/feature-status-slice-07g.md)
- 07h season finance close-out: [details](archive/feature-status-slice-07h.md)

## Beta or feature-flagged

- **Race engine v2 (light motor):** deterministic simulator, stage profiles, race entries, multi-seed calibration gate (`race:gate` over {2026,7,42} since #1436), and admin dry-run are implemented behind `RACE_ENGINE_V2_ENABLED`; go-live code + physiology schema + ability v2 merged (#1428). The `RACE_ENGINE_V2_ENABLED` flag flipped **on** at the 2026-06-18 relaunch (verified `on` in prod `app_config` 2026-06-20), so the race engine is now authoritative; the legacy PCM result path is retained only as a backend fallback and its result-reporting UI was removed in #1532. **Abilities decide outcomes; `form`/`fatigue` are still neutral 0-stubs** — full physiology depth (#1021) is post-launch.
- **Daily training, form, fatigue, and injuries:** development phases are merged behind launch controls; relaunch orchestration and production verification remain.
- **Board and progression additions:** several post-season and progression surfaces are live but still have owner-verification issues before broad reliance.
- **Analytics-backed validation:** newer gameplay and funnel events need enough live traffic before product conclusions are stable.
- **Academy MVP — Fase A ([#1308](https://github.com/NicolaiDolmer/CyclingZone/issues/1308)):** Core pipeline delivered and flag-gated (`academy_enabled`, OFF until relaunch). Covers: season-intake cohort generation (`academy_intake` table), sign/reject flow (0-2 prospects per human team, 8-place cap separate from senior 30-cap, `riders.is_academy`), daily training with youth multiplier, and season upkeep drift (`academy_drift` finance type, 5 000 CZ$/slot/season at payroll). Notification types `academy_intake_ready`, `academy_signed`, `academy_rejected` wired.
- **Academy MVP — Fase B ([#1308](https://github.com/NicolaiDolmer/CyclingZone/issues/1308)):** Youth-market loop delivered and flag-gated. A rejected intake candidate is listed as an individual youth auction (`auctions.is_youth`, no seller); the winning club takes the prospect into its academy (8-place cap, youth contract) and pays its bid as an `academy_signing` sink; a prospect with no bid stays a free youth agent. New `signFreeAgentYouth` + `POST /api/academy/free-agent/sign` lets a club sign a free youth agent (age 16-21) straight into the academy at minimum salary, no signing fee. `GET /api/academy/me` now returns `freeAgents`; AcademyPage shows a Free youth agents section, AuctionsPage shows a Youth badge. No new migration (all DDL came in Fase A). System-wave integration of youth auctions remains the market package [#1310](https://github.com/NicolaiDolmer/CyclingZone/issues/1310).
- **Academy promotion flow at 22 ([#932](https://github.com/NicolaiDolmer/CyclingZone/issues/932)):** Closes the academy dead-end, flag-gated (`academy_enabled`). At season transition `detectGraduates` puts every academy rider who has passed 21 into a pending `academy_graduation` row (status pending/promoted/sold/released/expired) with a deadline, plus an `academy_graduation_ready` notification; the rider keeps `is_academy=true` (outside the senior cap) while pending. The owner chooses per rider via `POST /api/academy/graduate {riderId, action}`: promote (`is_academy=false` + a fresh senior salary, division squad-cap enforced), sell (lists a normal senior auction, `seller_team_id`=team, `is_youth=false`; auction finalization flips a sold graduate to `is_academy=false` for the winner), or release (free agent). A daily sweep (`runAcademyGraduationSweep`, after 22:00 CET, mirrors the training sweep) auto-resolves expired pending rows via a soft default chain (promote when there is room and the club is solvent, otherwise sell). `GET /api/academy/me` returns `graduations`; AcademyPage shows a graduation section with promote/sell/release + deadline. Open follow-up: an unsold listed graduate stays in the academy (no auto-release on no-bid yet); deadline window (`DEADLINE_DAYS`) pending a sim scorecard + owner sign-off.
- **Beta-access + feature staging:** feature flags now support three stages — `"off"` / `"beta"` / `"on"` (stored in `app_config`; legacy boolean `true`/`false` still read as on/off). A beta-tester cohort (`users.is_beta_tester`, plus implicit admins; `is_beta_tester()` RPC mirrors `is_admin()`) gets early access to a `"beta"`-staged feature while it stays hidden from regular players. `academy_enabled`, `daily_training_enabled`, and `race_engine_v2_enabled` are evaluated per-request via `evaluateFlagStage`; user-facing endpoints pass the viewer's beta status, while cron/sweep paths stay global (`"on"` only). Admins/beta testers can browse the 800 fictional relaunch riders (type, abilities, base_value) via the read-only **Rider Explorer** admin section (`GET /api/admin/fictional-rider-preview`, no DB writes).
- **Value tracks developed abilities ([#1364](https://github.com/NicolaiDolmer/CyclingZone/issues/1364)):** `base_value` is now a live read of the value model on current abilities (Model 1 — objective rating), recomputed after training so a developed rider gains value and an aging one loses it. `refreshChangedRiderValues` recomputes type + value for the population but writes only the riders whose value actually changed (no daily churn); it runs after the daily training sweep (full, doubles as reconcile) and after manual run-today (team-scoped). The model was re-fit on the 8 rider types and prod `base_value` re-backfilled (#1435, 8994 riders, 0 nulls), so prod values already reflect the current model; the after-training recompute stays dormant until `daily_training_enabled`/relaunch. No migration. Market-price gliding toward sale price stays a separate premium layer ([#1281](https://github.com/NicolaiDolmer/CyclingZone/issues/1281)). A no-DB balance scorecard (`backend/scripts/valueDevelopSellScorecard.js`) gates the develop-and-sell economics.

## Deferred or not yet live

- Full race-engine depth from [#676](https://github.com/NicolaiDolmer/CyclingZone/issues/676), including richer tactics and breakaway behavior.
- Academy facility tiers and drip-fed scouting reveals: post-launch, not in the MVP. (The 22-year-old forced choice is now delivered — see above, [#932](https://github.com/NicolaiDolmer/CyclingZone/issues/932).)
- Contract flows (renewal, expiry-to-auction, release, re-signing salary formula): market package [#1310](https://github.com/NicolaiDolmer/CyclingZone/issues/1310).
- Season recaps [#1311](https://github.com/NicolaiDolmer/CyclingZone/issues/1311).
- Hall of Fame and manager XP/login-streak power effects are planned for reduction under [#1139](https://github.com/NicolaiDolmer/CyclingZone/issues/1139).
- Admin economy dashboard phase-B conveniences remain deferred; see the [07e archive](archive/feature-status-slice-07e.md).

## Known bugs: top 10

Snapshot: 2026-06-12. Ordered by priority, then recency among open `type:bug` issues. See the full [GitHub bug list](https://github.com/NicolaiDolmer/CyclingZone/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22type%3Abug%22).

1. [#906](https://github.com/NicolaiDolmer/CyclingZone/issues/906) Lazy-chunk render error after deploy (`priority:high`).
2. [#45](https://github.com/NicolaiDolmer/CyclingZone/issues/45) Many small loans can exceed the debt ceiling (`priority:high`).
3. [#31](https://github.com/NicolaiDolmer/CyclingZone/issues/31) Debt negotiation does nothing on click (`priority:high`).
4. [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481) Brand identity overhaul remains open (`priority:high` and `priority:med`).
5. [#1342](https://github.com/NicolaiDolmer/CyclingZone/issues/1342) Playwright Windows workers hang after passing smoke tests (`priority:med`).
6. [#1337](https://github.com/NicolaiDolmer/CyclingZone/issues/1337) Tone/i18n guards are not required checks, allowing red checks to auto-merge (`priority:med`).
7. [#1301](https://github.com/NicolaiDolmer/CyclingZone/issues/1301) SEO foundation for cyclingzone.org remains open (`priority:med`).
8. [#1286](https://github.com/NicolaiDolmer/CyclingZone/issues/1286) Desktop plugin disable settings drift from configured keys (`priority:med`).
9. [#1285](https://github.com/NicolaiDolmer/CyclingZone/issues/1285) Intermittent GitHub GraphQL 401s during multi-agent waves (`priority:med`).
10. [#1017](https://github.com/NicolaiDolmer/CyclingZone/issues/1017) Preview deployments block authenticated UI verification (`priority:med`).

## Next-up pipeline

1. Ship team selection, captain, and breakaway controls: [#1307](https://github.com/NicolaiDolmer/CyclingZone/issues/1307).
2. Contract data seed delivered (#1309). Contract flows (renewal, expiry, release) are fast-follow in [#1310](https://github.com/NicolaiDolmer/CyclingZone/issues/1310).
3. Complete academy MVP: [#1308](https://github.com/NicolaiDolmer/CyclingZone/issues/1308).
4. Finish relaunch verification and flag activation for the 2026-06-20 target: [#1105](https://github.com/NicolaiDolmer/CyclingZone/issues/1105).
5. Continue the market and recap fast-follow work after the relaunch-critical path: [#1310](https://github.com/NicolaiDolmer/CyclingZone/issues/1310) and [#1311](https://github.com/NicolaiDolmer/CyclingZone/issues/1311).
