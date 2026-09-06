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

/** Percentil (lineaer interpolation, p i [0,1]). p=0.5 er identisk med median(). */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = clamp01(p) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;
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
 *
 * #4885 (genmaaling 7/9): maks-tallet ALENE er ubrugeligt som mekanisme-signal.
 * Efter uheldstrappen (M10, #4882) kom ind kan ÉN rytter med et haardt styrt
 * saette hale-maksimum til 20-25 % uden at feltet bagud har en hale
 * overhovedet — det er tidstab, ikke fysiologi. Maalingen skiller derfor de to:
 *
 *   - `p50GapPct`/`p90GapPct`/`p99GapPct` — hele feltets fordeling af gab til
 *     vinderen. p90 er det tal der svarer til "hvor langt bagud ligger de
 *     daarligste 10 %", altsaa den FYSIOLOGISKE hale.
 *   - `cleanMaxGapPct`/`cleanP90GapPct` — samme, men UDEN ryttere der havde et
 *     uheld paa etapen (`incidents[].rider_id`) og uden udgaaede. Er
 *     `cleanMaxGapPct` lille mens `maxPct` er stor, er halen uheldsdrevet.
 *   - `withinNPct` — andel af feltet inden for N % af vinderen. Et samlet felt
 *     har within2 naer 100; et felt med en aegte hale har den lavere.
 *   - `otlCount`/`rescuedCount` — fyrer tidsgraensen (M15) overhovedet, og
 *     redder grupetto-reglen nogen?
 *
 * `incidents`/`timeline` er valgfrie paa input (haandbyggede test-outputs har
 * dem ikke), saa maalingen degenererer sikkert til de rene tids-tal.
 */
export function measureTailSpread(stageOutput) {
  const results = stageOutput.results ?? [];
  const times = results.map((r) => r.time_seconds).sort((a, b) => a - b);
  const winner = times[0] ?? 0;
  const last = times[times.length - 1] ?? 0;
  const medianTime = median(times) ?? winner;
  const spreadSeconds = last - winner;
  const pct = (t) => (winner > 0 ? ((t - winner) / winner) * 100 : 0);
  const gapPcts = times.map(pct);

  const incidentRiderIds = new Set((stageOutput.incidents ?? []).map((i) => i.rider_id));
  const cleanTimes = results
    .filter((r) => !incidentRiderIds.has(r.rider_id) && r.status !== "abandoned")
    .map((r) => r.time_seconds)
    .sort((a, b) => a - b);
  const cleanGapPcts = cleanTimes.map(pct);

  const shareWithin = (limitPct) =>
    gapPcts.length === 0 ? 0 : (gapPcts.filter((g) => g <= limitPct).length / gapPcts.length) * 100;

  const events = stageOutput.timeline?.events ?? [];
  const countRiders = (type) =>
    events
      .filter((e) => e.type === type)
      .reduce((sum, e) => sum + (Number(e.params?.rider_count) || 0), 0);

  return {
    winnerSeconds: winner,
    spreadSeconds,
    spreadPct: winner > 0 ? (spreadSeconds / winner) * 100 : 0,
    medianGapPct: winner > 0 ? ((medianTime - winner) / winner) * 100 : 0,
    p50GapPct: percentile(gapPcts, 0.5) ?? 0,
    p90GapPct: percentile(gapPcts, 0.9) ?? 0,
    p99GapPct: percentile(gapPcts, 0.99) ?? 0,
    cleanP90GapPct: percentile(cleanGapPcts, 0.9) ?? 0,
    cleanMaxGapPct: maxOf(cleanGapPcts) ?? 0,
    incidentRiders: incidentRiderIds.size,
    within1Pct: shareWithin(1),
    within2Pct: shareWithin(2),
    within5Pct: shareWithin(5),
    within10Pct: shareWithin(10),
    // Antal DISTINKTE sluttider = antal maalgrupper. Gruppe-tids-princippet
    // (mor-spec §3.2) goer at halen KUN kan komme fra antallet af grupper og
    // deres indbyrdes gab; er tallet lavt, er der ingen hale at maale.
    finishGroups: new Set(times.map((t) => Math.round(t * 100))).size,
    otlCount: countRiders("outside_time_limit"),
    rescuedCount: countRiders("grupetto_saved"),
    fieldCount: results.length,
  };
}

function entrantsForField(fieldRiders) {
  const rows = fieldRiders.map((r) => ({ rider_id: r.id, ...r.abilities }));
  // condition: 1 (frisk). Harnessen kender ikke dag-til-dag-sliddet — den
  // maaler DISTANCE-armen af M7 isoleret. Condition-armen er daekket af
  // segmentLoop.distanceFatigue.test.ts.
  return entrantsFromAbilitiesRows(rows, () => ({ role: "free_role", effort: "normal", condition: 1 }));
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
        // M11 (#3855-wiring 6/9): vejret er nu koblet ind i kraftkravet, saa
        // hale-spredningen skal kunne laeses PR. VEJRTYPE — ellers kan man
        // hverken se om vejret virker, eller om det virker for meget.
        weatherKind: route.weather?.kind ?? "?",
        windExposure: route.weather?.wind_exposure ?? 0,
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
      const col = (name) => rows.map((r) => r[name] ?? 0);
      return {
        key,
        n: rows.length,
        medianPct: median(pcts),
        maxPct: maxOf(pcts),
        medianSeconds: median(secs),
        maxSeconds: maxOf(secs),
        medianGapPct: median(rows.map((r) => r.medianGapPct)),
        // #4885-diagnostik (7/9): fysiologisk hale vs. uheldsdrevet hale.
        medianP50GapPct: median(col("p50GapPct")),
        medianP90GapPct: median(col("p90GapPct")),
        medianP99GapPct: median(col("p99GapPct")),
        medianCleanP90GapPct: median(col("cleanP90GapPct")),
        medianCleanMaxGapPct: median(col("cleanMaxGapPct")),
        maxCleanMaxGapPct: maxOf(col("cleanMaxGapPct")),
        meanWithin2Pct: mean(col("within2Pct")),
        meanWithin5Pct: mean(col("within5Pct")),
        meanWithin10Pct: mean(col("within10Pct")),
        medianFinishGroups: median(col("finishGroups")),
        // OTL-rate = andel af alle startende paa disse etaper der endte uden
        // for tidsgraensen; redningsraten samme naevner.
        otlPct: (col("otlCount").reduce((s, v) => s + v, 0) / Math.max(1, col("fieldCount").reduce((s, v) => s + v, 0))) * 100,
        rescuedPct: (col("rescuedCount").reduce((s, v) => s + v, 0) / Math.max(1, col("fieldCount").reduce((s, v) => s + v, 0))) * 100,
        stagesWithOtl: rows.filter((r) => (r.otlCount ?? 0) > 0).length,
        stagesWithRescue: rows.filter((r) => (r.rescuedCount ?? 0) > 0).length,
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
 * Spearman-rangkorrelation mellem en evne og placeringen (rank 1 = bedst).
 * Positiv = hoejere evne giver bedre placering. Samme maal-form som
 * headToHeadAnchors' punch-/ITT-korrelationer.
 */
export function abilityRankCorrelation(results, abilityByRider) {
  const rows = results
    .filter((r) => abilityByRider.has(r.rider_id))
    .map((r) => ({ rank: r.rank, ability: abilityByRider.get(r.rider_id) }));
  if (rows.length < 3) return null;
  const rankOf = (values) => {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const out = new Array(values.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[order[k][1]] = avg;
      i = j + 1;
    }
    return out;
  };
  const abilityRanks = rankOf(rows.map((r) => r.ability));
  const placeRanks = rankOf(rows.map((r) => -r.rank)); // hoej rang = god placering
  const n = rows.length;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / n;
  const ma = mean(abilityRanks);
  const mp = mean(placeRanks);
  let num = 0;
  let da = 0;
  let dp = 0;
  for (let i = 0; i < n; i++) {
    num += (abilityRanks[i] - ma) * (placeRanks[i] - mp);
    da += (abilityRanks[i] - ma) ** 2;
    dp += (placeRanks[i] - mp) ** 2;
  }
  return da > 0 && dp > 0 ? num / Math.sqrt(da * dp) : null;
}

/**
 * @returns {Array<{distanceKm:number, spreadPct:number[], meanPct:number, enduranceCorr:number[], meanEnduranceCorr:number}>}
 */
export function runDistanceExperiment({ population, seeds = DEFAULT_SEEDS, fieldSize = DEFAULT_FIELD_SIZE, distances = DISTANCE_EXPERIMENT_KM }) {
  return distances.map((distanceKm) => {
    const spreadPct = [];
    const enduranceCorr = [];
    for (const seed of seeds) {
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
      spreadPct.push(measureTailSpread(output).spreadPct);
      // M7's egen designpaastand (mor-spec §4 M7: "baaret af endurance"):
      // jo laengere etapen er, jo mere skal udholdenhed afgoere placeringen.
      enduranceCorr.push(
        abilityRankCorrelation(output.results, new Map(fieldRiders.map((r) => [r.id, r.abilities.endurance]))) ?? 0,
      );
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    return {
      distanceKm,
      spreadPct,
      meanPct: mean(spreadPct),
      enduranceCorr,
      meanEnduranceCorr: mean(enduranceCorr),
    };
  });
}

// ---------------------------------------------------------------------------
// Kontrolleret endurance-eksperiment (--endurance-experiment)
// ---------------------------------------------------------------------------
//
// M7's egen designpaastand (mor-spec §4 M7) er ikke "halen bliver laengere" men
// "distancen baeres af endurance": jo laengere etapen er, jo mere skal
// udholdenhed afgoere hvem der er med. Mod en aegte population kan det ikke
// maales rent — udholdenhed er staerkt korreleret med alle andre evner, saa en
// korrelation mod placeringen er hoej uanset M7.
//
// Feltet her er derfor KLONER der KUN adskiller sig paa endurance. Alt andet
// (inkl. seed, rute-form og feltstoerrelse) er fastholdt, saa forskellen mellem
// den bedste og den daarligste udholdenhed er M7's bidrag og intet andet.

const ENDURANCE_EXPERIMENT_LEVELS = Object.freeze([5, 11, 20, 30, 45, 60, 75, 99]);
const ENDURANCE_EXPERIMENT_BASE_ABILITY = 30;
const ENDURANCE_ABILITY_KEYS = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
]);

/** Klon-felt: alle evner ens paa basisniveauet, kun endurance varierer. */
export function enduranceCloneField(perLevel = 5) {
  const riders = [];
  for (const level of ENDURANCE_EXPERIMENT_LEVELS) {
    for (let i = 0; i < perLevel; i++) {
      const abilities = {};
      for (const key of ENDURANCE_ABILITY_KEYS) abilities[key] = ENDURANCE_EXPERIMENT_BASE_ABILITY;
      abilities.endurance = level;
      riders.push({ id: `e${String(level).padStart(2, "0")}-${i}`, team_id: `t${level}`, abilities, enduranceLevel: level });
    }
  }
  return riders;
}

/**
 * @returns {Array<{distanceKm:number, gapPct:number[], meanGapPct:number}>}
 *   gapPct = (middeltid for laveste endurance-niveau - middeltid for hoejeste) / vindertid.
 */
export function runEnduranceExperiment({ seeds = DEFAULT_SEEDS, distances = DISTANCE_EXPERIMENT_KM } = {}) {
  const riders = enduranceCloneField();
  const startlist = entrantsForField(riders);
  const lowest = ENDURANCE_EXPERIMENT_LEVELS[0];
  const highest = ENDURANCE_EXPERIMENT_LEVELS[ENDURANCE_EXPERIMENT_LEVELS.length - 1];
  const levelOf = new Map(riders.map((r) => [r.id, r.enduranceLevel]));

  return distances.map((distanceKm) => {
    const gapPct = seeds.map((seed) => {
      const output = simulateStageV4({
        route: scaledMountainRoute(distanceKm),
        startlist,
        orders: [],
        seed: `${seed}:endurance-experiment:${distanceKm}`,
        tuning: RACE_V4_TUNING,
      });
      const meanFor = (level) => {
        const times = output.results.filter((r) => levelOf.get(r.rider_id) === level).map((r) => r.time_seconds);
        return times.reduce((s, v) => s + v, 0) / times.length;
      };
      const winner = Math.min(...output.results.map((r) => r.time_seconds));
      return winner > 0 ? ((meanFor(lowest) - meanFor(highest)) / winner) * 100 : 0;
    });
    return { distanceKm, gapPct, meanGapPct: gapPct.reduce((a, b) => a + b, 0) / gapPct.length };
  });
}

// ---------------------------------------------------------------------------
// Kontrolleret vejr-eksperiment (--weather-experiment)
// ---------------------------------------------------------------------------
//
// M11's wiring-paastand (#3855, 6/9) er "vejret koster kraft og skaerper
// spredningen". Proxy-kalenderens vejr er konfunderet: vejrtypen er seedet
// sammen med etapetype og laengde, saa en tabel "hale-spredning pr. vejrtype"
// blander vejrets effekt sammen med hvilke etaper der tilfaeldigvis fik regn.
//
// Dette eksperiment holder ALT fast — samme rute, samme startfelt, samme seed
// — og varierer KUN route.weather. Forskellen mellem raekkerne er derfor
// vejrets bidrag og intet andet. Den flade rute er med fordi ejer-spoergsmaalet
// bag lanen er "spredning paa flade etaper i vind"; bjergruten er med som
// kontrol paa at vind i lae betyder mindre end vind paa det aabne.

export const WEATHER_EXPERIMENT_CASES = Object.freeze([
  { label: "sol", weather: { kind: "sun", wind_exposure: 0.15 } },
  { label: "overskyet", weather: { kind: "overcast", wind_exposure: 0.15 } },
  { label: "regn", weather: { kind: "rain", wind_exposure: 0.15 } },
  { label: "vind (lav eksp.)", weather: { kind: "wind", wind_exposure: 0.3 } },
  { label: "vind (hoej eksp.)", weather: { kind: "wind", wind_exposure: 0.85 } },
]);

/** Flad rute med KONSTANT form — kun vejret varierer mellem raekkerne. */
export function flatWeatherRoute(weather, distanceKm = 190) {
  const at = (a, b) => [Math.round((a / 100) * distanceKm * 100) / 100, Math.round((b / 100) * distanceKm * 100) / 100];
  const [f1From, f1To] = at(0, 35);
  const [rFrom, rTo] = at(35, 65);
  const [f2From, f2To] = at(65, 100);
  return {
    distance_km: distanceKm,
    profile_type: "flat",
    finale_type: "bunch_sprint",
    segments: [
      { kind: "flat", from_km: f1From, to_km: f1To },
      { kind: "rolling", from_km: rFrom, to_km: rTo },
      { kind: "flat", from_km: f2From, to_km: f2To },
    ],
    weather,
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: distanceKm }],
  };
}

