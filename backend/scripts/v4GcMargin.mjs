#!/usr/bin/env node
// backend/scripts/v4GcMargin.mjs
// #5578 (M3, spec docs/drafts/spec-motor-runde-2-2026-09-25.md): GT-vindermarginen
// (#2415, "typisk 1-8 min") maalt paa et AKKUMULERET klassement.
//
// headToHeadV4.js kan ikke maale den: den trækker et nyt felt pr. etape, saa
// ingen rytter koerer et helt etapeloeb. Denne harness koerer de pinnede grand
// tours (race_id'er med mindst 21 etaper i etape-filen) med ET fast felt fra
// start til slut, i BEGGE motorer:
//   - klassementet er tid minus bonussekunder, summeret over etaperne
//     (v4: time_seconds og passage_totals.bonus_seconds; v3: stageGap og
//     racePassages' bonus_seconds),
//   - en rytter der udgaar (v4 abandoned, v4 otl, v3 fraværende i ranked) er
//     ude af loebet: han starter ikke naeste etape og taeller ikke i
//     klassementet,
//   - marginen er nr. 2's klassementstid minus nr. 1's.
// Dommen faeldes af headToHeadAnchors.scoreGtWinnerMargin (middel over alle
// grand tours x seeds mod 1-8 min).
//
// Forbehold (aerligt, ikke skjult): feltet er en tilfaeldig stikprøve af
// populationen (som i headToHeadV4.js), ikke en hold-baseret startliste; der
// er ingen traethed fra etape til etape i harnessen (den ligger i raceRunner,
// ikke i motoren); ordrer er "none" (gatens form, §7b).
//
// 100% READ-ONLY: laeser kun JSON-filer fra disk (+ skriver kun --json-filen).
//
// Usage:
//   node backend/scripts/v4GcMargin.mjs [--population=<fil>] [--stages=<fil>]
//     [--seeds=s1,s2,s3] [--field-size=180] [--json=<fil>]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simulateStage, stableSeed } from "../lib/raceSimulator.js";
import { computePassages } from "../lib/racePassages.js";
import { simulateStageV4 } from "../lib/engine/v4/index.ts";
import { RACE_V4_TUNING } from "../lib/engine/v4/tuning.ts";
import { routeFromStageProfileRow } from "../lib/engine/v4/adapters/routeAdapter.ts";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { sampleField } from "./lib/headToHeadStats.js";
import { formatScorecard, scoreGtWinnerMargin } from "./lib/headToHeadAnchors.js";
import { LOCKED_FIELD_SIZE, resolveSeeds, v3EntrantsFromPopulation, v4EntrantsFromPopulation } from "./headToHeadV4.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// Samme pinnede filer som §7b-gaten (baselines/README.md).
export const DEFAULT_POPULATION_FILE = join(SCRIPT_DIR, "baselines", "population-snapshot-2026-09-07.json");
export const DEFAULT_STAGES_FILE = join(SCRIPT_DIR, "baselines", "v4-proxy-stages-2026-09-06.json");
export const DEFAULT_SEEDS = Object.freeze(["s1", "s2", "s3"]);
/** En grand tour i etape-filen = et race_id med mindst saa mange etaper. */
export const GRAND_TOUR_MIN_STAGES = 21;

/**
 * De pinnede grand tours: etaperne grupperet pr. race_id, kun loeb med mindst
 * `minStages` etaper, i etapeorden. Sorteret paa race_id (deterministisk).
 * @returns {Array<{raceId: string, stages: object[]}>}
 */
export function pinGrandTours(stages, minStages = GRAND_TOUR_MIN_STAGES) {
  const byRace = new Map();
  for (const stage of stages) {
    if (!stage.race_id) continue;
    if (!byRace.has(stage.race_id)) byRace.set(stage.race_id, []);
    byRace.get(stage.race_id).push(stage);
  }
  return [...byRace.entries()]
    .filter(([, list]) => list.length >= minStages)
    .map(([raceId, list]) => ({
      raceId,
      stages: [...list].sort((a, b) => (a.race_stage_number ?? a.stage_number) - (b.race_stage_number ?? b.stage_number)),
    }))
    .sort((a, b) => a.raceId.localeCompare(b.raceId));
}

/**
 * Én etapes udfald i klassementets form.
 * @typedef {{finishers: Array<{rider_id: string, seconds: number, bonus: number}>, outRiderIds: string[]}} StageOutcome
 */

