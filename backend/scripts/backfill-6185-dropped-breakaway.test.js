import test from "node:test";
import assert from "node:assert/strict";
import { planStage, parseArgs, applyBackfill, diffFlags, countByChange, batchUpdates, DEFAULT_SINCE, buildRollbackLog, writeRollbackLog, defaultLogPath, DEFAULT_LOG_DIR, fetchStageList } from "./backfill-6185-dropped-breakaway.js";
import { PENISOLA_STAGE3_EVENTS, PENISOLA_STAGE3_RANKS, PENISOLA_DROPPED, STAGE_2349_E1, STAGE_2349_E1_ROWS, STAGE_877_E4, STAGE_877_E4_ROWS } from "../lib/raceParticipationHistory.fixtures.ts";

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
  assert.deepEqual(parseArgs([]), { apply: false, ownerGo: false, json: false, since: DEFAULT_SINCE, raceId: null, logPath: null });
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
  assert.deepEqual(result, { updated: 3, planned: 3, appliedIds: ["a", "b", "c"] });
  assert.equal(calls.length, 2);
  // Review: a dropped=true patch never lands on a row that was caught since the dry-run.
  assert.deepEqual(calls[0].filters, [["in", "id", ["a", "b"]], ["eq", "in_breakaway", true], ["eq", "breakaway_caught", false]]);
  // Setting breakaway_dropped=false only ever hits rows where it is still NULL.
  assert.deepEqual(calls[1].filters, [["in", "id", ["c"]], ["eq", "in_breakaway", true], ["is", "breakaway_dropped", null]]);
});

// ── Review round 2: B1 on the two prod stages, rollback log, pagination ──────

// Rows as stored in prod (anonymised; see the fixtures): older v4 rows also
// carry in_breakaway=true for the later attackers a3/a4.
function storedRows(finish, { escapees, caught }) {
  return finish.map(({ rider_id, rank }) => ({
    id: `row-${rider_id}`, result_type: "stage", rider_id, rank,
    in_breakaway: escapees.includes(rider_id), breakaway_caught: caught.includes(rider_id), breakaway_dropped: null,
  }));
}

test("#6185 B1 backfill, prod 2349508b e1: the stage winner and runner-up who rode away from the break are never marked dropped", () => {
  const rows = storedRows(STAGE_2349_E1_ROWS, { escapees: ["e1", "e2", "a3", "a4", "e5", "e6", "e7", "e8", "e15", "e16"], caught: ["e15", "e16"] });
  const plan = planStage({ events: STAGE_2349_E1, rows });
  assert.deepEqual(plan.outcomes, { caught: 2, dropped: 4, survived: 2, unknown: 0 });
  const touched = [...plan.updates, ...plan.blocked];
  assert.equal(touched.some((u) => u.rider_id === "e1" || u.rider_id === "e2"), false, "held home stays as stored");
  assert.deepEqual(plan.updates.filter((u) => u.to.breakaway_dropped === true).map((u) => u.rider_id).sort(), ["e7", "e8"]);
  // e15/e16 are stored as caught: turning them into dropped is a downgrade, blocked.
  assert.deepEqual(plan.blocked.map((u) => u.rider_id).sort(), ["e15", "e16"]);
  // The later attackers are not morning escapees and are never touched.
  assert.equal(touched.some((u) => u.rider_id.startsWith("a")), false);
});

