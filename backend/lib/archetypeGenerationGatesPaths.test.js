// G1/G4-regressionstests for #3458 fase 2 PR2 (arketype-prior UDVIDET til
// markeds-/AI-fill-/starter-squad-stierne). Lillle n (300, fast seed) —
// REGRESSIONS-gates, ikke et erstatning for det fulde sim-harness
// (backend/scripts/simArchetypeGeneration3458.js --path=all --n=2000, kørt
// manuelt før push, se PR-body-scorecardet).
//
// VIGTIGT — floors her er IKKE design-spec'ens ≥90%-mål: en grundig, rod-
// årsags-undersøgt (se PR-body + kode-kommentarer i starterSquadAllocator.js/
// fictionalRiderGenerator.js) arkitektonisk begrænsning gør ≥90% UOPNÅELIGT for
// disse tre stier UDEN at røre filer uden for denne opgaves mandat
// (riderValuation.js/riderValuationModel*.json, riderTypesBaseline.json-fitting,
// AI_TIER_VALUE_CAP, abilityDerivation.js). Floors her låser i stedet det
// FAKTISK MÅLTE niveau (med margin til sample-støj), så en FREMTIDIG regression
// (fx en util-refaktor der utilsigtet svækker separationen yderligere) fanges
// af `node --test` — se root-cause-analyserne for hvorfor "fictional" er tættest
// på målet, mens "starter"/"ai" rammer et dybere strukturelt loft.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateFictionalRiders, STAT_KEYS, AI_SIGNATURE_CFG } from "./fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "./physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { buildCapsForRider } from "./riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE, RIDER_TYPE_KEYS } from "./riderTypes.js";
import {
  STARTER_POOL_STAT_WINDOW, rescaleStatIntoWindow,
  AI_TIER_FRACTIONS, AI_TIER_VALUE_CAP, generateAiRiderBatchWithCap, computeAge,
} from "./starterSquadAllocator.js";
import { predictBaseValue } from "./riderValuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesBaseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8"));
const valuationModel = JSON.parse(readFileSync(join(__dirname, "riderValuationModelV4.json"), "utf8"));

const N = 300;
const SEED = 20260806;
const REFERENCE_YEAR = 2026;

function runDeriveChain(riderRow, archetypeDraw) {
  const physiology = seedPhysiologyFromLegacy(riderRow);
  const abilities = deriveAbilities(physiology, riderRow);
  const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
  // #3591/#3593: `age` er obligatorisk — buildCapsForRider KASTER hvis den udelades.
  const caps = buildCapsForRider(
    baseline,
    { potentiale: riderRow.potentiale, age: computeAge(riderRow.birthdate, REFERENCE_YEAR) },
    bootstrap.primary.key,
    bootstrap.secondary.key,
  );
  const final = computeRiderTypes(caps, typesBaseline);
  return { archetypeDraw, finalPrimary: final.primary.key };
}

// G1 er STRIKS: ramte klassifikatoren den TRUKNE primær? #3632 gjorde anlægget
// universelt to-delt, så den gamle "primær ELLER sekundær tæller som hit for de
// ~15% hybrider" ville i dag gøre målingen mildere for ALLE ryttere — netop dér
// hvor den skal være skarp. Samme definition som sim-harnessets G1.
function g1Pct(rows) {
  let hits = 0;
  for (const r of rows) if (r.finalPrimary === r.archetypeDraw.primary) hits++;
  return (hits / rows.length) * 100;
}

function distPct(rows) {
  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
  for (const r of rows) dist[r.finalPrimary] = (dist[r.finalPrimary] || 0) + 1;
  return Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, (dist[t] / rows.length) * 100]));
}

// ── fictional (markeds-/launch-population — DEFAULT-stien, ingen tierTypeWeights) ──

test(`fictional-sti G1-regression: ≥60% (n=${N}, seed=${SEED}) — se PR-body for hvorfor loftet er lavere end 90%-målet`, () => {
  const { riders } = generateFictionalRiders({ seed: SEED, count: N, referenceYear: REFERENCE_YEAR });
  const rows = riders.map((r, i) => runDeriveChain({ id: `fic-${i}`, ...r }, r._meta.archetypeDraw));
  const pct = g1Pct(rows);
  assert.ok(pct >= 60, `G1 ${pct.toFixed(1)}% under regressions-gulvet 60% (målt n=2000: ~70%)`);
});

