#!/usr/bin/env node
// backend/scripts/dev/gtFatigueBench.mjs
// #5928 (ejer 15/10): GT-traethed. Maaler "i dag" mod den nye belastning (s5_profiles_v1)
// paa de samme S5-Grand Tours som #6362's motor-bench (s5MotorBench.buildS5BenchRaces).
//
// HVAD DEN GOER. Koerer hver GT etape for etape i v4 under s5_profiles_v1, med tilstanden
// afregnet PRAECIS som prod (training_condition_per_date): rytterens traethed laeses ved
// datoens start og bruges paa alle datoens etaper; ved datoens slutning afregnes den EEN
// gang med de 5 loebsdages samlede belastning (trainingDateCondition.settleTrainingDateCondition,
// en etape = en plads, resten traening). Dato = game_day div 5 (5 loebsdage pr. dato).
// To belastningsmodeller koeres paa samme ruter og seeds:
//   today  raceConditionLoads under official_times_v4: profil x indsats fra etape-ordrer
//          (i prod tom for de fleste) = samme tal for hele feltet.
//   gt     raceConditionLoads under s5_profiles_v1: profil x motorens indsats x arbejde x
//          etapens plads (raceFatigue.stageRaceConditionLoad).
// Feltet er det anonymiserede Giro-felt (alle hold AI, M14-ordrer). Managerens traening
// paa GT-datoernes frie pladser: hvert tredje hold "hard", resten "normal".
//
// HARD RULE 17. Maalte tal skrives KUN til balance-internals/ (gitignoreret).
//
// Koer (offline, ingen DB):
//   node backend/scripts/dev/gtFatigueBench.mjs --out=balance-internals/5928
//
// Refs #5928

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildS5BenchRaces, loadBenchField } from "./s5MotorBench.mjs";
import { runStagesInOrder, splitEntrants, sortedStages } from "./lib/tourScorecard.mjs";
import { loadRaceEngineV4 } from "../../lib/raceEngineV4Bridge.js";
import { GT_FATIGUE_TUNING, raceConditionLoads, stageConditionWork, stageRaceConditionLoad } from "../../lib/raceFatigue.js";
import { settleTrainingDateCondition } from "../../lib/trainingDateCondition.js";
import { injuryRisk } from "../../lib/riderCondition.js";
import { seededUnitMixed } from "../../lib/riderProgression.js";
import { DISTANCE_FATIGUE_EXTRA_TUNING } from "../../lib/engine/v4/tuning.ts";

// v4's dag-til-dag-slid: CP-multiplikator = floor + (1 - floor) * (1 - fatigue/100).
const CP_FLOOR = DISTANCE_FATIGUE_EXTRA_TUNING.conditionFloorMultiplier;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..");
const REVISION = "s5_profiles_v1";
const TODAY_LOAD_REVISION = "official_times_v4";
const SLOTS = 5;

