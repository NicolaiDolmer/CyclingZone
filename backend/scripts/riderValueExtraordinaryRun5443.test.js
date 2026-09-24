// #5443 — låsene foran den ekstraordinære værdikørsel.
//
// Kørslen flytter hele markedets priser uden for søndagen. Det der står mellem
// "ejeren prøver scriptet af" og "hele populationen er revalueret ved et uheld"
// er fire rene funktioner. De testes her uden DB, fordi de SKAL kunne
// gennemlæses og bevises uden at nogen rører prod.

import test from "node:test";
import assert from "node:assert/strict";

import {
  APPLY_CONFIRM_PHRASE,
  BACKED_UP_COLUMNS,
  DEFAULT_WAGE_MODEL_ID,
  OWNER_ACK_ENV,
  REQUIRED_MODEL_ID,
  ROLLBACK_CONFIRM_PHRASE,
  applyBlockers,
  rollbackBlockers,
  rollbackUpdates,
  summariseUpdates,
} from "./riderValueExtraordinaryRun5443.js";

const OK = {
  apply: true,
  confirm: APPLY_CONFIRM_PHRASE,
  ownerAck: true,
  modelId: REQUIRED_MODEL_ID,
  wageModelId: DEFAULT_WAGE_MODEL_ID,
  weekday: "wed",
};

test("role-only changes neither move money nor escape rollback", () => {
  const before = { id: "fixture-role", base_value: 100, current_production_value: 20, best_role: "tt", best_role_rating: 40 };
  const patch = { id: before.id, best_role: "sprinter", best_role_rating: 41 };
  assert.deepEqual(summariseUpdates([patch], new Map([[before.id, before]])), { up: 0, down: 0, cpvMoved: 0 });
  const rollback = rollbackUpdates([{ ...before, rider_id: before.id }], new Map([[before.id, { ...before, ...patch }]]));
  assert.equal(rollback[0].best_role, "tt");
  assert.equal(rollback[0].best_role_rating, 40);
});

test("toerkoersel er default og har ingen laase", () => {
  assert.deepEqual(
    applyBlockers({ apply: false, confirm: null, ownerAck: false, modelId: "v4", wageModelId: "v5", weekday: "sun" }),
    []
  );
});

test("alle laase skal vaere aabne foer der skrives", () => {
  assert.deepEqual(applyBlockers(OK), [], "den korrekte kombination maa ikke blokeres");

  for (const [navn, broken] of [
    ["forkert bekraeftelse", { ...OK, confirm: "koer" }],
    ["ingen bekraeftelse", { ...OK, confirm: null }],
    ["naesten rigtig bekraeftelse", { ...OK, confirm: `${APPLY_CONFIRM_PHRASE} ` }],
    ["ingen ejer-ack", { ...OK, ownerAck: false }],
    ["prismodellen staar paa v4", { ...OK, modelId: "v4" }],
    ["loenmodellen er flippet med", { ...OK, wageModelId: "v5" }],
    ["det er soendag", { ...OK, weekday: "sun" }],
  ]) {
    assert.ok(applyBlockers(broken).length > 0, `${navn} skulle have blokeret koerslen`);
  }
});

test("soendag er blokeret - den dag ejer den ordinaere koersel", () => {
  const blockers = applyBlockers({ ...OK, weekday: "sun" });
  assert.equal(blockers.length, 1);
  assert.ok(blockers[0].includes("soendag"));
  // Alle andre ugedage er fri.
  for (const d of ["mon", "tue", "wed", "thu", "fri", "sat"]) {
    assert.deepEqual(applyBlockers({ ...OK, weekday: d }), [], `${d} maa ikke vaere blokeret`);
  }
});

