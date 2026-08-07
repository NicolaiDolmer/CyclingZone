#!/usr/bin/env node
// DB-frit sim-harness for #3458 fase 2 (arketype-prior-generator).
//
// Fase 2 del 1 (PR1, merged #3500): akademi-intake alene.
// Fase 2 del 2 (PR2, denne udvidelse): samme G1-G4-harness, nu pr. GENERERINGS-STI
// (--path=academy|fictional|starter|ai, eller ingen flag/--path=all = alle fire).
// Hver sti genererer n kandidater IN-MEMORY (ingen DB, ingen mutation) og kører dem
// gennem PRÆCIS den samme afled-kæde som `deriveForRiderIds` (backfillCores.js):
//   (kandidat) → seedPhysiologyFromLegacy → deriveAbilities
//     → bootstrap-type (computeRiderTypes mod NEUTRAL_BASELINE)
//     → buildCapsForRider (rolle-faktor fra bootstrap-typen)
//     → ENDELIG type (computeRiderTypes mod riderTypesBaseline.json)
// og måler success-kriterierne G1-G4 fra design-spec'en
// (docs/superpowers/specs/2026-08-06-ryttertype-fundament-v2-design.md §3):
//
//   G1  klassifikatorens ENDELIGE type == det trukne arketype-prior         ≥90 %
//   G2  specialiserings-dybde (bedste−næstbedste normaliseret percentil)     median ≥8
//   G3  tildelt type == normaliseret bedste rolle                           ≥90 %
//   G4  emergent fordeling over 8 typer                                     ingen <5% eller >30%
//
// De 4 stier:
//   academy    — generateAcademyCandidates (akademi-intake, PR1, uændret)
//   fictional  — generateFictionalRiders DEFAULT-sti (markeds-population/launch-
//                population — fictionalLaunchPopulation.js kalder SAMME funktion
//                med samme parameterform, så denne sti dækker begge)
//   starter    — buildWeakStarterPool-mekanikken (rescaleStatIntoWindow ind i
//                STARTER_POOL_STAT_WINDOW) — dækker starter-squads OG AI tier 3/4
//                (samme mekanisme, aiTeamGenerator.js's defaultAllocateSquadForTeam)
//   ai         — generateAiRiderBatchWithCap-mekanikken (tier 1/2 AI-fill: den ægte
//                arketype-generator + typeShareCap-gating)
//
// ⚠️ KENDT RØD SIDEN 2026-08-09 (#3561): G1 ≈ 24 % og G3 ≈ 5 % — det er FORVENTET og må
// IKKE "rettes" ved at skrue på generator-konstanterne. De 95,6 % / 86,3 % som denne
// harness rapporterede før 9/8 blev købt ved at mætte signatur-stats ved 99, hvilket gav
// 374 prod-ryttere med afledt evne 90 og markedsværdi op til 42 mio (caps =
// max(potentiale-loft, current) → en pot-1,0-rytter fik caps 99).
//
// Kalibrerings-sweepet (simArchetypeCalibration3458.js, 54 kombinationer) viser at G1 og
// ungdomsbåndet er GENSIDIGT UDELUKKENDE med den nuværende klassifikation: G1 ligger på
// 23-30 % ved ENHVER kalibrering der respekterer potentiale-loftet. Rod-årsagen er at
// ungdoms-caps klassificeres mod riderTypesBaseline.json (fittet over VOKSEN-caps), hvor
// time_trial er strukturelt lav (z = −1,92) → enhver type der straffer time_trial får en
// gratis bonus, og baroudeur æder 68 % af kuldet. En ungdoms-fittet baseline løfter G1 til
// 71,7 % (målt, simYouthClassificationFix3458.js) — DET er rettelsen.
//
// De invarianter der faktisk beskytter spillet (G5 potentiale-loft, G6 ungdomsbånd) ligger
// i lib/archetypeGenerationGates.test.js og kører i `node --test`.
//
// Exit 1 hvis ÉN gate fejler på NOGEN målt sti (ingen tavs grøn — #3009-læringen).
// Rører INTET i DB.
//
//   node scripts/simArchetypeGeneration3458.js [--path=all] [--n=2000] [--seed=2026] [--out=<path>]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateAcademyCandidates } from "../lib/academyGenerator.js";
import { makeRng, generateFictionalRiders, STAT_KEYS, AI_SIGNATURE_CFG } from "../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildCapsForRider } from "../lib/riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE, RIDER_TYPE_KEYS } from "../lib/riderTypes.js";
import { ratingFromAbilities } from "../lib/scoutingReport.js";
import { LAUNCH_REFERENCE_YEAR } from "../lib/riderSeasonAge.js";
import { predictBaseValue } from "../lib/riderValuation.js";
import {
  STARTER_POOL_STAT_WINDOW,
  AI_TIER_FRACTIONS,
  AI_TIER_VALUE_CAP,
  rescaleStatIntoWindow,
  computeAge,
} from "../lib/starterSquadAllocator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}

