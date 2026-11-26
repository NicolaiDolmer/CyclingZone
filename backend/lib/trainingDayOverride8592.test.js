// #8592 + #8819 · "Kun denne dag": dommer-scenarierne DO-1..DO-13 (docs/audits/8592-kun-denne-dag-dommer-scenarier.md),
// skrevet før koden. Motoren køres gennem #7982-harnesset (samme sweep og tryk som i prod-koden);
// ruterne som en rigtig express-app med en lille in-memory Supabase.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import express from "express";

import {
  DATE1, DATE2, DAYS1, DAYS2, SEASON, TEAM, createFake, rider, seedState, sweep,
} from "./trainNowSameResult7982.harness.js";
import { buildTeamFatigueForecast } from "./trainingWeekPlanForecast.js";
import { GOLDEN_SCENARIOS, goldenFingerprint } from "./trainingDayOverride8592.golden.mjs";
import {
  TRAINING_DAY_OVERRIDE_FLAG_KEY, attachDayOverrides, createDayOverrideRouter, fatigueRuleMarksAhead, isOverrideDate,
  overrideBeatsFatigueRule, overrideOutcome, overrideProgram, overrideWindow, parseOverrideWrite, summarizeOverrideOutcomes,
} from "./trainingDayOverride8592.js";
import { FRESH_FLAG_KEYS } from "./featureStage.js";

const RIDER = rider(0);
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SESSIONS = ["sprint", "tempo", "threshold", "vo2max", "endurance"];
const ROTATION = { v: 1, rev: 1, passes: [{ session: "sprint" }, { session: "threshold" }, { session: "endurance" }], anchor: { rev: 1, index: 0 } };
const RULE = { team_id: TEAM, rider_id: null, fatigue_threshold: 50, fallback: "rest", recovery_after_stage: false };

function weekRow(riderId, { entry = { session: "tempo", intensity: "normal", slots: [...SESSIONS] }, planKind = null, rotation } = {}) {
  return {
    id: `week-${riderId}`, team_id: TEAM, rider_id: riderId, plan_kind: planKind,
    days: Object.fromEntries(WEEKDAYS.map((day) => [day, structuredClone(entry)])), ...(rotation ? { rotation } : {}),
  };
}

function engineState({ flag = "on", rows = [weekRow(RIDER)], overrides = [{ rider: RIDER, date: DATE1, session: "rest" }], seed = {} } = {}) {
  const state = seedState({ count: 1, noPlan: [0], ...seed, flags: { [TRAINING_DAY_OVERRIDE_FLAG_KEY]: flag, ...(seed.flags ?? {}) } });
  state.training_week_plans.push(...rows);
  state.training_day_overrides = overrides.map((o, i) => ({
    id: `o${i}`, team_id: TEAM, rider_id: o.rider, override_date: o.date, session: o.session, beats_fatigue_rule: o.beatsRule === true,
  }));
  return state;
}

const reportsOn = (state, days = DAYS1, riderId = RIDER) =>
  days.map((day) => state.training_rider_ticks.find((row) => row.rider_id === riderId && row.game_day === day)?.report);

async function runDate(state, fake = createFake(state), { tickDate = DATE1, now } = {}) {
  const out = await sweep(state, fake, { tickDate, ...(now ? { now } : {}) });
  assert.deepEqual(out.filter((r) => r.error), []);
  return fake;
}

const readsOf = (fake, table) => fake.log.filter((entry) => entry.kind === "read" && entry.target === table);

// ── Rene regler ───────────────────────────────────────────────────────────

test("DO-7: kun i morgen til og med om 7 dage kan vælges", () => {
  assert.deepEqual(overrideWindow("2026-11-26"), ["2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"]);
  assert.equal(isOverrideDate("2026-11-26", "2026-11-26"), false); // i dag
  assert.equal(isOverrideDate("2026-11-25", "2026-11-26"), false); // fortiden
  assert.equal(isOverrideDate("2026-12-04", "2026-11-26"), false); // dag 8
  assert.equal(isOverrideDate("2026-12-03", "2026-11-26"), true);
  assert.equal(isOverrideDate("26-11-2026", "2026-11-26"), false);
  assert.deepEqual(parseOverrideWrite({ date: "2026-11-25", riderIds: ["a"], session: "rest" }, { today: "2026-11-26" }),
    { ok: false, status: 400, reason: "invalid_date" });
  assert.equal(parseOverrideWrite({ date: "2026-11-27", riderIds: ["a"], session: "nope" }, { today: "2026-11-26" }).reason, "invalid_session");
  assert.equal(parseOverrideWrite({ date: "2026-11-27", riderIds: [], session: "rest" }, { today: "2026-11-26" }).reason, "invalid_riders");
});

