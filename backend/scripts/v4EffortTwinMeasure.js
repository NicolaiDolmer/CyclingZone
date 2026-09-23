#!/usr/bin/env node
// backend/scripts/v4EffortTwinMeasure.js
// #4914 (kalibreringspakken, M12 all_out + grupetto-tempo): MAALER hvad et
// indsatsvalg koster og koeber i v4, paa den PINNEDE population + de PINNEDE
// proxy-etaper (samme to filer som ankertabellen, RACE_ENGINE_RULES §7b), over
// 5 seeds.
//
// HVORFOR et eget script: ankertabellen koerer `orders=none` (alle paa
// 'normal'), og `--orders=ai` saetter aldrig all_out eller grupetto. Begge
// indsatsvalg er derfor USYNLIGE for alle 13 ankre — en aendring af dem kan
// hverken fælde eller bekraefte et anker. Dette script er den maaling der kan.
//
// To dele:
//
//   1. TVILLINGER (samme metode som PR #4909's tvillinge-maaling, nu paa de
//      pinnede filer): to IDENTISKE ryttere i SAMME loeb, kun indsatsvalget
//      adskiller dem. Hver etape koeres to gange med byttede rider_id'er, og
//      deltaerne midles — saa hverken rider_id-tie-breaket i finalen eller de
//      rider_id-noeglede rng-stroemme kan give et valg en skjult fordel.
//      Tvillingen klones fra feltets rytter ved en given percentil af ETAPENS
//      egen styrke (laengde-vaegtet CP over etapens segmenter).
//
//   2. GRUPETTO-SCENARIE (grupetto-tempo-kontakten, #4914 punkt 3): paa
//      bjerg-/hoejbjerg-etaper koerer den svageste andel af feltet grupetto,
//      som en manager ville saette sine ikke-klatrere. Maaler de ankre og den
//      hale-gate der kan se forskel paa de to tempo-modeller.
//
// KONTAKTERNE ligger i motorens egen tuning (deep-frosset ved import), saa en
// A/B koeres som to koersler med hver sin vaerdi paa disken — scriptet skriver
// de maalte tuning-vaerdier med i JSON'en, saa en maaling altid baerer sin egen
// variant (samme moenster som teamPlayAbMeasure.mjs).
//
// Usage:
//   node backend/scripts/v4EffortTwinMeasure.js [--label=A] [--seeds=s1,s2,s3,s4,s5] [--json=<fil>]
//
// 100% READ-ONLY: laeser kun de pinnede JSON-filer. Skriver kun til --json.
// HARD RULE 17: tallene er motor-interne maalinger og hoerer i
// balance-internals/, ikke i PR-body/issue — kun anker-tal er offentlige.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { stableSeed } from "../lib/raceSimulator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { simulateStageV4 } from "../lib/engine/v4/index.ts";
import {
  EFFORT_COST_EXTRA_TUNING,
  GROUP_TEMPO_EFFORT_EXTRA_TUNING,
  RACE_V4_TUNING,
} from "../lib/engine/v4/tuning.ts";
import { deriveCp } from "../lib/engine/v4/physiology.ts";
import { entrantsFromAbilitiesRows } from "../lib/engine/v4/adapters/entrantAdapter.ts";
import { routeFromStageProfileRow } from "../lib/engine/v4/adapters/routeAdapter.ts";
import { sampleField, median, mean } from "./lib/headToHeadStats.js";
import { scoreDescentVsSummitRatio, scoreFieldCohesion, scoreGapRealism } from "./lib/headToHeadAnchors.js";
import { evaluateTailGate, measureTailSpread } from "./v4TailSpread.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");

const POPULATION_FILE = "backend/scripts/baselines/population-snapshot-2026-09-07.json";
const STAGES_FILE = "backend/scripts/baselines/v4-proxy-stages-2026-09-06.json";
export const DEFAULT_SEEDS = Object.freeze(["s1", "s2", "s3", "s4", "s5"]);
// Hale-gaten er ejer-laast paa 3 seeds (§9 raekke 13) — domme gives paa dem.
export const TAIL_GATE_SEEDS = Object.freeze(["s1", "s2", "s3"]);
const FIELD_SIZE = 180;

