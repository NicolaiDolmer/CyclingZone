// #4847 "Train now": orchestration, idempotency and the two locks.
// The engine-level invariant I1 (press == automatic) lives in
// dailyTrainingEngine.test.js, where the engine's date mock already exists.
import test from "node:test";
import assert from "node:assert/strict";

import {
  runTrainNow, loadTrainNowStatus,
  createTrainNowPlanLock, sameWeekdayCell, TRAIN_NOW_FLAG_KEY, trainNowShortRaces, loadTrainNowShortRaces,
} from "./trainNow.js";
import {
  TRAIN_NOW_LOCK_TABLE, loadRaceTrainNowLock, loadTrainNowLockedRidersByDate, lockedRidersOnDates, raceStageDates,
  trainNowSelectionViolations,
} from "./trainNowLock.js";
import { loadTrainingDateContext } from "./trainingDateReadiness.js";
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
      // #6006: enough for the real loadTrainingDateContext (paginated selects).
      gte(col, val) { filters.push((row) => row[col] >= val); return q; },
      not(col, op, val) { if (op === "is" && val === null) filters.push((row) => row[col] != null); return q; },
      order() { return q; },
      or() { return q; }, // #6139: roster visibility filter (all fixture riders are visible).
      range(from, to) {
        const r = run();
        return Promise.resolve(r.error ? r : { data: r.data.slice(from, to + 1), error: null });
      },
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
  // #6740: find_spent_race_days (the Train now re-check) - no spent riders in these tests.
  return { from: query, writes, rpc: async () => ({ data: [], error: null }) };
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

