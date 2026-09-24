// backend/scripts/exportPopulationSnapshot.test.js
// #5572: population-eksporten skal skrive ALLE de evner v4-motorens entrant-
// adapter laeser — ellers falder de tavst paa 0 i enhver maaling paa det
// pinnede snapshot (som tactics/positioning gjorde i 2026-09-07-pinnen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { REGISTRY_ABILITY_KEYS, REGISTRY_CLASSIFIER_KEYS } from "../lib/abilityRegistry.js";
import { abilitiesFromRow } from "../lib/engine/v4/adapters/entrantAdapter.ts";
import {
  EXPORT_ABILITY_KEYS,
  abilityCoverage,
  buildRiderRecord,
  pseudonymizeTeamIds,
} from "./exportPopulationSnapshot.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NEW_PIN = join(SCRIPT_DIR, "baselines", "population-snapshot-2026-09-24.json");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test("EXPORT_ABILITY_KEYS daekker hver evne motorens entrant-adapter laeser", () => {
  const adapterKeys = Object.keys(abilitiesFromRow({}));
  for (const key of adapterKeys) {
    assert.ok(EXPORT_ABILITY_KEYS.includes(key), `adapteren laeser "${key}", men eksporten skriver den ikke`);
  }
  assert.ok(EXPORT_ABILITY_KEYS.includes("tactics"));
  assert.ok(EXPORT_ABILITY_KEYS.includes("positioning"));
});

test("EXPORT_ABILITY_KEYS er registry-listen, ikke klassifikatorens delmaengde", () => {
  assert.deepEqual([...EXPORT_ABILITY_KEYS], [...REGISTRY_ABILITY_KEYS]);
  assert.ok(EXPORT_ABILITY_KEYS.length > REGISTRY_CLASSIFIER_KEYS.length);
});

test("buildRiderRecord skriver hver noegle, manglende/NULL → null", () => {
  const rider = { id: "r1", firstname: "A", lastname: "B", effective_team_id: "t1", is_u25: 1 };
  const rec = buildRiderRecord(rider, { climbing: 40, tactics: 12, positioning: null }, { form: 70, fatigue: 5 });
  assert.deepEqual(Object.keys(rec.abilities), [...EXPORT_ABILITY_KEYS]);
  assert.equal(rec.abilities.climbing, 40);
  assert.equal(rec.abilities.tactics, 12);
  assert.equal(rec.abilities.positioning, null);
  assert.equal(rec.abilities.sprint, null);
  assert.equal(rec.team_id, "t1");
  assert.equal(rec.is_u25, true);
  assert.equal(rec.form, 70);
  assert.equal(rec.fatigue, 5);
  const noCond = buildRiderRecord(rider, {}, undefined);
  assert.equal(noCond.form, null);
  assert.equal(noCond.fatigue, null);
});

test("pseudonymizeTeamIds bevarer gruppering og orden, fjerner de rigtige id'er", () => {
  const snapshot = {
    team_ids: "raw",
    teams: [{ id: "c-team" }, { id: "a-team" }, { id: "b-team" }],
    riders: [
      { id: "r1", team_id: "b-team" },
      { id: "r2", team_id: "a-team" },
      { id: "r3", team_id: "b-team" },
      { id: "r4", team_id: null },
    ],
  };
  const before = JSON.stringify(snapshot);
  const out = pseudonymizeTeamIds(snapshot);
  assert.equal(JSON.stringify(snapshot), before, "input maa ikke muteres");
  assert.equal(out.team_ids, "pseudonymized");
  assert.deepEqual(out.teams.map((t) => t.id), ["team-0003", "team-0001", "team-0002"]);
  assert.deepEqual(out.riders.map((r) => r.team_id), ["team-0002", "team-0001", "team-0002", null]);
  // Samme relative orden som de rigtige id'er: sorteret paa rigtigt id er
  // aliaserne ogsaa sorteret.
  const aliasesInRealOrder = snapshot.teams
    .map((t, i) => [t.id, out.teams[i].id])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, alias]) => alias);
  assert.deepEqual(aliasesInRealOrder, [...aliasesInRealOrder].sort());
  for (const id of ["a-team", "b-team", "c-team"]) assert.ok(!JSON.stringify(out).includes(id));
});

test("abilityCoverage taeller ryttere med vaerdi > 0", () => {
  const riders = [{ abilities: { tactics: 5 } }, { abilities: { tactics: 0 } }, { abilities: { tactics: null } }];
  const [row] = abilityCoverage(riders, ["tactics"]);
  assert.deepEqual(row, { ability: "tactics", positive: 1, total: 3 });
});

test("den committede 2026-09-24-pin baerer tactics/positioning og ingen rigtige hold-id'er", () => {
  const pin = JSON.parse(readFileSync(NEW_PIN, "utf8"));
  assert.equal(pin.schema_version, 1);
  assert.equal(pin.team_ids, "pseudonymized");
  for (const key of Object.keys(abilitiesFromRow({}))) {
    assert.ok(pin.ability_keys.includes(key), `pinnen mangler "${key}"`);
  }
  assert.equal(pin.riders.length, pin.counts.riders);
  const teamIds = new Set(pin.teams.map((t) => t.id));
  for (const t of pin.teams) assert.ok(!UUID_RE.test(t.id), "rigtigt hold-id i teams[]");
  for (const r of pin.riders) {
    assert.ok(r.team_id === null || teamIds.has(r.team_id), "rytterens hold findes ikke i teams[]");
    assert.ok(r.team_id === null || !UUID_RE.test(r.team_id), "rigtigt hold-id paa en rytter");
  }
  // "Stort set alle" prod-ryttere har begge evner (#5572) — pinnen maa ikke
  // igen ende med at mangle dem.
  const coverage = Object.fromEntries(abilityCoverage(pin.riders, ["tactics", "positioning"]).map((r) => [r.ability, r]));
  for (const key of ["tactics", "positioning"]) {
    assert.ok(coverage[key].positive / coverage[key].total > 0.95, `${key} mangler paa for mange ryttere`);
  }
});
