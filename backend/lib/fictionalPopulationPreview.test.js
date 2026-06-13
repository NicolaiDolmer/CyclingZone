import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFictionalPopulationPreview } from "./fictionalPopulationPreview.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "riderValuationModel.json"), "utf8"));

test("buildFictionalPopulationPreview: antal, felter, deterministisk", () => {
  const a = buildFictionalPopulationPreview({ count: 50, seed: 2026, baseline, model });
  assert.equal(a.riders.length, 50);
  const r = a.riders[0];
  for (const k of ["name", "age", "nationality_code", "primary_type", "secondary_type", "abilities", "base_value"]) {
    assert.ok(k in r, `mangler felt ${k}`);
  }
  assert.equal(typeof r.base_value, "number");
  assert.ok(r.base_value > 0);
  assert.equal(typeof r.abilities.climbing, "number");
  const b = buildFictionalPopulationPreview({ count: 50, seed: 2026, baseline, model });
  assert.deepEqual(a.riders.map((x) => x.base_value), b.riders.map((x) => x.base_value));
});

test("buildFictionalPopulationPreview: kræver baseline + model", () => {
  assert.throws(() => buildFictionalPopulationPreview({ count: 5 }));
});
