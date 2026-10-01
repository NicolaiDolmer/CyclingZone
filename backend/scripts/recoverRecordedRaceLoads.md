# Recorded race-load recovery

Contracts: [training](../../docs/TRAINING_RULES.md) and [race engine](../../docs/RACE_ENGINE_RULES.md). Normal full simulation under normalized condition ownership accepts only one canonical date. This recovery command handles already-written stages across original dates without re-simulation.

Run with the existing backend service environment:

```powershell
node backend/scripts/recoverRecordedRaceLoads.mjs --race=<race-id>
node backend/scripts/recoverRecordedRaceLoads.mjs --race=<race-id> --stages=1,2
```

Both commands are read-only. Review stage dates, missing-load counts and blockers. Original immutable starter and effort/load snapshots, canonical calendar rows and durable result-write evidence are required. Missing snapshots fail closed; current rider abilities, condition and current orders cannot replace historical inputs.

Only after the owner's explicit **kør**, pause the scheduler and positively verify that existing race finalizers have drained. Repeat the dry-run, then append `--apply`. Each stage records its original loads atomically; repeating the command does not add them twice. A state change rejects that stage and requires a fresh dry-run. Earlier successful stages remain safe to retry.

Recovery preserves current abilities, form, fatigue and injuries. Late loads for incomplete settlements remain unapplied reconciliation evidence. Missing loads for an already complete settlement are blocked for separate review.

The default mode repairs **load recording and the durable fatigue step only**. Unfinished races receive `finalize_state.condition_recovery_hold`; normal full/stage runners reject that hold. It never clears the hold or claims the race complete.

## Complete a recoverable finalization tail

```powershell
node backend/scripts/recoverRecordedRaceLoads.mjs --race=<race-id> --complete
node backend/scripts/recoverRecordedRaceLoads.mjs --race=<race-id> --complete --apply
```

The second command still requires owner **kør**, scheduler pause and observed drain. Completion requires original results and load snapshots for every canonical stage, the original final GC, and durable final-stage `write`, `enrichment`, `standings`, `board` and `notify` marks. It restores loads, prepares completion with a retained hold, recomputes season counters and ranking views from stored results, and invokes existing guarded deferred-transfer/academy flushes scoped to original participants. Those pending operations may send their normal arrival notifications; old race-result notifications and board effects are never replayed. Normal prize processing remains protected by its existing payout receipts.

Only after the idempotent tail succeeds does completion clear the hold. A crash retains the prepared marker; repeat `--complete --apply` to resume. Completed races return idempotently. Original results, current abilities, condition and injuries are not regenerated.

Missing `board` or `notify` marks are **concrete evidence blockers**, not an invitation to rerun the ordinary finalizer. `boardWeekendFinalization.js` computes changes from current profiles; its view-only event log can be missing after profile writes. The original pre-board state/evaluation or durable completion proof is needed. Missing notification proof requires the original delivery/outbox receipt because attempt-once sending can have succeeded before its marker. Missing results, stages or immutable inputs likewise require authoritative evidence. This command refuses those cases without pretending to finish them.