test("Markeringen: løb, binding og skade vinder over valget (DO-2, DO-2b, DO-2c, DO-10a)", () => {
  assert.equal(overrideOutcome({ raced: true }), "race");
  assert.equal(overrideOutcome({ boundRest: true }), "bound_rest");
  assert.equal(overrideOutcome({ injured: true }), "injured");
  assert.equal(overrideOutcome({ unknown: true, raced: true }), "unknown");
  assert.equal(overrideOutcome({ applied: false }), "unavailable");
  assert.equal(overrideOutcome({ fatigueRule: { kind: "fatigue" } }), "fatigue_rule");
  assert.equal(overrideOutcome({}), "trained");
  assert.equal(overrideProgram({ override: { session: "nope" } }), null);
  assert.equal(overrideProgram({ override: { session: "rest" }, previousFocus: "climbing" }).intensity, "rest");
});

test("DO-12: sammendraget siger, hvad der tog valget, og om det kun var nogle felter", () => {
  assert.equal(summarizeOverrideOutcomes([]), null);
  assert.deepEqual(summarizeOverrideOutcomes(["trained", "trained"]), { outcome: "trained", some: false });
  assert.deepEqual(summarizeOverrideOutcomes(["trained", "race", "trained"]), { outcome: "race", some: true });
  assert.deepEqual(summarizeOverrideOutcomes(["fatigue_rule", "fatigue_rule"]), { outcome: "fatigue_rule", some: false });
  assert.deepEqual(summarizeOverrideOutcomes(["fatigue_rule", "race", "race"]), { outcome: "race", some: false });
  assert.deepEqual(summarizeOverrideOutcomes([null, "unavailable"]), { outcome: "unavailable", some: false });
});

test("DO-10: valget går kun forud for grænsen, når det er truffet efter markeringen og kan køres", () => {
  assert.equal(overrideBeatsFatigueRule({ session: "threshold", beatsRule: true }, { focus: "threshold", intensity: "hard" }), true);
  assert.equal(overrideBeatsFatigueRule({ session: "threshold", beatsRule: false }, { focus: "threshold", intensity: "hard" }), false);
  assert.equal(overrideBeatsFatigueRule({ session: "threshold", beatsRule: true }, null), false); // løb eller pas ikke muligt
  assert.equal(overrideBeatsFatigueRule(null, null), false);
});

test("DO-10: grænsens markering for i morgen bygger på aftenens prognose og samme regel som motoren", () => {
  const rules = { forRider: (id) => (id === "r3" ? { threshold: null, fallback: null, recoveryAfterStage: true } : { threshold: 50, fallback: "rest", recoveryAfterStage: false }) };
  const today = { available: true, riders: { r1: { fatigue: 61, raceSlots: [] }, r2: { fatigue: 40, raceSlots: [] }, r3: { fatigue: 20, raceSlots: [2] }, r4: { fatigue: null } } };
  const marks = fatigueRuleMarksAhead({ today, rules });
  assert.deepEqual(Object.fromEntries(marks), { r1: { kind: "fatigue", fallback: "rest" }, r3: { kind: "after_stage", fallback: "recovery" } });
  assert.equal(fatigueRuleMarksAhead({ today, rules: null }).size, 0);
  assert.equal(fatigueRuleMarksAhead({ today: { available: false }, rules }).size, 0);
});

test("Kontakten er en motor-kontakt og læses altid friskt", () => {
  assert.equal(FRESH_FLAG_KEYS.has(TRAINING_DAY_OVERRIDE_FLAG_KEY), true);
});

// ── Motoren ───────────────────────────────────────────────────────────────

test("DO-1: valget erstatter en hviledag i alle felter, og dagen efter kører planen igen", async () => {
  const restDay = { session: "rest", intensity: "rest" };
  const state = engineState({ rows: [weekRow(RIDER, { entry: restDay })], overrides: [{ rider: RIDER, date: DATE1, session: "endurance" }], seed: { secondDate: true } });
  const daysBefore = structuredClone(state.training_week_plans[0].days);
  await runDate(state);
  const first = reportsOn(state);
  assert.equal(first.filter(Boolean).length, 5);
  assert.ok(first.every((r) => r.focus === "endurance" && r.intensity !== "rest"), JSON.stringify(first.map((r) => [r.focus, r.intensity])));
  assert.ok(first.every((r) => r.date_override?.outcome === "trained" && r.date_override.session === "endurance"));
  await runDate(state, createFake(state), { tickDate: DATE2, now: new Date("2026-11-10T19:30:00Z") });
  const second = reportsOn(state, DAYS2);
  assert.equal(second.filter(Boolean).length, 5);
  assert.ok(second.every((r) => r.intensity === "rest" && !("date_override" in r)));
  assert.deepEqual(state.training_week_plans[0].days, daysBefore); // ugeplanen er urørt (punkt 3)
});