/** v4: gennemfoerte ryttere (status finished) med tid og bonus; abandoned/otl er ude. */
export function v4StageOutcome(output) {
  const bonusByRider = new Map((output.passage_totals ?? []).map((t) => [t.rider_id, t.bonus_seconds ?? 0]));
  const finishers = [];
  const outRiderIds = [];
  for (const r of output.results) {
    if (r.status === "finished") finishers.push({ rider_id: r.rider_id, seconds: r.time_seconds, bonus: bonusByRider.get(r.rider_id) ?? 0 });
    else outRiderIds.push(r.rider_id);
  }
  return { finishers, outRiderIds };
}

/** v3: ranked er de gennemfoerte (v3 fjerner udgaaede); tiden er stageGap, bonus fra racePassages. */
export function v3StageOutcome(ranked, perRiderPassages, startRiderIds) {
  const finished = new Set(ranked.map((r) => r.rider_id));
  return {
    finishers: ranked.map((r) => ({
      rider_id: r.rider_id,
      seconds: r.stageGap ?? 0,
      bonus: perRiderPassages?.get?.(r.rider_id)?.bonus_seconds ?? 0,
    })),
    outRiderIds: startRiderIds.filter((id) => !finished.has(id)),
  };
}

/**
 * Akkumulerer klassementet over etape-udfaldene. En rytter der er ude paa en
 * etape (eller mangler i en etapes resultater) er ude af klassementet.
 * @param {string[]} startRiderIds
 * @param {StageOutcome[]} outcomes
 * @returns {{standings: Array<{rider_id: string, gc_seconds: number}>, marginSeconds: number|null}}
 */
export function accumulateGc(startRiderIds, outcomes) {
  const gc = new Map(startRiderIds.map((id) => [id, 0]));
  for (const outcome of outcomes) {
    const finishedIds = new Set();
    for (const f of outcome.finishers) {
      if (!gc.has(f.rider_id)) continue;
      gc.set(f.rider_id, gc.get(f.rider_id) + f.seconds - f.bonus);
      finishedIds.add(f.rider_id);
    }
    for (const id of [...gc.keys()]) if (!finishedIds.has(id)) gc.delete(id);
  }
  const standings = [...gc.entries()]
    .map(([rider_id, gc_seconds]) => ({ rider_id, gc_seconds }))
    .sort((a, b) => a.gc_seconds - b.gc_seconds || a.rider_id.localeCompare(b.rider_id));
  const marginSeconds = standings.length >= 2 ? standings[1].gc_seconds - standings[0].gc_seconds : null;
  return { standings, marginSeconds };
}

/**
 * Koerer én grand tour med ét fast felt i begge motorer.
 * @returns {{raceId: string, seed: string, v3: ReturnType<typeof accumulateGc>, v4: ReturnType<typeof accumulateGc>}}
 */
export function runGrandTour({ population, tour, seed, fieldSize = LOCKED_FIELD_SIZE }) {
  const tourSeed = `${seed}:${tour.raceId}`;
  const field = fieldSize
    ? sampleField(makeRng(stableSeed(`${tourSeed}:field`)), population.riders, fieldSize)
    : population.riders;
  const riderById = new Map(field.map((r) => [r.id, r]));
  const startIds = field.map((r) => r.id);

  let v3InRace = [...startIds];
  let v4InRace = [...startIds];
  const v3Outcomes = [];
  const v4Outcomes = [];
  for (const stageRow of tour.stages) {
    const stageSeedStr = `${tourSeed}:${stageRow.stage_number ?? 1}`;
    const v3Seed = stableSeed(stageSeedStr);

    const v3Entrants = v3EntrantsFromPopulation(v3InRace.map((id) => riderById.get(id)));
    const v3Output = simulateStage({ entrants: v3Entrants, stageProfile: stageRow, seed: v3Seed, v3: true });
    const v3Passages = computePassages({
      ranked: v3Output.ranked, stageProfile: stageRow, entrants: v3Entrants, seed: v3Seed, isStageRace: true,
    });
    const v3Outcome = v3StageOutcome(v3Output.ranked, v3Passages.perRider, v3InRace);
    v3Outcomes.push(v3Outcome);
    const v3Finished = new Set(v3Outcome.finishers.map((f) => f.rider_id));
    v3InRace = v3InRace.filter((id) => v3Finished.has(id));

    const v4Output = simulateStageV4({
      route: routeFromStageProfileRow(stageRow),
      startlist: v4EntrantsFromPopulation(v4InRace.map((id) => riderById.get(id))),
      orders: [],
      seed: stageSeedStr,
      tuning: RACE_V4_TUNING,
    });
    const v4Outcome = v4StageOutcome(v4Output);
    v4Outcomes.push(v4Outcome);
    const v4Finished = new Set(v4Outcome.finishers.map((f) => f.rider_id));
    v4InRace = v4InRace.filter((id) => v4Finished.has(id));
  }
  return { raceId: tour.raceId, seed, v3: accumulateGc(startIds, v3Outcomes), v4: accumulateGc(startIds, v4Outcomes) };
}

