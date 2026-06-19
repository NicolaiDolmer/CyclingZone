#!/usr/bin/env node
// READ-ONLY analyse-harness (#1487) — kvantificér hvor stærke start-trupperne er
// vs. resten af feltet. Rører INGEN DB. Genbruger den ægte værdi-kæde
// (buildFictionalPopulationPreview) + den ægte allokator (allocateStarterSquads).
//
//   node scripts/dev/analyze-starter-squad-strength.mjs [--seed=2026] [--teams=20]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFictionalPopulationPreview } from "../../lib/fictionalPopulationPreview.js";
import { allocateStarterSquads, STARTER_SQUAD } from "../../lib/starterSquadAllocator.js";
import { generateFictionalRiders } from "../../lib/fictionalRiderGenerator.js";
import { LAUNCH_POPULATION } from "../../lib/fictionalLaunchPopulation.js";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split("=")[1] : d;
};
const SEED = parseInt(arg("seed", "2026"), 10);
const TEAMS = parseInt(arg("teams", "20"), 10);
const REFERENCE_YEAR = LAUNCH_POPULATION.referenceYear;

const baseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "../../lib/riderValuationModel.json"), "utf8"));

const { riders: rows } = buildFictionalPopulationPreview({
  count: LAUNCH_POPULATION.count, seed: SEED, referenceYear: REFERENCE_YEAR, baseline, model,
});

const byId = new Map(rows.map((r) => [r.id, r]));

// Allokatoren bruger rytterens 'potentiale' (1-6) til "ung"-filteret. Preview-rækken
// eksponerer ikke potentiale direkte, så re-generér rå population (samme seed) for det.
const { riders: raw } = generateFictionalRiders({ seed: SEED, count: LAUNCH_POPULATION.count, referenceYear: REFERENCE_YEAR });
const potById = new Map(raw.map((r, i) => [`fic-${SEED}-${i}`, r.potentiale]));

const allocPool = rows.map((r) => ({
  id: r.id,
  age: r._meta.age,
  potentiale: potById.get(r.id),
  base_value: r.base_value,
}));

const teamIds = Array.from({ length: TEAMS }, (_, i) => `team-${i + 1}`);
const { assignments, leftToMarket } = allocateStarterSquads(allocPool, teamIds, { seed: SEED });

const assignedIds = new Set(Object.values(assignments).flat());
const starterRiders = [...assignedIds].map((id) => byId.get(id));
const marketRiders = leftToMarket.map((id) => byId.get(id));

function abilitySummary(riders) {
  // Saml ALLE synlige ability-værdier på tværs af ryttere.
  const all = [];
  const perRiderMax = [];
  const perRiderMean = [];
  for (const r of riders) {
    const vals = VISIBLE_ABILITIES.map((k) => r.abilities[k]).filter(Number.isFinite);
    all.push(...vals);
    perRiderMax.push(Math.max(...vals));
    perRiderMean.push(vals.reduce((s, v) => s + v, 0) / vals.length);
  }
  const sortAsc = (a) => [...a].sort((x, y) => x - y);
  const pct = (a, p) => { const s = sortAsc(a); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    n: riders.length,
    abilityMin: Math.min(...all),
    abilityP50: pct(all, 0.5),
    abilityP90: pct(all, 0.9),
    abilityMax: Math.max(...all),
    abilityMean: mean(all).toFixed(1),
    perRiderTopAbilityMean: mean(perRiderMax).toFixed(1),
    perRiderTopAbilityMax: Math.max(...perRiderMax),
    perRiderMeanOfMeans: mean(perRiderMean).toFixed(1),
  };
}

const baseVals = (riders) => riders.map((r) => r.base_value).sort((a, b) => a - b);
const fmt = (n) => Math.round(n).toLocaleString("en-US");

console.log(`=== Start-trup-styrke analyse (#1487) — seed ${SEED}, ${TEAMS} hold ===\n`);
console.log(`Population: ${rows.length} ryttere · SQUAD_SIZE ${STARTER_SQUAD.SQUAD_SIZE} · STAR_CUTOFF ${STARTER_SQUAD.STAR_CUTOFF_FRACTION * 100}%`);
console.log(`Start-trup-ryttere: ${starterRiders.length} · Marked (resten): ${marketRiders.length}\n`);

console.log("ABILITY-SKALA = 1..99 (synlige evner). Ejer-ønske #1487: start-ryttere max ~10 (evt 15-20).\n");

const s = abilitySummary(starterRiders);
const m = abilitySummary(marketRiders);
console.log("Evne-statistik          START-TRUP     MARKED");
console.log(`  alle-evner min          ${String(s.abilityMin).padStart(6)}       ${String(m.abilityMin).padStart(6)}`);
console.log(`  alle-evner median       ${String(s.abilityP50).padStart(6)}       ${String(m.abilityP50).padStart(6)}`);
console.log(`  alle-evner p90          ${String(s.abilityP90).padStart(6)}       ${String(m.abilityP90).padStart(6)}`);
console.log(`  alle-evner max          ${String(s.abilityMax).padStart(6)}       ${String(m.abilityMax).padStart(6)}`);
console.log(`  alle-evner mean         ${String(s.abilityMean).padStart(6)}       ${String(m.abilityMean).padStart(6)}`);
console.log(`  per-rytter top-evne snit ${String(s.perRiderTopAbilityMean).padStart(5)}       ${String(m.perRiderTopAbilityMean).padStart(6)}`);
console.log(`  per-rytter top-evne max  ${String(s.perRiderTopAbilityMax).padStart(5)}       ${String(m.perRiderTopAbilityMax).padStart(6)}`);
console.log(`  per-rytter snit-evne snit ${String(s.perRiderMeanOfMeans).padStart(4)}      ${String(m.perRiderMeanOfMeans).padStart(6)}`);

const sv = baseVals(starterRiders), mv = baseVals(marketRiders);
const pctV = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
console.log("\nbase_value (CZ$)        START-TRUP        MARKED");
console.log(`  median               ${fmt(pctV(sv, 0.5)).padStart(12)}  ${fmt(pctV(mv, 0.5)).padStart(12)}`);
console.log(`  max                  ${fmt(sv[sv.length - 1]).padStart(12)}  ${fmt(mv[mv.length - 1]).padStart(12)}`);

// Hvor mange start-ryttere overskrider de ønskede lofter?
const over10 = starterRiders.filter((r) => Math.max(...VISIBLE_ABILITIES.map((k) => r.abilities[k])) > 10).length;
const over20 = starterRiders.filter((r) => Math.max(...VISIBLE_ABILITIES.map((k) => r.abilities[k])) > 20).length;
console.log(`\nStart-ryttere med top-evne > 10:  ${over10}/${starterRiders.length} (${(100 * over10 / starterRiders.length).toFixed(0)}%)`);
console.log(`Start-ryttere med top-evne > 20:  ${over20}/${starterRiders.length} (${(100 * over20 / starterRiders.length).toFixed(0)}%)`);

// Vis 5 typiske start-ryttere
console.log("\n5 typiske start-ryttere (top-3 evner):");
for (const r of starterRiders.slice(0, 5)) {
  const top3 = VISIBLE_ABILITIES.map((k) => [k, r.abilities[k]]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log(`  ${r.name.padEnd(24)} ${r.primary_type.padEnd(14)} bv ${fmt(r.base_value).padStart(10)}  ${top3}`);
}
