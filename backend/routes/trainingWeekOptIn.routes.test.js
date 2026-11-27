// #8776 (ejer 26/11 paa #8549) · Ugeprioritet er opt-in. plan_kind = 'week' saettes KUN af
// managerens eget valg: en Week blocks-skrivning (prioritet/laas via weekBlock) eller et skift i
// Plantype (PUT .../rotation { planKind: "week" }). Et almindeligt felt eller et program sat paa
// lader markoeren vaere, som den var, ogsaa naar en (gammel) klient sender planKind: "week".
// Routerne koeres som rigtige express-apps paa en tilfaeldig port; Supabase og auth er fakes.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createTrainingProgramsRouter } from "./trainingPrograms.js";
import { createTrainingGroupsRouter } from "./trainingGroups.js";
import { TRAINING_PROGRAM_CELLS_FLAG_KEY } from "../lib/trainingWeekPlanCellsFlag.js";
import { TRAINING_PROGRAMS_FLAG_KEY } from "../lib/trainingProgramsFlag.js";
import { TRAINING_GROUPS_FLAG_KEY } from "../lib/trainingGroups.ts";
import { TRAINING_ROTATION_FLAG_KEY } from "../lib/trainingRotationFlag.js";
import { programWeekDaysFor } from "../lib/trainingPrograms.js";