const N = parseInt(arg("n", "2000"), 10);
const SEED = parseInt(arg("seed", "2026"), 10);
const REFERENCE_YEAR = LAUNCH_REFERENCE_YEAR; // sæson 1's kalenderår (lib/riderSeasonAge.js)
const OUT_PATH = arg("out", null);
const PATH_ARG = arg("path", "all");
const ALL_PATHS = ["academy", "fictional", "starter", "ai"];
const PATHS_TO_RUN = PATH_ARG === "all" ? ALL_PATHS : PATH_ARG.split(",").map((s) => s.trim());
for (const p of PATHS_TO_RUN) {
  if (!ALL_PATHS.includes(p)) throw new Error(`ukendt --path=${p} (gyldige: ${ALL_PATHS.join(", ")}, all)`);
}

// GATE-MÅL (design-spec §3).
const GATES = Object.freeze({
  g1MinPct: 90,
  g2MinMedianDepth: 8,
  g3MinPct: 90,
  g4MinTypePct: 5,
  g4MaxTypePct: 30,
});

const TYPES_BASELINE_PATH = join(__dirname, "../lib/riderTypesBaseline.json");
const typesBaseline = JSON.parse(readFileSync(TYPES_BASELINE_PATH, "utf8"));
const VALUATION_MODEL_PATH = join(__dirname, "../lib/riderValuationModelV4.json");
const valuationModel = JSON.parse(readFileSync(VALUATION_MODEL_PATH, "utf8"));

// Percentil-hjælper (mid-rank ved ties) — samme mønster som
// scripts/measureNormalizedTypes3372.js, så G2/G3 måles på samme semantik som
// den ægte-population-målingen #3372-gaten stammer fra.
function buildPercentileFn(sortedAsc) {
  return (v) => {
    let lo = 0, hi = sortedAsc.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedAsc[mid] < v) lo = mid + 1; else hi = mid; }
    let lo2 = lo, hi2 = sortedAsc.length;
    while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (sortedAsc[mid] <= v) lo2 = mid + 1; else hi2 = mid; }
    const rank = (lo + lo2) / 2;
    return Math.round((rank / (sortedAsc.length || 1)) * 99);
  };
}

function median(sortedAsc) {
  const n = sortedAsc.length;
  if (!n) return 0;
  const mid = n >> 1;
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

// ── Delt afled-kæde (spejler deriveForRiderIds 1:1) ─────────────────────────────
// riderRow: { id, ...STAT_KEYS, birthdate, potentiale, ... } + archetypeDraw
// ({ primary, secondary, isHybrid }) fra genererings-stien (KUN til G1-måling,
// aldrig persisteret i produktion).
function runDeriveChain(riderRow, archetypeDraw, referenceYear) {
  const physiology = seedPhysiologyFromLegacy(riderRow);
  const abilities = deriveAbilities(physiology, riderRow);

  // Bootstrap-type: klassificeret mod LIVE abilities + NEUTRAL_BASELINE (#3325-
  // mønsteret, deriveForRiderIds trin 2) — giver caps' rolle-faktor en retning.
  const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);

  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
  // REBASE-NOTE 4/9 (#3512 mod main): #3591/#3593 gjorde alders-udeladelse UMULIG —
  // buildCapsForRider KASTER hvis `age` er undefined. PR'en (7/8) udelod den. Vi
  // sender rytterens rigtige alder: for akademi-kohorten (16-21) er taperen inaktiv
  // og resultatet bit-identisk med main's `age: null`, og for voksen-/AI-/starter-
  // stierne er det den KORREKTE aftrapning motoren selv bruger.
  const age = computeAge(riderRow.birthdate, referenceYear);
  const caps = buildCapsForRider(
    baseline,
    { potentiale: riderRow.potentiale, age },
    bootstrap.primary.key,
    bootstrap.secondary.key,
  );

  // ENDELIG type: klassificeret mod ability_caps + den SHIPPEDE caps-fittede
  // baseline (deriveForRiderIds trin 4) — dette er den type der ville blive
  // PERSISTERET til riders.primary_type i produktion.
  const final = computeRiderTypes(caps, typesBaseline);

  return {
    archetypeDraw,
    abilities,
    caps,
    potentiale: riderRow.potentiale,
    age: referenceYear - Number(String(riderRow.birthdate).slice(0, 4)),
    finalPrimary: final.primary.key,
    finalSecondary: final.secondary.key,
  };
}

