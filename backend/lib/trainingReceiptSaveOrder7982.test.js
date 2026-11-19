import { test } from "node:test";
import assert from "node:assert/strict";
import { withReceiptSaveOrder, attachReceiptSaveOrder7982 } from "./trainingReceiptSaveOrder7982.js";

const run = (day, riders) => ({
  id: `run-${day}`, season_id: "s1", tick_date: "2026-11-19", game_day: day,
  report: { condition_per_date: true, date_game_days: [111, 112], riders },
});
const rider = (id, day) => ({ rider_id: id, game_day: day, progress_before: { tempo: 0.5 } });

test("#7982: settled_at is added to each rider row that has a stored receipt, input untouched", () => {
  const runs = [run(111, [rider("a", 111), rider("b", 111)]), run(112, [rider("a", 112)])];
  const before = structuredClone(runs);
  const ticks = [
    { rider_id: "a", season_id: "s1", tick_date: "2026-11-19", game_day: 112, settled_at: "2026-11-19T16:05:00.123456+00:00" },
    { rider_id: "a", season_id: "s1", tick_date: "2026-11-19", game_day: 111, settled_at: "2026-11-19T19:01:00+00:00" },
  ];
  const out = withReceiptSaveOrder(runs, ticks);
  assert.equal(out[0].report.riders[0].settled_at, "2026-11-19T19:01:00+00:00");
  assert.equal(out[1].report.riders[0].settled_at, "2026-11-19T16:05:00.123456+00:00");
  assert.equal("settled_at" in out[0].report.riders[1], false, "no receipt, no key");
  assert.equal(out[0].report.condition_per_date, true, "the rest of the report is kept");
  assert.deepEqual(runs, before, "never mutates the stored rows");
});

test("#7982: other seasons, dates and race days never match; no receipts returns the same array", () => {
  const runs = [run(111, [rider("a", 111)])];
  const wrong = [
    { rider_id: "a", season_id: "s2", tick_date: "2026-11-19", game_day: 111, settled_at: "2026-11-19T19:01:00Z" },
    { rider_id: "a", season_id: "s1", tick_date: "2026-11-18", game_day: 111, settled_at: "2026-11-19T19:01:00Z" },
    { rider_id: "a", season_id: "s1", tick_date: "2026-11-19", game_day: 110, settled_at: "2026-11-19T19:01:00Z" },
    { rider_id: "a", season_id: "s1", tick_date: "2026-11-19", game_day: 111, settled_at: null },
  ];
  const out = withReceiptSaveOrder(runs, wrong);
  assert.equal(out[0], runs[0], "an untouched run is the same object");
  assert.equal(withReceiptSaveOrder(runs, []), runs);
});

test("#7982: fewer than two runs need no read; a failing read keeps the runs (best-effort)", async () => {
  let reads = 0;
  const supabase = { from() { reads += 1; throw new Error("down"); } };
  const one = [run(111, [rider("a", 111)])];
  assert.equal(await attachReceiptSaveOrder7982({ supabase, teamId: "t1", runs: one }), one);
  assert.equal(reads, 0);
  const two = [run(111, [rider("a", 111)]), run(112, [rider("a", 112)])];
  const warnings = [];
  const out = await attachReceiptSaveOrder7982({ supabase, teamId: "t1", runs: two, logger: { warn: (...a) => warnings.push(a) } });
  assert.equal(out, two);
  assert.equal(reads, 1);
  assert.equal(warnings.length, 1);
});

test("#7982: the read is scoped to the team and the runs' dates", async () => {
  const calls = [];
  const query = {
    select(cols) { calls.push(["select", cols]); return this; },
    eq(col, val) { calls.push(["eq", col, val]); return this; },
    in(col, vals) { calls.push(["in", col, vals]); return this; },
    order(col) { calls.push(["order", col]); return this; },
    range() {
      return Promise.resolve({ data: [{ rider_id: "a", season_id: "s1", tick_date: "2026-11-19", game_day: 112, settled_at: "2026-11-19T16:05:00Z" }], error: null });
    },
  };
  const supabase = { from(table) { calls.push(["from", table]); return query; } };
  const two = [run(111, [rider("a", 111)]), run(112, [rider("a", 112)])];
  const out = await attachReceiptSaveOrder7982({ supabase, teamId: "t1", runs: two });
  assert.deepEqual(calls.filter(c => c[0] === "from" || c[0] === "eq" || c[0] === "in"), [
    ["from", "training_rider_ticks"], ["eq", "team_id", "t1"], ["in", "tick_date", ["2026-11-19"]], ["in", "season_id", ["s1"]],
  ]);
  assert.equal(out[1].report.riders[0].settled_at, "2026-11-19T16:05:00Z");
  assert.equal(out[0].report.riders[0].settled_at, undefined);
});
