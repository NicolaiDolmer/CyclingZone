import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildTeamFatigueForecast, loadTeamFatigueForecast } from "./trainingWeekPlanForecast.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { DATE1, DAYS1, EVENING_AT, RACE, SEASON, TEAM, createFake, digest, press, rider, seedState, sweep } from "./trainNowSameResult7982.harness.js";

const RIDER = rider(0);
const SESSIONS = ["sprint", "tempo", "threshold", "vo2max", "endurance"];
const FIELDS = [0, 1, 2, 3, 4];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function scenario({
  lock, race = [], bound = race, injured = false, injuryEnd, pending = false, fatigue = false, efforts,
  stage = "on", planKind = "week", dns = false,
} = {}) {
  const state = seedState({
    count: 1, noPlan: [0], injured: injured ? [0] : [], entered: bound.length ? [0] : [],
    flags: {
      training_week_priority: stage, training_effort_levels: efforts ? "on" : "off",
      fatigue_now_7801: fatigue ? "on" : "off", development_curve_b: "off", race_day_role_yield_enabled: "off",
    },
  });
  const entry = { session: "tempo", intensity: "normal", slots: [...SESSIONS], lockSlot: lock, ...(efforts ? { slotEfforts: efforts } : {}) };
  const weekRow = { id: "week", team_id: TEAM, rider_id: RIDER, plan_kind: planKind, days: Object.fromEntries(WEEKDAYS.map((day) => [day, entry])) };
  state.training_week_plans.push(weekRow);
  const ownedRace = state.races.find((row) => row.id === RACE);
  ownedRace.race_type = bound.length > race.length || race.length > 1 ? "stage_race" : "single";
  state.race_stage_schedule = state.race_stage_schedule.filter((row) => row.race_id !== RACE);
  state.race_stage_schedule.push(...race.map((slot, i) => ({
    race_id: RACE, game_day: DAYS1[slot], stage_number: i + 1, scheduled_at: `${DATE1}T${14 + i}:00:00Z`,
  })));
  state.race_entry_days = bound.map((slot) => ({ race_id: RACE, rider_id: RIDER, team_id: TEAM, season_id: SEASON.id, game_day: DAYS1[slot] }));
  const settle = () => {
    ownedRace.stages_completed = race.length;
    ownedRace.status = "completed";
    // Fund A: the stage ran, but he was not in the start field (no result, no load).
    if (dns) {
      state.race_simulation_runs.push({ id: "run-dns", race_id: RACE, stage_number: 1, entrant_snapshot: [] });
      return;
    }
    for (const [i, slot] of race.entries()) {
      const stageNumber = i + 1;
      state.race_results.push({ id: `result-${slot}`, race_id: RACE, stage_number: stageNumber, rider_id: RIDER, result_type: "stage", rank: 1, imported_at: `${DATE1}T17:00:00Z` });
      state.training_race_loads.push({ rider_id: RIDER, race_id: RACE, stage_number: stageNumber, season_id: SEASON.id,
        game_day: DAYS1[slot], tick_date: DATE1, load: fatigue ? 25 : 9, consumed_at: null, duplicate_of_race_id: null });
      state.race_simulation_runs.push({ id: `run-${slot}`, race_id: RACE, stage_number: stageNumber, entrant_snapshot: [RIDER] });
    }
  };
  if (!pending && race.length) settle();
  if (fatigue) {
    state.rider_condition[0].fatigue = 49;
    state.team_training_rules.push({ team_id: TEAM, rider_id: null, fatigue_threshold: 50, fallback: "rest", recovery_after_stage: false });
  }
  if (injuryEnd != null) state.rider_condition[0].injury_end_game_day = injuryEnd;
  const opening = structuredClone(state.rider_condition[0]);
  const forecast = (receipts = state.training_rider_ticks) => buildTeamFatigueForecast({
    tickDate: DATE1, seasonId: SEASON.id, dateGameDays: DAYS1, riders: state.riders, cellsOn: true,
    conditionByRider: new Map([[RIDER, opening]]), openingByRider: new Map([[RIDER, opening]]),
    recoveryByRider: new Map([[RIDER, state.rider_derived_abilities[0].recovery]]),
    riderWeekDaysByRider: new Map([[RIDER, weekRow.days]]), riderWeekRowByRider: new Map([[RIDER, weekRow]]),
    receipts, recordedLoads: state.training_race_loads,
    plannedStages: race.map((slot) => ({ rider_id: RIDER, game_day: DAYS1[slot], profile_type: "rolling" })),
    boundRiderIdsByGameDay: new Map(bound.map((slot) => [DAYS1[slot], new Set([RIDER])])),
    weekPriority: stage === "on", conditionModelV2: true, raceDateTrainingDay: true, catalogV3: true,
    fatigueNow: fatigue, effortLevels: Boolean(efforts),
    fatigueRules: fatigue ? { forRider: () => ({ threshold: 50, fallback: "rest" }) } : null,
  })[RIDER];
  return { state, forecast, settle };
}