// ── Sti-specifikke kandidat-byggere (alle DB-frie, alle bevarer archetypeDraw) ──

function buildAcademyRiders(n, seed, referenceYear) {
  const rng = makeRng(seed);
  const candidates = generateAcademyCandidates({
    rng, referenceYear, existingNames: new Set(), countOverride: n,
  });
  return candidates.map((c, i) => {
    const riderRow = { id: `sim-academy-${seed}-${i}`, ...c.rider };
    return runDeriveChain(riderRow, c.archetypeDraw, referenceYear);
  });
}

// DEFAULT-stien i generateFictionalRiders (#3458 fase 2 PR2) — markeds-/launch-
// population. fictionalLaunchPopulation.js's generateLaunchPopulation() kalder
// SAMME funktion med samme parameterform (ingen tierTypeWeights) → denne måling
// dækker begge stier (de er byte-for-byte samme generator-kald, kun seed/count
// afviger).
function buildFictionalRiders(n, seed, referenceYear) {
  const { riders } = generateFictionalRiders({ seed, count: n, referenceYear });
  return riders.map((r, i) => {
    const riderRow = { id: `sim-fictional-${seed}-${i}`, ...r };
    return runDeriveChain(riderRow, r._meta.archetypeDraw, referenceYear);
  });
}

// Genbruger den ÆGTE rescaleStatIntoWindow (starterSquadAllocator.js) direkte —
// dækker BÅDE start-trupper (buildWeakStarterPool) OG AI tier 3/4
// (aiTeamGenerator.js's defaultAllocateSquadForTeam, clamp-vindue-stien), som
// deler nøjagtig samme mekanisme.
function buildStarterRiders(n, seed, referenceYear) {
  const { riders } = generateFictionalRiders({ seed, count: n, referenceYear });
  return riders.map((r, i) => {
    const rescaledStats = {};
    for (const k of STAT_KEYS) rescaledStats[k] = rescaleStatIntoWindow(r[k], STARTER_POOL_STAT_WINDOW);
    const riderRow = { id: `sim-starter-${seed}-${i}`, ...r, ...rescaledStats };
    return runDeriveChain(riderRow, r._meta.archetypeDraw, referenceYear);
  });
}

// Genbruger generateAiRiderBatchWithCap's ACCEPT-LOOP-logik (starterSquadAllocator.js)
// 1:1, men bevarer archetypeDraw (den ægte funktion returnerer en ren INSERT-payload
// uden _meta — nødvendigt for produktion, uegnet til G1-måling). tier 1's
// AI_TIER_FRACTIONS/AI_TIER_VALUE_CAP bruges som repræsentativ konfiguration (samme
// arketype-generator-mekanisme som tier 2, blot en anden fraction/cap-værdi).
// #3458 fase 2 PR2: kører MANGE UAFHÆNGIGE 24-rytter-batches (AI_SQUAD.TOTAL_SIZE
// — den ÆGTE produktions-skala pr. AI-hold, aiTeamGenerator.js's
// defaultAllocateSquadForTeam) i stedet for ÉN kæmpe n-batch. generateAiRiderBatch-
// WithCap's accept/reject-loop (typeShareCap+valueCap) er tunet til denne lille
// skala (60 runder, batchSize=needed×6) — en enkelt n=2000-batch udtømmer
// nationalitets-navnepoolen og/eller runde-budgettet uden reel produktions-
// relevans (ingen AI-hold genererer 2000 ryttere i ét kald). n rundes op til
// nærmeste multiplum af 24.
const AI_BATCH_SIZE = 24; // AI_SQUAD.TOTAL_SIZE (8 kerne + 16 hale)
function buildAiRiders(n, seed, referenceYear) {
  const tierFractions = AI_TIER_FRACTIONS[1];
  const valueCap = AI_TIER_VALUE_CAP[1];
  const typeShareCap = 0.4;
  const maxRounds = 150; // rundhåndteret margin til måling (prod bruger 60 pr. #2065-postmortem)
  const batches = Math.ceil(n / AI_BATCH_SIZE);
  const accepted = [];
  for (let b = 0; b < batches; b++) {
    const batchSeed = (seed + b * 104729) >>> 0;
    const maxPerType = Math.max(1, Math.ceil(AI_BATCH_SIZE * typeShareCap));
    const typeCounts = new Map();
    const usedNames = new Set();
    const batchAccepted = [];
    let attemptSeed = batchSeed;
    let round = 0;
    while (batchAccepted.length < AI_BATCH_SIZE && round < maxRounds) {
      round++;
      const needed = AI_BATCH_SIZE - batchAccepted.length;
      const batchSize = Math.max(needed * 6, 30);
      const { riders } = generateFictionalRiders({
        seed: attemptSeed, count: batchSize, referenceYear, existingFoldedNames: usedNames, tierFractions,
        signatureCfg: AI_SIGNATURE_CFG,
      });
      attemptSeed = (attemptSeed + 104729) >>> 0;
      for (const candidate of riders) {
        if (batchAccepted.length >= AI_BATCH_SIZE) break;
        const physiology = seedPhysiologyFromLegacy(candidate);
        const abilities = deriveAbilities(physiology, candidate);
        const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);
        // #3591: `age` er obligatorisk (buildCapsForRider kaster ellers) — se runDeriveChain.
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
          abilities,
          valuationModel,
        );
        const withinValueCap = value == null || valueCap == null || value <= valueCap;
        const withinTypeCap = (typeCounts.get(primary.key) || 0) < maxPerType;
        if (withinValueCap && withinTypeCap) {
          typeCounts.set(primary.key, (typeCounts.get(primary.key) || 0) + 1);
          batchAccepted.push(candidate);
        }
      }
    }
    if (batchAccepted.length < AI_BATCH_SIZE) {
      throw new Error(`buildAiRiders: batch ${b} only ${batchAccepted.length}/${AI_BATCH_SIZE} riders accepted after ${round} rounds`);
    }
    accepted.push(...batchAccepted);
  }
  return accepted.slice(0, n).map((r, i) => {
    const riderRow = { id: `sim-ai-${seed}-${i}`, ...r };
    return runDeriveChain(riderRow, r._meta.archetypeDraw, referenceYear);
  });
}

