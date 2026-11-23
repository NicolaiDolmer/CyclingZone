import assert from "node:assert/strict";
import test from "node:test";
import { buildTeamFatigueForecast } from "./trainingWeekPlanForecast.js";
import { forecastRotationFields } from "./trainingWeekForecast.js";
import { buildRotationOnSave } from "./trainingRotation.js";
import {
  createFake, DATE1, DATE2, DAYS1, EVENING_AT, finishRace, press, RACE,
  rider, seedState, SEASON, sweep, TEAM,
} from "./trainNowSameResult7982.harness.js";

const riderId = rider(0);
const passes = ["sprint", "threshold", "endurance", "vo2max"].map((session) => ({ session }));

function plan(length = 3, index = 0) {
  return { v: 1, rev: 1, passes: passes.slice(0, length), anchor: { rev: 1, index } };
}

function fixture({ rotation = plan(), ...options } = {}) {
  const state = seedState({
    count: 1, noPlan: [0], ...options,
    flags: { training_rotation: "on", fatigue_now_7801: "on", ...options.flags },
  });
  state.training_week_plans.push({ team_id: TEAM, rider_id: riderId, days: {}, plan_kind: "rotation", rotation });
  return state;
}

function actualSlots(state) {
  return DAYS1.map((day) => {
    const report = state.training_rider_ticks.find((row) => row.rider_id === riderId && row.game_day === day)?.report;
    if (!report) return null;
    if (report.intensity === "race") return "race";
    if (report.intensity === "unknown_pending") return "unknown";
    return report.rotation?.advanced ? report.rotation.index : report.intensity;
  });
}

function forecast({ rotation = plan(), race = [], bound = [], ...options } = {}) {
  return buildTeamFatigueForecast({
    tickDate: DATE1, seasonId: SEASON.id, dateGameDays: DAYS1,
    riders: [{ id: riderId, primary_type: "sprinter" }],
    rotationByRider: new Map([[riderId, rotation]]),
    plannedStages: race.map((index) => ({ rider_id: riderId, game_day: DAYS1[index] })),
    boundRiderIdsByGameDay: new Map(bound.map((index) => [DAYS1[index], new Set([riderId])])),
    conditionModelV2: true, ...options,
  })[riderId];
}

function numbers(result) {
  return result.rotationSlots?.map((stamp) => stamp?.index ?? null);
}

test("ROT-1: etapedatoer har frie felter, hel bundet dato parkerer rotationen", () => {
  const first = forecast({ race: [1, 3], bound: [0, 1, 2, 3, 4] });
  assert.deepEqual(numbers(first), [0, null, 1, null, 2]);
  const rest = forecast({ tickDate: DATE2, bound: [0, 1, 2, 3, 4] });
  assert.deepEqual(numbers(rest), [null, null, null, null, null]);
  assert.equal(rest.nextRotationIndex, 0);
  assert.deepEqual(numbers(forecast({ race: [0], bound: [0, 1, 2, 3, 4] })), [null, 0, 1, 2, 0]);
});

test("ROT-2: anker, overlap med etaper og wrap", () => {
  const rotation = plan(4, 2);
  const first = forecast({ rotation, race: [2, 4], bound: [0, 1, 2, 3, 4] });
  assert.deepEqual(numbers(first), [2, 3, null, 0, null]);
  const second = forecast({ rotation: plan(4, first.nextRotationIndex), race: [1], bound: [0, 1, 2, 3, 4] });
  assert.deepEqual(numbers(second), [1, null, 2, 3, 0]);
});

for (const [id, fallback, expected, next] of [
  ["ROT-3", "rest", [0, null, null, null, null], 1],
  ["ROT-4", "light", [0, null, 1, 2, 0], 1],
]) {
  test(`${id}: træthedsgrænsen afgøres på hvert felt`, () => {
    const result = forecast({
      race: [1], fatigueNow: true,
      openingByRider: new Map([[riderId, { fatigue: 49, form: 50 }]]),
      recordedLoads: [{ rider_id: riderId, game_day: DAYS1[1], load: 20 }],
      fatigueRules: { forRider: () => ({ threshold: 50, fallback }) },
    });
    assert.deepEqual(numbers(result), expected);
    assert.equal(result.nextRotationIndex, next);
  });
}

test("ROT-5: Træn nu og aften med planlagt løb bruger de samme pladser", async () => {
  const evening = fixture({ entered: [0], stageRun: true });
  await sweep(evening, createFake(evening));
  const morning = fixture({ entered: [0] });
  const fake = createFake(morning);
  await press(morning, fake);
  finishRace(morning);
  await sweep(morning, fake);
  assert.deepEqual(actualSlots(evening), [0, 1, "race", 2, 0]);
  assert.deepEqual(actualSlots(morning), actualSlots(evening));
  const raceFocus = (state) => state.training_rider_ticks.find((row) => row.game_day === DAYS1[2]).report.focus;
  assert.equal(raceFocus(morning), raceFocus(evening));
});

