#!/usr/bin/env node
// backend/scripts/dev/v4VisualPack/collectS4VisualPack.mjs
// #5804: visuel testpakke for race_engine_v4 paa S4's FOERSTE UGE (ejer 26/9).
//
// Koerer v3 og v4 paa SAMME felt og SAMME seed paa de rigtige S4-etaper og skriver
// ÉN selvstaendig HTML-side UDEN FOR repoet (default: ejerens OneDrive-mappe).
//
//   Etaper:   prod-kalenderen for S4 naar den er skrevet, ellers toerkoerslens plan
//             (materializeTierCalendars dryRun, samme argumenter som
//             buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --uniform-tilt
//             --target-structure s4). Se s4PlanSource.mjs.
//   Felt:     loadEntrantsForRace({ persist: false }) — raceRunners EGEN indlaesning,
//             inkl. assistentens autopick for hold uden udtagelse. Intet skrives.
//   Motorer:  raceRunner.buildRaceResults, én gang med v3 (flag-off-stien) og én
//             gang med v4-broen (createRaceEngineV4Adapter) — PRAECIS den sti
//             prod koerer naar flaget vendes. Seed = raceSeedInput(race.id, etape)
//             i begge. Ingen ny motorlogik.
//
// FORBUDT og ikke muligt herfra: flip af race_engine_v4 og enhver prod-skrivning.
// Scriptet bruger kun SELECT (via de genbrugte indlaesere) og skriver kun lokale filer.
//
// Usage (fra backend/):
//   infisical run --env=prod --silent -- node scripts/dev/v4VisualPack/collectS4VisualPack.mjs \
//     [--out=<html>] [--raw=<json>] [--from=2026-09-28] [--to=2026-10-04] [--tiers=1,4] [--no-youth]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";

import { buildRaceResults, loadEntrantsForRace } from "../../../lib/raceRunner.js";
import { createRaceEngineV4Adapter } from "../../../lib/raceEngineV4Bridge.js";
import { stageSuitabilityScores } from "../../../lib/raceAutopick.js";
import * as v4Core from "../../../lib/engine/v4/index.ts";
import * as v4Tuning from "../../../lib/engine/v4/tuning.ts";
import * as v4Entrants from "../../../lib/engine/v4/adapters/entrantAdapter.ts";
import * as v4Route from "../../../lib/engine/v4/adapters/routeAdapter.ts";
import * as v4Orders from "../../../lib/engine/v4/orders/teamOrdersAdapter.ts";
import * as v4Timeline from "../../../lib/engine/v4/timeline.ts";
import { seasonUuid } from "../../buildSeasonCalendar.js";

import { loadS4Races, S4_FIRST_RACE_DAY } from "./s4PlanSource.mjs";
import { loadYouthEntrants } from "./youthField.mjs";
import {
  selectRacesForCoverage, coverageReport, terrainFamily, parseGap, compactSnapshots, displayEvents, syntheticRaceId,
} from "./packCore.js";
import { buildPack } from "./buildPack.js";
import { renderPackHtml } from "./renderPackHtml.js";

const DEFAULT_OUT = "C:/Users/Nicolai/OneDrive/CyclingZone-context/private-handoffs/v4-visual-2026-09-26/index.html";

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/**
 * v4-broen med en optager paa kernen: hver etapes fulde StageOutput + motorens
 * udbrudsdom gemmes, saa filmen kan tegnes. Broen selv er uaendret; `output` er
 * byte-identisk med det prod ville faa.
 */
export function recordingV4Engine() {
  const recorded = new Map();
  let current = null;
  const core = {
    ...v4Core,
    simulateStageV4WithTrace(input) {
      const res = v4Core.simulateStageV4WithTrace(input);
      current = res;
      return res;
    },
  };
  const adapter = createRaceEngineV4Adapter({
    core, tuning: v4Tuning, entrants: v4Entrants, route: v4Route, orders: v4Orders, timeline: v4Timeline,
  });
  return {
    recorded,
    engine: {
      version: adapter.version,
      simulateStage(args) {
        const out = adapter.simulateStage(args);
        recorded.set(args.stageNumber, {
          v4Output: out.v4Output,
          trace: current?.trace ?? null,
          timelineValid: out.timeline != null,
          orders: (args.teamOrderRows ?? []).length,
        });
        current = null;
        return out;
      },
    },
  };
}

function v3RowsForStage(resultRows, { isStageRace, stageNumber }) {
  const type = isStageRace ? "stage" : "gc";
  const sn = isStageRace ? stageNumber : 1;
  return resultRows
    .filter((r) => r.result_type === type && r.stage_number === sn && r.rider_id)
    .map((r) => ({
      rider_id: r.rider_id, rank: r.rank, gap: parseGap(r.finish_time),
      in_breakaway: !!r.in_breakaway, breakaway_caught: !!r.breakaway_caught,
    }));
}

