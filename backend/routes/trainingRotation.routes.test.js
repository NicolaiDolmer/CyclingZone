// #8548 · Rotation i API'et: rytterens plan (PUT /api/training/programs/rotation) og
// gruppens plan (PUT /api/training/groups/:id/rotation) bag kontakten training_rotation.
// Off = 409 feature_disabled, intet skrives, og GET-svarene er uden rotation-noegler.
// Routerne koeres som rigtige express-apps paa en tilfaeldig port; Supabase og auth er fakes.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createTrainingProgramsRouter } from "./trainingPrograms.js";
import { createTrainingGroupsRouter } from "./trainingGroups.js";
import { TRAINING_PROGRAM_CELLS_FLAG_KEY } from "../lib/trainingWeekPlanCellsFlag.js";
import { TRAINING_GROUPS_FLAG_KEY } from "../lib/trainingGroups.ts";
import { TRAINING_ROTATION_FLAG_KEY } from "../lib/trainingRotationFlag.js";
import { isValidProgramWeekDays, programWeekDaysFor } from "../lib/trainingPrograms.js";

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

function seed({ rotation = "beta", weekPlans = [], groups = [], members = [] } = {}) {
  return {
    app_config: [
      { key: TRAINING_PROGRAM_CELLS_FLAG_KEY, value: "on" },
      { key: TRAINING_GROUPS_FLAG_KEY, value: "on" },
      ...(rotation == null ? [] : [{ key: TRAINING_ROTATION_FLAG_KEY, value: rotation }]),
    ],
    riders: [
      { id: "r1", team_id: "team-a", is_retired: false, primary_type: "climber" },
      { id: "r2", team_id: "team-a", is_retired: false, primary_type: "sprinter" },
      { id: "r3", team_id: "team-a", is_retired: false, primary_type: "climber" },
      { id: "x9", team_id: "team-b", is_retired: false, primary_type: "climber" },
    ],
    seasons: [{ id: "s1", status: "active" }],
    training_plans: [],
    training_week_plans: weekPlans,
    training_groups: groups,
    training_group_members: members,
  };
}

