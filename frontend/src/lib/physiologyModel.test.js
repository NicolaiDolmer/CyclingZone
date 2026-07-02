import { test } from "node:test";
import assert from "node:assert/strict";
import {
  criticalPower, powerDurationCurve, cogganZones, CURVE_POINTS, WATT_PROFILE_KEYS,
} from "./physiologyModel.js";

// Ayoub Cherif — ægte prod-fysiologi (2026-06-30), brugt som realistisk fixture.
const AYOUB = {
  ftp_watts: 406, ftp_wkg: 4.95, vo2max_power_wkg: 5.93, zone2_power_wkg: 3.36,
  pmax_watts: 1620, power_5s_wkg: 18.18, power_15s_wkg: 13.56, power_1m_wkg: 9.49,
  power_5m_wkg: 6.47, high_intensity_energy_kj: 21.3, weight_kg: 82,
};

const closeTo = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("criticalPower forankrer CP så modellen rammer FTP ved 60 min", () => {
  const cp = criticalPower(AYOUB);
  // CP = 406 − 21300/3600 = 400.08 → 400
  assert.equal(cp.cpWatts, 400);
  assert.equal(cp.wPrimeKj, 21.3);
});

test("criticalPower returnerer null hvis FTP eller W′ mangler", () => {
  assert.equal(criticalPower({ ftp_watts: 400 }), null);
  assert.equal(criticalPower({ high_intensity_energy_kj: 20 }), null);
  assert.equal(criticalPower(null), null);
});

test("powerDurationCurve har 7 punkter, monoton ikke-stigende, FTP-anker", () => {
  const curve = powerDurationCurve(AYOUB);
  assert.equal(curve.length, 7);
  assert.deepEqual(curve.map((p) => p.key), CURVE_POINTS.map((p) => p.key));
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].watts <= curve[i - 1].watts, `punkt ${curve[i].key} steg`);
  }
  closeTo(curve[0].watts, 18.18 * 82); // 5s = målt W/kg × vægt
  assert.equal(curve.at(-1).watts, 406); // FTP = lagret ftp_watts
});

test("powerDurationCurve afleder 10/20min mellem 5min og FTP", () => {
  const curve = powerDurationCurve(AYOUB);
  const by = Object.fromEntries(curve.map((p) => [p.key, p.watts]));
  assert.ok(by["10m"] < by["5m"] && by["10m"] > by["ftp"]);
  assert.ok(by["20m"] < by["10m"] && by["20m"] > by["ftp"]);
  closeTo(by["10m"], 400 + 21300 / 600); // CP + W′/600
});

test("powerDurationCurve bevarer FTP-ankeret selv hvis et målt punkt ligger under FTP (anomali)", () => {
  // power_5m_wkg=4.0 × 82 = 328 W < FTP 406 → uden FTP-gulvet ville hele halen +
  // FTP-punktet falde til 328. Gulvet holder FTP = lagret ftp_watts.
  const curve = powerDurationCurve({ ...AYOUB, power_5m_wkg: 4.0 });
  assert.equal(curve.at(-1).watts, 406);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i].watts <= curve[i - 1].watts);
  for (const p of curve) assert.ok(p.watts >= 406);
});

test("powerDurationCurve returnerer null ved manglende vægt/FTP", () => {
  assert.equal(powerDurationCurve({ ...AYOUB, weight_kg: null }), null);
  assert.equal(powerDurationCurve({ ...AYOUB, ftp_watts: null }), null);
});

test("cogganZones afleder Z1–Z7 watt-grænser fra FTP", () => {
  const zones = cogganZones(406);
  assert.equal(zones.length, 7);
  const z4 = zones.find((z) => z.z === "Z4");
  assert.equal(z4.loWatts, Math.round(406 * 0.91)); // 369
  assert.equal(z4.hiWatts, Math.round(406 * 1.05)); // 426
  assert.equal(cogganZones(0).length, 0);
  assert.equal(cogganZones(null).length, 0);
});

test("WATT_PROFILE_KEYS er en delmængde af kurvens nøgler", () => {
  const curveKeys = new Set(CURVE_POINTS.map((p) => p.key));
  for (const k of WATT_PROFILE_KEYS) assert.ok(curveKeys.has(k), `ukendt profil-nøgle ${k}`);
});
