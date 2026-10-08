# #6102 watchdog result metadata

Authorized backend performance refactor. SSOT: docs/GAME_INVARIANTS.md race
completion/monitoring contract, docs/RACE_ENGINE_RULES.md result lifecycle,
docs/YOUTH_RULES.md §7 no youth prize source. No player copy or scheduler behavior.

1. Reproduce bulk race_results transfer with 8,000-row fixture before fix.
2. One service_role-only SECURITY INVOKER/STABLE RPC summary per candidate:
   MAX(imported_at), ANY prize_money>0, distinct stage_number including NULL/0/negative,
   across all result_types. Zero rows => NULL/false/empty stages.
3. Typed client chunks 300 IDs via POST, validates complete/exact payload, fails
   closed on any transport/permission/shape failure. Preserve existing finding
   evaluator and global latest-result NULL ordering. Keep entry query semantics;
   shorten its IN chunks to remain below the URL transport ceiling.
   Require a positive schema_migrations marker before the new RPC can be called.
   Wrap function/ACL/notify SQL in one transaction to eliminate PUBLIC rollout gaps.
4. SQL/legacy-JS parity, empty/NULL/youth/negative prize, time boundaries with
   explicit now; raw migration twice plus actual SET ROLE denial/allow tests.
5. EXPLAIN body SELECT read-only without ANALYZE against prod metadata. Realistic
   staging measurement remains blocked by #5904's measured schema/volume gap.
6. Preflight, strict TS, FULL, CodeRabbit, independent read-only diff; draft PR.

SQL stays in database/proposals: prepared, not applied, outside auto-migrate.
Session forbids prod writes without literal owner 'kør'; no merge/apply until
mandate and staging evidence exist. After go, move proposal to top-level in the
same PR and rerun idempotency/role checks before merge/automatic apply/post-verify.
