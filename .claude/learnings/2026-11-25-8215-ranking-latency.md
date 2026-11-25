# #8215 investigation: transport and SQL need separate evidence

25 November 2026. Investigation only; no fix or production change delivered.

- The current Sentry event confirms a dashboard ranking shadow timeout. The
  historical trace returns no transaction rows; breadcrumbs alone do not prove
  which query was slow or which pool scope was selected.
- Read-only production catalog access works, but `pg_stat_statements` access
  fails for the available role. Missing metrics are not zero latency.
- The shadow table has no rider foreign key. Do not implement an assumed
  PostgREST embed before checking the catalog.
- Local PG17 with UUID keys and production-sized synthetic table volumes shows
  a join without an ordered index can cost more SQL time. An indexed join is
  promising, but neither experiment measures HTTP, fallback or concurrency.
- A migration-based reader is outside this lane's implementation boundary.
  Deliver its additive design and explicit remaining tests; do not raise the
  timeout or claim the defect fixed from a fast local SELECT.

Durable evidence and next steps: [audit](../../docs/audits/8215-ranking-latency.md).
