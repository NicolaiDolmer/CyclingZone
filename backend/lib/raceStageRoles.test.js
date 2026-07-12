// Race Engine v3 (#2224), slice S3 (#2034) — race_stage_roles-resolution.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveStageEntrant,
  effortsSequenceForRider,
  effortByRiderForStage,
  serializeStageRoleOverrides,
  loadStageRoleOverrides,
} from "./raceStageRoles.js";

// ── resolveStageEntrant: fallback-kæde ────────────────────────────────────────

test("resolveStageEntrant: ingen override for etapen → falder til entrant.race_role, effort='normal'", () => {
  const entrant = { rider_id: "r1", race_role: "helper" };
  const resolved = resolveStageEntrant(entrant, undefined);
  assert.equal(resolved.race_role, "helper");
  assert.equal(resolved.effort, "normal");
});

test("resolveStageEntrant: override for RYTTEREN på DENNE etape vinder over basis-rollen", () => {
  const entrant = { rider_id: "r1", race_role: "helper" };
  const overridesForStage = new Map([["r1", { race_role: "captain", effort: "protect" }]]);
  const resolved = resolveStageEntrant(entrant, overridesForStage);
  assert.equal(resolved.race_role, "captain");
  assert.equal(resolved.effort, "protect");
});

test("resolveStageEntrant: override for en ANDEN rytter påvirker ikke denne", () => {
  const entrant = { rider_id: "r1", race_role: "helper" };
  const overridesForStage = new Map([["r2", { race_role: "captain", effort: "protect" }]]);
  const resolved = resolveStageEntrant(entrant, overridesForStage);
  assert.equal(resolved.race_role, "helper");
  assert.equal(resolved.effort, "normal");
});

test("resolveStageEntrant: entrant uden basis-race_role og ingen override → ingen rolle (nøglen udelades)", () => {
  const entrant = { rider_id: "r1" };
  const resolved = resolveStageEntrant(entrant, undefined);
  assert.equal(resolved.race_role, undefined);
  assert.ok(!("race_role" in resolved), "race_role-nøglen skal være fraværende, ikke undefined-værdi");
  assert.equal(resolved.effort, "normal");
});

test("resolveStageEntrant: override sætter KUN rolle uden effort → effort falder alligevel til 'normal' (DB-schema garanterer effort NOT NULL, men defensivt)", () => {
  const entrant = { rider_id: "r1", race_role: "helper" };
  const overridesForStage = new Map([["r1", { race_role: "hunter" }]]);
  const resolved = resolveStageEntrant(entrant, overridesForStage);
  assert.equal(resolved.race_role, "hunter");
  assert.equal(resolved.effort, "normal");
});

test("resolveStageEntrant: bevarer entrantens øvrige felter (spread)", () => {
  const entrant = { rider_id: "r1", race_role: "helper", team_id: "A", abilities: { climbing: 50 } };
  const resolved = resolveStageEntrant(entrant, undefined);
  assert.equal(resolved.team_id, "A");
  assert.deepEqual(resolved.abilities, { climbing: 50 });
});

// ── effortsSequenceForRider ────────────────────────────────────────────────────

test("effortsSequenceForRider: tom/manglende stageRoleOverrides → null (kald-stedet falder tilbage til enkelt-effort)", () => {
  assert.equal(effortsSequenceForRider(undefined, "r1", [1, 2, 3]), null);
  assert.equal(effortsSequenceForRider(new Map(), "r1", [1, 2, 3]), null);
});

test("effortsSequenceForRider: bygger effort PR. ETAPE, 'normal' hvor der ingen override er", () => {
  const overrides = new Map([
    [1, new Map([["r1", { race_role: "helper", effort: "protect" }]])],
    [3, new Map([["r1", { race_role: "helper", effort: "save" }]])],
  ]);
  assert.deepEqual(effortsSequenceForRider(overrides, "r1", [1, 2, 3]), ["protect", "normal", "save"]);
});

test("effortsSequenceForRider: en ANDEN rytters override lækker ikke ind", () => {
  const overrides = new Map([[1, new Map([["r2", { race_role: "helper", effort: "protect" }]])]]);
  assert.deepEqual(effortsSequenceForRider(overrides, "r1", [1, 2]), ["normal", "normal"]);
});

