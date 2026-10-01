// #4847 "Train now": orchestration, idempotency and the two locks.
// The engine-level invariant I1 (press == automatic) lives in
// dailyTrainingEngine.test.js, where the engine's date mock already exists.
import test from "node:test";
import assert from "node:assert/strict";

import {
  runTrainNow, loadTrainNowStatus, trainNowGameDays, splitTrainNowRiders,
  createTrainNowPlanLock, sameWeekdayCell, TRAIN_NOW_FLAG_KEY,
} from "./trainNow.js";
import { isRaceDateTrainNowLocked, TRAIN_NOW_LOCK_TABLE } from "./trainNowLock.js";
import { prepareSelectionChange } from "./raceSelection.js";

const TEAM = { id: "team-a", league_division_id: "div-1" };
const SEASON = { id: "season-1", number: 4 };
// 1/10 2026 08:00 Copenhagen (CEST) = 06:00 UTC. Thursday.
const MORNING = new Date("2026-10-01T06:00:00Z");
const TODAY = "2026-10-01";

// Minimal PostgREST-like fake: filters eq/lt/in/is, limit, upsert with
// onConflict + ignoreDuplicates, and a log of every write per table.
function fakeSupabase(state, { missing = [] } = {}) {
  const writes = [];
  function query(table) {
    const filters = [];
    let limit = null;
    const run = () => {
      if (missing.includes(table)) return { data: null, error: { code: "42P01", message: "missing" } };
      let rows = (state[table] ?? []).filter((row) => filters.every((f) => f(row)));
      if (limit != null) rows = rows.slice(0, limit);
      return { data: rows, error: null };
    };
    const q = {
      select() { return q; },
      eq(col, val) { filters.push((row) => row[col] === val); return q; },
      is(col, val) { filters.push((row) => (row[col] ?? null) === val); return q; },
      lt(col, val) { filters.push((row) => row[col] < val); return q; },
      in(col, vals) { filters.push((row) => vals.includes(row[col])); return q; },
      limit(n) { limit = n; return q; },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      async upsert(rows, opts = {}) {
        if (missing.includes(table)) return { error: { code: "42P01", message: "missing" } };
        writes.push({ table, op: "upsert", rows });
        state[table] ??= [];
        const keys = (opts.onConflict ?? "").split(",").filter(Boolean);
        for (const row of rows) {
          const hit = state[table].find((x) => keys.length && keys.every((k) => x[k] === row[k]));
          if (hit) { if (!opts.ignoreDuplicates) Object.assign(hit, row); } else state[table].push({ ...row });
        }
        return { error: null };
      },
      insert(rows) { writes.push({ table, op: "insert", rows }); return Promise.resolve({ error: null }); },
      update(patch) { writes.push({ table, op: "update", patch }); return q; },
      delete() { writes.push({ table, op: "delete" }); return q; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return q;
  }
  return { from: query, writes };
}

function baseState(flag = "on") {
  return {
    app_config: [
      { key: TRAIN_NOW_FLAG_KEY, value: flag },
      { key: "training_condition_per_date", value: "on" },
      { key: "training_tick_per_race_day", value: "on" },
    ],
    training_date_work: [],
    [TRAIN_NOW_LOCK_TABLE]: [],
  };
}

// Context as loadTrainingDateContext returns it: r1 free, r2 entered in a race
// with a stage today (unresolved until the stage result exists).
function fakeContext() {
  return {
    races: [{ id: "race-1", stages_completed: 0, finalize_state: null, race_type: "single" }],
    teams: [TEAM],
    riders: [
      { id: "r1", team_id: TEAM.id },
      { id: "r2", team_id: TEAM.id },
      { id: "x9", team_id: "team-b" },
    ],
    stages: [{ race_id: "race-1", stage_number: 1, game_day: 33 }],
    runs: [], entries: [{ race_id: "race-1", rider_id: "r2", team_id: TEAM.id }],
    results: [], incidents: [], loads: [], candidateRiderIdsByRace: new Map(),
    gameDaysByDivision: new Map([[TEAM.league_division_id, [31, 32, 33, 34, 35]]]),
  };
}

function harness(state) {
  const supabase = fakeSupabase(state);
  const calls = [];
  const deps = {
    supabase, team: TEAM, season: SEASON, now: MORNING,
    loadDaySpans: async () => new Map(),
    loadContext: async () => fakeContext(),
    registerWork: async ({ teamId, seasonId, tickDate, gameDays, riderIds }) => {
      const work = { team_id: teamId, season_id: seasonId, tick_date: tickDate, status: "pending",
        game_days: gameDays, expected_rider_ids: riderIds, quarantined_rider_ids: [],
        opening_conditions: Object.fromEntries(riderIds.map((id) => [id, { form: 50, fatigue: 20 }])) };
      state.training_date_work.push(work);
      return work;
    },
    runDay: async (args) => { calls.push(args); return { alreadyRan: false }; },
  };
  return { supabase, calls, deps };
}

test("pure: the press settles every race day of the date except the final one (I4)", () => {
  assert.deepEqual(trainNowGameDays([35, 31, 33, 32, 34]), [31, 32, 33, 34]);
  assert.deepEqual(trainNowGameDays([]), []);
});

test("pure: riders with an unresolved race slot wait for their stage", () => {
  const split = splitTrainNowRiders({ riderIds: ["r1", "r2"], unresolvedSlotsByRider: { r2: [{ gameDay: 33 }] } });
  assert.deepEqual(split, { settleNow: ["r1"], afterRace: ["r2"] });
});

test("flag off: the press does not exist for the player (404), nothing written", async () => {
  const state = baseState("off");
  const { deps, calls, supabase } = harness(state);
  const result = await runTrainNow(deps);
  assert.equal(result.status, 404);
  assert.equal(calls.length, 0);
  assert.equal(supabase.writes.length, 0);
});

test("requires the per-date settlement (decision 4): otherwise 409, nothing written", async () => {
  const state = baseState("on");
  state.app_config = state.app_config.filter((row) => row.key !== "training_condition_per_date");
  const { deps, calls, supabase } = harness(state);
  const result = await runTrainNow(deps);
  assert.deepEqual([result.status, result.body.error], [409, "train_now_requires_date_settlement"]);
  assert.equal(calls.length + supabase.writes.length, 0);
});

test("press: free rider settles days 1-4 with the sweep's engine; entered rider waits; final day left to the evening", async () => {
  const state = baseState();
  const { deps, calls } = harness(state);
  const result = await runTrainNow(deps);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.settledRiderIds, ["r1"]);
  assert.deepEqual(result.body.afterRaceRiderIds, ["r2"]);
  assert.deepEqual(calls.map((c) => c.gameDay), [31, 32, 33, 34], "final race day 35 is the evening's");
  for (const call of calls) {
    assert.equal(call.tickDateOverride, TODAY);
    assert.deepEqual(call.dateGameDays, [31, 32, 33, 34, 35]);
    assert.deepEqual(call.eligibleRiderIds, ["r1"]);
    assert.equal(call.deadlineReached, false);
    assert.equal(call.executedBy, "manager");
    assert.equal("bonus" in call, false, "no bonus input exists on the press");
  }
});

test("I3: the press never writes race entries; it only locks (per rider + date)", async () => {
  const state = baseState();
  const { deps, supabase } = harness(state);
  await runTrainNow(deps);
  const tables = new Set(supabase.writes.map((w) => w.table));
  assert.deepEqual([...tables], [TRAIN_NOW_LOCK_TABLE]);
  assert.equal(tables.has("race_entries") || tables.has("race_entry_days"), false);
  assert.deepEqual(state[TRAIN_NOW_LOCK_TABLE].map((row) => row.rider_id).sort(), ["r1", "r2"]);
});

test("I2: a double press keeps one lock row per rider + date and the first press time", async () => {
  const state = baseState();
  const { deps } = harness(state);
  await runTrainNow(deps);
  const first = structuredClone(state[TRAIN_NOW_LOCK_TABLE]);
  await runTrainNow({ ...deps, now: new Date("2026-10-01T09:00:00Z") });
  assert.deepEqual(state[TRAIN_NOW_LOCK_TABLE], first);
  assert.equal(state.training_date_work.length, 1, "date registered once");
});

test("a settled date cannot be pressed (409 date_settled)", async () => {
  const state = baseState();
  state.training_date_work.push({ team_id: TEAM.id, season_id: SEASON.id, tick_date: TODAY, status: "complete", game_days: [31, 32, 33, 34, 35], expected_rider_ids: ["r1"] });
  const { deps, calls } = harness(state);
  const result = await runTrainNow(deps);
  assert.deepEqual([result.status, result.body.error], [409, "date_settled"]);
  assert.equal(calls.length, 0);
});

test("an unsettled previous date blocks the press (opening condition would be stale)", async () => {
  const state = baseState();
  state.training_date_work.push({ team_id: TEAM.id, season_id: SEASON.id, tick_date: "2026-09-30", status: "partial" });
  const { deps, calls, supabase } = harness(state);
  const result = await runTrainNow(deps);
  assert.deepEqual([result.status, result.body.error], [409, "previous_date_open"]);
  assert.equal(calls.length + supabase.writes.length, 0);
});

test("status: available before the press, locked after, settled in the evening", async () => {
  const state = baseState();
  const { deps } = harness(state);
  const before = await loadTrainNowStatus({ supabase: deps.supabase, team: TEAM, seasonId: SEASON.id, now: MORNING });
  assert.deepEqual([before.enabled, before.available, before.locked], [true, true, false]);
  await runTrainNow(deps);
  const after = await loadTrainNowStatus({ supabase: deps.supabase, team: TEAM, seasonId: SEASON.id, now: MORNING });
  assert.deepEqual([after.available, after.locked, after.reason], [false, true, "locked"]);
  assert.equal(after.lockedAt, MORNING.toISOString());
  state.training_date_work[0].status = "complete";
  const evening = await loadTrainNowStatus({ supabase: deps.supabase, team: TEAM, seasonId: SEASON.id, now: MORNING });
  assert.deepEqual([evening.settled, evening.reason], [true, "date_settled"]);
});

test("status: beta flag is visible to beta testers only", async () => {
  const state = baseState("beta");
  const supabase = fakeSupabase(state);
  assert.equal((await loadTrainNowStatus({ supabase, team: TEAM, seasonId: SEASON.id, now: MORNING })).enabled, false);
  assert.equal((await loadTrainNowStatus({ supabase, team: TEAM, seasonId: SEASON.id, now: MORNING, isBetaTester: true })).enabled, true);
});

// ── I3: the selection guard ───────────────────────────────────────────────────
function lockedState() {
  const state = baseState();
  state.race_stage_schedule = [
    { race_id: "race-today", scheduled_at: "2026-10-01T15:00:00Z" },
    { race_id: "race-tomorrow", scheduled_at: "2026-10-02T15:00:00Z" },
  ];
  state[TRAIN_NOW_LOCK_TABLE] = [{ rider_id: "r1", tick_date: TODAY, team_id: TEAM.id, season_id: SEASON.id }];
  return state;
}

test("I3 guard: a race with a stage on the locked date is locked for the team, other dates are not", async () => {
  const supabase = fakeSupabase(lockedState());
  assert.equal(await isRaceDateTrainNowLocked({ supabase, teamId: TEAM.id, raceId: "race-today" }), true);
  assert.equal(await isRaceDateTrainNowLocked({ supabase, teamId: TEAM.id, raceId: "race-tomorrow" }), false);
  assert.equal(await isRaceDateTrainNowLocked({ supabase, teamId: "team-b", raceId: "race-today" }), false);
});

test("I3 guard fails open while the lock table is not migrated", async () => {
  const supabase = fakeSupabase(lockedState(), { missing: [TRAIN_NOW_LOCK_TABLE] });
  assert.equal(await isRaceDateTrainNowLocked({ supabase, teamId: TEAM.id, raceId: "race-today" }), false);
});

test("I3 guard in the selection endpoint: a settled rider cannot be entered on the locked date", async () => {
  const state = lockedState();
  state.seasons = [{ id: SEASON.id, status: "active" }];
  const supabase = fakeSupabase(state);
  const race = { id: "race-today", status: "scheduled", league_division_id: TEAM.league_division_id, stages_completed: 0, season_id: SEASON.id, squad: "senior" };
  const result = await prepareSelectionChange({ supabase, race, teamId: TEAM.id, teamDivisionId: TEAM.league_division_id, body: { rider_ids: ["r1"] } });
  assert.deepEqual([result.ok, result.status, result.error], [false, 409, "selection_train_now_locked"]);
});

// ── Today's fields lock; tomorrow's plan stays editable ──────────────────────
function planLockHarness({ settled = false } = {}) {
  const state = lockedState();
  state.training_date_work.push({ team_id: TEAM.id, season_id: SEASON.id, tick_date: TODAY, status: settled ? "complete" : "partial" });
  state.training_week_plans = [{ team_id: TEAM.id, rider_id: null, days: { thu: { intensity: "normal" }, fri: { intensity: "hard" } } }];
  const supabase = fakeSupabase(state);
  const lock = createTrainNowPlanLock({ supabase, now: () => MORNING });
  const call = async (kind, req) => {
    let status = null; let nextCalled = false;
    const res = { status(code) { status = code; return { json: () => null }; } };
    await lock(kind)({ team: TEAM, params: {}, body: {}, ...req }, res, () => { nextCalled = true; });
    return { status, nextCalled };
  };
  return { call };
}

test("plan lock: focus/intensity changes are refused while today is locked", async () => {
  const { call } = planLockHarness();
  assert.deepEqual(await call("plan", {}), { status: 409, nextCalled: false });
  assert.deepEqual(await call("programApply", {}), { status: 409, nextCalled: false });
  assert.deepEqual(await call("weekPlanClear", {}), { status: 409, nextCalled: false });
});

test("plan lock: tomorrow's cells may change, today's may not", async () => {
  const { call } = planLockHarness();
  const tomorrowOnly = { days: { thu: { intensity: "normal" }, fri: { intensity: "rest" } } };
  const todayChanged = { days: { thu: { intensity: "hard" }, fri: { intensity: "hard" } } };
  assert.equal((await call("weekPlan", { body: tomorrowOnly })).nextCalled, true);
  assert.equal((await call("weekPlan", { body: todayChanged })).status, 409);
  assert.equal((await call("programCell", { body: { weekday: "fri" } })).nextCalled, true);
  assert.equal((await call("programCell", { body: { weekday: "thu" } })).status, 409);
});

test("plan lock lifts once the evening settlement completed the date", async () => {
  const { call } = planLockHarness({ settled: true });
  assert.equal((await call("plan", {})).nextCalled, true);
});

test("sameWeekdayCell ignores key order", () => {
  assert.equal(sameWeekdayCell({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), true);
  assert.equal(sameWeekdayCell({ a: 1 }, { a: 2 }), false);
  assert.equal(sameWeekdayCell(undefined, null), true);
});