async function fixture(t, { state, betaTester = true }) {
  const app = express();
  app.use(express.json());
  const deps = {
    supabase: fakeSupabase(state),
    requireAuth: (req, _res, next) => { req.user = { id: "user-a" }; req.team = { id: "team-a" }; next(); },
    isViewerBetaTester: async () => betaTester,
    clock: () => new Date("2026-11-22T10:00:00Z"),
  };
  app.use("/api/training/programs", createTrainingProgramsRouter(deps));
  app.use("/api/training/groups", createTrainingGroupsRouter(deps));
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const call = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/training${path}`, {
      method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return { call };
}

// Rutens faste ur (2026-11-22T10:00:00Z) i hele sekunder: foerste rev (dommer 22/11 fund 1).
const T = 1795341600;
const P = (...sessions) => sessions.map((session) => ({ session }));
const ABC = P("sprint", "endurance", "threshold");
const rowOf = (state, riderId) => state.training_week_plans.find((r) => r.rider_id === riderId);

test("Week blocks cell writes return 409 when off and 400 for an invalid lock", async (t) => {
  const state = seed({ groups: [{ id: "g1", team_id: "team-a", name: "Climbers", days: null }] });
  const { call } = await fixture(t, { state });
  const slots = ["sprint", "tempo", "endurance", "threshold", "rest"];
  const body = { weekday: "mon", slotIndex: 0, session: slots[0], weekBlock: { slots, lockSlot: 4 } };
  for (const [path, target] of [["/programs/cell", { riderId: "r1" }], ["/groups/g1/cell", {}]]) {
    const off = await call("PUT", path, { ...target, ...body });
    assert.equal(off.status, 409);
    assert.equal(off.body.error, "feature_disabled");
  }
  state.app_config.push({ key: "training_week_priority", value: "on" });
  for (const [path, target] of [["/programs/cell", { riderId: "r1" }], ["/groups/g1/cell", {}]]) {
    const invalid = await call("PUT", path, { ...target, ...body, weekBlock: { slots, lockSlot: 5 } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "invalid_week_block");
  }
  assert.equal(state.training_week_plans.length, 0);
  assert.equal(state.training_groups[0].days, null);
});

test("Week blocks marks group followers and new members when rotation is off", async (t) => {
  const state = seed({
    rotation: "off",
    groups: [{ id: "g1", team_id: "team-a", name: "Climbers", days: null, program_key: null, fatigue_threshold: null, fallback: null }],
    members: [{ rider_id: "r1", group_id: "g1", team_id: "team-a", follows_group: true }],
  });
  state.app_config.push({ key: "training_week_priority", value: "on" });
  const { call } = await fixture(t, { state });
  const slots = ["sprint", "tempo", "endurance", "threshold", "sprint"];
  const response = await call("PUT", "/groups/g1/cell", {
    weekday: "mon", slotIndex: 0, session: slots[0], planKind: "week", weekBlock: { slots, lockSlot: 4 },
  });
  assert.equal(response.status, 200);
  assert.equal(rowOf(state, "r1").plan_kind, "week");
  assert.equal(rowOf(state, "r1").days.mon.lockSlot, 4);
  assert.deepEqual(rowOf(state, "r1").days.mon.slots, slots);
  assert.equal((await call("PATCH", "/groups/g1", { riderIds: ["r1", "r2"] })).status, 200);
  assert.equal(rowOf(state, "r2").plan_kind, "week");
  assert.equal(rowOf(state, "r2").days.mon.lockSlot, 4);
});

// ── Kontakten off ────────────────────────────────────────────────────────────

test("off: rytterens og gruppens rotation svarer 409 feature_disabled, intet skrives, GET uden noegler", async (t) => {
  for (const stage of ["off", null]) {
    const state = seed({
      rotation: stage,
      groups: [{ id: "g1", team_id: "team-a", name: "Climbers", days: null, program_key: null, fatigue_threshold: null, fallback: null }],
      members: [{ rider_id: "r1", group_id: "g1", team_id: "team-a", follows_group: true }],
    });
    const before = structuredClone(state);
    const { call } = await fixture(t, { state });
    const rider = await call("PUT", "/programs/rotation", { riderId: "r1", passes: ABC });
    assert.deepEqual([rider.status, rider.body], [409, { error: "feature_disabled" }]);
    const group = await call("PUT", "/groups/g1/rotation", { passes: ABC });
    assert.deepEqual([group.status, group.body], [409, { error: "feature_disabled" }]);
    assert.deepEqual(state, before, "intet skrevet");

    const programs = (await call("GET", "/programs")).body;
    assert.equal("rotationEnabled" in programs, false);
    assert.equal("rotations" in programs, false);
    const groups = (await call("GET", "/groups")).body;
    assert.deepEqual(Object.keys(groups.groups[0]).sort(), ["days", "fatigue", "id", "isSeed", "members", "name", "programKey"]);
  }
});

test("beta: en ikke-beta-viewer faar 409, en beta-viewer kan skrive", async (t) => {
  const nonBeta = await fixture(t, { state: seed(), betaTester: false });
  assert.equal((await nonBeta.call("PUT", "/programs/rotation", { riderId: "r1", passes: ABC })).status, 409);
  const beta = await fixture(t, { state: seed(), betaTester: true });
  assert.equal((await beta.call("PUT", "/programs/rotation", { riderId: "r1", passes: ABC })).status, 200);
});

// ── Rytterens plan ───────────────────────────────────────────────────────────

test("rytter: foerste rotation saar ugen, saetter plan_kind og starter ved pas 1; GET viser den", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  const res = await call("PUT", "/programs/rotation", { riderId: "r1", passes: ABC });
  assert.equal(res.status, 200);
  const expected = { v: 1, passes: ABC, rev: T, anchor: { rev: T, index: 0 } };
  assert.deepEqual(res.body, { ok: true, riderId: "r1", planKind: "rotation", rotation: expected });
  const row = rowOf(state, "r1");
  assert.ok(isValidProgramWeekDays(row.days), "Week blocks og motoren har stadig gyldige felter");
  assert.deepEqual([row.plan_kind, row.rotation], ["rotation", expected]);
  const listed = (await call("GET", "/programs")).body;
  assert.equal(listed.rotationEnabled, true);
  assert.deepEqual(listed.rotations, { r1: { planKind: "rotation", rotation: expected } });
});

test("rytter: samme pas = ingen rev-bump; rettelse ved samme laengde beholder pladsen; Spring til pas", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  await call("PUT", "/programs/rotation", { riderId: "r1", passes: ABC });
  await call("PUT", "/programs/rotation", { riderId: "r1", passes: ABC });
  assert.equal(rowOf(state, "r1").rotation.rev, T);
  await call("PUT", "/programs/rotation", { riderId: "r1", passes: P("rest", "endurance", "threshold") });
  assert.deepEqual(rowOf(state, "r1").rotation.anchor, { rev: T + 1, index: 0, fromRev: T });
  await call("PUT", "/programs/rotation", { riderId: "r1", passes: P("rest", "endurance", "threshold"), keepPlace: false });
  assert.deepEqual(rowOf(state, "r1").rotation.anchor, { rev: T + 2, index: 0 }, "Start fra pas 1");
  await call("PUT", "/programs/rotation", { riderId: "r1", startIndex: 2 });
  assert.deepEqual(rowOf(state, "r1").rotation.anchor, { rev: T + 3, index: 2 });
});

test("rytter: Week blocks beholder rotationen, og et skift tilbage fortsaetter", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  await call("PUT", "/programs/rotation", { riderId: "r1", passes: ABC });
  const saved = structuredClone(rowOf(state, "r1").rotation);
  assert.equal((await call("PUT", "/programs/rotation", { riderId: "r1", planKind: "week" })).body.planKind, "week");
  assert.deepEqual(rowOf(state, "r1").rotation, saved);
  await call("PUT", "/programs/rotation", { riderId: "r1", planKind: "rotation" });
  assert.deepEqual([rowOf(state, "r1").plan_kind, rowOf(state, "r1").rotation], ["rotation", saved]);
});

test("rytter: eksisterende raekke opdateres, felterne og proveniensen roeres ikke", async (t) => {
  const days = programWeekDaysFor("sprinter");
  const state = seed({ weekPlans: [{ id: "own-r2", team_id: "team-a", rider_id: "r2", days, program_key: "sprinter" }] });
  const { call } = await fixture(t, { state });
  assert.equal((await call("PUT", "/programs/rotation", { riderId: "r2", passes: ABC })).status, 200);
  const row = rowOf(state, "r2");
  assert.equal(state.training_week_plans.length, 1);
  assert.deepEqual([row.id, row.program_key, row.days], ["own-r2", "sprinter", days]);
});

test("rytter: validering (400), fremmed rytter (403), indsats ignoreres med kontakten off", async (t) => {
  const state = seed();
  const { call } = await fixture(t, { state });
  const bad = async (body) => (await call("PUT", "/programs/rotation", body)).body.error;
  assert.equal(await bad({ passes: ABC }), "invalid_rider");
  assert.equal(await bad({ riderId: "r1" }), "nothing_to_write");
  assert.equal(await bad({ riderId: "r1", passes: P("sprint") }), "invalid_passes");
  assert.equal(await bad({ riderId: "r1", passes: P("sprint", "moonwalk") }), "invalid_session");
  assert.equal(await bad({ riderId: "r1", passes: P("sprint", "long_climbs") }), "invalid_session", "v3 kraever kataloget");
  assert.equal(await bad({ riderId: "r1", planKind: "rotation" }), "rotation_missing");
  assert.equal(await bad({ riderId: "r1", planKind: "blocks" }), "invalid_plan_kind");
  assert.equal(await bad({ riderId: "r1", startIndex: 0 }), "rotation_missing");
  assert.equal((await call("PUT", "/programs/rotation", { riderId: "x9", passes: ABC })).status, 403);
  assert.equal(state.training_week_plans.length, 0, "intet skrevet");

  const res = await call("PUT", "/programs/rotation", { riderId: "r1", passes: [{ session: "sprint", effort: "hard" }, { session: "rest" }] });
  assert.deepEqual(res.body.rotation.passes, P("sprint", "rest"), "training_effort_levels off: indsatsen gemmes ikke");
});

test("rytter: en rettelse er rytterens egen plan og kobler ham fra gruppen", async (t) => {
  const state = seed({ members: [{ rider_id: "r1", group_id: "g1", team_id: "team-a", follows_group: true }] });
  const { call } = await fixture(t, { state });
  await call("PUT", "/programs/rotation", { riderId: "r1", passes: ABC });
  assert.equal(state.training_group_members[0].follows_group, false);
});

// ── Gruppens plan ────────────────────────────────────────────────────────────

function groupState({ weekPlans = [] } = {}) {
  return seed({
    weekPlans,
    groups: [{ id: "g1", team_id: "team-a", name: "Climbers", days: programWeekDaysFor("sprinter"), program_key: "sprinter", fatigue_threshold: null, fallback: null }],
    members: [
      { rider_id: "r1", group_id: "g1", team_id: "team-a", follows_group: true },
      { rider_id: "r2", group_id: "g1", team_id: "team-a", follows_group: true },
      { rider_id: "r3", group_id: "g1", team_id: "team-a", follows_group: false },
    ],
  });
}

test("gruppe: rotationen kopieres til hver foelgende rytter med hans egen plads; egen plan roeres ikke", async (t) => {
  const ownR2 = { v: 1, passes: P("rest", "tempo", "sprint"), rev: 3, anchor: { rev: 3, index: 1 } };
  const ownR3 = { v: 1, passes: P("rest", "tempo"), rev: 1, anchor: { rev: 1, index: 0 } };
  const state = groupState({
    weekPlans: [
      { id: "own-r2", team_id: "team-a", rider_id: "r2", days: programWeekDaysFor("sprinter"), rotation: ownR2, plan_kind: "week" },
      { id: "own-r3", team_id: "team-a", rider_id: "r3", days: programWeekDaysFor("sprinter"), rotation: ownR3, plan_kind: "rotation" },
    ],
  });
  const { call } = await fixture(t, { state });
  const res = await call("PUT", "/groups/g1/rotation", { passes: ABC });
  assert.equal(res.status, 200);
  const view = res.body.groups[0];
  assert.equal(view.planKind, "rotation");
  assert.deepEqual(view.rotation.passes, ABC);
  assert.deepEqual(state.training_groups[0].rotation, { v: 1, passes: ABC, rev: T, anchor: { rev: T, index: 0 } });

  const r1 = rowOf(state, "r1");
  assert.ok(isValidProgramWeekDays(r1.days), "ny raekke faar gruppens felter");
  assert.deepEqual([r1.plan_kind, r1.rotation], ["rotation", { v: 1, passes: ABC, rev: T, anchor: { rev: T, index: 0 } }]);
  const r2 = rowOf(state, "r2");
  assert.equal(r2.plan_kind, "rotation");
  assert.deepEqual(r2.rotation, { v: 1, passes: ABC, rev: T, anchor: { rev: T, index: 1, fromRev: 3 } }, "samme laengde: pladsen beholdes, rev stiger paa HANS raekke");
  assert.deepEqual(rowOf(state, "r3").rotation, ownR3, "foelger ikke gruppen: uroert");
  assert.notEqual(r1.rotation.passes, r2.rotation.passes);
});

test("gruppe: Start fra pas 1 og Spring til pas gaelder alle foelgere", async (t) => {
  const state = groupState();
  const { call } = await fixture(t, { state });
  await call("PUT", "/groups/g1/rotation", { passes: ABC });
  await call("PUT", "/groups/g1/rotation", { startIndex: 2 });
  assert.deepEqual(rowOf(state, "r1").rotation.anchor, { rev: T + 1, index: 2 });
  assert.deepEqual(rowOf(state, "r2").rotation.anchor, { rev: T + 1, index: 2 });
  await call("PUT", "/groups/g1/rotation", { passes: P("rest", "endurance", "threshold"), keepPlace: false });
  assert.deepEqual(rowOf(state, "r1").rotation.anchor, { rev: T + 2, index: 0 });
  await call("PUT", "/groups/g1/rotation", { passes: P("rest", "endurance", "threshold"), keepPlace: false });
  assert.deepEqual(rowOf(state, "r2").rotation.anchor, { rev: T + 3, index: 0 }, "Start fra pas 1 med samme pas nulstiller ogsaa");
});

test("gruppe: skift til Week blocks foelger med til rytterne; deres rotation bliver liggende", async (t) => {
  const state = groupState();
  const { call } = await fixture(t, { state });
  await call("PUT", "/groups/g1/rotation", { passes: ABC });
  const saved = structuredClone(rowOf(state, "r1").rotation);
  await call("PUT", "/groups/g1/rotation", { planKind: "week" });
  assert.equal(state.training_groups[0].plan_kind, "week");
  assert.deepEqual([rowOf(state, "r1").plan_kind, rowOf(state, "r1").rotation], ["week", saved]);
  await call("PUT", "/groups/g1/rotation", { planKind: "rotation" });
  assert.deepEqual([rowOf(state, "r1").plan_kind, rowOf(state, "r1").rotation], ["rotation", saved], "fortsaetter hvor den slap");
});

test("gruppe: et felt rettet paa en rotationsgruppe genkopierer rotationen uden rev-bump", async (t) => {
  const state = groupState();
  const { call } = await fixture(t, { state });
  await call("PUT", "/groups/g1/rotation", { passes: ABC });
  assert.equal((await call("PUT", "/groups/g1/cell", { weekday: "mon", slotIndex: 0, session: "rest" })).status, 200);
  assert.deepEqual([rowOf(state, "r1").plan_kind, rowOf(state, "r1").rotation.rev], ["rotation", T]);
  assert.equal(rowOf(state, "r1").days.mon.slots[0], "rest");
});

test("gruppe uden felter paa Rotation: nye medlemmer og Follow group faar rotationen (Codex-fund)", async (t) => {
  const state = seed({
    groups: [{ id: "g1", team_id: "team-a", name: "New", days: null, program_key: null, fatigue_threshold: null, fallback: null }],
    members: [
      { rider_id: "r1", group_id: "g1", team_id: "team-a", follows_group: true },
      { rider_id: "r3", group_id: "g1", team_id: "team-a", follows_group: false },
    ],
  });
  const { call } = await fixture(t, { state });
  await call("PUT", "/groups/g1/rotation", { passes: ABC });
  assert.equal(state.training_groups[0].days, null, "gruppen har stadig ingen felter");
  assert.equal(rowOf(state, "r3"), undefined);
  assert.equal((await call("PATCH", "/groups/g1", { riderIds: ["r1", "r2", "r3"] })).status, 200);
  const r2 = rowOf(state, "r2");
  assert.ok(isValidProgramWeekDays(r2.days), "saaet uge, saa motoren har felter");
  assert.deepEqual([r2.plan_kind, r2.rotation.passes], ["rotation", ABC]);
  assert.equal(r2.rotation.anchor.index, 0, "a new group member starts at pass 1");
  assert.equal((await call("POST", "/groups/g1/follow", { riderIds: ["r3"] })).status, 200);
  assert.deepEqual([rowOf(state, "r3").plan_kind, rowOf(state, "r3").rotation.passes], ["rotation", ABC]);
});

test("gruppe: ukendt gruppe 404, ugyldig body 400", async (t) => {
  const state = groupState();
  const { call } = await fixture(t, { state });
  assert.equal((await call("PUT", "/groups/nope/rotation", { passes: ABC })).status, 404);
  assert.equal((await call("PUT", "/groups/g1/rotation", { passes: P("sprint") })).body.error, "invalid_passes");
  assert.equal((await call("PUT", "/groups/g1/rotation", { planKind: "rotation" })).body.error, "rotation_missing");
});

test("a rider added to a rotation group starts at pass 1 despite an earlier rotation", async (t) => {
  for (const days of [null, programWeekDaysFor("sprinter")]) {
    const earlier = { v: 1, passes: ABC, rev: 12, anchor: { rev: 12, index: 2 } };
    const state = seed({
      groups: [{ id: "g1", team_id: "team-a", name: "Rotation", days, plan_kind: "rotation", rotation: earlier }],
      weekPlans: [{ id: "old-r2", team_id: "team-a", rider_id: "r2", days: programWeekDaysFor("sprinter"), plan_kind: "rotation", rotation: earlier }],
    });
    const { call } = await fixture(t, { state });
    assert.equal((await call("PATCH", "/groups/g1", { riderIds: ["r2"] })).status, 200);
    const member = rowOf(state, "r2");
    assert.equal(member.rotation.anchor.index, 0);
    assert.ok(member.rotation.rev > earlier.rev);
  }
});
