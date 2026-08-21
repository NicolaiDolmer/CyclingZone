#!/usr/bin/env node
// backend/scripts/headToHeadV4.js
// Race Engine v4 F2 (#4030), Fase B4: head-to-head-harness — CLI-STUB.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §7
//   ("Harness-hook: backend/scripts/headToHeadV4.js (F2 leverer stub, fuld
//   version til 23-24/8): koerer v3 (simulateStage) og v4 (simulateStageV4)
//   paa samme population-snapshot + S3-kalenderens ruter, scorer BEGGE mod
//   §5-ankrene i mor-spec'en").
//
// F2 leverer SKELETTET:
//   (a) loader en population-snapshot (exportPopulationSnapshot.js-format)
//   (b) loader etape-profiler (race_stage_profiles-raekke-form) fra JSON
//   (c) koerer v3 (simulateStage) og v4 (simulateStageV4 via adapters) paa
//       SAMME input pr. etape
//   (d) printer en simpel sammenligningstabel (vinder-type, gruppe-antal,
//       tidsspredning pr. etape)
// Fuld scorecard-scoring mod mor-spec §5's virkeligheds-ankre er 23-24/8-scope
// — se TODO-blokken foer main() nedenfor.
//
// 100% READ-ONLY: laeser kun JSON-filer fra disk. Ingen DB/netvaerks-kald.
//
// Usage:
//   node backend/scripts/headToHeadV4.js --population=<fil> --stages=<fil> [--seed=<streng>]
//
// Eksempel (syntetisk mini-input, verificeret af headToHeadV4.test.js):
//   node backend/scripts/headToHeadV4.js \
//     --population=backend/scripts/fixtures/headToHeadV4-example/population.json \
//     --stages=backend/scripts/fixtures/headToHeadV4-example/stages.json

import { readFileSync } from "node:fs";
import { simulateStage, stableSeed } from "../lib/raceSimulator.js";
import { simulateStageV4 } from "../lib/engine/v4/index.ts";
import { RACE_V4_TUNING } from "../lib/engine/v4/tuning.ts";
import { entrantsFromAbilitiesRows } from "../lib/engine/v4/adapters/entrantAdapter.ts";
import { routeFromStageProfileRow } from "../lib/engine/v4/adapters/routeAdapter.ts";

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
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// TODO (23-24/8): fuld scorecard-scoring mod mor-spec §5's virkeligheds-ankre.
// Denne stub sammenligner ÉN etape ad gangen paa et haandbygget mini-felt —
// den fulde harness skal:
//   - koere HELE S3-kalenderens ruter (ikke et enkelt syntetisk eksempel)
//   - bruge en AEGTE population-snapshot (exportPopulationSnapshot.js mod prod)
//   - akkumulere resultater over en fuld saeson og scorer BEGGE motorer mod:
//       * felt-sammenhaeng 80-95% (hvor taet feltet finisher relativt til vinderen)
//       * nedkoersels-ratio (hvor ofte descent-mekanikken afgoer en etape)
//       * punch-korrelation (finish-rank vs. punch-evne paa punch-finaler)
//       * dominans 25-40% (top-holds andel af sejre over en saeson)
//       * gap-realisme-baand (#2415, gap-fordelinger mod virkelige cykelsports-tal)
//   - erstatte classifyWinType()-proxyen med den rigtige klassifikator naar
//     v4s finale.ts (M4, Fase B3) lander et rigtigt win_type (Fase A's
//     placeholder er "group_finish", jf. index.ts's PLACEHOLDER_WIN_TYPE)
//   - erstatte v3-"gruppe-antal"-proxyen (distinkte gap-buckets) med en rigtig
//     sammenligning naar scorecarden findes (proxyen er KUN til denne stubs
//     overbliksformaal)
// Se designdoc §7 for kravene i fuld bredde.
// ---------------------------------------------------------------------------

function main() {
  const populationPath = argValue("population");
  const stagesPath = argValue("stages");
  const seedInput = argValue("seed", "head-to-head-v4-stub");
  if (!populationPath || !stagesPath) {
    console.error("Usage: node backend/scripts/headToHeadV4.js --population=<fil> --stages=<fil> [--seed=<streng>]");
    process.exit(2);
    return;
  }

  const population = readJson(populationPath);
  const stagesFile = readJson(stagesPath);
  const stages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;

  console.log(`Population: ${population.riders?.length ?? 0} ryttere. Etaper: ${stages?.length ?? 0}. Seed: ${seedInput}`);
  const rows = runHeadToHead({ population, stages, seedInput });
  printComparisonTable(rows);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("headToHeadV4.js")) {
  main();
}