/** Tvillingens niveau: percentil af feltet paa etapens egen styrke. */
export const TWIN_LEVELS = Object.freeze({ mid: 0.5, strong: 0.9 });
export const TWIN_EFFORTS = Object.freeze(["all_out", "grupetto"]);

/** Grupetto-scenariet: hvilke profiler, og hvor stor en andel af feltet. */
export const GRUPETTO_SCENARIO = Object.freeze({ profiles: ["mountain", "high_mountain"], fieldShare: 0.3 });

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}

function readJson(relPath) {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), "utf8"));
}

/**
 * Etapens egen styrke for en rytter: CP pr. segment-terraen, vaegtet med
 * segmentets laengde. Ren funktion — ingen rng, ingen state.
 */
export function stageStrength(abilities, route, tuning = RACE_V4_TUNING) {
  let total = 0;
  let km = 0;
  for (const seg of route.segments ?? []) {
    const len = Math.max(0, seg.to_km - seg.from_km);
    total += deriveCp(abilities, seg.kind, tuning.physiology.cpWeights) * len;
    km += len;
  }
  return km > 0 ? total / km : 0;
}

function fieldFor(seed, stageRow, population) {
  const stageSeedStr = `${seed}:${stageRow.stage_number ?? 1}`;
  const rng = makeRng(stableSeed(`${stageSeedStr}:field`));
  return { stageSeedStr, riders: sampleField(rng, population.riders, FIELD_SIZE) };
}

function baseEntrants(fieldRiders) {
  const rows = fieldRiders.map((r) => ({ rider_id: r.id, ...r.abilities }));
  return entrantsFromAbilitiesRows(rows, () => ({ role: "free_role", effort: "normal", condition: 1 }));
}

/**
 * Startliste med to tvillinger klonet fra rytteren ved `percentile` af feltets
 * etape-styrke. Den klonede rytter og hans naermeste nabo i styrke tages ud,
 * saa feltstoerrelsen er uaendret. `swap` bytter hvilket rider_id der faar
 * indsatsvalget.
 */
export function twinStartlist(entrants, route, percentile, effort, swap) {
  const ranked = [...entrants].sort(
    (a, b) => stageStrength(a.abilities, route) - stageStrength(b.abilities, route) || a.rider_id.localeCompare(b.rider_id),
  );
  const idx = Math.min(ranked.length - 1, Math.max(0, Math.floor(percentile * (ranked.length - 1))));
  const chosen = ranked[idx];
  const neighbour = ranked[idx > 0 ? idx - 1 : idx + 1];
  const drop = new Set([chosen.rider_id, neighbour?.rider_id]);
  const idX = swap ? "twin-2" : "twin-1";
  const idN = swap ? "twin-1" : "twin-2";
  const clone = (rider_id, eff) => ({ ...chosen, rider_id, effort: eff });
  return {
    startlist: [...entrants.filter((e) => !drop.has(e.rider_id)), clone(idX, effort), clone(idN, "normal")],
    idX,
    idN,
  };
}

function riderOutcome(output, riderId) {
  const result = output.results.find((r) => r.rider_id === riderId);
  const load = output.loads.find((l) => l.rider_id === riderId);
  return {
    rank: result?.rank ?? null,
    time: result?.time_seconds ?? null,
    status: result?.status ?? null,
    secondsOverCp: load?.seconds_over_cp ?? 0,
    workNorm: load?.work_norm ?? 0,
  };
}

