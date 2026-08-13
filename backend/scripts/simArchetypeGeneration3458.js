#!/usr/bin/env node
// DB-frit sim-harness for #3458 fase 2 del 1 (arketype-prior-generator, akademi-intake).
//
// Genererer n≥1.000 akademi-kandidater IN-MEMORY (ingen DB, ingen mutation) og kører
// dem gennem PRÆCIS den samme afled-kæde som `deriveForRiderIds` (backfillCores.js):
//   generateAcademyCandidates → seedPhysiologyFromLegacy → deriveAbilities
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
// Exit 1 hvis ÉN gate fejler (ingen tavs grøn — #3009-læringen: gates der ikke fejler
// synligt bliver ikke set). Rører INTET i DB.
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
//   node scripts/simArchetypeGeneration3458.js [--n=2000] [--seed=2026] [--out=<path>]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateAcademyCandidates } from "../lib/academyGenerator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildCapsForRider } from "../lib/riderProgression.js";
import { computeRiderTypes, NEUTRAL_BASELINE, RIDER_TYPE_KEYS } from "../lib/riderTypes.js";
import { ratingFromAbilities } from "../lib/scoutingReport.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}

const N = parseInt(arg("n", "2000"), 10);
const SEED = parseInt(arg("seed", "2026"), 10);
const REFERENCE_YEAR = 2026;
const OUT_PATH = arg("out", null);

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

// Percentil-hjælper (mid-rank ved ties) — samme mønster som
// scripts/measureNormalizedTypes3372.js, så G2/G3 måles på samme semantik som
// den ægte-population-målingen #3372 gaten stammer fra.
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

function main() {
  console.log(`=== #3458 fase 2: arketype-generator sim-harness (n=${N}, seed=${SEED}, DB-frit) ===\n`);

  // ── 1) Generér kuldet (in-memory, samme kerne som produktionsstien) ─────────
  const rng = makeRng(SEED);
  const candidates = generateAcademyCandidates({
    rng,
    referenceYear: REFERENCE_YEAR,
    existingNames: new Set(),
    countOverride: N,
  });

  // ── 2) Kør HELE afled-kæden pr. kandidat (spejler deriveForRiderIds 1:1) ────
  const riders = candidates.map((c, i) => {
    const riderRow = { id: `sim-${SEED}-${i}`, ...c.rider };
    const physiology = seedPhysiologyFromLegacy(riderRow);
    const abilities = deriveAbilities(physiology, riderRow);

    // Bootstrap-type: klassificeret mod LIVE abilities + NEUTRAL_BASELINE (#3325-
    // mønsteret, deriveForRiderIds trin 2) — giver caps' rolle-faktor en retning.
    const bootstrap = computeRiderTypes(abilities, NEUTRAL_BASELINE);

    const baseline = {};
    for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
    // #3591: ungdoms-kohorte (16-21) — taperen er inaktiv, age: null er bit-identisk.
    const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale, age: null }, bootstrap.primary.key, bootstrap.secondary.key);

    // ENDELIG type: klassificeret mod ability_caps + den SHIPPEDE caps-fittede
    // baseline (deriveForRiderIds trin 4) — dette er den type der ville blive
    // PERSISTERET til riders.primary_type i produktion.
    const final = computeRiderTypes(caps, typesBaseline);

    return {
      archetypeDraw: c.archetypeDraw, // { primary, secondary } — ALDRIG skrevet til DB
      abilities,
      caps,
      potentiale: riderRow.potentiale,
      age: REFERENCE_YEAR - Number(String(riderRow.birthdate).slice(0, 4)),
      finalPrimary: final.primary.key,
      finalSecondary: final.secondary.key,
    };
  });
  const n = riders.length;

  // ── G1: klassifikatorens endelige type == trukket arketype (hybrid: en af de to) ──
  let g1Hits = 0;
  for (const r of riders) {
    // #3632: anlaegget er altid to-delt, saa 'primaer ELLER sekundaer' ville goere
    // maalingen mildere netop hvor den skulle vaere skarp. G1 er STRIKS: ramte den trukne primaer?
    const hit = r.finalPrimary === r.archetypeDraw.primary;
    if (hit) g1Hits++;
  }
  const g1Pct = Math.round((g1Hits / n) * 1000) / 10;

  // ── G2/G3: normaliseret rolle-percentil pr. rytter (mønster fra measureNormalizedTypes3372.js) ──
  // scores[t] = "loft-rating som type t" hvis rytterens NUVÆRENDE evner var caps'et
  // efter type t's rolle-faktor (samme metode targetet #3372-gaten selv måler mod).
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

  // ── G4: emergent fordeling over 8 typer (ENDELIG type, ikke arketype-trækket) ──
  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
  for (const r of riders) dist[r.finalPrimary] = (dist[r.finalPrimary] || 0) + 1;
  const distPct = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, Math.round((dist[t] / n) * 1000) / 10]));
  const g4Violations = RIDER_TYPE_KEYS.filter((t) => distPct[t] < GATES.g4MinTypePct || distPct[t] > GATES.g4MaxTypePct);

  // ── Arketype-trækkets egen fordeling (til sammenligning — IKKE selve gaten) ──
  const drawDist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
  let hybridCount = 0;
  for (const r of riders) {
    drawDist[r.archetypeDraw.primary] = (drawDist[r.archetypeDraw.primary] || 0) + 1;
    if (r.archetypeDraw.secondary) hybridCount++;
  }
  const hybridPct = Math.round((hybridCount / n) * 1000) / 10;

  // ── Scorecard ────────────────────────────────────────────────────────────────
  const scorecard = {
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

  const allPass = Object.values(scorecard.gates).every((g) => g.pass);

  // ── Læsbar tabel ────────────────────────────────────────────────────────────
  console.log(`Hybrid-andel: ${hybridPct}% (mål ~15%)\n`);
  console.log("Arketype-træk-fordeling (prior, IKKE gaten) vs. endelig type-fordeling (ENDELIG, G4-gaten):");
  console.log(`  ${"type".padEnd(16)} ${"træk %".padStart(8)} ${"endelig %".padStart(10)}`);
  for (const t of RIDER_TYPE_KEYS) {
    console.log(`  ${t.padEnd(16)} ${String(scorecard.archetypeDrawDistributionPct[t]).padStart(8)} ${String(distPct[t]).padStart(10)}`);
  }
  console.log("");
  for (const [gateName, g] of Object.entries(scorecard.gates)) {
    const status = g.pass ? "PASS" : "FAIL";
    if (gateName === "G4_emergent_distribution") {
      console.log(`${status}  ${gateName}: violations=${JSON.stringify(g.violations)}`);
    } else {
      console.log(`${status}  ${gateName}: ${JSON.stringify(g)}`);
    }
  }
  console.log(`\nSpecialiserings-dybde: p10=${scorecard.depthPercentiles.p10} p25=${scorecard.depthPercentiles.p25} median=${scorecard.depthPercentiles.median} p75=${scorecard.depthPercentiles.p75}`);
  console.log(`\n${allPass ? "ALLE GATES GRØNNE" : "GATE(S) FEJLEDE"}\n`);
  console.log("=== SCORECARD JSON ===");
  console.log(JSON.stringify(scorecard, null, 2));

  if (OUT_PATH) writeFileSync(OUT_PATH, JSON.stringify(scorecard, null, 2));

  if (!allPass) process.exitCode = 1;
}

main();
