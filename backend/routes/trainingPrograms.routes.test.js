// #4629 · /api/training/programs: flag-gate, kopi ved tildeling, celle-override.
// Routeren koeres som en rigtig express-app paa en tilfaeldig port (samme moenster
// som comeback.test.js); Supabase og auth er fakes.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createTrainingProgramsRouter } from "./trainingPrograms.js";
import { TRAINING_PROGRAMS_FLAG_KEY } from "../lib/trainingProgramsFlag.js";
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
  assert.deepEqual((await call("GET", "/")).body, { enabled: false });
  assert.equal((await call("POST", "/apply", { programKey: "sprinter", target: "squad" })).status, 404);
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

  assert.equal((await call("PUT", "/cell", { riderId: "r2", weekday: "fri", session: "rest" })).status, 409, "r2 har intet program");
  assert.equal((await call("PUT", "/cell", { riderId: "r1", weekday: "fri", slotIndex: 7, session: "rest" })).status, 400);
  assert.equal((await call("PUT", "/cell", { riderId: "r1", weekday: "fri", session: "moonwalk" })).status, 400);
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