test("mangler ALT, naevnes alt - ejeren skal ikke gaette sig frem i fem forsoeg", () => {
  const blockers = applyBlockers({
    apply: true, confirm: null, ownerAck: false, modelId: "v4", wageModelId: "v5", weekday: "sun",
  });
  assert.equal(blockers.length, 5);
  assert.ok(blockers.some((b) => b.includes(APPLY_CONFIRM_PHRASE)));
  assert.ok(blockers.some((b) => b.includes(OWNER_ACK_ENV)));
  assert.ok(blockers.some((b) => b.includes("rider_valuation_model")));
  assert.ok(blockers.some((b) => b.includes("rider_production_value_model")));
  assert.ok(blockers.some((b) => b.includes("soendag")));
});

test("rollback har sin EGEN saetning - de to kan ikke forveksles", () => {
  assert.notEqual(APPLY_CONFIRM_PHRASE, ROLLBACK_CONFIRM_PHRASE);
  assert.deepEqual(rollbackBlockers({ confirm: ROLLBACK_CONFIRM_PHRASE, ownerAck: true }), []);
  assert.ok(rollbackBlockers({ confirm: APPLY_CONFIRM_PHRASE, ownerAck: true }).length > 0);
  assert.ok(rollbackBlockers({ confirm: ROLLBACK_CONFIRM_PHRASE, ownerAck: false }).length > 0);
});

test("backuppen daekker praecis de kolonner koerslen kan skrive", () => {
  assert.deepEqual(
    [...BACKED_UP_COLUMNS].sort(),
    ["base_value", "best_role", "best_role_rating", "current_production_value", "primary_type", "secondary_type"],
    "all columns selectChangedValueUpdates can write"
  );
});

test("rollback skriver kun det der faktisk afviger", () => {
  const backup = [
    { rider_id: "a", base_value: 100, current_production_value: 10, primary_type: "gc", secondary_type: "rouleur" },
    { rider_id: "b", base_value: 200, current_production_value: 20, primary_type: "climber", secondary_type: "gc" },
    { rider_id: "c", base_value: 300, current_production_value: 30, primary_type: "sprinter", secondary_type: "rouleur" },
  ];
  const current = new Map([
    // a er uroert
    ["a", { id: "a", base_value: 100, current_production_value: 10, primary_type: "gc", secondary_type: "rouleur" }],
    // b har faaet ny pris
    ["b", { id: "b", base_value: 175, current_production_value: 20, primary_type: "climber", secondary_type: "gc" }],
    // c findes ikke laengere
  ]);
  const updates = rollbackUpdates(backup, current);
  assert.deepEqual(updates.map((u) => u.id), ["b"]);
  assert.deepEqual(updates[0], {
    id: "b", base_value: 200, current_production_value: 20, primary_type: "climber", secondary_type: "gc",
    best_role: null, best_role_rating: null,
  });
});

test("en gentagen rollback er et no-op", () => {
  const backup = [{ rider_id: "a", base_value: 100, current_production_value: 10, primary_type: "gc", secondary_type: "rouleur" }];
  const restored = new Map([["a", { id: "a", ...Object.fromEntries(BACKED_UP_COLUMNS.map((c) => [c, backup[0][c]])) }]]);
  assert.deepEqual(rollbackUpdates(backup, restored), []);
});

test("rollback behandler null og manglende felt ens", () => {
  const backup = [{ rider_id: "a", base_value: 100, current_production_value: null, primary_type: "gc", secondary_type: null }];
  const current = new Map([["a", { id: "a", base_value: 100, current_production_value: null, primary_type: "gc", secondary_type: null }]]);
  assert.deepEqual(rollbackUpdates(backup, current), [], "null == null maa ikke tvinge en skrivning");
});

test("opsummeringen taeller op, ned og loengrundlag hver for sig", () => {
  const before = new Map([
    ["a", { id: "a", base_value: 100, current_production_value: 10 }],
    ["b", { id: "b", base_value: 100, current_production_value: 10 }],
    ["c", { id: "c", base_value: 100, current_production_value: 10 }],
  ]);
  const updates = [
    { id: "a", base_value: 150, current_production_value: 10 },
    { id: "b", base_value: 50, current_production_value: 10 },
    { id: "c", base_value: 100, current_production_value: 12 },
  ];
  assert.deepEqual(summariseUpdates(updates, before), { up: 1, down: 1, cpvMoved: 1 });
});
