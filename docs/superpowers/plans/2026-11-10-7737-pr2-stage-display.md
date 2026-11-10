# #7737 PR2: stage input and existing condition readers

Base: PR #7948, `df427a24ad5a6c6944afd41a227367b140fbe85a`.
Design-go: owner [night mandate](https://github.com/NicolaiDolmer/CyclingZone/issues/7911#issuecomment-6748409421),
[condition design](https://github.com/NicolaiDolmer/CyclingZone/issues/7801#issuecomment-6691841988).
SSOT: `docs/TRAINING_RULES.md`, “Instant train-now PR 1”.

## Narrow technical plan

The existing reader treats rider_condition as the date opening and adds the ledger.
PR1 can instead store a provisional condition there. Reconstruct stamped dates from
the durable opening, completed receipt intensities and canonical race loads, through
the existing settlement helper. Never settle a provisional condition again. Unfinished
race slots retain PR1's pending-slot representation. Interrupted free slots resume
automatically through the existing engine/receipt CAS before stage entrant reads;
there is no new balance model.
Completed settlement receipts keep rider_condition authoritative. Preserve injury fields.

Use the shared reconstruction for stage entrants and current-condition readers, and
reuse the existing opening-based evening forecast for the next date. Keep the existing
response fields. Unstamped outputs retain their frozen baseline. Stamp/evidence errors
must reach the caller rather than silently returning the provisional value.

## Explicit-clock baseline and verification

Synthetic date: 2026-11-09; press at 06:00Z, stages at 11:00Z and 15:00Z,
next date 2026-11-10. Compare real helpers before/between/after the stages;
include four free slots plus a reserved stage, several stages, rest, no entries,
retry, settled receipt, subsequent date, switches off and injury preservation.
First add and observe a failing cross-consumer regression, then implement the reader.
Run individual targeted backend tests in the foreground; heavy checks use the shared semaphore.
No frontend, SQL, PR1 writer, activation, commit or push. Parent owns independent review,
native database baseline where needed, full verification and stacked PR publication.
Patch notes/player text are deferred explicitly to Claude's PR3 before activation.

## Parent handoff (2026-11-10)

- HEAD/base remains exactly `df427a24ad5a6c6944afd41a227367b140fbe85a`; no lane commits/push/PR.
- Changed: new condition reader + its two tests; riderFatigueNow + its two tests; raceRunner; api training form field; TRAINING_RULES; this plan; learning note.
- Unchanged: PR1 writers/SQL/CAS, raceFatigue bridge, frontend, bonus, flags, NOW and MASTERPLAN.
- Targeted: 172 backend tests passed across six files; includes frozen legacy digests, persisted PGlite evidence and the stage-lookup error regression.
- Backend lint passed; catch guard and 41 Railway log-guard tests passed; diff whitespace check passed.
- PGlite exercises the reader and forecast against persisted evidence; it does not replace native PG17 concurrency or a real press end-to-end.
- Parent owns independent review, full suite/E2E/preflight, native baseline where needed, CI, publication and stacked base `feat/7737-traen-nu-pr1-motor`.
- Affected/type-ratchet/typecheck-baseline did not execute: both shared slots remained occupied; own queued wrapper was stopped with observed exit before handoff. Parent must run these before publication.
- Patch-note exception: Claude's PR3 owns text/Help/patch notes before activation; no player text drafted here.
- Narrow doc extension for parent: `docs/RACE_ENGINE_RULES.md` section “Træthed mellem dagens etaper” must cross-reference the stamped-date exception; outside this lane's owned files.
- Ops-only observation: `verify-lock.ps1 -Status` with a single argument throws on `.Count`; `-Status -Runtime codex` works. No ops edit or issue created.
- Forensic audit/cleanup ran read-only; uncommitted/inherited-stack and context-link warnings retained intentionally; token hygiene: no failures.


## Review-recovery handoff (2026-11-10 02:00 UTC)
- Preserved worktree/branch/base unchanged; no commits, push, production access or flag changes.
- Four parent findings addressed: interrupted press liveness, full forecast after transfer, mixed OFF field absence, race SSOT exception.
- Automatic recovery runs before entrant/ability loading, reusing frozen roster/slots and common engine/CAS; OFF never freezes or widens the roster.
- Partial GETs use persisted pre-provisional condition plus prior canonical loads, preserve injuries, omit uncertain estimates and perform no writes.
- New test executes real PR1 press registration/freeze/commits on PGlite, interrupts after 41/42, resumes 44/45 automatically, then closes reserved 43 exactly once with a consumed ledger row.
- A six-rider real stage-runner test observes recovered receipts before its entrant ability lookup; API condition projection executes verbatim with an injected clock.
- Full outlook/forecast transfer regression includes a receiving team whose own date is already complete. OFF exception stays per rider in helper and actual API fields.
- Final targeted command: verify-lock.ps1 -Max 2 -Runtime codex -- node --test <the twelve files listed below>; 165/165 pass, zero skips, 45.9 seconds.
- Files: trainNowInstantRecovery7737.test.js, trainNowInstantCondition7737.test.js, trainNowInstantCondition7737.integration.test.js, riderFatigueNow.test.js, riderFatigueNowWiring.test.js, trainingWeekPlanForecast.test.js, trainNowInstant7737.golden.test.js, trainNowInstant7737.integration.test.js, raceRunnerStage.test.js, raceRunnerResumeFinalize.test.js, apiTrainingMeRaceDay.routes.test.js, apiTrainingMeDayClose.routes.test.js (all under backend/lib).
- Changed-file ESLint: zero errors/warnings; catch guard and diff whitespace pass. Token hygiene: zero failures; forensic audit: zero errors, five inherited/preserved-state warnings.
- Parent retains independent delta review, native PG17 concurrency/baseline, FULL/E2E/preflight/CI and stacked PR publication. PGlite is single connection; targeted passes are not FULL green.
- Patch notes/player copy remain Claude PR3 before activation. The race-engine SSOT now links the stamped-date exception.