function reports(state) {
  return DAYS1.map((gameDay) => state.training_rider_ticks.find((row) => row.rider_id === RIDER && row.game_day === gameDay)?.report);
}

function sources(state) {
  return reports(state).map((report) => report?.source_slot ?? null);
}

async function run(state, fake = createFake(state), options = {}) {
  const output = await sweep(state, fake, options);
  assert.deepEqual(output.filter((result) => result.error), []);
  assert.equal(reports(state).filter(Boolean).length, 5);
  return fake;
}

function matchForecast(forecast, state, fieldSource, taken, lockMovedFrom) {
  assert.deepEqual(sources(state), fieldSource);
  assert.deepEqual(forecast?.fieldSource, fieldSource);
  assert.deepEqual(forecast?.taken, taken);
  assert.equal(forecast?.lockMovedFrom, lockMovedFrom);
}

test("Fable: etape LD3 uden resultat ved deadline lader C flytte til LD4", async () => {
  const { state, forecast } = scenario({ lock: 2, race: [2], pending: true });
  const before = forecast([]);
  await run(state, createFake(state), { deadlineReached: true });
  assert.equal(reports(state)[2].intensity, "unknown_pending");
  assert.equal("source_slot" in reports(state)[2], false);
  assert.equal(reports(state)[3].focus, "threshold");
  matchForecast(before, state, [0, 1, null, 2, 3], [4], 2);
  matchForecast(forecast(), state, [0, 1, null, 2, 3], [4], 2);
});

test("ejer 23/11: låsen i et frit felt mellem to etaper bliver hjemme", async () => {
  const { state, forecast } = scenario({ lock: 2, race: [1, 3], bound: FIELDS, pending: true });
  const before = forecast([]);
  await run(state, createFake(state), { deadlineReached: true });
  assert.equal(reports(state)[2].focus, "threshold");
  assert.equal(reports(state)[2].source_slot, 2);
  matchForecast(before, state, [0, null, 2, null, 1], [3, 4], null);
});

test("fund A: etapen i LD3 blev kørt uden ham, så C kører én gang i LD3 og LD4 får D", async () => {
  const { state, forecast } = scenario({ lock: 2, race: [2], dns: true });
  await run(state);
  assert.deepEqual(reports(state).map((report) => report.focus), SESSIONS);
  assert.equal(reports(state)[2].bound_race_day, false);
  matchForecast(forecast(), state, FIELDS, [], null);
});

test("regel B: låsen i et skadet felt flytter til datoens første raske felt", async () => {
  const { state, forecast } = scenario({ lock: 0, injured: true, injuryEnd: DAYS1[1] });
  const before = forecast([]);
  await run(state);
  assert.deepEqual(reports(state).map((report) => report.intensity).slice(0, 2), ["rest", "rest"]);
  assert.equal(reports(state)[2].focus, "sprint");
  assert.deepEqual(reports(state).slice(3).map((report) => report.focus), ["vo2max", "endurance"]);
  matchForecast(before, state, [null, null, 0, 3, 4], [], 0);
  matchForecast(forecast(), state, [null, null, 0, 3, 4], [], 0);
  assert.equal(before.fatigue, state.rider_condition[0].fatigue);
});

for (const [name, race, fieldSource, taken] of [
  ["WB-2", [4], [0, 1, 2, 4, null], [3]],
  ["WB-4", [0, 4], [null, 0, 1, 4, null], [2, 3]],
]) {
  test(`${name}: aftenkørslens kildefelter og prognosens løbstab stemmer`, async () => {
    const { state, forecast } = scenario({ lock: 4, race });
    const before = forecast([]);
    await run(state);
    matchForecast(before, state, fieldSource, taken, 4);
    matchForecast(forecast(), state, fieldSource, taken, 4);
    assert.equal(before.fatigue, state.rider_condition[0].fatigue);
  });
}

