# Ranking refresh: SQL must precede the caller

Refs #5692. SSOT: docs/GAME_INVARIANTS.md.

Cause: draft #6153 introduced boolean RPC calls alongside a SQL proposal that
auto-migrate never reads. Even promoting both in one main push is unsafe:
auto-migrate waits three minutes while Node may deploy first.

Fix: additive overload migration in its own SQL/test/docs PR. Preserve all old
no-argument functions and keep Node activation in the dependent draft PR.
Require explicit SQL merge/apply go and positive signature/ACL/cache/staging
verification before a separate Node release go. No production apply here.

Regression: fresh in-memory PostgreSQL catalog had zero boolean overloads;
the availability assertion failed. Raw SQL then supplies all five, with actual
role/grant, true-only, repeat-apply and old-function/data-preservation checks.
The existing real PG17/PostgREST test supplies separate transport/lock evidence.
Neither fixture proves production volume, freshness or training performance.

Lesson: a green combined PR is not a dependency-order guarantee. Make the
database prerequisite independently reviewable and keep rollback signatures.
SQL-only preparation has no current player change; release notes belong to the
later owner-approved Node activation.
