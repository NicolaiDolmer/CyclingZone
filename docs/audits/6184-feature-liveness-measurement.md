# Feature-liveness duplicate count: staging evidence

Refs #6184. SSOT: [FEATURE_LIVENESS.md](../FEATURE_LIVENESS.md).

The caller is `backend/scripts/audit-feature-liveness.js`; the workflow ran
that database-backed audit separately for JSON and human-readable text.
The change gathers one JSON snapshot and renders text without credentials.
Exact table counts, detector rules and failure behavior remain unchanged.

Latest paired replay completed 5 October 2026 at 23:59 Copenhagen time.
Isolation returned `ISOLATED` for load-test staging. Earlier #6170 prerequisite
check returned 1,889,644 results and `DATA_PREREQUISITES_READY`, not a full load
pass. No live data, schema, feature flag or production write was performed.

| RPC component per normal workflow run | Before | After |
|---|---:|---:|
| Calls | 2 | 1 |
| Returned table-summary rows | 536 | 268 |
| Mean run time, three pairs | 1197.49 ms | 559.86 ms |
| Mean call time | 598.74 ms | 559.85 ms |

Every complete row array was identical across all nine RPC calls.
Raw measurements: [6184-feature-liveness-staging.json](6184-feature-liveness-staging.json).
The benchmark prints fixed failures rather than raw payloads on mismatch,
malformed JSON or request failure; failure tests prove that the RPC branch ran.

Limitations: this fixed-order replay measures the RPC component, not whole
workflow latency, production savings or concurrent-load acceptance. Cache
effects can influence timings. Normal invocation count is halved; retries can
still add calls. The remaining exact-count RPC and its scan cost are unchanged.
The existing production measurement's per-call time is not a staging baseline.