// The fake cannot filter on an embedded join (races!inner); every race in the scenario is in the
// team's season and division, so the day-close lookup drops those two filters.
const withScheduleJoin = (supabase) => new Proxy(supabase, {
  get(target, key) {
    if (key !== "from") return Reflect.get(target, key);
    return (table) => {
      const query = target.from(table);
      if (table !== "race_stage_schedule") return query;
      const eq = query.eq;
      query.eq = (column, value) => (String(column).startsWith("races.") ? query : eq.call(query, column, value));
      return query;
    };
  },
});

test("fund D: loadTeamFatigueForecast på en afregnet dato viser motorens felter med kontakten on", async () => {
  for (const stage of ["on", "off"]) {
    const { state } = scenario({ lock: 4, race: [4], stage });
    const fake = await run(state);
    const svar = await loadTeamFatigueForecast({ supabase: withScheduleJoin(fake.supabase), team: state.teams[0], seasonId: SEASON.id, now: EVENING_AT });
    assert.equal(svar.available, true, svar.reason);
    assert.equal(svar.settled, true);
    const own = svar.riders[RIDER];
    assert.equal(own.fatigue, state.rider_condition[0].fatigue, "en afregnet dato viser aftenens træthed");
    if (stage === "on") {
      assert.deepEqual(own.fieldSource, sources(state));
      assert.deepEqual(own.fieldSource, [0, 1, 2, 4, null]);
      assert.deepEqual(own.taken, [3]);
      assert.equal(own.lockMovedFrom, 4);
    } else {
      assert.equal("fieldSource" in own, false, "slukket: svaret uden ugens felter");
    }
  }
});

test("fund C: beta-trinnets ejer-opslag fejler: motoren afregner ikke, prognosen viser dagens felter", async () => {
  const { state } = scenario({ lock: 4, race: [4], stage: "beta" });
  const failTeams = () => createFake(state, { fail: ({ entry }) => (entry.target === "teams" && entry.kind === "read" ? "error" : null) });
  const output = await sweep(state, failTeams());
  assert.ok(output.every((result) => result.error), "beta-opslaget kaster, så datoen prøves igen");
  assert.equal(state.training_rider_ticks.length, 0);
  await run(state);
  assert.deepEqual(sources(state), [0, 1, 2, 4, null], "beta-tester: reglen gælder");
  const failing = failTeams();
  const svar = await loadTeamFatigueForecast({ supabase: withScheduleJoin(failing.supabase), team: state.teams[0], seasonId: SEASON.id, now: EVENING_AT });
  assert.ok(failing.log.some((entry) => entry.target === "teams"), "prognosen spurgte beta-trinnet");
  assert.equal(svar.available, true, svar.reason);
  assert.equal("fieldSource" in svar.riders[RIDER], false, "ukendt gate = dagens felter");
});

// Fund E (Fable 23/11): a non-starter with several planned stages on the date. The start field
// release (releaseNonStarters) clears every one of them, in the engine and in the forecast.
for (const [name, lock, race] of [
  ["låsen hjemme i LD5, etaper LD4+LD5 uden ham", 4, [3, 4]],
  ["etaper i alle fem felter, låsen i LD5", 4, FIELDS],
]) {
  test(`fund E: ${name}: hvert felt kører sit eget pas, og prognosen før aftenen er motoren`, async () => {
    const { state } = scenario({ lock, race, dns: true });
    const before = await loadTeamFatigueForecast({ supabase: withScheduleJoin(createFake(state).supabase), team: state.teams[0], seasonId: SEASON.id, now: EVENING_AT });
    assert.equal(before.available, true, before.reason);
    assert.equal(before.settled, false);
    await run(state);
    assert.deepEqual(reports(state).map((report) => report.focus), SESSIONS);
    assert.ok(reports(state).every((report) => report.bound_race_day !== true));
    matchForecast(before.riders[RIDER], state, FIELDS, [], null);
    assert.deepEqual(before.riders[RIDER].raceSlots, []);
    assert.equal(before.riders[RIDER].fatigue, state.rider_condition[0].fatigue);
  });
}

