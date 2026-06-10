// Tests for valuationScorecard.js — ren kerne bag scripts/valuationScorecard.js (#1196).
import test from "node:test";
import assert from "node:assert/strict";

import {
  PYRAMID_BANDS,
  percentile,
  bandCounts,
  riderAge,
  anchorSupportDistance,
  buildOutlierRows,
  fmtCZ,
} from "./valuationScorecard.js";

test("percentile: interpolationsfrit indeks-opslag på sorteret array", () => {
  const vals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(vals, 0), 10);
  assert.equal(percentile(vals, 0.5), 60); // floor(0.5*10)=5 → 60
  assert.equal(percentile(vals, 0.99), 100);
  assert.equal(percentile(vals, 1), 100); // klampes til sidste element
  assert.equal(percentile([], 0.5), null);
});

test("bandCounts: tæller i #1194-pyramide-båndene (grænser: >=8M, 1-8M, 200k-1M, <200k)", () => {
  const values = [
    9_000_000, 8_000_000, // superstjerne (>=8M, inkl. grænsen)
    7_999_999, 1_000_000, // stjerne (1M-8M, inkl. nedre grænse)
    999_999, 200_000,     // solid (200k-1M, inkl. nedre grænse)
    199_999, 1,           // domestik (<200k)
  ];
  const counts = bandCounts(values);
  assert.deepEqual(counts, { superstjerne: 2, stjerne: 2, solid: 2, domestik: 2 });
  // Båndene skal dække hele aksen uden hul/overlap.
  assert.equal(Object.values(counts).reduce((s, n) => s + n, 0), values.length);
  assert.equal(PYRAMID_BANDS.length, 4);
});

test("riderAge: helår-alder fra birthdate, null hvis ukendt", () => {
  assert.equal(riderAge("2000-06-10", new Date("2026-06-10T12:00:00Z")), 26);
  assert.equal(riderAge("2000-06-11", new Date("2026-06-10T12:00:00Z")), 25); // dagen før fødselsdag
  assert.equal(riderAge(null), null);
  assert.equal(riderAge("not-a-date"), null);
});

test("anchorSupportDistance: 0 inden for anchor-intervallet, afstand udenfor", () => {
  const range = { min: 30, max: 87 };
  assert.equal(anchorSupportDistance(50, range), 0);
  assert.equal(anchorSupportDistance(30, range), 0);
  assert.equal(anchorSupportDistance(25, range), 5);  // under bund-anchor → ekstrapoleret
  assert.equal(anchorSupportDistance(90, range), 3);  // over output_max → klampet
});

test("buildOutlierRows: top-N efter afstand uden for anchor-støtten, med retning", () => {
  const range = { min: 30, max: 87 };
  const riders = [
    { name: "Inde", output: 50, baseValue: 100 },
    { name: "Under dyb", output: 18, baseValue: 5 },
    { name: "Under let", output: 28, baseValue: 50 },
    { name: "Over", output: 92, baseValue: 9_999 },
  ];
  const rows = buildOutlierRows(riders, range, 3);
  assert.equal(rows.length, 3); // "Inde" (afstand 0) filtreres fra
  assert.deepEqual(rows.map((r) => r.name), ["Under dyb", "Over", "Under let"]);
  assert.equal(rows[0].direction, "under");
  assert.equal(rows[1].direction, "over");
});

test("fmtCZ: tusind-separeret heltal (da-DK)", () => {
  assert.equal(fmtCZ(1234567), "1.234.567");
  assert.equal(fmtCZ(0), "0");
});
