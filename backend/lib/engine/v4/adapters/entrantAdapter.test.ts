// backend/lib/engine/v4/adapters/entrantAdapter.test.ts
// Race Engine v4 F2 (#4030), Fase B4: kontrakt-tests for entrantAdapter.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRY_ABILITY_KEYS } from "../../../abilityRegistry.js";
import { abilitiesFromRow, entrantFromAbilitiesRow, entrantsFromAbilitiesRows, normalizeRole } from "./entrantAdapter.ts";

function fullAbilitiesRow(riderId: string, value = 50) {
  const row: Record<string, unknown> = { rider_id: riderId };
  for (const key of REGISTRY_ABILITY_KEYS) row[key] = value;
  return row;
}

test("abilitiesFromRow: udtraekker alle 15 registry-noegler", () => {
  const row = fullAbilitiesRow("r1", 70);
  const abilities = abilitiesFromRow(row);
  assert.equal(Object.keys(abilities).length, REGISTRY_ABILITY_KEYS.length);
  for (const key of REGISTRY_ABILITY_KEYS) assert.equal(abilities[key as keyof typeof abilities], 70);
});

test("abilitiesFromRow: clamper til [0, 99] og defensivt 0 for manglende/ikke-numerisk", () => {
  const row: Record<string, unknown> = fullAbilitiesRow("r1", 50);
  row.climbing = 150; // over loft
  row.sprint = -10; // under gulv
  row.punch = null; // manglende -> 0
  row.tempo = "not-a-number"; // ikke-numerisk -> 0
  const abilities = abilitiesFromRow(row);
  assert.equal(abilities.climbing, 99);
  assert.equal(abilities.sprint, 0);
  assert.equal(abilities.punch, 0);
  assert.equal(abilities.tempo, 0);
});

test("abilitiesFromRow: ignorerer ekstra DB-kolonner (formula_version, hidden_potential, ...)", () => {
  const row = fullAbilitiesRow("r1", 40);
  row.formula_version = 3;
  row.generated_at = "2026-08-21";
  row.hidden_potential = { climbing: 5 };
  row.ability_caps = {};
  const abilities = abilitiesFromRow(row);
  assert.equal(Object.keys(abilities).length, REGISTRY_ABILITY_KEYS.length);
});

test("normalizeRole: kendt rolle passerer igennem, ukendt/manglende -> free_role", () => {
  assert.equal(normalizeRole("captain"), "captain");
  assert.equal(normalizeRole("sprint_captain"), "sprint_captain");
  assert.equal(normalizeRole("unknown_role"), "free_role");
  assert.equal(normalizeRole(undefined), "free_role");
  assert.equal(normalizeRole(null), "free_role");
  assert.equal(normalizeRole(42), "free_role");
});

test("entrantFromAbilitiesRow: bygger korrekt Entrant-form, default effort=normal condition=1", () => {
  const row = fullAbilitiesRow("rider-42", 65);
  const entrant = entrantFromAbilitiesRow(row, { role: "helper" });
  assert.equal(entrant.rider_id, "rider-42");
  assert.equal(entrant.role, "helper");
  assert.equal(entrant.effort, "normal");
  assert.equal(entrant.condition, 1);
  assert.equal(entrant.abilities.climbing, 65);
});

test("entrantFromAbilitiesRow: opts.riderId overstyrer row.rider_id", () => {
  const row = fullAbilitiesRow("row-id", 50);
  const entrant = entrantFromAbilitiesRow(row, { riderId: "override-id" });
  assert.equal(entrant.rider_id, "override-id");
});

test("entrantFromAbilitiesRow: kaster naar rider_id mangler helt", () => {
  const row = fullAbilitiesRow("placeholder", 50);
  delete (row as Record<string, unknown>).rider_id;
  assert.throws(() => entrantFromAbilitiesRow(row), /rider_id mangler/);
});

test("entrantFromAbilitiesRow: condition clampes til [0,1]", () => {
  const row = fullAbilitiesRow("r1", 50);
  assert.equal(entrantFromAbilitiesRow(row, { condition: 1.5 }).condition, 1);
  assert.equal(entrantFromAbilitiesRow(row, { condition: -0.5 }).condition, 0);
  assert.equal(entrantFromAbilitiesRow(row, { condition: 0.42 }).condition, 0.42);
});

test("entrantsFromAbilitiesRows: batch-oversaetter et helt startfelt med pr.-rytter-opts", () => {
  const rows = [fullAbilitiesRow("a", 50), fullAbilitiesRow("b", 60)];
  const roleById: Record<string, string> = { a: "captain", b: "helper" };
  const entrants = entrantsFromAbilitiesRows(rows, (riderId) => ({ role: roleById[riderId] }));
  assert.deepEqual(
    entrants.map((e) => [e.rider_id, e.role]),
    [["a", "captain"], ["b", "helper"]],
  );
});
