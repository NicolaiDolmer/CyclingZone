// #8592 · "Kun denne dag": dommer-scenarierne DO-1..DO-11 (docs/audits/8592-kun-denne-dag-dommer-scenarier.md),
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
  TRAINING_DAY_OVERRIDE_FLAG_KEY, attachDayOverrides, createDayOverrideRouter, isOverrideDate, overrideOutcome,
  overrideProgram, overrideWindow, parseOverrideWrite,
} from "./trainingDayOverride8592.js";
import { FRESH_FLAG_KEYS } from "./featureStage.js";

const RIDER = rider(0);
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SESSIONS = ["sprint", "tempo", "threshold", "vo2max", "endurance"];
const ROTATION = { v: 1, rev: 1, passes: [{ session: "sprint" }, { session: "threshold" }, { session: "endurance" }], anchor: { rev: 1, index: 0 } };

function weekRow(riderId, { entry = { session: "tempo", intensity: "normal", slots: [...SESSIONS] }, planKind = null, rotation } = {}) {
  return {
    id: `week-${riderId}`, team_id: TEAM, rider_id: riderId, plan_kind: planKind,
    days: Object.fromEntries(WEEKDAYS.map((day) => [day, structuredClone(entry)])), ...(rotation ? { rotation } : {}),
  };
}