// ── effortByRiderForStage ──────────────────────────────────────────────────────

test("effortByRiderForStage: ingen overrides for etapen → null", () => {
  assert.equal(effortByRiderForStage(undefined, 1), null);
  assert.equal(effortByRiderForStage(new Map(), 1), null);
  assert.equal(effortByRiderForStage(new Map([[1, new Map()]]), 1), null);
});

test("effortByRiderForStage: returnerer Map(rider_id → effort) for DENNE etape", () => {
  const overrides = new Map([
    [1, new Map([["r1", { race_role: "helper", effort: "protect" }], ["r2", { race_role: "captain", effort: "normal" }]])],
    [2, new Map([["r1", { race_role: "helper", effort: "save" }]])],
  ]);
  const forStage1 = effortByRiderForStage(overrides, 1);
  assert.equal(forStage1.get("r1"), "protect");
  assert.equal(forStage1.get("r2"), "normal");
  const forStage2 = effortByRiderForStage(overrides, 2);
  assert.equal(forStage2.get("r1"), "save");
  assert.equal(forStage2.has("r2"), false);
});

// ── serializeStageRoleOverrides ────────────────────────────────────────────────

test("serializeStageRoleOverrides: flad, sorteret [[stage, rider_id, role, effort]]", () => {
  const overrides = new Map([
    [2, new Map([["rB", { race_role: "captain", effort: "normal" }]])],
    [1, new Map([["rZ", { race_role: "helper", effort: "protect" }], ["rA", { race_role: "hunter", effort: "save" }]])],
  ]);
  const flat = serializeStageRoleOverrides(overrides);
  assert.deepEqual(flat, [
    [1, "rA", "hunter", "save"],
    [1, "rZ", "helper", "protect"],
    [2, "rB", "captain", "normal"],
  ]);
});

test("serializeStageRoleOverrides: tom Map → tomt array", () => {
  assert.deepEqual(serializeStageRoleOverrides(new Map()), []);
});

test("serializeStageRoleOverrides: deterministisk uanset insertion-rækkefølge", () => {
  const a = new Map([[1, new Map([["x", { race_role: "helper", effort: "normal" }]])], [2, new Map([["y", { race_role: "hunter", effort: "save" }]])]]);
  const b = new Map([[2, new Map([["y", { race_role: "hunter", effort: "save" }]])], [1, new Map([["x", { race_role: "helper", effort: "normal" }]])]]);
  assert.deepEqual(serializeStageRoleOverrides(a), serializeStageRoleOverrides(b));
});

// ── loadStageRoleOverrides (I/O, minimal mock-supabase) ────────────────────────

function makeSupabase({ rows = [], error = null } = {}) {
  function from() {
    const b = {
      select() { return b; },
      eq() { return b; },
      then(resolve, reject) {
        return Promise.resolve({ data: error ? null : rows, error }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from };
}

test("loadStageRoleOverrides: grupperer rækker stage → rider → {race_role, effort}", async () => {
  const supabase = makeSupabase({
    rows: [
      { stage_number: 1, rider_id: "r1", race_role: "helper", effort: "protect" },
      { stage_number: 1, rider_id: "r2", race_role: "captain", effort: "normal" },
      { stage_number: 2, rider_id: "r1", race_role: "hunter", effort: "save" },
    ],
  });
  const overrides = await loadStageRoleOverrides({ supabase, raceId: "race-1" });
  assert.equal(overrides.get(1).get("r1").race_role, "helper");
  assert.equal(overrides.get(1).get("r1").effort, "protect");
  assert.equal(overrides.get(1).get("r2").race_role, "captain");
  assert.equal(overrides.get(2).get("r1").race_role, "hunter");
});

test("loadStageRoleOverrides: ingen rækker → tom Map", async () => {
  const overrides = await loadStageRoleOverrides({ supabase: makeSupabase({ rows: [] }), raceId: "race-1" });
  assert.equal(overrides.size, 0);
});

test("loadStageRoleOverrides: DB-fejl → kaster Error", async () => {
  const supabase = makeSupabase({ error: { message: "connection refused" } });
  await assert.rejects(
    () => loadStageRoleOverrides({ supabase, raceId: "race-1" }),
    /race_stage_roles/
  );
});
