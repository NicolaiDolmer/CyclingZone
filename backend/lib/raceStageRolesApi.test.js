// Race Engine v3 (#2224), slice S3 (#2034) — PUT /stage-roles-validering (ren, uden DB).
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateStageRoleOverrides, saveStageRoleOverrides, getStageRolesContext } from "./raceStageRolesApi.js";

const TEAM_RIDER_IDS = new Set(["r1", "r2", "r3"]);
const BASE = { stageCount: 5, stagesCompleted: 2, teamRiderIds: TEAM_RIDER_IDS };

function ok(overrides, extra = {}) {
  return validateStageRoleOverrides({ overrides, ...BASE, ...extra });
}

// ── Løb completed ──────────────────────────────────────────────────────────────

test("raceCompleted=true → stage_roles_race_completed, uanset body", () => {
  const result = validateStageRoleOverrides({ overrides: [], raceCompleted: true, ...BASE });
  assert.deepEqual(result, { ok: false, errors: ["stage_roles_race_completed"] });
});

// ── Gyldig body ──────────────────────────────────────────────────────────────

test("gyldig body på redigerbare etaper → ok:true, ingen errors", () => {
  const result = ok([
    { stage_number: 3, rider_id: "r1", race_role: "captain", effort: "protect" },
    { stage_number: 4, rider_id: "r2", race_role: "helper", effort: "save" },
  ]);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("tom overrides-liste → ok:true (revert til fallback for ALLE redigerbare etaper)", () => {
  assert.deepEqual(ok([]), { ok: true, errors: [] });
});

// ── stage_roles_stage_locked ───────────────────────────────────────────────────

test("stage_number <= stagesCompleted (kørt etape) → stage_roles_stage_locked", () => {
  const result = ok([{ stage_number: 2, rider_id: "r1", race_role: "helper", effort: "normal" }]);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0], "stage_roles_stage_locked");
});

test("stage_number > stageCount → stage_roles_stage_locked", () => {
  const result = ok([{ stage_number: 6, rider_id: "r1", race_role: "helper", effort: "normal" }]);
  assert.equal(result.errors[0], "stage_roles_stage_locked");
});

test("stage_number = 0 eller negativ eller ikke-heltal → stage_roles_stage_locked", () => {
  for (const sn of [0, -1, 1.5, null, undefined, "3"]) {
    const result = ok([{ stage_number: sn, rider_id: "r1", race_role: "helper", effort: "normal" }]);
    assert.equal(result.errors[0], "stage_roles_stage_locked", `stage_number=${sn}`);
  }
});

// ── stage_roles_rider_not_entered ─────────────────────────────────────────────

test("rider_id ikke i holdets race_entries → stage_roles_rider_not_entered", () => {
  const result = ok([{ stage_number: 3, rider_id: "fremmed-rytter", race_role: "helper", effort: "normal" }]);
  assert.equal(result.errors[0], "stage_roles_rider_not_entered");
});

// ── stage_roles_invalid_role / stage_roles_invalid_effort ────────────────────

test("ugyldig race_role → stage_roles_invalid_role", () => {
  const result = ok([{ stage_number: 3, rider_id: "r1", race_role: "domestique", effort: "normal" }]);
  assert.equal(result.errors[0], "stage_roles_invalid_role");
});

test("ugyldig effort → stage_roles_invalid_effort", () => {
  const result = ok([{ stage_number: 3, rider_id: "r1", race_role: "helper", effort: "all-out" }]);
  assert.equal(result.errors[0], "stage_roles_invalid_effort");
});

test("manglende race_role/effort → invalid_role/invalid_effort (ikke crash)", () => {
  const result = ok([{ stage_number: 3, rider_id: "r1" }]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("stage_roles_invalid_role"));
  assert.ok(result.errors.includes("stage_roles_invalid_effort"));
});

// ── stage_roles_role_overlap ──────────────────────────────────────────────────

test(">1 captain på SAMME etape for holdet → stage_roles_role_overlap", () => {
  const result = ok([
    { stage_number: 3, rider_id: "r1", race_role: "captain", effort: "normal" },
    { stage_number: 3, rider_id: "r2", race_role: "captain", effort: "normal" },
  ]);
  assert.ok(result.errors.includes("stage_roles_role_overlap"));
});