/**
 * Koer ét loeb med begge motorer og gem uge-1-etaperne som raa poster.
 * Samme felt, samme etaper, samme seed (raceSeedInput(race.id, etape)).
 */
function runRace({ race, raceObj, stagesSorted, entrants, v3On, timelineOn, stageRecords, raceMeta }) {
  const tRace = performance.now();
  const isStageRace = race.race_type === "stage_race";
  const v3 = buildRaceResults({ race: raceObj, stages: stagesSorted, entrants, pointsLookup: {}, v3: v3On, timeline: timelineOn });
  const rec = recordingV4Engine();
  buildRaceResults({
    race: raceObj, stages: stagesSorted, entrants, pointsLookup: {}, v3: v3On, timeline: timelineOn,
    v4Engine: rec.engine, teamOrderRows: [],
  });
  const riderTeam = Object.fromEntries(entrants.map((e) => [e.rider_id, e.team_id]));
  const riders = Object.fromEntries(entrants.map((e) => [e.rider_id, { name: e.rider_name, team: e.team_id }]));
  const teams = Object.fromEntries(entrants.filter((e) => e.team_id != null).map((e) => [e.team_id, { name: e.team_name, ai: e.team_is_ai === true }]));
  raceMeta.push({
    key: race.id, name: race.name, tier: race.tier, squad: race.squad, race_class: race.race_class,
    race_type: race.race_type, stageCount: stagesSorted.length, week1Stages: race.week1Stages,
    field: entrants.length, teamCount: Object.keys(teams).length, riders, teams,
    syntheticYouth: race.syntheticYouth === true,
    ms: Math.round(performance.now() - tRace),
  });
  for (const stage of stagesSorted) {
    if (!race.week1Stages.includes(stage.stage_number)) continue;
    const got = rec.recorded.get(stage.stage_number);
    if (!got) continue;
    const starters = new Set(got.v4Output.results.map((r) => r.rider_id));
    const favorites = entrants
      .filter((e) => starters.has(e.rider_id))
      .map((e) => ({ rider_id: e.rider_id, score: stageSuitabilityScores(e.abilities, [stage])[0] ?? 0 }))
      .sort((a, b) => b.score - a.score || String(a.rider_id).localeCompare(String(b.rider_id)))
      .slice(0, 3)
      .map((f) => ({ rider_id: f.rider_id }));
    const v3Timeline = v3.timelines.find((t) => t.stage_number === stage.stage_number);
    const rawEvents = got.v4Output.timeline?.events ?? [];
    stageRecords.push({
      raceKey: race.id,
      stage_number: stage.stage_number,
      scheduled_at: stage.scheduled_at,
      profile_type: stage.profile_type,
      finale_type: stage.finale_type,
      distance_km: stage.distance_km,
      elevation_gain_m: stage.elevation_gain_m,
      segmentCount: Array.isArray(stage.segments) ? stage.segments.length : null,
      family: terrainFamily(stage.profile_type),
      isStageRace,
      favorites,
      riderTeam,
      v4: {
        results: got.v4Output.results.map((r) => ({
          rider_id: r.rider_id, rank: r.rank, time_seconds: r.time_seconds, group_id: r.group_id,
          status: r.status, reinstated_by: r.reinstated_by ?? null,
        })),
        events: displayEvents(rawEvents),
        gapTrack: rawEvents
          .filter((e) => e.type === "gap_update" && e.params?.group_id != null)
          .map((e) => [Math.round(e.km * 10) / 10, String(e.params.group_id), Math.round(Number(e.params.gap_seconds) || 0)]),
        groupSnapshots: got.v4Output.groupSnapshots,
        snapshots: compactSnapshots(got.v4Output.groupSnapshots ?? []),
        incidents: (got.v4Output.incidents ?? []).map((i) => ({ rider_id: i.rider_id, km: i.km, kind: i.kind, severity: i.severity ?? null, outcome: i.outcome ?? null })),
        trace: got.trace,
        timelineValid: got.timelineValid,
      },
      v3: {
        rows: v3RowsForStage(v3.resultRows, { isStageRace, stageNumber: stage.stage_number }),
        events: (v3Timeline?.events ?? []).map((e) => ({ km: e.km ?? null, type: e.type, params: e.params ?? {} })),
        incidents: v3.incidents.filter((i) => i.stage_number === stage.stage_number).map((i) => ({ rider_id: i.rider_id, kind: i.kind, outcome: i.outcome ?? null })),
      },
    });
  }
  console.log(`[5804] ${race.squad} D${race.tier} ${race.name}: ${entrants.length} ryttere, ${stagesSorted.length} etaper (uge 1: ${race.week1Stages.join(",")}) — ${Math.round(performance.now() - tRace)} ms`);
}

