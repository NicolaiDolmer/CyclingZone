import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LAUNCH_POPULATION, generateLaunchPopulation } from "./fictionalLaunchPopulation.js";
import { deriveAbilities } from "./abilityDerivation.js";
import { computeRiderTypes } from "./riderTypes.js";
import { predictBaseValue } from "./riderValuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(__dirname, "./riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "./riderValuationModel.json"), "utf8"));

test("launch-population er den låste skala (800) og deterministisk", () => {
  const a = generateLaunchPopulation();
  const b = generateLaunchPopulation();
  assert.equal(a.riders.length, LAUNCH_POPULATION.count);
  assert.equal(a.riders.length, 800);
  assert.deepEqual(a.riders, b.riders); // samme låste seed → identisk
});

// Chain-integration: kør HELE værdi-kæden (som prod-backfillsne) og lås
// pyramide-formen. Fanger hvis en generator-/model-/baseline-ændring senere
// bryder den ejer-godkendte kalibrering. Bounds er bevidst løse (±) så
// seed-/refit-varians ikke giver falske fejl, men breakage fanges.
//
// Design-pyramiden (ejer-godkendt 7/6, re-tunet mod værdimodel v3 i #1194):
// 12 superstjerner (≥8M) / 60 stjerner (1–8M) / 230 solide (200k–1M) /
// 500 domestikker (<200k). Faktisk ved seed 2026: 12/68/203/517, max ~24M.
test("hele værdi-kæden giver den godkendte launch-pyramide", () => {
  const { riders } = generateLaunchPopulation();
  let superstar = 0, star = 0, solid = 0, domestique = 0, withType = 0;
  let maxValue = 0;
  const typeSet = new Set();
  for (let i = 0; i < riders.length; i++) {
    const riderRow = { ...riders[i], id: `fic-test-${i}` };
    const abilities = deriveAbilities({}, riderRow, { asOfYear: LAUNCH_POPULATION.referenceYear });
    const { primary } = computeRiderTypes(abilities, baseline);
    typeSet.add(primary.key);
    const bv = predictBaseValue({ ...riderRow, primary_type: primary.key }, abilities, model);
    assert.ok(bv != null && bv >= 1, "hver rytter skal kunne værdisættes");
    if (primary.key) withType++;
    if (bv >= 8_000_000) superstar++;
    else if (bv >= 1_000_000) star++;
    else if (bv >= 200_000) solid++;
    else domestique++;
    if (bv > maxValue) maxValue = bv;
  }
  assert.equal(withType, 800, "alle ryttere får en type via kæden");
  // Smal top: ~12 superstjerner (ikke 0, ikke et helt felt).
  assert.ok(superstar >= 8 && superstar <= 18, `superstjerner=${superstar} uden for [8,18]`);
  // Midten skal bære auktioner og starthold (var hhv. 22/84 før #1194-re-tune).
  assert.ok(star >= 40 && star <= 90, `stjerner=${star} uden for [40,90]`);
  assert.ok(solid >= 160 && solid <= 280, `solide=${solid} uden for [160,280]`);
  // Bred bund: størstedelen er domestikker (<200k).
  assert.ok(domestique >= 450 && domestique <= 650, `domestikker=${domestique} uden for [450,650]`);
  // v3-gevinst bevaret: ingen urealistiske outliers over toppen af design-skalaen.
  assert.ok(maxValue <= 40_000_000, `max base_value=${maxValue} over 40M-loftet`);
  // Alle 9 typer skal emergere fra kæden (etape-variation).
  assert.equal(typeSet.size, 9, `kun ${typeSet.size}/9 typer emergerede: ${[...typeSet].join(",")}`);
});
