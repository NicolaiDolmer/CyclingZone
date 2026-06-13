/**
 * computeYouthBaseValue.js — offline empirisk beregning af raw youth base_value (#1308 Task 9).
 *
 * Genererer en repræsentativ youth-kohort via generateAcademyCandidates (som
 * relaunch-orchestratoren gør det), kører den ægte pipeline:
 *   stats → seedPhysiologyFromLegacy → deriveAbilities → computeRiderTypes → predictBaseValue
 * INGEN DB-kald — 100% pure functions.
 *
 * Bruges til at erstatte det hårde 160.000-gæt i academyEconomySimulation.js.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { generateAcademyCandidates } from "../../lib/academyGenerator.js";
import { seedPhysiologyFromLegacy } from "../../lib/physiologySeeding.js";
import { deriveAbilities } from "../../lib/abilityDerivation.js";
import { computeRiderTypes } from "../../lib/riderTypes.js";
import { predictBaseValue } from "../../lib/riderValuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = join(__dirname, "../../lib/riderValuationModel.json");
const BASELINE_PATH = join(__dirname, "../../lib/riderTypesBaseline.json");

const model = JSON.parse(readFileSync(MODEL_PATH, "utf8"));
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

// Generer 20 kuld à 3-5 kandidater = ca. 60-100 per run; med 8 seeds à 50 kuld = 400+ total.
// Vi bruger 50 kuld med seed 1308+i.
const KULD_COUNT = 50;
const REF_YEAR = 2026;

const allResults = [];   // { is_serious, base_value }

for (let i = 0; i < KULD_COUNT; i++) {
  const rng = makeRng(1308 + i * 7);
  const candidates = generateAcademyCandidates({
    rng,
    referenceYear: REF_YEAR,
    existingNames: new Set(),
    identityBasis: null,
  });

  for (const { is_serious, rider } of candidates) {
    // Sæt manglende felter som relaunch-orchestratoren ville (height/weight defaults)
    const riderRow = {
      ...rider,
      id: `youth-${i}-${allResults.length}`,
      height: rider.height ?? 180,
      weight: rider.weight ?? 70,
    };

    // Pipeline trin 1: physiology (bruges kun som rider_id-bærer i abilityDerivation v2)
    const physiology = seedPhysiologyFromLegacy(riderRow);

    // Pipeline trin 2: abilities fra stats
    const abilities = deriveAbilities(physiology, riderRow);

    // Pipeline trin 3: primary_type (kræves af base_value-modellen)
    const { primary } = computeRiderTypes(abilities, baseline);
    riderRow.primary_type = primary.key;

    // Pipeline trin 4: base_value via den ægte valueringsmodel (v3)
    const bv = predictBaseValue(riderRow, abilities, model);
    if (bv != null) {
      allResults.push({ is_serious, base_value: bv });
    }
  }
}

// ── Statistik ────────────────────────────────────────────────────────────────
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (frac) => sorted[Math.min(n - 1, Math.floor(frac * n))];
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  return {
    n,
    min: sorted[0],
    p25: p(0.25),
    median: p(0.50),
    p75: p(0.75),
    p90: p(0.90),
    max: sorted[n - 1],
    mean: Math.round(mean),
  };
}

const allBV = allResults.map((r) => r.base_value);
const seriousBV = allResults.filter((r) => r.is_serious).map((r) => r.base_value);
const nonSeriousBV = allResults.filter((r) => !r.is_serious).map((r) => r.base_value);

const fmt = (n) => n.toLocaleString("da-DK");

const allStats = stats(allBV);
const serStats = stats(seriousBV);
const nonStats = stats(nonSeriousBV);

console.log("=== Empirisk youth base_value (offline, model v3, #1308 Task 9) ===");
console.log(`Kohort: ${allResults.length} ryttere (${KULD_COUNT} kuld, seeds 1308…)`);
console.log();
console.log("ALLE RAW YOUTHS (16-21):");
console.log(`  n=${allStats.n}  min=${fmt(allStats.min)}  p25=${fmt(allStats.p25)}  median=${fmt(allStats.median)}  p75=${fmt(allStats.p75)}  p90=${fmt(allStats.p90)}  max=${fmt(allStats.max)}  mean=${fmt(allStats.mean)}`);
console.log();
console.log("SERIOUS (is_serious=true, potentiale 4.5-6.0, statMean=58):");
console.log(`  n=${serStats.n}  min=${fmt(serStats.min)}  p25=${fmt(serStats.p25)}  median=${fmt(serStats.median)}  p75=${fmt(serStats.p75)}  p90=${fmt(serStats.p90)}  max=${fmt(serStats.max)}  mean=${fmt(serStats.mean)}`);
console.log();
console.log("NON-SERIOUS (is_serious=false, potentiale 2.0-4.5, statMean=52):");
console.log(`  n=${nonStats.n}  min=${fmt(nonStats.min)}  p25=${fmt(nonStats.p25)}  median=${fmt(nonStats.median)}  p75=${fmt(nonStats.p75)}  p90=${fmt(nonStats.p90)}  max=${fmt(nonStats.max)}  mean=${fmt(nonStats.mean)}`);
console.log();

// Vigtigt: primary_type-fordeling
const typeCount = {};
for (const { is_serious, base_value } of allResults) {
  // (vi har ikke type gemt — det gør vi ikke brug af her)
}

console.log("OUTPUT (til brug i academyEconomySimulation.js):");
console.log(`  ALLE:          median = ${fmt(allStats.median)}  (p25=${fmt(allStats.p25)}, p75=${fmt(allStats.p75)})`);
console.log(`  SERIOUS:       median = ${fmt(serStats.median)}`);
console.log(`  NON-SERIOUS:   median = ${fmt(nonStats.median)}`);
console.log();
console.log("JSON (maskinlæsbar):");
console.log(JSON.stringify({ all: allStats, serious: serStats, nonSerious: nonStats }, null, 2));
