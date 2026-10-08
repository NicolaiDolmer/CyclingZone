# Watchdog became a DB competitor (#6102)

Root cause: candidate metadata used paginated rider-result rows ordered by id.
The DB plan could scan the primary key and filter after sorting/paging. An
8,000-row regression fixture made nine result-page reads before the fix.

Prepared fix: service-role-only bounded POST summaries: latest import, any
positive prize and all distinct stage_number keys. No result_type/squad filter.
Missing or malformed aggregate payloads fail closed; no bulk fallback.

Parity traps: ANY positive is not SUM; NULL-only imports retain the existing
prize anomaly. Stage_number is not zero-based stage_index. Global DESC latest
timestamp keeps its existing NULLS FIRST behavior in this refactor.

Raw SQL applied twice locally proves idempotency/grants; actual SET ROLE probes
prove service-only access. Correctness and SDK transport tests are not realistic
staging latency evidence. The proposal remains unapplied outside auto-migrate;
prod apply requires Nicolai's literal mandate and release measurements.

Independent review caught the ACL rollout window: psql auto-commits statements,
while db.exec batches them implicitly. A statement-by-statement failure test was
red until the entire function/ACL/notify proposal used explicit BEGIN/COMMIT.
CodeRabbit caught the unapplied-proposal call path: a red test now proves no RPC
invocation before a positive schema_migrations marker. Absent marker is an error,
not clean state. No flag or cached schema assumption grants activation.
The register key includes the database/ prefix emitted by auto-migrate, not the
basename. A real-SDK query/payload regression was red on the basename mismatch.
