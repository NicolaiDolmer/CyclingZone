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
import { computePassages } from "../lib/racePassages.js";
import { rankedFromV4Output } from "../lib/raceEngineV4Bridge.js";
import { simulateStageV4 } from "../lib/engine/v4/index.ts";
import { RACE_V4_TUNING } from "../lib/engine/v4/tuning.ts";
import { entrantsFromAbilitiesRows } from "../lib/engine/v4/adapters/entrantAdapter.ts";
import { routeFromStageProfileRow } from "../lib/engine/v4/adapters/routeAdapter.ts";
import { aggregateScorecards, buildScorecard, formatScorecard } from "./lib/headToHeadAnchors.js";
import { buildStageTeamOrders, formatOrderEffect, sumOrderEffects } from "./lib/headToHeadOrders.js";
import { sampleField } from "./lib/headToHeadStats.js";
import { formatTeamPlay, measureTeamPlay } from "./lib/headToHeadTeamPlay.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";

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

// Rolle-/taktik-tildeling (#4615). Population-snapshottet baerer INGEN
// race_role (det er entry-tidspunkt-data, ikke rytter-/hold-data), saa
// harnessen maa selv stille holdene op. To tilstande:
//
//   --orders=none (default): ALLE ryttere faar 'free_role' og ordre-listen er
//     tom — den oprindelige F2-stub-adfaerd, bevaret uaendret saa "foer"-siden
//     af en foer/efter-maaling er praecis den man maalte 2/9.
//   --orders=ai: realistiske roller pr. hold + AI-genererede TeamOrders
//     (lib/headToHeadOrders.js). Uden denne er M6 (lead-out) og M14
//     (AI-taktik) maalbart doed kode i scorecardet — de har intet input.
//
// TODO (F3/M7): map population.form/fatigue -> condition naar motoren
// forbruger feltet.
const DEFAULT_ROLE = "free_role";
const DEFAULT_EFFORT = "normal";

export const ORDER_MODES = Object.freeze(["none", "ai"]);

function v3EntrantsFromPopulation(riders, roles = null) {
  return riders.map((r) => ({
    rider_id: r.id,
    team_id: r.team_id,
    abilities: r.abilities,
    form: r.form ?? null,
    fatigue: r.fatigue ?? null,
    race_role: roles?.get(r.id) ?? DEFAULT_ROLE,
    effort: DEFAULT_EFFORT,
  }));
}

