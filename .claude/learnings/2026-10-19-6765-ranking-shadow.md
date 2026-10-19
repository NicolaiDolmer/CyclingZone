# #6765: incremental aggregate correctness

The existing ranking definitions rescan all race results. M1 adds a compressed
race contribution layer and recomputes affected keys without changing readers.

Three review lessons are now regression-tested:

- A transfer's old team cannot be reconstructed only from surviving
  contributions. Deleting the last contribution before later queue batches
  drain loses that evidence. Invalidate the old team's existing summary keys.
- TRUNCATE riders has no old transition rows. Rebuild must invalidate existing
  summaries as well as queue existing/orphan race IDs.
- Best-effort work still extends a critical path when awaited before legacy
  acknowledgement. Renew the lease before, between and after shadow RPCs.

Nullable season keys also belong to the legacy contract: UNIQUE NULLS NOT
DISTINCT and NULL-aware matching preserve them. SQL parity uses independent
legacy SELECTs and both EXCEPT ALL directions, rather than only row counts.
Native PG17 baseline and measurements: docs/audits/2026-10-19-6765-local-pg17.md.
# Operational review follow-up

Metrics and flag reads consume the legacy lease even when shadow work is off.
Renew before and between those reads and after the flag read. Reproduce with
an injected monotonic clock and slow reads; do not rely on fast mocks.
Peak admission must include elapsed legacy/apply work. SQL also checks its own
execution clock so queued RPC admission cannot cross into the Danish peak.
Database deferral remains due and is not a parity mismatch. Boundary tests use
explicit summer/winter instants. Both review regressions are now green.
# Kill-switch and hot-trigger review

Gating only Node consumers lets producers accumulate unbounded off work. Skip
source deltas while off, retain one repair marker and require rebuild on enable.
Serialize the flag transition against both source commits and processors; test a
source transaction held open across an attempted enable, plus stale Node admission.
Use an AFTER ROW WHEN guard for rare team changes on the hot riders table.
Measure the unchanged-team bulk workload with rollback on the authorized branch;
report callback time separately from total execution and retain sample spread.