test("#8646: a known non-starter's overdue stage follows deadline settlement", async () => {
  for (const slot of [2, 4]) {
    const { state } = scenario({ lock: slot, race: [0, slot], dns: true });
    const race = state.races.find((row) => row.id === RACE);
    race.stages_completed = 1;
    race.status = "in_progress";
    const forecastAt = async (now) => (await loadTeamFatigueForecast({
      supabase: withScheduleJoin(createFake(state).supabase),
      team: state.teams[0], seasonId: SEASON.id, now,
    })).riders[RIDER];
    const plannedTime = Date.parse(state.race_stage_schedule.find((row) => row.race_id === RACE && row.stage_number === 2).scheduled_at);
    assert.deepEqual((await forecastAt(new Date(plannedTime - 1))).fieldSource, FIELDS);
    const before = await forecastAt(new Date(plannedTime + 1));
    await run(state, createFake(state), { deadlineReached: true });
    assert.equal(reports(state)[slot].intensity, "unknown_pending");
    assert.deepEqual(before.fieldSource, sources(state));
    assert.deepEqual(before.pendingSlots, [slot]);
    assert.equal(before.fatigue, state.rider_condition[0].fatigue);
  }
});

test("#8646: only missing stage evidence is pending", async () => {
  const { state } = scenario({ race: [2, 4], pending: true });
  const load = async () => (await loadTeamFatigueForecast({
    supabase: withScheduleJoin(createFake(state).supabase),
    team: state.teams[0], seasonId: SEASON.id, now: EVENING_AT,
  })).riders[RIDER];
  assert.deepEqual((await load()).pendingSlots, [2, 4]);
  state.race_results.push({ id: "8646-first-result", rider_id: RIDER, race_id: RACE,
    stage_number: 1, result_type: "stage" });
  assert.deepEqual((await load()).pendingSlots, [4]);
  state.race_simulation_runs.push({ id: "8646-later-snapshot", race_id: RACE, stage_number: 2, entrant_snapshot: [] });
  assert.equal((await load()).pendingSlots, undefined);
});

test("fund E: kontakten off: prognosen er som før (frigivelsen hører til Week blocks)", async () => {
  const { state } = scenario({ lock: 4, race: [3, 4], dns: true, stage: "off" });
  const svar = await loadTeamFatigueForecast({ supabase: withScheduleJoin(createFake(state).supabase), team: state.teams[0], seasonId: SEASON.id, now: EVENING_AT });
  assert.equal(svar.available, true, svar.reason);
  assert.equal("fieldSource" in svar.riders[RIDER], false);
  assert.deepEqual(svar.riders[RIDER].raceSlots, [3, 4]);
});

test("Rotation forecast and evening run both free the slots of a known non-starter", async () => {
  const { state } = scenario({ lock: 4, race: [3, 4], dns: true, stage: "off" });
  state.app_config.push({ key: "training_rotation", value: "on" });
  const row = state.training_week_plans.find((plan) => plan.rider_id === RIDER);
  row.plan_kind = "rotation";
  row.rotation = { v: 1, rev: 1, passes: [{ session: "sprint" }, { session: "endurance" }] };
  const before = await loadTeamFatigueForecast({
    supabase: withScheduleJoin(createFake(state).supabase), team: state.teams[0], seasonId: SEASON.id, now: EVENING_AT,
  });
  await run(state);
  const result = before.riders[RIDER];
  assert.deepEqual(result.raceSlots, []);
  assert.deepEqual(result.rotationSlots.map((slot) => slot?.index), [0, 1, 0, 1, 0]);
  assert.deepEqual(reports(state).map((report) => report.rotation?.index), [0, 1, 0, 1, 0]);
});

test("WB-7: træthed erstatter låsen i LD3 og beholder kilden", async () => {
  const { state, forecast } = scenario({ lock: 1, race: [1], fatigue: true });
  const before = forecast([]);
  await run(state);
  matchForecast(before, state, [0, null, 1, 2, 3], [4], 1);
  assert.deepEqual(reports(state).slice(2).map((report) => report.intensity), ["rest", "rest", "rest"]);
  assert.equal(before.fatigue, state.rider_condition[0].fatigue);
});