test("DO-2: løbet vinder i sit felt, valget gælder resten, og feltet er markeret", async () => {
  const state = engineState({ seed: { entered: [0], stageRun: true } });
  await runDate(state);
  const r = reportsOn(state);
  assert.equal(r[2].intensity, "race");
  assert.equal(r[2].date_override.outcome, "race");
  for (const i of [0, 1, 3, 4]) {
    assert.equal(r[i].intensity, "rest");
    assert.equal(r[i].date_override.outcome, "trained");
  }
});

test("DO-2b (motor-prøve, #8819 fund 3): en bundet hviledag i et etapeløb hviler alle felter, og valget er markeret bound_rest", async () => {
  const state = engineState({ overrides: [{ rider: RIDER, date: DATE1, session: "threshold" }] });
  const stageRace = state.races.find((race) => race.race_type === "stage_race");
  // Hviledag: rytteren er bundet til etapeløbet hele datoen, men løbet har ingen etape på datoen.
  state.race_stage_schedule = state.race_stage_schedule.filter((s) => !(s.race_id === stageRace.id && DAYS1.includes(s.game_day)));
  state.race_entries.push({ id: "entry-stage-race", race_id: stageRace.id, rider_id: RIDER, team_id: TEAM, race_role: "helper" });
  for (const day of DAYS1) state.race_entry_days.push({ race_id: stageRace.id, rider_id: RIDER, team_id: TEAM, season_id: SEASON.id, game_day: day });
  await runDate(state);
  const r = reportsOn(state);
  assert.equal(r.filter(Boolean).length, 5);
  assert.ok(r.every((x) => x.intensity === "rest" && x.date_override.outcome === "bound_rest"), JSON.stringify(r.map((x) => [x.intensity, x.date_override])));
});

test("DO-2c: en skadet rytter hviler; valget er markeret som erstattet af skaden", async () => {
  const state = engineState({ seed: { injured: [0] }, overrides: [{ rider: RIDER, date: DATE1, session: "threshold" }] });
  await runDate(state);
  const r = reportsOn(state);
  assert.ok(r.every((x) => x.date_override.outcome === "injured"));
  assert.ok(r.every((x) => x.focus !== "threshold" || x.status !== "trained"));
});

test("DO-3: rotationen venter på datoen og fortsætter dagen efter med passet, der stod for tur", async () => {
  const state = engineState({
    rows: [weekRow(RIDER, { planKind: "rotation", rotation: ROTATION })],
    seed: { secondDate: true, flags: { training_rotation: "on" } },
  });
  await runDate(state);
  const first = reportsOn(state);
  assert.ok(first.every((r) => r.intensity === "rest" && !("rotation" in r)), JSON.stringify(first));
  await runDate(state, createFake(state), { tickDate: DATE2, now: new Date("2026-11-10T19:30:00Z") });
  const second = reportsOn(state, DAYS2);
  assert.equal(second[0].rotation?.index, 0);
  assert.equal(second[0].rotation?.advanced, true);
  assert.equal(second[0].focus, "sprint");
});

test("DO-4: på datoen gælder valget i alle felter, uden ugeblokkens lås og kildefelt", async () => {
  const lockEntry = { session: "tempo", intensity: "normal", slots: [...SESSIONS], lockSlot: 4 };
  const state = engineState({
    rows: [weekRow(RIDER, { entry: lockEntry, planKind: "week" })],
    overrides: [{ rider: RIDER, date: DATE1, session: "endurance" }],
    seed: { flags: { training_week_priority: "on" } },
  });
  await runDate(state);
  const r = reportsOn(state);
  assert.ok(r.every((x) => x.focus === "endurance" && !("source_slot" in x)), JSON.stringify(r.map((x) => [x.focus, x.source_slot])));
});

function tiredState({ beatsRule }) {
  const state = engineState({ overrides: [{ rider: RIDER, date: DATE1, session: "threshold", beatsRule }], seed: { flags: { training_fatigue_rules: "on" } } });
  state.rider_condition[0].fatigue = 85;
  state.team_training_rules.push({ ...RULE });
  return state;
}