function engineState({ flag = "on", rows = [weekRow(RIDER)], overrides = [{ rider: RIDER, date: DATE1, session: "rest" }], seed = {} } = {}) {
  const state = seedState({ count: 1, noPlan: [0], ...seed, flags: { [TRAINING_DAY_OVERRIDE_FLAG_KEY]: flag, ...(seed.flags ?? {}) } });
  state.training_week_plans.push(...rows);
  state.training_day_overrides = overrides.map((o, i) => ({ id: `o${i}`, team_id: TEAM, rider_id: o.rider, override_date: o.date, session: o.session }));
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
const flagReads = (fake) => fake.log.filter((entry) => entry.kind === "read" && entry.target === "app_config"
  && entry.filters?.some(([, column, value]) => column === "key" && value === TRAINING_DAY_OVERRIDE_FLAG_KEY));

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

test("Markeringen: løb, binding og skade vinder over valget (DO-2, DO-2b, DO-2c, DO-10)", () => {
  assert.equal(overrideOutcome({ raced: true }), "race");
  assert.equal(overrideOutcome({ boundRest: true }), "bound_rest");
  assert.equal(overrideOutcome({ injured: true }), "injured");
  assert.equal(overrideOutcome({ unknown: true, raced: true }), "unknown");
  assert.equal(overrideOutcome({ fatigueRule: { kind: "threshold" } }), "fatigue_rule");
  assert.equal(overrideOutcome({}), "trained");
  assert.equal(overrideProgram({ override: { session: "nope" } }), null);
  assert.equal(overrideProgram({ override: { session: "rest" }, previousFocus: "climbing" }).intensity, "rest");
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

test("DO-10: spillerens træthedsgrænse vinder over valget", async () => {
  const state = engineState({ overrides: [{ rider: RIDER, date: DATE1, session: "threshold" }], seed: { flags: { training_fatigue_rules: "on" } } });
  state.rider_condition[0].fatigue = 85;
  state.team_training_rules.push({ team_id: TEAM, rider_id: null, fatigue_threshold: 50, fallback: "rest", recovery_after_stage: false });
  await runDate(state);
  const r = reportsOn(state);
  assert.ok(r.every((x) => x.intensity === "rest" && x.fatigue_rule && x.date_override.outcome === "fatigue_rule"), JSON.stringify(r.map((x) => [x.intensity, x.date_override])));
});

test("DO-8: uden programceller læser motoren hverken kontakten eller tabellen", async () => {
  const state = engineState({ rows: [] });
  const fake = await runDate(state);
  assert.equal(flagReads(fake).length, 0);
  assert.equal(readsOf(fake, "training_day_overrides").length, 0);
  assert.ok(reportsOn(state).every((r) => !("date_override" in r)));
});

test("DO-8: kontakten off læser aldrig tabellen", async () => {
  const state = engineState({ flag: "off" });
  const fake = await runDate(state);
  assert.ok(flagReads(fake).length > 0);
  assert.equal(readsOf(fake, "training_day_overrides").length, 0);
});

test("DO-8 golden: kontakten off er bit-identisk med en frossen kopi af merge-basen", async () => {
  const golden = JSON.parse(readFileSync(new URL("./trainingDayOverride8592.golden.json", import.meta.url), "utf8"));
  assert.match(golden.source, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(golden.fingerprints).sort(), Object.keys(GOLDEN_SCENARIOS).sort());
  for (const name of Object.keys(GOLDEN_SCENARIOS)) {
    assert.equal(await goldenFingerprint(name), golden.fingerprints[name], `${name} afviger fra merge-basen`);
  }
});

test("DO-9: motoren læser kun datoens egen dato (et gammelt valg bruges aldrig)", async () => {
  const state = engineState({ overrides: [{ rider: RIDER, date: "2026-11-08", session: "endurance" }] });
  await runDate(state);
  assert.ok(reportsOn(state).every((r) => !("date_override" in r)));
});

// ── Prognosen (I5) ────────────────────────────────────────────────────────

test("Prognosen: valget for i dag stopper rotationen og vises pr. rytter", () => {
  const out = buildTeamFatigueForecast({
    tickDate: DATE1, seasonId: SEASON.id, dateGameDays: DAYS1, riders: [{ id: RIDER, primary_type: "sprinter" }],
    rotationByRider: new Map([[RIDER, ROTATION]]), conditionModelV2: true,
    dateOverrideByRider: new Map([[RIDER, { session: "rest" }]]),
  })[RIDER];
  assert.deepEqual(out.dateOverride, { session: "rest" });
  assert.equal(out.rotationSlots, undefined);
});

test("Ugens svar får datoens valg pr. dag", () => {
  const week = { available: true, days: [{ date: "2026-11-26" }, { date: "2026-11-27" }] };
  attachDayOverrides(week, new Map([["2026-11-27", new Map([["r1", { session: "rest" }]])]]));
  assert.equal(week.days[0].dayOverrides, undefined);
  assert.deepEqual(week.days[1].dayOverrides, { r1: { session: "rest" } });
});

// ── Ruterne ───────────────────────────────────────────────────────────────

function fakeSupabase(state) {
  function builder(table, op = "select", filters = [], payload = null, options = null) {
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
      return { data: state[table].filter(match).map((r) => structuredClone(r)), error: null };
    };
    const next = (f) => builder(table, op, [...filters, f], payload, options);
    const obj = {
      select() { return builder(table, "select", filters); },
      eq(c, v) { return next((r) => r[c] === v); },
      in(c, vs) { return next((r) => vs.includes(r[c])); },
      gte(c, v) { return next((r) => r[c] >= v); },
      lte(c, v) { return next((r) => r[c] <= v); },
      lt(c, v) { return next((r) => r[c] < v); },
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
      { team_id: "team-a", rider_id: "r3", override_date: "2026-11-20", session: "rest" }, // udløbet
      { team_id: "team-b", rider_id: "x9", override_date: "2026-11-20", session: "rest" }, // andet hold
    ],
  };
}

async function routeFixture(t, state, { betaTester = true, cells = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/o", createDayOverrideRouter({
    supabase: fakeSupabase(state),
    requireAuth: (req, _res, next) => { req.team = { id: "team-a" }; next(); },
    isViewerBetaTester: async () => betaTester,
    clock: () => new Date("2026-11-26T10:00:00Z"),
    cellsOn: async () => cells,
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  return async (method, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/o`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
}

const own = (state) => state.training_day_overrides.filter((r) => r.team_id === "team-a");

test("DO-8 (API): kontakten off afviser skrivning, og GET siger enabled:false", async (t) => {
  const state = routeState({ flag: "off" });
  const call = await routeFixture(t, state);
  assert.deepEqual((await call("GET")).body, { enabled: false, overrides: [] });
  const put = await call("PUT", { riderIds: ["r1"], date: "2026-11-27", session: "rest" });
  assert.equal(put.status, 409);
  assert.equal(put.body.error, "feature_disabled");
  assert.equal(state.training_day_overrides.length, 2);
});

test("DO-8 (API): beta er kun for beta-testere", async (t) => {
  const call = await routeFixture(t, routeState({ flag: "beta" }), { betaTester: false });
  assert.equal((await call("PUT", { riderIds: ["r1"], date: "2026-11-27", session: "rest" })).status, 409);
});

test("DO-5b + DO-9: flere ryttere ad gangen; udløbne valg ryddes; et andet holds rytter afvises", async (t) => {
  const state = routeState();
  const call = await routeFixture(t, state);
  const put = await call("PUT", { riderIds: ["r1", "r3"], date: "2026-11-28", session: "rest" });
  assert.equal(put.status, 200);
  assert.deepEqual(own(state).map((r) => [r.rider_id, r.override_date, r.session]).sort(), [["r1", "2026-11-28", "rest"], ["r3", "2026-11-28", "rest"]]);
  assert.equal(state.training_day_overrides.filter((r) => r.team_id === "team-b").length, 1); // andre hold røres ikke
  const foreign = await call("PUT", { riderIds: ["r1", "x9"], date: "2026-11-28", session: "endurance" });
  assert.equal(foreign.status, 403);
  assert.ok(own(state).every((r) => r.session === "rest")); // intet skrevet
  // Samme dato igen = rettelse, ikke en ny række.
  await call("PUT", { riderIds: ["r1"], date: "2026-11-28", session: "endurance" });
  assert.equal(own(state).length, 2);
  assert.equal(own(state).find((r) => r.rider_id === "r1").session, "endurance");
  const list = await call("GET");
  assert.equal(list.body.enabled, true);
  assert.equal(list.body.window.length, 7);
  assert.equal(list.body.overrides.length, 2);
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
  assert.deepEqual(own(state).map((r) => r.rider_id), ["r2"]);
});

test("DO-7 (API): fortiden, i dag og dag 8 afvises uden skrivning", async (t) => {
  const state = routeState();
  const call = await routeFixture(t, state);
  for (const date of ["2026-11-25", "2026-11-26", "2026-12-04"]) {
    const res = await call("PUT", { riderIds: ["r1"], date, session: "rest" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_date");
  }
  assert.equal(state.training_day_overrides.length, 2);
});

test("DO-11: et hold uden programfelter får 409 program_required", async (t) => {
  const state = routeState({ program: false });
  const call = await routeFixture(t, state);
  const res = await call("PUT", { riderIds: ["r1"], date: "2026-11-27", session: "rest" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "program_required");
  assert.equal((await call("GET")).body.programRequired, true);
});
