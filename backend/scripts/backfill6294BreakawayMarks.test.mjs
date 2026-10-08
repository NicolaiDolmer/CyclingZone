import test from "node:test";
import assert from "node:assert/strict";
import { planStage, parseArgs, buildRollbackLog, DEFAULT_SINCE } from "./backfill6294BreakawayMarks.mjs";

// Anonymiseret prod-form (#6294 anker): fire udbrydere, en styrter og koerer
// op igen; motoren skrev en "indhentning" af hans solo-gruppe. Gemte flag:
// tre "indhentet" (heriblandt vinderen), den afsatte "holdt hjem".
const BREAK = ["e1", "e2", "e3", "e4"];
const events = [
  { km: 0, type: "stage_start", params: {} },
  { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: BREAK } },
  { km: 61.27, type: "incident", params: { kind: "crash", outcome: "time_loss", rider_id: "e3" } },
  { km: 91.61, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["e1", "e2", "e4"], chase_group_id: "solo-m10-3-0", chase_group_kind: "solo" } },
  { km: 91.61, type: "group_merged", params: { group_id: "solo-m10-3-0", into_group_id: "breakaway-0", rider_ids: ["e3"] } },
  { km: 180, type: "breakaway_survived", params: { group_id: "breakaway-0", rider_ids: BREAK } },
  { km: 180, type: "finish", params: {} },
];
const row = (id, rider, rank, caught, type = "stage") => ({ id, rider_id: rider, rank, result_type: type, in_breakaway: true, breakaway_caught: caught, breakaway_dropped: false });
const rows = [
  row(1, "e2", 1, true), row(2, "e3", 2, false), row(3, "e1", 3, true), row(4, "e4", 4, true),
  { id: 5, rider_id: "p1", rank: 5, result_type: "stage", in_breakaway: false, breakaway_caught: false, breakaway_dropped: false },
  row(6, "e2", 1, true, "gc"),
];

test("#6294 backfill: the three false 'caught' rows (winner included) become held home; the crashed rider is untouched", () => {
  const plan = planStage({ events, rows });
  assert.equal(plan.skipped, null);
  assert.equal(plan.regroups, 1);
  assert.deepEqual(plan.updates.map((u) => u.id).sort(), [1, 3, 4, 6]);
  for (const u of plan.updates) {
    assert.deepEqual(u.patch, { breakaway_caught: false });
    assert.equal(u.outcome, "survived");
  }
});

test("#6294 backfill: stages without a regroup catch are never touched", () => {
  const plain = events.filter((e) => e.type !== "breakaway_caught" && e.type !== "group_merged");
  assert.equal(planStage({ events: plain, rows }).skipped, "no_regroup_catch");
  assert.equal(planStage({ events: events.filter((e) => e.type !== "finish"), rows }).skipped, "incomplete_timeline");
});

test("#6294 backfill: idempotent, a corrected stage plans nothing", () => {
  const fixed = rows.map((r) => ({ ...r, breakaway_caught: false }));
  assert.equal(planStage({ events, rows: fixed }).updates.length, 0);
});

test("#6294 backfill: dry-run is the default; apply needs the explicit owner flag", () => {
  const args = parseArgs([]);
  assert.equal(args.apply, false);
  assert.equal(args.since, DEFAULT_SINCE);
  assert.equal(parseArgs(["--apply"]).ownerGo, false);
  const log = buildRollbackLog({ since: DEFAULT_SINCE, raceId: null, totals: {}, perStage: [{ race_id: "r", stage_number: 1, updates: planStage({ events, rows }).updates }] }, { mode: "dry-run" });
  assert.equal(log.rows.length, 4);
  assert.ok(log.rows.every((r) => r.status === "planned" && r.before.breakaway_caught === true && r.after.breakaway_caught === false));
});
