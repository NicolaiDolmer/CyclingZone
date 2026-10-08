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

2026-10-07 descent traversal increment: a typed sharedGroupTime context now carries
the real entry groups. The new revision plans one effective descent traversal
before physiology, rather than adding M3 regrouping after a different full-length
travel estimate. Existing middle-/finish-descent rules and physical speed bounds
are reused; morning escapes and incident chasers retain separate ownership. M3
reads the real summit budget and does not repeat regrouping; M5 shares that budget.
24 targeted tests pass, including prior contact/runner tests and frozen old outputs.
Finale coupling, sustainable grupetto cohesion, broad calibration and final FULL
remain open. No new OTL or film rule, activation or readiness claim.

2026-10-07 cohesion/finale increment: post-travel group membership and physical
arrival time now agree at shared-model hook boundaries. A sustainable formed
grupetto is not split again solely against its best climber; genuinely depleted
riders can still detach under existing severity/category rules. Broad tail-window
teleportation is disabled in the candidate; actual contact uses numeric equality.
A physical finale pool shares one time while finish_order retains placement.
Positive separation cannot be erased by the old classification window, and a
full-interval finale closing estimate spends only movement not already accounted.
These behaviors were reproduced RED and corrected; final calibration remains open.
Existing OTL policy and all old-revision branches remain unchanged.

2026-10-07 pace/lineage increment: shared runs record actual cp/demand from the
physiology tick (including incident-chase re-ticks). Empty reserve alone is not
proof of inability to sustain that actual pace. Cohorts retain internal lineage
through weak-rider splits without renaming their displayed chase groups. RED/GREEN
covers an empty but sustainable rider, an actually over-demanded weak rider and a
recovered child cohort. 100/100 old-revision digests still match. Calibration is
not accepted: first paired measurements still show excessive mountain gaps and
fragmented tails, so this remains draft. No new pace/OTL/film policy chosen.

2026-10-08 review-fix increment (Claude, after the Codex handoff): the red backend
CI came from the legacy digest JSON sitting among golden scenario directories; it
now lives in `backend/lib/engine/v4/test-data/` with unchanged golden expectations.
Three reproduced review findings were fixed RED/GREEN in
`sharedGroupClockAccounting6199.test.ts`: (1) point delays booked after segment
entry (`stage_incidents` from an entry cursor, positive time losses only) are kept
apart from used movement, so a point loss no longer restores spent closing credit;
the physical line takes entry gap and delay from the same rider. (2) Physical
contact and the generic merge use the canonical merged kind/origin and carry the
cohort mark to the id the joined line keeps; the peloton exception and descent-only
default are unchanged. (3) The finale resolves physical contact before the
classification pool and `finish_order`: a line cannot pass a group ahead without
joining it at the checkpoint, and a line reaching the front brings every passed
group into the pool. Old-revision frozen outputs still match. Calibration against
the locked targets, the paired 125-run measurement and #6329 remain open.

2026-10-08 Tour-revision increment (owner decision 8/10): the Tour runs on one
combined revision. `official_times_v2` = the full orders_gc_v3 lineage
(generation 3) + official times + the shared group clock; `official_times_v1`
stays as the frozen prototype. Calibration lives in one tuning object read only
under `official_times_v2` (v3 numbers neutral, old revisions byte-identical on
the 100 paired digests and the frozen route outputs). Measured on the realistic
field and the paired real stages, with hilly/rolling route-sensitivity cases:
- The scorecard exposed that the shared clock alone broke flat stages (the old
  numbers-window had silently repaired breakaways and late splits). Fixed
  physically: the field's numbers are closing speed over the final km.
- The v3 "tænd ikke endnu" regressions (mountain spread, short uphill finishes)
  are addressed by the summit race on long summit finishes, physical finale
  tiers, per-profile climb weight and keeping the owner's short uphill finish in
  the group. Valley regrouping (model B) is speed on the shared clock; the let-go
  ceiling is smaller because v3's descent teleport is gone.
- #6329 is built in this PR (brief 8/10): precise contact point inside the
  movement interval, contact A as fallback.
Numbers and the per-gate table are private (`balance-internals/6199/`). Open
with the owner: OTL frequency on hard mountain stages (more than v3's teleported
tail; a grupetto pacing policy would be a new player-facing choice) and the
breakaway rate band (candidate, not owner-approved). No activation.

2026-10-08 pre-merge follow-up (wave lane): under official_times_v2 every
timeline event carries `exact_km` (and `exact_time` where it names riders or a
group) from the shared clock's linear movement inside the segment
(`exactPlace.ts`); M5's pursuit model reports its own catch point. A catch
where both sides are only riders of the day's break is a regroup: no
`breakaway_caught`, the merge is still reported. Both change events only:
official_times_v2 times/groups/incidents/passages are digest-identical to the
commit before, and legacy/orders_gc_v1/v2/v3/official_times_v1 complete outputs
are frozen on a varied field with AI orders over real proxy-stage shapes
(`oldRevisionDigests6199.test.ts`). The DB allow-list is now the idempotent
migration `database/2026-10-08-race-engine-rules-revision-official-times.sql`
(applied post-merge by auto-migrate, not by the lane). Known and not fixed
here: on official_times_v2 some timelines disagree with the next group snapshot
under the membership rule (`validateGroupMembership`), because contact merges
are reported before a later same-segment move that names no membership event;
the persistence guard does not run that rule.
