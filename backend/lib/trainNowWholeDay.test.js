// #6461 B phase 1: the whole-day press plan, the engine rule and the press flow.
import test from "node:test";
import assert from "node:assert/strict";

import {
  planWholeDayPress, settleWholeDayPress,
} from "./trainNowWholeDay.js";
import { runTrainNow, TRAIN_NOW_FLAG_KEY } from "./trainNow.js";
import { TRAINING_RESERVATION_HELD } from "./dailyTrainingEngine.js";

const DAYS = [11, 12, 13, 14, 15];
const slot = (gameDay, raceId = "race-1") => ({ raceId, stageNumber: 1, gameDay });

test("plan: a rider without an open race slot gets the whole date (all five, condition with the fifth)", () => {
  const plan = planWholeDayPress({ gameDays: DAYS, riderIds: ["free"] });
  assert.deepEqual(plan.daysByRider.free, DAYS);
  assert.deepEqual(plan.wholeDateRiderIds, ["free"]);
  assert.deepEqual(plan.runs.map((run) => run.gameDay), DAYS);
});

test("plan: race rider whose race has already run has no open slot and gets the whole date", () => {
  // readiness drops a slot once its load and result exist; the plan sees no open slot.
  const plan = planWholeDayPress({ gameDays: DAYS, riderIds: ["ran"], unresolvedSlotsByRider: { ran: [] } });
  assert.deepEqual(plan.daysByRider.ran, DAYS);
});

test("plan: race rider before his race waits for the whole date (no early growth before his race, I1)", () => {
  const plan = planWholeDayPress({ gameDays: DAYS, riderIds: ["racer", "gt"], unresolvedSlotsByRider: { racer: [slot(13)], gt: [slot(12), slot(14)] } });
  assert.deepEqual(plan.daysByRider, { racer: [], gt: [] });
  assert.deepEqual(plan.waitingRiderIds, ["racer", "gt"]);
  assert.deepEqual(plan.runs, []);
});

test("plan: mixed squad - five runs in race-day order with only the whole-date riders", () => {
  const plan = planWholeDayPress({
    gameDays: [15, 11, 13, 12, 14], riderIds: ["free", "racer"], unresolvedSlotsByRider: new Map([["racer", [slot(13)]]]),
  });
  assert.deepEqual(plan.runs, DAYS.map((gameDay) => ({ gameDay, riderIds: ["free"] })));
});

function lockTable() {
  const updates = [];
  const supabase = {
    from(table) {
      const q = { patch: null, filters: {} };
      const chain = {
        update(patch) { q.patch = patch; return chain; },
        eq(col, val) { q.filters[col] = val; return chain; },
        in(col, vals) { q.filters[col] = vals; updates.push({ table, ...q }); return Promise.resolve({ error: null }); },
      };
      return chain;
    },
  };
  return { supabase, updates };
}

const pressArgs = (over = {}) => ({
  team: { id: "team-a" }, season: { id: "season-1", number: 5 }, now: new Date("2026-10-26T07:00:00Z"), tickDate: "2026-10-26",
  work: { game_days: DAYS }, pressedAt: "2026-10-26T07:00:00Z",
  ...over,
});

test("press: marks the whole-date riders BEFORE settling, re-reads entries, then runs each day with its riders", async () => {
  const { supabase, updates } = lockTable();
  const events = [];
  const readiness = { unresolvedSlotsByRider: { racer: [slot(13)] }, deadlineAt: new Date("2026-10-27T01:00:00Z") };
  const result = await settleWholeDayPress(pressArgs({
    supabase, available: ["free", "racer"], readiness,
    readReadiness: async () => { events.push(`reread after ${updates.length} mark(s)`); return readiness; },
    runDay: async (args) => { events.push(`day ${args.gameDay}: ${args.eligibleRiderIds.join(",")}`); assert.equal(args.deadlineReached, false); },
  }));
  assert.equal(result.status, 200);
  // Mark the whole-date rider; the waiting race rider is cleared of any stale mark.
  assert.deepEqual(updates.map((u) => [u.patch.whole_day_at != null, u.filters.rider_id]), [[true, ["free"]], [false, ["racer"]]]);
  assert.deepEqual(events, [
    "reread after 1 mark(s)", "day 11: free", "day 12: free", "day 13: free", "day 14: free", "day 15: free",
  ]);
  assert.deepEqual(result.body.wholeDayRiderIds, ["free"]);
  assert.deepEqual(result.body.afterRaceRiderIds, ["racer"]);
});

