#!/usr/bin/env node
// READ-ONLY (#1487): hvad er det reelle gulv for top-evne i populationen, og
// hvad driver det? Viser de 8 svageste ryttere + deres top-evner.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFictionalPopulationPreview } from "../../lib/fictionalPopulationPreview.js";
import { LAUNCH_POPULATION } from "../../lib/fictionalLaunchPopulation.js";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "../../lib/riderValuationModel.json"), "utf8"));

const { riders } = buildFictionalPopulationPreview({ count: LAUNCH_POPULATION.count, seed: 2026, referenceYear: 2026, baseline, model });
const withTop = riders.map((r) => ({ r, top: Math.max(...VISIBLE_ABILITIES.map((k) => r.abilities[k])) }));
withTop.sort((a, b) => a.top - b.top);
console.log("8 SVAGESTE ryttere (laveste top-evne) — seed 2026:");
console.log("  navn                  tier        type           top-evne   alle synlige evner (1-99)");
for (const { r, top } of withTop.slice(0, 8)) {
  const all = VISIBLE_ABILITIES.map((k) => r.abilities[k]).join(",");
  console.log(`  ${r.name.padEnd(22)}${(r.tier || "").padEnd(12)}${r.primary_type.padEnd(14)} ${String(top).padStart(4)}      [${all}]`);
}