test("WB-8: Træn nu og afregning ved etapen bevarer samme kilde som om aftenen", async () => {
  const input = { lock: 4, race: [0, 4] };
  const ordered = scenario(input);
  await run(ordered.state);
  const stamped = scenario({ ...input, pending: true });
  const fake = createFake(stamped.state);
  await press(stamped.state, fake);
  assert.equal(stamped.state.training_rider_ticks.length, 3);
  stamped.settle();
  await run(stamped.state, fake);
  assert.deepEqual(sources(stamped.state), sources(ordered.state));
  matchForecast(stamped.forecast(), stamped.state, [null, 0, 1, 4, null], [2, 3], 4);

  const atStage = scenario(input);
  const atStageFake = createFake(atStage.state);
  await runTeamTrainingDay({
    supabase: atStageFake.supabase, teamId: TEAM, seasonId: SEASON.id, seasonNumber: SEASON.number,
    now: EVENING_AT, tickDateOverride: DATE1, gameDay: DAYS1[0], dateGameDays: DAYS1, executedBy: "assistant",
    eligibleRiderIds: [RIDER], raceSessionRiderIds: new Set([RIDER]),
  });
  assert.equal(atStage.state.training_rider_ticks[0]?.game_day, DAYS1[0]);
  assert.equal(atStage.state.training_rider_ticks[0]?.report.race_session_7982, true);
  await run(atStage.state, atStageFake);
  assert.deepEqual(sources(atStage.state), sources(ordered.state));
  matchForecast(atStage.forecast(), atStage.state, [null, 0, 1, 4, null], [2, 3], 4);
});

test("WB-9: en hel bundet hviledato og skade bruger ingen kilde", async () => {
  for (const options of [{ bound: FIELDS }, { injured: true }]) {
    const { state, forecast } = scenario({ lock: 4, ...options });
    const before = forecast([]);
    await run(state);
    assert.deepEqual(reports(state).map((report) => report.intensity), FIELDS.map(() => "rest"));
    assert.equal(state.rider_training_scores.length, 0);
    matchForecast(before, state, FIELDS.map(() => null), [], null);
  }
});

test("en skade der udløber midt på en etapedato ændrer ikke frie felters prognose", async () => {
  const { state, forecast } = scenario({ lock: 4, race: [0], injured: true, injuryEnd: DAYS1[1], pending: true });
  const before = forecast([]);
  await run(state, createFake(state), { deadlineReached: true });
  assert.deepEqual(before.fieldSource, [null, null, 1, 2, 4]);
  matchForecast(before, state, [null, null, 1, 2, 4], [3], null);
  matchForecast(forecast(), state, [null, null, 1, 2, 4], [3], null);
});

test("WB-10: kildefeltets indsats følger låsen ind i det ledige felt", async () => {
  const { state, forecast } = scenario({ lock: 4, race: [4], efforts: [null, null, null, "easy", "hard"] });
  const before = forecast([]);
  await run(state);
  matchForecast(before, state, [0, 1, 2, 4, null], [3], 4);
  assert.equal(reports(state)[3].intensity, "hard");
  assert.equal(before.fatigue, state.rider_condition[0].fatigue);
});

test("OFF-1: et fejlet opslag af den slukkede ugekontakt lader datoen afregne", async () => {
  const { state } = scenario({ lock: 4, race: [4], stage: "off" });
  const failedReads = [];
  const fake = createFake(state, { fail: ({ entry }) => {
    if (entry.target !== "app_config" || !entry.filters?.some(([, column, value]) => column === "key" && value === "training_week_priority")) return null;
    failedReads.push(entry);
    return failedReads.length % 2 === 0 ? "throw" : "error";
  } });
  await run(state, fake);
  assert.ok(failedReads.length > 0);
  assert.ok(reports(state).every((report) => !("source_slot" in report)));
});

async function compatibility({ planKind, stage }) {
  const { state, forecast } = scenario({ lock: 4, race: [4], planKind, stage });
  const before = forecast([]);
  const fake = await run(state);
  return {
    value: digest({
      forecast: before, reports: reports(state), scores: state.rider_training_scores,
      abilities: state.rider_derived_abilities, condition: state.rider_condition,
    }),
    readFlag: fake.log.some((entry) => entry.target === "app_config"
      && entry.filters?.some(([, column, value]) => column === "key" && value === "training_week_priority")),
  };
}

test("golden OLD-1 og OFF-1: frosset main med lås og week-rækker", async () => {
  const golden = JSON.parse(readFileSync(new URL("./trainingWeekPriority8549.golden.json", import.meta.url), "utf8"));
  const old = await compatibility({ planKind: null, stage: "on" });
  const off = await compatibility({ planKind: "week", stage: "off" });
  assert.equal(old.value, golden.fingerprint);
  assert.equal(off.value, golden.fingerprint);
  assert.equal(old.readFlag, false);
});
