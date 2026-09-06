#!/usr/bin/env node
// backend/scripts/v4TailSpread.js
// Race Engine v4 (#4885, #4881, M7): maal HALE-SPREDNINGEN i et v4-felt.
//
// Hvorfor et EGET script og ikke bare et anker i headToHeadV4.js: ankrene dér
// maaler FRONTEN (bjerg-top-10-spredning, felt-sammenhaeng paa vindertiden,
// nedkoersels-/summit-ratio). #4885's fund er det modsatte problem — HALEN:
// v4 komprimerer feltet bagud, saa vinder -> sidsteplads er en langt mindre
// andel af vindertiden end i virkeligheden. Det tal findes ikke i scorecardet,
// og et anker-tal kan derfor hverken bekraefte eller afkraefte det.
//
// Maalet pr. etape er RELATIVT (andel af vindertiden), ikke sekunder: et
// sekund-baseret hale-maal skalerer med etapens laengde og med feltstoerrelsen
// (samme fejlfamilie som #4604's bjerg-anker), og virkelighedens referencetal
// er selv procenter — en bjergetapes rode lanterne taber typisk 8-15 % af
// vindertiden, en flad etape langt mindre.
//
// 100% READ-ONLY og DB-FRIT: population laeses fra den committede snapshot,
// kalenderen bygges offline af raceStageProfileGenerator (ren funktion, ingen
// DB), eller laeses fra en --stages-fil i samme format som headToHeadV4.js.
//
// Usage:
//   node backend/scripts/v4TailSpread.js
//   node backend/scripts/v4TailSpread.js --seeds=s1,s2,s3 --races=24 --field-size=180
//   node backend/scripts/v4TailSpread.js --population=<fil> --stages=<fil>
//   node backend/scripts/v4TailSpread.js --json=<fil>   # skriv raa maalinger

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { simulateStageV4 } from "../lib/engine/v4/index.ts";
import { RACE_V4_TUNING } from "../lib/engine/v4/tuning.ts";
import { entrantsFromAbilitiesRows } from "../lib/engine/v4/adapters/entrantAdapter.ts";
import { routeFromStageProfileRow } from "../lib/engine/v4/adapters/routeAdapter.ts";
import { generateRaceStageProfiles, toStageProfileRow } from "../lib/raceStageProfileGenerator.js";
import { sampleField } from "./lib/headToHeadStats.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { stableSeed } from "../lib/raceSimulator.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

const DEFAULT_POPULATION = join(REPO_ROOT, "backend", "scripts", "baselines", "population-snapshot-2026-07-11.json");
const DEFAULT_SEEDS = ["tail-spread-1", "tail-spread-2", "tail-spread-3"];
const DEFAULT_FIELD_SIZE = 180; // samme laaste feltstoerrelse som headToHeadV4.LOCKED_FIELD_SIZE
const DEFAULT_RACE_COUNT = 24;

// ---------------------------------------------------------------------------
// Offline proxy-kalender (ingen DB)
// ---------------------------------------------------------------------------

// Blandet felt af loebs-arketyper, saa kalenderen daekker alle de etapetyper
// hale-spredningen skal maales pr.: endagsloeb (klassikere/brosten/grus) +
// etapeloeb i tre laengder + en grand tour. Terraen-arketyperne er
// raceStageProfileGenerator's egne (ARCHETYPE_PROFILES-noegler laeses via
// race.terrain_archetype), saa proxy-kalenderen har samme sammensaetning som
// en rigtig saeson uden at roere databasen.
const PROXY_RACE_TEMPLATES = Object.freeze([
  { race_type: "stage_race", stages: 21, terrain_archetype: "grand_tour" },
  { race_type: "stage_race", stages: 7, terrain_archetype: "mountain_tour" },
  { race_type: "stage_race", stages: 7, terrain_archetype: "sprint_tour" },
  { race_type: "stage_race", stages: 5, terrain_archetype: null },
  { race_type: "stage_race", stages: 4, terrain_archetype: "hilly_tour" },
  { race_type: "one_day", stages: 1, terrain_archetype: "cobbled_classic" },
  { race_type: "one_day", stages: 1, terrain_archetype: "hilly_classic" },
  { race_type: "one_day", stages: 1, terrain_archetype: "mountain_classic" },
]);

