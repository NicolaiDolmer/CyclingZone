# Event-driven ranking refresh, staging 6 October

Refs #5692. SSOT: [GAME_INVARIANTS.md](../GAME_INVARIANTS.md).
Owner freshness contract: [2 October](https://github.com/NicolaiDolmer/CyclingZone/issues/5692#issuecomment-5958273085).
Owner prioritized implementation/staging on 6 October at 13:30 following another restart.
No production writes or deployment performed by Codex.

Staging `pywxpnynzmbukdvoiazp`: isolation ISOLATED, prerequisites
DATA_PREREQUISITES_READY, 1,889,644 results. `loadTestPassed=false` is retained:
this is not a full pinned race-day/load-test pass. PostgreSQL 17.6, 512 MB shared
buffers, 5 MB work_mem, approximately 3.44 GB database, all five views populated
with eligible unique indexes. service_role statement_timeout is 60 seconds.

| Three unchanged ticks | Before | After |
|---|---:|---:|
| Full refresh RPCs | 15 | 0 |
| Mean end-to-end tick | 7,976.78 ms | 83.37 ms |
| Combined view rows | 53,008 | 53,008 |
| Matching content fingerprints | baseline | 5/5 |

Before is three warm-cache passes of the committed old helper at
`37b603096be2718d61462cf1ad697ef0dee69c11`. To repeat it, copy the measurement
harness into that baseline worktree; the before phase rejects the new helper.
After excludes
one explicit priming pass and measures three normal unchanged checks. The
initial observation file preserves a cold first pass and its earlier reader
probe method; it is not the concurrent-reader proof. The corrected before
harness produced 158 concurrent HTTP reader samples with zero errors.
RPC/tick timings include network and measurement instrumentation, not pure
SQL execution time. View calculations are unchanged; this measures skipped
unnecessary work, not a speedup of a full aggregation.

Real staging event: a team-name update and restoration committed in one
transaction restored the source value but registered both changes. Normal
background wakeup returned in 0.351 ms and completed one five-RPC pass in
68.05 seconds from hook invocation. Pending work cleared. No engine, scheduler
flag or external notification was activated by the measurement.

Evidence: before/after JSON, full-content fingerprints, event freshness and
cross-client measurement files in this directory. Raw player rows/names are
not included. The scripts use the clean staging wrapper and one verify-lock slot.

Remaining limits: production effect and server peak RSS are unmeasured; full
aggregations still scan historical inputs when an actual event requires them.
Legacy external writers and a full pinned race day are not validated here.

After review hardening, the latest unchanged-tick measurement is 83.37 ms
(the earlier 69.04 ms observation is historical). Heavy RPCs now validate
token/version and expiry under the writer lock. Claim takeover cannot occur
while an expensive writer holds that lock. Production lease decisions use DB
time after row admission; only deterministic fixtures pass a SQL-time override.