test("fictional-sti: determinisme (samme seed → samme G1-tal)", () => {
  const a = generateFictionalRiders({ seed: SEED, count: N, referenceYear: REFERENCE_YEAR });
  const b = generateFictionalRiders({ seed: SEED, count: N, referenceYear: REFERENCE_YEAR });
  assert.deepEqual(a.riders, b.riders);
});

test("fictional-sti G4-regression: intet af de 8 typer helt forsvundet (>0%)", () => {
  const { riders } = generateFictionalRiders({ seed: SEED, count: N, referenceYear: REFERENCE_YEAR });
  const rows = riders.map((r, i) => runDeriveChain({ id: `fic-${i}`, ...r }, r._meta.archetypeDraw));
  const dist = distPct(rows);
  for (const t of RIDER_TYPE_KEYS) assert.ok(dist[t] > 0, `type ${t} er slet ikke repræsenteret i den endelige fordeling`);
});

// ── starter (den svage pulje-mekanik, buildWeakStarterPool's reskalering) ─────
// KENDT gab (se starterSquadAllocator.js's rescaleStatIntoWindow-kommentar):
// riderTypesBaseline.json er fittet mod den ÆGTE, langt stærkere population —
// enhver evne i denne ekstremt komprimerede pulje får et kraftigt negativt
// z-score uanset arketype, og baroudeur (hvis eneste negative vægt, time_trial,
// har baseline-tabellens højeste middelværdi) vinder systematisk. VERIFICERET
// pre-existing (samme størrelsesorden med den GAMLE ARCHETYPE_BY_TYPE-mekanisme
// gennem samme pipeline) — ikke en regression i denne PR.

test(`starter-sti G1-regression: ≥25% (n=${N}, seed=${SEED}) — kendt, rod-årsags-undersøgt loft, se PR-body`, () => {
  const { riders } = generateFictionalRiders({ seed: SEED, count: N, referenceYear: REFERENCE_YEAR });
  const rows = riders.map((r, i) => {
    const rescaled = {};
    for (const k of STAT_KEYS) rescaled[k] = rescaleStatIntoWindow(r[k], STARTER_POOL_STAT_WINDOW);
    return runDeriveChain({ id: `starter-${i}`, ...r, ...rescaled }, r._meta.archetypeDraw);
  });
  const pct = g1Pct(rows);
  assert.ok(pct >= 25, `G1 ${pct.toFixed(1)}% under regressions-gulvet 25% (målt n=2000: ~36%)`);
});

test("starter-sti: rescaleStatIntoWindow holder sig inden for [window.lo, window.hi] (svag-hold-kontrakten, #1487)", () => {
  const { riders } = generateFictionalRiders({ seed: SEED, count: N, referenceYear: REFERENCE_YEAR });
  for (const r of riders) {
    for (const k of STAT_KEYS) {
      const v = rescaleStatIntoWindow(r[k], STARTER_POOL_STAT_WINDOW);
      assert.ok(v >= STARTER_POOL_STAT_WINDOW.lo && v <= STARTER_POOL_STAT_WINDOW.hi,
        `${k}=${v} uden for [${STARTER_POOL_STAT_WINDOW.lo},${STARTER_POOL_STAT_WINDOW.hi}]`);
    }
  }
});

// ── ai (tier 1 AI-fill — generateAiRiderBatchWithCap, den ægte accept/reject-loop) ──
// KRITISK REGRESSION FUNDET+RETTET i denne PR (se AI_SIGNATURE_CFG's kommentar):
// den oprindelige (G1-optimerede) signatur-styrke fik generateAiRiderBatchWithCap
// til at fejle ("kun X/24 under loft") i 9/20 seeds — 0/20 for den GAMLE
// mekanisme. Denne test er PRIMÆRT en CRASH-regression-gate (skal ALDRIG kaste),
// G1 er sekundær (samme strukturelle baseline-gab som starter-stien).

test(`ai-sti (tier 1): generateAiRiderBatchWithCap fejler ALDRIG under det ægte 60-runders-budget (10 seeds, count=24) — #2065-crash-regression-gate`, () => {
  for (let seed = 1; seed <= 10; seed++) {
    assert.doesNotThrow(() => {
      generateAiRiderBatchWithCap({
        count: 24, tierFractions: AI_TIER_FRACTIONS[1], valueCap: AI_TIER_VALUE_CAP[1],
        seed, referenceYear: REFERENCE_YEAR, signatureCfg: AI_SIGNATURE_CFG,
      });
    }, `seed ${seed}: generateAiRiderBatchWithCap kastede (tier 1, 60 runder)`);
  }
});