/**
 * Bygger en deterministisk offline kalender af stage_profile-raekker.
 * Ren funktion af (raceCount, calendarSeed) — samme input giver samme
 * kalender, saa foer/efter-maalinger sammenligner de SAMME etaper.
 * @param {{raceCount?:number, calendarSeed?:string}} [opts]
 * @returns {Array<object>} stage_profile-raekker (headToHeadV4 --stages-format)
 */
export function buildProxyCalendar({ raceCount = DEFAULT_RACE_COUNT, calendarSeed = "v4-tail-spread-proxy" } = {}) {
  const rows = [];
  for (let i = 0; i < raceCount; i++) {
    const template = PROXY_RACE_TEMPLATES[i % PROXY_RACE_TEMPLATES.length];
    const race = {
      id: `${calendarSeed}-race-${i + 1}`,
      external_id: `${calendarSeed}-race-${i + 1}`,
      race_type: template.race_type,
      stages: template.stages,
      terrain_archetype: template.terrain_archetype,
    };
    for (const stage of generateRaceStageProfiles(race)) {
      const row = toStageProfileRow(race.id, stage);
      // headToHeadV4's --stages-format identificerer etapen paa stage_number
      // alene; med flere loeb i samme fil skal noeglen vaere unik pr. etape,
      // ellers deler to etaper seed og feltsample.
      rows.push({ ...row, stage_number: rows.length + 1, race_key: race.id, race_stage_number: stage.stage_number });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Maaling
// ---------------------------------------------------------------------------

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function maxOf(values) {
  return values.length === 0 ? null : values.reduce((m, v) => (v > m ? v : m), values[0]);
}

/** Distance-baand — hele pointen med M7: laengere etape skal give laengere hale. */
export const DISTANCE_BANDS = Object.freeze([
  { label: "<140 km", min: 0, max: 140 },
  { label: "140-179 km", min: 140, max: 180 },
  { label: "180-219 km", min: 180, max: 220 },
  { label: ">=220 km", min: 220, max: Number.POSITIVE_INFINITY },
]);

function bandFor(distanceKm) {
  return DISTANCE_BANDS.find((b) => distanceKm >= b.min && distanceKm < b.max)?.label ?? "n/a";
}

/**
 * Hale-spredning for ét v4-etapeoutput.
 * @returns {{spreadPct:number, spreadSeconds:number, winnerSeconds:number, medianGapPct:number}}
 */
export function measureTailSpread(stageOutput) {
  const times = stageOutput.results.map((r) => r.time_seconds).sort((a, b) => a - b);
  const winner = times[0] ?? 0;
  const last = times[times.length - 1] ?? 0;
  const medianTime = median(times) ?? winner;
  const spreadSeconds = last - winner;
  return {
    winnerSeconds: winner,
    spreadSeconds,
    spreadPct: winner > 0 ? (spreadSeconds / winner) * 100 : 0,
    medianGapPct: winner > 0 ? ((medianTime - winner) / winner) * 100 : 0,
  };
}

function entrantsForField(fieldRiders) {
  const rows = fieldRiders.map((r) => ({ rider_id: r.id, ...r.abilities }));
  return entrantsFromAbilitiesRows(rows, (riderId) => ({
    role: "free_role",
    effort: "normal",
    condition: 1,
  }));
}

/**
 * Koerer v4 over kalenderen for hvert seed og returnerer én maaling pr.
 * (etape, seed). Ingen console-output — testbar.
 */
export function runTailSpread({ population, stages, seeds = DEFAULT_SEEDS, fieldSize = DEFAULT_FIELD_SIZE }) {
  if (!population?.riders?.length) throw new Error("population.riders mangler eller er tom");
  if (!Array.isArray(stages) || stages.length === 0) throw new Error("stages mangler eller er tom");

  const measurements = [];
  for (const seed of seeds) {
    for (const stageRow of stages) {
      const stageSeedStr = `${seed}:${stageRow.stage_number ?? 1}`;
      let fieldRiders = population.riders;
      if (fieldSize) {
        const rng = makeRng(stableSeed(`${stageSeedStr}:field`));
        fieldRiders = sampleField(rng, population.riders, fieldSize);
      }
      const route = routeFromStageProfileRow(stageRow);
      const output = simulateStageV4({
        route,
        startlist: entrantsForField(fieldRiders),
        orders: [],
        seed: stageSeedStr,
        tuning: RACE_V4_TUNING,
      });
      measurements.push({
        seed,
        stageNumber: stageRow.stage_number,
        profileType: stageRow.profile_type ?? "?",
        distanceKm: route.distance_km,
        band: bandFor(route.distance_km),
        fieldSize: fieldRiders.length,
        ...measureTailSpread(output),
      });
    }
  }
  return measurements;
}

/** Grupperer maalinger og reducerer til median/maks af hale-spredningen. */
export function summarizeBy(measurements, keyFn) {
  const groups = new Map();
  for (const m of measurements) {
    const key = keyFn(m);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const pcts = rows.map((r) => r.spreadPct);
      const secs = rows.map((r) => r.spreadSeconds);
      return {
        key,
        n: rows.length,
        medianPct: median(pcts),
        maxPct: maxOf(pcts),
        medianSeconds: median(secs),
        maxSeconds: maxOf(secs),
        medianGapPct: median(rows.map((r) => r.medianGapPct)),
      };
    })
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

// ---------------------------------------------------------------------------
// Kontrolleret distance-eksperiment (--distance-experiment)
// ---------------------------------------------------------------------------
//
// Proxy-kalenderens distance-baand er konfunderet: etapetype, hoejdemeter,
// finale og laengde varierer sammen. Dette eksperiment holder ALT fast
// undtagen laengden — samme rute-FORM (segmenternes andele af etapen), samme
// startfelt, samme seed — og skalerer kun `distance_km`. Er hale-spredningen
// ikke stigende her, virker distance-sliddet ikke, uanset hvad kalender-
// tabellen viser.

export const DISTANCE_EXPERIMENT_KM = Object.freeze([120, 160, 200, 240, 280]);

/** Rute-form med KONSTANTE segment-andele; kun distance_km skalerer. */
export function scaledMountainRoute(distanceKm) {
  const unit = distanceKm / 100;
  const seg = (kind, a, b) => ({ kind, from_km: Math.round(a * unit * 1000) / 1000, to_km: Math.round(b * unit * 1000) / 1000 });
  return {
    distance_km: distanceKm,
    profile_type: "mountain",
    finale_type: "long_climb",
    segments: [
      seg("rolling", 0, 25),
      { ...seg("climb", 25, 33), category: "1", avg_gradient: 7.5, top_elevation_m: 1350 },
      { ...seg("descent", 33, 40), technicality: 2 },
      seg("rolling", 40, 60),
      { ...seg("climb", 60, 68), category: "2", avg_gradient: 6.4, top_elevation_m: 1100 },
      { ...seg("descent", 68, 75), technicality: 2 },
      seg("rolling", 75, 85),
      { ...seg("climb", 85, 100), category: "HC", avg_gradient: 9.2, top_elevation_m: 2050 },
    ],
    weather: { kind: "overcast", wind_exposure: 0.35 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: distanceKm }],
  };
}

/**
 * @returns {Array<{distanceKm:number, spreadPct:number[], meanPct:number}>}
 */
export function runDistanceExperiment({ population, seeds = DEFAULT_SEEDS, fieldSize = DEFAULT_FIELD_SIZE, distances = DISTANCE_EXPERIMENT_KM }) {
  return distances.map((distanceKm) => {
    const spreadPct = seeds.map((seed) => {
      // SAMME felt paa tvaers af distancer (feltet seedes uden distancen), saa
      // kun laengden varierer mellem raekkerne.
      const rng = makeRng(stableSeed(`${seed}:distance-experiment:field`));
      const fieldRiders = fieldSize ? sampleField(rng, population.riders, fieldSize) : population.riders;
      const output = simulateStageV4({
        route: scaledMountainRoute(distanceKm),
        startlist: entrantsForField(fieldRiders),
        orders: [],
        seed: `${seed}:distance-experiment:${distanceKm}`,
        tuning: RACE_V4_TUNING,
      });
      return measureTailSpread(output).spreadPct;
    });
    return { distanceKm, spreadPct, meanPct: spreadPct.reduce((a, b) => a + b, 0) / spreadPct.length };
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function fmt(v, decimals = 2) {
  return v === null || v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(decimals);
}

function formatTable(title, rows) {
  const lines = [title, "key\tn\tmedian_%\tmax_%\tmedian_s\tmax_s\tmedian_rytter_%"];
  for (const r of rows) {
    lines.push(
      [r.key, r.n, fmt(r.medianPct), fmt(r.maxPct), fmt(r.medianSeconds, 0), fmt(r.maxSeconds, 0), fmt(r.medianGapPct)].join("\t"),
    );
  }
  return lines.join("\n");
}

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const populationPath = argValue("population", DEFAULT_POPULATION);
  const stagesPath = argValue("stages");
  const seeds = String(argValue("seeds", DEFAULT_SEEDS.join(",")))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fieldSizeArg = argValue("field-size");
  const fieldSize = fieldSizeArg === "all" ? null : Number(fieldSizeArg ?? DEFAULT_FIELD_SIZE);
  const raceCount = Number(argValue("races", String(DEFAULT_RACE_COUNT)));
  const jsonOut = argValue("json");

  const population = readJson(populationPath);

  if (process.argv.includes("--distance-experiment")) {
    console.log(
      `Kontrolleret distance-eksperiment: samme rute-form, samme startfelt (${fieldSize}), ` +
        `kun distance_km skalerer. Seeds: ${seeds.join(", ")}.`,
    );
    console.log("");
    console.log(["distance_km", ...seeds.map((s) => `${s}_%`), "middel_%"].join("\t"));
    for (const row of runDistanceExperiment({ population, seeds, fieldSize })) {
      console.log([row.distanceKm, ...row.spreadPct.map((p) => fmt(p)), fmt(row.meanPct)].join("\t"));
    }
    return;
  }

  // Samme offline-kalender kan fodres til headToHeadV4.js's ankre, saa
  // hale-maalingen og anker-maalingen koeres paa PRAECIS de samme etaper —
  // ellers kan et anker-skift ikke tilskrives noget.
  const emitStages = argValue("emit-stages");
  if (emitStages) {
    const rows = buildProxyCalendar({ raceCount });
    mkdirSync(dirname(emitStages), { recursive: true });
    writeFileSync(emitStages, JSON.stringify(rows, null, 2));
    console.log(`Proxy-kalender (${rows.length} etaper) skrevet til ${emitStages}`);
    return;
  }

  let stages;
  if (stagesPath) {
    const file = readJson(stagesPath);
    stages = Array.isArray(file) ? file : file.stages;
  } else {
    stages = buildProxyCalendar({ raceCount });
  }

  console.log(
    `Population: ${population.riders?.length ?? 0} ryttere (${populationPath}). ` +
      `Etaper: ${stages.length}${stagesPath ? "" : " (offline proxy-kalender)"}. ` +
      `Seeds: ${seeds.join(", ")}. Feltstoerrelse: ${fieldSize ?? "hele populationen"}.`,
  );
  console.log("Hale-spredning = (sidsteplads - vinder) / vindertid. Virkelighedens reference: bjerg ~8-15 %, fladt lavt.");
  console.log("");

  const measurements = runTailSpread({ population, stages, seeds, fieldSize });

  console.log(formatTable("-- Pr. etapetype (alle seeds samlet) --", summarizeBy(measurements, (m) => m.profileType)));
  console.log("");
  console.log(formatTable("-- Pr. distance-baand (alle seeds samlet) --", summarizeBy(measurements, (m) => m.band)));
  console.log("");
  // Etapetype OG distance i samme celle: den rene distance-tabel ovenfor er
  // konfunderet af terraen (flade etaper er typisk de laengste), saa den kan
  // ikke alene vise om laengden i sig selv forlaenger halen. Kun celler med
  // n >= 3 vises — et enkelt traek er stoej, ikke et signal.
  const byTypeAndBand = summarizeBy(measurements, (m) => `${m.profileType} | ${m.band}`).filter((r) => r.n >= 3);
  console.log(formatTable("-- Pr. etapetype x distance-baand (n >= 3) --", byTypeAndBand));
  console.log("");
  console.log(formatTable("-- Pr. seed (alle etaper samlet) --", summarizeBy(measurements, (m) => m.seed)));
  console.log("");
  console.log(formatTable("-- I alt --", summarizeBy(measurements, () => "alle etaper")));

  if (jsonOut) {
    mkdirSync(dirname(jsonOut), { recursive: true });
    writeFileSync(jsonOut, JSON.stringify({ seeds, fieldSize, measurements }, null, 2));
    console.log("");
    console.log(`Raa maalinger skrevet til ${jsonOut}`);
  }
}

if (process.argv[1]?.endsWith("v4TailSpread.js")) {
  main();
}
