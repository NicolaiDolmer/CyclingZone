#!/usr/bin/env node
// backend/scripts/v4FormPeakPaired.mjs
// #6156: parrede simuleringer med og uden samlet form i loebsmotor v4
// (gaten foer taending, spec docs/superpowers/specs/2026-10-04-form-og-formtoppe-i-v4-design.md §3.6).
//
// Tre arme paa PRAECIS samme felt, rute og motor-seed pr. etape:
//   A  "uden form"   orders_gc_v3, intet Entrant.form (dagens motor-regler for v3)
//   F  "kun form"    orders_gc_v4, Entrant.form = rytterens form fra snapshottet
//   P  "form + top"  orders_gc_v4, samme form + formtop/dyk for en fast delmaengde
//
// A mod F/P svarer paa "brydes v4's kalibreringsbaand?" (samme ankre og samme
// favorit-definitioner som v4FlipReadiness: lib/headToHeadAnchors.buildScorecard).
// F mod P isolerer selve toppen: "kan den maerkes, og afgoer den loebet alene?".
// Toppen regnes gennem broens EGEN combinedFormForStage (samme regnestykke som
// prod og som formplanlaeggeren viser), ikke en kopi.
//
// 100 % READ-ONLY: laeser kun de committede baselines. Ingen DB, intet netvaerk.
// Tallene skrives KUN til en gitignoreret fil (hard rule 17, repoet er offentligt).
//
// Usage:
//   node backend/scripts/v4FormPeakPaired.mjs [--seeds=s1,s2,s3,s4,s5] [--out=balance-internals/6156/paired.json]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { simulateStage, stableSeed } from "../lib/raceSimulator.js";
import { combinedFormForStage } from "../lib/raceEngineV4Bridge.js";
import { RACE_V3_TUNING } from "../lib/raceRoles.js";
import { simulateStageV4WithTrace } from "../lib/engine/v4/index.ts";
import { RACE_V4_TUNING } from "../lib/engine/v4/tuning.ts";
import { FORM_CP_TUNING } from "../lib/engine/v4/physiology.ts";
import { routeFromStageProfileRow } from "../lib/engine/v4/adapters/routeAdapter.ts";
import { v3EntrantsFromPopulation, v4EntrantsFromPopulation } from "./headToHeadV4.js";
import { aggregateScorecards, buildScorecard } from "./lib/headToHeadAnchors.js";
import { sampleField } from "./lib/headToHeadStats.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { HEAD_TO_HEAD_SEEDS, FIELD_SIZE, POPULATION_FILE, STAGES_FILE } from "./v4FlipReadiness.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Andel af feltet paa top / i dykket pr. etape (fast, deterministisk pr. seed+etape). */
export const PEAK_SHARE = 0.12;
export const PAYBACK_SHARE = 0.06;
/** En vilkaarlig CET-ordinal: kun forholdet mellem dag og vindue betyder noget. */
const STAGE_DAY = 30000;
const PEAK_WINDOW = (tq) => ({ start: STAGE_DAY - 2, end: STAGE_DAY + 2, trainingQuality: tq });
const PAYBACK_WINDOW = { start: STAGE_DAY - 6, end: STAGE_DAY - 1, trainingQuality: 1 };

export const ARMS = Object.freeze({
  A: { label: "uden form (orders_gc_v3)", rulesRevision: "orders_gc_v3", form: false, peaks: false },
  F: { label: "kun form (orders_gc_v4)", rulesRevision: "orders_gc_v4", form: true, peaks: false },
  P: { label: "form + top/dyk (orders_gc_v4)", rulesRevision: "orders_gc_v4", form: true, peaks: true },
});

/**
 * Hvem er paa top, hvem er i dykket, og med hvilken traeningskvalitet?
 * Deterministisk af (seed, etape); uafhaengig af evnerne (en top gives ikke kun
 * til de staerke), saa F mod P maaler toppen, ikke et udvalg.
 */
export function assignPeaks(fieldRiders, stageSeedStr) {
  const rng = makeRng(stableSeed(`${stageSeedStr}:peaks-6156`));
  const peaks = new Map();
  for (const r of fieldRiders) {
    const u = rng();
    const tqU = rng();
    if (u < PEAK_SHARE) {
      const tq = RACE_V3_TUNING.PEAK_TQ_FLOOR + tqU * (1 - RACE_V3_TUNING.PEAK_TQ_FLOOR);
      peaks.set(r.id, { phase: "peak", windows: [PEAK_WINDOW(tq)] });
    } else if (u < PEAK_SHARE + PAYBACK_SHARE) {
      peaks.set(r.id, { phase: "payback", windows: [PAYBACK_WINDOW] });
    }
  }
  return peaks;
}