test("DO-10a: valget truffet før grænsens markering: grænsen bestemmer, og feltet er markeret fatigue_rule", async () => {
  const state = tiredState({ beatsRule: false });
  await runDate(state);
  const r = reportsOn(state);
  assert.ok(r.every((x) => x.intensity === "rest" && x.fatigue_rule && x.date_override.outcome === "fatigue_rule"), JSON.stringify(r.map((x) => [x.intensity, x.date_override])));
  assert.ok(r.every((x) => !("beats_fatigue_rule" in x.date_override)));
});

test("DO-10b: valget truffet efter grænsens markering går forud for grænsen", async () => {
  const state = tiredState({ beatsRule: true });
  await runDate(state);
  const r = reportsOn(state);
  assert.ok(r.every((x) => x.focus === "threshold" && x.intensity !== "rest" && !x.fatigue_rule), JSON.stringify(r.map((x) => [x.focus, x.intensity, x.fatigue_rule])));
  assert.ok(r.every((x) => x.date_override.outcome === "trained" && x.date_override.beats_fatigue_rule === true));
});

test("DO-10b: et løb vinder stadig, også når valget går forud for grænsen", async () => {
  const state = engineState({
    overrides: [{ rider: RIDER, date: DATE1, session: "threshold", beatsRule: true }],
    seed: { entered: [0], stageRun: true, flags: { training_fatigue_rules: "on" } },
  });
  state.rider_condition[0].fatigue = 85;
  state.team_training_rules.push({ ...RULE });
  await runDate(state);
  const r = reportsOn(state);
  assert.equal(r[2].intensity, "race");
  assert.equal(r[2].date_override.outcome, "race");
  assert.ok([0, 1, 3, 4].every((i) => r[i].focus === "threshold" && r[i].date_override.outcome === "trained"), JSON.stringify(r.map((x) => [x.focus, x.intensity])));
});

test("DO-11 (#8819 svar 2): et hold uden program bruger valget på datoen, og dagen efter er det samme som i går", async () => {
  const seed = { secondDate: true, count: 2 };
  const withChoice = engineState({ rows: [], overrides: [{ rider: RIDER, date: DATE1, session: "endurance" }], seed: { ...seed, noPlan: [] } });
  const control = engineState({ rows: [], overrides: [], seed: { ...seed, noPlan: [] } });
  for (const state of [withChoice, control]) {
    assert.equal(state.training_week_plans.length, 0);
    await runDate(state);
    await runDate(state, createFake(state), { tickDate: DATE2, now: new Date("2026-11-10T19:30:00Z") });
  }
  const first = reportsOn(withChoice);
  assert.ok(first.every((r) => r.focus === "endurance" && r.date_override?.outcome === "trained"), JSON.stringify(first.map((r) => [r.focus, r.date_override])));
  const plan = (state, days, id) => reportsOn(state, days, id).map((r) => [r.focus, r.intensity]);
  assert.deepEqual(plan(withChoice, DAYS2, RIDER), plan(control, DAYS2, RIDER)); // dagen efter: planen som i går
  assert.ok(reportsOn(withChoice, DAYS2).every((r) => !("date_override" in r)));
  assert.deepEqual(plan(withChoice, DAYS1, rider(1)), plan(control, DAYS1, rider(1))); // andre ryttere urørte
  assert.deepEqual(withChoice.training_plans, control.training_plans); // planen ændres aldrig
});

test("DO-8: kontakten off læser aldrig tabellen, også uden program", async () => {
  for (const rows of [[weekRow(RIDER)], []]) {
    const state = engineState({ flag: "off", rows });
    const fake = await runDate(state);
    assert.ok(fake.dayOverrideSwitchReads.length > 0, "kontakten læses");
    assert.equal(readsOf(fake, "training_day_overrides").length, 0);
    assert.ok(reportsOn(state).every((r) => !("date_override" in r)));
  }
});

test("DO-8 golden: kontakten off er bit-identisk med en frossen kopi af merge-basen", async () => {
  const golden = JSON.parse(readFileSync(new URL("./trainingDayOverride8592.golden.json", import.meta.url), "utf8"));
  assert.match(golden.source, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(golden.fingerprints).sort(), Object.keys(GOLDEN_SCENARIOS).sort());
  for (const name of Object.keys(GOLDEN_SCENARIOS)) {
    assert.equal(await goldenFingerprint(name), golden.fingerprints[name], `${name} afviger fra merge-basen`);
  }
});

test("DO-9: motoren læser kun datoens egen dato (et valg fra en anden dato bruges aldrig)", async () => {
  const state = engineState({ overrides: [{ rider: RIDER, date: "2026-11-08", session: "endurance" }] });
  await runDate(state);
  assert.ok(reportsOn(state).every((r) => !("date_override" in r)));
});

