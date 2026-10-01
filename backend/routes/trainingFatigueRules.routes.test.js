// #4854 + #5620 · /api/training/fatigue-rules: flag-gate, holdregel, undtagelse pr. rytter,
// ejerskab og ugestribens stempler. Rigtig express-app; Supabase og auth er fakes.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createTrainingFatigueRulesRouter } from "./trainingFatigueRules.js";
import { TRAINING_FATIGUE_RULES_FLAG_KEY } from "../lib/trainingFatigueRules.ts";

function fakeSupabase(state) {
  let seq = 0;
  function builder(table, op = "select", filters = [], payload = null) {
    const run = () => {
      state[table] ??= [];
      const match = (row) => filters.every((f) => f(row));
      if (op === "update") { for (const row of state[table]) if (match(row)) Object.assign(row, payload); return { error: null }; }
      if (op === "insert" && state.__raceOnInsert) {
        // Simulerer en samtidig skrivning: en anden request naaede at indsaette raekken foerst.
        state.__raceOnInsert = false;
        state[table].push({ id: "row-race", ...[payload].flat()[0], fatigue_threshold: 1 });
        return { error: { code: "23505", message: "duplicate key" } };
      }
      if (op === "insert") { for (const row of [payload].flat()) state[table].push({ id: `row-${seq += 1}`, ...row }); return { error: null }; }
      if (op === "delete") { state[table] = state[table].filter((row) => !match(row)); return { error: null }; }
      let rows = state[table].filter(match).map((r) => ({ ...r }));
      if (table === "training_rider_ticks") rows = rows.map((r) => ({ ...r, fatigue_rule: r.report?.fatigue_rule ?? null }));
      return { data: rows, error: null };
    };
    const next = (f) => builder(table, op, [...filters, f], payload);
    const obj = {
      select() { return builder(table, op === "select" ? "select" : op, filters, payload); },
      eq(c, v) { return next((r) => r[c] === v); },
      is(c, v) { return next((r) => (r[c] ?? null) === v); },
      in(c, vs) { return next((r) => vs.includes(r[c])); },
      gte(c, v) { return next((r) => r[c] >= v); },
      not(c, _op, _v) { return c === "report->fatigue_rule" ? next((r) => r.report?.fatigue_rule != null) : obj; },
      order() { return obj; },
      limit() { return obj; },
      update(p) { return builder(table, "update", filters, p); },
      delete() { return builder(table, "delete", filters, null); },
      insert(p) { return Promise.resolve(builder(table, "insert", filters, p).__run()); },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      __run: run,
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return obj;
  }
  return { from: (table) => builder(table) };
}

function seed({ stage = "beta" } = {}) {
  return {
    app_config: stage == null ? [] : [{ key: TRAINING_FATIGUE_RULES_FLAG_KEY, value: stage }],
    riders: [
      { id: "r1", team_id: "team-a", is_retired: false, firstname: "Rider", lastname: "One" },
      { id: "r2", team_id: "team-a", is_retired: false, firstname: "Rider", lastname: "Two" },
      { id: "x9", team_id: "team-b", is_retired: false, firstname: "Other", lastname: "Team" },
    ],
    rider_condition: [{ rider_id: "r1", fatigue: 72 }],
    team_training_rules: [],
    training_rider_ticks: [],
  };
}

async function fixture(t, { state, betaTester = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/training/fatigue-rules", createTrainingFatigueRulesRouter({
    supabase: fakeSupabase(state),
    requireAuth: (req, _res, next) => { req.user = { id: "user-a" }; req.team = { id: "team-a" }; next(); },
    isViewerBetaTester: async () => betaTester,
    now: () => new Date("2026-10-01T10:00:00Z"),
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const call = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/training/fatigue-rules${path}`, {
      method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return { call };
}

test("flag off / ikke-beta: GET enabled:false, skrivestierne 404, intet skrives", async (t) => {
  for (const [stage, beta] of [["off", true], ["beta", false]]) {
    const state = seed({ stage });
    const { call } = await fixture(t, { state, betaTester: beta });
    assert.deepEqual((await call("GET", "/")).body, { enabled: false });
    assert.equal((await call("PUT", "/team", { threshold: 50, fallback: "rest" })).status, 404);
    assert.equal(state.team_training_rules.length, 0);
  }
});

test("holdregel: gemmes, opdateres paa samme raekke, og slukkes ved tom regel", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  assert.equal((await call("PUT", "/team", { threshold: 65, fallback: "recovery", recoveryAfterStage: true })).status, 200);
  assert.equal((await call("PUT", "/team", { threshold: 70, fallback: "rest", recoveryAfterStage: true })).status, 200);
  assert.equal(state.team_training_rules.length, 1);
  assert.equal(state.team_training_rules[0].fatigue_threshold, 70);
  const got = (await call("GET", "/")).body;
  assert.deepEqual(got.team, { threshold: 70, fallback: "rest", recoveryAfterStage: true });
  assert.deepEqual(got.roster.find((r) => r.id === "r1"), { id: "r1", name: "Rider One", fatigue: 72 });
  assert.equal(got.days.length, 7);
  assert.equal(got.days.at(-1), "2026-10-01");
  assert.equal((await call("PUT", "/team", { threshold: null, fallback: null, recoveryAfterStage: false })).status, 200);
  assert.equal(state.team_training_rules.length, 0, "G7: slukket regel = ingen raekke");
});

test("ugyldig regel afvises (graense uden pas, ukendt pas, graense uden for skalaen)", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  for (const body of [{ threshold: 50 }, { threshold: 50, fallback: "nap" }, { threshold: 101, fallback: "rest" }, { threshold: 50.5, fallback: "rest" }]) {
    assert.equal((await call("PUT", "/team", body)).status, 400, JSON.stringify(body));
  }
  assert.equal(state.team_training_rules.length, 0);
});

test("undtagelse pr. rytter: egen graense, ingen graense, tilbage til holdet; kun egne ryttere", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  assert.equal((await call("PUT", "/riders/r1", { mode: "own", threshold: 50, fallback: "light" })).status, 200);
  assert.equal((await call("PUT", "/riders/r2", { mode: "off" })).status, 200);
  let got = (await call("GET", "/")).body;
  assert.deepEqual(got.riders.r1, { threshold: 50, fallback: "light", recoveryAfterStage: null });
  assert.deepEqual(got.riders.r2, { threshold: null, fallback: "off", recoveryAfterStage: null });
  assert.equal((await call("PUT", "/riders/r1", { mode: "team" })).status, 200);
  got = (await call("GET", "/")).body;
  assert.equal(got.riders.r1, undefined);
  assert.equal((await call("PUT", "/riders/x9", { mode: "off" })).status, 403);
  assert.equal((await call("PUT", "/riders/r1", { mode: "own", threshold: 50 })).status, 400);
});

test("ugestriben: kun dage hvor en regel slog til, inden for 7 datoer", async (t) => {
  const state = seed();
  const stamp = { kind: "fatigue", fallback: "rest", fatigue: 72, threshold: 65, from_intensity: "hard" };
  state.training_rider_ticks = [
    { team_id: "team-a", rider_id: "r1", tick_date: "2026-09-30", game_day: 10, report: { fatigue_rule: stamp } },
    { team_id: "team-a", rider_id: "r2", tick_date: "2026-09-30", game_day: 10, report: { fatigue_rule: null } },
    { team_id: "team-a", rider_id: "r1", tick_date: "2026-09-20", game_day: 1, report: { fatigue_rule: stamp } },
    { team_id: "team-b", rider_id: "x9", tick_date: "2026-09-30", game_day: 10, report: { fatigue_rule: stamp } },
  ];
  const { call } = await fixture(t, { state });
  const got = (await call("GET", "/")).body;
  assert.deepEqual(got.recent, [{ date: "2026-09-30", gameDay: 10, riderId: "r1", kind: "fatigue", fallback: "rest", fatigue: 72, threshold: 65 }]);
});

test("samtidig foerste skrivning (23505) goeres faerdig som update, ikke 500", async (t) => {
  const state = seed();
  state.__raceOnInsert = true;
  const { call } = await fixture(t, { state });
  assert.equal((await call("PUT", "/team", { threshold: 55, fallback: "light", recoveryAfterStage: false })).status, 200);
  assert.equal(state.team_training_rules.length, 1);
  assert.equal(state.team_training_rules[0].fatigue_threshold, 55);
});