const PATH_BUILDERS = Object.freeze({
  academy: buildAcademyRiders,
  fictional: buildFictionalRiders,
  starter: buildStarterRiders,
  ai: buildAiRiders,
});

// ── G1-G4-måling for ÉN sti's rytter-array ──────────────────────────────────────
function measurePath(pathName, riders) {
  const n = riders.length;

  // G1: klassifikatorens endelige type == trukket arketype (hybrid: en af de to).
  let g1Hits = 0;
  for (const r of riders) {
    // #3632: anlaegget er altid to-delt, saa 'primaer ELLER sekundaer' ville goere
    // maalingen mildere netop hvor den skulle vaere skarp. G1 er STRIKS: ramte den trukne primaer?
    const hit = r.finalPrimary === r.archetypeDraw.primary;
    if (hit) g1Hits++;
  }
  const g1Pct = Math.round((g1Hits / n) * 1000) / 10;

  // G2/G3: normaliseret rolle-percentil pr. rytter (mønster fra measureNormalizedTypes3372.js).
  const rawScores = riders.map((r) => {
    const scores = {};
    for (const t of RIDER_TYPE_KEYS) {
      const capsT = buildCapsForRider(r.abilities, { potentiale: r.potentiale, age: r.age }, t, null);
      scores[t] = ratingFromAbilities(capsT, t);
    }
    return scores;
  });
  const sortedByType = {};
  for (const t of RIDER_TYPE_KEYS) sortedByType[t] = rawScores.map((s) => s[t]).sort((a, b) => a - b);
  const pctlFnByType = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, buildPercentileFn(sortedByType[t])]));

  let g3Hits = 0;
  const depths = [];
  for (let i = 0; i < n; i++) {
    const norm = RIDER_TYPE_KEYS
      .map((t) => ({ t, p: pctlFnByType[t](rawScores[i][t]) }))
      .sort((a, b) => b.p - a.p);
    if (norm[0].t === riders[i].finalPrimary) g3Hits++;
    depths.push(norm[0].p - norm[1].p);
  }
  const g3Pct = Math.round((g3Hits / n) * 1000) / 10;
  const sortedDepths = [...depths].sort((a, b) => a - b);
  const g2Median = median(sortedDepths);

  // G4: emergent fordeling over 8 typer (ENDELIG type, ikke arketype-trækket).
  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
  for (const r of riders) dist[r.finalPrimary] = (dist[r.finalPrimary] || 0) + 1;
  const distPct = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, Math.round((dist[t] / n) * 1000) / 10]));
  const g4Violations = RIDER_TYPE_KEYS.filter((t) => distPct[t] < GATES.g4MinTypePct || distPct[t] > GATES.g4MaxTypePct);

  // Arketype-trækkets egen fordeling (til sammenligning — IKKE selve gaten).
  const drawDist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
  let hybridCount = 0;
  for (const r of riders) {
    drawDist[r.archetypeDraw.primary] = (drawDist[r.archetypeDraw.primary] || 0) + 1;
    if (r.archetypeDraw.secondary) hybridCount++;
  }
  const hybridPct = Math.round((hybridCount / n) * 1000) / 10;

  const scorecard = {
    path: pathName,
    meta: { generatedAt: new Date().toISOString(), n, seed: SEED, referenceYear: REFERENCE_YEAR, hybridPct },
    gates: {
      G1_classifier_matches_archetype: { pct: g1Pct, min: GATES.g1MinPct, pass: g1Pct >= GATES.g1MinPct },
      G2_specialization_depth_median: { median: g2Median, min: GATES.g2MinMedianDepth, pass: g2Median >= GATES.g2MinMedianDepth },
      G3_assigned_equals_normalized_best: { pct: g3Pct, min: GATES.g3MinPct, pass: g3Pct >= GATES.g3MinPct },
      G4_emergent_distribution: { distPct, violations: g4Violations, pass: g4Violations.length === 0 },
    },
    archetypeDrawDistributionPct: Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, Math.round((drawDist[t] / n) * 1000) / 10])),
    finalTypeDistributionPct: distPct,
    depthPercentiles: {
      p10: sortedDepths[Math.floor(0.1 * (n - 1))],
      p25: sortedDepths[Math.floor(0.25 * (n - 1))],
      median: g2Median,
      p75: sortedDepths[Math.floor(0.75 * (n - 1))],
    },
  };
  return scorecard;
}

