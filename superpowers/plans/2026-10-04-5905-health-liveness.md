# #5905: hotfix deployment during DB outage

Authorized scope: issue #5905 and Nicolai's ordered stability session. Backend bugfix,
no new player behavior or copy. SSOT: docs/ARCHITECTURE.md health contract;
docs/DEPLOYMENT.md release verification; docs/DB_RESTORE_RUNBOOK.md restore evidence.

1. Extract existing health handler mechanically and reproduce DB outage as HTTP 503
   on the deployment endpoint (observed red before changing behavior).
2. Keep Railway /health as DB-free liveness. Move bounded one-row HEAD to
   /health/ready, with both abort and a hard deadline, no cached/upstream details.
3. Share bounded readiness retry CLI between CI and local deploy smoke; update
   other DB-check consumers and the contract/docs in the same PR.
4. Test real isolated HTTP routing, failed/hung DB, bounded queries and recovery;
   retry recovery/exhaustion and non-ready 200. Explicit test clock, no server/cron import.
5. Preflight, FULL, strict TS, CodeRabbit and independent read-only diff. Merge via
   queue, immediate done-label, exact-SHA production READY and readiness smoke.

Patch notes omitted: infrastructure repair only; Codex session forbids player copy.
No schema, flag, data, population or feature-registry mutation.
