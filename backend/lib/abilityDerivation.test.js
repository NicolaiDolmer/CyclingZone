import test from "node:test";
import assert from "node:assert/strict";

import { deriveAbilities, buildAbilityPool, FORMULA_VERSION } from "./abilityDerivation.js";
import { seedPhysiologyFromLegacy } from "./physiologySeeding.js";

const STAT_KEYS = [
  "stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_prl", "stat_bro",
  "stat_sp", "stat_acc", "stat_ned", "stat_udh", "stat_mod", "stat_res", "stat_ftr",
];
const ABILITY_KEYS = [
  "climbing", "time_trial", "sprint", "punch", "endurance",
  "cobble_classics", "acceleration", "recovery", "tactics", "positioning",
];

function rider(stat = 50, extra = {}) {
  const r = { id: "r1", height: 180, weight: 70 };
  for (const k of STAT_KEYS) r[k] = stat;
  return { ...r, ...extra };
}

// Realistisk pool fra 40 varierede ryttere (deterministisk spredning pr. stat).
function fixture() {
  const profiles = [];
  for (let i = 0; i < 40; i++) {
    const r = { id: `p${i}`, height: 170 + (i % 30), weight: 60 + (i % 25) };
    STAT_KEYS.forEach((k, j) => { r[k] = (i * 7 + j * 13) % 100; });
    profiles.push(seedPhysiologyFromLegacy(r));
  }
  return { pool: buildAbilityPool(profiles), profiles };
}

// ── Determinisme + kontrakt ───────────────────────────────────────────────────

test("samme input → identisk output (determinisme)", () => {
  const { pool } = fixture();
  const phys = seedPhysiologyFromLegacy(rider(64));
  assert.deepEqual(deriveAbilities(phys, rider(64), { pool }), deriveAbilities(phys, rider(64), { pool }));
});

test("rider_id + formula_version sættes", () => {
  const phys = seedPhysiologyFromLegacy(rider(50, { id: "xyz" }));
  const a = deriveAbilities(phys, rider(50, { id: "xyz" }), {});
  assert.equal(a.rider_id, "xyz");
  assert.equal(a.formula_version, FORMULA_VERSION);
});

// ── Bounds ────────────────────────────────────────────────────────────────────

test("alle abilities ∈ [0,99] for hele pool + ekstremer", () => {
  const { pool, profiles } = fixture();
  const extremes = [
    deriveAbilities(seedPhysiologyFromLegacy(rider(0)), rider(0), { pool }),
    deriveAbilities(seedPhysiologyFromLegacy(rider(99)), rider(99), { pool }),
    deriveAbilities(seedPhysiologyFromLegacy(rider(50)), rider(50), {}), // ingen pool
  ];
  const all = [...profiles.map((p) => deriveAbilities(p, rider(50), { pool })), ...extremes];
  for (const a of all) {
    for (const k of ABILITY_KEYS) {
      assert.ok(Number.isInteger(a[k]) && a[k] >= 0 && a[k] <= 99, `${k}=${a[k]}`);
    }
  }
});

test("manglende pool → neutrale (percentil 0.5) abilities, kaster ikke", () => {
  const phys = seedPhysiologyFromLegacy(rider(50));
  const a = deriveAbilities(phys, rider(50)); // ingen opts
  for (const k of ABILITY_KEYS) assert.ok(a[k] >= 0 && a[k] <= 99);
});

// ── Monotoni mod FAST pool (percentil vokser med metrikken) ───────────────────

function sweepPhys(field, lo, hi, stepN, ability) {
  const { pool } = fixture();
  const base = seedPhysiologyFromLegacy(rider(50));
  let prev = -1;
  for (let i = 0; i <= stepN; i++) {
    const v = lo + ((hi - lo) * i) / stepN;
    const phys = { ...base, [field]: v };
    const out = deriveAbilities(phys, rider(50), { pool })[ability];
    assert.ok(out >= prev, `${ability} faldt da ${field}=${v.toFixed(2)} (${out} < ${prev})`);
    prev = out;
  }
}

test("climbing monoton i ftp_wkg", () => sweepPhys("ftp_wkg", 3.0, 6.8, 19, "climbing"));
test("sprint monoton i pmax_watts", () => sweepPhys("pmax_watts", 800, 2000, 24, "sprint"));
test("endurance monoton i zone2_power_wkg", () => sweepPhys("zone2_power_wkg", 1.8, 5.1, 20, "endurance"));
test("recovery monoton i recovery_rate", () => sweepPhys("recovery_rate", 0.4, 0.95, 20, "recovery"));
test("punch monoton i power_1m_wkg", () => sweepPhys("power_1m_wkg", 7.0, 11.5, 20, "punch"));

// ── Percentil-skalering: ekstrem-rytter rangerer over svag rytter ─────────────

test("rytter med høj physiology slår svag rytter på relevante abilities", () => {
  const { pool } = fixture();
  const strong = deriveAbilities(seedPhysiologyFromLegacy(rider(95)), rider(95), { pool });
  const weak = deriveAbilities(seedPhysiologyFromLegacy(rider(10)), rider(10), { pool });
  for (const k of ["climbing", "sprint", "endurance", "punch", "time_trial"]) {
    assert.ok(strong[k] > weak[k], `${k}: strong ${strong[k]} ikke > weak ${weak[k]}`);
  }
});

// ── Letvægts-fordel i klatring, tungvægts-fordel på brosten ───────────────────

test("lettere rytter klatrer bedre, tungere er bedre på brosten (alt andet lige)", () => {
  const { pool } = fixture();
  const phys = seedPhysiologyFromLegacy(rider(60));
  const light = deriveAbilities({ ...phys, weight_kg: 58 }, rider(60), { pool });
  const heavy = deriveAbilities({ ...phys, weight_kg: 86 }, rider(60), { pool });
  assert.ok(light.climbing >= heavy.climbing, `climbing: light ${light.climbing} < heavy ${heavy.climbing}`);
  assert.ok(heavy.cobble_classics >= light.cobble_classics, `cobbles: heavy ${heavy.cobble_classics} < light ${light.cobble_classics}`);
});