test(">1 sprint_captain på SAMME etape for holdet → stage_roles_role_overlap", () => {
  const result = ok([
    { stage_number: 3, rider_id: "r1", race_role: "sprint_captain", effort: "normal" },
    { stage_number: 3, rider_id: "r2", race_role: "sprint_captain", effort: "normal" },
  ]);
  assert.ok(result.errors.includes("stage_roles_role_overlap"));
});

test("captain PÅ FORSKELLIGE etaper → INTET overlap (roller er per-etape-scopede)", () => {
  const result = ok([
    { stage_number: 3, rider_id: "r1", race_role: "captain", effort: "normal" },
    { stage_number: 4, rider_id: "r2", race_role: "captain", effort: "normal" },
  ]);
  assert.equal(result.ok, true);
});

test("1 captain + 1 sprint_captain SAMME etape → INTET overlap (forskellige roller)", () => {
  const result = ok([
    { stage_number: 3, rider_id: "r1", race_role: "captain", effort: "normal" },
    { stage_number: 3, rider_id: "r2", race_role: "sprint_captain", effort: "normal" },
  ]);
  assert.equal(result.ok, true);
});

test("manager demoterer basis-kaptajnen uden ny captain-override → LOVLIGT (ingen 'captain required'-regel)", () => {
  const result = ok([{ stage_number: 3, rider_id: "r1", race_role: "helper", effort: "save" }]);
  assert.equal(result.ok, true);
});

// ── stage_roles_duplicate ─────────────────────────────────────────────────────

test("dublet (stage, rider) i body → stage_roles_duplicate", () => {
  const result = ok([
    { stage_number: 3, rider_id: "r1", race_role: "captain", effort: "normal" },
    { stage_number: 3, rider_id: "r1", race_role: "helper", effort: "save" },
  ]);
  assert.ok(result.errors.includes("stage_roles_duplicate"));
});

test("samme rider på FORSKELLIGE etaper er IKKE en dublet", () => {
  const result = ok([
    { stage_number: 3, rider_id: "r1", race_role: "captain", effort: "normal" },
    { stage_number: 4, rider_id: "r1", race_role: "helper", effort: "save" },
  ]);
  assert.equal(result.ok, true);
});

// ── overrides ikke et array ───────────────────────────────────────────────────

test("overrides ikke et array → stage_roles_invalid_body", () => {
  const result = validateStageRoleOverrides({ overrides: "not-an-array", ...BASE });
  assert.deepEqual(result, { ok: false, errors: ["stage_roles_invalid_body"] });
});

// ── saveStageRoleOverrides (I/O, minimal mock-supabase) ───────────────────────

function makeSupabase() {
  const calls = [];
  function from(table) {
    const b = {
      insert(rows) { calls.push({ table, op: "insert", rows }); return Promise.resolve({ error: null }); },
      delete() {
        const rec = { table, op: "delete", eqs: [], gts: [], ins: [] };
        calls.push(rec);
        const d = {
          eq(c, v) { rec.eqs.push([c, v]); return d; },
          gt(c, v) { rec.gts.push([c, v]); return d; },
          in(c, v) { rec.ins.push([c, v]); return d; },
          then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
        };
        return d;
      },
    };
    return b;
  }
  return { from, __calls: calls };
}

test("saveStageRoleOverrides: delete scoped til redigerbare etaper (gt stagesCompleted) + holdets ryttere", async () => {
  const supabase = makeSupabase();
  await saveStageRoleOverrides({
    supabase, raceId: "race-1", teamRiderIds: new Set(["r1", "r2"]), stagesCompleted: 2,
    overrides: [{ stage_number: 3, rider_id: "r1", race_role: "captain", effort: "protect" }],
  });
  const del = supabase.__calls.find((c) => c.op === "delete");
  assert.deepEqual(del.eqs, [["race_id", "race-1"]]);
  assert.deepEqual(del.gts, [["stage_number", 2]]);
  assert.deepEqual(del.ins, [["rider_id", ["r1", "r2"]]]);
});

