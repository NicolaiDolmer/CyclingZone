#!/usr/bin/env node
// backend/scripts/headToHeadV4.js
// Race Engine v4 F2/F3-recovery (#4030, #3855): head-to-head-harness.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §7
//   ("Harness-hook: backend/scripts/headToHeadV4.js: koerer v3 (simulateStage)
//   og v4 (simulateStageV4) paa samme population-snapshot + S3-kalenderens
//   ruter, scorer BEGGE mod §5-ankrene i mor-spec'en").
// Mor-spec: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md §5.
//
// Scriptet:
//   (a) loader en population-snapshot (exportPopulationSnapshot.js-format)
//   (b) loader etape-profiler (race_stage_profiles-raekke-form) fra JSON
//   (c) koerer v3 (simulateStage) og v4 (simulateStageV4 via adapters) paa
//       SAMME input pr. etape
//   (d) printer en simpel sammenligningstabel (vinder-type, gruppe-antal,
//       tidsspredning pr. etape)
//   (e) scorer BEGGE motorer mod mor-spec §5's virkeligheds-ankre (+ #2415's
//       gap-realisme-baand) via headToHeadAnchors.js — laesbart PASS/FAIL/N-A-
//       scorecard, se lib/headToHeadAnchors.js for metodologi-forbehold
//   (f) --films[=<dir>]: eksporterer 5 haandplukkede v4-etape-tidslinjer
//       (bjerg/flad massespurt/punch/nedkoersel/brosten) som laesbare .txt-filer
//
// 100% READ-ONLY: laeser kun JSON-filer fra disk (+ skriver kun til --films'
// output-mappe). Ingen DB/netvaerks-kald, ingen prod-mutationer.
//
// Usage:
//   node backend/scripts/headToHeadV4.js --population=<fil> --stages=<fil> [--seed=<streng>] [--films[=<dir>]]
//
// Eksempel (syntetisk mini-input, verificeret af headToHeadV4.test.js):
//   node backend/scripts/headToHeadV4.js \
//     --population=backend/scripts/fixtures/headToHeadV4-example/population.json \
//     --stages=backend/scripts/fixtures/headToHeadV4-example/stages.json --films

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simulateStage, stableSeed } from "../lib/raceSimulator.js";
import { simulateStageV4 } from "../lib/engine/v4/index.ts";
import { RACE_V4_TUNING } from "../lib/engine/v4/tuning.ts";
import { entrantsFromAbilitiesRows } from "../lib/engine/v4/adapters/entrantAdapter.ts";
import { routeFromStageProfileRow } from "../lib/engine/v4/adapters/routeAdapter.ts";
import { buildScorecard, formatScorecard } from "./lib/headToHeadAnchors.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI args (samme moenster som exportPopulationSnapshot.js)
// ---------------------------------------------------------------------------

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------------------
// Population -> entrants pr. motor
// ---------------------------------------------------------------------------

// TODO (23-24/8, fuld harness): rolle-/taktik-tildeling pr. hold (kaptajn/
// sprint_captain/helper/hunter) skal laeses af en rigtig holdopstilling —
// population-snapshottet (exportPopulationSnapshot.js) baerer INGEN race_role
// (det er entry-tidspunkt-data, ikke rytter-/hold-data). F2-stubben bruger
// 'free_role' for ALLE ryttere paa BEGGE motorer, saa sammenligningen isolerer
// motor-mekanikkens forskel (grupper/selektion/finale) fra taktik-laget — en
// bevidst forenkling, ikke en bug. Fuld harness (23-24/8) skal enten simulere
// en realistisk rolle-fordeling pr. hold eller koere N gentagelser pr. rolle-
// scenarie.
const DEFAULT_ROLE = "free_role";
const DEFAULT_EFFORT = "normal";

function v3EntrantsFromPopulation(riders) {
  return riders.map((r) => ({
    rider_id: r.id,
    team_id: r.team_id,
    abilities: r.abilities,
    form: r.form ?? null,
    fatigue: r.fatigue ?? null,
    race_role: DEFAULT_ROLE,
    effort: DEFAULT_EFFORT,
  }));
}

function v4EntrantsFromPopulation(riders) {
  const rows = riders.map((r) => ({ rider_id: r.id, ...r.abilities }));
  return entrantsFromAbilitiesRows(rows, () => ({
    role: DEFAULT_ROLE,
    effort: DEFAULT_EFFORT,
    condition: 1, // TODO (F3/M7): map population.form/fatigue -> condition naar motoren forbruger det
  }));
}

