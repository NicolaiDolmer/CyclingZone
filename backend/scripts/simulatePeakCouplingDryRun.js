// Race Engine v3 (#2224) slice S5 — peak-koblings + neutralitets-harness.
//
// Kontrollerede peak-eksperimenter mod et snapshot af den ÆGTE prod-population
// (samme felt/seed, kun peak-plan/tq varierer), der fodrer de rene S5-oracles i
// raceDryRunOracles.js. Følger mønsteret fra simulateSeasonDryRun.js (--population,
// --seeds, --enforce) og S4's incident-oracle.
//
//   Brug:
//     node scripts/simulatePeakCouplingDryRun.js \
//        --population=scripts/baselines/population-snapshot-2026-07-11.json \
//        --seeds=2026,7,42 [--field=60] [--enforce] [--json]
//
//   Kalibrering (env, samme mønster som S1/S2/S4 — sætter RACE_V3_TUNING):
//     RACE_V3_PEAK_MAX / RACE_V3_PEAK_PAYBACK / RACE_V3_PEAK_PAYBACK_DAYS /
//     RACE_V3_PEAK_TQ_FLOOR / RACE_V3_PEAK_LEADUP_DAYS
//
// Determinisme: peak/payback er DATA-drevne (vindue+tq), ikke seed-drevne; kun
// dayform/jour-sans/noise varierer pr. seed → derfor middel over seeds. Rører
// aldrig prod (in-memory). trainingQuality sættes DIREKTE på vinduerne her (vi
// tester motorens kobling peak_realiseret = PEAK_MAX × tq); den fulde DB-signal-
// resolver (racePeakPlans.resolvePeakTrainingQualities) testes i lib-suiten.

import { readFileSync } from "node:fs";

import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { DEMAND_VECTORS } from "../lib/raceStageProfileGenerator.js";
import { simulateStage } from "../lib/raceSimulator.js";
import { RACE_V3_TUNING } from "../lib/raceRoles.js";
import { evaluatePeakCouplingScorecard, evaluatePeakNeutralityOracle } from "../lib/raceDryRunOracles.js";

// ── args ──────────────────────────────────────────────────────────────────────
function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const POPULATION_PATH = arg("population", null);
const SEEDS = arg("seeds", "2026,7,42").split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
const FIELD_SIZE = Number(arg("field", 60));
const ENFORCE = has("enforce");
const AS_JSON = has("json");

// ── felt ────────────────────────────────────────────────────────────────────
// Population-snapshot (ægte prod-abilities) er primær; syntetisk fallback lader
// scriptet køre uden snapshot (smoke/CI). Kun ryttere MED abilities bruges.
function loadPool() {
  if (POPULATION_PATH) {
    const data = JSON.parse(readFileSync(POPULATION_PATH, "utf8"));
    if (data?.schema_version !== 1) throw new Error("population-snapshot: forventet schema_version=1");
    return data.riders
      .filter((r) => r.abilities && typeof r.abilities === "object")
      .map((r) => ({ id: r.id, abilities: r.abilities }));
  }
  // Syntetisk fallback: 400 ryttere med seeded tilfældige abilities.
  const rng = makeRng(1234);
  const KEYS = ["climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone", "acceleration", "recovery", "tactics", "positioning"];
  return Array.from({ length: 400 }, (_, i) => {
    const abilities = {};
    for (const k of KEYS) abilities[k] = Math.round(30 + rng() * 60);
    return { id: `syn-${i}`, abilities };
  });
}

const pool = loadPool();
// KONTESTERET bjergfelt: feltet SKAL være et tæt pak af sammenlignelige klatrere,
// ellers vinder feltets stærkeste uanset tq (peak flytter så ingen placering →
// koblingen kan ikke MÅLES). Vi bygger derfor felterne fra de bedste ~200 klatrere
// (elite-pak; top-kompressionen gør gabene ~0.01/plads dér, så et peak-løft på
// PEAK_MAX flytter reelt placeringer).
const climberSorted = [...pool].sort((a, b) => (b.abilities.climbing || 0) - (a.abilities.climbing || 0));
const ELITE = climberSorted.slice(0, Math.min(200, climberSorted.length));
// Neutralitet: to lige-stærke topklatrere (klarest når de ligger blandt de bedste).
const STRONG_ABILITIES = ELITE[0].abilities;
// Kobling: mål-rytter midt i elite-feltet (kontesteret placering — ~feltets median),
// så peak-løftet trækker den OP gennem pakket i stedet for at bekræfte en sikker sejr.
const COUPLING_ABILITIES = ELITE[Math.floor(ELITE.length * 0.5)].abilities;