async function readFlags(supabase) {
  const { data } = await supabase.from("app_config").select("key, value")
    .in("key", ["race_engine_v3_scoring", "race_stage_timeline", "race_engine_v4"]);
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY (koer via: infisical run --env=prod --silent -- ...)");
    process.exit(2);
  }
  const outPath = argValue("out", DEFAULT_OUT);
  const rawPath = argValue("raw", null);
  const window = { from: argValue("from", S4_FIRST_RACE_DAY), to: argValue("to", "2026-10-04") };
  const tiers = argValue("tiers", "1,4").split(",").map(Number).filter(Number.isFinite);
  const youth = !process.argv.includes("--no-youth");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const t0 = performance.now();

  const flags = await readFlags(supabase);
  const v3On = flags.race_engine_v3_scoring === "on";
  const timelineOn = flags.race_stage_timeline === "on";
  console.log(`[5804] flag: v3=${flags.race_engine_v3_scoring} timeline=${flags.race_stage_timeline} v4=${flags.race_engine_v4} (laeses, aendres ikke)`);

  const { source, races, notes } = await loadS4Races({ supabase, tiers, youth, log: (m) => console.log(`[5804] ${m}`) });
  console.log(`[5804] kilde: ${source}, ${races.length} loeb i alt (en repraesentativ pulje pr. division/trup)`);
  const picked = selectRacesForCoverage({ races, window });
  const coverage = coverageReport({ races, picked, window });
  for (const c of coverage) {
    console.log(`[5804] ${c.key}: i ugen ${c.available.join(",") || "-"} | valgt ${c.covered.join(",") || "-"} | mangler ${c.missingRequired.join(",") || "intet"}`);
  }

  const stageRecords = [];
  const raceMeta = [];
  const runOpts = { v3On, timelineOn, stageRecords, raceMeta };
  for (const race of picked) {
    const stagesSorted = [...race.stages].sort((a, b) => a.stage_number - b.stage_number);
    const raceObj = {
      id: race.id, season_id: seasonUuid(4), league_division_id: race.poolId, name: race.name,
      race_class: race.race_class, race_type: race.race_type, stages: stagesSorted.length, squad: race.squad,
    };
    const entrants = await loadEntrantsForRace({ supabase, race: raceObj, stages: stagesSorted, persist: false });
    if (!entrants.length) {
      notes.push(`${race.name} (${race.squad} D${race.tier}): intet startfelt kunne udtages — sprunget over.`);
      continue;
    }
    runRace({ race, raceObj, stagesSorted, entrants, ...runOpts });
  }

  // Ungdom (#5804 "hvis muligt"): findes der ingen ungdomskalender, koeres ét U23-felt
  // af de rigtige U23-ryttere paa en S4-etape fra planen (tydeligt maerket syntetisk).
  if (youth && !picked.some((p) => p.squad !== "senior")) {
    const host = picked.find((p) => p.squad === "senior" && p.race_type !== "stage_race"
      && p.stages.some((s) => terrainFamily(s.profile_type) === "kuperet"))
      ?? picked.find((p) => p.squad === "senior" && p.race_type !== "stage_race");
    if (host) {
      const stagesSorted = [...host.stages].sort((a, b) => a.stage_number - b.stage_number);
      const entrants = await loadYouthEntrants({ supabase, squad: "u23", stages: stagesSorted });
      if (entrants.length) {
        const id = syntheticRaceId(`u23-synthetic:${host.id}`);
        const race = {
          ...host, id, key: id, squad: "u23", tier: 1, poolId: null, name: `${host.name} (U23-felt)`, race_class: "Class2",
          syntheticYouth: true,
        };
        const raceObj = { id, season_id: seasonUuid(4), league_division_id: null, name: race.name, race_class: "Class2", race_type: host.race_type, stages: stagesSorted.length, squad: "u23" };
        runRace({ race, raceObj, stagesSorted, entrants, ...runOpts });
        notes.push(`Ungdom: der findes ingen U23-/juniorpuljer i prod endnu, så ingen ungdomskalender. I stedet er ét U23-felt (de rigtige U23-ryttere, ${entrants.length} fra hold med mindst 3) kørt på etapen fra ${host.name}.`);
      } else {
        notes.push("Ungdom: ingen U23-ryttere kunne udtages; ingen ungdomsetape.");
      }
    }
  }

  const pack = buildPack({
    meta: {
      generated_at: new Date().toISOString(),
      source, window, flags, notes, coverage,
      runtime_s: Math.round((performance.now() - t0) / 100) / 10,
    },
    races: raceMeta,
    stages: stageRecords,
  });
  if (rawPath) {
    mkdirSync(dirname(rawPath), { recursive: true });
    writeFileSync(rawPath, JSON.stringify({ meta: pack.meta, races: raceMeta, stages: stageRecords }, null, 0));
    console.log(`[5804] raa data: ${rawPath}`);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderPackHtml(pack));
  console.log(`[5804] HTML: ${outPath} (${stageRecords.length} etaper, ${Math.round((performance.now() - t0) / 1000)} s)`);
}

if (process.argv[1]?.replace(/\\/gu, "/").endsWith("v4VisualPack/collectS4VisualPack.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

