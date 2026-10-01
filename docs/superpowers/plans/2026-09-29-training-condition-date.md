# Training condition by date — #5928

Owner chose A on 29 September in [the decision](https://github.com/NicolaiDolmer/CyclingZone/issues/5928#issuecomment-5887710815), then explicitly approved normalizing TOTAL race and training load in the same date's slots. The historical population-median gate is temporarily waived for this correction; parent records the new measurements separately. SSOT: [TRAINING_RULES](../../TRAINING_RULES.md), [PROGRESSION_RULES](../../PROGRESSION_RULES.md), [RACE_ENGINE_RULES](../../RACE_ENGINE_RULES.md). A different form model needs separate approval.

## Implementation

1. Retain five ability ticks per date and the existing season budget. Persist the first tick's condition input in its report and reuse that input for later ability factors.
2. Require all earlier game days to have completed under the same cadence. Do not mutate condition during the first four ticks. At the last tick, average existing activity loads, settle fatigue/form once and roll training injury once using the date seed. Injury duration keeps the existing game-day conversion.
3. Under the flag, race writers record existing profile/effort load in `training_race_loads` instead of mutating condition. Canonical schedule determines date and game day. Each actual stage consumes one slot regardless of the race-development flag. Settlement averages the combined training and race load, with recovery and injury risk based on opening condition. No race load is inferred from differences in current fatigue. Stage simulation within a date uses that opening fatigue.
4. Commit abilities, condition, report, ledger consumption and derived history/score in one service-role-only SQL transaction. Sorted rider/date locks serialize race recording and settlement; a changed ledger snapshot rejects the settlement for retry. Late new loads are rejected after settlement; exact ledger retries remain no-ops. Persist `race_simulation_runs.condition_load_snapshot` with the original stage starters before incidents; retries reuse those exact loads even when injury/abandonment changes the reloaded field. SQL validates exact starter and load coverage. Full-race execution records normalized loads before any result/completed write; stage fatigue finalization is success-only. A load with no rider condition settlement is rejected rather than discarded. A new date cannot silently bypass an unfinished prior date. No new balance constants.
5. New flag `training_condition_per_date` defaults off and requires `training_tick_per_race_day` enabled for engine writes (on/beta, including the legacy boolean form). Training, race writers and cutover reject an inconsistent combination before writes. The same strict flag controls suppression of race-gap recovery and DNS release. Database read errors stop work rather than re-enable another recovery writer. Normalized run snapshots and their score rows use atomic `persist_training_condition_run`: insert once, preserve the original run ID on retry, never delete/replace immutable inputs. Legacy persistence remains unchanged.

## Validation and rollout

TIER FULL belongs to the parent session. Worker checks: production helper parity for five hard sessions, mixed intensity, no repeated race load, date-seeded injury; manager/assistant engine parity, ordering and retry; real PGlite execution of the migration twice, transaction rollback, replay and role permissions. Parent owns population/season acceptance and independent review. Acceptance remains unresolved until those measurements are assessed against the owner-approved targets; unit tests are not population evidence.

No migration apply, merge, flag change or production repair until the owner's literal **kør**. #5926 must ship with this cadence work. Deploy with flag off and verify migration/code together. Every activation uses an explicitly reviewed bootstrap proposal and records its logical start date, including an untouched date; no training may already have run. `bootstrap_training_condition_date` accepts authoritative opening form/fatigue, current-state comparisons and audited actual stage loads. It verifies exact immutable-startfield coverage, preserves injuries, restores only form/fatigue, records loads and flips the flag in one transaction. Parent produces the proposal read-only; no reverse subtraction or inferred opening is allowed. Pause the scheduler and positively observe all legacy finalizers drained before executing: legacy direct writes cannot participate in new SQL locks. The cutover holds an exclusive date lock shared by new ledger/settlement transactions. A changed current condition rejects the whole proposal. Rollback happens at a clean date boundary. A failed atomic tick retries unchanged after restart.

## Partial settlement and recovery

The owner replaced global waiting with per-rider waiting. Durable `training_rider_ticks` receipts allow unaffected teammates to finish and deferred riders to resume without duplicate growth. `training_date_work` freezes the roster and opening evidence; process restart and midnight retain the logical date. The implemented emergency deadline is the next Copenhagen date's early-night cutoff, with the first occurrence used at the autumn clock change. Its release confirmation remains an explicit owner gate.

At the deadline, known activity is settled, unknown slots do not invent training or recovery, and missing results remain reconciliation evidence even if their race load already exists. A durable outbox sends aggregated Sentry and ops alarms. Moved, unavailable or historically unsafe inputs are explicitly quarantined without overwriting newer condition or injuries; teammates continue.

Normal full-race simulation accepts one canonical date. The [recorded recovery runbook](../../../backend/scripts/recoverRecordedRaceLoads.md) supplies read-only planning and explicit apply/completion commands across original dates. These use immutable snapshots and persisted results, never current abilities to re-simulate history. Missing non-replayable board or notification proofs are explicit completion blockers, not permission to guess.

Apply the date, partial and recovery migrations in that order after owner approval. Activation always records its logical start date through the guarded bootstrap, including an untouched date. Manual `run-today` remains unavailable under normalized ownership until the separately approved next-phase button is implemented. Phase two waits for a verified healthy evening.

The cutover's source proof may use an authoritative prior-date report or a documented forward replay from the successful season reset and actual subsequent activity. The latter is required for the newly acquired riders without a prior-date report; no subtraction from current fatigue is accepted. Logging follow-up: #5935. Level-calibration follow-up: #5931.

## Owner-requested WIP handoff to Claude Code

- [x] Normalization, partial settlement, recovery, single recovery owner, route/engine guard and flag-off regression tests implemented.
- [x] SQL exercised in PGlite; core full verification passed before final focused edits.
- [x] Patch note/help, registry, SSOT and learning documented.
- [ ] Resolve new CodeRabbit findings and maybeSingle annotation; final preflight and CI.
- [ ] Finish current complete cutover evidence; original dry-run is stale.
- [ ] Owner confirms technical deadline and literal go; no release performed.
- [ ] Post-apply snapshot refresh/remove annotations in one follow-up PR; verify evening before phase two.

Authoritative handoff: [A-J details](../../snapshots/5928/CLAUDE_HANDOFF.md), linked from #5928, #5888 and PR #5926.