test(`ai-sti (tier 2): generateAiRiderBatchWithCap fejler ALDRIG under det ægte 60-runders-budget (10 seeds, count=24) — #2065-crash-regression-gate`, () => {
  for (let seed = 1; seed <= 10; seed++) {
    assert.doesNotThrow(() => {
      generateAiRiderBatchWithCap({
        count: 24, tierFractions: AI_TIER_FRACTIONS[2], valueCap: AI_TIER_VALUE_CAP[2],
        seed, referenceYear: REFERENCE_YEAR, signatureCfg: AI_SIGNATURE_CFG,
      });
    }, `seed ${seed}: generateAiRiderBatchWithCap kastede (tier 2, 60 runder)`);
  }
});

// generateAiRiderBatchWithCap returnerer en ren INSERT-payload (toInsertPayload
// fjerner _meta/archetypeDraw — korrekt for produktion, men gør G1 umålelig via
// den offentlige API). Denne test SPEJLER derfor accept/reject-løkken 1:1
// (samme call-for-call som starterSquadAllocator.js's egen implementering) og
// bevarer archetypeDraw til målingen — se scripts/simArchetypeGeneration3458.js's
// buildAiRiders for den fulde (n=2000) udgave af samme mønster.
function acceptedWithDraw({ count, tierFractions, valueCap, seed, referenceYear, signatureCfg }) {
  const typeShareCap = 0.4;
  const maxRounds = 60;
  const maxPerType = Math.max(1, Math.ceil(count * typeShareCap));
  const accepted = [];
  const typeCounts = new Map();
  const usedNames = new Set();
  let attemptSeed = seed >>> 0;
  let round = 0;
  while (accepted.length < count && round < maxRounds) {
    round++;
    const needed = count - accepted.length;
    const batchSize = Math.max(needed * 6, 30);
    const { riders } = generateFictionalRiders({
      seed: attemptSeed, count: batchSize, referenceYear, existingFoldedNames: usedNames, tierFractions, signatureCfg,
    });
    attemptSeed = (attemptSeed + 104729) >>> 0;
    for (const candidate of riders) {
      if (accepted.length >= count) break;
      const physiology = seedPhysiologyFromLegacy(candidate);
      const abilities = deriveAbilities(physiology, candidate);
      const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
      // #3591: `age` er obligatorisk (buildCapsForRider kaster ellers).
      const candidateAge = computeAge(candidate.birthdate, referenceYear);
      const caps = buildCapsForRider(
        abilities,
        { potentiale: candidate.potentiale, age: candidateAge },
        bootstrap.primary.key,
        bootstrap.secondary.key,
      );
      const { primary } = computeRiderTypes(caps, typesBaseline);
      const value = predictBaseValue(
        { ...candidate, primary_type: primary.key, age: candidateAge },
        abilities, valuationModel,
      );
      const withinValueCap = value == null || valueCap == null || value <= valueCap;
      const withinTypeCap = (typeCounts.get(primary.key) || 0) < maxPerType;
      if (withinValueCap && withinTypeCap) {
        typeCounts.set(primary.key, (typeCounts.get(primary.key) || 0) + 1);
        accepted.push(candidate);
      }
    }
  }
  return accepted;
}

test(`ai-sti G1-regression: ≥30% (n=${N} via mange 24-batches, seed=${SEED}) — kendt, rod-årsags-undersøgt loft, se PR-body`, () => {
  const tierFractions = AI_TIER_FRACTIONS[1];
  const valueCap = AI_TIER_VALUE_CAP[1];
  const batches = Math.ceil(N / 24);
  const rows = [];
  for (let b = 0; b < batches; b++) {
    const accepted = acceptedWithDraw({
      count: 24, tierFractions, valueCap, seed: SEED + b, referenceYear: REFERENCE_YEAR, signatureCfg: AI_SIGNATURE_CFG,
    });
    for (const r of accepted) rows.push(runDeriveChain({ ...r }, r._meta.archetypeDraw));
  }
  const pct = g1Pct(rows);
  assert.ok(pct >= 30, `G1 ${pct.toFixed(1)}% under regressions-gulvet 30% (målt n=2000: ~40%)`);
});
