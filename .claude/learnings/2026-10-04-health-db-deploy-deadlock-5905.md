# Health DB dependency blocked incident recovery (#5905)

Root cause: Railway deploy liveness used an exact-count DB HEAD. DB pressure
returned 503 on /health and kept the recovery hotfix from becoming active.

Fix: DB-free /health and bounded one-row /health/ready. Deployment smoke retains
the DB gate with shared finite retries and validates the readiness payload.
Abort alone is insufficient for transports that ignore cancellation: a hard
deadline must also settle the response. Both paths disable caching.

Evidence: isolated real HTTP tests first reproduced 503 instead of 200; retry
tests first reproduced one-shot failure and acceptance of liveness-only 200.
Tests inject the timestamp and use mock timers for hung transports.

External monitor configuration is not established by a grep of the repo; operators
must migrate any DB monitor still using /health to /health/ready.
