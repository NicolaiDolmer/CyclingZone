#!/usr/bin/env node
// Scorecard for #3570 (fast-track fighter-fix, #3564-kæden) — ungdoms-baseline.
//
// FØR/EFTER for nye akademi-kuld (n=3000, fast seed), samme afled-kæde som
// deriveForRiderIds (backend/lib/backfillCores.js): physiology → abilities →
// bootstrap-type [NEUTRAL_BASELINE] → buildCapsForRider → ENDELIG type.
//   FØR  = ENDELIG type klassificeret UDELUKKENDE mod voksen-baselinen (dagens
//          defekte kodesti, riderTypesBaseline.json).
//   EFTER = ENDELIG type via selectTypesBaseline (< 22 år → riderTypesBaselineYouth.json,
//          #3570's rettelse — akademi-kandidater er ALTID < 22, så dette er reelt
//          "ren ungdoms-baseline" for hele kuldet).
//
// Måler: G1 (arketype-genfinding), G4 (fordeling 5-30% pr. type), knaphedsmål-diff.
// NEGATIV-TEST indbygget: FØR-linjen SKAL vise dagens kendte defekt (G4 fejler bredt).
//
//   node scripts/dev/scorecard3570YouthBaseline.mjs [--n=3000]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateAcademyCandidates } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE, RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { LAUNCH_REFERENCE_YEAR } from "../../lib/riderSeasonAge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adultBaseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaseline.json"), "utf8"));
const youthBaseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaselineYouth.json"), "utf8"));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}
const N = parseInt(arg("n", "3000"), 10);
const SEED = parseInt(arg("seed", "2026"), 10);
const REFERENCE_YEAR = LAUNCH_REFERENCE_YEAR; // sæson 1's kalenderår (lib/riderSeasonAge.js)

// Ejer-defineret knaphedsmål (#3564-kæden, se opgavebeskrivelsen for #3570).
const SCARCITY_TARGET_PCT = Object.freeze({
  baroudeur: 11, climber: 17, sprinter: 15, tt: 9,
  puncheur: 13, gc: 9, brostensrytter: 9, rouleur: 17,
});

function runCohort(n, seed) {
  const rng = makeRng(seed);
  const candidates = generateAcademyCandidates({
    rng, referenceYear: REFERENCE_YEAR, existingNames: new Set(), countOverride: n,
  });
  return candidates.map((c, i) => {
    const riderRow = { id: `sc3570-${i}`, ...c.rider };
    const abilities = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
    const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
    const baseline = {};
    for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
    // #3591: ungdoms-kohorte (16-21) — taperen er inaktiv, age: null er bit-identisk.
    const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale, age: null }, bootstrap.primary.key, bootstrap.secondary.key);
    const age = REFERENCE_YEAR - Number(String(riderRow.birthdate).slice(0, 4));
    return { caps, age, archetypeDraw: c.archetypeDraw };
  });
}

function classify(rows, model) {
  let hits = 0;
  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
  for (const r of rows) {
    const key = computeRiderTypes(r.caps, model).primary.key;
    dist[key]++;
    // #3632: G1 er STRIKS (den trukne primaer) — alle anlaeg er nu to-delte.
    if (key === r.archetypeDraw.primary) hits++;
  }
  const distPct = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, (dist[t] / rows.length) * 100]));
  const g1 = (hits / rows.length) * 100;
  const g4Violations = RIDER_TYPE_KEYS.filter((t) => distPct[t] < 5 || distPct[t] > 30);
  return { g1, distPct, g4Violations };
}

function printReport(label, res) {
  console.log(`\n${label}`);
  console.log(`  G1 (arketype-genfinding): ${res.g1.toFixed(1)} %`);
  console.log(`  G4 (fordeling 5-30% pr. type): ${res.g4Violations.length === 0 ? "OK ✓" : `BRUD på ${res.g4Violations.join(", ")}`}`);
  console.log("  fordeling vs. knaphedsmål:");
  for (const t of RIDER_TYPE_KEYS) {
    const got = res.distPct[t];
    const target = SCARCITY_TARGET_PCT[t];
    const diff = got - target;
    console.log(`    ${t.padEnd(15)} ${got.toFixed(1).padStart(5)}%  (mål ${String(target).padStart(2)}%, diff ${diff >= 0 ? "+" : ""}${diff.toFixed(1)})`);
  }
}

console.log(`=== #3570 scorecard — ungdoms-baseline (n=${N}, seed=${SEED}) ===`);
const rows = runCohort(N, SEED);

const before = classify(rows, adultBaseline); // dagens defekt: klassificeret UDELUKKENDE mod voksen-baseline
const after = classify(rows, rows.length ? youthBaseline : adultBaseline); // #3570: hele kuldet er < 22 → ren ungdoms-baseline
printReport("FØR (voksen-baseline — dagens defekt)", before);
printReport("EFTER (#3570 ungdoms-baseline)", after);

console.log("\n=== NEGATIV-TEST ===");
console.log(
  before.g4Violations.length >= 4
    ? `✓ FØR viser dagens kendte defekt (G4 brud på ${before.g4Violations.length} typer, forventet bredt brud)`
    : `✗ UVENTET: FØR viser kun ${before.g4Violations.length} G4-brud — forventede et bredt sammenbrud (baroudeur-dominans). Undersøg om populationskonfigurationen er ændret.`
);
console.log(
  after.g1 > before.g1
    ? `✓ EFTER forbedrer G1 markant: ${before.g1.toFixed(1)}% → ${after.g1.toFixed(1)}%`
    : `✗ TUNING-ALARM: EFTER (${after.g1.toFixed(1)}%) forbedrer IKKE G1 ift. FØR (${before.g1.toFixed(1)}%) — stop og undersøg, ret ikke gaten.`
);
console.log(
  after.g4Violations.length < before.g4Violations.length
    ? `✓ EFTER reducerer G4-brud: ${before.g4Violations.length} → ${after.g4Violations.length} typer`
    : `⚠ EFTER reducerer IKKE antallet af G4-brud (${before.g4Violations.length} → ${after.g4Violations.length})`
);
if (after.g4Violations.length > 0) {
  console.log(`⚠ ÆRLIGT MISS: G4 består IKKE fuldt ud efter fixet — stadig brud på: ${after.g4Violations.join(", ")}. Se PR-rapporten for hvorfor (ikke tunet for at bestå).`);
}
