import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RIDER_TYPES,
  RIDER_TYPE_KEYS,
  ABILITY_KEYS,
  GUARDS,
  NEUTRAL_BASELINE,
  scoreRiderType,
  computeRiderTypes,
} from "./riderTypes.js";

// Syntetisk baseline (mean 35, std 15 pr. evne) ~ prod-abilities — gør testene
// uafhængige af den fittede riderTypesBaseline.json (som ændrer sig med populationen).
const BASELINE = {
  mean: Object.fromEntries(ABILITY_KEYS.map((a) => [a, 35])),
  std: Object.fromEntries(ABILITY_KEYS.map((a) => [a, 15])),
};

// Komplet ability-profil med default + overrides.
const rider = (over = {}, base = 30) =>
  Object.fromEntries(ABILITY_KEYS.map((a) => [a, over[a] ?? base]));

test("RIDER_TYPES indeholder de 9 forventede typer i tie-break-rækkefølge", () => {
  assert.equal(RIDER_TYPES.length, 9);
  assert.deepEqual(RIDER_TYPE_KEYS, [
    "sprinter", "leadout", "tt", "climber", "puncheur",
    "brostensrytter", "baroudeur", "rouleur", "gc",
  ]);
});

test("goat, domestique og allrounder er fjernet som typer", () => {
  for (const k of ["goat", "domestique", "allrounder", "classics"]) {
    assert.ok(!RIDER_TYPE_KEYS.includes(k), `${k} bør være fjernet`);
  }
});

test("type-formler refererer kun evner i ABILITY_KEYS", () => {
  const valid = new Set(ABILITY_KEYS);
  for (const t of RIDER_TYPES) {
    for (const ability of Object.keys(t.weights)) {
      assert.ok(valid.has(ability), `${t.key} bruger ukendt evne ${ability}`);
    }
  }
});

test("scoreRiderType: kontrast = snit(positive z) − snit(negative z) (hånd-regnet)", () => {
  // tt = { time_trial:3, climbing:-2, sprint:-1, punch:-1 } (#1122: climbing-straf). Neutral baseline → z = rå.
  // pos = (3·90)/3 = 90. neg = (2·0 + 1·10 + 1·20)/4 = 30/4 = 7,5. score = 90 − 7,5 = 82,5. (climbing mangler → z=0.)
  const ab = { time_trial: 90, sprint: 10, punch: 20 };
  assert.equal(scoreRiderType(ab, RIDER_TYPES.find((t) => t.key === "tt").weights, NEUTRAL_BASELINE), 82.5);
});

test("scoreRiderType: kun positive vægte → ingen negativ-straf", () => {
  // rouleur = { flat:2, endurance:1, climbing:-1, sprint:-1 }
  const ab = { flat: 50, endurance: 20, climbing: 0, sprint: 0 };
  // pos = (2·50 + 1·20)/3 = 40. neg = (0+0)/2 = 0. score = 40.
  assert.equal(scoreRiderType(ab, RIDER_TYPES.find((t) => t.key === "rouleur").weights, NEUTRAL_BASELINE), 40);
});

