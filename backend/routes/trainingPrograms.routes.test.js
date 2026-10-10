// #4629 · /api/training/programs: flag-gate, kopi ved tildeling, celle-override.
// Routeren koeres som en rigtig express-app paa en tilfaeldig port (samme moenster
// som comeback.test.js); Supabase og auth er fakes.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createTrainingProgramsRouter } from "./trainingPrograms.js";
import { TRAINING_PROGRAMS_FLAG_KEY } from "../lib/trainingProgramsFlag.js";
import { TRAINING_PROGRAM_CELLS_FLAG_KEY } from "../lib/trainingWeekPlanCellsFlag.js";
import { TRAINING_PROGRAMS } from "../lib/trainingPrograms.js";

// Minimal PostgREST-fake: select/eq/maybeSingle/update/insert paa et in-memory state.
function fakeSupabase(state, { missingProgramKey = false } = {}) {
  let seq = 0;
  function builder(table, op = "select", filters = [], payload = null, cols = "*") {
    const match = (row) => filters.every(([c, v]) => row[c] === v);
    const run = () => {
      state[table] ??= [];
      if (missingProgramKey && table === "training_week_plans") {
        const touches = (op === "select" && cols.includes("program_key"))
          || (op !== "select" && [payload].flat().some((p) => p && "program_key" in p));
        if (touches) return { data: null, error: { code: "42703", message: "column does not exist" } };
      }
      if (op === "update") {
        for (const row of state[table]) if (match(row)) Object.assign(row, payload);
        return { error: null };
      }
      if (op === "insert") {
        for (const row of [payload].flat()) state[table].push({ id: `row-${seq += 1}`, ...row });
        return { error: null };
      }
      return { data: state[table].filter(match).map((r) => ({ ...r })), error: null };
    };
    const obj = {
      select(c = "*") { return builder(table, "select", filters, payload, c); },
      eq(c, v) { return builder(table, op, [...filters, [c, v]], payload, cols); },
      update(p) { return builder(table, "update", filters, p, cols); },
      insert(p) { return Promise.resolve(builder(table, "insert", filters, p, cols).__run()); },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      __run: run,
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return obj;
  }
  return { from: (table) => builder(table) };
}

function seed({ stage = "beta", riders = ["r1", "r2"], otherTeamRider = "x9", weekPlans = [] } = {}) {
  return {
    app_config: stage == null ? [] : [{ key: TRAINING_PROGRAMS_FLAG_KEY, value: stage }],
    riders: [
      ...riders.map((id) => ({ id, team_id: "team-a", is_retired: false })),
      { id: otherTeamRider, team_id: "team-b", is_retired: false },
    ],
    training_week_plans: weekPlans,
  };
}

async function fixture(t, { state, betaTester = true, missingProgramKey = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/training/programs", createTrainingProgramsRouter({
    supabase: fakeSupabase(state, { missingProgramKey }),
    requireAuth: (req, _res, next) => { req.user = { id: "user-a" }; req.team = { id: "team-a" }; next(); },
    isViewerBetaTester: async () => betaTester,
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/training/programs`;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return { call };
}

test("flag off: GET svarer enabled:false, og skrivestierne findes ikke (404) — intet skrives", async (t) => {
  const state = seed({ stage: "off" });
  const { call } = await fixture(t, { state });
  assert.deepEqual((await call("GET", "/")).body, { enabled: false, cellsEnabled: false });
  assert.equal((await call("POST", "/apply", { programKey: "sprinter", target: "squad" })).status, 404);
  assert.equal((await call("PUT", "/cell", { riderId: "r1", weekday: "fri", slotIndex: 1, session: "recovery" })).status, 404);
  assert.equal((await call("GET", "/forecast")).body.available, false);
  assert.equal(state.training_week_plans.length, 0);
});

test("beta: en ikke-beta-viewer ser ingenting og kan ikke tildele", async (t) => {
  const state = seed({ stage: "beta" });
  const { call } = await fixture(t, { state, betaTester: false });
  assert.equal((await call("GET", "/")).body.enabled, false);
  assert.equal((await call("POST", "/apply", { programKey: "sprinter", target: "r1" })).status, 404);
});

test("beta-viewer: kataloget leveres med 22 programmer i begge sprog", async (t) => {
  const { call } = await fixture(t, { state: seed() });
  const res = await call("GET", "/");
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.catalog.length, TRAINING_PROGRAMS.length);
  assert.equal(res.body.slots, 5);
  assert.ok(res.body.catalog.every((p) => p.name.en && p.name.da && p.tagline.en && p.tagline.da));
});

test("tildeling til hele truppen = EN KOPI pr. egen rytter, med program_key som proveniens", async (t) => {
  const state = seed({
    weekPlans: [{ id: "old-r1", team_id: "team-a", rider_id: "r1", days: { mon: { intensity: "hard" } } }],
  });
  const { call } = await fixture(t, { state });
  const res = await call("POST", "/apply", { programKey: "sprinter", target: "squad" });
  assert.equal(res.status, 200);
  assert.equal(res.body.applied, 2);
  const rows = state.training_week_plans.filter((r) => r.team_id === "team-a");
  assert.equal(rows.length, 2, "r1 opdateres, r2 indsaettes — ingen holdraekke");
  assert.ok(rows.every((r) => r.rider_id && r.program_key === "sprinter"));
  assert.equal(rows.find((r) => r.rider_id === "r1").id, "old-r1", "eksisterende raekke genbruges");
  assert.notEqual(rows[0].days, rows[1].days, "hver rytter har sin egen kopi");
  assert.equal(rows[0].days.fri.session, "sprint");

  const listed = await call("GET", "/");
  assert.deepEqual(listed.body.assigned, { r1: "sprinter", r2: "sprinter" });
});

test("tildeling til en fremmed rytter afvises (403), ukendt program (400)", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  assert.equal((await call("POST", "/apply", { programKey: "sprinter", target: "x9" })).status, 403);
  assert.equal((await call("POST", "/apply", { programKey: "nope", target: "r1" })).status, 400);
  assert.equal(state.training_week_plans.length, 0);
});

test("celle-override: et loebsdags-slot overstyres, ugedagen og proveniensen bevares", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  await call("POST", "/apply", { programKey: "sprinter", target: "r1" });
  const res = await call("PUT", "/cell", { riderId: "r1", weekday: "fri", slotIndex: 2, session: "recovery" });
  assert.equal(res.status, 200);
  const row = state.training_week_plans.find((r) => r.rider_id === "r1");
  assert.deepEqual(row.days.fri.slots, [null, null, "recovery", null, null]);
  assert.equal(row.days.fri.session, "sprint");
  assert.equal(row.program_key, "sprinter");

  assert.equal((await call("PUT", "/cell", { riderId: "x9", weekday: "fri", session: "rest" })).status, 403, "fremmed rytter");
  assert.equal((await call("PUT", "/cell", { riderId: "r1", weekday: "fri", slotIndex: 7, session: "rest" })).status, 400);
  assert.equal((await call("PUT", "/cell", { riderId: "r1", weekday: "fri", session: "moonwalk" })).status, 400);
});

// ── #5932: felterne for alle hold bag `training_program_cells` ───────────────
function cellsSeed({ cells = "on", programs = "off", weekPlans = [] } = {}) {
  const state = seed({ stage: programs, weekPlans });
  state.app_config.push({ key: TRAINING_PROGRAM_CELLS_FLAG_KEY, value: cells });
  return state;
}

test("#5932 felt-flag on, katalog off: GET leverer saaede uger, men intet katalog, og tildeling findes ikke", async (t) => {
  const state = cellsSeed();
  const { call } = await fixture(t, { state, betaTester: false });
  const res = await call("GET", "/");
  assert.equal(res.body.enabled, false);
  assert.equal(res.body.cellsEnabled, true);
  assert.deepEqual(res.body.catalog, []);
  assert.deepEqual(Object.keys(res.body.seeds).sort(), ["r1", "r2"]);
  assert.ok(Object.values(res.body.seeds.r1).every((d) => typeof d.session === "string"), "hver ugedag har en session");
  assert.equal((await call("POST", "/apply", { programKey: "sprinter", target: "r1" })).status, 404);
});

test("#5932 foerste felt-rettelse saar ugen (som GET viste) og retter saa feltet", async (t) => {
  const state = cellsSeed();
  const { call } = await fixture(t, { state, betaTester: false });
  const shown = (await call("GET", "/")).body.seeds.r2;
  const res = await call("PUT", "/cell", { riderId: "r2", weekday: "wed", slotIndex: 1, session: "recovery" });
  assert.equal(res.status, 200);
  const row = state.training_week_plans.find((r) => r.rider_id === "r2");
  assert.ok(row, "ny raekke for rytteren");
  assert.equal(row.program_key, undefined, "egen plan, intet program");
  assert.deepEqual(row.days.wed.slots, [null, "recovery", null, null, null]);
  for (const weekday of ["mon", "tue", "thu", "fri", "sat", "sun"]) {
    assert.deepEqual(row.days[weekday], shown[weekday], `${weekday} er praecis den viste saaning`);
  }
  // Rytteren har nu felter og er ikke laengere en saaning.
  assert.equal((await call("GET", "/")).body.seeds.r2, undefined);
});

test("#5932 felt-flag beta: kun beta-viewer kan rette; off = adfaerden foer #5932", async (t) => {
  const betaState = cellsSeed({ cells: "beta" });
  const nonBeta = await fixture(t, { state: betaState, betaTester: false });
  assert.equal((await nonBeta.call("PUT", "/cell", { riderId: "r1", weekday: "mon", session: "rest" })).status, 404);
  const beta = await fixture(t, { state: cellsSeed({ cells: "beta" }), betaTester: true });
  assert.equal((await beta.call("PUT", "/cell", { riderId: "r1", weekday: "mon", session: "rest" })).status, 200);
});

test("deploy-vinduet (42703, program_key findes ikke endnu): tildeling virker uden proveniens", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state, missingProgramKey: true });
  const res = await call("POST", "/apply", { programKey: "hill_climber", target: "r1" });
  assert.equal(res.status, 200);
  const row = state.training_week_plans.find((r) => r.rider_id === "r1");
  assert.equal(row.program_key, undefined);
  assert.equal(row.days.mon.session, "vo2max");
});

// ── #4522: assistentens programforslag pr. rytter-gruppe (riderIds + keepOwn) ──

test("#4522 riderIds + keepOwn: kopierer til ryttere uden egen plan og springer egne raekker og gruppefoelgere over", async (t) => {
  const state = seed({
    riders: ["r1", "r2", "r3", "r4"],
    weekPlans: [{ id: "own-r1", team_id: "team-a", rider_id: "r1", days: { mon: { intensity: "hard" } } }],
  });
  state.training_group_members = [
    { rider_id: "r3", group_id: "g1", team_id: "team-a", follows_group: true },
    { rider_id: "r4", group_id: "g1", team_id: "team-a", follows_group: false },
  ];
  const { call } = await fixture(t, { state });
  const res = await call("POST", "/apply", { programKey: "sprinter", riderIds: ["r1", "r2", "r3", "r4", "r2"], keepOwn: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.applied, 2, "r2 (ingen plan) og r4 (har forladt gruppen)");
  assert.equal(res.body.skipped, 2, "r1 har egen raekke, r3 foelger en gruppe");
  const rows = state.training_week_plans.filter((r) => r.team_id === "team-a");
  assert.deepEqual(rows.map((r) => r.rider_id).sort(), ["r1", "r2", "r4"]);
  assert.deepEqual(rows.find((r) => r.id === "own-r1").days, { mon: { intensity: "hard" } }, "egen plan er uroert");
  assert.equal(rows.find((r) => r.rider_id === "r2").program_key, "sprinter");
  assert.equal(rows.find((r) => r.rider_id === "r2").days.fri.session, "sprint");
  assert.notEqual(rows.find((r) => r.rider_id === "r2").days, rows.find((r) => r.rider_id === "r4").days);
});

test("#4522 riderIds med en fremmed rytter afvises (403) og intet skrives", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  const res = await call("POST", "/apply", { programKey: "sprinter", riderIds: ["r1", "x9"], keepOwn: true });
  assert.equal(res.status, 403);
  assert.equal(state.training_week_plans.length, 0);
});

test("#4522 riderIds kraever keepOwn:true og en ikke-tom liste af id'er (400)", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  assert.equal((await call("POST", "/apply", { programKey: "sprinter", riderIds: ["r1"] })).status, 400);
  assert.equal((await call("POST", "/apply", { programKey: "sprinter", riderIds: [], keepOwn: true })).status, 400);
  assert.equal((await call("POST", "/apply", { programKey: "sprinter", riderIds: [1], keepOwn: true })).status, 400);
  assert.equal(state.training_week_plans.length, 0);
});

test("#4522 flag off: riderIds-stien findes ikke (404)", async (t) => {
  const state = seed({ stage: "off" });
  const { call } = await fixture(t, { state });
  assert.equal((await call("POST", "/apply", { programKey: "sprinter", riderIds: ["r1"], keepOwn: true })).status, 404);
  assert.equal(state.training_week_plans.length, 0);
});

test("#4522 alle valgte har egen plan: applied 0, alt springes over, intet skrives", async (t) => {
  const state = seed({
    weekPlans: [{ id: "own-r1", team_id: "team-a", rider_id: "r1", days: { mon: { intensity: "hard" } } }],
  });
  const { call } = await fixture(t, { state });
  const res = await call("POST", "/apply", { programKey: "sprinter", riderIds: ["r1"], keepOwn: true });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.applied, res.body.skipped], [0, 1]);
  assert.equal(state.training_week_plans.length, 1);
});

test("#4522 squad og enkelt-rytter er uaendret: squad overskriver stadig en egen raekke", async (t) => {
  const state = seed({
    weekPlans: [{ id: "own-r1", team_id: "team-a", rider_id: "r1", days: { mon: { intensity: "hard" } } }],
  });
  const { call } = await fixture(t, { state });
  const squad = await call("POST", "/apply", { programKey: "sprinter", target: "squad" });
  assert.equal(squad.body.applied, 2);
  assert.equal(squad.body.skipped, undefined);
  assert.equal(state.training_week_plans.find((r) => r.id === "own-r1").program_key, "sprinter");
  const single = await call("POST", "/apply", { programKey: "hill_climber", target: "r2" });
  assert.equal(single.body.applied, 1);
  assert.equal(state.training_week_plans.find((r) => r.rider_id === "r2").program_key, "hill_climber");
});
