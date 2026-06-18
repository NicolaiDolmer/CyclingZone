#!/usr/bin/env node
// READ-ONLY (#1487): hvor mange ryttere i populationen ligger under et givet
// top-evne-loft? Bestemmer om der er nok "svage" ryttere til at fylde alle
// start-trupper hvis vi indfører et evne-loft.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFictionalPopulationPreview } from "../../lib/fictionalPopulationPreview.js";
import { LAUNCH_POPULATION } from "../../lib/fictionalLaunchPopulation.js";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "../../lib/riderValuationModel.json"), "utf8"));

for (const seed of [2026, 7, 42]) {
  const { riders } = buildFictionalPopulationPreview({ count: LAUNCH_POPULATION.count, seed, referenceYear: 2026, baseline, model });
  const topAbil = riders.map((r) => Math.max(...VISIBLE_ABILITIES.map((k) => r.abilities[k])));
  const ceilings = [10, 15, 20, 25, 30, 40, 50];
  console.log(`seed ${seed}: antal ryttere med top-evne <= loft (pop ${riders.length}; skal bruge 160 til 20 hold):`);
  for (const c of ceilings) {
    const n = topAbil.filter((t) => t <= c).length;
    console.log(`   <= ${String(c).padStart(2)}:  ${String(n).padStart(4)}`);
  }
  console.log("");
}