// ---------------------------------------------------------------------------
// Sammenligningstabel (d) — simplificeret proxy-klassifikation, se TODO-blok
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Simplificeret vinder-type-klassifikation (proxy til DENNE tabels overblik —
// IKKE raceTimeline.js's rigtige klassifikator, som ogsaa bruger persisterede
// moments/finale_type). Samme offentlige gap-taerskler som raceTimeline.js's
// SPRINT_GAP_S/CLOSE_GAP_S (3/10 sekunder), holdt som egne konstanter her af
// samme grund raceTimeline.js selv holder dem egne (se dens kommentar linje 58-62).
const SPRINT_GAP_S = 3;
const CLOSE_GAP_S = 10;

function classifyWinType(gapToSecond) {
  if (gapToSecond == null) return "solo_win";
  if (gapToSecond < SPRINT_GAP_S) return "sprint_win";
  if (gapToSecond < CLOSE_GAP_S) return "close_win";
  return "solo_win";
}

function summarizeV3(ranked) {
  const sorted = [...ranked].sort((a, b) => a.rank - b.rank);
  const winner = sorted[0] ?? null;
  const second = sorted[1] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  // v3 har INGEN formaliseret gruppe-model (mor-spec §1: "der findes ingen
  // gruppe-tilstand") — "gruppe-antal" her er en PROXY: antal distinkte
  // stageGap-vaerdier (rundet til hele sekunder). Rapporteres eksplicit som
  // proxy i tabel-headeren, ikke som en paastand om ægte grupper.
  const distinctGapBuckets = new Set(sorted.map((r) => Math.round(r.stageGap)));
  return {
    winType: classifyWinType(second ? second.stageGap : null),
    groupCountProxy: distinctGapBuckets.size,
    timeSpreadSeconds: last ? Math.round(last.stageGap) : 0,
    winnerId: winner?.rider_id ?? null,
  };
}

function summarizeV4(stageOutput) {
  const sorted = [...stageOutput.results].sort((a, b) => a.rank - b.rank);
  const winner = sorted[0] ?? null;
  const second = sorted[1] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  const gapToSecond = winner && second ? round2(second.time_seconds - winner.time_seconds) : null;
  const groupIds = new Set(sorted.map((r) => r.group_id));
  const spread = winner && last ? Math.round(last.time_seconds - winner.time_seconds) : 0;
  return {
    winType: classifyWinType(gapToSecond),
    groupCount: groupIds.size,
    timeSpreadSeconds: spread,
    winnerId: winner?.rider_id ?? null,
  };
}

function printComparisonTable(rows) {
  const header = [
    "stage", "profile_type",
    "v3_win_type", "v3_groups(proxy)", "v3_spread_s",
    "v4_win_type", "v4_groups", "v4_spread_s",
  ];
  console.log(header.join("\t"));
  for (const r of rows) {
    console.log(
      [
        r.stageNumber, r.profileType,
        r.v3.winType, r.v3.groupCountProxy, r.v3.timeSpreadSeconds,
        r.v4.winType, r.v4.groupCount, r.v4.timeSpreadSeconds,
      ].join("\t"),
    );
  }
}

// ---------------------------------------------------------------------------
// Kernen: koer v3 + v4 paa samme population/etaper, returnér raa rows (testbar
// uden om process.exit/console.log-siden).
// ---------------------------------------------------------------------------

export function runHeadToHead({ population, stages, seedInput = "head-to-head-v4-stub" }) {
  if (!population?.riders?.length) throw new Error("population.riders mangler eller er tom");
  if (!Array.isArray(stages) || stages.length === 0) throw new Error("stages mangler eller er tom");

  const v3Entrants = v3EntrantsFromPopulation(population.riders);
  const v4Entrants = v4EntrantsFromPopulation(population.riders);

  const rows = [];
  for (const stageRow of stages) {
    if (!stageRow.demand_vector) {
      throw new Error(`etape ${stageRow.stage_number ?? "?"}: demand_vector mangler (kraeves af simulateStage/v3)`);
    }
    const stageSeedStr = `${seedInput}:${stageRow.stage_number ?? 1}`;
    const v3Seed = stableSeed(stageSeedStr);

    const v3Output = simulateStage({ entrants: v3Entrants, stageProfile: stageRow, seed: v3Seed, v3: true });
    const route = routeFromStageProfileRow(stageRow);
    const v4Output = simulateStageV4({
      route,
      startlist: v4Entrants,
      orders: [],
      seed: stageSeedStr,
      tuning: RACE_V4_TUNING,
    });

    rows.push({
      stageNumber: stageRow.stage_number ?? "?",
      profileType: stageRow.profile_type ?? "?",
      v3: summarizeV3(v3Output.ranked),
      v4: summarizeV4(v4Output),
      // Raat, u-sammenfattet output pr. etape — konsumeres af
      // headToHeadAnchors.buildScorecard() (mor-spec §5-scoring). Additiv felt,
      // aendrer intet ved de eksisterende summary-felter ovenfor (bagudkompatibelt
      // med F2-stubbens egne tests).
      raw: { v3Output, v4Output, route, tuning: RACE_V4_TUNING, stageRow },
    });
  }
  return rows;
}

/** rider_id -> team_id|null (population.riders-format). */
function buildTeamByRider(riders) {
  return new Map(riders.map((r) => [r.id, r.team_id ?? null]));
}

/** rider_id -> abilities-record (population.riders-format). */
function buildAbilitiesByRider(riders) {
  return new Map(riders.map((r) => [r.id, r.abilities]));
}

// ---------------------------------------------------------------------------
// --films: haandplukkede etape-tidslinjer som laesbare tekstfiler (ejer-
// gennemsyn, mor-spec §6 punkt 3 "haandplukkede skygge-film set med egne
// oejne"). Genbruger de allerede-committede golden fixtures (samme input som
// backend/lib/engine/v4/fixtures/*/input.json) for 4 arketyper + ÉN syntetisk
// brosten-scenarie (M8's fulde kaos-mekanik er F3-scope — F2 emitterer kun
// passage, jf. F2-core-design.md §4 punkt 3 — men ruten/finalen kan stadig
// koeres og filmes med DEN mekanik der findes i dag).
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(SCRIPT_DIR, "..", "lib", "engine", "v4", "fixtures");

const FILM_FIXTURE_SCENARIOS = [
  { name: "01-bjerg-selektion", dir: "bjerg-selektion" },
  { name: "02-flad-massespurt", dir: "flat-massespurt" },
  { name: "03-punch-finale-forspring", dir: "punch-finale-forspring" },
  { name: "04-nedkoerselsfinale", dir: "nedkoerselsfinale" },
];

// Syntetisk brosten-rute (intet golden-fixture-brosten-scenarie findes endnu —
// M8 fuld kaos-mekanik er F3-scope). Genbruger flat-massespurt-fixturens
// startfelt-form (samme abilities-struktur), egen rute + seed.
function buildCobblesFilmScenario() {
  const flatFixture = readJson(join(FIXTURES_DIR, "flat-massespurt", "input.json"));
  return {
    name: "05-brosten-syntetisk",
    input: {
      ...flatFixture,
      route: {
        distance_km: 165,
        profile_type: "cobbles",
        finale_type: "reduced_sprint",
        segments: [
          { kind: "flat", from_km: 0, to_km: 40 },
          { kind: "cobbles", from_km: 40, to_km: 44, sector_name: "Sector A", stars: 4 },
          { kind: "flat", from_km: 44, to_km: 80 },
          { kind: "cobbles", from_km: 80, to_km: 85, sector_name: "Sector B", stars: 5 },
          { kind: "flat", from_km: 85, to_km: 165 },
        ],
        weather: { kind: "overcast", wind_exposure: 0.35 },
        waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 165 }],
      },
      seed: "film-05-brosten-syntetisk-v1",
    },
  };
}