function printScorecard(sc) {
  console.log(`\n=== sti: ${sc.path} (n=${sc.meta.n}, seed=${sc.meta.seed}) ===`);
  // #3632: anlaegget er ALTID to-delt — andelen skal vaere 100%. Er den lavere,
  // er der en sti der foeder ryttere uden sekundaer (praecis #3634's rodaarsag).
  console.log(`Anlaeg med sekundaer: ${sc.meta.hybridPct}% (skal vaere 100%)\n`);
  console.log("Arketype-træk-fordeling (prior, IKKE gaten) vs. endelig type-fordeling (ENDELIG, G4-gaten):");
  console.log(`  ${"type".padEnd(16)} ${"træk %".padStart(8)} ${"endelig %".padStart(10)}`);
  for (const t of RIDER_TYPE_KEYS) {
    console.log(`  ${t.padEnd(16)} ${String(sc.archetypeDrawDistributionPct[t]).padStart(8)} ${String(sc.finalTypeDistributionPct[t]).padStart(10)}`);
  }
  console.log("");
  for (const [gateName, g] of Object.entries(sc.gates)) {
    const status = g.pass ? "PASS" : "FAIL";
    if (gateName === "G4_emergent_distribution") {
      console.log(`${status}  ${gateName}: violations=${JSON.stringify(g.violations)}`);
    } else {
      console.log(`${status}  ${gateName}: ${JSON.stringify(g)}`);
    }
  }
  console.log(`Specialiserings-dybde: p10=${sc.depthPercentiles.p10} p25=${sc.depthPercentiles.p25} median=${sc.depthPercentiles.median} p75=${sc.depthPercentiles.p75}`);
}

function main() {
  console.log(`=== #3458 fase 2: arketype-generator sim-harness (stier=${PATHS_TO_RUN.join(",")}, n=${N}, seed=${SEED}, DB-frit) ===`);

  const scorecards = {};
  for (const pathName of PATHS_TO_RUN) {
    const riders = PATH_BUILDERS[pathName](N, SEED, REFERENCE_YEAR);
    const sc = measurePath(pathName, riders);
    scorecards[pathName] = sc;
    printScorecard(sc);
  }

  const allPass = Object.values(scorecards).every((sc) => Object.values(sc.gates).every((g) => g.pass));
  console.log(`\n${allPass ? "ALLE GATES GRØNNE (alle målte stier)" : "GATE(S) FEJLEDE"}\n`);
  console.log("=== SCORECARD JSON (pr. sti) ===");
  console.log(JSON.stringify(scorecards, null, 2));

  if (OUT_PATH) writeFileSync(OUT_PATH, JSON.stringify(scorecards, null, 2));
  if (!allPass) process.exitCode = 1;
}

main();
