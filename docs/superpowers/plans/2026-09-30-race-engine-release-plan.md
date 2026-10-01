# Race engine orders, GC and film implementation plan

> For agentic workers: use superpowers:executing-plans task by task. Parallel delegation needs explicit separate authorisation and the repository wave runner. This plan is prepared for review, not an instruction to build before the outstanding design gates.

Goal: reliable morning-break decisions, consistent chase times, meaningful GC response and truthful presentation, delivered under the approved old/new race release policy.
Architecture: shared correctness fixes plus one pinned tactical policy within the existing v4 engine. GC is a read-only adapter input; work and group state stay deterministic; one history projection feeds presentation.
Tech stack: existing Node/TypeScript engine, Supabase/Postgres runner, React/i18n. No new dependency.
Spec: [review design](../specs/2026-09-30-race-engine-orders-gc-film-design.md).

## Verified delivery status, 1 October
The shared chase/history correctness package and its film/result presentation shipped in [PR #5990](https://github.com/NicolaiDolmer/CyclingZone/pull/5990), patch notes 7.327. Owner visual merge/release approval, exact-commit Vercel READY and Railway SUCCESS, main CI and Deploy verify were observed. The delivered implementation lives in `mechanics/chaseGroup.ts`, shared `backend/lib/raceParticipationHistory.ts` and the matching frontend projection; the originally proposed path below is a design proposal, not unfinished delivery.

Tasks 1 and the correctness-only portion of Task 5 are delivered. No historical results were rerun. Policy pinning (Task 2), order/contested formation (Task 3), actual pre-stage GC and cumulative reactions (Task 4), and their tactical UI/calibration remain separate work. Preserve the next-race release policy; do not restart the delivered fix from the unchecked original planning checklist. Protected lieutenant and phase-specific helper roles remain separate issues #5981/#5982.

## Global constraints
- Five existing roles; no lieutenant/luxury-helper feature in this package.
- No real rider inputs, precise engine tuning or balance thresholds in public docs/PRs/fixtures.
- No production simulation to generate test evidence; local diagnostic runs only.
- TIER FULL for runtime/shared contracts; verification semaphore applies; time injected in tests.
- Existing active work on #5860/#5928/#5915/#5930 is not picked up, overwritten or reprioritised.
- New tactical rules only on new races. Shared correctness fixes can apply to upcoming stages. No historical result writes without a separate go.
- Player-visible implementation updates SSOT/help/patch notes; registry follows feature/regime contract changes.

## Review focus
1. Unknown/missing pre-stage GC cannot be treated as a zero-gap leader.
2. A worker away in an escape cannot contribute to chase/leadout elsewhere.
3. Budget persists across repeated threat starts and loop segments.
4. A started/claimed race and a retry keep their original tactical revision.
5. Historical timeline without sufficient origin evidence cannot yield a fabricated escape/attack label.

## Task 0: evidence and baseline
Files: backend/scripts/v4FlipReadiness.mjs; backend/lib/engine/v4/segmentLoop.breakawayGap.test.ts; private diagnostic input outside public artifacts.
- [ ] Verify actual deployed engine/inputs for reported Auvergne stage 6 and prior anomalous cases; record reconstruction limits.
- [ ] Extend the existing harness to accept an explicit complete StageInput and real orders, not an empty-order-only run. Do not reset the existing golden contract.
- [ ] Baseline runs compare identical inputs/seeds. Report morning membership, later attacks, group/time invariants, workers and energy, and winner/GC distribution separately.
- [ ] Confirm the all-declined formation probe and the large-tail chase failure before fixes. Capture missing-GC and corrupted-order cases.

## Task 1: shared chase correctness and history
Modify: backend/lib/engine/v4/mechanics/breakaway.ts, segmentLoop.ts, groups.ts, mechanics/descent.ts, finale.ts, timeline.ts; backend/lib/raceEngineV4Bridge.js.
Test: existing breakaway/group/segment tests, plus new backend/lib/engine/v4/participationHistory.test.ts.
Create: backend/lib/engine/v4/participationHistory.ts, pure `deriveParticipationHistory(events)` returning rider-keyed morning participation/outcome and later attack facts with evidence status.
- [ ] Failing regression: a small actual chase ahead of a large tail cannot drag escapees back to the tail's time. Cover crossing/catch plus subsequent ordinary selection.
- [ ] Fix chase-group selection and time progression as one shared path. Let-go growth, ordinary tempo and active chase cannot each book the same delta.
- [ ] History is based on formation/attack/merge facts, not a surviving group-name string. Cover known origin, mixed/reused group ids, failed attempts and legacy incomplete events.
- [ ] Re-run passage/finish consistency and both legacy/new-policy paths. Verify #5914 passage ordering remains intact.

## Task 2: immutable race policy routing
Proposed migration: database/2026-10-01-race-engine-rules-revision.sql; modify backend/lib/raceRunner.js and backend/lib/raceEngineV4Bridge.js; new backend/lib/raceEngineRulesRevision.ts and corresponding test.
Interface: `resolveRaceRulesRevision({ race, firstStageClaim, storedRevision, currentRevision }) -> "legacy" | "orders_gc_v1"`; exact atomic database resolver and permissions reviewed before writing the migration.
- [ ] Failing cases: existing started race with null revision, first claim pending before completed count, repeated claim, restarted runner and unknown stored revision.
- [ ] Implement server-only atomic assignment tied to existing claim locking. Existing started/claimed races remain legacy; never infer new policy just from engine_version=4.
- [ ] Keep both named policy paths in the same engine; failure cannot silently activate the newest policy or force a v3 result for a v4 race.
- [ ] Verify idempotency and RLS/service access. Merge-before-apply and explicit owner approval; post-apply read-only verification.

## Task 3: permission and contested formation
Create: backend/lib/engine/v4/mechanics/breakawayPermission.ts and .test.ts.
Modify: mechanics/breakaway.ts, ai/teamOrderContract.ts, orders/teamOrdersAdapter.ts, mechanics/teamPlay.ts/leadout.ts only where membership integration requires it.
Interface: `canAttemptMorningBreak({ role, effort, tryBreak }) -> boolean`; effective tryBreak already resolves absent/default/explicit false in the adapter. A separate pure formation function consumes eligible actual attempts and actual opposing work; returns admitted escapees and attempt/reaction facts without filler participants.
- [ ] Matrix regression for captain/sprint_captain/helper/hunter/free_role, save/normal/grupetto and effective order true/false.
- [ ] All eligible attempts can fail; zero established escapees is valid. Do not manufacture minimum membership.
- [ ] Attempt price is paid once even on failure, and actual escape work remains priced. A failed helper can later work with remaining capacity.
- [ ] Opposing teams follow the same GC/stance/capacity inputs as later chase. Do not double-charge formation opposition and following chase.
- [ ] Stress actual D1/D2 fields with most/all teams trying, neutral/passive defaults, and few explicit chasing teams. Introduce no stat penalty for being a strong rider.

## Task 4: GC context and reaction budget
Create: backend/lib/engine/v4/mechanics/gcThreat.ts and .test.ts; backend/lib/engine/v4/mechanics/teamChaseReaction.ts and .test.ts.
Modify: types.ts, segmentLoop.ts, mechanics/breakaway.ts, ai/aiTactics.ts, raceEngineV4Bridge.js, raceRunner.js.
Interfaces: `assessGcThreat({ gcContext, groups, entrants, route, protectedRiderId }) -> { severity, reason }`; `advanceTeamReaction({ prior, threat, stance, availableWorkers, performedWork }) -> { next, workers, events }`. Tuning choices are private calibration outputs, not invented public numbers.
- [ ] Supply only published pre-stage GC for current starters. Initial ties/one-day/no-evidence states are explicit. Never use the eventual result to decide a threat.
- [ ] Neutral selects actual reaction by own team interests; passive-plan exception is GC-only and preventive. Preserve a reasonable ordinary default while away.
- [ ] Share actual cumulative work across starts/stops and rival threats; no reset per segment. Explicit chase is separate from exceptional rescue budget.
- [ ] Tests: real leader, nearby strong rival, harmless rider far back, changes in remaining terrain/gap, no/fatigued helpers and rider in another group. Both human and AI orders use this implementation.
- [ ] Missing context and exhausted budget produce honest diagnostics/events, never imaginary protection.

## Task 5: exact preview and truthful presentation
Modify: frontend/src/lib/stageTimelineFilm.js; frontend/src/components/race/RaceTacticsTab.jsx; frontend/src/pages/RaceDetailPage.jsx (the existing result marker call sites); frontend/public/locales/en/races.json and da/races.json.
Tests: new frontend/src/lib/raceParticipationMarkers.test.ts and affected existing film/tactics/browser tests.
- [ ] Approve existing-template desktop/mobile preview with exact regime/copy and distinct Flag/Attack labels, colour-independent tooltips and grupetto conflict explanation.
- [ ] Display only evidence-backed morning flags and later attacks. Main causal events come first; no new detailed-film/rider-card expansion.
- [ ] Verify same scenario across history projection, report, final result and film, including catches, later loss and solo finish. Correctness text may ship for existing races only when stored evidence supports it.
- [ ] Produce annotated actual before/after, EN/DA and desktop/mobile when layout changes. Get owner merge-go for player text/UI.

## Task 6: calibration and release proof
- [ ] Run existing required local verification/preflight and full affected e2e through scripts/verify-lock.ps1. Do not run heavy suites outside the semaphore.
- [ ] Private paired report: same complete input/seed before/after, multiple seeds and actual divisions/terrain. Separate invariant failures from gameplay quality.
- [ ] Owner approves meaningful quality targets and the rescue/formation work calibration; regression floors do not count as approval.
- [ ] Independent read-only diff review, CodeRabbit, green current-head CI; merge one PR at a time through the merge queue under the applicable owner gates.
- [ ] Observe exact production commit READY and first actual affected race/stage; verify correct regime, real orders/GC, group/passages/results and film. No production test races.
- [ ] Update source issues and separate docs close-out, registry/status generation as required. Patch notes describe what actually shipped. Rollback policy preserves assigned race regime and blocks unsupported revisions.

## Immediate owner review packet
The product decisions are recorded. Before runtime build: approve the concrete input/regime contract and exact UI sketch/copy. Private calibration and production/migration approvals occur against measured artifacts. This document makes the steps reviewable; it does not claim readiness or replace required gates.