/** Én tvillinge-maaling: to koersler med byttede id'er, deltaer midlet. */
function measureTwinPair({ entrants, route, stageSeedStr, percentile, effort }) {
  const deltas = [];
  for (const swap of [false, true]) {
    const { startlist, idX, idN } = twinStartlist(entrants, route, percentile, effort, swap);
    const output = simulateStageV4({ route, startlist, orders: [], seed: stageSeedStr, tuning: RACE_V4_TUNING });
    const x = riderOutcome(output, idX);
    const n = riderOutcome(output, idN);
    deltas.push({ x, n, winnerTime: Math.min(...output.results.map((r) => r.time_seconds)) });
  }
  const avg = (fn) => (fn(deltas[0]) + fn(deltas[1])) / 2;
  return {
    rankDelta: avg((d) => d.x.rank - d.n.rank),
    timeDelta: avg((d) => d.x.time - d.n.time),
    xSecondsOverCp: avg((d) => d.x.secondsOverCp),
    nSecondsOverCp: avg((d) => d.n.secondsOverCp),
    workDelta: avg((d) => d.x.workNorm - d.n.workNorm),
    xWins: deltas.filter((d) => d.x.rank === 1).length / 2,
    xTop10: deltas.filter((d) => d.x.rank <= 10).length / 2,
    xOtl: deltas.filter((d) => d.x.status === "otl").length / 2,
    nOtl: deltas.filter((d) => d.n.status === "otl").length / 2,
    xGapPct: avg((d) => (d.winnerTime > 0 ? ((d.x.time - d.winnerTime) / d.winnerTime) * 100 : 0)),
  };
}

