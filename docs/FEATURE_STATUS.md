# FEATURE STATUS

_Slim live-state. Historical implementation detail lives in `docs/archive/`._

Last reviewed: 2026-06-12. GitHub issues are the source of truth for active work.

## Product direction

- The approved [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) centers the game on four engines: racing, training, youth development, and transfers/auctions.
- The hard relaunch target is 2026-06-20; [docs/NOW.md](NOW.md) carries the current delivery sequence.
- Runtime status below is intentionally high-level. Use linked issues and archive files for implementation history.

## Live

- **Core manager loop:** Supabase auth, manager/team setup, rider database, profiles, comparison, watchlist, notifications, and DA/EN localization. Finance legacy rows and Deadline Day countdown/warnings are locale-aware (#1352/#1353).
- **Market:** auctions with proxy bidding and finalization, direct transfers, swaps, transfer listings, and rider loans. Confirmed closed-window transfers are queued for the next window.
- **Squad and riders:** squad limits, dynamic market values, rider abilities, potential, retirement state, and rider popularity tracking. **Rider contracts (#1309):** `riders.salary` is now frozen at signing (no longer a generated column); `contract_length` (1-3 seasons) and `contract_end_season` are set at acquisition and carried unchanged on trade. Owned riders always have a contract; free agents show an estimated salary until signed. Contract flows (renewal, expiry-to-auction, release, re-signing formula) are fast-follow in the market package (#1310).
- **Economy:** 800K initial balance, 240K season-one sponsor, variable sponsor from season two, salary/interest/payroll processing, loans, finance ledger, forecast, and risk tiers.
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

- **Light race engine:** deterministic simulator, stage profiles, race entries, calibration gate, and admin dry-run are implemented behind `RACE_ENGINE_V2_ENABLED`; the legacy PCM path remains authoritative while the flag is off.
- **Daily training, form, fatigue, and injuries:** development phases are merged behind launch controls; relaunch orchestration and production verification remain.
- **Board and progression additions:** several post-season and progression surfaces are live but still have owner-verification issues before broad reliance.
- **Analytics-backed validation:** newer gameplay and funnel events need enough live traffic before product conclusions are stable.

## Deferred or not yet live

- Full race-engine depth from [#676](https://github.com/NicolaiDolmer/CyclingZone/issues/676), including richer tactics and breakaway behavior.
- Academy MVP [#1308](https://github.com/NicolaiDolmer/CyclingZone/issues/1308).
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
