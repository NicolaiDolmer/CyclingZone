import { test } from "node:test";
import assert from "node:assert/strict";
import { meanPhysiology, BENCHMARK_FIELDS } from "./physiologyBenchmark.js";

test("meanPhysiology midler hvert felt over rækkerne", () => {
  const rows = [
    { ftp_watts: 280, ftp_wkg: 4.0, pmax_watts: 1200, weight_kg: 70 },
    { ftp_watts: 320, ftp_wkg: 4.4, pmax_watts: 1400, weight_kg: 74 },
  ];
  const mean = meanPhysiology(rows);
  assert.equal(mean.ftp_watts, 300);
  assert.equal(mean.ftp_wkg, 4.2);
  assert.equal(mean.pmax_watts, 1300);
  assert.equal(mean.weight_kg, 72);
});

test("meanPhysiology ignorerer ikke-numeriske værdier pr. felt", () => {
  const rows = [
    { ftp_watts: 300, vo2max_power_wkg: null },
    { ftp_watts: 400, vo2max_power_wkg: 5.0 },
  ];
  const mean = meanPhysiology(rows);
  assert.equal(mean.ftp_watts, 350); // begge tæller
  assert.equal(mean.vo2max_power_wkg, 5.0); // kun den numeriske
});

test("meanPhysiology returnerer null for tom/ugyldig input", () => {
  assert.equal(meanPhysiology([]), null);
  assert.equal(meanPhysiology(null), null);
  assert.equal(meanPhysiology(undefined), null);
});

test("meanPhysiology giver null for et felt uden numeriske værdier", () => {
  const mean = meanPhysiology([{ ftp_watts: 300 }, { ftp_watts: 300 }]);
  assert.equal(mean.ftp_watts, 300);
  assert.equal(mean.vo2max_power_wkg, null); // feltet manglede på alle rækker
});

test("meanPhysiology accepterer tal-strenge (NUMERIC fra PostgREST) men ignorerer tom-streng/boolean", () => {
  const mean = meanPhysiology([
    { ftp_wkg: "4.0", vo2max_power_wkg: "", zone2_power_wkg: true },
    { ftp_wkg: "5.0", vo2max_power_wkg: "6.0", zone2_power_wkg: 3.0 },
  ]);
  assert.equal(mean.ftp_wkg, 4.5);          // begge tal-strenge tæller
  assert.equal(mean.vo2max_power_wkg, 6.0); // "" ignoreret, kun 6.0 tæller
  assert.equal(mean.zone2_power_wkg, 3.0);  // true ignoreret, kun 3.0 tæller
});

test("BENCHMARK_FIELDS dækker de felter Fysiologi-fanen benchmarker", () => {
  for (const f of ["ftp_watts", "ftp_wkg", "vo2max_power_wkg", "zone2_power_wkg",
    "pmax_watts", "power_5s_wkg", "power_1m_wkg", "power_5m_wkg",
    "high_intensity_energy_kj", "weight_kg"]) {
    assert.ok(BENCHMARK_FIELDS.includes(f), `mangler ${f}`);
  }
});