/** Alle pinnede grand tours x seeds -> kørsler + anker. */
export function measureGtMargins({ population, stages, seeds = DEFAULT_SEEDS, fieldSize = LOCKED_FIELD_SIZE }) {
  if (!population?.riders?.length) throw new Error("population.riders mangler eller er tom");
  const tours = pinGrandTours(stages);
  if (tours.length === 0) throw new Error(`ingen grand tours (race_id med >= ${GRAND_TOUR_MIN_STAGES} etaper) i etape-filen`);
  const runs = [];
  for (const seed of seeds) {
    for (const tour of tours) runs.push(runGrandTour({ population, tour, seed, fieldSize }));
  }
  const anchor = scoreGtWinnerMargin({
    v3Margins: runs.map((r) => r.v3.marginSeconds),
    v4Margins: runs.map((r) => r.v4.marginSeconds),
  });
  return { tours: tours.map((t) => ({ raceId: t.raceId, stages: t.stages.length })), runs, anchor };
}

function fmtMargin(seconds) {
  if (!Number.isFinite(seconds)) return "n/a";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}

function main() {
  const populationPath = argValue("population", DEFAULT_POPULATION_FILE);
  const stagesPath = argValue("stages", DEFAULT_STAGES_FILE);
  const seedsArg = argValue("seeds");
  const seeds = seedsArg ? resolveSeeds(seedsArg, DEFAULT_SEEDS[0]) : [...DEFAULT_SEEDS];
  const fieldArg = argValue("field-size");
  const fieldSize = fieldArg === "all" ? null : Number(fieldArg ?? LOCKED_FIELD_SIZE);
  const jsonPath = argValue("json");

  const population = JSON.parse(readFileSync(populationPath, "utf8"));
  const stagesFile = JSON.parse(readFileSync(stagesPath, "utf8"));
  const stages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;

  const result = measureGtMargins({ population, stages, seeds, fieldSize });
  console.log(`Grand tours: ${result.tours.map((t) => `${t.raceId} (${t.stages} etaper)`).join(", ")}. Seeds: ${seeds.join(", ")}. Felt: ${fieldSize ?? "hele populationen"}.`);
  console.log("");
  console.log("GT x seed | v3 margin (m:ss) | v4 margin (m:ss) | v3 i maal | v4 i maal");
  for (const run of result.runs) {
    console.log(
      `${run.raceId} ${run.seed} | ${fmtMargin(run.v3.marginSeconds)} | ${fmtMargin(run.v4.marginSeconds)} | ${run.v3.standings.length} | ${run.v4.standings.length}`,
    );
  }
  console.log("");
  console.log(formatScorecard([result.anchor]));

  if (jsonPath) {
    const json = {
      population_file: populationPath,
      stages_file: stagesPath,
      seeds,
      field_size: fieldSize,
      tours: result.tours,
      runs: result.runs.map((r) => ({
        race_id: r.raceId, seed: r.seed,
        v3_margin_seconds: r.v3.marginSeconds, v4_margin_seconds: r.v4.marginSeconds,
        v3_finishers: r.v3.standings.length, v4_finishers: r.v4.standings.length,
      })),
      anchor: {
        id: result.anchor.id,
        v3: { value: result.anchor.v3.value, verdict: result.anchor.v3.verdict, spread: result.anchor.v3.spread ?? null },
        v4: { value: result.anchor.v4.value, verdict: result.anchor.v4.verdict, spread: result.anchor.v4.spread ?? null },
      },
      generated_at: new Date().toISOString(),
    };
    writeFileSync(jsonPath, JSON.stringify(json, null, 2));
    console.log("");
    console.log(`JSON skrevet til: ${jsonPath}`);
  }
}

if (process.argv[1]?.endsWith("v4GcMargin.mjs")) {
  main();
}
