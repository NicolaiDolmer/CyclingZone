// #6000 · /api/training/groups: flag-gate, en rytter i hoejst een gruppe, et felt
// for hele gruppen (kopi i hver foelgende rytters raekke), "Put on" en gruppe,
// gruppe-undtagelse for traethedsgraensen. Routeren koeres som en rigtig
// express-app paa en tilfaeldig port; Supabase og auth er fakes.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createTrainingGroupsRouter } from "./trainingGroups.js";
import { TRAINING_GROUPS_FLAG_KEY } from "../lib/trainingGroups.ts";
import { TRAINING_PROGRAM_CELLS_FLAG_KEY } from "../lib/trainingWeekPlanCellsFlag.js";
import { programWeekDaysFor } from "../lib/trainingPrograms.js";

// Minimal PostgREST-fake: select/eq/in/order/update/insert/delete paa et in-memory state.
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

function seed({ groupsStage = "beta", cellsStage = "beta" } = {}) {
  return {
    app_config: [
      { key: TRAINING_GROUPS_FLAG_KEY, value: groupsStage },
      { key: TRAINING_PROGRAM_CELLS_FLAG_KEY, value: cellsStage },
    ],
    riders: [
      { id: "r1", team_id: "team-a", is_retired: false, primary_type: "climber" },
      { id: "r2", team_id: "team-a", is_retired: false, primary_type: "climber" },
      { id: "r3", team_id: "team-a", is_retired: false, primary_type: "sprinter" },
      { id: "x9", team_id: "team-b", is_retired: false, primary_type: "climber" },
    ],
    seasons: [{ id: "s1", status: "active" }],
    training_plans: [],
    training_week_plans: [],
    training_groups: [],
    training_group_members: [],
  };
}