// ── Prognosen (I5) ────────────────────────────────────────────────────────

const forecastFor = (extra) => buildTeamFatigueForecast({
  tickDate: DATE1, seasonId: SEASON.id, dateGameDays: DAYS1, riders: [{ id: RIDER, primary_type: "sprinter" }], conditionModelV2: true, ...extra,
})[RIDER];

test("Prognosen: valget for i dag stopper rotationen, vises pr. rytter og bevarer rotationens tur", () => {
  const out = forecastFor({ rotationByRider: new Map([[RIDER, ROTATION]]), dateOverrideByRider: new Map([[RIDER, { session: "rest" }]]) });
  assert.equal(out.dateOverride.session, "rest");
  assert.equal(out.dateOverride.outcome, "trained");
  assert.equal(out.rotationSlots, undefined);
  assert.equal(out.nextRotationIndex, 0); // Codex P2: ugens fremskrivning fortsætter med passet, der stod for tur
});

test("DO-12 (I dag): prognosen siger, når grænsen tager valget, og når valget går forud", () => {
  const tired = new Map([[RIDER, { fatigue: 85, form: 50 }]]);
  const fatigueRules = { forRider: () => ({ threshold: 50, fallback: "rest", recoveryAfterStage: false }) };
  const before = forecastFor({ openingByRider: tired, conditionByRider: tired, fatigueRules, dateOverrideByRider: new Map([[RIDER, { session: "threshold" }]]) });
  assert.deepEqual(before.dateOverride, { session: "threshold", outcome: "fatigue_rule", some: false });
  const after = forecastFor({ openingByRider: tired, conditionByRider: tired, fatigueRules, dateOverrideByRider: new Map([[RIDER, { session: "threshold", beatsRule: true }]]) });
  assert.deepEqual(after.dateOverride, { session: "threshold", outcome: "trained", some: false, beatsRule: true });
});

test("DO-12 (I dag): et løb i et felt gør valget delvist", () => {
  const out = forecastFor({
    dateOverrideByRider: new Map([[RIDER, { session: "rest" }]]),
    plannedStages: [{ rider_id: RIDER, game_day: DAYS1[2], profile_type: "flat" }],
  });
  assert.deepEqual(out.dateOverride, { session: "rest", outcome: "race", some: true });
});

test("Ugens svar får datoens valg pr. dag og grænsens markering for i morgen", () => {
  const week = { available: true, days: [{ date: "2026-11-26" }, { date: "2026-11-27" }, { date: "2026-11-28" }] };
  attachDayOverrides(week, new Map([["2026-11-27", new Map([["r1", { session: "rest", beatsRule: false }], ["r2", { session: "tempo", beatsRule: true }]])]]),
    { ruleMarks: new Map([["r1", { kind: "fatigue", fallback: "rest" }]]) });
  assert.equal(week.days[0].dayOverrides, undefined);
  assert.deepEqual(week.days[1].dayOverrides, { r1: { session: "rest" }, r2: { session: "tempo", beatsRule: true } });
  assert.deepEqual(week.days[1].fatigueRuleAhead, { r1: { kind: "fatigue", fallback: "rest" } });
  assert.equal(week.days[2].fatigueRuleAhead, undefined);
  const off = { available: true, days: [{ date: "2026-11-26" }, { date: "2026-11-27" }] };
  assert.deepEqual(attachDayOverrides(structuredClone(off), null), off); // kontakten off: uændret
});

// ── Migrationen (DO-13) ───────────────────────────────────────────────────

