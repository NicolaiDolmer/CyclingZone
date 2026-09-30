# #5928: historical recovery dry run

Owner approved preparation on 30 September and selected 75 riders with unchanged
plans; nine riders whose plans changed remain excluded. Production player writes
require separate approval of the concrete proposal. No new game behavior.

Sources: [TRAINING_RULES](../../TRAINING_RULES.md),
[PROGRESSION_RULES](../../PROGRESSION_RULES.md), [YOUTH_RULES](../../YOUTH_RULES.md).
Use the actual training engine and its existing neutral opening fallback. Never
derive balance formulas in this tool or replay teammates' completed training.

1. Export one read-only, consistent snapshot of the 29 September quarantine,
   rider inputs, canonical evidence, programs, facilities, staff and calendar.
   Save full player data and calculated deltas privately in OneDrive, not GitHub.
2. Validate exact scope, ownership, missing condition, absence of receipts,
   later settlement/race loads, and unchanged historical inputs. Reconstruct staff
   firing timing from finance audit keys. Unknown inputs fail closed.
3. Replay the five stored game days through `runTeamTrainingDay` with explicit
   historical `now` and a network-free in-memory client. Capture commit payloads;
   apply them only to the copy between ticks. Reject unsupported reads/mutations.
4. Produce per-rider/team before/after deltas and checksums. Include excluded
   riders, all evidence limitations and a guarded rollback procedure.
5. Independent read-only review and focused tests for scope, deterministic
   replay, sequential progress, once-only condition settlement and fail-closed
   input checks. Run required preflight and verification before publishing code.
6. Present the exact proposal to the owner. Applying or reopening quarantine is
   a subsequent authorized step, with fresh comparisons and atomic guarded SQL.

Rollback must restore only approved riders' exact exported abilities and original
absence of condition, and remove only recovery-owned receipts/history/scores.
Team reports retain teammates' records. Refuse rollback after any later effects.
Do not resolve Sentry until recovery and subsequent live operation are verified.

Operational windows: validate the date close after 20:00 and legacy skip after
22:00 Copenhagen time. Prefer applying reviewed recovery before newer effects;
the clock alone never authorizes a write. If newer effects exist, stop and rebuild
the chronological proposal rather than overwriting current state.

Patch notes are unnecessary for this read-only preparation; player data and
runtime behavior are unchanged. The existing feature registry remains unchanged.
