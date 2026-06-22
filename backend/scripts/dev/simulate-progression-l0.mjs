#!/usr/bin/env node
// READ-ONLY simulering (#1137) — kører passiv rytterudviklings-motoren over en
// SYNTETISK population på tværs af N sæsoner og rapporterer de 5 acceptkriterier
// med konkrete tal. Ingen DB, ingen prod — al variation er seeded (deterministisk).
//
// Brug:
//   node backend/scripts/dev/simulate-progression-l0.mjs              # default: 300 ryttere, seed 2026, 3 sæsoner
//   node backend/scripts/dev/simulate-progression-l0.mjs --seasons=5 --count=500 --seed=7
//   node backend/scripts/dev/simulate-progression-l0.mjs --verbose    # + eksemplar-trajektorier
//
// Exit-kode: 0 hvis ALLE 5 kriterier opfyldt, ellers 1 (kan gates i CI senere).

import { runHarness, simulateProgression, makeSyntheticPopulation } from "../../lib/progressionSimHarness.js";
import { PROGRESSION_CONFIG } from "../../lib/riderProgression.js";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const count = Number(arg("count", 300));
const seed = Number(arg("seed", 2026));
const seasons = Number(arg("seasons", 3));
const verbose = has("verbose");

console.log("=".repeat(78));
console.log(runHarness({ count, seed, seasons }).summaryText);
console.log("=".repeat(78));

// Cross-seed robusthed: kør samme scorecard på flere seeds så vi ikke validerer
// på et enkelt heldigt populations-lotteri.
console.log("\nCross-seed robusthed (allMet pr. seed):");
for (const s of [2026, 7, 42, 1337]) {
  const r = runHarness({ count, seed: s, seasons });
  console.log(`  seed ${String(s).padStart(4)}: ${r.allMet ? "ALLE PASS" : "FAIL"}  (hash ${r.hash})`);
}

// Idempotens-bevis: to identiske runs → identisk hash.
const pop = makeSyntheticPopulation({ count, seed });
const h1 = simulateProgression(pop, { seasons }).hash;
const h2 = simulateProgression(pop, { seasons }).hash;
console.log(`\nIdempotens-bevis: run1=${h1}  run2=${h2}  ${h1 === h2 ? "IDENTISK ✓" : "MISMATCH ✗"}`);

if (verbose) {
  const report = runHarness({ count, seed, seasons });
  const { a, b, c } = report.score.criteria;
  console.log("\n--- Eksemplar-trajektorier ---");
  if (a.exemplar) console.log(`(a) ung høj-pot: ${a.detail}`);
  if (b.exemplar) console.log(`(b) ældre fald:  ${b.detail}`);
  console.log(`(c) retirement-fordeling pr. alder:`, c.retiredByAge);
  console.log(`peakAge=${PROGRESSION_CONFIG.peakAge}  retirement-vindue=${PROGRESSION_CONFIG.retirement.windowStartAge}..${PROGRESSION_CONFIG.retirement.guaranteedAge}`);
}

const final = runHarness({ count, seed, seasons });
process.exit(final.allMet ? 0 : 1);
