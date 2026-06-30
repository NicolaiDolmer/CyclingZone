#!/usr/bin/env node
// READ-ONLY simulation v2 (2026-06-30, post-incident fix) — kalibrering af AI-
// rytter-kvalitet pr. division-tier MED REALISTISK SPECIALISERING.
//
// v1 af dette script klampede ALLE 14 stat-felter ind i et smalt, højt vindue
// (samme tilgang som STARTER_POOL_STAT_WINDOW) — det gav ryttere der var gode til
// ALT samtidig (urealistisk alsidighed), hvilket værdimodellens mean-of-all-
// abilities-led belønnede voldsomt: 900 "domestique"-niveau-ryttere endte med
// gennemsnit 364k CZ$ og enkelte over 3 MIO (over Pogačar). Rullet tilbage samme
// dag (#2065-incident).
//
// v2 bruger i stedet den ÆGTE arketype-generator (fictionalRiderGenerator.js) med
// dens eksisterende styrke-TIERS (superstar/star/solid/domestique) — samme
// mekanisme der allerede genererer den fri markeds-population (de 800) med
// realistisk specialisering (høj signatur-stat, dæmpede andre) og en ALLEREDE
// kalibreret værdi-kurve. INGEN custom stat-clamping. Vi vælger blot hvilken
// tier-blanding der rammer division 1/2's mål-peak-evne.
//
// INGEN DB-skrivning, INGEN prod-mutation.
//
//   node scripts/simAiRosterTierWindows.js

import { generateFictionalRiders } from "../lib/fictionalRiderGenerator.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { predictBaseValue } from "../lib/riderValuation.js";
import { LAUNCH_POPULATION } from "../lib/fictionalLaunchPopulation.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModel.json"), "utf8"));

const PHYSICAL_ABILITIES = [
  "sprint", "acceleration", "punch", "tempo", "climbing",
  "time_trial", "flat", "endurance", "recovery", "durability",
];

function evaluate(label, tierFractions, n = 300) {
  const { riders } = generateFictionalRiders({
    seed: LAUNCH_POPULATION.seed + 9002, count: n, referenceYear: LAUNCH_POPULATION.referenceYear,
    tierFractions,
  });
  const rows = riders.map((r) => {
    const abilities = deriveAbilities({}, r);
    const { primary } = computeRiderTypes(abilities, baseline);
    const value = predictBaseValue({ primary_type: primary.key }, abilities, model) || 0;
    const peak = Math.max(...PHYSICAL_ABILITIES.map((k) => abilities[k]));
    return { peak, value };
  });
  const peaks = rows.map((r) => r.peak).sort((a, b) => a - b);
  const values = rows.map((r) => r.value).sort((a, b) => a - b);
  const pct = (sorted, p) => sorted[Math.floor(p * (sorted.length - 1))];
  const mean = (arr) => Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
  return {
    label, n,
    peak_p25: pct(peaks, 0.25), peak_median: pct(peaks, 0.5), peak_p75: pct(peaks, 0.75),
    value_p25: mean([pct(values, 0.20), pct(values, 0.30)]),
    value_median: pct(values, 0.5),
    value_p75: mean([pct(values, 0.70), pct(values, 0.80)]),
  };
}

const pad = (v, n) => String(v).padEnd(n);
const padN = (v, n) => String(v).padStart(n);

// Kandidat-blandinger: kun de øverste tiers (superstar/star udelukkes — for stærke
// til AI-fodbold-modstandere) op til ren domestique. tierFractions skal summe til
// <=1 (resten falder til domestique = #1420-kontrakt).
const CANDIDATES = [
  { label: "100% domestique (baseline)", fractions: { superstar: 0, star: 0, solid: 0 } },
  { label: "15% solid / 85% domestique", fractions: { superstar: 0, star: 0, solid: 0.15 } },
  { label: "25% solid / 75% domestique", fractions: { superstar: 0, star: 0, solid: 0.25 } },
  { label: "35% solid / 65% domestique", fractions: { superstar: 0, star: 0, solid: 0.35 } },
  { label: "50% solid / 50% domestique", fractions: { superstar: 0, star: 0, solid: 0.50 } },
  { label: "100% solid", fractions: { superstar: 0, star: 0, solid: 1 } },
];

console.log("=".repeat(110));
console.log("AI-rytter tier-blanding v2 — REALISTISK specialisering (ægte arketype-generator, ingen clamp)");
console.log("=".repeat(110));
console.log([
  pad("Label", 32), padN("n", 5),
  padN("peak p25", 9), padN("peak med", 9), padN("peak p75", 9),
  padN("CZ$ p25", 11), padN("CZ$ med", 11), padN("CZ$ p75", 11),
].join(" "));
for (const c of CANDIDATES) {
  const r = evaluate(c.label, c.fractions);
  console.log([
    pad(r.label, 32), padN(r.n, 5),
    padN(r.peak_p25, 9), padN(r.peak_median, 9), padN(r.peak_p75, 9),
    padN(r.value_p25.toLocaleString("da-DK"), 11), padN(r.value_median.toLocaleString("da-DK"), 11), padN(r.value_p75.toLocaleString("da-DK"), 11),
  ].join(" "));
}
console.log("=".repeat(110));
console.log("Mål: div1 peak ~50-65 / CZ$ ~30-165k.  div2 peak ~40-50 / CZ$ ~18-32k. (jf. ægte prod-population-buckets)");
