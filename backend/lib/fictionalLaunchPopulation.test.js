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
// INTERIM (ejer-re-godkendt 10/6-2026, værdimodel v3): generatoren er tunet mod
// v2-modellen, så pyramiden er bund-tung under v3 (6 superstjerner/688 domestikker
// mod design-målet 12/500). Båndene afspejler v3-VIRKELIGHEDEN indtil generatoren
// re-tunes mod 12/60/230/500-pyramiden (launch-kritisk follow-up i #677-sporet) —
// derefter strammes båndene igen.
test("hele værdi-kæden giver den godkendte launch-pyramide", () => {
  const { riders } = generateLaunchPopulation();
  let superstar = 0, domestique = 0, withType = 0;
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
    if (bv < 200_000) domestique++;
  }
  assert.equal(withType, 800, "alle ryttere får en type via kæden");
  // Smal top: en håndfuld superstjerner (ikke 0, ikke et helt felt).
  assert.ok(superstar >= 3 && superstar <= 25, `superstjerner=${superstar} uden for [3,25]`);
  // Bred bund: størstedelen er domestikker (<200k). INTERIM-bånd under v3 (se ovenfor).
  assert.ok(domestique >= 550 && domestique <= 750, `domestikker=${domestique} uden for [550,750]`);
  // Alle 9 typer skal emergere fra kæden (etape-variation).
  assert.equal(typeSet.size, 9, `kun ${typeSet.size}/9 typer emergerede: ${[...typeSet].join(",")}`);
});
