// G1/G2-regressionstests for #3458 fase 2 (arketype-prior-generator).
//
// Lille n (300, fast seed) — hurtig+deterministisk i CI, IKKE et erstatning for
// det fulde sim-harness (backend/scripts/simArchetypeGeneration3458.js, kørt
// manuelt med n=2.000 før push, se PR-body-scorecardet). Formålet her er en
// REGRESSIONS-gate: hvis en fremtidig ændring (fx en util-refaktor der rører
// generateYouthStats/signatureProfile) knækker separationen, skal `node --test`
// fange det med det samme — ikke først ved den manuelle n=2.000-kørsel.
//
// Spejler PRÆCIS afled-kæden fra backend/lib/backfillCores.js' deriveForRiderIds
// (physiology → abilities → bootstrap-type → caps → endelig type), DB-frit.

import test from "node:test";
import assert from "node:assert/strict";

import { generateAcademyCandidates } from "./academyGenerator.js";
import { makeRng } from "./fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "./physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { buildCapsForRider } from "./riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE } from "./riderTypes.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesBaseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8"));

const N = 300;
const SEED = 20260806;
const REFERENCE_YEAR = 2026;

// #2064-tolerance jf. simArchetypeGeneration3458.js's G1-mål (≥90%) — lille n
// giver mere sample-støj end n=2.000, så regressions-tærsklen her er en anelse
// lavere (85%) for ikke at flake på seed-specifik varians, mens den STADIG
// fanger en ægte regression (fase-1-niveauet var ~21%).
const G1_REGRESSION_FLOOR_PCT = 85;
const G2_REGRESSION_MEDIAN_FLOOR = 8;

function runCohort(n, seed) {
  const rng = makeRng(seed);
  const candidates = generateAcademyCandidates({
    rng, referenceYear: REFERENCE_YEAR, existingNames: new Set(), countOverride: n,
  });
  return candidates.map((c, i) => {
    const riderRow = { id: `g1-${seed}-${i}`, ...c.rider };
    const physiology = seedPhysiologyFromLegacy(riderRow);
    const abilities = deriveAbilities(physiology, riderRow);
    const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
    const baseline = {};
    for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
    const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale }, bootstrap.primary.key, bootstrap.secondary.key);
    const final = computeRiderTypes(caps, typesBaseline);
    return { archetypeDraw: c.archetypeDraw, finalPrimary: final.primary.key };
  });
}

test(`G1-regression: klassifikatoren genfinder det trukne anlæg ≥${G1_REGRESSION_FLOOR_PCT}% (n=${N}, seed=${SEED})`, () => {
  const riders = runCohort(N, SEED);
  let hits = 0;
  for (const r of riders) {
    const { primary, secondary, isHybrid } = r.archetypeDraw;
    const hit = isHybrid ? (r.finalPrimary === primary || r.finalPrimary === secondary) : r.finalPrimary === primary;
    if (hit) hits++;
  }
  const pct = (hits / riders.length) * 100;
  assert.ok(pct >= G1_REGRESSION_FLOOR_PCT, `G1 ${pct.toFixed(1)}% under regressions-gulvet ${G1_REGRESSION_FLOOR_PCT}% (fase-1-niveauet var ~21% — se academyGenerator.js' YOUTH_GEN_CONFIG-historik hvis dette fejler)`);
});

test(`G1-regression: determinisme (samme seed → samme kuld → samme G1-tal)`, () => {
  const a = runCohort(N, SEED);
  const b = runCohort(N, SEED);
  assert.deepEqual(a.map((r) => r.finalPrimary), b.map((r) => r.finalPrimary));
  assert.deepEqual(a.map((r) => r.archetypeDraw), b.map((r) => r.archetypeDraw));
});

test(`G2-regression: specialiserings-dybde median ≥${G2_REGRESSION_MEDIAN_FLOOR} (via VISIBLE_ABILITIES-spredning på den boostede signatur)`, () => {
  // Let, DB-fri proxy for den fulde G2-percentil-måling (som kræver en hel
  // population at normalisere imod, se sim-harnessen): måler i stedet at hver
  // rytters BEDSTE fysiske evne ligger markant over dens NÆSTBEDSTE — den
  // rå-evne-analog til "specialiserings-dybde" G2 gater på befolknings-niveau.
  const rng = makeRng(SEED + 1);
  const candidates = generateAcademyCandidates({ rng, referenceYear: REFERENCE_YEAR, existingNames: new Set(), countOverride: N });
  const gaps = candidates.map((c) => {
    const riderRow = { id: "g2", ...c.rider };
    const abilities = deriveAbilities(seedPhysiologyFromLegacy(riderRow), riderRow);
    const phys = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability"];
    const vals = phys.map((k) => abilities[k]).sort((a, b) => b - a);
    return vals[0] - vals[1];
  }).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  assert.ok(median >= G2_REGRESSION_MEDIAN_FLOOR, `median rå-evne-gab ${median} under regressions-gulvet ${G2_REGRESSION_MEDIAN_FLOOR}`);
});
