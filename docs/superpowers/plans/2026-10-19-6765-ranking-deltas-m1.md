# #6765 M1 implementation plan

Design: PR #6849, additive shadow phase. Owner build mandate: 19 October 2026, this chat.
No reader swap, production writes, flag change or player-visible change.

- [x] Establish local PG17 baseline using existing four matview definitions and deterministic fixtures.
- [x] Write failing parity tests; implement contributions, append-only dirty queue, statement triggers, bounded processor and season backfill.
- [x] Verify all columns, NULLs, corrections, transfer, metadata/deletion, truncate/rebuild, rollback and concurrent writes.
- [x] Add coordinator shadow pass and parity reporting while preserving legacy lease/heartbeat and schema compatibility.
- [x] Measure full refresh versus changed-race processing on identical data.
- [x] Migration lints, FULL components under semaphore (Windows-safe backend batches), preflight, independent review, guarded commit, push, one PR Refs #6765. PR #6899 tracks CI/review on the pushed HEAD; no merge is included.

Review focus: aggregate types and NULLs; old/new attribution; transactional queue; serialization; source-row locks; short migration locks without in-transaction backfill.
Patch notes exempt: shadow data has no player-visible behavior. Staging T7 and M2 observation gates remain separate.

Operational extension, owner mandate 19 October:
- [x] Off-seeded ranking_shadow_enabled in stage catalog and registry; gate runtime apply/parity.
- [x] Queue/pass logs and Sentry operational budgets, including off runs.
- [x] Daily parity outside Danish evening peak, client elapsed time plus SQL admission guard.
- [x] Authorized Supabase-branch first rebuild and one-pass measurement; parity zero, flag off.
- [x] Slow monitoring lease and peak-crossing regressions reproduced and fixed; independent re-review clean.
Evidence and branch authorization: docs/audits/2026-10-19-6765-operational-readiness.md.