// M16 (#4246): hold-id foelger med ind i v4's startliste, praecis som det
// altid har gjort i v3's (`v3EntrantsFromPopulation` ovenfor). Uden det er
// holdspils-mekanikken en no-op i harnesset, og holddominans-ankeret
// (same_team_top10_share_4plus) ville maale en verden hvor ingen har et hold.
function v4EntrantsFromPopulation(riders, roles = null) {
  const teamByRider = new Map(riders.map((r) => [r.id, r.team_id ?? null]));
  const rows = riders.map((r) => ({ rider_id: r.id, ...r.abilities }));
  return entrantsFromAbilitiesRows(rows, (riderId) => ({
    role: roles?.get(riderId) ?? DEFAULT_ROLE,
    effort: DEFAULT_EFFORT,
    condition: 1,
    teamId: teamByRider.get(riderId) ?? null,
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

// ---------------------------------------------------------------------------
// Uheldsrate (#2944) — audit-fundet 5/9: "uheldsfrekvensen er aldrig maalt mod
// virkeligheden" (nul hits paa "incident" i dette script). Ejerens maal er ca.
// 1-2 % af rytterne pr. etape. Denne sektion summerer v4's uheldsprotokol
// (StageOutput.incidents) til praecis det tal, plus fordelingen paa trappens
// fire udfald og DNF-raten.
// ---------------------------------------------------------------------------

export function summarizeIncidents(rows) {
  const acc = {
    stages: 0,
    riders: 0,
    incidents: 0,
    light: 0,
    hard: 0,
    serious: 0,
    mechanical: 0,
    protectedByRule: 0,
    helperAssists: 0,
    dnf: 0,
  };
  for (const row of rows) {
    const output = row.raw?.v4Output;
    if (!output) continue;
    acc.stages += 1;
    acc.riders += output.results.length;
    acc.dnf += output.results.filter((r) => r.status === "abandoned").length;
    for (const inc of output.incidents ?? []) {
      acc.incidents += 1;
      if (inc.kind === "mechanical") acc.mechanical += 1;
      else if (inc.severity === "serious") acc.serious += 1;
      else if (inc.severity === "hard") acc.hard += 1;
      else acc.light += 1;
      if (inc.outcome === "protected_three_km_rule") acc.protectedByRule += 1;
      if (inc.helper_assist) acc.helperAssists += 1;
    }
  }
  return acc;
}

function pct(part, whole) {
  return whole > 0 ? `${((100 * part) / whole).toFixed(2)} %` : "n/a";
}

export function formatIncidentSummary(acc) {
  const crashes = acc.light + acc.hard + acc.serious;
  return [
    "-- Uheld (#2944, v4) --",
    `Etaper: ${acc.stages}. Rytter-starter i alt: ${acc.riders}.`,
    `Uheld pr. etape: ${pct(acc.incidents, acc.riders)} af rytterne (${acc.incidents} uheld) — ejer-maal 1-2 %.`,
    `Fordeling: let styrt ${acc.light} / haardt styrt ${acc.hard} / alvorligt styrt ${acc.serious} / mekanisk ${acc.mechanical}.`,
    `Andel af STYRT der er alvorlige: ${pct(acc.serious, crashes)} (regressions-taerskel i test: <= 8 %).`,
    `DNF-rate pr. etape: ${pct(acc.dnf, acc.riders)} af feltet (${acc.dnf} udgaaede).`,
    `3 km-reglen beskyttede: ${acc.protectedByRule}. Hjulskift med hjaelper taet paa: ${acc.helperAssists}.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Passage-paritet (#2770/#2413, ejer-beslutning 6/9) — audit-fundet 5/9:
// "bonussekund-ankeret maaler ingenting" og "bjerg- og spurtpassager udsendes
// ikke af v4". Nu goer v4's egen M9-mekanik BEGGE dele, og laget uden for
// motoren gates af. Spoergsmaalet flippet hviler paa er derfor: flytter
// skiftet POINT eller TROEJER?
//
// To ting maales, og de er forskellige af natur:
//   * UDBUDDET (samlet point + bonussekunder pr. etape) skal vaere STRUKTURELT
//     ens: begge motorer bruger de samme ejer-laaste skalaer paa de samme
//     vejpunkter. Afviger det, er en skala drevet fra hinanden — en fejl.
//   * FORDELINGEN (hvem der faar dem, og hvem der ender i troejen) er en
//     MODEL-forskel, ikke en fejl: v3 gaetter "hvem er foran" med en syntetisk
//     udbruds-status, v4 laeser sit rigtige gruppe-lag. Tallet rapporteres som
//     enighedsgrad, ikke som et bestaa/dumpe-krav.
// ---------------------------------------------------------------------------

function sumPassagePoints(passages, kind) {
  let total = 0;
  for (const wp of passages ?? []) {
    if (kind === "kom" ? wp.kind !== "kom" : wp.kind === "kom") continue;
    for (const res of wp.results ?? []) total += res.points ?? 0;
  }
  return total;
}

function sumPassageBonus(passages) {
  let total = 0;
  for (const wp of passages ?? []) {
    for (const res of wp.results ?? []) total += res.bonus_seconds ?? 0;
  }
  return total;
}

/** rider_id -> samlet point, til troeje-sammenligningen. */
function accumulatePoints(target, passages, kind) {
  for (const wp of passages ?? []) {
    if (kind === "kom" ? wp.kind !== "kom" : wp.kind === "kom") continue;
    for (const res of wp.results ?? []) {
      if (!res.points) continue;
      target.set(res.rider_id, (target.get(res.rider_id) ?? 0) + res.points);
    }
  }
}

function leaderOf(totals) {
  let best = null;
  for (const [riderId, points] of totals) {
    if (!best || points > best.points || (points === best.points && riderId < best.riderId)) {
      best = { riderId, points };
    }
  }
  return best?.riderId ?? null;
}

/**
 * @param {Array<Array>} rowsPerSeed  ét rows-array pr. seed (ét "loeb" hver)
 */
export function summarizePassageParity(rowsPerSeed) {
  const acc = {
    stages: 0,
    stagesWithPassages: 0,
    v3SprintPoints: 0, v4SprintPoints: 0,
    v3KomPoints: 0, v4KomPoints: 0,
    v3Bonus: 0, v4Bonus: 0,
    stagesWithPointMismatch: 0,
    races: 0,
    pointsJerseyMatches: 0,
    komJerseyMatches: 0,
    maxBonusPerRiderStage: 0,
    // Isoleret lag-sammenligning: SAMME resultatliste (v4's), to passage-lag.
    isolatedPointsJerseyMatches: 0,
    isolatedKomJerseyMatches: 0,
    isolatedTop3Stages: 0,
    isolatedTop3Matches: 0,
  };
  for (const rows of rowsPerSeed) {
    acc.races += 1;
    const v3PointsTotals = new Map();
    const v4PointsTotals = new Map();
    const v3KomTotals = new Map();
    const v4KomTotals = new Map();
    const isoPointsTotals = new Map();
    const isoKomTotals = new Map();
    for (const row of rows) {
      const v3Passages = row.raw?.v3Passages?.passages ?? [];
      const v4Passages = row.raw?.v4Output?.passages ?? [];
      acc.stages += 1;
      if (v3Passages.length > 0 || v4Passages.length > 0) acc.stagesWithPassages += 1;

      const v3Sprint = sumPassagePoints(v3Passages, "sprint");
      const v4Sprint = sumPassagePoints(v4Passages, "sprint");
      const v3Kom = sumPassagePoints(v3Passages, "kom");
      const v4Kom = sumPassagePoints(v4Passages, "kom");
      acc.v3SprintPoints += v3Sprint; acc.v4SprintPoints += v4Sprint;
      acc.v3KomPoints += v3Kom; acc.v4KomPoints += v4Kom;
      acc.v3Bonus += sumPassageBonus(v3Passages);
      acc.v4Bonus += sumPassageBonus(v4Passages);
      if (v3Sprint !== v4Sprint || v3Kom !== v4Kom) acc.stagesWithPointMismatch += 1;

      for (const total of (row.raw?.v4Output?.passage_totals ?? [])) {
        acc.maxBonusPerRiderStage = Math.max(acc.maxBonusPerRiderStage, total.bonus_seconds ?? 0);
      }

      accumulatePoints(v3PointsTotals, v3Passages, "sprint");
      accumulatePoints(v4PointsTotals, v4Passages, "sprint");
      accumulatePoints(v3KomTotals, v3Passages, "kom");
      accumulatePoints(v4KomTotals, v4Passages, "kom");

      // ISOLERET: v3's lag paa v4's EGET resultat. Her er motoren holdt fast,
      // saa forskellen der maales er lagets egen model — hvem der reelt er
      // foran ved vejpunktet.
      const isoPassages = row.raw?.v3PassagesOnV4Result?.passages ?? [];
      accumulatePoints(isoPointsTotals, isoPassages, "sprint");
      accumulatePoints(isoKomTotals, isoPassages, "kom");
      for (const wp of v4Passages) {
        if (wp.kind === "finish") continue; // maalpassagen er per definition ens (samme resultatliste)
        const iso = isoPassages.find((p) => p.kind === wp.kind && p.index === wp.index);
        if (!iso) continue;
        acc.isolatedTop3Stages += 1;
        const top3 = (p) => (p.results ?? []).slice(0, 3).map((r) => r.rider_id).join(",");
        if (top3(iso) === top3(wp)) acc.isolatedTop3Matches += 1;
      }
    }
    if (leaderOf(v3PointsTotals) && leaderOf(v3PointsTotals) === leaderOf(v4PointsTotals)) acc.pointsJerseyMatches += 1;
    if (leaderOf(v3KomTotals) && leaderOf(v3KomTotals) === leaderOf(v4KomTotals)) acc.komJerseyMatches += 1;
    if (leaderOf(isoPointsTotals) && leaderOf(isoPointsTotals) === leaderOf(v4PointsTotals)) acc.isolatedPointsJerseyMatches += 1;
    if (leaderOf(isoKomTotals) && leaderOf(isoKomTotals) === leaderOf(v4KomTotals)) acc.isolatedKomJerseyMatches += 1;
  }
  return acc;
}

export function formatPassageParity(acc) {
  const delta = (a, b) => (a === b ? "identisk" : `AFVIGER (${b - a})`);
  return [
    "-- Passage-paritet (#2770/#2413, v3-lag mod v4-mekanik) --",
    `Etaper: ${acc.stages} (${acc.stagesWithPassages} med passager). Loeb (seeds): ${acc.races}.`,
    `Samlet spurt-/maalpoint: v3 ${acc.v3SprintPoints} vs v4 ${acc.v4SprintPoints} — ${delta(acc.v3SprintPoints, acc.v4SprintPoints)}.`,
    `Samlet bjergpoint:       v3 ${acc.v3KomPoints} vs v4 ${acc.v4KomPoints} — ${delta(acc.v3KomPoints, acc.v4KomPoints)}.`,
    `Etaper med afvigende pointudbud: ${acc.stagesWithPointMismatch} (tolerance: 0 — skalaerne er ejer-laaste og skal vaere ens).`,
    `Samlede bonussekunder:   v3 ${acc.v3Bonus} vs v4 ${acc.v4Bonus} — v4 er lavere naar per-rytter-loftet (#2413) bider; v3 har intet loft.`,
    `Stoerste bonus én rytter fik paa én etape (v4): ${acc.maxBonusPerRiderStage}s (loft: 10s).`,
    `Samme point-troeje som v3 (v3-motor mod v4-motor): ${acc.pointsJerseyMatches}/${acc.races} loeb. Samme bjerg-troeje: ${acc.komJerseyMatches}/${acc.races}.`,
    "  (Det tal maaler TO ting paa én gang: motorforskellen OG lagforskellen. Linjen nedenfor isolerer laget.)",
    `ISOLERET (samme resultatliste, to lag): samme point-troeje ${acc.isolatedPointsJerseyMatches}/${acc.races}, samme bjerg-troeje ${acc.isolatedKomJerseyMatches}/${acc.races}.`,
    `ISOLERET top-3 pr. vejpunkt undervejs: ${acc.isolatedTop3Matches}/${acc.isolatedTop3Stages} passager enige.`,
    "  (Uenighed her er en MODEL-forskel, ikke en fejl: v3 gaetter hvem der er foran med en syntetisk udbruds-status,",
    "   v4 laeser sit rigtige gruppe-lag. Det er hele grunden til at flytte passagerne ind i motoren.)",
  ].join("\n");
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

export function runHeadToHead({
  population,
  stages,
  seedInput = "head-to-head-v4-stub",
  fieldSize = null,
  orderMode = "none",
}) {
  if (!population?.riders?.length) throw new Error("population.riders mangler eller er tom");
  if (!Array.isArray(stages) || stages.length === 0) throw new Error("stages mangler eller er tom");
  if (!ORDER_MODES.includes(orderMode)) {
    throw new Error(`ukendt --orders-tilstand "${orderMode}" (gyldige: ${ORDER_MODES.join(", ")})`);
  }

  // fieldSize=null (default): SAMME hele population paa ALLE etaper — det
  // oprindelige F2-adfaerd (uaendret, alle eksisterende tests dækker denne
  // gren). fieldSize=N (23/8-tilfoejelse, jf. scorecard-dokumentets metodologi-
  // afsnit): flere §5-ankre (feltsammenhaeng, bjerg-top10-spredning, nedkoersel/
  // summit-ratio) er kalibreret paa REALISTISKE etape-feltstoerrelser
  // (~150-200 ryttere) — en 6328-rytters "hele populationen paa hver etape"-
  // koersel forvraenger disse SEKUND-baserede maal (stoerre felt = laengere
  // hale, ogsaa naar kernen er lige saa sammenhaengende). Med fieldSize>0
  // traekkes et DETERMINISTISK sample pr. etape (seedet af seedInput+etape-
  // nummer, samme sampleField-helper som --films bruger), saa hver etape faar
  // sit eget realistiske startfelt i stedet for hele populationen.
  const rows = [];
  for (const stageRow of stages) {
    if (!stageRow.demand_vector) {
      throw new Error(`etape ${stageRow.stage_number ?? "?"}: demand_vector mangler (kraeves af simulateStage/v3)`);
    }
    const stageSeedStr = `${seedInput}:${stageRow.stage_number ?? 1}`;
    const v3Seed = stableSeed(stageSeedStr);

    let fieldRiders = population.riders;
    if (fieldSize) {
      const rng = makeRng(stableSeed(`${stageSeedStr}:field`));
      fieldRiders = sampleField(rng, population.riders, fieldSize);
    }

    const route = routeFromStageProfileRow(stageRow);

    // #4615: roller og ordrer bygges paa DET FELT der reelt starter etapen —
    // ikke paa hele populationen. Et hold der kun har to ryttere med i dagens
    // felt kan ikke stille et sprint-tog op, og det skal harnessen afspejle.
    let orders = [];
    let roles = null;
    let orderEffect = null;
    if (orderMode === "ai") {
      const built = buildStageTeamOrders({ riders: fieldRiders, route });
      orders = built.orders;
      roles = built.roles;
      orderEffect = built.effect;
    }

    const v3Entrants = v3EntrantsFromPopulation(fieldRiders, roles);
    const v4Entrants = v4EntrantsFromPopulation(fieldRiders, roles);

    const v3Output = simulateStage({ entrants: v3Entrants, stageProfile: stageRow, seed: v3Seed, v3: true });
    const v4Output = simulateStageV4({
      route,
      startlist: v4Entrants,
      orders,
      seed: stageSeedStr,
      tuning: RACE_V4_TUNING,
    });

    rows.push({
      stageNumber: stageRow.stage_number ?? "?",
      profileType: stageRow.profile_type ?? "?",
      v3: summarizeV3(v3Output.ranked),
      v4: summarizeV4(v4Output),
      fieldSize: fieldRiders.length,
      orderEffect,
      // Raat, u-sammenfattet output pr. etape — konsumeres af
      // headToHeadAnchors.buildScorecard() (mor-spec §5-scoring). Additiv felt,
      // aendrer intet ved de eksisterende summary-felter ovenfor (bagudkompatibelt
      // med F2-stubbens egne tests).
      // `roles` (M16, #4246): rolle-tildelingen for netop DETTE felt, saa
      // holdspils-maalingen kan gruppere placeringer pr. rolle uden at gaette.
      // Null naar orders=none (ingen roller tildelt).
      //
      // #2770/#2413-paritet: v3's passage-lag paa PRAECIS de samme etaper.
      // v4's egne passager ligger i v4Output.passages. Sammenligningen
      // (summarizePassageParity) er den vagt der fanger om flippet ville
      // flytte point eller troejer.
      raw: {
        v3Output,
        v4Output,
        route,
        tuning: RACE_V4_TUNING,
        stageRow,
        roles,
        v3Passages: computePassages({
          ranked: v3Output.ranked,
          stageProfile: stageRow,
          entrants: v3Entrants,
          seed: v3Seed,
          isStageRace: true,
        }),
        // Den APPLES-TO-APPLES-sammenligning: v3's passage-lag koert paa V4's
        // EGET resultat. Uden den maaler troeje-sammenligningen to ting paa én
        // gang (motorforskellen OG lagforskellen), og lagets eget bidrag kan
        // ikke laeses ud.
        v3PassagesOnV4Result: computePassages({
          ranked: rankedFromV4Output(v4Output),
          stageProfile: stageRow,
          entrants: v3Entrants,
          seed: v3Seed,
          isStageRace: true,
        }),
      },
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

// Laeselighed (23/8-scorecard-krav: "haandplukkede loebsfilm ejeren kan
// laese"): rider_id-lister (peloton_splits/finale_attack/finish.top) er den
// stoerste stoej-kilde i en tidslinje med et realistisk feltstoerrelse —
// erstattes af et antal + de foerste faa id'er, IKKE hele listen. Rene
// data-transformation, INGEN aendring af hvad der reelt skete i loebet (kun
// af hvordan det VISES) — output.timeline.events selv rores ikke.
const MAX_INLINE_RIDER_IDS = 3;

function summarizeParamValue(value) {
  if (Array.isArray(value) && value.length > MAX_INLINE_RIDER_IDS && value.every((v) => typeof v === "string")) {
    return [...value.slice(0, MAX_INLINE_RIDER_IDS), `... (+${value.length - MAX_INLINE_RIDER_IDS} flere)`];
  }
  return value;
}

export function summarizeEventParams(params) {
  if (!params || typeof params !== "object") return params;
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "rider_ids") {
      out[key] = summarizeParamValue(value);
    } else if (key === "top" && Array.isArray(value)) {
      // finish.top: behold som er (kun top-10, allerede kompakt).
      out[key] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

// Exporteret (ikke kun internt brugt af runFilms) saa 23/8-scorecard-koersler
// kan genbruge SAMME tekst-format til haandplukkede RIGTIGE S3-kalender-etaper
// (docs/audits/films-v4-2026-08-23/) uden at duplikere formateringslogik —
// scenario skal blot have {name, input:{route, seed, startlist}}.
export function formatFilmText(scenario, output) {
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
    lines.push(`km ${padKm(ev.km)}  ${ev.type.padEnd(20)} ${JSON.stringify(summarizeEventParams(ev.params))}`);
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

// ---------------------------------------------------------------------------
// Laast feltstoerrelse (#4615, #4604 modsigelse 11)
// ---------------------------------------------------------------------------
//
// Flere ankre er SEKUND-baserede og skalerer med feltet: samme kode scorede
// 211 s paa bjerg-top-10-spredningen ved 180 ryttere og 19 s ved hele
// populationen (5.650, jf. backend/scripts/baselines/population-snapshot-2026-07-11.json —
// #4604 og RACE_ENGINE_RULES §7 refererede foer 6/9 en stale 5.938), fordi en
// stor peloton giver en stor frontgruppe.
// Scorecardet maa derfor ikke kunne koere paa en tilfaeldig feltstoerrelse —
// gaten er kalibreret paa et REALISTISK startfelt (kørsel B, scorecard-
// metodologien 23/8), og den stoerrelse er nu default i stedet for et flag
// man skal huske. `--field-size=all` er den eksplicitte, dokumenterede vej ud.
export const LOCKED_FIELD_SIZE = 180;

/** @returns {number|null} feltstoerrelse pr. etape; null = hele populationen. */
export function resolveFieldSize(arg) {
  if (arg === null || arg === undefined || arg === "") return LOCKED_FIELD_SIZE;
  if (String(arg).toLowerCase() === "all") return null;
  const n = Number(arg);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`ugyldig --field-size="${arg}" (forventer et positivt tal eller "all")`);
  }
  return Math.floor(n);
}

/** `--seeds=a,b,c` -> liste af seed-strenge; tom -> [seedInput]. */
export function resolveSeeds(seedsArg, seedInput) {
  if (!seedsArg) return [seedInput];
  const seeds = String(seedsArg)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return seeds.length > 0 ? seeds : [seedInput];
}

// ---------------------------------------------------------------------------
// --json=<fil> (#4911) — skriver scorecardet som JSON i stedet for kun at
// printe det. APPEND-ONLY: roerer ingen eksisterende maale-logik, kun et nyt
// serialiserings-lag ovenpaa det allerede byggede scorecard (samme objekt
// formatScorecard() laeser). "display"-funktionerne i hver celle er ikke
// JSON-serialiserbare og er derfor udeladt her; render-scriptet
// (renderV4AnchorTable.mjs) formaterer selv tallene ud fra id'et.
// ---------------------------------------------------------------------------

function stripDisplay(cell) {
  if (!cell || typeof cell !== "object") return cell;
  // Destruktureret KUN for at udelade den fra `rest` — praefikset `_` matcher
  // lint-reglens allowed-unused-vars-moenster (/^_/u).
  const { display: _display, ...rest } = cell;
  return rest;
}

/**
 * @param {ReturnType<typeof aggregateScorecards>} scorecard
 * @param {object} meta  koersel-metadata (population/stages/seeds/etc.) —
 *   fil-hashes og git-sha tilfoejes af det kald der GEMMER baseline-filen,
 *   ikke af selve harnessen, som ikke kender git.
 * @returns {object}  JSON-klar struktur
 */
export function buildJsonExport(scorecard, meta) {
  return {
    schema_version: 1,
    meta,
    anchors: scorecard.map((anchor) => ({
      id: anchor.id,
      label: anchor.label,
      band_label: anchor.bandLabel,
      source: anchor.source,
      v3: stripDisplay(anchor.v3),
      v4: stripDisplay(anchor.v4),
    })),
  };
}

const USAGE =
  "Usage: node backend/scripts/headToHeadV4.js --population=<fil> --stages=<fil> " +
  '[--seed=<streng>] [--seeds=<s1,s2,...>] [--orders=none|ai] [--field-size=<n>|all] ' +
  "[--films[=<dir>]] [--json=<fil>]";

function main() {
  const populationPath = argValue("population");
  const stagesPath = argValue("stages");
  const seedInput = argValue("seed", "head-to-head-v4-stub");
  const filmsRequested = process.argv.includes("--films") || process.argv.some((a) => a.startsWith("--films="));
  const filmsDir = argValue("films", join(SCRIPT_DIR, "out", "films"));
  const fieldSize = resolveFieldSize(argValue("field-size"));
  const orderMode = argValue("orders", "none");
  const seeds = resolveSeeds(argValue("seeds"), seedInput);
  const jsonPath = argValue("json");

  if (!populationPath || !stagesPath) {
    console.error(USAGE);
    process.exit(2);
    return;
  }

  const population = readJson(populationPath);
  const stagesFile = readJson(stagesPath);
  const stages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;

  const fieldLabel = fieldSize === null ? "hele populationen (--field-size=all)" : `${fieldSize} (laast, sampled pr. etape)`;
  console.log(
    `Population: ${population.riders?.length ?? 0} ryttere. Etaper: ${stages?.length ?? 0}. ` +
      `Seeds: ${seeds.join(", ")}. Feltstoerrelse pr. etape: ${fieldLabel}. Ordrer: ${orderMode}`,
  );

  const teamByRider = buildTeamByRider(population.riders);
  const abilitiesByRider = buildAbilitiesByRider(population.riders);
  const v4Entrants = v4EntrantsFromPopulation(population.riders);
  const v4EntrantsById = Object.fromEntries(v4Entrants.map((e) => [e.rider_id, e]));

  const scorecards = [];
  const orderEffects = [];
  const allRows = [];
  const rowsPerSeed = [];
  for (const seed of seeds) {
    const rows = runHeadToHead({ population, stages, seedInput: seed, fieldSize, orderMode });
    if (seeds.length === 1) printComparisonTable(rows);
    for (const row of rows) if (row.orderEffect) orderEffects.push(row.orderEffect);
    allRows.push(...rows);
    rowsPerSeed.push(rows);
    scorecards.push(buildScorecard(rows, { teamByRider, abilitiesByRider, v4EntrantsById }));
  }

  console.log("");
  console.log(formatIncidentSummary(summarizeIncidents(allRows)));

  console.log("");
  console.log(formatPassageParity(summarizePassageParity(rowsPerSeed)));

  if (orderEffects.length > 0) {
    console.log("");
    console.log(formatOrderEffect(sumOrderEffects(orderEffects)));
  }

  // M16 (#4246): holddominans-ankeret ligger paa sit gulv (0,0 %) i BEGGE
  // motorer og kan derfor hverken bekraefte eller afkraefte at holdspillet
  // virker. Denne maaling kan — se lib/headToHeadTeamPlay.js's hoved.
  const teamPlay = measureTeamPlay(allRows, { abilitiesByRider });
  if (teamPlay.v4.stages > 0) {
    console.log("");
    console.log(formatTeamPlay(teamPlay));
  }

  const scorecard = aggregateScorecards(scorecards);
  console.log("");
  if (seeds.length > 1) {
    console.log(`(Ankre nedenfor er MIDLET over ${seeds.length} seeds med spaend — gate-formen ejeren valgte 2/9.)`);
  }
  console.log(formatScorecard(scorecard));

  if (jsonPath) {
    const json = buildJsonExport(scorecard, {
      population_file: populationPath,
      stages_file: stagesPath,
      population_riders: population.riders?.length ?? 0,
      seeds,
      field_size: fieldSize,
      order_mode: orderMode,
      generated_at: new Date().toISOString(),
    });
    writeFileSync(jsonPath, JSON.stringify(json, null, 2));
    console.log("");
    console.log(`JSON-scorecard skrevet til: ${jsonPath}`);
  }

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
