import test from "node:test";
import assert from "node:assert/strict";
import { planStage, parseArgs, applyBackfill, DEFAULT_SINCE } from "./backfill-6185-dropped-breakaway.js";
import { PENISOLA_STAGE3_EVENTS, PENISOLA_STAGE3_RANKS, PENISOLA_DROPPED } from "../lib/raceParticipationHistory.fixtures.ts";

// Rows as stored before #6185: dropped escapees say "not caught" (= held home).
function penisolaRows({ dropped = null } = {}) {
  return Object.entries(PENISOLA_STAGE3_RANKS).map(([riderId, rank]) => {
    const escapee = riderId.startsWith("e");
    return {
      id: `row-${riderId}`, result_type: "stage", rider_id: riderId, rank,
      in_breakaway: escapee, breakaway_caught: riderId === "e3" || riderId === "e6",
      breakaway_dropped: escapee && dropped ? (PENISOLA_DROPPED.includes(riderId) ? true : false) : null,
    };
  });
}

test("#6185 backfill anchor: Penisola stage 3 marks exactly the four dropped escapees", () => {
  const plan = planStage({ events: PENISOLA_STAGE3_EVENTS, rows: penisolaRows() });
  assert.equal(plan.skipped, null);
  assert.deepEqual(plan.outcomes, { caught: 2, dropped: 4, survived: 0, unknown: 0 });
  const dropped = plan.updates.filter((u) => u.to.breakaway_dropped === true);
  assert.deepEqual(dropped.map((u) => u.rider_id).sort(), [...PENISOLA_DROPPED].sort());
  assert.deepEqual(dropped.map((u) => u.rank).sort((a, b) => a - b), [177, 178, 179, 181]);
  for (const u of dropped) assert.deepEqual(u.to, { breakaway_caught: false, breakaway_dropped: true });
  // Correctly caught escapees and non-escapees are never touched.
  assert.equal(plan.updates.length, PENISOLA_DROPPED.length);
});

test("#6185 backfill is idempotent: already-corrected rows give no updates", () => {
  const plan = planStage({ events: PENISOLA_STAGE3_EVENTS, rows: penisolaRows({ dropped: true }) });
  assert.equal(plan.updates.length, 0);
});

test("#6185 backfill: single-day gc rows follow the stage outcome", () => {
  const rows = [...penisolaRows(), { id: "gc-e4", result_type: "gc", rider_id: "e4", rank: 177, in_breakaway: true, breakaway_caught: false, breakaway_dropped: null }];
  const plan = planStage({ events: PENISOLA_STAGE3_EVENTS, rows });
  assert.deepEqual(plan.updates.find((u) => u.id === "gc-e4")?.to, { breakaway_caught: false, breakaway_dropped: true });
});

test("#6185 backfill: survived but passed by a non-escapee becomes caught (finish safety net)", () => {
  const events = [
    { km: 0, type: "stage_start", params: {} },
    { km: 10, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 100, type: "breakaway_survived", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 100, type: "finish", params: {} },
  ];
  const rows = [
    { id: "1", result_type: "stage", rider_id: "p", rank: 1, in_breakaway: false, breakaway_caught: false, breakaway_dropped: null },
    { id: "2", result_type: "stage", rider_id: "a", rank: 2, in_breakaway: true, breakaway_caught: false, breakaway_dropped: null },
  ];
  const plan = planStage({ events, rows });
  assert.deepEqual(plan.updates.map((u) => [u.rider_id, u.to]), [["a", { breakaway_caught: true, breakaway_dropped: false }]]);
});

test("#6185 backfill skips incomplete timelines and never invents an outcome", () => {
  const plan = planStage({ events: [{ km: 10, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a"] } }], rows: penisolaRows() });
  assert.equal(plan.skipped, "incomplete_timeline");
  assert.equal(plan.updates.length, 0);
});

test("#6185 backfill args: dry-run by default, apply needs explicit flags", () => {
  assert.deepEqual(parseArgs([]), { apply: false, ownerGo: false, json: false, since: DEFAULT_SINCE, raceId: null });
  assert.equal(parseArgs(["--apply", "--owner-go", "--race=r1"]).raceId, "r1");
  assert.equal(parseArgs(["--since=2026-10-03"]).since, "2026-10-03");
});

test("#6185 backfill apply refuses to write before the migration", async () => {
  await assert.rejects(() => applyBackfill({ supabase: {}, plan: { hasColumn: false, perStage: [] } }), /migrationen/);
});
