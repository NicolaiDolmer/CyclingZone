# Shared group-time prototype and precise-contact dependency

> **For agentic workers:** Use superpowers:executing-plans for inline implementation. One writer; independent read-only diagnosis/review. No parallel writers in the shared engine files.

**Goal:** Implement the owner-approved #6199 prototype with one account of group movement/contact, then deliver #6329 on that same movement contract in its own PR.

**Architecture:** A pure group-clock module records absolute arrival time before/after each segment movement and derives relative group gaps. Existing terrain, pursuit and finale logic must account for their movement once through that contract. Precise contact consumes the same movement intervals rather than creating a second model.

**Tech Stack:** Existing TypeScript/Node v4 engine, deterministic node:test and existing private paired-stage harnesses. No dependencies.

**Spec:** [Owner A-go on #6199](https://github.com/NicolaiDolmer/CyclingZone/issues/6199#issuecomment-6044552883), [approved contact A](https://github.com/NicolaiDolmer/CyclingZone/issues/6327#issuecomment-6044415738), #6329, and SSOT `docs/RACE_ENGINE_RULES.md` (time model, group time, finale, immutable revisions, locked anchors and tail bands).

## Global constraints

- Only the inactive `official_times_v1` path changes. Current default and every old revision remain unchanged; historical/running races retain pins.
- Activation is one owner-approved package with #6284/#6327/#6199/#6329, after a new annotated same-data before/after image.
- No OTL/time-limit changes, new film representation, new player text or other player-facing choice without a separate issue decision card.
- No prod writes, migrations, merges, NOW/MASTERPLAN changes. No public calibration coefficients or private population identifiers.
- Maximum three active lanes including the parent; maximum two heavy checks via verify-lock. Parent is the only implementation writer.
- Commit behind explicit worktree branch guard and push at least every 15 minutes. Early draft PR, one PR per issue; #6329 may depend on #6199.
- Previous #6223/#6253 implement the older v3 model; merged #6326 provides raw-time integrity and checkpoint contact. They are inputs, not proof this new scope is complete.

## Review focus

- Changing the front group must preserve every absolute arrival time and never silently discard a negative relative displacement.
- Split/merge membership and time must agree, including incidents, morning escapees and multiple contacts during a segment.
- One movement has one time cost; selection, regrouping and finale cannot add the same physical loss a second time.
- A coherent grupetto requires physical contact, not a distant minimum-time merge. Weak riders can still detach under existing selection rules.
- Existing OTL/escape policy and old-revision complete output must survive byte-for-byte; no numeric target may be silently loosened.

## Task 1: baseline and shared clock contract (#6199)

Files: create `backend/lib/engine/v4/groupClock.ts` and `.test.ts`; later integrate `segmentLoop.ts` and its focused tests. Read all writers of `gap_seconds` before wiring.

- [x] Capture complete old-revision output digests on the five fixed fields and existing scorecard inputs.
- [x] RED tests for absolute-time conservation when the front changes, split/merge correspondence, deterministic ordering and one movement per leg.
- [x] Implement pure typed movement/ledger functions with explicit initial times, groups and movement duration. No wall-clock time.
- [x] GREEN targeted tests; interfaces recorded below.
- [ ] Commit and push with measured status.

## Task 2: prototype integration, regrouping and finale (#6199)

Files: `segmentLoop.ts`, `types.ts`, `mechanics/climbSelection.ts`, `mechanics/descent.ts`, `mechanics/timeModel.ts`, `mechanics/descentCrossing.ts`, `finale.ts`, relevant focused tests. Touch only paths needed by the measured integration; no blanket backend ownership.

- [ ] RED loop regression for each measured double-accounting/contact failure.
- [ ] Route the new revision through the shared clock while preserving old branches exactly.
- [ ] Enable only approved time-model capabilities, without automatically enabling unrelated v3 tactics or OTL policy.
- [ ] Test physical regrouping/continued joint motion, weak-rider separation, incident exclusion, morning-escape preservation and finale pool versus physical time.
- [ ] Keep rendering/event vocabulary unchanged; escalate any new presentation choice with a card.
- [ ] Update SSOT and bug learning in same PR; no activation or player release text.

## Task 3: calibration and evidence (#6199)

Files: existing `backend/scripts/dev/timeModel6199.mjs` and a focused paired harness as needed; private fixtures/reports stay in `balance-internals/`.

- [ ] Run same five actual profiles/fields, saved orders/prior GC and paired seeds; expand with available hilly/rolling profiles before the no-ordinary-30-minute-loss claim.
- [ ] Measure rank 10/30/50, raw maximum, incident-excluded p90 tail, OTL, actual group membership/contact and strength monotonicity. Partition mountain/uphill anchors by breakaway win as required by SSOT.
- [ ] Calibrate only within the approved contract; retain all locked targets. A conflicting target or new OTL policy goes to the owner with measured evidence, never a silent change.
- [ ] Repeat old-revision digests, FULL, strict engine types and preflight through verify-lock. Independent review then repair/reverify findings.
- [ ] One annotated same-data before/after image and explicit passed/failed/unknown gates on issue; no readiness claim from reduced maximum gaps alone.

## Task 4: precise contact (#6329, dependent separate PR)

- [ ] After the shared movement interface is tested, create a separate branch/PR based on #6199 if not yet merged.
- [ ] RED/GREEN for contact position/time strictly within its actual movement leg, no collision of sequential tempo/pursuit intervals, multiple contacts, ties, rebaselining and absent historical information.
- [ ] Use defined motion from the ledger; never claim an exact historical contact point from sparse production checkpoints.
- [ ] E14 same-data before/after film image before merge. Keep physical contact A as fallback only where the approved contract permits; ask if a new player-facing fallback rule is required.
- [ ] If this integration threatens #6199's delivery, report the concrete dependency and measured impact to the owner before changing scope/order.

## Execution ledger

2026-10-07: owner-go read and confirmed; main base `895871eff` includes #6326. Isolated worktree `codex/6199-shared-group-clock`. Two read-only inspections map accounting and acceptance; no second writer. No implementation or calibration is claimed by this planning commit.

Clock foundation interfaces (first implementation increment):
- `beginGroupClock({groups, frontTimeSeconds, fromKm, toKm}): GroupClock` captures immutable absolute entry arrivals.
- `replaceTraversal(clock, groupId, durationSeconds): GroupClock` replaces an overlapping estimate of one physical distance interval.
- `addPointDelay(clock, groupId, delaySeconds): GroupClock` accounts for a separate stopped-time delay.
- `projectGroupClock(clock): {frontTimeSeconds, groups, arrivals}` derives gaps from absolute arrivals without discarding front changes.
- Six deterministic tests pass (front replacement, traversal replacement/idempotence, point delay, order independence, segment continuity, invalid inputs).
- Frozen baseline `895871eff`: 125 paired simulations, comprising 100 complete old-revision digests and 25 private candidate outputs, with pinned input hash/seeds.
- This increment is not loop integration, physical regrouping or calibrated acceptance. Those tasks remain open.
2026-10-07 wiring increment: sharedGroupTime is an independent true-only hook
capability for official_times_v1. Segment traversal and each hook proposal now
commit the absolute reference; M5 no longer hides signed advance in its private
rebase on this path. Ten focused tests pass, including an actual M5 fixture with
mutation-confirmed RED/GREEN. 100/100 complete old-revision digests match baseline.
Strict engine types and preflight pass; FULL is running. This remains a draft
foundation, not the completed physical regrouping/finale model or calibration.

2026-10-07 prototype follow-up: the broad run exposed the old A-only expectation
that official_times_v1 had exactly v2 physics. The approved #6199 scope supersedes
that expectation; it is replaced by 28 frozen complete old-revision route outputs
and new-revision determinism, field conservation and raw saved-gap checks. The
existing runner/GC/pin tests remain. A real contact regression was also fixed:
new-reference travel must not let an ordinary group pass through a morning escape
without joining it and recording the actual catcher. The new clock path extends
physical crossing reconciliation to these groups, while the existing descent-only
helper default and all old revision paths remain unchanged. Targeted tests pass;
final FULL and calibration remain required. No readiness claim.
