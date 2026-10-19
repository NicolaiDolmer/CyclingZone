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