function fakeSupabase(state) {
  let seq = 0;
  function builder(table, op = "select", filters = [], payload = null) {
    const match = (row) => filters.every((f) => f(row));
    const run = () => {
      state[table] ??= [];
      if (op === "update") {
        for (const row of state[table]) if (match(row)) Object.assign(row, structuredClone(payload));
        return { data: null, error: null };
      }
      if (op === "delete") {
        state[table] = state[table].filter((row) => !match(row));
        return { data: null, error: null };
      }
      if (op === "insert") {
        const rows = [payload].flat().map((row) => ({ id: `${table}-${seq += 1}`, created_at: `t${seq}`, ...structuredClone(row) }));
        state[table].push(...rows);
        return { data: rows, error: null };
      }
      return { data: state[table].filter(match).map((r) => structuredClone(r)), error: null };
    };
    const next = (f) => builder(table, op, [...filters, f], payload);
    const obj = {
      select() { return op === "insert" ? obj : builder(table, "select", filters, payload); },
      eq(c, v) { return next((r) => r[c] === v); },
      in(c, vs) { return next((r) => vs.includes(r[c])); },
      order() { return obj; },
      update(p) { return builder(table, "update", filters, p); },
      delete() { return builder(table, "delete", filters, payload); },
      insert(p) {
        const res = builder(table, "insert", filters, p).__run();
        return {
          select: () => ({ single: async () => ({ data: res.data[0], error: res.error }) }),
          then: (resolve, reject) => Promise.resolve(res).then(resolve, reject),
        };
      },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      __run: run,
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return obj;
  }
  return { from: (table) => builder(table) };
}

const ABC = [{ session: "sprint" }, { session: "endurance" }, { session: "threshold" }];
const rotationRow = (riderId) => ({
  id: `own-${riderId}`, team_id: "team-a", rider_id: riderId, days: programWeekDaysFor("sprinter"),
  rotation: { v: 1, passes: ABC, rev: 1, anchor: { rev: 1, index: 0 } }, plan_kind: "rotation",
});

// Begge kontakter aabne (som tændingen 26/11), saa testen viser selve reglen og ikke en slukket gren.
function seed({ weekPlans = [], groupKind = null } = {}) {
  return {
    app_config: [
      { key: TRAINING_PROGRAMS_FLAG_KEY, value: "on" },
      { key: TRAINING_PROGRAM_CELLS_FLAG_KEY, value: "on" },
      { key: TRAINING_GROUPS_FLAG_KEY, value: "on" },
      { key: TRAINING_ROTATION_FLAG_KEY, value: "on" },
      { key: "training_week_priority", value: "on" },
    ],
    riders: [
      { id: "r1", team_id: "team-a", is_retired: false, primary_type: "climber" },
      { id: "r2", team_id: "team-a", is_retired: false, primary_type: "sprinter" },
      { id: "r3", team_id: "team-a", is_retired: false, primary_type: "climber" },
    ],
    seasons: [{ id: "s1", status: "active" }],
    training_plans: [],
    training_week_plans: weekPlans,
    training_groups: [{
      id: "g1", team_id: "team-a", name: "Climbers", days: programWeekDaysFor("climber"), program_key: "climber",
      fatigue_threshold: null, fallback: null, plan_kind: groupKind,
    }],
    training_group_members: [{ rider_id: "r3", group_id: "g1", team_id: "team-a", follows_group: true }],
  };
}

async function fixture(t, state) {
  const app = express();
  app.use(express.json());
  const deps = {
    supabase: fakeSupabase(state),
    requireAuth: (req, _res, next) => { req.user = { id: "user-a" }; req.team = { id: "team-a" }; next(); },
    isViewerBetaTester: async () => true,
    clock: () => new Date("2026-11-26T10:00:00Z"),
  };
  app.use("/api/training/programs", createTrainingProgramsRouter(deps));
  app.use("/api/training/groups", createTrainingGroupsRouter(deps));
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  return async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/training${path}`, {
      method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
}

const kindOf = (state, riderId) => state.training_week_plans.find((r) => r.rider_id === riderId)?.plan_kind ?? null;
const cell = { weekday: "mon", slotIndex: 0, session: "tempo" };

test("almindeligt felt uden valg giver aldrig 'week', heller ikke med planKind fra en gammel klient", async (t) => {
  const state = seed({ weekPlans: [{ id: "own-r2", team_id: "team-a", rider_id: "r2", days: programWeekDaysFor("sprinter"), plan_kind: null }] });
  const call = await fixture(t, state);
  assert.equal((await call("PUT", "/programs/cell", { riderId: "r1", ...cell })).status, 200);
  assert.equal(kindOf(state, "r1"), null, "ny raekke uden markoer");
  assert.equal((await call("PUT", "/programs/cell", { riderId: "r2", ...cell, planKind: "week" })).status, 200);
  assert.equal(kindOf(state, "r2"), null, "planKind i body'en ignoreres uden weekBlock");
  assert.equal(state.training_week_plans.find((r) => r.rider_id === "r2").days.mon.slots[0], "tempo", "feltet blev gemt");
});

test("almindeligt felt lader en eksisterende markoer vaere (week og rotation)", async (t) => {
  const state = seed({ weekPlans: [
    { id: "own-r1", team_id: "team-a", rider_id: "r1", days: programWeekDaysFor("sprinter"), plan_kind: "week" },
    rotationRow("r2"),
  ] });
  const call = await fixture(t, state);
  assert.equal((await call("PUT", "/programs/cell", { riderId: "r1", ...cell })).status, 200);
  assert.equal((await call("PUT", "/programs/cell", { riderId: "r2", ...cell, planKind: "week" })).status, 200);
  assert.deepEqual([kindOf(state, "r1"), kindOf(state, "r2")], ["week", "rotation"]);
});

test("et program sat paa en rytter eller gruppe roerer ikke plan_kind", async (t) => {
  const state = seed();
  const call = await fixture(t, state);
  assert.equal((await call("POST", "/programs/apply", { programKey: "sprinter", target: "r1", planKind: "week" })).status, 200);
  assert.equal(kindOf(state, "r1"), null);
  assert.equal((await call("POST", "/groups/g1/program", { programKey: "sprinter", planKind: "week" })).status, 200);
  assert.equal(state.training_groups[0].plan_kind, null);
  assert.equal(kindOf(state, "r3"), null, "foelgeren faar heller ingen markoer");
});

test("gruppens almindelige felt giver hverken gruppen eller foelgerne 'week'", async (t) => {
  const state = seed();
  const call = await fixture(t, state);
  assert.equal((await call("PUT", "/groups/g1/cell", { ...cell, planKind: "week" })).status, 200);
  assert.equal(state.training_groups[0].plan_kind, null);
  assert.equal(kindOf(state, "r3"), null);
});

test("eksplicit valg: en Week blocks-skrivning giver 'week' for rytter, gruppe og foelgere", async (t) => {
  const state = seed();
  const call = await fixture(t, state);
  const slots = ["sprint", "tempo", "endurance", "threshold", "rest"];
  const weekBlock = { slots, lockSlot: 2 };
  assert.equal((await call("PUT", "/programs/cell", { riderId: "r1", ...cell, session: slots[0], weekBlock })).status, 200);
  assert.equal(kindOf(state, "r1"), "week");
  assert.equal((await call("PUT", "/groups/g1/cell", { ...cell, session: slots[0], weekBlock })).status, 200);
  assert.equal(state.training_groups[0].plan_kind, "week");
  assert.equal(kindOf(state, "r3"), "week");
});

test("eksplicit valg: skiftet fra Rotation til Ugeblokke i Plantype giver 'week'", async (t) => {
  const state = seed({ weekPlans: [rotationRow("r1")], groupKind: "rotation" });
  state.training_groups[0].rotation = { v: 1, passes: ABC, rev: 1, anchor: { rev: 1, index: 0 } };
  const call = await fixture(t, state);
  assert.equal((await call("PUT", "/programs/rotation", { riderId: "r1", planKind: "week" })).status, 200);
  assert.equal(kindOf(state, "r1"), "week");
  assert.equal((await call("PUT", "/groups/g1/rotation", { planKind: "week" })).status, 200);
  assert.equal(state.training_groups[0].plan_kind, "week");
  assert.equal(kindOf(state, "r3"), "week");
});
