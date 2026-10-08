# Watchdog candidate aggregates: staging evidence, 7 October 2026

Refs #6102 / #5904. SSOT: [GAME_INVARIANTS.md](../GAME_INVARIANTS.md).
Compared the real main fetchWatchdogState at 5bebe0e2798603d39278afa8b30d909360800d18
with this branch, through the real Supabase SDK/HTTP transport. Both used the same
fixed evaluation time, 2026-10-07T09:00:00Z, and the same staging database with
1,889,644 results. Only state fetch and pure evaluation ran; no cron, scheduler,
notification dispatch or game engine ran.

The existing SQL proposal was applied only on isolated staging, followed by its
canonical marker. anon/authenticated EXECUTE=false, service_role=true. Production
was not changed. The proposal stays outside auto-migrate pending the owner's
release/migration decision.

| Measurement | Current main | Aggregate branch |
|---|---:|---:|
| End-to-end watchdog state fetch | 10,047.69 ms | 1,689.48 ms |
| HTTP requests | 96 | 17 |
| Returned rows across all requests | 27,580 | 7,162 |
| Longest URL | 2,303 bytes | 2,303 bytes |
| Candidate races | 85 | 85 |
| Evaluated findings on stale staging fixture | 93 | 93 |

Full states and every finding were identical. Remaining returned rows include
race-entry pagination and schedule data; candidate-result rows now stay in SQL.
The 93 findings are fixture state, not newly emitted production alerts. No raw
rows, identifiers, names or amounts are written to the report.

A representative aggregate EXPLAIN ANALYZE on staging used
idx_race_results_race_id_stage_id, scanned 1,881 result rows and emitted one row
in 2.123 ms. This is one selected candidate plan, not a plan for all 85 candidates.
One before/after run is observational evidence, not a statistical latency claim.
[Machine report](6102-watchdog-staging.json) includes per-endpoint counts/timings.

Run only through scripts/staging/with-loadtest-staging.ps1 in one verify-lock slot:
node backend/scripts/staging/measureWatchdog6102.mjs --apply-staging-proposal
The explicit flag allows only this proposal on the hard-pinned staging target.

This does not satisfy #5904's full race-day gate: its fresh volume check requires
1,931,805 rows (production catalog estimate), so the current staging snapshot is
below that conservative threshold. Full pinned race-day/load, prod rollout and
post-deploy measurements remain open. No player copy or patch notes are needed
for this operational measurement.
