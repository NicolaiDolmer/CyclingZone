# Ranking shadow liveness behind an independent OFF control

Refs #6765. Root cause: the legacy callback returned false before shadow maintenance when any refresh RPC failed. Cooldown and training-deferred admission returned without entering that callback. Shadow enablement alone could not provide liveness.

The new control attempts shadow first under a claimed version, or without a legacy lease when admission skips the callback. The legacy return/acknowledgement/heartbeat contract remains authoritative. Existing SQL fences, version watermarks and bounded drains remain in use. Configuration errors are captured and retain the old path.

Two secondary failure modes matter: shadow can legitimately precede stale legacy views, so parity waits for a clean tick; and superseded callers sharing one queued follow-up must not each start another heavy fallback. Regression tests cover both. Separate shadow failures remain captured without disguising a failed legacy publication.

Before implementation, both liveness regressions failed because no apply was attempted. The targeted ranking suite now passes, including an unresolved legacy RPC, lost lease, version drain beyond the soft budget, cooldown, both deferred paths, configuration failures and shared callers. Native PG17 evidence and its limits are recorded in `docs/investigations/2026-11-10-6765-before-after.md`.

No reader change, planner setting, production write, activation or acknowledgement redesign. Parent owns independent review, broader verification and publication. No player text or patch note: invisible technical work behind a newly OFF control.