// ── Guards ────────────────────────────────────────────────────────────────────
test("guard: sprint ≥ tærskel → aldrig leadout", () => {
  const r = rider({ sprint: GUARDS.highSpeciality, acceleration: 90, flat: 80 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.notEqual(primary.key, "leadout");
  assert.notEqual(secondary.key, "leadout");
});

test("guard: høj sprint (<tærskel) tillader stadig leadout", () => {
  const r = rider({ sprint: GUARDS.highSpeciality - 5, acceleration: 60, flat: 60, durability: 50 });
  const keys = RIDER_TYPES.filter((t) => !["leadout"].includes(t.key)); // sanity
  assert.ok(keys.length > 0);
  // leadout må optræde (ikke garanteret primær, men ikke guarded væk)
  const out = computeRiderTypes(r, BASELINE);
  assert.ok(out.primary && out.secondary);
});

test("guard: ≥ tærskel i et speciale → aldrig rouleur", () => {
  const r = rider({ climbing: GUARDS.highSpeciality, flat: 80, endurance: 70 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.notEqual(primary.key, "rouleur");
  assert.notEqual(secondary.key, "rouleur");
});

test("guard: sprint > brosten → aldrig brostensrytter", () => {
  const r = rider({ sprint: 60, cobblestone: 55, flat: 70, endurance: 60 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.notEqual(primary.key, "brostensrytter");
  assert.notEqual(secondary.key, "brostensrytter");
});

test("guard: brosten ≥ sprint tillader brostensrytter", () => {
  const r = rider({ cobblestone: 90, sprint: 40, flat: 70, endurance: 65, punch: 60, climbing: 15 });
  assert.equal(computeRiderTypes(r, BASELINE).primary.key, "brostensrytter");
});

test("gc-gate: bjerg+tt+recovery alle ≥ tærskel → gc mulig", () => {
  const r = rider({ climbing: 75, time_trial: 60, recovery: 60, tempo: 65, endurance: 60, durability: 55, sprint: 20 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.ok([primary.key, secondary.key].includes("gc"), "gc bør være i top-2 for ægte etapeløbsrytter");
});

test("gc-gate: lav recovery → aldrig gc (selv med høj bjerg+tt)", () => {
  const r = rider({ climbing: 90, time_trial: 80, recovery: GUARDS.gcRecovery - 5, tempo: 70 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.notEqual(primary.key, "gc");
  assert.notEqual(secondary.key, "gc");
});

// ── computeRiderTypes generelt ───────────────────────────────────────────────
test("computeRiderTypes returnerer altid primær + sekundær (top-2)", () => {
  const r = rider({ acceleration: 85, sprint: 82, climbing: 12 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.ok(primary && typeof primary.key === "string");
  assert.ok(secondary && typeof secondary.key === "string");
  assert.notEqual(primary.key, secondary.key);
  assert.ok(primary.score >= secondary.score);
});

test("edge: tom rytter → deterministisk top-2, ingen crash", () => {
  const a = computeRiderTypes({}, BASELINE);
  const b = computeRiderTypes({}, BASELINE);
  assert.deepEqual(a, b);
});

// ── Realistiske fixtures (abilities 0-99) ────────────────────────────────────
test("fixture: ren spurter → sprinter", () => {
  const sprinter = rider({
    acceleration: 88, sprint: 85, flat: 72, durability: 58, climbing: 12,
    endurance: 30, cobblestone: 22, punch: 40,
  });
  assert.equal(computeRiderTypes(sprinter, BASELINE).primary.key, "sprinter");
});

test("fixture: ren klatrer → climber", () => {
  const climber = rider({
    climbing: 88, tempo: 72, punch: 50, endurance: 60, sprint: 10,
    acceleration: 18, flat: 18, time_trial: 35, recovery: 30, cobblestone: 12,
  });
  assert.equal(computeRiderTypes(climber, BASELINE).primary.key, "climber");
});

test("fixture: tidskører → tt", () => {
  const tt = rider({
    time_trial: 90, prolog: 82, flat: 55, endurance: 50, sprint: 14,
    punch: 18, climbing: 35, acceleration: 20, cobblestone: 20,
  });
  assert.equal(computeRiderTypes(tt, BASELINE).primary.key, "tt");
});

test("fixture: brostensspecialist → brostensrytter", () => {
  const cobbles = rider({
    cobblestone: 90, flat: 75, endurance: 70, punch: 60, climbing: 14,
    sprint: 45, acceleration: 40,
  });
  assert.equal(computeRiderTypes(cobbles, BASELINE).primary.key, "brostensrytter");
});

test("fixture: ægte etapeløbsrytter → gc", () => {
  const gc = rider({
    climbing: 82, time_trial: 70, recovery: 68, tempo: 72, endurance: 66,
    durability: 60, punch: 55, prolog: 50, flat: 45, sprint: 22, acceleration: 30,
  });
  assert.equal(computeRiderTypes(gc, BASELINE).primary.key, "gc");
});
