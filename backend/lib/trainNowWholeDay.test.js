// #6461 B phase 1: the whole-day press plan, the engine rule and the press flow.
import test from "node:test";
import assert from "node:assert/strict";

import {
  planWholeDayPress, riderWaitsForOpenSlot, settleWholeDayPress, loadBoundGameDaysByRider,
  isTrainNowWholeDayEnabled, TRAIN_NOW_WHOLE_DAY_FLAG_KEY,
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

test("plan: race rider before his race gets the training slots before the race, nothing after it", () => {
  const plan = planWholeDayPress({ gameDays: DAYS, riderIds: ["racer"], unresolvedSlotsByRider: { racer: [slot(13)] } });
  assert.deepEqual(plan.daysByRider.racer, [11, 12]);
  assert.deepEqual(plan.partialRiderIds, ["racer"]);
  assert.deepEqual(plan.wholeDateRiderIds, []);
});

test("plan: race rider whose race has already run has no open slot and gets the whole date", () => {
  // readiness drops a slot once its load and result exist; the plan sees no open slot.
  const plan = planWholeDayPress({ gameDays: DAYS, riderIds: ["ran"], unresolvedSlotsByRider: { ran: [] } });
  assert.deepEqual(plan.daysByRider.ran, DAYS);
});

test("plan: several race days on the date - the first open slot ends the prefix", () => {
  const plan = planWholeDayPress({ gameDays: DAYS, riderIds: ["gt"], unresolvedSlotsByRider: { gt: [slot(14), slot(12)] } });
  assert.deepEqual(plan.daysByRider.gt, [11]);
});

test("plan: a bound slot before the race waits (it can still turn into rest or a free slot)", () => {
  const plan = planWholeDayPress({
    gameDays: DAYS, riderIds: ["stage"], unresolvedSlotsByRider: { stage: [slot(14)] }, boundGameDaysByRider: { stage: [12, 13, 14] },
  });
  assert.deepEqual(plan.daysByRider.stage, [11]);
});

test("plan: race on the first race day or an unknown slot day waits completely", () => {
  const plan = planWholeDayPress({
    gameDays: DAYS, riderIds: ["early", "odd"], unresolvedSlotsByRider: { early: [slot(11)], odd: [{ raceId: "x", stageNumber: 1, gameDay: null }] },
  });
  assert.deepEqual(plan.daysByRider, { early: [], odd: [] });
  assert.deepEqual(plan.waitingRiderIds, ["early", "odd"]);
});

test("plan: mixed squad - runs are in race-day order and each lists exactly its riders", () => {
  const plan = planWholeDayPress({
    gameDays: DAYS, riderIds: ["free", "racer"], unresolvedSlotsByRider: { racer: [slot(13)] },
  });
  assert.deepEqual(plan.runs, [
    { gameDay: 11, riderIds: ["free", "racer"] }, { gameDay: 12, riderIds: ["free", "racer"] },
    { gameDay: 13, riderIds: ["free"] }, { gameDay: 14, riderIds: ["free"] }, { gameDay: 15, riderIds: ["free"] },
  ]);
});

test("engine rule: flag off (default) keeps the old 'any open slot waits' exactly", () => {
  assert.equal(riderWaitsForOpenSlot(undefined, 11), false);
  assert.equal(riderWaitsForOpenSlot([], 11), false);
  assert.equal(riderWaitsForOpenSlot([slot(15)], 11), true);
  assert.equal(riderWaitsForOpenSlot([slot(11)], 15), true);
});

test("engine rule: B press settles only slots before the first open slot", () => {
  assert.equal(riderWaitsForOpenSlot([slot(13)], 12, true), false);
  assert.equal(riderWaitsForOpenSlot([slot(13)], 13, true), true);
  assert.equal(riderWaitsForOpenSlot([slot(13)], 14, true), true);
  assert.equal(riderWaitsForOpenSlot([{ gameDay: "x" }], 11, true), true);
});

test("binding loader: per race day, and an unknown binding fails the press", async () => {
  const calls = [];
  const out = await loadBoundGameDaysByRider({
    supabase: {}, seasonId: "s", riderIds: ["a"], gameDays: [12, 11],
    loadBound: async ({ gameDay }) => { calls.push(gameDay); return { data: new Set(gameDay === 12 ? ["a"] : []), error: null }; },
  });
  assert.deepEqual(calls, [11, 12]);
  assert.deepEqual(out, { a: [12] });
  await assert.rejects(loadBoundGameDaysByRider({
    supabase: {}, seasonId: "s", riderIds: ["a"], gameDays: [11], loadBound: async () => ({ data: null, error: new Error("boom") }),
  }), /binding/);
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
  loadBoundDays: async () => ({}),
  ...over,
});

test("press: marks the whole-date riders BEFORE settling, re-reads entries, then runs each day with its riders", async () => {
  const { supabase, updates } = lockTable();
  const events = [];
  const readiness = { unresolvedSlotsByRider: { racer: [slot(13)] }, deadlineAt: new Date("2026-10-27T01:00:00Z") };
  const result = await settleWholeDayPress(pressArgs({
    supabase, available: ["free", "racer"], readiness,
    readReadiness: async () => { events.push(`reread after ${updates.length} mark(s)`); return readiness; },
    runDay: async (args) => { events.push(`day ${args.gameDay}: ${args.eligibleRiderIds.join(",")}`); assert.equal(args.settleBeforeUnresolved, true); },
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(updates.map((u) => [u.patch.whole_day_at != null, u.filters.rider_id]), [[true, ["free"]]]);
  assert.deepEqual(events, [
    "reread after 1 mark(s)", "day 11: free,racer", "day 12: free,racer", "day 13: free", "day 14: free", "day 15: free",
  ]);
  assert.deepEqual(result.body.wholeDayRiderIds, ["free"]);
  assert.deepEqual(result.body.afterRaceRiderIds, ["racer"]);
  assert.deepEqual(result.body.settledGameDaysByRider, { free: DAYS, racer: [11, 12] });
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
  assert.deepEqual(runs.filter(([day]) => day >= 14).map(([, ids]) => ids), [["free"], ["free"]]);
  assert.deepEqual(result.body.settledGameDaysByRider.late, [11, 12, 13]);
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

function pressState(wholeDay) {
  return {
    app_config: [
      { key: TRAIN_NOW_FLAG_KEY, value: "on" }, { key: "training_condition_per_date", value: "on" },
      { key: "training_tick_per_race_day", value: "on" },
      ...(wholeDay ? [{ key: TRAIN_NOW_WHOLE_DAY_FLAG_KEY, value: wholeDay }] : []),
    ],
    training_date_work: [], training_train_now_locks: [],
  };
}

async function press(state, { isBetaTester = false } = {}) {
  const calls = [];
  const supabase = fakeSupabase(state);
  const context = {
    riders: [{ id: "r1", team_id: "team-a" }, { id: "r2", team_id: "team-a" }],
    gameDaysByDivision: new Map([["div-1", DAYS]]), stages: [], races: [], runs: [], entries: [], results: [], incidents: [], loads: [],
  };
  const result = await runTrainNow({
    supabase, team: { id: "team-a", league_division_id: "div-1" }, season: { id: "season-1", number: 5 },
    now: new Date("2026-10-26T07:00:00Z"), isBetaTester,
    loadDaySpans: async () => [], loadContext: async () => context, loadShortRaces: async () => [],
    registerWork: async ({ riderIds, gameDays }) => ({ status: "pending", game_days: gameDays, expected_rider_ids: riderIds, quarantined_rider_ids: [], opening_conditions: { r1: {}, r2: {} } }),
    runDay: async (args) => { calls.push({ gameDay: args.gameDay, ids: args.eligibleRiderIds, b: args.settleBeforeUnresolved }); },
  });
  return { result, calls };
}

test("runTrainNow: flag off is bit-identical to the old press (four race days, no B argument)", async () => {
  for (const value of [null, "off", "beta"]) {
    const { result, calls } = await press(pressState(value));
    assert.equal(result.status, 200);
    assert.deepEqual(calls.map((c) => c.gameDay), [11, 12, 13, 14], `flag ${value}`);
    assert.ok(calls.every((c) => c.b === undefined));
    assert.equal(result.body.wholeDay, undefined);
  }
});

test("runTrainNow: flag on (or beta for a beta tester) settles all five race days", async () => {
  for (const [value, beta] of [["on", false], ["beta", true]]) {
    const { result, calls } = await press(pressState(value), { isBetaTester: beta });
    assert.equal(result.status, 200);
    assert.deepEqual(calls.map((c) => c.gameDay), DAYS);
    assert.ok(calls.every((c) => c.b === true && c.ids.join() === "r1,r2"));
    assert.equal(result.body.wholeDay, true);
  }
});

test("flag reader: absent key is off", async () => {
  assert.equal(await isTrainNowWholeDayEnabled(fakeSupabase({ app_config: [] })), false);
});