// Sampler et tæt elite-bjergfelt (fra ELITE) — bruges til BEGGE eksperimenter så
// placeringer er kontesterede.
function sampleField(seed, n, excludeIds = new Set()) {
  const rng = makeRng(seed);
  const idx = ELITE.map((_, i) => i);
  for (let i = 0; i < idx.length; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const out = [];
  for (const i of idx) {
    if (out.length >= n) break;
    const r = ELITE[i];
    if (excludeIds.has(r.id)) continue;
    out.push({ rider_id: r.id, team_id: `t-${r.id}`, abilities: r.abilities });
  }
  return out;
}

const MOUNTAIN = { profile_type: "high_mountain", demand_vector: DEMAND_VECTORS.high_mountain };
function mountainStage(peakDay) {
  return { ...MOUNTAIN, peakDay };
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const rankOf = (ranked, riderId) => ranked.find((r) => r.rider_id === riderId)?.rank ?? null;
const peakOf = (ranked, riderId) => ranked.find((r) => r.rider_id === riderId)?.components?.peak ?? 0;

// ── Eksperiment 1: koblings-scorecard ─────────────────────────────────────────
// Mål-rytter med ét peak-vindue [98,102] om en bjergetape (peakDay=100); tq varieres.
// peak_realiseret skal skalere monotont; placering forbedres; payback tq-uafhængig.
function runCoupling() {
  const PEAK_DAY = 100;
  const WINDOW = { start: 98, end: 102 };
  const tqLadder = [RACE_V3_TUNING.PEAK_TQ_FLOOR, 0.4, 0.6, 0.8, 1.0];
  const ladder = [];
  for (const tq of tqLadder) {
    const ranks = [], peaks = [];
    for (const seed of SEEDS) {
      const field = sampleField(seed, FIELD_SIZE, new Set(["peakT"]));
      field.push({ rider_id: "peakT", team_id: "T", abilities: COUPLING_ABILITIES, peakWindows: [{ ...WINDOW, trainingQuality: tq }] });
      const { ranked } = simulateStage({ entrants: field, stageProfile: mountainStage(PEAK_DAY), seed, v3: true });
      ranks.push(rankOf(ranked, "peakT"));
      peaks.push(peakOf(ranked, "peakT"));
    }
    ladder.push({ tq, peak: mean(peaks), meanRank: mean(ranks) });
  }

  // Payback: samme vindue, men etapen i payback-zonen (peakDay=106 ∈ [103..102+N]).
  const paybackDay = WINDOW.end + Math.max(1, Math.floor(RACE_V3_TUNING.PEAK_PAYBACK_DAYS / 2));
  const payback = [];
  for (const tq of [RACE_V3_TUNING.PEAK_TQ_FLOOR, 1.0]) {
    const vals = [];
    for (const seed of SEEDS) {
      const field = sampleField(seed, FIELD_SIZE, new Set(["peakT"]));
      field.push({ rider_id: "peakT", team_id: "T", abilities: COUPLING_ABILITIES, peakWindows: [{ ...WINDOW, trainingQuality: tq }] });
      const { ranked } = simulateStage({ entrants: field, stageProfile: mountainStage(paybackDay), seed, v3: true });
      vals.push(peakOf(ranked, "peakT"));
    }
    payback.push({ tq, payback: mean(vals) });
  }

  const onTrack = ladder.find((l) => l.tq === 1.0);
  const behind = ladder.find((l) => l.tq === RACE_V3_TUNING.PEAK_TQ_FLOOR);
  return { ladder, payback, onTrackMeanRank: onTrack.meanRank, behindMeanRank: behind.meanRank };
}

// ── Eksperiment 2: peak-neutralitet ───────────────────────────────────────────
// SAMME rytter under to MODSATTE planer (plan A = top for løb 1; plan B = top for
// løb 2), i de samme to bjergløb (peakDay=100 / 300, ingen vindue-/payback-overlap).
// Dagsform/jour-sans hashes på (rider_id, stage-seed) — IKKE på planen — så en
// counterfactual på én rytter ANNULLERER den støj: kun peaken varierer mellem
// planerne. Hver plan skal dominere kun EGET mål; ingen plan må dominere begge
// (ellers lækker peaken uden for sit vindue). "A" = plan-for-løb-1, "B" = plan-for-løb-2.
function runNeutrality() {
  const D1 = 100, D2 = 300;
  const planA = [{ start: D1 - 2, end: D1 + 2, trainingQuality: 1.0 }]; // top for løb 1
  const planB = [{ start: D2 - 2, end: D2 + 2, trainingQuality: 1.0 }]; // top for løb 2
  const a1 = [], b1 = [], a2 = [], b2 = [];
  for (const seed of SEEDS) {
    const field = sampleField(seed, FIELD_SIZE, new Set(["peakX"]));
    const withPlanA = { rider_id: "peakX", team_id: "X", abilities: STRONG_ABILITIES, peakWindows: planA };
    const withPlanB = { rider_id: "peakX", team_id: "X", abilities: STRONG_ABILITIES, peakWindows: planB };
    // Løb 1 under hver plan (plan A peaker her, plan B er neutral her).
    a1.push(rankOf(simulateStage({ entrants: [...field, withPlanA], stageProfile: mountainStage(D1), seed, v3: true }).ranked, "peakX"));
    b1.push(rankOf(simulateStage({ entrants: [...field, withPlanB], stageProfile: mountainStage(D1), seed, v3: true }).ranked, "peakX"));
    // Løb 2 under hver plan (plan B peaker her, plan A er neutral her).
    a2.push(rankOf(simulateStage({ entrants: [...field, withPlanA], stageProfile: mountainStage(D2), seed, v3: true }).ranked, "peakX"));
    b2.push(rankOf(simulateStage({ entrants: [...field, withPlanB], stageProfile: mountainStage(D2), seed, v3: true }).ranked, "peakX"));
  }
  return { rankA_r1: mean(a1), rankB_r1: mean(b1), rankA_r2: mean(a2), rankB_r2: mean(b2) };
}

// ── kør + rapportér ───────────────────────────────────────────────────────────
const coupling = runCoupling();
const neutrality = runNeutrality();
const couplingFailures = evaluatePeakCouplingScorecard(coupling);
const neutralityFailures = evaluatePeakNeutralityOracle(neutrality);
const allFailures = [
  ...couplingFailures.map((f) => `koblings-scorecard: ${f}`),
  ...neutralityFailures.map((f) => `neutralitet: ${f}`),
];
// Gate: --enforce → exit 1 ved brud (uanset output-format).
if (ENFORCE && allFailures.length > 0) process.exitCode = 1;

if (AS_JSON) {
  console.log(JSON.stringify({ tuning: {
    PEAK_MAX: RACE_V3_TUNING.PEAK_MAX, PEAK_PAYBACK: RACE_V3_TUNING.PEAK_PAYBACK,
    PEAK_PAYBACK_DAYS: RACE_V3_TUNING.PEAK_PAYBACK_DAYS, PEAK_TQ_FLOOR: RACE_V3_TUNING.PEAK_TQ_FLOOR,
    PEAK_LEADUP_DAYS: RACE_V3_TUNING.PEAK_LEADUP_DAYS, PEAK_TQ_WEIGHTS: RACE_V3_TUNING.PEAK_TQ_WEIGHTS,
  }, coupling, neutrality, couplingFailures, neutralityFailures }, null, 2));
} else {
  const src = POPULATION_PATH ? `population ${POPULATION_PATH} (${pool.length} ryttere)` : `syntetisk (${pool.length} ryttere)`;
  console.log(`\n🏔️  RACE v3 S5 — PEAK-KOBLINGS-HARNESS · seeds=${SEEDS.join(",")} · felt=${FIELD_SIZE} · ${src}`);
  console.log(`   tuning: PEAK_MAX=${RACE_V3_TUNING.PEAK_MAX} PAYBACK=${RACE_V3_TUNING.PEAK_PAYBACK} PAYBACK_DAYS=${RACE_V3_TUNING.PEAK_PAYBACK_DAYS} TQ_FLOOR=${RACE_V3_TUNING.PEAK_TQ_FLOOR} LEADUP=${RACE_V3_TUNING.PEAK_LEADUP_DAYS}`);

  console.log(`\n   KOBLINGS-STIGE (tq → peak-komponent → ⌀mål-placering):`);
  for (const l of coupling.ladder) {
    console.log(`     tq=${l.tq.toFixed(2)}  peak=${l.peak.toFixed(5)}  ⌀rank=${l.meanRank.toFixed(2)}`);
  }
  console.log(`   payback (tq-uafhængig): ${coupling.payback.map((p) => `tq=${p.tq.toFixed(2)}→${p.payback.toFixed(5)}`).join("  ")}`);
  console.log(`   on-track (tq=1) ⌀rank ${coupling.onTrackMeanRank.toFixed(2)} vs behind (tq=${RACE_V3_TUNING.PEAK_TQ_FLOOR}) ⌀rank ${coupling.behindMeanRank.toFixed(2)} → top-margin ${(coupling.behindMeanRank - coupling.onTrackMeanRank).toFixed(2)}`);

  console.log(`\n   NEUTRALITET (A topper løb 1, B topper løb 2):`);
  console.log(`     løb 1: A ⌀rank ${neutrality.rankA_r1.toFixed(2)} vs B ${neutrality.rankB_r1.toFixed(2)}`);
  console.log(`     løb 2: A ⌀rank ${neutrality.rankA_r2.toFixed(2)} vs B ${neutrality.rankB_r2.toFixed(2)}`);

  if (allFailures.length === 0) {
    console.log(`\n   ✅ Alle S5-oracles grønne.`);
  } else if (ENFORCE) {
    console.log(`\n   ❌ ${allFailures.length} S5-oracle-brud (--enforce → exit 1):`);
    for (const f of allFailures) console.log(`      · ${f}`);
  } else {
    console.log(`\n   ⚠ ${allFailures.length} S5-oracle-brud (rapport-only; håndhæv med --enforce):`);
    for (const f of allFailures) console.log(`      · ${f}`);
  }
  console.log("");
}