export const GT_FATIGUE_BENCH_CONFIG = Object.freeze({ genSeeds: 3, simSeeds: 2, startFatigueLo: 5, startFatigueHi: 25 });

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const sd = (xs) => { const m = mean(xs); return xs.length ? Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) : null; };
const q = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** Dato-indeks (0-baseret inden for GT'en) pr. etape: game_day div 5, normaliseret. */
export function stageDateIndex(stages) {
  const dates = stages.map((s) => Math.floor(Number(s.game_day ?? 0) / SLOTS));
  const first = Math.min(...dates);
  return dates.map((d) => d - first);
}

/** Uge 1/2/3 = tredjedele af GT'ens datoer. */
export function weekOfDate(dateIdx, nDates) {
  return Math.min(3, 1 + Math.floor((dateIdx * 3) / Math.max(1, nDates)));
}

function trainingIntensityForTeam(teamIndex) {
  return teamIndex % 3 === 2 ? "hard" : "normal";
}

/**
 * En GT, en model, et seed. Returnerer pr.-etape- og pr.-dato-maalinger.
 */
function runGt({ v4, field, race, stages, seasonId, simSeed, model, tuning }) {
  const raceId = `${race.id}:${seasonId}`;
  const profiles = stages.map((p) => ({ ...p, race_id: raceId }));
  const data = { ...field, race: { ...field.race, id: raceId, stages: profiles.length }, profiles };
  const sorted = sortedStages(data);
  const dateIdx = stageDateIndex(sorted);
  const nDates = Math.max(...dateIdx) + 1;
  const entrants = splitEntrants(data).entrants;
  const teamIndex = new Map([...new Set(entrants.map((e) => e.team_id))].sort().map((t, i) => [t, i]));
  const recovery = new Map(field.abilities.map((a) => [a.rider_id, Number(a.recovery) || 50]));
  const cond = new Map(entrants.map((e) => {
    const u = seededUnitMixed(`gt5928:start:${seasonId}:${race.id}:${e.rider_id}`);
    const f = Math.round(GT_FATIGUE_BENCH_CONFIG.startFatigueLo + u * (GT_FATIGUE_BENCH_CONFIG.startFatigueHi - GT_FATIGUE_BENCH_CONFIG.startFatigueLo));
    return [e.rider_id, { fatigue: f, form: 50 }];
  }));
  const loadsByDate = new Map(); // dateIdx -> Map(rider -> number[])
  const stageRows = [];
  const dateRows = [];
  const riderStats = new Map(entrants.map((e) => [e.rider_id, { role: e.race_role, team: e.team_id, training: trainingIntensityForTeam(teamIndex.get(e.team_id)), load: 0, front: 0, shelter: 0, protect: 0, stages: 0, risk: 0, peak: 0, cpByWeek: { 1: [], 2: [], 3: [] } }]));
  let currentDate = 0;
  const enterDate = (d) => { for (const e of entrants) e.fatigue = cond.get(e.rider_id).fatigue; currentDate = d; };
  const settleDate = (d, inRaceIds) => {
    const loads = loadsByDate.get(d) ?? new Map();
    const opening = [];
    for (const id of inRaceIds) {
      const raceLoads = loads.get(id) ?? [];
      const st = riderStats.get(id);
      const intensities = Array.from({ length: SLOTS }, (_, i) => (i < raceLoads.length ? "race" : st.training));
      const rl = Array.from({ length: SLOTS }, (_, i) => raceLoads[i] ?? 0);
      const c = cond.get(id);
      opening.push(c.fatigue);
      const res = settleTrainingDateCondition({ riderId: id, dateStr: `${seasonId}-${d}`, condition: c, intensities, raceLoads: rl, recoveryAbility: recovery.get(id) });
      st.risk += intensities.reduce((s, it) => s + injuryRisk({ intensity: it, fatigue: c.fatigue }), 0) / SLOTS;
      cond.set(id, { fatigue: res.fatigue, form: res.form });
      st.peak = Math.max(st.peak, res.fatigue);
      st.cpByWeek[weekOfDate(d, nDates)].push(CP_FLOOR + (1 - CP_FLOOR) * (1 - c.fatigue / 100));
    }
    const closing = inRaceIds.map((id) => cond.get(id).fatigue);
    dateRows.push({ date: d, week: weekOfDate(d, nDates), openMean: mean(opening), closeMean: mean(closing), closeP90: q(closing, 0.9), closeMax: Math.max(...closing), share70: closing.filter((f) => f >= 70).length / closing.length });
  };
  enterDate(0);
  let inRace = entrants;
  const gcFinal = runStagesInOrder({
    v4, data, revision: REVISION, seedTag: `gt5928-${simSeed}`, stages: sorted, entrants,
    onStage: ({ profile, index, res, entrants: started }) => {
      const ids = started.map((e) => e.rider_id);
      const work = stageConditionWork({ rulesRevision: REVISION, stageNumber: profile.stage_number, profileType: profile.profile_type, v4Result: res });
      // gt: samme formel som raceConditionLoads under s5_profiles_v1 (raceFatigue.test.js laaser det),
      // men med en valgfri tuning, saa en kalibrerings-sweep kan koeres uden at aendre koden.
      const loads = model === "gt"
        ? [...new Set(ids)].map((id) => ({ rider_id: id, load: stageRaceConditionLoad({ profileType: profile.profile_type, stageNumber: profile.stage_number, effort: work?.efforts?.get(id) ?? "normal", exposure: work?.exposure?.get(id) ?? null, rulesRevision: REVISION, tuning }) }))
        : raceConditionLoads(ids, profile.profile_type, null, TODAY_LOAD_REVISION);
      const d = dateIdx[index];
      if (!loadsByDate.has(d)) loadsByDate.set(d, new Map());
      const byRider = loadsByDate.get(d);
      for (const { rider_id, load } of loads) {
        if (!byRider.has(rider_id)) byRider.set(rider_id, []);
        byRider.get(rider_id).push(load);
        const st = riderStats.get(rider_id);
        st.load += load; st.stages += 1;
        const ex = work?.exposure?.get(rider_id);
        if (ex) { st.front += ex.front; st.shelter += ex.shelter; }
        if (work?.efforts?.get(rider_id) === "protect") st.protect += 1;
      }
      const rankById = new Map(res.ranked.map((r) => [r.rider_id, r.rank]));
      const loadVals = loads.map((l) => l.load);
      stageRows.push({ stage: profile.stage_number, profile: profile.profile_type, date: d, week: weekOfDate(d, nDates), rankById, loadMean: mean(loadVals), loadSd: sd(loadVals), loadMin: Math.min(...loadVals), loadMax: Math.max(...loadVals) });
      inRace = inRace.filter((e) => rankById.has(e.rider_id));
      const nextD = index + 1 < sorted.length ? dateIdx[index + 1] : nDates;
      if (nextD !== d) {
        for (let dd = d; dd < nextD; dd++) settleDate(dd, inRace.map((e) => e.rider_id));
        enterDate(nextD);
      }
    },
  });
  return { stageRows, dateRows, riderStats, finalIds: inRace.map((e) => e.rider_id), gcTop10: gcFinal.slice(0, 10).map((g) => g.rider_id), cond };
}

export async function runGtFatigueBench({ genSeeds = GT_FATIGUE_BENCH_CONFIG.genSeeds, simSeeds = GT_FATIGUE_BENCH_CONFIG.simSeeds, tuning = GT_FATIGUE_TUNING } = {}) {
  const v4 = await loadRaceEngineV4();
  const field = loadBenchField();
  const races = buildS5BenchRaces({ scope: "gt", genSeeds });
  const result = {};
  for (const model of ["today", "gt"]) {
    const weekRank = { 1: [], 2: [], 3: [] };
    const weekOpen = { 1: [], 2: [], 3: [] };
    const dates = [];
    const loadsAll = [];
    const riders = [];
    const finalFatigue = [];
    const gtCount = [];
    for (const { seasonId, race, stages } of races) {
      for (let s = 1; s <= simSeeds; s++) {
        const r = runGt({ v4, field, race, stages, seasonId, simSeed: s, model, tuning });
        const top10 = r.gcTop10;
        for (const row of r.stageRows) {
          const ranks = top10.map((id) => row.rankById.get(id)).filter((x) => x != null);
          weekRank[row.week].push(mean(ranks));
          loadsAll.push(row);
        }
        for (const d of r.dateRows) { dates.push(d); weekOpen[d.week].push(d.openMean); }
        for (const [id, st] of r.riderStats) if (st.stages > 0) riders.push({ ...st, loadPerStage: st.load / st.stages, frontShare: st.front / st.stages, shelterShare: st.shelter / st.stages, protectShare: st.protect / st.stages, endFatigue: r.cond.get(id).fatigue, top10: top10.includes(id) });
        for (const id of r.finalIds) finalFatigue.push(r.cond.get(id).fatigue);
        gtCount.push(1);
      }
    }
    const byWeek = (o) => Object.fromEntries(Object.entries(o).map(([w, xs]) => [w, r1(mean(xs))]));
    const group = (pred) => { const xs = riders.filter(pred); return { n: xs.length, loadPerStage: r1(mean(xs.map((x) => x.loadPerStage))), endFatigue: r1(mean(xs.map((x) => x.endFatigue))), peak: r1(mean(xs.map((x) => x.peak))), sharePeak70: r1(100 * xs.filter((x) => x.peak >= 70).length / Math.max(1, xs.length)), cpCostByWeekPct: Object.fromEntries([1, 2, 3].map((w) => [w, r1(100 * (1 - mean(xs.flatMap((x) => x.cpByWeek[w])))) ])), expectedInjuries: Math.round(xs.reduce((t, x) => t + x.risk, 0) * 100) / 100 }; };
    const frontQ = q(riders.map((x) => x.frontShare), 0.8);
    result[model] = {
      runs: gtCount.length,
      top10AvgStageRankByWeek: byWeek(weekRank),
      openingFatigueByWeek: byWeek(weekOpen),
      dates: {
        maxCloseMean: r1(Math.max(...dates.map((d) => d.closeMean))),
        maxCloseP90: r1(Math.max(...dates.map((d) => d.closeP90))),
        maxCloseMax: Math.max(...dates.map((d) => d.closeMax)),
        maxShare70: r1(100 * Math.max(...dates.map((d) => d.share70))),
      },
      stageLoad: { mean: r1(mean(loadsAll.map((x) => x.loadMean))), withinStageSdMean: r1(mean(loadsAll.map((x) => x.loadSd))), min: r1(Math.min(...loadsAll.map((x) => x.loadMin))), max: r1(Math.max(...loadsAll.map((x) => x.loadMax))), byWeek: byWeek(loadsAll.reduce((o, x) => { (o[x.week] ??= []).push(x.loadMean); return o; }, { 1: [], 2: [], 3: [] })) },
      finalFatigue: { mean: r1(mean(finalFatigue)), p90: r1(q(finalFatigue, 0.9)), max: Math.max(...finalFatigue) },
      groups: {
        helpersWorking: group((x) => x.role === "helper" && (x.protectShare >= 0.5 || x.frontShare >= frontQ)),
        helpersSpared: group((x) => x.role === "helper" && x.protectShare < 0.5 && x.frontShare < frontQ),
        captains: group((x) => x.role === "captain"),
        all: group(() => true),
        top10: group((x) => x.top10),
        trainingNormal: group((x) => x.training === "normal"),
        trainingHard: group((x) => x.training === "hard"),
      },
    };
  }
  return result;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const genArg = process.argv.find((a) => a.startsWith("--gen-seeds="));
  const simArg = process.argv.find((a) => a.startsWith("--sim-seeds="));
  // Kalibrering: --tuning='{"accumulationPerStage":0.07}' lægges oven på GT_FATIGUE_TUNING.
  const tuningArg = process.argv.find((a) => a.startsWith("--tuning="));
  const res = await runGtFatigueBench({
    ...(genArg ? { genSeeds: Number(genArg.split("=")[1]) } : {}),
    ...(simArg ? { simSeeds: Number(simArg.split("=")[1]) } : {}),
    ...(tuningArg ? { tuning: { ...GT_FATIGUE_TUNING, ...JSON.parse(tuningArg.slice("--tuning=".length)) } } : {}),
  });
  const json = JSON.stringify(res, null, 2);
  if (outArg) {
    const dir = path.resolve(REPO_ROOT, outArg.split("=")[1]);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "gt-fatigue-bench.json"), json);
    console.log(`skrevet: ${path.join(dir, "gt-fatigue-bench.json")}`);
  } else {
    console.log(json);
  }
}