/** Reducerer tvillinge-maalinger til én raekke pr. (valg, niveau, profil). */
export function summarizeTwins(samples) {
  const groups = new Map();
  for (const s of samples) {
    const key = `${s.effort}|${s.level}|${s.profileType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const rows = [];
  for (const [key, list] of groups) {
    const [effort, level, profileType] = key.split("|");
    const rankDeltas = list.map((s) => s.rankDelta);
    rows.push({
      effort,
      level,
      profileType,
      n: list.length,
      meanRankDelta: mean(rankDeltas),
      medianRankDelta: median(rankDeltas),
      shareWorse: list.filter((s) => s.rankDelta > 0).length / list.length,
      shareBetter: list.filter((s) => s.rankDelta < 0).length / list.length,
      medianTimeDelta: median(list.map((s) => s.timeDelta)),
      medianXSecondsOverCp: median(list.map((s) => s.xSecondsOverCp)),
      shareXOverCp: list.filter((s) => s.xSecondsOverCp > 0).length / list.length,
      medianWorkDelta: median(list.map((s) => s.workDelta)),
      xWins: list.reduce((a, s) => a + s.xWins, 0),
      xTop10: list.reduce((a, s) => a + s.xTop10, 0),
      xOtl: list.reduce((a, s) => a + s.xOtl, 0),
      nOtl: list.reduce((a, s) => a + s.nOtl, 0),
      medianXGapPct: median(list.map((s) => s.xGapPct)),
    });
  }
  return rows.sort((a, b) => `${a.effort}${a.level}${a.profileType}`.localeCompare(`${b.effort}${b.level}${b.profileType}`));
}

export function runTwins({ population, stages, seeds }) {
  const samples = [];
  for (const seed of seeds) {
    for (const stageRow of stages) {
      const route = routeFromStageProfileRow(stageRow);
      const { stageSeedStr, riders } = fieldFor(seed, stageRow, population);
      const entrants = baseEntrants(riders);
      for (const [level, percentile] of Object.entries(TWIN_LEVELS)) {
        for (const effort of TWIN_EFFORTS) {
          samples.push({
            seed,
            stageNumber: stageRow.stage_number,
            profileType: stageRow.profile_type ?? "?",
            level,
            effort,
            ...measureTwinPair({ entrants, route, stageSeedStr, percentile, effort }),
          });
        }
      }
    }
  }
  return summarizeTwins(samples);
}

/**
 * Grupetto-scenariet: paa de udvalgte profiler koerer den svageste andel af
 * feltet (paa etapens egen styrke) grupetto. Alle andre etaper koeres som i
 * ankertabellen. Returnerer anker-raekker (v4-siden) + hale + tidsgraense.
 */
export function runGrupettoScenario({ population, stages, seeds }) {
  const rows = [];
  const tail = [];
  let grupettoRiders = 0;
  let grupettoOtl = 0;
  let grupettoLastGroup = 0;
  for (const seed of seeds) {
    for (const stageRow of stages) {
      const route = routeFromStageProfileRow(stageRow);
      const { stageSeedStr, riders } = fieldFor(seed, stageRow, population);
      let entrants = baseEntrants(riders);
      const applies = GRUPETTO_SCENARIO.profiles.includes(route.profile_type);
      const grupettoIds = new Set();
      if (applies) {
        const ranked = [...entrants].sort(
          (a, b) => stageStrength(a.abilities, route) - stageStrength(b.abilities, route) || a.rider_id.localeCompare(b.rider_id),
        );
        for (const e of ranked.slice(0, Math.floor(ranked.length * GRUPETTO_SCENARIO.fieldShare))) grupettoIds.add(e.rider_id);
        entrants = entrants.map((e) => (grupettoIds.has(e.rider_id) ? { ...e, effort: "grupetto" } : e));
      }
      const output = simulateStageV4({ route, startlist: entrants, orders: [], seed: stageSeedStr, tuning: RACE_V4_TUNING });
      rows.push({ raw: { route, v3Output: { ranked: [] }, v4Output: output } });
      if (TAIL_GATE_SEEDS.includes(seed)) {
        tail.push({ seed, profileType: stageRow.profile_type ?? "?", ...measureTailSpread(output) });
      }
      if (applies) {
        const lastTime = Math.max(...output.results.filter((r) => r.status !== "abandoned").map((r) => r.time_seconds));
        for (const r of output.results) {
          if (!grupettoIds.has(r.rider_id)) continue;
          grupettoRiders += 1;
          if (r.status === "otl") grupettoOtl += 1;
          if (r.time_seconds === lastTime) grupettoLastGroup += 1;
        }
      }
    }
  }
  const anchors = [scoreFieldCohesion(rows), scoreDescentVsSummitRatio(rows), scoreGapRealism(rows)[0]].map((a) => ({
    id: a.id,
    label: a.label,
    band: a.bandLabel,
    value: a.v4.value,
    verdict: a.v4.verdict,
    n: a.v4.sampleCount,
  }));
  const mountainTail = tail.filter((t) => GRUPETTO_SCENARIO.profiles.includes(t.profileType));
  return {
    anchors,
    tailGate: evaluateTailGate(tail),
    mountainOtlRiders: mountainTail.reduce((a, t) => a + t.otlCount, 0),
    mountainRescuedRiders: mountainTail.reduce((a, t) => a + t.rescuedCount, 0),
    grupettoRiders,
    grupettoOtlShare: grupettoRiders > 0 ? grupettoOtl / grupettoRiders : null,
    grupettoInLastGroupShare: grupettoRiders > 0 ? grupettoLastGroup / grupettoRiders : null,
  };
}

function fmt(n, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : "n/a";
}

export function formatReport(result) {
  const lines = [];
  lines.push(`# v4EffortTwinMeasure — ${result.label ?? "-"} (${result.generated_at})`);
  lines.push(`Tuning: grupetto-tempo-model ${result.group_tempo_tuning.model} (faktor ${result.group_tempo_tuning.grupettoTempoFactor}), all_out-profiltabel ${JSON.stringify(result.effort_cost_tuning.demandMultiplierAllOutByProfile ?? {})}`);
  lines.push(`Seeds: ${result.seeds.join(", ")} · felt ${result.field_size}`);
  lines.push("");
  lines.push("## Tvillinger (valg vs. normal, samme loeb; + = daarligere)");
  lines.push("valg\tniveau\tprofil\tn\tmiddel-plads\tmedian-plads\tandel-daarligere\tandel-bedre\tmedian-tid-s\tmedian-sek-over-CP\tandel-over-CP\tmedian-work\tsejre\ttop10\tOTL(valg/normal)\tmedian-gab-%");
  for (const r of result.twins) {
    lines.push([
      r.effort, r.level, r.profileType, r.n, fmt(r.meanRankDelta), fmt(r.medianRankDelta), fmt(r.shareWorse), fmt(r.shareBetter),
      fmt(r.medianTimeDelta, 1), fmt(r.medianXSecondsOverCp, 0), fmt(r.shareXOverCp), fmt(r.medianWorkDelta, 0),
      r.xWins, r.xTop10, `${r.xOtl}/${r.nOtl}`, fmt(r.medianXGapPct),
    ].join("\t"));
  }
  lines.push("");
  const g = result.grupetto_scenario;
  if (!g) return lines.join("\n");
  lines.push(`## Grupetto-scenarie (${GRUPETTO_SCENARIO.fieldShare * 100} % svageste paa ${GRUPETTO_SCENARIO.profiles.join("/")} koerer grupetto)`);
  for (const a of g.anchors) lines.push(`${a.label}: ${fmt(a.value, 3)} [${a.verdict}] (baand ${a.band}, n=${a.n})`);
  lines.push(`Hale-gate (seeds ${TAIL_GATE_SEEDS.join(",")}): ${g.tailGate.allPass ? "PASS" : "FAIL"}`);
  for (const row of g.tailGate.rows ?? []) {
    if (!row.gated) continue;
    lines.push(`  ${row.profileType}\tren p90 ${fmt(row.value)} %\t${row.band[0]}-${row.band[1]} %\t${row.status}`);
  }
  lines.push(`Bjerg/hoejbjerg OTL-ryttere: ${g.mountainOtlRiders} · reddet af grupetto-reglen: ${g.mountainRescuedRiders}`);
  lines.push(`Grupetto-ryttere: ${g.grupettoRiders} · OTL-andel ${fmt(g.grupettoOtlShare, 3)} · i sidste maalgruppe ${fmt(g.grupettoInLastGroupShare, 3)}`);
  return lines.join("\n");
}

function main() {
  const seeds = (argValue("seeds") ?? DEFAULT_SEEDS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const population = readJson(POPULATION_FILE);
  const stagesFile = readJson(STAGES_FILE);
  const allStages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;
  // --profiles=flat,rolling: kun de etapetyper (hurtig kalibrerings-sweep).
  // Grupetto-scenariet koeres altid paa ALLE etaper — dets ankre og hale-gate
  // er kun meningsfulde paa hele den pinnede kalender.
  const profileFilter = argValue("profiles")?.split(",").map((p) => p.trim()).filter(Boolean) ?? null;
  const stages = profileFilter ? allStages.filter((s) => profileFilter.includes(s.profile_type)) : allStages;
  const skipScenario = process.argv.includes("--twins-only");
  const result = {
    schema_version: 1,
    label: argValue("label"),
    generated_at: new Date().toISOString(),
    population_file: POPULATION_FILE,
    stages_file: STAGES_FILE,
    seeds,
    field_size: FIELD_SIZE,
    effort_cost_tuning: JSON.parse(JSON.stringify(EFFORT_COST_EXTRA_TUNING)),
    group_tempo_tuning: JSON.parse(JSON.stringify(GROUP_TEMPO_EFFORT_EXTRA_TUNING)),
    twins: runTwins({ population, stages, seeds }),
    grupetto_scenario: skipScenario ? null : runGrupettoScenario({ population, stages: allStages, seeds }),
  };
  console.log(formatReport(result));
  const jsonPath = argValue("json");
  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`\nJSON skrevet: ${jsonPath}`);
  }
}

if (process.argv[1]?.endsWith("v4EffortTwinMeasure.js")) main();
