# 30/9: Chase reference and escape history

Status: local implementation/regression proof, release verification pending. Refs #5951 #5953 #5954.

Cause: M5 chose the largest non-escape group and moved escape gaps towards it. After selection a remote tail could become the reference. Snapshot kind was also mistaken for historical morning participation, while caught status was inferred from finishing rank. Group/catch events were omitted by the film and finale-deciding events could invent attacks.

Proof: new regressions were observed red for backward escape movement, shared chase continuing past a caught group, broad snapshot flags, caught-then-winning history, omitted mergers/descent attacks, fake finale attacks and mixed-group gap curves. They pass after the targeted correction. Full verification and actual UI proof remain mandatory before release.

Rulings: the shared pure history projector lives at backend/lib/raceParticipationHistory.ts, preserving lazy engine loading with the flag off. No new database fields or historical writes are needed for the first marker correction. A named-group curve cannot use every group's gap as one escape gap. Two synthetic expected outputs are updated after inspecting winner/rank/time deltas; inputs and winners stay unchanged. Production fields/tuning are never copied into public fixtures.

Prevention: one physical chase selector for tempo and M5, event-derived participation, paired multi-group and integration regressions, compiler checks and causal rendering. Actual GC/formation policy remains a separately pinned new-race package. No new CI guard or balance tuning is introduced.
