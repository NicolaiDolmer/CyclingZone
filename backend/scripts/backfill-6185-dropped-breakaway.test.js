import test from "node:test";
import assert from "node:assert/strict";
import { planStage, parseArgs, applyBackfill, diffFlags, countByChange, batchUpdates, DEFAULT_SINCE } from "./backfill-6185-dropped-breakaway.js";
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

// ── Review: guard against downgrades, counts per change type, batched writes ──

test("#6185 backfill never turns a stored true into false (downgrade guard)", () => {
  // e4 was stored as caught=true while the history says dropped, and "a" below
  // is stored as dropped=true while the finish net says caught: both would be
  // downgrades and are blocked, not written.
  const rows = penisolaRows().map((row) => row.rider_id === "e4" ? { ...row, breakaway_caught: true } : row);
  const survivedEvents = [
    { km: 0, type: "stage_start", params: {} },
    { km: 10, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 100, type: "breakaway_survived", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 100, type: "finish", params: {} },
  ];
  const plan = planStage({ events: PENISOLA_STAGE3_EVENTS, rows });
  assert.deepEqual(plan.blocked.map((u) => [u.rider_id, u.downgrades]), [["e4", ["breakaway_caught"]]]);
  assert.equal(plan.updates.some((u) => u.rider_id === "e4"), false);
  assert.equal(plan.updates.length, PENISOLA_DROPPED.length - 1);
  for (const u of plan.updates) assert.deepEqual(u.patch, { breakaway_dropped: true });

  const droppedThenCaught = planStage({ events: survivedEvents, rows: [
    { id: "1", result_type: "stage", rider_id: "p", rank: 1, in_breakaway: false, breakaway_caught: false, breakaway_dropped: null },
    { id: "2", result_type: "stage", rider_id: "a", rank: 2, in_breakaway: true, breakaway_caught: false, breakaway_dropped: true },
  ] });
  assert.equal(droppedThenCaught.updates.length, 0);
  assert.deepEqual(droppedThenCaught.blocked.map((u) => u.downgrades), [["breakaway_dropped"]]);
});

test("#6185 backfill dry-run counts rows per change type, including blocked downgrades", () => {
  assert.deepEqual(diffFlags({ breakaway_caught: false, breakaway_dropped: null }, { breakaway_caught: true, breakaway_dropped: false }),
    { patch: { breakaway_caught: true, breakaway_dropped: false }, downgrades: [] });
  assert.deepEqual(diffFlags({ breakaway_caught: true, breakaway_dropped: null }, { breakaway_caught: false, breakaway_dropped: true }),
    { patch: { breakaway_caught: false, breakaway_dropped: true }, downgrades: ["breakaway_caught"] });
  const plan = planStage({ events: PENISOLA_STAGE3_EVENTS, rows: penisolaRows().map((row) => row.rider_id === "e4" ? { ...row, breakaway_caught: true } : row) });
  assert.deepEqual(countByChange(plan.updates), { "breakaway_dropped:null->true": 3 });
  assert.deepEqual(countByChange(plan.blocked), { "breakaway_caught:true->false, breakaway_dropped:null->true": 1 });
});

test("#6185 backfill batches identical patches into one write per batch", () => {
  const updates = [
    { id: "a", patch: { breakaway_dropped: true } },
    { id: "b", patch: { breakaway_dropped: true } },
    { id: "c", patch: { breakaway_caught: true, breakaway_dropped: false } },
    { id: "d", patch: { breakaway_dropped: true } },
  ];
  assert.deepEqual(batchUpdates(updates, 2), [
    { patch: { breakaway_dropped: true }, ids: ["a", "b"] },
    { patch: { breakaway_dropped: true }, ids: ["d"] },
    { patch: { breakaway_caught: true, breakaway_dropped: false }, ids: ["c"] },
  ]);
});

test("#6185 backfill apply writes in batches and guards false-writes in the database too", async () => {
  const calls = [];
  const supabase = {
    from(table) {
      const call = { table, filters: [] };
      calls.push(call);
      const builder = {
        update(patch) { call.patch = patch; return builder; },
        in(column, values) { call.filters.push(["in", column, values]); return builder; },
        eq(column, value) { call.filters.push(["eq", column, value]); return builder; },
        is(column, value) { call.filters.push(["is", column, value]); return builder; },
        select() { return Promise.resolve({ data: call.filters.find((f) => f[0] === "in")[2].map((id) => ({ id })), error: null }); },
      };
      return builder;
    },
  };
  const plan = { hasColumn: true, perStage: [
    { updates: [{ id: "a", patch: { breakaway_dropped: true } }, { id: "b", patch: { breakaway_dropped: true } }] },
    { updates: [{ id: "c", patch: { breakaway_caught: true, breakaway_dropped: false } }] },
  ] };
  const result = await applyBackfill({ supabase, plan });
  assert.deepEqual(result, { updated: 3, planned: 3 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].filters, [["in", "id", ["a", "b"]], ["eq", "in_breakaway", true]]);
  // Setting breakaway_dropped=false only ever hits rows where it is still NULL.
  assert.deepEqual(calls[1].filters, [["in", "id", ["c"]], ["eq", "in_breakaway", true], ["is", "breakaway_dropped", null]]);
});