test("press: a rider entered in the window (before the mark) is unmarked and waits for his race (never both)", async () => {
  const { supabase, updates } = lockTable();
  const before = { unresolvedSlotsByRider: {}, deadlineAt: new Date("2026-10-27T01:00:00Z") };
  const after = { unresolvedSlotsByRider: { late: [slot(14)] }, deadlineAt: before.deadlineAt };
  const runs = [];
  const result = await settleWholeDayPress(pressArgs({
    supabase, available: ["free", "late"], readiness: before, readReadiness: async () => after,
    runDay: async (args) => { runs.push([args.gameDay, args.eligibleRiderIds]); assert.deepEqual(args.unresolvedSlotsByRider.late, [slot(14)]); },
  }));
  assert.deepEqual(updates.map((u) => [u.patch.whole_day_at == null ? "unmark" : "mark", u.filters.rider_id]), [
    ["mark", ["free", "late"]], ["unmark", ["late"]],
  ]);
  assert.deepEqual(runs.map(([, ids]) => ids), DAYS.map(() => ["free"]));
  assert.deepEqual(result.body.afterRaceRiderIds, ["late"]);
});

test("press retry (Codex P1): a stale mark from a failed press is cleared for a rider the retry already sees as waiting", async () => {
  // First press: "late" entered in the window, marked, then the reread threw. Retry: the
  // first readiness already shows his race, so he is never in this press's mark list.
  const { supabase, updates } = lockTable();
  const readiness = { unresolvedSlotsByRider: { late: [slot(14)] }, deadlineAt: new Date("2026-10-27T01:00:00Z") };
  const result = await settleWholeDayPress(pressArgs({
    supabase, available: ["free", "late"], readiness, readReadiness: async () => readiness, runDay: async () => {},
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(updates.map((u) => [u.patch.whole_day_at == null ? "unmark" : "mark", u.filters.rider_id]), [
    ["mark", ["free"]], ["unmark", ["late"]],
  ]);
});

test("press: a failing reread leaves no settled day (the retry starts over from the mark)", async () => {
  const { supabase } = lockTable();
  const readiness = { unresolvedSlotsByRider: {}, deadlineAt: new Date("2026-10-27T01:00:00Z") };
  let runs = 0;
  await assert.rejects(settleWholeDayPress(pressArgs({
    supabase, available: ["free"], readiness,
    readReadiness: async () => { throw new Error("network"); }, runDay: async () => { runs += 1; },
  })), /network/);
  assert.equal(runs, 0);
});

test("press: the evening run holding a race day answers 409 training_in_progress, locked", async () => {
  const { supabase } = lockTable();
  const readiness = { unresolvedSlotsByRider: {}, deadlineAt: new Date("2026-10-27T01:00:00Z") };
  const held = Object.assign(new Error("held"), { code: TRAINING_RESERVATION_HELD, retryable: true });
  const result = await settleWholeDayPress(pressArgs({
    supabase, available: ["free"], readiness, readReadiness: async () => readiness,
    runDay: async ({ gameDay }) => { if (gameDay === 13) throw held; },
  }));
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "training_in_progress");
  assert.equal(result.body.locked, true);
  assert.deepEqual(result.body.settledGameDays, [11, 12]);
});

// ── Through runTrainNow: flag off = the old press, flag on = B ──────────────────
function fakeSupabase(state) {
  function query(table) {
    const filters = [];
    let limit = null;
    const run = () => {
      let rows = (state[table] ?? []).filter((row) => filters.every((f) => f(row)));
      if (limit != null) rows = rows.slice(0, limit);
      return { data: rows, error: null };
    };
    const q = {
      select() { return q; }, order() { return q; }, or() { return q; },
      eq(col, val) { filters.push((row) => row[col] === val); return q; },
      is(col, val) { filters.push((row) => (row[col] ?? null) === val); return q; },
      lt(col, val) { filters.push((row) => row[col] < val); return q; },
      gte(col, val) { filters.push((row) => row[col] >= val); return q; },
      not() { return q; },
      in(col, vals) { filters.push((row) => vals.includes(row[col])); return q; },
      limit(n) { limit = n; return q; },
      range(from, to) { const r = run(); return Promise.resolve({ data: r.data.slice(from, to + 1), error: null }); },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: null }; },
      async upsert(rows) { state[table] ??= []; for (const row of rows) if (!state[table].some((x) => x.rider_id === row.rider_id && x.tick_date === row.tick_date)) state[table].push({ ...row }); return { error: null }; },
      update(patch) { (state.__updates ??= []).push({ table, patch }); return q; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return q;
  }
  return { from: query, rpc: async () => ({ data: [], error: null }) };
}

function pressState() {
  return {
    app_config: [
      { key: TRAIN_NOW_FLAG_KEY, value: "on" }, { key: "training_condition_per_date", value: "on" },
      { key: "training_tick_per_race_day", value: "on" },
    ],
    training_date_work: [], training_train_now_locks: [],
  };
}

async function press(state, {
  isBetaTester = false,
  riders = [{ id: "r1", team_id: "team-a" }, { id: "r2", team_id: "team-a" }],
  // The real register_training_date_work leaves out a rider another team's open date
  // already claims (#6439); `claimedElsewhere` stands in for that.
  claimedElsewhere = [],
} = {}) {
  const calls = [];
  const supabase = fakeSupabase(state);
  const context = {
    riders, gameDaysByDivision: new Map([["div-1", DAYS]]), stages: [], races: [], runs: [], entries: [], results: [], incidents: [], loads: [],
  };
  const result = await runTrainNow({
    supabase, team: { id: "team-a", league_division_id: "div-1" }, season: { id: "season-1", number: 5 },
    now: new Date("2026-10-26T07:00:00Z"), isBetaTester,
    loadDaySpans: async () => [], loadContext: async () => context, loadShortRaces: async () => [],
    registerWork: async ({ riderIds, gameDays }) => {
      const expected = riderIds.filter((id) => !claimedElsewhere.includes(id));
      const work = { status: "pending", game_days: gameDays, expected_rider_ids: expected, quarantined_rider_ids: [], opening_conditions: Object.fromEntries(expected.map((id) => [id, {}])) };
      state.training_date_work.push({ team_id: "team-a", season_id: "season-1", tick_date: "2026-10-26", ...work });
      return work;
    },
    runDay: async (args) => { calls.push({ gameDay: args.gameDay, ids: args.eligibleRiderIds, b: args.settleBeforeUnresolved }); },
  });
  return { result, calls };
}

test("runTrainNow: the press always settles all five race days", async () => {
  const { result, calls } = await press(pressState());
  assert.equal(result.status, 200);
  assert.deepEqual(calls.map((c) => c.gameDay), DAYS);
  assert.ok(calls.every((c) => c.ids.join() === "r1,r2"));
  assert.equal(result.body.wholeDay, true);
});

// ── Loopholes (#6461 brief) through runTrainNow with B on ───────────────────────
const marksIn = (state) => (state.__updates ?? []).filter((u) => u.table === "training_train_now_locks" && u.patch.whole_day_at != null);

test("loophole rider bought mid-day: a rider the seller's open date claims is never settled or marked by the buyer", async () => {
  const state = pressState();
  const { result, calls } = await press(state, {
    riders: [{ id: "r1", team_id: "team-a" }, { id: "bought", team_id: "team-a", acquired_at: "2026-10-26T06:30:00Z" }],
    claimedElsewhere: ["bought"],
  });
  assert.equal(result.status, 200);
  assert.ok(calls.every((c) => c.ids.join() === "r1"), "only the buyer's own frozen roster");
  assert.deepEqual(result.body.wholeDayRiderIds, ["r1"]);
  assert.equal(marksIn(state).length, 1);
});

test("loophole rider bought after the buyer pressed: the frozen roster never widens on a second press", async () => {
  const state = pressState();
  await press(state);
  const { result, calls } = await press(state, {
    riders: [{ id: "r1", team_id: "team-a" }, { id: "r2", team_id: "team-a" }, { id: "late-buy", team_id: "team-a", acquired_at: "2026-10-26T12:00:00Z" }],
  });
  assert.equal(result.status, 200);
  assert.ok(calls.every((c) => !c.ids.includes("late-buy")), "the new rider waits for his own date work");
  assert.deepEqual(result.body.wholeDayRiderIds, ["r1", "r2"]);
});

test("loophole double development: a second B press repeats the same days for the same riders (the engine answers alreadyRan)", async () => {
  const state = pressState();
  const first = await press(state);
  const second = await press(state);
  assert.deepEqual(second.calls.map((c) => [c.gameDay, c.ids.join()]), first.calls.map((c) => [c.gameDay, c.ids.join()]));
  assert.ok(second.calls.every((c) => c.ids.join() === "r1,r2"));
});
