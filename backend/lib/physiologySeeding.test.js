import test from "node:test";
import assert from "node:assert/strict";

import { seedPhysiologyFromLegacy, FORMULA_VERSION, DEFAULTS } from "./physiologySeeding.js";

const STAT_KEYS = [
  "stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_prl", "stat_bro",
  "stat_sp", "stat_acc", "stat_ned", "stat_udh", "stat_mod", "stat_res", "stat_ftr",
];

// Rytter med ens stat-niveau + krop. id default sat så rider_id er forudsigeligt.
function rider(stat = 50, extra = {}) {
  const r = { id: "r1", height: 180, weight: 70 };
  for (const k of STAT_KEYS) r[k] = stat;
  return { ...r, ...extra };
}

// ── Determinisme ──────────────────────────────────────────────────────────────

test("samme input → identisk output (determinisme)", () => {
  assert.deepEqual(seedPhysiologyFromLegacy(rider(73)), seedPhysiologyFromLegacy(rider(73)));
});

test("rider_id, source og version sættes", () => {
  const p = seedPhysiologyFromLegacy(rider(50, { id: "abc" }));
  assert.equal(p.rider_id, "abc");
  assert.equal(p.source, "seeded_from_legacy");
  assert.equal(p.version, FORMULA_VERSION);
});

// ── Null/manglende data → defaults ────────────────────────────────────────────

test("manglende stats + krop → DEFAULTS anvendes", () => {
  // Tom rytter (kun id) skal matche en rytter med alle stats = DEFAULTS.stat + default-krop.
  const bare = seedPhysiologyFromLegacy({ id: "r1" });
  const explicit = seedPhysiologyFromLegacy(rider(DEFAULTS.stat, {
    height: DEFAULTS.height_cm, weight: DEFAULTS.weight_kg,
  }));
  assert.deepEqual(bare, explicit);
});

test("null height/weight → default-krop, ikke NaN", () => {
  const p = seedPhysiologyFromLegacy(rider(50, { height: null, weight: null }));
  assert.equal(p.height_cm, DEFAULTS.height_cm);
  assert.equal(p.weight_kg, DEFAULTS.weight_kg);
  assert.ok(Number.isFinite(p.ftp_watts));
  assert.ok(Number.isFinite(p.pmax_watts));
});

// ── Ranges + power-duration invariant ─────────────────────────────────────────

function eachProfile(fn) {
  const levels = [0, 1, 25, 50, 75, 99];
  // Uniforme niveauer + et par skæve kombinationer (ekstrem klatrer/sprinter).
  const skew = [
    rider(50, { stat_bj: 99, stat_kb: 99, stat_udh: 99, stat_res: 99, stat_bk: 0, stat_sp: 0 }),
    rider(50, { stat_sp: 99, stat_acc: 99, stat_bj: 0, stat_udh: 0 }),
    rider(50, { stat_tt: 99, stat_bk: 0 }),
  ];
  for (const lv of levels) fn(seedPhysiologyFromLegacy(rider(lv)));
  for (const r of skew) fn(seedPhysiologyFromLegacy(r));
}

test("alle felter ligger i ADR-ranges", () => {
  eachProfile((p) => {
    assert.ok(p.ftp_wkg >= 3.0 && p.ftp_wkg <= 6.8, `ftp_wkg ${p.ftp_wkg}`);
    assert.ok(p.vo2max_power_wkg >= 4.2 && p.vo2max_power_wkg <= 7.5, `vo2max ${p.vo2max_power_wkg}`);
    assert.ok(p.high_intensity_energy_kj >= 10 && p.high_intensity_energy_kj <= 30, `hie ${p.high_intensity_energy_kj}`);
    assert.ok(p.time_to_exhaustion_ftp_min >= 30 && p.time_to_exhaustion_ftp_min <= 75, `tte ${p.time_to_exhaustion_ftp_min}`);
    assert.ok(p.fatigue_resistance >= 0.4 && p.fatigue_resistance <= 0.95, `fatigue ${p.fatigue_resistance}`);
    assert.ok(p.recovery_rate >= 0.4 && p.recovery_rate <= 0.95, `recovery ${p.recovery_rate}`);
    assert.ok(p.ftp_watts > 0 && p.pmax_watts > 0);
  });
});

test("power-duration invariant: 5s ≥ 15s ≥ 1m ≥ 5m ≥ ftp ≥ zone2, og vo2max ≥ ftp", () => {
  eachProfile((p) => {
    assert.ok(p.power_5s_wkg >= p.power_15s_wkg, `5s≥15s (${p.power_5s_wkg},${p.power_15s_wkg})`);
    assert.ok(p.power_15s_wkg >= p.power_1m_wkg, `15s≥1m (${p.power_15s_wkg},${p.power_1m_wkg})`);
    assert.ok(p.power_1m_wkg >= p.power_5m_wkg, `1m≥5m (${p.power_1m_wkg},${p.power_5m_wkg})`);
    assert.ok(p.power_5m_wkg >= p.ftp_wkg, `5m≥ftp (${p.power_5m_wkg},${p.ftp_wkg})`);
    assert.ok(p.ftp_wkg >= p.zone2_power_wkg, `ftp≥zone2 (${p.ftp_wkg},${p.zone2_power_wkg})`);
    assert.ok(p.vo2max_power_wkg >= p.ftp_wkg, `vo2max≥ftp (${p.vo2max_power_wkg},${p.ftp_wkg})`);
  });
});

// ── Monotoni (primær driver hæver aldrig sænker sin ability) ──────────────────

function sweep(statKey, field) {
  let prev = -Infinity;
  for (let v = 0; v <= 99; v += 11) {
    const out = seedPhysiologyFromLegacy(rider(50, { [statKey]: v }))[field];
    assert.ok(out >= prev - 1e-9, `${field} faldt da ${statKey}=${v} (${out} < ${prev})`);
    prev = out;
  }
}

test("højere stat_bj sænker aldrig ftp_wkg", () => sweep("stat_bj", "ftp_wkg"));
test("højere stat_sp sænker aldrig power_5s_wkg", () => sweep("stat_sp", "power_5s_wkg"));
test("højere stat_res sænker aldrig fatigue_resistance", () => sweep("stat_res", "fatigue_resistance"));
test("højere stat_tt sænker aldrig time_to_exhaustion_ftp_min", () => sweep("stat_tt", "time_to_exhaustion_ftp_min"));
test("højere stat_udh sænker aldrig zone2_power_wkg", () => sweep("stat_udh", "zone2_power_wkg"));