test("Fable B1: an unavailable v3 pass waits in the motor and both forecasts", async () => {
  const rotation = { ...plan(), passes: [{ session: "itt_long" }, { session: "sprint" }] };
  const state = fixture({ rotation, flags: { training_catalog_v3: "off" } });
  await sweep(state, createFake(state));
  assert.equal(state.training_rider_ticks.length, DAYS1.length);
  assert.ok(state.training_rider_ticks.every((row) => !row.report.rotation?.advanced));
  assert.deepEqual(numbers(forecast({ rotation, catalogV3: false })), Array(5).fill(null));
  const week = forecastRotationFields({
    rotation, startIndex: 0, gameDays: DAYS1, fields: { raceSlots: [], restSlots: [] }, catalogV3: false,
  });
  assert.deepEqual(numbers(week), Array(5).fill(null));
  assert.equal(week.nextRotationIndex, 0);
});

test("Fable B2: an own rotation takes precedence over team week fields", async () => {
  const teamWeekRow = { rider_id: null, team_id: TEAM, plan_kind: "week", days: {
    mon: { session: "sprint", intensity: "normal", slots: Array(5).fill("sprint"), lockSlot: 2 },
  } };
  const state = fixture({ flags: { training_week_priority: "on" } });
  state.training_week_plans.push(teamWeekRow);
  await sweep(state, createFake(state));
  assert.deepEqual(actualSlots(state), [0, 1, 2, 0, 1]);
  assert.ok(state.training_rider_ticks.every((row) => !Object.hasOwn(row.report, "source_slot")));
  const result = forecast({ weekPriority: true, teamWeekRow });
  assert.deepEqual(numbers(result), [0, 1, 2, 0, 1]);
  assert.equal(result.fieldSource, undefined);
});

test("Rotation continues from the latest receipt in the previous season", async () => {
  const state = fixture();
  state.training_rider_ticks.push({
    rider_id: riderId, team_id: TEAM, season_id: "previous-season", tick_date: "2026-11-08", game_day: 40,
    report: { rotation: { rev: 1, length: 3, index: 1, order: 3, advanced: true } },
  });
  await sweep(state, createFake(state));
  assert.deepEqual(actualSlots(state), [2, 0, 1, 2, 0]);
});

test("A planned rest pass advances the rotation", async () => {
  const rotation = { ...plan(), passes: [{ session: "rest" }, { session: "sprint" }] };
  const state = fixture({ rotation });
  await sweep(state, createFake(state));
  const rows = state.training_rider_ticks;
  assert.equal(rows[0].report.intensity, "rest");
  assert.equal(rows[0].report.rotation?.advanced, true);
  assert.equal(rows[1].report.rotation?.index, 1);
});

test("ROT-6: et sent DNS-felt bruger den sidste plads samme dato", async () => {
  const evening = fixture();
  await sweep(evening, createFake(evening));
  const morning = fixture({ entered: [0] });
  const fake = createFake(morning);
  await press(morning, fake);
  morning.race_entries = [];
  morning.race_entry_days = [];
  const race = morning.races.find((row) => row.id === RACE);
  race.status = "completed";
  race.stages_completed = 1;
  await sweep(morning, fake, { deadlineReached: true });
  assert.deepEqual(actualSlots(evening), [0, 1, 2, 0, 1]);
  assert.deepEqual(actualSlots(morning), [0, 1, 1, 2, 0]);
  assert.deepEqual(morning.rider_derived_abilities, evening.rider_derived_abilities);
  assert.deepEqual(morning.rider_condition, evening.rider_condition);
});

test("ROT-7: skade venter, uafklaret kvittering viser intet nummer", () => {
  const injured = forecast({
    conditionByRider: new Map([[riderId, { injured_until: "2026-11-20", injury_end_game_day: 90, injury_season_id: SEASON.id }]]),
  });
  assert.deepEqual(numbers(injured), [null, null, null, null, null]);
  assert.equal(injured.nextRotationIndex, 0);
  const pending = forecast({
    receipts: [{ rider_id: riderId, game_day: DAYS1[0], report: { intensity: "unknown_pending" } }],
  });
  assert.equal(pending?.rotationSlots?.[0] ?? null, null);
});

