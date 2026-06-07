import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveAbilities, FORMULA_VERSION, CALIBRATION,
  VISIBLE_ABILITIES, ALL_ABILITY_KEYS, PRIMARY_STAT,
} from "./abilityDerivation.js";

const STAT_KEYS = [
  "stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_prl", "stat_bro",
  "stat_sp", "stat_acc", "stat_ned", "stat_udh", "stat_mod", "stat_res", "stat_ftr",
];

function rider(stat = 60, extra = {}) {
  const r = { id: "r1", birthdate: "1998-01-01", potentiale: 3 };
  for (const k of STAT_KEYS) r[k] = stat;
  return { ...r, ...extra };
}

// ── Determinisme + kontrakt ───────────────────────────────────────────────────

test("samme input → identisk output (determinisme)", () => {
  assert.deepEqual(deriveAbilities({}, rider(64)), deriveAbilities({}, rider(64)));
});

test("rider_id + formula_version (=2) sættes", () => {
  const a = deriveAbilities({}, rider(60, { id: "xyz" }));
  assert.equal(a.rider_id, "xyz");
  assert.equal(a.formula_version, FORMULA_VERSION);
  assert.equal(FORMULA_VERSION, 2);
});

test("rider_id falder tilbage til physiology.rider_id", () => {
  const a = deriveAbilities({ rider_id: "phys-id" }, { ...rider(60), id: undefined });
  assert.equal(a.rider_id, "phys-id");
});

test("producerer alle 16 synlige + hidden_potential", () => {
  const a = deriveAbilities({}, rider(60));
  for (const k of ALL_ABILITY_KEYS) assert.ok(k in a, `mangler ${k}`);
  assert.equal(VISIBLE_ABILITIES.length, 16);
});

// ── Ankre: PCM 50 → spil 1, PCM 85 → spil 99 (ejer-besluttet skala) ───────────

test("alle disciplin-evner = 1 ved stat = pcmFloor (50)", () => {
  const a = deriveAbilities({}, rider(CALIBRATION.pcmFloor));
  for (const ability of Object.keys(PRIMARY_STAT)) {
    assert.equal(a[ability], 1, `${ability} ved stat 50 = ${a[ability]}, forventet 1`);
  }
});

test("alle disciplin-evner = 99 ved stat = pcmCeil (85)", () => {
  const a = deriveAbilities({}, rider(CALIBRATION.pcmCeil));
  for (const ability of Object.keys(PRIMARY_STAT)) {
    assert.equal(a[ability], 99, `${ability} ved stat 85 = ${a[ability]}, forventet 99`);
  }
});

test("stats uden for [50,85] clampes (40 → 1, 92 → 99)", () => {
  const lo = deriveAbilities({}, rider(40));
  const hi = deriveAbilities({}, rider(92));
  assert.equal(lo.climbing, 1);
  assert.equal(hi.climbing, 99);
});

// ── Bounds ────────────────────────────────────────────────────────────────────

test("alle abilities ∈ [1,99] for bredt stat-spænd", () => {
  for (const s of [40, 50, 55, 60, 67, 72, 80, 85, 90]) {
    const a = deriveAbilities({}, rider(s));
    for (const k of ALL_ABILITY_KEYS) {
      assert.ok(Number.isInteger(a[k]) && a[k] >= 1 && a[k] <= 99, `${k}=${a[k]} ved stat ${s}`);
    }
  }
});

// ── Specialisering (§1.1): kommer GRATIS fra skæve PCM-stats ───────────────────

test("sprinter-stats: sprint ≫ climbing; klatrer-stats: climbing ≫ sprint", () => {
  const spr = deriveAbilities({}, rider(55, { stat_sp: 84, stat_acc: 84, stat_bj: 55 }));
  const clb = deriveAbilities({}, rider(55, { stat_bj: 84, stat_kb: 82, stat_sp: 55 }));
  assert.ok(spr.sprint - spr.climbing > 40, `sprinter sprint(${spr.sprint}) ikke ≫ climbing(${spr.climbing})`);
  assert.ok(clb.climbing - clb.sprint > 40, `klatrer climbing(${clb.climbing}) ikke ≫ sprint(${clb.sprint})`);
});

// ── acceleration ≠ flad sprint (ejer-feedback): klatrer kan accelerere ─────────

test("klatrer med høj acc-stat, lav sprint-stat: acceleration ≫ sprint", () => {
  const climber = deriveAbilities({}, rider(58, { stat_acc: 78, stat_sp: 56 }));
  assert.ok(climber.acceleration > climber.sprint + 20,
    `acceleration(${climber.acceleration}) skal være ≫ sprint(${climber.sprint})`);
});

// ── Acceleration-mapping er korrekt koblet til stat_acc (ikke stat_sp) ─────────

test("hver disciplin-evne følger sin egen primær-stat", () => {
  for (const [ability, stat] of Object.entries(PRIMARY_STAT)) {
    const high = deriveAbilities({}, rider(55, { [stat]: 84 }));
    const low = deriveAbilities({}, rider(55, { [stat]: 52 }));
    assert.ok(high[ability] > low[ability], `${ability} følger ikke ${stat}`);
  }
});

// ── Alders-effekt: erfaring driver tactics, ungdom driver hidden_potential ─────

test("ældre rytter har højere tactics; yngre har højere hidden_potential", () => {
  const young = deriveAbilities({}, rider(60, { birthdate: "2005-01-01", potentiale: 6 }));
  const old = deriveAbilities({}, rider(60, { birthdate: "1992-01-01", potentiale: 6 }));
  assert.ok(old.tactics > young.tactics, `tactics: old ${old.tactics} ikke > young ${young.tactics}`);
  assert.ok(young.hidden_potential > old.hidden_potential, `hidden: young ${young.hidden_potential} ikke > old ${old.hidden_potential}`);
});