function withForm(v4Entrants, fieldRiders, peaks, arm) {
  if (!arm.form) return v4Entrants;
  const byId = new Map(fieldRiders.map((r) => [r.id, r]));
  return v4Entrants.map((e) => {
    const rider = byId.get(e.rider_id);
    const peak = arm.peaks ? peaks.get(e.rider_id) : null;
    const form = combinedFormForStage({ form: rider?.form ?? null, ...(peak ? { peakWindows: peak.windows } : {}) }, STAGE_DAY);
    return form === null ? e : { ...e, form };
  });
}

function row(stageRow, fieldRiders, route, v3Output, v4Output, v4Trace, rulesRevision) {
  return {
    stageNumber: stageRow.stage_number ?? "?",
    profileType: stageRow.profile_type ?? "?",
    fieldSize: fieldRiders.length,
    raw: { v3Output, v4Output, v4Trace, route, tuning: RACE_V4_TUNING, stageRow, rulesRevision, roles: null },
  };
}

function finishedRanks(output) {
  const ranks = new Map();
  for (const r of output.results) if (r.status !== "abandoned" && r.status !== "otl") ranks.set(r.rider_id, r.rank);
  return ranks;
}

function emptyPeakAcc() {
  return {
    peak: { n: 0, rankGainSum: 0, top10F: 0, top10P: 0, wins: 0 },
    payback: { n: 0, rankLossSum: 0, top10F: 0, top10P: 0 },
    stages: 0,
    winnerChanged: 0,
    peakedWinnerFromOutsideTop10: 0,
    peakedWinnerFromOutsideTop20: 0,
    fieldShare: { peak: 0, riders: 0 },
  };
}

/** F mod P: hvad flytter toppen (og dykket) for netop de ryttere der har den? */
export function accumulatePeakEffect(acc, outF, outP, peaks) {
  const rF = finishedRanks(outF);
  const rP = finishedRanks(outP);
  acc.stages++;
  acc.fieldShare.riders += rF.size;
  const winnerF = outF.results[0]?.rider_id;
  const winnerP = outP.results[0]?.rider_id;
  if (winnerF !== winnerP) acc.winnerChanged++;
  for (const [id, p] of peaks) {
    const a = rF.get(id);
    const b = rP.get(id);
    if (a == null || b == null) continue;
    if (p.phase === "peak") {
      acc.fieldShare.peak++;
      acc.peak.n++;
      acc.peak.rankGainSum += a - b;
      if (a <= 10) acc.peak.top10F++;
      if (b <= 10) acc.peak.top10P++;
      if (id === winnerP) {
        acc.peak.wins++;
        if (a > 10) acc.peakedWinnerFromOutsideTop10++;
        if (a > 20) acc.peakedWinnerFromOutsideTop20++;
      }
    } else {
      acc.payback.n++;
      acc.payback.rankLossSum += b - a;
      if (a <= 10) acc.payback.top10F++;
      if (b <= 10) acc.payback.top10P++;
    }
  }
  return acc;
}

export function summarizePeakEffect(acc) {
  const ratio = (x, y) => (y > 0 ? x / y : null);
  return {
    stages: acc.stages,
    peak: {
      riderStages: acc.peak.n,
      meanRankGain: ratio(acc.peak.rankGainSum, acc.peak.n),
      top10RateWithout: ratio(acc.peak.top10F, acc.peak.n),
      top10RateWith: ratio(acc.peak.top10P, acc.peak.n),
      winShareOfStages: ratio(acc.peak.wins, acc.stages),
      fieldShare: ratio(acc.fieldShare.peak, acc.fieldShare.riders),
    },
    payback: {
      riderStages: acc.payback.n,
      meanRankLoss: ratio(acc.payback.rankLossSum, acc.payback.n),
      top10RateWithout: ratio(acc.payback.top10F, acc.payback.n),
      top10RateWith: ratio(acc.payback.top10P, acc.payback.n),
    },
    winnerChangedShare: ratio(acc.winnerChanged, acc.stages),
    peakedWinnerFromOutsideTop10Share: ratio(acc.peakedWinnerFromOutsideTop10, acc.stages),
    peakedWinnerFromOutsideTop20Share: ratio(acc.peakedWinnerFromOutsideTop20, acc.stages),
  };
}

/**
 * Koer alle tre arme paa alle seeds. Returnerer scorecards pr. arm (aggregeret
 * over seeds, samme form som v4FlipReadiness) + toppens effekt (F mod P).
 */