test("DO-13 (#8819 fund 4): spilleren må kun læse; backend skriver med service-role", () => {
  const sql = readFileSync(new URL("../../database/2026-11-26-8592-training-day-overrides.sql", import.meta.url), "utf8");
  const live = sql.split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.match(live, /CREATE POLICY training_day_overrides_own_select ON public\.training_day_overrides\s+FOR SELECT TO authenticated/);
  assert.doesNotMatch(live, /CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/);
  assert.match(live, /REVOKE ALL ON TABLE public\.training_day_overrides FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(live, /GRANT SELECT ON TABLE public\.training_day_overrides TO authenticated;/);
  assert.doesNotMatch(live, /GRANT [^;]*(INSERT|UPDATE|DELETE)[^;]*TO authenticated/);
  assert.match(live, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.training_day_overrides TO service_role;/);
  const declared = JSON.parse(/-- data-api-access: (\{.*\})/.exec(sql)[1]);
  assert.deepEqual(declared.roles, { anon: [], authenticated: ["SELECT"], service_role: ["SELECT", "INSERT", "UPDATE", "DELETE"] });
  assert.match(live, /beats_fatigue_rule\s+boolean NOT NULL DEFAULT false/);
});

// ── Ruterne ───────────────────────────────────────────────────────────────

function fakeSupabase(state) {
  const pick = (row, cols) => {
    if (!cols || cols === "*") return structuredClone(row);
    const out = {};
    for (const part of cols.split(",").map((s) => s.trim())) {
      const alias = /^(\w+):(\w+)->(\w+)$/.exec(part);
      if (alias) out[alias[1]] = structuredClone(row[alias[2]]?.[alias[3]] ?? null);
      else out[part] = structuredClone(row[part]);
    }
    return out;
  };
  const valueAt = (row, col) => {
    const arrow = /^(\w+)->(\w+)$/.exec(col);
    return arrow ? row[arrow[1]]?.[arrow[2]] : row[col];
  };
  function builder(table, op = "select", filters = [], payload = null, options = null, cols = null) {
    const match = (row) => filters.every((f) => f(row));
    const run = () => {
      state[table] ??= [];
      if (op === "delete") { state[table] = state[table].filter((row) => !match(row)); return { data: null, error: null }; }
      if (op === "upsert") {
        const keys = options.onConflict.split(",");
        for (const row of [payload].flat()) {
          const hit = state[table].find((r) => keys.every((k) => r[k] === row[k]));
          if (hit) Object.assign(hit, structuredClone(row)); else state[table].push(structuredClone(row));
        }
        return { data: null, error: null };
      }
      return { data: state[table].filter(match).map((r) => pick(r, cols)), error: null };
    };
    const next = (f) => builder(table, op, [...filters, f], payload, options, cols);
    const obj = {
      select(c) { return builder(table, op === "delete" ? "delete" : "select", filters, payload, options, c ?? null); },
      eq(c, v) { return next((r) => valueAt(r, c) === v); },
      in(c, vs) { return next((r) => vs.includes(valueAt(r, c))); },
      gte(c, v) { return next((r) => valueAt(r, c) >= v); },
      lte(c, v) { return next((r) => valueAt(r, c) <= v); },
      lt(c, v) { return next((r) => valueAt(r, c) < v); },
      not(c, operator, v) { assert.equal(operator, "is"); return next((r) => (valueAt(r, c) ?? null) !== v); },
      order() { return obj; },
      limit() { return obj; },
      delete() { return builder(table, "delete", filters); },
      upsert(p, o) { return builder(table, "upsert", filters, p, o); },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return obj;
  }
  return { from: (table) => builder(table) };
}

const PROGRAM_DAYS = Object.fromEntries(WEEKDAYS.map((d) => [d, { session: "tempo", intensity: "normal" }]));

function routeState({ flag = "beta", program = true } = {}) {
  return {
    app_config: [{ key: TRAINING_DAY_OVERRIDE_FLAG_KEY, value: flag }],
    riders: ["r1", "r2", "r3"].map((id) => ({ id, team_id: "team-a", is_retired: false })).concat([{ id: "x9", team_id: "team-b", is_retired: false }]),
    training_week_plans: program ? [{ team_id: "team-a", rider_id: "r1", days: PROGRAM_DAYS }] : [],
    training_group_members: [
      { group_id: "g1", team_id: "team-a", rider_id: "r1", follows_group: true },
      { group_id: "g1", team_id: "team-a", rider_id: "r2", follows_group: true },
    ],
    training_day_overrides: [
      { team_id: "team-a", rider_id: "r3", override_date: "2026-11-20", session: "rest" }, // udløbet, datoen er gjort op
      { team_id: "team-a", rider_id: "r2", override_date: "2026-11-25", session: "endurance" }, // i går, datoen er ikke gjort op
      { team_id: "team-b", rider_id: "x9", override_date: "2026-11-20", session: "rest" }, // andet hold
    ],
    training_date_work: [
      { team_id: "team-a", season_id: "s", tick_date: "2026-11-20", status: "complete" },
      { team_id: "team-a", season_id: "s", tick_date: "2026-11-25", status: "partial" },
    ],
    training_rider_ticks: [],
  };
}

async function routeFixture(t, state, { betaTester = true, marks = new Map() } = {}) {
  const app = express();
  app.use(express.json());
  const asked = [];
  app.use("/o", createDayOverrideRouter({
    supabase: fakeSupabase(state),
    requireAuth: (req, _res, next) => { req.team = { id: "team-a" }; next(); },
    isViewerBetaTester: async () => betaTester,
    clock: () => new Date("2026-11-26T10:00:00Z"),
    fatigueRuleAhead: async () => { asked.push(true); return marks; },
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const call = async (method, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/o`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  call.asked = asked;
  return call;
}

const own = (state) => state.training_day_overrides.filter((r) => r.team_id === "team-a");

test("DO-8 (API): kontakten off afviser skrivning, og GET siger enabled:false", async (t) => {
  const state = routeState({ flag: "off" });
  const call = await routeFixture(t, state);
  assert.deepEqual((await call("GET")).body, { enabled: false, overrides: [] });
  const put = await call("PUT", { riderIds: ["r1"], date: "2026-11-27", session: "rest" });
  assert.equal(put.status, 409);
  assert.equal(put.body.error, "feature_disabled");
  assert.equal(state.training_day_overrides.length, 3);
});

test("DO-8 (API): beta er kun for beta-testere", async (t) => {
  const call = await routeFixture(t, routeState({ flag: "beta" }), { betaTester: false });
  assert.equal((await call("PUT", { riderIds: ["r1"], date: "2026-11-27", session: "rest" })).status, 409);
});

test("DO-5b + DO-9: flere ryttere ad gangen; kun gjorte datoer ryddes; et andet holds rytter afvises", async (t) => {
  const state = routeState();
  const call = await routeFixture(t, state);
  const put = await call("PUT", { riderIds: ["r1", "r3"], date: "2026-11-28", session: "rest" });
  assert.equal(put.status, 200);
  assert.deepEqual(own(state).map((r) => [r.rider_id, r.override_date, r.session]).sort(),
    [["r1", "2026-11-28", "rest"], ["r2", "2026-11-25", "endurance"], ["r3", "2026-11-28", "rest"]]);
  assert.equal(state.training_day_overrides.filter((r) => r.team_id === "team-b").length, 1); // andre hold røres ikke
  const foreign = await call("PUT", { riderIds: ["r1", "x9"], date: "2026-11-28", session: "endurance" });
  assert.equal(foreign.status, 403);
  assert.ok(own(state).filter((r) => r.override_date === "2026-11-28").every((r) => r.session === "rest")); // intet skrevet
  // Samme dato igen = rettelse, ikke en ny række.
  await call("PUT", { riderIds: ["r1"], date: "2026-11-28", session: "endurance" });
  assert.equal(own(state).filter((r) => r.override_date === "2026-11-28").length, 2);
  assert.equal(own(state).find((r) => r.rider_id === "r1").session, "endurance");
  const list = await call("GET");
  assert.equal(list.body.enabled, true);
  assert.equal(list.body.window.length, 7);
  assert.equal(list.body.overrides.length, 2);
  assert.equal("programRequired" in list.body, false);
});

test("DO-9 (#8819 fund 2): et valg fra en dato, der ikke er gjort op, bevares; det slettes, når datoen er complete", async (t) => {
  const state = routeState();
  const call = await routeFixture(t, state);
  await call("GET");
  assert.equal(own(state).some((r) => r.override_date === "2026-11-20"), false); // complete: ryddet
  assert.equal(own(state).some((r) => r.override_date === "2026-11-25"), true); // partial: bevaret til genkørslen
  state.training_date_work.find((r) => r.tick_date === "2026-11-25").status = "complete";
  await call("GET");
  assert.equal(own(state).some((r) => r.override_date === "2026-11-25"), false);
  // Ingen række for datoen i training_date_work endnu: bevares (datoen kan stadig afregnes sent).
  state.training_day_overrides.push({ team_id: "team-a", rider_id: "r1", override_date: "2026-11-24", session: "rest" });
  await call("GET");
  assert.equal(own(state).some((r) => r.override_date === "2026-11-24"), true);
});

test("DO-5: en hel gruppe giver én række pr. medlem på skrivetidspunktet", async (t) => {
  const state = routeState();
  const call = await routeFixture(t, state);
  assert.equal((await call("PUT", { groupId: "g1", date: "2026-11-30", session: "recovery" })).status, 200);
  assert.deepEqual(own(state).filter((r) => r.override_date === "2026-11-30").map((r) => r.rider_id).sort(), ["r1", "r2"]);
  state.training_group_members.push({ group_id: "g1", team_id: "team-a", rider_id: "r3", follows_group: true });
  assert.equal(own(state).some((r) => r.rider_id === "r3" && r.override_date === "2026-11-30"), false);
});

test("DO-6: Tilbage til planen sletter valget", async (t) => {
  const state = routeState();
  const call = await routeFixture(t, state);
  await call("PUT", { riderIds: ["r1", "r2"], date: "2026-11-29", session: "rest" });
  const del = await call("DELETE", { riderIds: ["r1"], date: "2026-11-29" });
  assert.equal(del.status, 200);
  assert.deepEqual(own(state).filter((r) => r.override_date === "2026-11-29").map((r) => r.rider_id), ["r2"]);
});

test("DO-7 (API): fortiden, i dag og dag 8 afvises uden skrivning", async (t) => {
  const state = routeState();
  const call = await routeFixture(t, state);
  for (const date of ["2026-11-25", "2026-11-26", "2026-12-04"]) {
    const res = await call("PUT", { riderIds: ["r1"], date, session: "rest" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_date");
  }
  assert.equal(state.training_day_overrides.length, 3);
});

test("DO-11 (#8819 svar 2): et hold uden program kan gemme et valg", async (t) => {
  const state = routeState({ program: false });
  const call = await routeFixture(t, state);
  const res = await call("PUT", { riderIds: ["r1"], date: "2026-11-27", session: "rest" });
  assert.equal(res.status, 200);
  assert.ok(own(state).some((r) => r.rider_id === "r1" && r.override_date === "2026-11-27"));
});

test("DO-10b + DO-10c (API): kun i morgen kan få markeringen, serveren afgør den, og body'en bestemmer intet", async (t) => {
  const state = routeState();
  const call = await routeFixture(t, state, { marks: new Map([["r1", { kind: "fatigue", fallback: "rest" }]]) });
  const tomorrow = await call("PUT", { riderIds: ["r1", "r2"], date: "2026-11-27", session: "threshold", beats_fatigue_rule: true, beatsRule: true });
  assert.equal(tomorrow.status, 200);
  assert.deepEqual(tomorrow.body.beatsRuleRiderIds, ["r1"]);
  const row = (id, date) => own(state).find((r) => r.rider_id === id && r.override_date === date);
  assert.equal(row("r1", "2026-11-27").beats_fatigue_rule, true);
  assert.equal(row("r2", "2026-11-27").beats_fatigue_rule, false); // ingen markering for ham
  assert.equal(call.asked.length, 1);
  const later = await call("PUT", { riderIds: ["r1"], date: "2026-11-29", session: "threshold", beats_fatigue_rule: true });
  assert.equal(later.status, 200);
  assert.equal(row("r1", "2026-11-29").beats_fatigue_rule, false); // længere ude: aldrig
  assert.equal(call.asked.length, 1); // serveren spørger ikke engang
  const list = await call("GET");
  assert.deepEqual(list.body.overrides.find((o) => o.riderId === "r1" && o.date === "2026-11-27"), { riderId: "r1", date: "2026-11-27", session: "threshold", beatsRule: true });
});

test("DO-12 (efter datoen): GET siger, hvordan valgene gik de seneste dage, fra kvitteringerne", async (t) => {
  const state = routeState();
  const tick = (riderId, date, day, stamp) => ({ team_id: "team-a", rider_id: riderId, tick_date: date, game_day: day, report: { intensity: "rest", ...(stamp ? { date_override: stamp } : {}) } });
  state.training_rider_ticks = [
    ...[1, 2, 3, 4, 5].map((d) => tick("r1", "2026-11-25", d, { session: "threshold", outcome: "fatigue_rule" })),
    ...[1, 2, 3, 4, 5].map((d) => tick("r2", "2026-11-24", d, { session: "rest", outcome: d === 3 ? "race" : "trained" })),
    ...[1, 2, 3, 4, 5].map((d) => tick("r3", "2026-11-23", d, { session: "tempo", outcome: "trained", beats_fatigue_rule: true })),
    tick("r1", "2026-11-26", 6, { session: "rest", outcome: "trained" }), // i dag: ikke "efter datoen"
    tick("r2", "2026-11-10", 1, { session: "rest", outcome: "trained" }), // for gammel
    tick("r3", "2026-11-25", 1, null), // uden valg
  ];
  const call = await routeFixture(t, state);
  const { body } = await call("GET");
  assert.deepEqual(body.recent, [
    { date: "2026-11-25", riderId: "r1", session: "threshold", beatsRule: false, outcome: "fatigue_rule", some: false },
    { date: "2026-11-24", riderId: "r2", session: "rest", beatsRule: false, outcome: "race", some: true },
    { date: "2026-11-23", riderId: "r3", session: "tempo", beatsRule: true, outcome: "trained", some: false },
  ]);
});
