# #8215: dashboard ranking latency investigation

Status: migration and backend candidate in draft PR #8736. The first sections
record the original investigation. See the final section for the candidate and
local HTTP evidence. No migration has been applied to production.

Owner mandate: [25 November coordination decision](https://github.com/NicolaiDolmer/CyclingZone/issues/8719#issuecomment-7175611595).
Scope: [#8215](https://github.com/NicolaiDolmer/CyclingZone/issues/8215),
`GET /api/dashboard/rider-ranking`, `readDashboardTopRiders7664`.
SSOT: [DASHBOARD_RULES](../DASHBOARD_RULES.md), especially the secondary-card
failure contract; [rule 36](../AGENT_RULE_DETAILS.md#regel-36).
The lane brief requires a docs draft and a stop before migration code if the
preferred solution needs a migration. This document is that handoff.

## Observed production evidence, 25 November 2026

Sentry read-only API lookup returned CYCLINGZONE-BF, unresolved, 13 recorded
events, first seen 15 November and last seen 25 November at 17:33:50 UTC.
The latest event names `GET /api/dashboard/rider-ranking` and reports
`dashboard top riders: shadow path exceeded 1500 ms`. This confirms a recent
timeout, not an already-green result. The 13 reports are not a request failure
rate: fallback reporting is suppressed during the existing hold window.

The original trace named in the issue returned no transaction rows. The latest
event was readable through the organization-scoped event API; its breadcrumbs
include unrelated concurrent backend activity and no measured ranking-query
durations. They cannot identify which ranking step consumed the budget.
No raw event, URL parameters, identity or private payload is published here.
API reference: [retrieve an issue event](https://docs.sentry.io/api/events/retrieve-an-issue-event/).

Production catalog queries ran inside `BEGIN READ ONLY` with an explicit
statement timeout. PostgreSQL reported version 17.6 and read-only mode on.
The ranking shadow has one unique index on `(season_id, rider_id)` and no
foreign-key relationship to `riders`. Its estimated size was 22,140 rows;
`riders` and `teams` estimates were 20,374 and 682. These are catalog estimates,
not exact counts or a distribution of game scores.

The read-only role cannot access the `extensions` schema containing
`pg_stat_statements`. The attempted statistics query failed with permission
denied. No privileges were changed. Production p50/p95, fallback duration and
the slow database operation therefore remain **unmeasured**. No authenticated
production HTTP request was replayed.

## Current request and fallback contract

The route authenticates, resolves the active season, then tries the shadow
reader. Its response cache is partitioned by the manager's current pool and
uses the existing dashboard TTL. No active season returns `{ riders: [] }`.

Source selection checks both existing flags, completed rebuild and queue lag.
The chosen source is cached per backend client. A cold source adds requests;
the current source cache does not coalesce concurrent cold lookups.

Without a pool, the reader fetches ordered ranking pages and display records
until five eligible riders are found. With a pool it fetches teams, paginates
eligible rider identifiers, requests top five per bounded identifier chunk in
parallel, merges deterministically, then fetches display records. This is
multiple network rounds and chunk fan-out, not necessarily one query per rider.
The global paging hypothesis in the issue is not confirmed as the timeout's
cause; the failing event does not establish which scope it used.

The existing total shadow budget includes source selection. Shadow failure or
timeout returns `null`; the route then calls the existing legacy ranking RPC
and GC/classic split helper. An actual shadow failure activates the existing
per-client fallback hold and rate-limited reporting. Source-selection timeout
returns legacy without a shadow-failure report. The legacy RPC and enrichment
time are additional to the shadow budget; the whole HTTP duration is not
bounded by the shadow timer. This investigation does not increase any timeout.

## Local PG17 baseline and candidate experiments

Measured before product edits on base `0b65d71d7`, native PG17.11, Windows,
under `verify-lock.ps1 -Max 2`. An isolated single-user cluster exited normally
after each run; no listening server or background job was left behind.

The final fixture used UUID rider/team/season keys, 22,140 shadow rows across
two synthetic seasons, 20,374 riders, 682 teams and 11 synthetic pools. It
includes ties, NULL points and retired riders. Table volumes follow the catalog
estimates, but distribution, row widths and names are synthetic. The existing
unique ranking index and a rider-team lookup index were present initially.

Each SELECT used `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)`, ten repetitions per
shape. The same fixture and input were retained for the candidate index.
The table reports the sixth ordered sample of ten, explicitly an upper median.
Execution times exclude planning, HTTP/PostgREST, authentication, source
selection, response caching, RPC enrichment and concurrent production work.

| Query shape | Upper median, ms | Observed range, ms |
|---|---:|---:|
| Existing pool-team lookup | 0.049 | 0.042-0.062 |
| Existing pool-rider page | 2.148 | 2.015-2.398 |
| Existing ranking chunk | 0.189 | 0.175-0.376 |
| Existing global ranking page | 2.975 | 2.620-3.423 |
| Existing display lookup | 0.079 | 0.071-0.117 |
| Candidate pool join, existing indexes | 4.680 | 4.354-4.810 |
| Candidate global join, existing indexes | 14.086 | 12.491-15.282 |
| Candidate pool join, ordered ranking index | 0.462 | 0.420-0.534 |
| Candidate global join, ordered ranking index | 0.228 | 0.210-0.279 |

These are individual SQL shapes, not timings for complete old/new endpoints.
The chunk sample uses a bounded synthetic identifier set, not a measured
complete pool request. Adding these numbers does not establish endpoint p95.
The first scratch attempt had an ambiguous display-column alias and was
discarded; the final run had no SQL errors. An earlier integer-key experiment
was also discarded in favor of the UUID fixture above.

EXPLAIN for the ordered-index join showed an ordered ranking index scan feeding
nested-loop lookups, rather than sorting the joined season result. In the final
sample it examined 75 ranking rows for the pool case and five for the global
case; the global root reported 38 shared buffer hits. These describe this
synthetic fixture only. There was no cold-cache or simultaneous-reader run.

The experiment argues against a join-only change: SQL execution became more
expensive without its ordered index. It also shows that local SQL execution
alone does not reproduce the observed 1.5-second production failure.

## Proposed additive design; implementation stopped

Recommend evaluating a new read-only, service-only dashboard shadow RPC plus
an ordered index on season, points descending with NULLs last, and rider ID.
Keep the existing shadow table, writers, unique key, source selection, timeout,
fallback RPC and response cache contracts. The new RPC would be an additional
reader, not a replacement of a deployed function. Validate its signature,
idempotent creation, grants and security mode under the normal migration rules.

The RPC would join ranking rows to existing non-retired riders and optionally
their current team. Pool filtering must use the current team's division,
matching the shadow path rather than changing to historical race membership.
Global scope must retain eligible riders without a current team. Sort the
raw points descending, NULLs last, then rider ID ascending; apply top five only
after eligibility and pool filtering. Return the existing fields and numeric,
NULL and missing-team defaults exactly. Do not sum scores again or change
season totals. A single statement also gives one snapshot for ranking and
display data, avoiding the current race between sequential reads.

There is no catalog foreign key allowing a direct embedded PostgREST ranking
to rider join. Do not assume the current rider-to-team embed supplies that
missing relationship. An RPC/index needs schema work, so **no migration code or
backend change is included**. A future builder must first validate this design
against production read-only query plans and the complete request baseline.
An ordered index adds storage and update cost to shadow maintenance; benchmark
those costs before acceptance. Do not add a foreign key merely for embedding:
that would impose new write semantics on the existing shadow pipeline.

## Test and acceptance plan for the next lane

The existing shadow budget and historical three-second dashboard expectation
are regression boundaries. No new owner-approved p95 improvement target is
specified in #8215; obtain a named acceptance target before claiming green.

1. Recover usable transaction spans or obtain a sanctioned authenticated GET
   trace. Measure source selection, shadow query/transport, fallback RPC,
   fallback enrichment and total response separately, with warm/cold response
   and source caches. Report sample counts, p50/p95 and timeout frequency.
2. Reproduce both scopes with a disposable networked PG17/PostgREST harness.
   Match UUID types, production indexes, row volumes and representative pool
   sizes. Compare the unchanged reader and candidate on the same fixture,
   inputs and conditions; include large pools, empty pools and retired leaders.
3. Compare every response field against the frozen old shadow reader: exact
   top-N membership/order, ties, NULL/zero points, all win totals, display
   defaults, moved teams, missing teams/riders, other seasons and pool filters.
   Verify the real Express GET route and its cache partitioning, not just SQL.
4. Prove flag-off/legacy-source and empty-array behavior unchanged. Inject fast,
   slow and unavailable shadow sources; check abort, unchanged timeout, legacy
   payload, fallback duration, hold expiry and single reporting. Inject `now`;
   tests must not use the wall clock for game behavior.
5. Test simultaneous cold source reads, warm reads, mixed pools and overlapping
   ranking updates/rebuilds. Count requests, observe locks and stale/torn
   payloads; no polling or production writes. Decide separately whether source
   lookup coalescing is warranted. Preserve pool isolation and cache freshness.
6. Validate migration replay, service-only access, statement/lock timeout,
   index-build locking, rollback and shadow-writer overhead. Use additive
   objects; stop for owner/Claude migration handling. Apply nothing here.
7. Assigned verification: focused contracts first; backend full suite, lint,
   type guards and preflight before implementation handoff under the shared
   semaphore. The orchestrator owns the FULL/e2e slot. Do not start it without
   confirmation. Keep the PR draft and request independent review.

No UI or player text changes are proposed here, so before/after screenshots
and a player patch note do not apply to this docs-only investigation. A later
runtime delivery must follow the wave's consolidated patch-note process.

## Implementation and local HTTP verification, 26 November 2026

PR #8736 adds the service-only PostgreSQL reader and ordered index. The existing
shadow eligibility and fallback remain in place. During an additive migration's
deployment window, a missing RPC or stale PostgREST schema cache uses the previous
shadow reader within the existing budget. Other RPC errors use the existing legacy
path. The function has no per-function settings. The index builds concurrently under a short session lock timeout. The function and grants share a bounded transaction and request a schema-cache reload.

The same Express GET handler was mounted from the previous revision and from
this candidate, with actual response caching, controlled authentication and
source-readiness fixtures, an in-process PostgreSQL 17 (PGlite) database and a
PostgREST-shaped query adapter. Both variants used the earlier 22,140-row
synthetic ranking fixture. Each sample starts before the localhost HTTP request
and ends after reading the body. Application cache and source-read cache were
invalidated for cold samples. Each cold request was followed by a verified cache
hit. All four scopes returned deeply equal JSON before and after. These figures
measure the complete local HTTP request with fixture authentication and query
transport. Deployed authentication, PostgREST network latency, read concurrency
and shadow-writer overhead were outside this measurement.

| Scope | Cold n/side | p50 before to after (ms) | p90 before to after (ms) | Backend calls |
| --- | ---: | ---: | ---: | ---: |
| Global | 10 | 7.88 to 2.25 | 9.88 to 3.92 | 5 to 4 |
| Populated pool 1 | 10 | 23.32 to 2.82 | 27.49 to 3.05 | 25 to 4 |
| Populated pool 2 | 10 | 31.82 to 2.62 | 34.47 to 2.85 | 25 to 4 |
| Empty pool | 10 | 0.92 to 1.44 | 1.12 to 1.81 | 4 to 4 |

Cache hits made zero backend calls and measured 0.34–0.66 ms p50 across the
eight samples of ten. The fixture did not reproduce the production timeout.
The endpoint's earlier regression boundary remains the same. There is no
owner-approved production improvement target or rollout measurement yet.

The database test replays the actual migration after a simulated interrupted index build and again after a successful run. It checks index validity, role grants and function settings, and locks the complete prior payload against the RPC on
global, populated and empty pool fixtures, including decimal points, ties,
NULLs, missing teams, other seasons and retired riders.
