# #6115: withdraw offers on actual ownership changes

Goal: owner decision A, 3 October: cancel open offers atomically with a rider's actual team change.
SSOT: [TRANSFER_MARKET_RULES.md](../../TRANSFER_MARKET_RULES.md).
Design-go: [owner decision](https://github.com/NicolaiDolmer/CyclingZone/issues/6115#issuecomment-5970689080) and this session's explicit implementation mandate.
Architecture: independent AFTER UPDATE trigger, null-safe owner comparison, SECURITY INVOKER; no history repair.

- [x] Reproduce missing cancellation in PGlite; original AI acquisition assertion fails pending versus withdrawn before the fix.
- [x] Add database/2026-10-03-6115-withdraw-offers-on-owner-change.sql; retain terminal offers, both swap positions and unrelated riders.
- [x] Test same-owner, null transitions, repeats, transaction/statement rollback, RLS/grants, accepted execution and deferred arrival.
- [x] Run both real migration definitions in either order; assert condition/injuries unchanged and no duplicate offer updates.
- [x] Update transfer SSOT, patch note 7.335 (7.334 reserved by #6119), bug learning and GitHub claim/coordination.
- [x] FULL verification via verify-lock, frontend lint and preflight; copy-only patch text review, no UI markup changes.
- [ ] Guarded commit, push, attach reviewable PR; observe CI/review, fix findings. No merge/apply/prod writes.

Runtime evidence: 3/10 read-only catalogue: service_role has SELECT/UPDATE on all three tables; riders has only SELECT RLS policy for public roles, offers' write grants revoked from anon/authenticated. Existing rider triggers remain untouched. Offer rider indexes already exist.
Compatibility: #6119's function/trigger names remain initialize_first_use_rider_condition / trg_initialize_first_use_rider_condition. Only shared release artifact is patchNotes.js, with separately reserved versions; resolve insertion overlap preserving both notes before merge.
Registry: no new feature, retirement, flag or lifecycle status; existing transfer feature remains live. Workers leave NOW.md to the coordinating session; claim/status is persisted on #6115.
Test tier: owner-approved parallel track uses WAVE for copy-only frontend (no markup/snapshot changes, no local full e2e); targeted SQL + typecheck + preflight are mandatory, with full unit/build verification additionally run through verify-lock. CI remains the complete merge gate.
Review: independent read-only review found no actionable P0-P2 findings. SQL boundary fixtures are not full production JS flows or a concurrent multi-session database test; those limits must remain visible in the PR.
Verification: 34 targeted PostgreSQL tests pass; root ops 108 pass/1 skip; backend isolated economy 141 pass plus remaining suite 12668 pass/3 skip; frontend 4275 pass; build, typecheck, preflight and zero-warning ESLint pass. Token hygiene: 0 fail/7 warn. Migration idempotency guard: 482 files, 0 failures.
Recovery: first sandbox verify attempt failed process-dependent root workflow tests and was stopped; the standard scripts rerun with Windows process access passed. No code workaround or gate bypass.
Close-out: registry reconciled (no lifecycle change); generated snapshots checked without including unrelated global status churn. Dry-run cleanup identified other sessions' watch processes; none were stopped. PatchNotesPage reads patchNotes.js, so the note is added there; help copy is unchanged because this restores an existing invariant.
Release gate: top-level database SQL auto-applies after merge. Both merge and migration/prod approval are required before merging this PR; no approval is inferred from CI or review.
