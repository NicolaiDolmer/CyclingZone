// #5944 · /api/youth-race-opt-out: validering, GET/PUT-kontrakt og 503 foer migrationen.
// Rigtig express-app; Supabase og auth er fakes.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createYouthRaceOptOutRouter } from "./youthRaceOptOut.js";

const TABLE = "team_youth_race_opt_outs";

function fakeSupabase(state) {
  function builder(table, op = "select", filters = [], payload = null) {
    const run = () => {
      if ((state.__missing ?? []).includes(table)) return { data: null, error: { code: "PGRST205", message: "missing" } };
      state[table] ??= [];
      const match = (row) => filters.every((f) => f(row));
      if (op === "delete") { state[table] = state[table].filter((r) => !match(r)); return { data: null, error: null }; }
      if (op === "upsert") {
        if (!state[table].some((r) => r.team_id === payload.team_id && r.squad === payload.squad)) state[table].push({ ...payload });
        return { data: null, error: null };
      }
      return { data: state[table].filter(match).map((r) => ({ ...r })), error: null };
    };
    const next = (f) => builder(table, op, [...filters, f], payload);
    const obj = {
      select() { return obj; },
      eq(c, v) { return next((r) => r[c] === v); },
      in(c, vs) { return next((r) => vs.includes(r[c])); },
      order() { return obj; },
      limit() { return obj; },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      delete() { return builder(table, "delete", filters); },
      upsert(p) { return Promise.resolve(builder(table, "upsert", filters, p).__run()); },
      __run: run,
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return obj;
  }
  return { from: (table) => builder(table) };
}

function seed() {
  return {
    seasons: [{ id: "s4", status: "active" }],
    races: [
      { id: "u1", season_id: "s4", squad: "u23", league_division_id: 10, status: "scheduled", stages_completed: 0, game_day_start: 22 },
    ],
    race_stage_schedule: [],
    training_train_now_locks: [],
    race_entries: [{ race_id: "u1", team_id: "team-a", rider_id: "r1" }],
    [TABLE]: [],
  };
}

async function fixture(t, state) {
  const app = express();
  app.use(express.json());
  app.use("/api/youth-race-opt-out", createYouthRaceOptOutRouter({
    supabase: fakeSupabase(state),
    requireAuth: (req, _res, next) => {
      req.team = { id: "team-a", league_division_id: 1, u23_league_division_id: 10, junior_league_division_id: null };
      next();
    },
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  return async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/youth-race-opt-out${path}`, {
      method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
}

test("#5944 GET: standard er Enter races med foerste ulaaste loebsdag", async (t) => {
  const call = await fixture(t, seed());
  const res = await call("GET", "/?squad=u23");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { available: true, squad: "u23", trainOnly: false, effectiveFromDay: 22 });
});

test("#5944 GET/PUT: ukendt trup og ukendt mode afvises (senior kan ikke fravaelges)", async (t) => {
  const call = await fixture(t, seed());
  assert.equal((await call("GET", "/?squad=senior")).status, 400);
  assert.equal((await call("PUT", "/senior", { mode: "train_only" })).status, 400);
  assert.equal((await call("PUT", "/u23", { mode: "skip" })).status, 400);
});

test("#5944 PUT train_only rydder ulaaste tilmeldinger, PUT enter slaar det fra igen", async (t) => {
  const state = seed();
  const call = await fixture(t, state);
  const on = await call("PUT", "/u23", { mode: "train_only" });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body, { squad: "u23", trainOnly: true, clearedRaces: 1, effectiveFromDay: 22 });
  assert.equal(state.race_entries.length, 0);
  assert.equal((await call("GET", "/?squad=u23")).body.trainOnly, true);

  const off = await call("PUT", "/u23", { mode: "enter" });
  assert.equal(off.status, 200);
  assert.equal(off.body.trainOnly, false);
  assert.equal(state[TABLE].length, 0);
});

test("#5944 foer migrationen: GET svarer available=false, PUT svarer 503", async (t) => {
  const state = seed();
  state.__missing = [TABLE];
  const call = await fixture(t, state);
  const get = await call("GET", "/?squad=u23");
  assert.deepEqual(get.body, { available: false, squad: "u23", trainOnly: false, effectiveFromDay: null });
  const put = await call("PUT", "/u23", { mode: "train_only" });
  assert.equal(put.status, 503);
  assert.equal(state.race_entries.length, 1, "intet ryddes naar valget ikke kan gemmes");
});