async function fixture(t, { state, betaTester = true, planLock } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/training/groups", createTrainingGroupsRouter({
    supabase: fakeSupabase(state),
    requireAuth: (req, _res, next) => { req.user = { id: "user-a" }; req.team = { id: "team-a" }; next(); },
    isViewerBetaTester: async () => betaTester,
    ...(planLock ? { planLock } : {}),
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/training/groups`;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return { call };
}

test("flag off (eller ikke-beta): GET enabled:false, skrivestierne 404, intet skrives", async (t) => {
  const state = seed({ groupsStage: "off" });
  const { call } = await fixture(t, { state });
  assert.deepEqual((await call("GET", "/")).body, { enabled: false, groups: [] });
  assert.equal((await call("POST", "/", { name: "Climbers", riderIds: ["r1"] })).status, 404);
  assert.equal(state.training_groups.length, 0);

  const beta = seed();
  const nonBeta = await fixture(t, { state: beta, betaTester: false });
  assert.equal((await nonBeta.call("GET", "/")).body.enabled, false);
});

test("grupper kraever felterne: cells off = ingen grupper", async (t) => {
  const { call } = await fixture(t, { state: seed({ cellsStage: "off" }) });
  assert.equal((await call("GET", "/")).body.enabled, false);
});

test("opret: navn trimmes, fremmede ryttere falder fra, ugyldigt navn afvises", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  assert.equal((await call("POST", "/", { name: "   ", riderIds: [] })).status, 400);
  assert.equal((await call("POST", "/", { name: "x".repeat(41), riderIds: [] })).status, 400);
  const res = await call("POST", "/", { name: "  Climbers  ", riderIds: ["r1", "r2", "x9", "r1"] });
  assert.equal(res.status, 200);
  assert.equal(res.body.groups.length, 1);
  assert.equal(res.body.groups[0].name, "Climbers");
  assert.deepEqual(res.body.groups[0].members.map((m) => m.riderId).sort(), ["r1", "r2"]);
  // Ingen felter endnu: gruppen viser et startpunkt, og ingen raekke er skrevet.
  assert.equal(res.body.groups[0].isSeed, true);
  assert.ok(res.body.groups[0].days.mon.session);
  assert.equal(state.training_week_plans.length, 0);
});

test("en rytter er i hoejst een gruppe: en ny gruppe flytter ham", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  await call("POST", "/", { name: "Climbers", riderIds: ["r1", "r2"] });
  const res = await call("POST", "/", { name: "Sprint train", riderIds: ["r2", "r3"] });
  const byName = Object.fromEntries(res.body.groups.map((g) => [g.name, g.members.map((m) => m.riderId).sort()]));
  assert.deepEqual(byName, { Climbers: ["r1"], "Sprint train": ["r2", "r3"] });
  assert.equal(state.training_group_members.filter((m) => m.rider_id === "r2").length, 1);
});

test("et felt aendrer hele gruppen: kopi i hver foelgende rytters raekke, ikke i den der har egen plan", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  const created = await call("POST", "/", { name: "Climbers", riderIds: ["r1", "r2"] });
  const groupId = created.body.groups[0].id;
  // r2 har faaet sin egen plan rettet bagefter (rytter → gruppe → hold).
  state.training_group_members.find((m) => m.rider_id === "r2").follows_group = false;

  const res = await call("PUT", `/${groupId}/cell`, { weekday: "tue", slotIndex: 2, session: "recovery" });
  assert.equal(res.status, 200);
  const group = res.body.groups[0];
  assert.equal(group.isSeed, false);
  assert.equal(group.days.tue.slots[2], "recovery");
  const r1Row = state.training_week_plans.find((r) => r.rider_id === "r1");
  assert.deepEqual(r1Row.days, group.days);
  assert.equal(state.training_week_plans.some((r) => r.rider_id === "r2"), false);
  // Kopien deler ikke objekter med gruppens raekke.
  assert.notEqual(r1Row.days.tue, state.training_groups[0].days.tue);
});

test("ugyldigt felt afvises foer noget skrives; Train now-laasen gaelder", async (t) => {
  const state = seed();
  const lockedKinds = [];
  let locked = false;
  const planLock = (kind) => (_req, res, next) => {
    if (locked && kind === "programCell") { lockedKinds.push(kind); return res.status(409).json({ error: "train_now_locked" }); }
    return next();
  };
  const { call } = await fixture(t, { state, planLock });
  const created = await call("POST", "/", { name: "Climbers", riderIds: ["r1"] });
  const groupId = created.body.groups[0].id;
  assert.equal((await call("PUT", `/${groupId}/cell`, { weekday: "xyz", session: "rest" })).status, 400);
  assert.equal((await call("PUT", `/${groupId}/cell`, { weekday: "mon", slotIndex: 9, session: "rest" })).status, 400);
  locked = true;
  assert.equal((await call("PUT", `/${groupId}/cell`, { weekday: "mon", session: "rest" })).status, 409);
  assert.deepEqual(lockedKinds, ["programCell"]);
  assert.equal(state.training_week_plans.length, 0);
});

test("Put on en gruppe: alle medlemmer foelger igen og faar programmet", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  const created = await call("POST", "/", { name: "Climbers", riderIds: ["r1", "r2"] });
  const groupId = created.body.groups[0].id;
  state.training_group_members.find((m) => m.rider_id === "r2").follows_group = false;
  const res = await call("POST", `/${groupId}/program`, { programKey: "hill_climber" });
  assert.equal(res.status, 200);
  assert.equal(res.body.applied, 2);
  const expected = programWeekDaysFor("hill_climber");
  for (const id of ["r1", "r2"]) {
    const row = state.training_week_plans.find((r) => r.rider_id === id);
    assert.deepEqual(row.days, expected);
    assert.equal(row.program_key, "hill_climber");
  }
  assert.ok(state.training_group_members.every((m) => m.follows_group === true));
  assert.equal((await call("POST", `/${groupId}/program`, { programKey: "nope" })).status, 400);
});

test("nyt medlem i en gruppe med felter faar gruppens uge; fjernet medlem beholder sin", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  const created = await call("POST", "/", { name: "Climbers", riderIds: ["r1"] });
  const groupId = created.body.groups[0].id;
  await call("POST", `/${groupId}/program`, { programKey: "hill_climber" });
  const res = await call("PATCH", `/${groupId}`, { name: "Mountain goats", riderIds: ["r3"] });
  assert.equal(res.status, 200);
  assert.equal(res.body.groups[0].name, "Mountain goats");
  assert.deepEqual(res.body.groups[0].members.map((m) => m.riderId), ["r3"]);
  assert.equal(state.training_week_plans.find((r) => r.rider_id === "r3").program_key, "hill_climber");
  assert.equal(state.training_week_plans.find((r) => r.rider_id === "r1").program_key, "hill_climber");
});

test("follow: rytteren foelger gruppen igen og faar gruppens uge", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  const created = await call("POST", "/", { name: "Climbers", riderIds: ["r1", "r2"] });
  const groupId = created.body.groups[0].id;
  await call("POST", `/${groupId}/program`, { programKey: "hill_climber" });
  const member = state.training_group_members.find((m) => m.rider_id === "r2");
  member.follows_group = false;
  state.training_week_plans.find((r) => r.rider_id === "r2").days = programWeekDaysFor("sprinter");
  const res = await call("POST", `/${groupId}/follow`, { riderIds: ["r2", "r3"] });
  assert.equal(res.status, 200);
  assert.equal(member.follows_group, true);
  assert.deepEqual(state.training_week_plans.find((r) => r.rider_id === "r2").days, programWeekDaysFor("hill_climber"));
});

test("traethedsundtagelse for hele gruppen: valideres og gemmes; 'team' sletter den", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  const created = await call("POST", "/", { name: "Sprint train", riderIds: ["r3"] });
  const groupId = created.body.groups[0].id;
  assert.equal((await call("PUT", `/${groupId}/fatigue`, { mode: "own", threshold: 101, fallback: "light" })).status, 400);
  assert.equal((await call("PUT", `/${groupId}/fatigue`, { mode: "own", threshold: 70, fallback: "off" })).status, 400);
  const own = await call("PUT", `/${groupId}/fatigue`, { mode: "own", threshold: 70, fallback: "light" });
  assert.deepEqual(own.body.groups[0].fatigue, { threshold: 70, fallback: "light" });
  const off = await call("PUT", `/${groupId}/fatigue`, { mode: "off" });
  assert.deepEqual(off.body.groups[0].fatigue, { threshold: null, fallback: "off" });
  const team = await call("PUT", `/${groupId}/fatigue`, { mode: "team" });
  assert.equal(team.body.groups[0].fatigue, null);
});

test("slet: gruppen og medlemskaberne forsvinder, rytternes plan bliver", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  const created = await call("POST", "/", { name: "Climbers", riderIds: ["r1"] });
  const groupId = created.body.groups[0].id;
  await call("POST", `/${groupId}/program`, { programKey: "hill_climber" });
  // Fake'en har ingen FK-cascade; medlemskabet slettes af databasen i prod.
  const res = await call("DELETE", `/${groupId}`);
  assert.equal(res.status, 200);
  assert.equal(state.training_groups.length, 0);
  assert.equal(state.training_week_plans.find((r) => r.rider_id === "r1").program_key, "hill_climber");
  assert.equal((await call("DELETE", "/unknown")).status, 404);
});