export function runPaired({ population, stages, seeds = HEAD_TO_HEAD_SEEDS, fieldSize = FIELD_SIZE }) {
  const teamByRider = new Map(population.riders.map((r) => [r.id, r.team_id ?? null]));
  const abilitiesByRider = new Map(population.riders.map((r) => [r.id, r.abilities]));
  const v4EntrantsById = Object.fromEntries(v4EntrantsFromPopulation(population.riders).map((e) => [e.rider_id, e]));
  const cards = { A: [], F: [], P: [] };
  const peakAcc = emptyPeakAcc();
  const perSeedPeak = [];
  for (const seed of seeds) {
    const rows = { A: [], F: [], P: [] };
    const seedAcc = emptyPeakAcc();
    for (const stageRow of stages) {
      const stageSeedStr = `${seed}:${stageRow.stage_number ?? 1}`;
      const fieldRiders = sampleField(makeRng(stableSeed(`${stageSeedStr}:field`)), population.riders, fieldSize);
      const route = routeFromStageProfileRow(stageRow);
      const v3Output = simulateStage({ entrants: v3EntrantsFromPopulation(fieldRiders), stageProfile: stageRow, seed: stableSeed(stageSeedStr), v3: true });
      const baseV4 = v4EntrantsFromPopulation(fieldRiders);
      const peaks = assignPeaks(fieldRiders, stageSeedStr);
      const outputs = {};
      for (const [key, arm] of Object.entries(ARMS)) {
        const { output, trace } = simulateStageV4WithTrace({
          route,
          startlist: withForm(baseV4, fieldRiders, peaks, arm),
          orders: [],
          seed: stageSeedStr,
          tuning: RACE_V4_TUNING,
          rules_revision: arm.rulesRevision,
        });
        outputs[key] = output;
        rows[key].push(row(stageRow, fieldRiders, route, v3Output, output, trace, arm.rulesRevision));
      }
      accumulatePeakEffect(peakAcc, outputs.F, outputs.P, peaks);
      accumulatePeakEffect(seedAcc, outputs.F, outputs.P, peaks);
    }
    for (const key of Object.keys(ARMS)) {
      cards[key].push(buildScorecard(rows[key], { teamByRider, abilitiesByRider, v4EntrantsById, rulesRevision: ARMS[key].rulesRevision }));
    }
    perSeedPeak.push({ seed, ...summarizePeakEffect(seedAcc) });
  }
  const anchors = {};
  for (const key of Object.keys(ARMS)) anchors[key] = aggregateScorecards(cards[key]);
  return { anchors, peakEffect: summarizePeakEffect(peakAcc), perSeedPeak };
}

/** Ankrene side om side: v4-cellen pr. arm (middel, spaend, dom). */
export function anchorTable(anchors) {
  return anchors.A.map((anchor, i) => {
    const cell = (key) => {
      const v4 = anchors[key][i]?.v4 ?? {};
      return { value: v4.value ?? null, verdict: v4.verdict ?? null, min: v4.spread?.min ?? null, max: v4.spread?.max ?? null };
    };
    return { id: anchor.id, label: anchor.label ?? anchor.id, band: anchor.band_label ?? anchor.bandLabel ?? null, A: cell("A"), F: cell("F"), P: cell("P") };
  });
}

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}

const abs = (p) => (isAbsolute(p) ? p : join(REPO_ROOT, p));

async function main() {
  const seeds = (argValue("seeds") ?? HEAD_TO_HEAD_SEEDS.join(",")).split(",").filter(Boolean);
  const out = argValue("out", "balance-internals/6156/v4-form-peak-paired.json");
  const population = JSON.parse(readFileSync(abs(POPULATION_FILE), "utf8"));
  const stagesFile = JSON.parse(readFileSync(abs(STAGES_FILE), "utf8"));
  const allStages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;
  // --limit=N: kun de foerste N etaper (roegtest); udeladt = hele kalenderen.
  const limit = Number(argValue("limit", 0));
  const stages = limit > 0 ? allStages.slice(0, limit) : allStages;
  console.log(`[6156] parrede arme A/F/P, seeds ${seeds.join(",")} x ${stages.length} etaper, felt ${FIELD_SIZE} ...`);
  const t0 = Date.now();
  const { anchors, peakEffect, perSeedPeak } = runPaired({ population, stages, seeds });
  const result = {
    meta: {
      generated_at: new Date().toISOString(),
      population_file: POPULATION_FILE,
      stages_file: STAGES_FILE,
      seeds,
      field_size: FIELD_SIZE,
      peak_share: PEAK_SHARE,
      payback_share: PAYBACK_SHARE,
      form_cp_tuning: FORM_CP_TUNING,
      seconds: Math.round((Date.now() - t0) / 1000),
    },
    anchors: anchorTable(anchors),
    peakEffect,
    perSeedPeak,
  };
  const outAbs = abs(out);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, JSON.stringify(result, null, 2));
  console.log(`[6156] faerdig paa ${result.meta.seconds} s - privat tal-fil: ${outAbs}`);
}

if (process.argv[1]?.endsWith("v4FormPeakPaired.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