test("ROT-8: genkørsel skriver ingen ekstra rotationskvitteringer", async () => {
  const state = fixture();
  const fake = createFake(state);
  await sweep(state, fake);
  assert.deepEqual(actualSlots(state), [0, 1, 2, 0, 1]);
  const original = structuredClone(state.training_rider_ticks);
  await sweep(state, fake, { now: EVENING_AT });
  assert.deepEqual(state.training_rider_ticks, original);
  const historyReads = fake.log.filter((entry) => entry.target === "training_rider_ticks"
    && entry.filters?.some(([op, column]) => op === "lt" && column === "tick_date"));
  assert.equal(historyReads.length, 1);
});

test("ROT-9: en eksplicit rytterplan vinder over holdrotation", async () => {
  const state = fixture({ count: 2, noPlan: [1] });
  state.training_week_plans[0].rider_id = null;
  state.training_week_plans.push({ team_id: TEAM, rider_id: riderId, days: {}, plan_kind: "week" });
  await sweep(state, createFake(state));
  assert.equal(state.training_rider_ticks.length, 2 * DAYS1.length);
  assert.ok(state.training_rider_ticks.filter((row) => row.rider_id === riderId).every((row) => row.report.rotation === undefined));
  assert.equal(state.training_rider_ticks.find((row) => row.rider_id === rider(1))?.report.rotation?.index, 0);
});

test("ROT-10: samme længde læser rytterens seneste plads, ny længde starter på første pas", () => {
  const previous = plan();
  const receipt = {
    team_id: TEAM, rider_id: riderId, game_day: 40, tick_date: "2026-11-08",
    report: { rotation: { rev: previous.rev, length: 3, index: 0, advanced: true, order: 1 } },
  };
  const sameLength = buildRotationOnSave(previous, [passes[2], passes[0], passes[1]]);
  const newLength = buildRotationOnSave(previous, passes);
  const restart = buildRotationOnSave(previous, previous.passes, { keepPlace: false });
  const first = (rotation) => numbers(forecast({
    rotation, rotationReceiptsByRider: new Map([[riderId, [receipt]]]),
  }))?.[0];
  assert.equal(first(sameLength), 1);
  assert.equal(first(newLength), 0);
  assert.equal(first(restart), 0);
});

test("OLD-1 / OFF-1 / OFF-2: gamle uger og slukkede kontakter beholder eksisterende kvitteringer", async () => {
  async function run(state) {
    const fake = createFake(state);
    const results = await sweep(state, fake);
    assert.ok(results.every((result) => !result.error), JSON.stringify(results));
    return {
      riders: state.rider_derived_abilities,
      condition: state.rider_condition,
      scores: state.rider_training_scores,
      receipts: state.training_rider_ticks,
      reads: fake.log.filter((entry) => entry.kind === "read" && entry.target !== "app_config")
        .map(({ target, filters }) => ({ target, filters })),
    };
  }
  const absent = seedState({ count: 1, noPlan: [0], flags: { fatigue_now_7801: "on" } });
  const legacy = await run(absent);
  const noPlans = seedState({ count: 1, noPlan: [0], flags: { training_rotation: "on", fatigue_now_7801: "on" } });
  assert.deepEqual(await run(noPlans), legacy);
  const off = fixture({ flags: { training_rotation: "off", training_week_priority: "on" } });
  assert.deepEqual(await run(off), legacy);
  const oldPlan = fixture();
  oldPlan.training_week_plans[0].plan_kind = null;
  assert.deepEqual(await run(oldPlan), legacy);
});

test("fejl ved opslag af training_rotation afbryder afregningen, indtil flaget kan læses", async () => {
  const state = fixture();
  const broken = createFake(state, {
    fail: ({ entry }) => entry.target === "app_config"
      && entry.filters?.some((item) => item[1] === "key" && item[2] === "training_rotation") ? "error" : null,
  });
  const failed = await sweep(state, broken);
  assert.ok(failed.some((result) => /training rotation flag/.test(result.error ?? "")));
  assert.equal(state.training_rider_ticks.length, 0);
  await sweep(state, createFake(state));
  assert.deepEqual(actualSlots(state), [0, 1, 2, 0, 1]);
});

test("ugeprognosen fortsætter fra samme rotationspas efter restitution fra etapen", () => {
  const result = forecastRotationFields({
    rotation: plan(), startIndex: 1, gameDays: DAYS1, fields: { raceSlots: [2], restSlots: [] },
    rule: { recoveryAfterStage: true }, rodeStagePreviousDate: true,
  });
  assert.deepEqual(numbers(result), [null, 1, null, 2, 0]);
  assert.deepEqual(result.recoverySlots, [0]);
  assert.equal(result.nextRotationIndex, 1);
});