/**
 * @returns {Array<{label:string, kind:string, spreadPct:number[], meanPct:number,
 *   meanWinnerSeconds:number, meanWorkNorm:number, weatherEvents:number}>}
 */
export function runWeatherExperiment({
  population,
  seeds = DEFAULT_SEEDS,
  fieldSize = DEFAULT_FIELD_SIZE,
  routeFn = flatWeatherRoute,
  cases = WEATHER_EXPERIMENT_CASES,
}) {
  return cases.map(({ label, weather }) => {
    const spreadPct = [];
    const workNorms = [];
    const winnerSeconds = [];
    let weatherEvents = 0;
    for (const seed of seeds) {
      // SAMME felt paa tvaers af vejrtyper (feltet seedes uden vejret), saa kun
      // vejret varierer mellem raekkerne.
      const rng = makeRng(stableSeed(`${seed}:weather-experiment:field`));
      const fieldRiders = fieldSize ? sampleField(rng, population.riders, fieldSize) : population.riders;
      const output = simulateStageV4({
        route: routeFn(weather),
        startlist: entrantsForField(fieldRiders),
        orders: [],
        // Seeden baerer IKKE vejrtypen: to vejrtyper skal dele rng-stroem, ellers
        // maaler vi et andet loeb i stedet for det samme loeb i andet vejr.
        seed: `${seed}:weather-experiment`,
        tuning: RACE_V4_TUNING,
      });
      const measured = measureTailSpread(output);
      spreadPct.push(measured.spreadPct);
      // VINDERTIDEN er hovedmaalet for M11's belastnings-arm: vejret saenker
      // den kollektive CP, og segment-farten er afledt af den. Hale-spredningen
      // staar ved siden af som kontrol paa at vejret ikke ogsaa river feltet
      // fra hinanden (det goer det ikke — se PR'ens maaling).
      winnerSeconds.push(measured.winnerSeconds);
      workNorms.push(output.loads.reduce((s, l) => s + l.work_norm, 0) / output.loads.length);
      weatherEvents += output.timeline.events.filter((e) => e.type === "weather").length;
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    return {
      label,
      kind: weather.kind,
      spreadPct,
      meanPct: mean(spreadPct),
      meanWinnerSeconds: mean(winnerSeconds),
      meanWorkNorm: mean(workNorms),
      weatherEvents,
    };
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

/**
 * #4885-diagnose-tabel: skiller den FYSIOLOGISKE hale (p50/p90/p99 + hale uden
 * uheldsramte) fra den UHELDSDREVNE (maks). Uden denne opdeling kan et
 * hale-maksimum paa 25 % lige saa godt vaere ét styrt som en aegte grupetto.
 */
function formatDiagnosticsTable(title, rows) {
  const lines = [
    title,
    "key\tn\tp50%\tp90%\tp99%\tmaks%\tren_p90%\tren_maks%\tren_maks_top%\tinden_2%\tinden_5%\tinden_10%\tmaalgrupper",
  ];
  for (const r of rows) {
    lines.push(
      [
        r.key,
        r.n,
        fmt(r.medianP50GapPct),
        fmt(r.medianP90GapPct),
        fmt(r.medianP99GapPct),
        fmt(r.maxPct),
        fmt(r.medianCleanP90GapPct),
        fmt(r.medianCleanMaxGapPct),
        fmt(r.maxCleanMaxGapPct),
        fmt(r.meanWithin2Pct, 1),
        fmt(r.meanWithin5Pct, 1),
        fmt(r.meanWithin10Pct, 1),
        fmt(r.medianFinishGroups, 0),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

/**
 * HALE-BAAND pr. etapetype (#4885). BEVIDST et RAPPORTERET tal og ikke en
 * haardt fejlende test: baandene er et STARTGAET fra virkelighedens tal
 * (en bjergetapes rode lanterne taber typisk 8-15 % af vindertiden, en flad
 * etape naesten intet) og er IKKE ejer-godkendte. Et gulv er ikke et maal
 * (RACE_ENGINE_RULES §4) — raekken skal kunne laeses og diskuteres, ikke
 * blokere en PR.
 *
 * Maalt paa p90 og ikke paa maks: maks er uheldsdrevet (se
 * measureTailSpread's docblock), og en enkelt styrtet rytter maa ikke kunne
 * melde et baand groent.
 */
export const TAIL_BANDS = Object.freeze({
  flat: [0, 2],
  rolling: [0, 4],
  hilly: [2, 8],
  mountain: [8, 15],
  high_mountain: [8, 15],
  cobbles: [1, 6],
  classic: [3, 10],
});

function formatTailBandTable(title, rows) {
  const lines = [
    title,
    "STARTGAET, IKKE ejer-godkendt — rapporteret raekke, ikke en gate. Maalt paa p90 (maks er uheldsdrevet).",
    "key\tn\tp90_%\tbaand\tstatus",
  ];
  for (const r of rows) {
    const band = TAIL_BANDS[r.key];
    if (!band) continue;
    const value = r.medianP90GapPct;
    const inside = value !== null && value >= band[0] && value <= band[1];
    lines.push([r.key, r.n, fmt(value), `${band[0]}-${band[1]} %`, inside ? "inde" : "ude"].join("\t"));
  }
  return lines.join("\n");
}

/** M15-tabel: fyrer tidsgraensen, og redder grupetto-reglen nogen? */
function formatTimeLimitTable(title, rows) {
  const lines = [title, "key\tn\totl_%\tetaper_m_otl\treddet_%\tetaper_m_redning"];
  for (const r of rows) {
    lines.push([r.key, r.n, fmt(r.otlPct, 3), r.stagesWithOtl, fmt(r.rescuedPct, 3), r.stagesWithRescue].join("\t"));
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

  if (process.argv.includes("--endurance-experiment")) {
    console.log(
      "Kontrolleret endurance-eksperiment: klon-felt der KUN adskiller sig paa udholdenhed, " +
        `samme rute-form, kun distance_km skalerer. Seeds: ${seeds.join(", ")}.`,
    );
    console.log("gap_% = (middeltid, laveste udholdenhed - middeltid, hoejeste) / vindertid. Stiger den med distancen, virker M7.");
    console.log("");
    console.log(["distance_km", ...seeds.map((s) => `${s}_gap%`), "middel_gap%"].join("\t"));
    for (const row of runEnduranceExperiment({ seeds })) {
      console.log([row.distanceKm, ...row.gapPct.map((p) => fmt(p)), fmt(row.meanGapPct)].join("\t"));
    }
    return;
  }

  const population = readJson(populationPath);

  if (process.argv.includes("--distance-experiment")) {
    console.log(
      `Kontrolleret distance-eksperiment: samme rute-form, samme startfelt (${fieldSize}), ` +
        `kun distance_km skalerer. Seeds: ${seeds.join(", ")}.`,
    );
    console.log("");
    console.log("hale_% = (sidste - vinder) / vindertid · endurance_r = rangkorrelation mellem udholdenhed og placering");
    console.log(["distance_km", ...seeds.map((s) => `${s}_hale%`), "middel_hale%", "middel_endurance_r"].join("\t"));
    for (const row of runDistanceExperiment({ population, seeds, fieldSize })) {
      console.log(
        [row.distanceKm, ...row.spreadPct.map((p) => fmt(p)), fmt(row.meanPct), fmt(row.meanEnduranceCorr, 3)].join("\t"),
      );
    }
    return;
  }

  if (process.argv.includes("--weather-experiment")) {
    console.log(
      `Kontrolleret vejr-eksperiment: samme rute, samme startfelt (${fieldSize}), samme seed — ` +
        `kun route.weather varierer. Seeds: ${seeds.join(", ")}.`,
    );
    console.log("");
    console.log("vindertid = hovedmaalet (vejret saenker CP -> lavere kollektiv fart) · hale_% = (sidste - vinder) / vindertid · events = vejr-meldinger i tidslinjen");
    const weatherRows = runWeatherExperiment({ population, seeds, fieldSize });
    const baseline = weatherRows[0]?.meanWinnerSeconds ?? 0;
    console.log(["vejr", "middel_vindertid_s", "vs_sol_%", ...seeds.map((s) => `${s}_hale%`), "middel_hale%", "events"].join("	"));
    for (const row of weatherRows) {
      const vsBaseline = baseline > 0 ? ((row.meanWinnerSeconds - baseline) / baseline) * 100 : 0;
      console.log(
        [row.label, fmt(row.meanWinnerSeconds, 0), fmt(vsBaseline, 3), ...row.spreadPct.map((p) => fmt(p)), fmt(row.meanPct), row.weatherEvents].join("	"),
      );
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

  const byProfileType = summarizeBy(measurements, (m) => m.profileType);
  console.log(formatTable("-- Pr. etapetype (alle seeds samlet) --", byProfileType));
  console.log("");
  console.log(
    formatDiagnosticsTable(
      "-- Hale-diagnose pr. etapetype: fysiologisk hale (p90/ren) vs. uheldsdrevet (maks) --",
      byProfileType,
    ),
  );
  console.log("");
  console.log(formatTailBandTable("-- Hale-baand pr. etapetype (rapporteret, ikke en gate) --", byProfileType));
  console.log("");
  console.log(formatTimeLimitTable("-- M15 tidsgraense pr. etapetype --", byProfileType));
  console.log("");
  console.log(formatTable("-- Pr. distance-baand (alle seeds samlet) --", summarizeBy(measurements, (m) => m.band)));
  console.log("");
  // M11 (#3855-wiring 6/9). BEMAERK: denne tabel er KONFUNDERET — vejrtypen er
  // seedet sammen med etapetypen, saa "regn" og "flad etape" ikke er
  // uafhaengige. Den er et overblik, ikke et bevis; det rene maal er
  // `--weather-experiment`.
  console.log(formatTable("-- Pr. vejrtype (konfunderet, se --weather-experiment) --", summarizeBy(measurements, (m) => m.weatherKind)));
  console.log("");
  const flatByWeather = summarizeBy(
    measurements.filter((m) => m.profileType === "flat"),
    (m) => `flat | ${m.weatherKind}`,
  ).filter((r) => r.n >= 3);
  console.log(formatTable("-- Flade etaper pr. vejrtype (n >= 3) --", flatByWeather));
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
