#!/usr/bin/env node
// Diagnose 2: bootstrap rammer arketypen 82,6 % ved ungdoms-realistiske stats, men den
// ENDELIGE type (klassificeret mod ability_caps + riderTypesBaseline.json) rammer kun
// ~26 %. Typen flytter sig altså EFTER caps-bygningen. Hvorhen, og hvorfor?
//
// Mistanke: riderTypesBaseline.json er fittet over VOKSEN-populationens ability_caps
// (8.301 prod-ryttere, #3325). Ungdoms-caps ligger langt under den fordeling, så ALLE
// z-scores bliver stærkt negative. I kontrast-formlen (score = snit(positive z) −
// snit(negative z)) giver stærkt negative z'er en STRUKTUREL bonus til typer med mange/
// tunge NEGATIVE vægte: negAvg ≈ −2 → score = posAvg + 2. Er det rigtigt, vinder
// tt/sprinter/rouleur systematisk uanset anlæg — og ingen stat-tuning kan rette det.
//
//   node scripts/diagCapsClassification3458.js [--boost=2] [--ceil=60] [--n=1200]

import { generateAcademyCandidates, YOUTH_GEN_CONFIG } from "../lib/academyGenerator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildCapsForRider } from "../lib/riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE, RIDER_TYPES, RIDER_TYPE_KEYS, ABILITY_KEYS } from "../lib/riderTypes.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesBaseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}
const BOOST = parseFloat(arg("boost", "2"));
const CEIL = parseInt(arg("ceil", "60"), 10);
const N = parseInt(arg("n", "1200"), 10);

const cfg = Object.freeze({ ...YOUTH_GEN_CONFIG, signatureBoostPerWeight: BOOST, statCeilBoosted: CEIL });
const rng = makeRng(2026);
const candidates = generateAcademyCandidates({ rng, referenceYear: 2026, existingNames: new Set(), countOverride: N, genCfg: cfg });

const rows = candidates.map((c, i) => {
  const riderRow = { id: `diag-${i}`, ...c.rider };
  const abilities = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
  const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
  const age = ageForSeason(riderRow.birthdate, 1);
  const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale, age }, bootstrap.primary.key, bootstrap.secondary.key);
  const final = computeRiderTypes(caps, typesBaseline);
  return { draw: c.archetypeDraw, caps, bootstrapPrimary: bootstrap.primary.key, finalPrimary: final.primary.key, pot: riderRow.potentiale };
});

console.log(`=== Caps-klassifikations-diagnose (boost=${BOOST}, loft=${CEIL}, n=${N}) ===\n`);

// 1) Hvor mange bevarer bootstrap-typen gennem caps?
const kept = rows.filter((r) => r.finalPrimary === r.bootstrapPrimary).length;
console.log(`Endelig type == bootstrap-type: ${Math.round((kept / rows.length) * 1000) / 10} %\n`);

// 2) Hvor flytter de hen?
const finalDist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
for (const r of rows) finalDist[r.finalPrimary]++;
console.log("Endelig type-fordeling (mod voksen-fittet riderTypesBaseline):");
for (const t of RIDER_TYPE_KEYS) {
  const pct = Math.round((finalDist[t] / rows.length) * 1000) / 10;
  console.log(`  ${t.padEnd(16)} ${String(pct).padStart(6)} %  ${"█".repeat(Math.round(pct / 2))}`);
}

// 3) z-score-niveauet: ligger ungdoms-caps under voksen-baseline?
console.log(`\nz-score for ungdoms-caps mod den VOKSEN-fittede baseline (gennemsnit over kuldet):`);
const zSums = Object.fromEntries(ABILITY_KEYS.map((a) => [a, 0]));
for (const r of rows) {
  for (const a of ABILITY_KEYS) {
    const mean = typesBaseline?.mean?.[a] ?? 0;
    const std = typesBaseline?.std?.[a] || 1;
    zSums[a] += ((Number(r.caps[a]) || 0) - mean) / std;
  }
}
for (const a of ABILITY_KEYS) {
  const z = Math.round((zSums[a] / rows.length) * 100) / 100;
  console.log(`  ${a.padEnd(14)} z=${String(z).padStart(7)}   (voksen-mean ${Math.round(typesBaseline?.mean?.[a] ?? 0)})`);
}

// 4) Den strukturelle bias: negativ-vægt-sum pr. type vs. hvor ofte den vinder
console.log(`\nStRUKTUREL BIAS-TEST — type-vægtenes negative sum vs. vunden andel:`);
console.log(`  ${"type".padEnd(16)} ${"neg.vægt".padStart(9)} ${"vundet %".padStart(9)}`);
const negWeightByType = Object.fromEntries(
  RIDER_TYPES.map((t) => [t.key, Object.values(t.weights).filter((w) => w < 0).reduce((s, w) => s + -w, 0)])
);
const ranked = RIDER_TYPE_KEYS
  .map((t) => ({ t, neg: negWeightByType[t], pct: Math.round((finalDist[t] / rows.length) * 1000) / 10 }))
  .sort((a, b) => b.pct - a.pct);
for (const r of ranked) console.log(`  ${r.t.padEnd(16)} ${String(r.neg).padStart(9)} ${String(r.pct).padStart(9)}`);
