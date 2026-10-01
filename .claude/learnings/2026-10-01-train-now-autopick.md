# 2026-10-01 - Train now trained only a fraction of an autopick squad (#6006)

## Symptom
Beta players pressed "Train now" and most of the squad got nothing until the evening.
Two teams (Hold A, Hold B), both with assistant selection on, saw roughly a fifth of
the squad trained. The note under the button did not say what happened.

## Root cause
`resolveTrainingDateReadiness` treats a rider as having an unresolved race slot when
he is a candidate for a stage and has no load/result yet. Without an entrant snapshot,
candidates = entered riders + `trainingAutopickCandidates`, and for a team with
assistant selection on that is every eligible rider. So the whole squad "waited for
its race", including riders that would never start.

The key question (does autopick respect `training_train_now_locks`?) was answered by
code: no. Only the manual selection paths (PUT/bulk/auto-fill endpoint) checked the
lock. The entry sweep (`raceEntryGenerator`), the race-start autofill
(`raceRunner.fillMissingTeamEntries`) and the regenerate endpoint did not, so a
"trained" rider could still be put in a race afterwards (double activity, #5267).

## Fix
- All three automatic/regenerate paths now skip a (race, team) unit with a stage on a
  date the team pressed for (frozen: no rider added, none removed).
- Because the selection is frozen after the press, a pressing team is no longer an
  autopick candidate in the training readiness; only real entries hold a rider back.
- The press answer says "X riders trained now, Y waiting for their race".

## Lesson
A lock that only guards the manual path is not a lock. When a feature freezes state,
list every writer of that state (here: every writer of `race_entries`) and guard or
test each one. The readiness rule was correct in isolation; its input (who can still
be picked) was wrong once the lock existed.
