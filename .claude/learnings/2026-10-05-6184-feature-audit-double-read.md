# 5/10: Feature-audit counted the same tables twice per CI run

Root cause: feature-liveness-audit.yml invoked the database-backed audit once
for JSON and again for text. Each invocation performed all enabled detector
reads, including a full exact count of every public table.

Fix: collect one JSON snapshot and render text without database credentials.
The existing CLI text mode shares the same formatter. Exact counts, detector
rules, whitelists, retries and strict failures remain unchanged.

Evidence: 35 focused tests; paired staging samples recorded in
`docs/audits/6184-feature-liveness-staging.json`. RPC calls per workflow 2 -> 1,
returned table rows 536 -> 268, identical row contents across all samples.
The remaining exact-count RPC is still expensive; this fix removes duplication,
not its scan cost. JSON/text now share one timestamp and findings snapshot.

Lesson: inspect workflow callers before redesigning the database contract.
Refs #6184.