test("#6185 B1 backfill, prod 877c67c1 e4: split from the break, never swallowed, 2nd = held home, not dropped", () => {
  const rows = storedRows(STAGE_877_E4_ROWS, { escapees: ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e107"], caught: ["e1", "e3", "e4", "e5", "e6", "e7", "e107"] });
  const plan = planStage({ events: STAGE_877_E4, rows });
  assert.equal([...plan.updates, ...plan.blocked].some((u) => u.rider_id === "e2"), false);
  assert.equal(plan.outcomes.survived, 1);
});

test("#6185 backfill rollback log: id + before/after per row, in dry-run and after apply", async () => {
  const plan = { since: "2026-09-28", raceId: null, hasColumn: true, totals: { rows_to_update: 2 }, perStage: [
    { race_id: "race-1", stage_number: 3,
      updates: [
        { id: 11, rider_id: "e1", result_type: "stage", rank: 40, outcome: "dropped", from: { breakaway_caught: false, breakaway_dropped: null }, to: { breakaway_caught: false, breakaway_dropped: true } },
        { id: 12, rider_id: "e2", result_type: "gc", rank: 41, outcome: "caught", from: { breakaway_caught: false, breakaway_dropped: null }, to: { breakaway_caught: true, breakaway_dropped: false } },
      ],
      blocked: [{ id: 13, rider_id: "e3", result_type: "stage", rank: 42, outcome: "dropped", from: { breakaway_caught: true, breakaway_dropped: null }, to: { breakaway_caught: false, breakaway_dropped: true } }] },
  ] };
  const now = new Date("2026-10-05T20:00:00.000Z");
  const dry = buildRollbackLog(plan, { mode: "dry-run", now });
  assert.equal(dry.mode, "dry-run");
  assert.equal(dry.written_at, "2026-10-05T20:00:00.000Z");
  assert.deepEqual(dry.rows.map((r) => [r.id, r.status]), [[11, "planned"], [12, "planned"], [13, "blocked"]]);
  assert.deepEqual(dry.rows[0], { id: 11, race_id: "race-1", stage_number: 3, rider_id: "e1", result_type: "stage", rank: 40, outcome: "dropped",
    before: { breakaway_caught: false, breakaway_dropped: null }, after: { breakaway_caught: false, breakaway_dropped: true }, status: "planned" });
  const applied = buildRollbackLog(plan, { mode: "apply", appliedIds: [11], now });
  assert.deepEqual(applied.rows.map((r) => [r.id, r.status]), [[11, "applied"], [12, "not_applied"], [13, "blocked"]]);

  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "bf6185-"));
  try {
    const file = writeRollbackLog(join(dir, "nested", "log.json"), applied);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), applied);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Default location: the gitignored local rollback folder, one file per run and mode.
  assert.equal(defaultLogPath({ apply: false, now }), join(DEFAULT_LOG_DIR, "backfill-dry-run-2026-10-05T20-00-00-000Z.json"));
  assert.match(defaultLogPath({ apply: true, now }), /backfill-apply-2026-10-05T20-00-00-000Z\.json$/);
  assert.match(DEFAULT_LOG_DIR.split("\\").join("/"), /backend\/scripts\/snapshots\/6185$/);
});

test("#6185 backfill stage list is paginated past the PostgREST cap with a stable order", async () => {
  const all = Array.from({ length: 5 }, (_, i) => ({ race_id: `race-${i}`, stage_number: 1, created_at: `2026-10-0${i + 1}` }));
  const calls = [];
  const supabase = {
    from(table) {
      const call = { table, filters: [], orders: [] };
      calls.push(call);
      const builder = {
        select() { return builder; },
        eq(column, value) { call.filters.push(["eq", column, value]); return builder; },
        gte(column, value) { call.filters.push(["gte", column, value]); return builder; },
        order(column) { call.orders.push(column); return builder; },
        range(from, to) { call.range = [from, to]; return Promise.resolve({ data: all.slice(from, to + 1), error: null }); },
      };
      return builder;
    },
  };
  const stages = await fetchStageList(supabase, { since: "2026-09-28" }, 2);
  assert.deepEqual(stages, all);
  assert.deepEqual(calls.map((c) => c.range), [[0, 1], [2, 3], [4, 5]]);
  assert.deepEqual(calls[0].orders, ["created_at", "race_id", "stage_number"]);
  assert.deepEqual(calls[0].filters, [["eq", "timeline_version", 2], ["gte", "created_at", "2026-09-28"]]);
});