function buildFilmScenarios() {
  const fromFixtures = FILM_FIXTURE_SCENARIOS.map((s) => ({
    name: s.name,
    input: readJson(join(FIXTURES_DIR, s.dir, "input.json")),
  }));
  return [...fromFixtures, buildCobblesFilmScenario()];
}

function padKm(km) {
  return km.toFixed(2).padStart(8);
}

function formatFilmText(scenario, output) {
  const { route } = scenario.input;
  const lines = [];
  lines.push(`=== ${scenario.name} — v4 etape-tidslinje (haandplukket film, #4030) ===`);
  lines.push(`Rute: profile_type=${route.profile_type} finale_type=${route.finale_type ?? "n/a"} distance_km=${route.distance_km}`);
  lines.push(`Vejr: ${route.weather?.kind ?? "n/a"} (wind_exposure=${route.weather?.wind_exposure ?? "n/a"})`);
  lines.push(`Seed: ${scenario.input.seed}`);
  lines.push(`Startfelt: ${scenario.input.startlist.length} ryttere`);
  lines.push("");
  lines.push("-- Tidslinje --");
  for (const ev of output.timeline.events) {
    lines.push(`km ${padKm(ev.km)}  ${ev.type.padEnd(20)} ${JSON.stringify(ev.params)}`);
  }
  lines.push("");
  lines.push(`-- Resultat (top ${Math.min(15, output.results.length)}) --`);
  const sorted = [...output.results].sort((a, b) => a.rank - b.rank).slice(0, 15);
  const winnerTime = sorted[0]?.time_seconds ?? 0;
  for (const r of sorted) {
    const gap = round2(r.time_seconds - winnerTime);
    lines.push(`${String(r.rank).padStart(3)}. ${r.rider_id.padEnd(10)} +${gap.toFixed(2)}s  gruppe=${r.group_id}  status=${r.status}`);
  }
  return lines.join("\n");
}