test("saveStageRoleOverrides: insert kun de nye overrides-rækker", async () => {
  const supabase = makeSupabase();
  await saveStageRoleOverrides({
    supabase, raceId: "race-1", teamRiderIds: new Set(["r1"]), stagesCompleted: 2,
    overrides: [{ stage_number: 3, rider_id: "r1", race_role: "hunter", effort: "save" }],
  });
  const ins = supabase.__calls.find((c) => c.op === "insert");
  assert.equal(ins.rows.length, 1);
  assert.equal(ins.rows[0].race_id, "race-1");
  assert.equal(ins.rows[0].stage_number, 3);
  assert.equal(ins.rows[0].rider_id, "r1");
  assert.equal(ins.rows[0].race_role, "hunter");
  assert.equal(ins.rows[0].effort, "save");
  assert.ok(ins.rows[0].updated_at);
});

test("saveStageRoleOverrides: tom overrides → INGEN insert-kald (kun delete/revert)", async () => {
  const supabase = makeSupabase();
  await saveStageRoleOverrides({ supabase, raceId: "race-1", teamRiderIds: new Set(["r1"]), stagesCompleted: 2, overrides: [] });
  assert.equal(supabase.__calls.some((c) => c.op === "insert"), false);
  assert.equal(supabase.__calls.some((c) => c.op === "delete"), true);
});

test("saveStageRoleOverrides: tomt teamRiderIds → INGEN delete-kald", async () => {
  const supabase = makeSupabase();
  await saveStageRoleOverrides({ supabase, raceId: "race-1", teamRiderIds: new Set(), stagesCompleted: 2, overrides: [] });
  assert.equal(supabase.__calls.length, 0);
});

// ── getStageRolesContext (I/O, minimal mock-supabase) ─────────────────────────

function makeContextSupabase({ entries = [], riders = [], overrides = [] } = {}) {
  function from(table) {
    const b = {
      select() { return b; },
      eq() { return b; },
      in() { return b; },
      then(resolve, reject) {
        const data = table === "race_entries" ? entries : table === "riders" ? riders : table === "race_stage_roles" ? overrides : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from };
}

test("getStageRolesContext: bygger riders[] med navn + basis-race_role fra race_entries", async () => {
  const supabase = makeContextSupabase({
    entries: [{ rider_id: "r1", race_role: "captain" }, { rider_id: "r2", race_role: "helper" }],
    riders: [{ id: "r1", firstname: "Tadej", lastname: "P" }, { id: "r2", firstname: "Jonas", lastname: "V" }],
    overrides: [],
  });
  const ctx = await getStageRolesContext({ supabase, race: { id: "race-1", stages: 5, stages_completed: 1 }, teamId: "team-1" });
  assert.deepEqual(ctx.riders, [
    { rider_id: "r1", name: "Tadej P", race_role: "captain" },
    { rider_id: "r2", name: "Jonas V", race_role: "helper" },
  ]);
  assert.equal(ctx.stage_count, 5);
  assert.equal(ctx.stages_completed, 1);
  assert.deepEqual(ctx.teamRiderIds, new Set(["r1", "r2"]));
});

test("getStageRolesContext: overrides inkluderer ALLE etaper (også kørte)", async () => {
  const supabase = makeContextSupabase({
    entries: [{ rider_id: "r1", race_role: "captain" }],
    riders: [{ id: "r1", firstname: "Tadej", lastname: "P" }],
    overrides: [
      { stage_number: 1, rider_id: "r1", race_role: "helper", effort: "save" },
      { stage_number: 3, rider_id: "r1", race_role: "hunter", effort: "protect" },
    ],
  });
  const ctx = await getStageRolesContext({ supabase, race: { id: "race-1", stages: 5, stages_completed: 2 }, teamId: "team-1" });
  assert.equal(ctx.overrides.length, 2, "skal inkludere BÅDE kørt (stage 1) og fremtidig (stage 3) etape");
});

test("getStageRolesContext: ingen entries → tomme riders/overrides, ingen ekstra DB-kald", async () => {
  const supabase = makeContextSupabase({ entries: [] });
  const ctx = await getStageRolesContext({ supabase, race: { id: "race-1", stages: 5, stages_completed: 0 }, teamId: "team-1" });
  assert.deepEqual(ctx.riders, []);
  assert.deepEqual(ctx.overrides, []);
});
