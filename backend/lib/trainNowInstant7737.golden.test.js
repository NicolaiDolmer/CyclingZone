// #7737: switch off = what the frozen merge-base code sends to the database (#7587), and
// switch on = the engine rules of "Train now straight away", on a logging stand-in. The real
// SQL is covered by trainNowInstant7737.integration.test.js and .pg17.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SCENARIOS, DATE, DAYS, RACE, SEASON, PRESS_AT, EVENING_AT,
  seedState, createFake, digest, press, sweep, finishRace, enter, runScenario,
} from "./__fixtures__/trainNowInstant7737Harness.js";
import { TRAIN_NOW_INSTANT_FLAG_KEY, evaluateTrainNowInstantFlag } from "./trainNow.js";
import { loadTrainNowInstantRiderIds } from "./trainNowLock.js";

const frozen = JSON.parse(await readFile(new URL("./__fixtures__/trainNowInstant7737.golden.json", import.meta.url), "utf8"));
const V2 = { condition_model_v2: "on", condition_v2_race_date_training_day: "on" };
const INSTANT = { [TRAIN_NOW_INSTANT_FLAG_KEY]: "on" };

const commitsOf = (log) => log.filter((entry) => entry.rpc?.endsWith("commit_training_date_tick")).map((entry) => entry.args);
const rowsFor = (commit, id) => commit.p_conditions.filter((row) => row.rider_id === id);
const ticksOf = (state, id) => state.training_rider_ticks.filter((row) => row.rider_id === id).map((row) => row.game_day).sort((a, b) => a - b);
const settlementsOf = (state, id) => state.training_condition_settlements.filter((row) => row.rider_id === id).length;
const condition = (state, id) => state.rider_condition.find((row) => row.rider_id === id);
const without = (row, ...keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

test("golden: every scenario with the switch off equals the frozen merge-base digest", async () => {
  assert.deepEqual(Object.keys(frozen.digests).sort(), Object.keys(SCENARIOS).sort());
  for (const name of Object.keys(SCENARIOS)) {
    assert.deepEqual(await runScenario(name), frozen.digests[name], `${name} moved away from the frozen code`);
  }
});

test("golden: only the exact string 'on' turns the switch on", async () => {
  for (const value of ["off", "beta", true, "ON", 1, null]) assert.equal(evaluateTrainNowInstantFlag(value), false, String(value));
  assert.equal(evaluateTrainNowInstantFlag("on"), true);
  const scenario = SCENARIOS.race_rider_full_day;
  for (const value of ["off", "beta", true]) {
    const state = seedState({ ...scenario.seed, flags: { ...scenario.seed.flags, [TRAIN_NOW_INSTANT_FLAG_KEY]: value } });
    const fake = createFake(state);
    await scenario.steps(state, fake);
    assert.equal(digest(fake.log), frozen.digests.race_rider_full_day.digest, `switch value ${value}`);
  }
});

function instantDay({ fatigue = 30, intensity = "normal", flags = V2, raceDay = 43 } = {}) {
  const state = seedState({ fatigue, intensity, raceDay, flags: { ...flags, ...INSTANT } });
  enter(state, ["r2"]);
  return { state, fake: createFake(state) };
}

test("press: a race rider trains his free race days now and his race slot stays open", async () => {
  const { state, fake } = instantDay();
  const result = await press(state, fake);
  assert.equal(result.status, 200);
  assert.deepEqual(ticksOf(state, "r2"), [41, 42, 44, 45]);
  assert.deepEqual(ticksOf(state, "r1"), DAYS, "the rider without a race still gets his whole date");
  assert.deepEqual(result.body.instantRiderIds, ["r2"]);
  assert.deepEqual(result.body.afterRaceRiderIds, ["r2"]);
  for (const commit of commitsOf(fake.log)) assert.notEqual(commit.p_report.riders.find((r) => r.rider_id === "r2")?.game_day, 43);
});

test("press: the stamp is on the rider before any of his race days settles, and only on him", async () => {
  const { state, fake } = instantDay();
  await press(state, fake);
  const stamp = fake.log.findIndex((entry) => entry.table === "training_train_now_locks" && entry.write === "update" && entry.payload.instant_at != null);
  const firstCommit = fake.log.findIndex((entry) => entry.rpc?.endsWith("commit_training_date_tick"));
  assert.ok(stamp >= 0 && stamp < firstCommit, "stamp first");
  const locks = Object.fromEntries(state.training_train_now_locks.map((row) => [row.rider_id, row.instant_at ?? null]));
  assert.equal(locks.r1, null);
  assert.equal(locks.r2, PRESS_AT.toISOString());
});

test("press: fatigue and form count now as provisional numbers, written once with no injury fields", async () => {
  const { state, fake } = instantDay();
  const before = structuredClone(condition(state, "r2"));
  await press(state, fake);
  const rows = commitsOf(fake.log).flatMap((commit) => rowsFor(commit, "r2"));
  assert.equal(rows.length, 1, "one provisional row, on the last free race day");
  assert.deepEqual(Object.keys(rows[0]).sort(), ["fatigue", "form", "provisional", "rider_id"]);
  assert.equal(commitsOf(fake.log).find((commit) => rowsFor(commit, "r2").length).p_game_day, 45);
  assert.notEqual(condition(state, "r2").fatigue, before.fatigue, "the press moved his fatigue");
  assert.equal(settlementsOf(state, "r2"), 0, "the date is not closed");
  assert.equal(condition(state, "r2").updated_at, before.updated_at);
});

test("press: injury and illness are never rolled at the press, however tired he is", async () => {
  for (let seed = 0; seed < 6; seed += 1) {
    const { state, fake } = instantDay({ fatigue: 92 + seed, intensity: "hard" });
    await press(state, fake);
    const row = condition(state, "r2");
    assert.equal(row.injured_until, null);
    assert.equal(row.injury_cause, null);
    assert.ok(commitsOf(fake.log).every((commit) => commit.p_report.riders.filter((r) => r.rider_id === "r2").every((r) => !r.injured && !r.injury_days && !r.illness_days)));
  }
});

test("evening: his race slot closes the date once, and the closing numbers equal a rider who never pressed", async () => {
  for (const scenario of [{ fatigue: 30, intensity: "normal" }, { fatigue: 80, intensity: "hard" }]) {
    const { state, fake } = instantDay(scenario);
    await press(state, fake);
    finishRace(state, ["r2"]);
    await sweep(state, fake);
    assert.deepEqual(ticksOf(state, "r2"), DAYS);
    assert.equal(settlementsOf(state, "r2"), 1);
    const closing = commitsOf(fake.log).find((commit) => rowsFor(commit, "r2").some((row) => !row.provisional));
    assert.equal(closing.p_game_day, 43, "closed by the tick that filled his last missing race day");
    assert.deepEqual(closing.p_race_loads.map((row) => row.rider_id), ["r2"], "only the closing rider's load");

    const control = seedState({ ...scenario, flags: V2 });
    enter(control, ["r2"]);
    const controlFake = createFake(control);
    await press(control, controlFake);
    finishRace(control, ["r2"]);
    await sweep(control, controlFake);
    assert.deepEqual(without(condition(state, "r2"), "updated_at"), without(condition(control, "r2"), "updated_at"), "same close as the evening run");
  }
});

test("idempotent: a double press and a repeated sweep change nothing further", async () => {
  const { state, fake } = instantDay();
  await press(state, fake);
  const afterFirst = structuredClone({ ticks: state.training_rider_ticks, cond: state.rider_condition });
  await press(state, fake);
  assert.deepEqual({ ticks: state.training_rider_ticks, cond: state.rider_condition }, afterFirst);
  finishRace(state, ["r2"]);
  await sweep(state, fake);
  const closed = structuredClone({ ticks: state.training_rider_ticks, cond: state.rider_condition, settled: state.training_condition_settlements });
  await sweep(state, fake);
  assert.deepEqual({ ticks: state.training_rider_ticks, cond: state.rider_condition, settled: state.training_condition_settlements }, closed);
  assert.equal(settlementsOf(state, "r2"), 1);
});

test("switching off mid-date: the stamp decides, the rider still closes exactly once", async () => {
  const { state, fake } = instantDay();
  await press(state, fake);
  state.app_config.find((row) => row.key === TRAIN_NOW_INSTANT_FLAG_KEY).value = "off";
  const ticks = ticksOf(state, "r2");
  await press(state, fake);
  assert.deepEqual(ticksOf(state, "r2"), ticks, "the off press adds nothing for him");
  finishRace(state, ["r2"]);
  await sweep(state, fake);
  assert.deepEqual(ticksOf(state, "r2"), DAYS);
  assert.equal(settlementsOf(state, "r2"), 1);
});

test("a retry after a press that stopped midway resumes the missing free race days", async () => {
  const { state, fake } = instantDay();
  const real = fake.supabase.rpc;
  let commits = 0;
  fake.supabase.rpc = async (name, args) => {
    if (name.endsWith("commit_training_date_tick") && ++commits === 3) throw new Error("connection lost");
    return real(name, args);
  };
  await assert.rejects(press(state, fake), /connection lost/);
  assert.deepEqual(ticksOf(state, "r2"), [41, 42]);
  fake.supabase.rpc = real;
  await press(state, fake);
  assert.deepEqual(ticksOf(state, "r2"), [41, 42, 44, 45]);
});

test("a stage rider's free race days are trained at the press, not rested", async () => {
  const { state, fake } = instantDay();
  state.race_entry_days = DAYS.map((game_day) => ({ rider_id: "r2", race_id: RACE, season_id: SEASON.id, game_day }));
  await press(state, fake);
  const free = commitsOf(fake.log).flatMap((commit) => commit.p_report.riders.filter((r) => r.rider_id === "r2"));
  assert.equal(free.length, 4);
  assert.ok(free.every((r) => r.intensity === "normal"), JSON.stringify(free.map((r) => r.intensity)));
});

test("a race on the date's last slot: three facts hold at once", async () => {
  const { state, fake } = instantDay({ raceDay: 45 });
  await press(state, fake);
  assert.deepEqual(ticksOf(state, "r2"), [41, 42, 43, 44]);
  assert.equal(commitsOf(fake.log).find((commit) => rowsFor(commit, "r2").length).p_game_day, 44);
  finishRace(state, ["r2"], { gameDay: 45 });
  await sweep(state, fake, { now: EVENING_AT });
  assert.equal(settlementsOf(state, "r2"), 1);
});

test("the stamp read: a read error throws, a missing column or table means no stamps", async () => {
  const state = { training_train_now_locks: [{ rider_id: "r1", tick_date: DATE, instant_at: "x" }, { rider_id: "r2", tick_date: DATE }] };
  const ids = await loadTrainNowInstantRiderIds({ supabase: createFake(state).supabase, tickDate: DATE, riderIds: ["r1", "r2"] });
  assert.deepEqual([...ids], ["r1"]);
  const failing = (error) => ({ from: () => { const q = { select: () => q, eq: () => q, in: async () => ({ data: null, error }) }; return q; } });
  await assert.rejects(loadTrainNowInstantRiderIds({ supabase: failing({ code: "XX000", message: "boom" }), tickDate: DATE, riderIds: ["r1"] }), /instant stamps/);
  for (const error of [{ code: "42703", message: "column training_train_now_locks.instant_at does not exist" }, { code: "42P01", message: "missing" }]) {
    assert.equal((await loadTrainNowInstantRiderIds({ supabase: failing(error), tickDate: DATE, riderIds: ["r1"] })).size, 0);
  }
  await assert.rejects(loadTrainNowInstantRiderIds({ supabase: failing({ code: "42703", message: "column other does not exist" }), tickDate: DATE, riderIds: ["r1"] }), /instant stamps/);
});