/**
 * Koerer de haandplukkede scenarier gennem simulateStageV4 og skriver
 * laesbare .txt-film til outDir. Returnerer de skrevne stier (til PR-body).
 * @param {string} outDir
 * @returns {string[]}
 */
export function runFilms(outDir) {
  mkdirSync(outDir, { recursive: true });
  const scenarios = buildFilmScenarios();
  const paths = [];
  for (const scenario of scenarios) {
    const output = simulateStageV4(scenario.input);
    const text = formatFilmText(scenario, output);
    const filePath = join(outDir, `${scenario.name}.txt`);
    writeFileSync(filePath, text);
    paths.push(filePath);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// TODO (fuld saeson-scope, F3+): denne harness koerer og scorer paa DE ETAPER
// den faar via --stages — den koerer endnu ikke automatisk HELE S3-kalenderen.
// Naar det er oensket: hent race_stage_profiles-raekker for S3 (read-only
// SELECT) og feed dem ind som --stages, kombinér med en AEGTE population-
// snapshot (node backend/scripts/exportPopulationSnapshot.js). headToHeadAnchors'
// buildScorecard()/formatScorecard() skalerer allerede til vilkaarligt mange
// etaper (aggregerer pr. anker paa tvaers af alle rows) — ingen aendring
// paakraevet i scoringslaget for at koere den fulde kalender.
// classifyWinType()-proxyen erstattes naar v4s finale.ts (M4) lander et rigtigt
// win_type (i dag PLACEHOLDER_WIN_TYPE="group_finish" i index.ts).
// ---------------------------------------------------------------------------

function main() {
  const populationPath = argValue("population");
  const stagesPath = argValue("stages");
  const seedInput = argValue("seed", "head-to-head-v4-stub");
  const filmsRequested = process.argv.includes("--films") || process.argv.some((a) => a.startsWith("--films="));
  const filmsDir = argValue("films", join(SCRIPT_DIR, "out", "films"));

  if (!populationPath || !stagesPath) {
    console.error(
      "Usage: node backend/scripts/headToHeadV4.js --population=<fil> --stages=<fil> [--seed=<streng>] [--films[=<dir>]]",
    );
    process.exit(2);
    return;
  }

  const population = readJson(populationPath);
  const stagesFile = readJson(stagesPath);
  const stages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;

  console.log(`Population: ${population.riders?.length ?? 0} ryttere. Etaper: ${stages?.length ?? 0}. Seed: ${seedInput}`);
  const rows = runHeadToHead({ population, stages, seedInput });
  printComparisonTable(rows);

  const teamByRider = buildTeamByRider(population.riders);
  const abilitiesByRider = buildAbilitiesByRider(population.riders);
  const v4Entrants = v4EntrantsFromPopulation(population.riders);
  const v4EntrantsById = Object.fromEntries(v4Entrants.map((e) => [e.rider_id, e]));

  const scorecard = buildScorecard(rows, { teamByRider, abilitiesByRider, v4EntrantsById });
  console.log("");
  console.log(formatScorecard(scorecard));

  if (filmsRequested) {
    const paths = runFilms(filmsDir);
    console.log("");
    console.log(`Film-eksport (${paths.length} haandplukkede scenarier) skrevet til:`);
    for (const p of paths) console.log(`  ${p}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("headToHeadV4.js")) {
  main();
}