test("press: free rider settles all five race days (whole date); entered rider waits for his race", async () => {
  const state = baseState();
  const { deps, calls } = harness(state);
  const result = await runTrainNow(deps);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.settledRiderIds, ["r1"]);
  assert.deepEqual(result.body.afterRaceRiderIds, ["r2"]);
  assert.deepEqual(calls.map((c) => c.gameDay), [31, 32, 33, 34, 35], "the press settles the whole known date");
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

test("a failed registration leaves no lock behind", async () => {
  const state = baseState();
  const { deps, calls } = harness(state);
  await assert.rejects(runTrainNow({ ...deps, registerWork: async () => { throw new Error("rpc down"); } }), /rpc down/);
  assert.equal(state[TRAIN_NOW_LOCK_TABLE].length, 0);
  assert.equal(calls.length, 0);
});

test("entries are re-read after the lock: a rider entered mid-press is not settled", async () => {
  const state = baseState();
  const { deps, calls } = harness(state);
  let reads = 0;
  const result = await runTrainNow({
    ...deps,
    loadContext: async () => {
      reads += 1;
      const ctx = fakeContext();
      // The second read happens after the lock: r1 was entered in the meantime.
      if (reads > 1) ctx.entries.push({ race_id: "race-1", rider_id: "r1", team_id: TEAM.id });
      return ctx;
    },
  });
  assert.equal(reads, 3, "entries re-read after the lock, and once more by the whole-day press");
  assert.deepEqual(result.body.settledRiderIds, []);
  assert.deepEqual(result.body.afterRaceRiderIds.sort(), ["r1", "r2"]);
  assert.equal(calls.length, 0, "nobody free, nothing settled");
});

test("an open date from an earlier season does not block the press", async () => {
  const state = baseState();
  state.training_date_work.push({ team_id: TEAM.id, season_id: "season-0", tick_date: "2026-05-30", status: "partial" });
  const { deps } = harness(state);
  assert.equal((await runTrainNow(deps)).status, 200);
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

test("I3 lock (#6139): only riders with a lock row are locked, and only for races on that date", async () => {
  const state = lockedState();
  state[TRAIN_NOW_LOCK_TABLE][0].pressed_at = "2026-10-01T07:12:00.000Z";
  const supabase = fakeSupabase(state);
  const today = await loadRaceTrainNowLock({ supabase, raceId: "race-today", riderIds: ["r1", "r-new"], teamId: TEAM.id });
  assert.deepEqual([...today.riderIds], ["r1"], "the rider bought after the press is free");
  assert.equal(today.pressedAt, "2026-10-01T07:12:00.000Z");
  const tomorrow = await loadRaceTrainNowLock({ supabase, raceId: "race-tomorrow", riderIds: ["r1"], teamId: TEAM.id });
  assert.equal(tomorrow.riderIds.size, 0, "other dates stay open");
  const otherTeam = await loadRaceTrainNowLock({ supabase, raceId: "race-today", riderIds: ["r1"], teamId: "team-b" });
  assert.deepEqual([[...otherTeam.riderIds], otherTeam.pressedAt], [["r1"], null],
    "a rider who trained today cannot race today on any team; the time is only the viewer's own press");
});

test("#6139 status names today's races in the team's pools (the button says what the press locks)", async () => {
  const state = lockedState();
  state.races = [
    { id: "race-today", name: "Tour A", squad: "senior", league_division_id: TEAM.league_division_id },
    { id: "race-other-pool", name: "Tour B", squad: "senior", league_division_id: "div-9" },
    { id: "race-tomorrow", name: "Tour C", squad: "senior", league_division_id: TEAM.league_division_id },
  ];
  state.race_stage_schedule.push({ race_id: "race-other-pool", scheduled_at: "2026-10-01T12:00:00Z" });
  const status = await loadTrainNowStatus({ supabase: fakeSupabase(state), team: TEAM, seasonId: SEASON.id, now: MORNING });
  assert.deepEqual(status.todayRaces, [{ id: "race-today", name: "Tour A" }]);
});

test("I3 lock fails open while the lock table is not migrated", async () => {
  const supabase = fakeSupabase(lockedState(), { missing: [TRAIN_NOW_LOCK_TABLE] });
  const lock = await loadRaceTrainNowLock({ supabase, raceId: "race-today", riderIds: ["r1"], teamId: TEAM.id });
  assert.equal(lock.riderIds.size, 0);
});

test("trainNowSelectionViolations: a locked rider can neither be added nor removed; others are free", () => {
  const lockedRiderIds = ["r1", "r2"];
  assert.deepEqual(trainNowSelectionViolations({ lockedRiderIds, currentRiderIds: [], nextRiderIds: ["r1", "r-new"] }), ["r1"]);
  assert.deepEqual(trainNowSelectionViolations({ lockedRiderIds, currentRiderIds: ["r2"], nextRiderIds: [] }), ["r2"]);
  assert.deepEqual(trainNowSelectionViolations({ lockedRiderIds, currentRiderIds: ["r2"], nextRiderIds: ["r2", "r-new"] }), []);
  assert.deepEqual(trainNowSelectionViolations({ lockedRiderIds: [], currentRiderIds: ["x"], nextRiderIds: ["y"] }), []);
});

// #6139: the selection endpoint (PUT + bulk share prepareSelectionChange) with a real roster.
function selectionState() {
  const state = lockedState();
  state.seasons = [{ id: SEASON.id, status: "active" }];
  state.riders = ["r1", "r2", "r-new"].map((id) => ({
    id, team_id: TEAM.id, firstname: id, lastname: "", squad: "senior", is_academy: false, is_retired: false, pending_team_id: null,
  }));
  state[TRAIN_NOW_LOCK_TABLE].push({ rider_id: "r2", tick_date: TODAY, team_id: TEAM.id, season_id: SEASON.id });
  state.race_entries = [{ race_id: "race-today", team_id: TEAM.id, rider_id: "r2", race_role: "captain", is_auto_filled: false }];
  state.race_stage_profiles = []; state.rider_derived_abilities = []; state.rider_condition = [];
  return state;
}
const RACE_TODAY = { id: "race-today", status: "scheduled", league_division_id: TEAM.league_division_id, stages_completed: 0, season_id: SEASON.id, squad: "senior" };
const select = (state, rider_ids, captain_id = rider_ids[0] ?? null) => prepareSelectionChange({
  supabase: fakeSupabase(state), race: RACE_TODAY, teamId: TEAM.id, teamDivisionId: TEAM.league_division_id,
  body: { rider_ids, captain_id },
  now: new Date("2026-10-23T00:00:00Z"), // #6959: injiceret ur (hard rule 16)
});

test("I3 in the selection endpoint: a rider who trained cannot be entered on the locked date", async () => {
  const result = await select(selectionState(), ["r2", "r1"], "r2");
  assert.deepEqual([result.ok, result.status, result.error, result.locked_rider_ids], [false, 409, "selection_train_now_locked", ["r1"]]);
});

test("I3 in the selection endpoint: an entered rider who trained cannot be removed", async () => {
  const result = await select(selectionState(), ["r-new"]);
  assert.deepEqual([result.ok, result.error, result.locked_rider_ids], [false, "selection_train_now_locked", ["r2"]]);
});

test("#6139 in the selection endpoint: a rider bought after the press can still be entered", async () => {
  const result = await select(selectionState(), ["r2", "r-new"], "r2");
  assert.equal(result.ok, true);
  assert.deepEqual(result.ctx.trainNowLock.riderIds, ["r1", "r2"]);
  assert.deepEqual(result.ctx.riders.map((r) => [r.id, r.trainNowLocked]), [["r1", true], ["r2", true], ["r-new", false]]);
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

// #6006: an assistant-selected squad (autopick on) of 45, 10 entered in today's
// race. Runs the REAL loadTrainingDateContext against the fake, so the lock read
// in the readiness is exercised end to end.
function autopickState({ autopick = true } = {}) {
  const state = baseState();
  const team = { ...TEAM, is_ai: false, assistant_autopick_enabled: autopick, created_at: null };
  const riders = Array.from({ length: 45 }, (_, i) => ({
    id: `r${String(i).padStart(2, "0")}`, team_id: TEAM.id, squad: "senior", is_academy: false,
    is_retired: false, pending_team_id: null, created_at: null, acquired_at: null,
  }));
  Object.assign(state, {
    teams: [team],
    riders,
    races: [{ id: "race-1", season_id: SEASON.id, league_division_id: TEAM.league_division_id, race_type: "single",
      squad: "senior", stages_completed: 0, finalize_state: null }],
    race_stage_schedule: [{ race_id: "race-1", stage_number: 1, game_day: 33,
      scheduled_at: "2026-10-01T15:00:00.000Z", "races.season_id": SEASON.id }],
    race_entries: riders.slice(0, 10).map((r) => ({ race_id: "race-1", rider_id: r.id, team_id: TEAM.id })),
    training_race_loads: [], race_simulation_runs: [], race_results: [], race_incidents: [],
  });
  return state;
}

function realContextDeps(state) {
  const { deps, calls, supabase } = harness(state);
  const spans = async () => new Map([[TEAM.league_division_id, { gameDays: [31, 32, 33, 34, 35] }]]);
  return { calls, supabase, deps: { ...deps, team: { ...TEAM }, loadDaySpans: spans, loadContext: loadTrainingDateContext } };
}

test("#6006: autopick team with 45 riders, 10 entered: 35 settle now, the 10 entered wait for their race", async () => {
  const state = autopickState();
  const { deps, calls } = realContextDeps(state);
  const result = await runTrainNow(deps);
  assert.equal(result.status, 200);
  assert.equal(result.body.settledRiderIds.length, 35);
  assert.deepEqual(result.body.afterRaceRiderIds, state.race_entries.map((e) => e.rider_id));
  assert.deepEqual(result.body.settledGameDays, [31, 32, 33, 34, 35], "the press settles the whole known date");
  assert.equal(calls.length, 5);
  for (const call of calls) assert.equal(call.eligibleRiderIds.length, 35);
});

test("#6006: before the press the same team's free riders are autopick candidates (they could still be picked)", async () => {
  const state = autopickState();
  const context = await loadTrainingDateContext({
    supabase: fakeSupabase(state), season: SEASON, tickDate: TODAY,
    loadDaySpans: async () => new Map(), registeredTeamIds: [TEAM.id],
  });
  assert.equal(context.candidateRiderIdsByRace.get("race-1").length, 45);
  state[TRAIN_NOW_LOCK_TABLE].push({ rider_id: "r00", tick_date: TODAY, season_id: SEASON.id, team_id: TEAM.id });
  const locked = await loadTrainingDateContext({
    supabase: fakeSupabase(state), season: SEASON, tickDate: TODAY,
    loadDaySpans: async () => new Map(), registeredTeamIds: [TEAM.id],
  });
  assert.deepEqual(locked.candidateRiderIdsByRace.get("race-1"), state.riders.slice(1).map((r) => r.id),
    "#6139: only the rider who trained is out; his teammates without a lock row can still be picked");
});

test("#6006: a team without autopick is unchanged: free riders settle, entered riders wait", async () => {
  const state = autopickState({ autopick: false });
  const { deps } = realContextDeps(state);
  const result = await runTrainNow(deps);
  assert.equal(result.body.settledRiderIds.length, 35);
  assert.equal(result.body.afterRaceRiderIds.length, 10);
});

test("#6139: lock helpers - riders per date, riders on a race's dates and the missing-table fallback", async () => {
  const state = { [TRAIN_NOW_LOCK_TABLE]: [
    { rider_id: "a", tick_date: TODAY, team_id: "t1" },
    { rider_id: "b", tick_date: TODAY, team_id: "t1" },
    { rider_id: "c", tick_date: "2026-10-02", team_id: "t2" },
  ] };
  const byDate = await loadTrainNowLockedRidersByDate({ supabase: fakeSupabase(state), dates: [TODAY] });
  assert.deepEqual([...byDate.keys()], [TODAY]);
  assert.deepEqual([...lockedRidersOnDates(byDate, ["2026-09-30", TODAY])].sort(), ["a", "b"]);
  assert.equal(lockedRidersOnDates(byDate, ["2026-10-02"]).size, 0);
  const missing = await loadTrainNowLockedRidersByDate({
    supabase: fakeSupabase({}, { missing: [TRAIN_NOW_LOCK_TABLE] }), dates: [TODAY],
  });
  assert.equal(missing.size, 0);
  assert.deepEqual(raceStageDates([{ scheduled_at: "2026-10-01T22:30:00.000Z" }]), ["2026-10-02"], "Copenhagen date");
});

test("sameWeekdayCell ignores key order", () => {
  assert.equal(sameWeekdayCell({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), true);
  assert.equal(sameWeekdayCell({ a: 1 }, { a: 2 }), false);
  assert.equal(sameWeekdayCell(undefined, null), true);
});

// ── #6740: advarsel foer tryk naar dagens loeb ender under gulvet ─────────────

test("trainNowShortRaces: Friis' sag - 6 udtaget, 1 skadet -> advarsel (5 raske)", () => {
  const entries = ["a", "b", "c", "d", "e", "f"].map((rider_id) => ({ race_id: "leman", rider_id }));
  assert.deepEqual(trainNowShortRaces({
    races: [{ id: "leman", name: "Tour du Léman", stages_completed: 0, status: "scheduled" }],
    entries, injuredIds: new Set(["f"]),
  }), [{ id: "leman", name: "Tour du Léman", fit: 5, entered: 6, min: 6, startsShort: true }]);
});

test("trainNowShortRaces: fuld trup, startede, afmeldte og ryddede loeb giver ingen advarsel", () => {
  const six = (race_id) => ["a", "b", "c", "d", "e", "f"].map((rider_id) => ({ race_id, rider_id }));
  const out = trainNowShortRaces({
    races: [
      { id: "full", name: "Full", stages_completed: 0 },
      { id: "started", name: "Started", stages_completed: 2 },
      { id: "withdrawn", name: "Withdrawn", stages_completed: 0 },
      { id: "cleared", name: "Cleared", stages_completed: 0 },
    ],
    entries: six("full"), withdrawnIds: new Set(["withdrawn"]), clearedIds: new Set(["cleared"]),
  });
  assert.deepEqual(out, []);
});

test("trainNowShortRaces: ingen udtagelse -> advarsel (assistenten kan ikke fylde op efter trykket)", () => {
  assert.deepEqual(trainNowShortRaces({ races: [{ id: "r", name: "R", stages_completed: 0 }], entries: [] }),
    [{ id: "r", name: "R", fit: 0, entered: 0, min: 6, startsShort: false }]);
});

test("loadTrainNowShortRaces: en solgt rytter i udtagelsen taeller ikke (review #6742)", async () => {
  const six = ["a", "b", "c", "d", "e", "sold"];
  const tables = {
    races: [{ id: "leman", name: "Tour du Léman", stages_completed: 0, status: "scheduled", squad: "senior" }],
    race_withdrawals: [], race_entry_clears: [], rider_condition: [],
    race_entries: six.map((rider_id) => ({ race_id: "leman", rider_id, team_id: "t1" })),
    // "sold" er nu paa et andet hold: motoren fjerner entryen foer gulvet.
    riders: six.map((id) => ({ id, team_id: id === "sold" ? "t2" : "t1", squad: "senior", is_academy: false, is_retired: false })),
  };
  const out = await loadTrainNowShortRaces({ supabase: shortRaceDb(tables), team: { id: "t1" }, todayRaces: [{ id: "leman" }], tickDate: "2026-10-16" });
  assert.deepEqual(out, [{ id: "leman", name: "Tour du Léman", fit: 5, entered: 5, min: 6, startsShort: false }]);
});

function shortRaceDb(tables, { spent = [], failTable = null } = {}) {
  return {
    rpc: async () => ({ data: spent, error: null }),
    from: (table) => {
      const q = {};
      for (const m of ["select", "eq", "in", "neq", "order", "is", "or"]) q[m] = () => q;
      const res = table === failTable ? { data: null, error: { message: "db down" } } : { data: tables[table] ?? [], error: null };
      q.range = () => Promise.resolve(res);
      q.then = (resolve, reject) => Promise.resolve(res).then(resolve, reject);
      return q;
    },
  };
}

const SIX_TABLES = () => {
  const six = ["a", "b", "c", "d", "e", "f"];
  return {
    races: [{ id: "leman", name: "Tour du Léman", stages_completed: 0, status: "scheduled", squad: "senior" }],
    race_withdrawals: [], race_entry_clears: [], rider_condition: [],
    race_entries: six.map((rider_id) => ({ race_id: "leman", rider_id, team_id: "t1" })),
    riders: six.map((id) => ({ id, team_id: "t1", squad: "senior", is_academy: false, is_retired: false })),
  };
};

test("loadTrainNowShortRaces: en rytter der allerede har brugt loebsdagen taeller ikke (review #6742)", async () => {
  const supabase = shortRaceDb(SIX_TABLES(), { spent: [{ rider_id: "f", race_id: "other", game_day: 94 }] });
  const out = await loadTrainNowShortRaces({ supabase, team: { id: "t1" }, todayRaces: [{ id: "leman" }], tickDate: "2026-10-16" });
  assert.deepEqual(out, [{ id: "leman", name: "Tour du Léman", fit: 5, entered: 5, min: 6, startsShort: false }]);
});

test("trainNowShortRaces: regel B kun naar holdet havde gulvet og mindst 1 rask er tilbage (#6740)", () => {
  const ids = (n) => Array.from({ length: n }, (_, i) => ({ race_id: "r", rider_id: `x${i}` }));
  const race = [{ id: "r", name: "R", stages_completed: 0 }];
  assert.equal(trainNowShortRaces({ races: race, entries: ids(5), injuredIds: new Set(["x0"]) })[0].startsShort, false, "5 udtaget havde aldrig gulvet");
  assert.equal(trainNowShortRaces({ races: race, entries: ids(6), injuredIds: new Set(["x0","x1","x2","x3","x4","x5"]) })[0].startsShort, false, "ingen raske tilbage");
  assert.equal(trainNowShortRaces({ races: race, entries: ids(7), injuredIds: new Set(["x0","x1"]) })[0].startsShort, true);
});

test("loadTrainNowShortRaces: GET fejler aabent, trykkets strict-tjek fejler lukket (review #6742)", async () => {
  const supabase = shortRaceDb(SIX_TABLES(), { failTable: "race_entries" });
  const args = { supabase, team: { id: "t1" }, todayRaces: [{ id: "leman" }], tickDate: "2026-10-16" };
  assert.deepEqual(await loadTrainNowShortRaces(args), []);
  await assert.rejects(() => loadTrainNowShortRaces({ ...args, strict: true }), /short race entries/);
});

// ── #6740 review: the press re-checks short races; the page's yes is explicit ──
const SHORT = [{ id: "leman", name: "Tour du Léman", fit: 5, entered: 6, min: 6 }];

test("press: a race below the floor without the explicit yes -> 409, nothing locked", async () => {
  const state = baseState();
  const { deps, calls } = harness(state);
  const result = await runTrainNow({ ...deps, loadShortRaces: async () => SHORT });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "short_races_confirm");
  assert.deepEqual(result.body.shortRaces, SHORT);
  assert.equal(state[TRAIN_NOW_LOCK_TABLE].length, 0, "no lock before the yes");
  assert.equal(calls.length, 0);
});

test("press: the yes for exactly the short races runs the press, still re-checked", async () => {
  const state = baseState();
  const { deps } = harness(state);
  let asked = 0;
  const result = await runTrainNow({ ...deps, confirmedShortRaceIds: ["leman"], loadShortRaces: async () => { asked += 1; return SHORT; } });
  assert.equal(result.status, 200);
  assert.equal(asked, 1, "every first press re-checks");
  assert.equal(state[TRAIN_NOW_LOCK_TABLE].length, 2);
});

test("press: a race that fell below the floor after the dialog is asked again (review #6742)", async () => {
  const state = baseState();
  const { deps } = harness(state);
  const fresh = [...SHORT, { id: "danube", name: "Tour du Danube", fit: 4, entered: 6, min: 6 }];
  const result = await runTrainNow({ ...deps, confirmedShortRaceIds: ["leman"], loadShortRaces: async () => fresh });
  assert.equal(result.status, 409);
  assert.deepEqual(result.body.shortRaces, fresh);
  assert.equal(state[TRAIN_NOW_LOCK_TABLE].length, 0);
});

test("press: a repeated press (locks already written) is never asked again", async () => {
  const state = baseState();
  const { deps } = harness(state);
  await runTrainNow({ ...deps, confirmedShortRaceIds: ["leman"], loadShortRaces: async () => SHORT });
  const again = await runTrainNow({ ...deps, loadShortRaces: async () => SHORT });
  assert.equal(again.status, 200);
});

test("#6536: a parked team cannot press (409 team_parked), nothing written", async () => {
  const state = baseState("on");
  const { deps, calls, supabase } = harness(state);
  const result = await runTrainNow({ ...deps, team: { ...deps.team, parked_at: "2026-10-01T00:00:00Z" } });
  assert.deepEqual([result.status, result.body.error], [409, "team_parked"]);
  assert.equal(calls.length + supabase.writes.length, 0);
});

// Same shape as dailyTrainingEngine's held error (isTrainingReservationHeldError).
function makeTrainingReservationHeldError() {
  const err = new Error("training_day_runs: reservation held by an unfinished run");
  err.retryable = true;
  err.code = "training_reservation_held";
  return err;
}

// #6839 (owner choice A 19/10): the evening run holds a race day. The press answers
// 409 training_in_progress (the page shows "Running…" and updates by itself), runs
// no later race day, and never becomes a 500.
test("#6839: a race day held by the evening run answers 409 training_in_progress, no later day runs", async () => {
  const state = baseState();
  const { deps, calls } = harness(state);
  deps.runDay = async (args) => {
    calls.push(args);
    if (args.gameDay === 32) throw makeTrainingReservationHeldError();
    return { alreadyRan: false };
  };
  const result = await runTrainNow(deps);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "training_in_progress");
  assert.deepEqual(result.body.settledGameDays, [31]);
  assert.equal(result.body.locked, true, "this press locked the date before the held day");
  assert.deepEqual(calls.map((c) => c.gameDay), [31, 32], "stops at the held day");
});

test("#6839: any other engine error still throws (route answers 500 + Sentry)", async () => {
  const state = baseState();
  const { deps } = harness(state);
  deps.runDay = async () => { throw new Error("boom"); };
  await assert.rejects(runTrainNow(deps), /boom/);
});

// #7282: a bridge date (negative race days) may not be pressed while an earlier bridge
// date of the same season has no registered work: the sweep still has to catch it up.
function bridgeHarness(state, earlierRegistered) {
  state.seasons = [{ id: "s4", number: 4, end_date: "2026-10-25" }, { id: "s5", number: 5, start_date: "2026-10-28" }];
  if (earlierRegistered) state.training_date_work.push({ team_id: TEAM.id, season_id: "s5", tick_date: "2026-10-26", status: "complete" });
  const h = harness(state);
  const ctx = fakeContext();
  ctx.stages = []; ctx.races = []; ctx.entries = [];
  ctx.gameDaysByDivision = new Map([[TEAM.league_division_id, [-5, -4, -3, -2, -1]]]);
  return { ...h, deps: { ...h.deps, season: { id: "s5", number: 5 }, now: new Date("2026-10-27T09:00:00Z"), loadContext: async () => ctx } };
}

test("#7282: an unregistered earlier bridge date blocks the press", async () => {
  const { deps, calls, supabase } = bridgeHarness(baseState(), false);
  const result = await runTrainNow(deps);
  assert.deepEqual([result.status, result.body.error], [409, "previous_date_open"]);
  assert.equal(calls.length + supabase.writes.length, 0);
});

test("#7282: with the earlier bridge date registered, the bridge date can be pressed", async () => {
  const state = baseState();
  const { deps, calls } = bridgeHarness(state, true);
  const result = await runTrainNow(deps);
  assert.equal(result.status, 200);
  assert.deepEqual(calls.map((c) => c.gameDay), [-5, -4, -3, -2, -1]);
});

test("#7282: the first race date is also blocked while a bridge date is unregistered", async () => {
  const state = baseState();
  const { deps, calls, supabase } = bridgeHarness(state, true);
  const ctx = fakeContext(); // race date: positive race days
  const result = await runTrainNow({ ...deps, now: new Date("2026-10-28T09:00:00Z"), loadContext: async () => ctx });
  assert.deepEqual([result.status, result.body.error], [409, "previous_date_open"], "27/10 is not registered");
  assert.equal(calls.length + supabase.writes.length, 0);
  state.training_date_work.push({ team_id: TEAM.id, season_id: "s5", tick_date: "2026-10-27", status: "complete" });
  const pressed = await runTrainNow({ ...deps, now: new Date("2026-10-28T09:00:00Z"), loadContext: async () => ctx });
  assert.equal(pressed.status, 200, "the whole bridge registered: the race date can be pressed");
});

test("#7282: bridge dates the team was not eligible for are no prerequisite", async () => {
  // Team created 28/10: the sweep never registers 26-27/10 for it.
  const created = { ...TEAM, created_at: "2026-10-28T08:00:00Z" };
  const state = baseState();
  const { deps } = bridgeHarness(state, false);
  const ctx = fakeContext();
  ctx.teams = [created];
  const result = await runTrainNow({ ...deps, team: created, now: new Date("2026-10-28T09:00:00Z"), loadContext: async () => ctx });
  assert.equal(result.status, 200);
  // A rider bought on 28/10 does not make 27/10 a date for the team either.
  const empty = baseState();
  const h = bridgeHarness(empty, false);
  const later = fakeContext();
  later.riders = later.riders.map((rider) => ({ ...rider, acquired_at: "2026-10-28T07:00:00Z" }));
  const pressed = await runTrainNow({ ...h.deps, now: new Date("2026-10-28T09:00:00Z"), loadContext: async () => later });
  assert.equal(pressed.status, 200);
});
