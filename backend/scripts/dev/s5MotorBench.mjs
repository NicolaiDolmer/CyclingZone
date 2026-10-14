#!/usr/bin/env node
// backend/scripts/dev/s5MotorBench.mjs
// #6362 (S5-etapeprofiler): den rigtige motor-bench bag benchmark-gatens del (4).
//
// HVAD DEN GOER. Koerer v4-motoren under regel-revisionen s5_profiles_v1 (KUN her, i en
// bench-kontekst: flaget og prod-revisionen roeres ikke) paa S5-ruter genereret lokalt
// med generatoren (profileModel "s5"), med de samme saeson-traek som
// scripts/dev/s5ProfileDryRun.mjs (season_id "s5-dryrun-<i>", foerste loebsdag
// S5_MOTOR_BENCH_CONFIG.firstDay). Generatoren og dry-run-scriptet kaldes read-only.
// Feltet er det anonymiserede Giro-felt (scripts/baselines/giro-field-6088-*.json), alle
// hold koert som AI-hold (M14-standardordrer), saa ingen ordre fra en anden rute bruges.
//
// Pr. etape maales: afslutning (s5FinishOf), terraen (B+), gap10 (tid vinder -> nr. 10,
// raa tider, samme definition som benchmarken), om udbruddet vandt, vinderens og top-10's
// ryttertype (computeRiderTypes z-scoret mod feltet, se riderTypeById).
//
// SCOPES (etapeloeb koeres altid i raekkefoelge med klassement).
//   gate  (default) Grand Tours som benchmarken, plus saesonens andre loeb for de
//         afslutninger GT'erne har for faa etaper af (finishesNeedingSeasonSample). Herfra
//         kommer gatens dom: median gap10 pr. afslutning mod benchmarkens kvartil-interval
//         -> "inside" / "below" / "above".
//   gt    kun Grand Tours.
//   all   alle unikke loeb i saesonen (rapporten: mellembjerg og stigende spurt).
//
// HARD RULE 17. Maalte tal (medianer, fordelinger) skrives KUN til balance-internals/
// (gitignoreret). Den committede fixture (backend/lib/__fixtures__/s5MotorBench.json)
// indeholder kun dommen pr. afslutning; s5MotorBench.test.ts koerer benchen igen og
// kraever at dommen stadig passer, saa fixturen kan ikke drive fra motoren.
// Vindertype-dommen (stigende spurt -> spurtere, bjergtop -> klatrere) bruger en PRIVAT
// taerskel fra balance-internals/6362/winner-thresholds.json (eller CZ_6362_WINNER_THRESHOLDS);
// kun dommen "pass"/"fail" staar i fixturen, aldrig taersklen eller andelen.
//
// Koer (offline, ingen DB, intet netvaerk):
//   node backend/scripts/dev/s5MotorBench.mjs                      # gate-scope, rapport til stdout
//   node backend/scripts/dev/s5MotorBench.mjs --scope=all --out=balance-internals/6362
//   node backend/scripts/dev/s5MotorBench.mjs --write-fixture      # opdaterer dommen i fixturen
//
// Refs #6362 #6367

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildTierMaterializationPlan, TIER_DENSITY } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../../lib/calendarStartDate.js";
import { generateRaceStageProfiles } from "../../lib/raceStageProfileGenerator.js";
import { ABILITY_KEYS, computeRiderTypes } from "../../lib/riderTypes.js";
import { loadRaceEngineV4 } from "../../lib/raceEngineV4Bridge.js";
import {
  benchmarkGapIntervals, deriveTerrainTypeBPlus, isGrandTourRace, loadS5Benchmark, motorGapVerdicts,
  DEFAULT_MOTOR_BENCH_PATH, MOTOR_GAP_MIN_BENCHMARK_N, s5FinishOf,
} from "../../lib/s5BenchmarkGate.js";
import { breakawayWin, runStagesInOrder } from "./lib/tourScorecard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(here, "..", "..");
const REPO_ROOT = path.resolve(BACKEND, "..");
const CATALOG_FIXTURE = path.join(BACKEND, "lib", "__fixtures__", "racePoolCatalog.prod.json");
const FIELD_FIXTURE = path.join(BACKEND, "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const REAL_DAYS = 28;

/**
 * Den kanoniske bench. Fixturens dom er skrevet med PRAECIS denne konfiguration, og testen
 * genkoerer den. Aendres den, skal fixturen skrives igen (--write-fixture).
 *   firstDay   S5's foerste loebsdag er ikke fastlagt (#5833); samme eksempeldato som
 *              s5ProfileDryRun.mjs's dokumentation. Generatoren seeder paa loebets
 *              identitet + season_id, saa datoen flytter ikke ruterne.
 *   genSeeds   saeson-traek s5-dryrun-0 .. s5-dryrun-(genSeeds-1), som dry-run-scriptet.
 *   simSeeds   motor-seeds pr. rute.
 */
export const S5_MOTOR_BENCH_CONFIG = Object.freeze({
  revision: "s5_profiles_v1",
  firstDay: "2026-10-26",
  genSeeds: 3,
  simSeeds: 3,
  field: "giro-field-6088-2026-10-02",
});

/**
 * Hvilken ryttertype der skal vinde en afslutning (cykelsporten, kvalitativt). Hvor stor
 * en andel der kraeves er en motor-intern taerskel og ligger privat (hard rule 17).
 */
export const S5_WINNER_EXPECTATIONS = Object.freeze({ uphill_sprint: "sprinter", long_climb: "climber" });

/** Den private taerskelfil (gitignoreret). CZ_6362_WINNER_THRESHOLDS overstyrer stien. */
export const DEFAULT_WINNER_THRESHOLDS_PATH = path.join(REPO_ROOT, "balance-internals", "6362", "winner-thresholds.json");

/**
 * Laeser de private vinder-taerskler: `{ minWinnerShare: { [finish]: andel i [0, 1) } }` for
 * hver afslutning i S5_WINNER_EXPECTATIONS. Mangler filen: null (CI har den ikke; dommen i
 * fixturen gaelder stadig, se s5MotorBench.test.ts). En fil med forkert form er en fejl.
 */
export function loadWinnerThresholds(file = process.env.CZ_6362_WINNER_THRESHOLDS || DEFAULT_WINNER_THRESHOLDS_PATH) {
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, "utf8"));
  for (const finish of Object.keys(S5_WINNER_EXPECTATIONS)) {
    const x = j?.minWinnerShare?.[finish];
    if (!(typeof x === "number" && x >= 0 && x < 1)) throw new Error(`vinder-taerskelfil ${file}: minWinnerShare.${finish} mangler eller er ikke en andel`);
  }
  return j;
}

const median = (xs) => quantile(xs, 0.5);
function quantile(xs, p) {
  const s = xs.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** Antal forskellige etaper (saeson-traek x loeb x etape) pr. afslutning. */
function distinctStagesByFinish(races) {
  const by = {};
  for (const { stages } of races) for (const s of stages) { const f = s5FinishOf(s); by[f] = (by[f] ?? 0) + 1; }
  return by;
}

/**
 * Afslutninger gaten doemmer (benchmarken har mindst MOTOR_GAP_MIN_BENCHMARK_N etaper),
 * men som S5-Grand Tours har for faa etaper af til en median (fx mur: matrixen tillader
 * den, men GT-kvoterne giver ingen). Dem maaler benchen paa resten af saesonens loeb.
 */
export function finishesNeedingSeasonSample(gtRaces, benchmark = loadS5Benchmark()) {
  const gtCounts = distinctStagesByFinish(gtRaces);
  return Object.entries(benchmarkGapIntervals(benchmark))
    .filter(([finish, iv]) => iv.n >= MOTOR_GAP_MIN_BENCHMARK_N && (gtCounts[finish] ?? 0) < MOTOR_GAP_MIN_BENCHMARK_N)
    .map(([finish]) => finish)
    .sort();
}

/**
 * S5-loebene for hvert saeson-traek, som dry-run-scriptet bygger dem: kalender-planen fra
 * prod-katalog-fixturen, hver divisions repraesentative pulje, og hvert unikt loeb (samme
 * loeb i flere divisioner = samme parcours) genereret med profileModel "s5".
 *   scope "gate"  Grand Tours + de andre loeb der har en afslutning GT'erne har for faa af
 *                 (finishesNeedingSeasonSample). Det er gatens maaling.
 *   scope "gt"    kun Grand Tours.   scope "all"   alle loeb (rapporten).
 * @returns {Array<{ seasonId: string, race: object, stages: object[], grandTour: boolean }>}
 */
export function buildS5BenchRaces({ firstDay = S5_MOTOR_BENCH_CONFIG.firstDay, genSeeds = S5_MOTOR_BENCH_CONFIG.genSeeds, scope = "gate" } = {}) {
  if (!["gate", "gt", "all"].includes(scope)) throw new Error(`ukendt scope "${scope}" (gate, gt, all)`);
  const all = generateS5Season({ firstDay, genSeeds });
  if (scope === "all") return all;
  const gt = all.filter((r) => r.grandTour);
  if (scope === "gt") return gt;
  const missing = new Set(finishesNeedingSeasonSample(gt));
  return all.filter((r) => r.grandTour || r.stages.some((s) => missing.has(s5FinishOf(s))));
}

function generateS5Season({ firstDay, genSeeds }) {
  const { pools, catalog } = JSON.parse(readFileSync(CATALOG_FIXTURE, "utf8"));
  const nowDay = new Date(Date.parse(`${firstDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const from = resolveCalendarFrom({ firstRaceDate: firstDay, now: new Date(`${nowDay}T12:00:00Z`) });
  const quotas = Object.fromEntries(Object.entries(TIER_DENSITY).map(([t, d]) => [t, d * REAL_DAYS]));
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from, realDays: REAL_DAYS, quotas, baseSeed: 1, raceTypeSpreadEnabled: false });
  const externalId = new Map(catalog.map((c) => [c.id, c.external_id ?? null]));
  const archetype = new Map(catalog.map((c) => [c.id, c.terrain_archetype ?? null]));

  const out = [];
  for (let i = 0; i < genSeeds; i++) {
    const seasonId = `s5-dryrun-${i}`;
    const seen = new Set();
    for (const tierPlan of tierPlans) {
      for (const r of tierPlan.pools?.[0]?.raceRows ?? []) {
        if (seen.has(r.pool_race_id)) continue;
        seen.add(r.pool_race_id);
        const race = {
          id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
          external_id: externalId.get(r.pool_race_id) ?? null, terrain_archetype: archetype.get(r.pool_race_id) ?? null,
          race_class: r.race_class ?? null, season_id: seasonId, season_variant: 0,
        };
        const grandTour = isGrandTourRace({ ...race, stages: [] });
        out.push({ seasonId, race, stages: generateRaceStageProfiles(race, { profileModel: "s5" }), grandTour });
      }
    }
  }
  return out;
}

/** Det anonymiserede felt med alle hold som AI-hold og uden ordrer fra en anden rute. */
export function loadBenchField() {
  const field = JSON.parse(readFileSync(FIELD_FIXTURE, "utf8"));
  return { ...field, orders: [], teams: field.teams.map((t) => ({ ...t, is_ai: true })) };
}

/**
 * Primaer ryttertype pr. rytter: spillets klassifikator (computeRiderTypes, samme vaegte),
 * men z-scoret mod FELTETS egen fordeling. Spillets baseline er fittet paa evne-lofterne
 * (caps); feltets afledte evner ligger paa en anden skala, og mod den baseline bliver
 * hovedparten af feltet "climber" (ogsaa ryttere med punch langt over klatring).
 */
export function riderTypeById(field) {
  const mean = {};
  const std = {};
  for (const k of ABILITY_KEYS) {
    const xs = field.abilities.map((a) => Number(a[k]) || 0);
    const mu = xs.reduce((s, x) => s + x, 0) / xs.length;
    mean[k] = mu;
    std[k] = Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / xs.length) || 1;
  }
  return new Map(field.abilities.map(({ rider_id, ...abilities }) => [rider_id, computeRiderTypes(abilities, { mean, std }).primary.key]));
}

/** Evnerne vinderprofilen vises i (percentil i feltet, 0-100). */
export const PROFILE_ABILITIES = Object.freeze(["sprint", "acceleration", "punch", "climbing", "time_trial", "durability"]);

/** Hver rytters percentil i feltet pr. PROFILE_ABILITIES (andel af feltet med lavere evne). */
export function abilityPercentiles(field) {
  const out = new Map(field.abilities.map((a) => [a.rider_id, {}]));
  for (const k of PROFILE_ABILITIES) {
    const xs = field.abilities.map((a) => Number(a[k]) || 0);
    for (const a of field.abilities) {
      const v = Number(a[k]) || 0;
      out.get(a.rider_id)[k] = (100 * xs.filter((x) => x < v).length) / Math.max(1, xs.length - 1);
    }
  }
  return out;
}

/** Etapens maalinger fra motorens output (ren). */
export function measureStage({ profile, out, typeById, percentileById = null }) {
  const fin = (out?.results ?? []).filter((r) => r.status === "finished").sort((a, b) => a.time_seconds - b.time_seconds || a.rank - b.rank);
  const finish = s5FinishOf(profile);
  const tt = finish === "solo_tt" || finish === "ttt";
  return {
    stage_number: profile.stage_number,
    profile_type: profile.profile_type,
    finish,
    terrain: tt ? "tt" : deriveTerrainTypeBPlus(profile.climbs),
    gap10: fin.length >= 10 ? fin[9].time_seconds - fin[0].time_seconds : null,
    breakawayWon: tt ? false : breakawayWin(out).won,
    winnerType: fin[0] ? typeById.get(fin[0].rider_id) ?? null : null,
    top10Types: fin.slice(0, 10).map((r) => typeById.get(r.rider_id) ?? null),
    winnerPercentiles: fin[0] && percentileById ? percentileById.get(fin[0].rider_id) ?? null : null,
  };
}

/**
 * Koerer benchen. Returnerer een raekke pr. (loeb, etape, motor-seed).
 * @param {{ races?: ReturnType<typeof buildS5BenchRaces>, simSeeds?: number, revision?: string, v4?: object }} [opts]
 */
export async function runS5MotorBench({ races = buildS5BenchRaces(), simSeeds = S5_MOTOR_BENCH_CONFIG.simSeeds, revision = S5_MOTOR_BENCH_CONFIG.revision, v4 = null } = {}) {
  const engine = v4 ?? await loadRaceEngineV4();
  const field = loadBenchField();
  const typeById = riderTypeById(field);
  const percentileById = abilityPercentiles(field);
  const rows = [];
  for (const { seasonId, race, stages, grandTour } of races) {
    const raceId = `${race.id}:${seasonId}`;
    const profiles = stages.map((p) => ({ ...p, race_id: raceId }));
    const data = { ...field, race: { ...field.race, id: raceId, stages: profiles.length }, profiles };
    for (let seed = 1; seed <= simSeeds; seed++) {
      runStagesInOrder({
        v4: engine, data, revision, seedTag: `s5bench-${seed}`,
        onStage: ({ profile, res }) => {
          rows.push({ seasonId, raceId: race.id, raceName: race.name, grandTour, simSeed: seed, ...measureStage({ profile, out: res.v4Output, typeById, percentileById }) });
        },
      });
    }
  }
  return rows;
}

function typeShares(types) {
  const n = types.filter(Boolean).length;
  const counts = {};
  for (const t of types) if (t) counts[t] = (counts[t] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round1((v / n) * 100)]));
}

function groupStats(rows) {
  const gaps = rows.map((r) => r.gap10).filter((g) => g != null);
  return {
    n: rows.length,
    median: round1(median(gaps)), p25: round1(quantile(gaps, 0.25)), p75: round1(quantile(gaps, 0.75)),
    breakawayWinPct: rows.length ? round1((rows.filter((r) => r.breakawayWon).length / rows.length) * 100) : null,
    winnerTypesPct: typeShares(rows.map((r) => r.winnerType)),
    top10TypesPct: typeShares(rows.flatMap((r) => r.top10Types)),
    // Vinderens median-percentil i feltet pr. evne (50 = midt i feltet).
    winnerProfile: Object.fromEntries(PROFILE_ABILITIES.map((k) => [k, round1(median(rows.map((r) => r.winnerPercentiles?.[k]).filter((v) => v != null)))])),
  };
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return Object.fromEntries([...m].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([k, v]) => [k, groupStats(v)]));
}

/** Median gap10 pr. afslutning (de noegler gatens del 4 doemmer). */
export function benchMedians(rows) {
  const by = new Map();
  for (const r of rows) {
    if (r.gap10 == null) continue;
    if (!by.has(r.finish)) by.set(r.finish, []);
    by.get(r.finish).push(r.gap10);
  }
  return Object.fromEntries([...by].map(([k, v]) => [k, round1(median(v))]));
}

/** Benchmarkens gap10 pr. terraen x afslutning (virkelig cykelsport, GT 2021-2025). */
export function benchmarkByTerrainFinish(benchmark) {
  const rows = benchmark.filter((r) => r.gap10_s != null).map((r) => ({ key: `${r.terrain}/${r.finish}`, gap10: Number(r.gap10_s) }));
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.key)) by.set(r.key, []);
    by.get(r.key).push(r.gap10);
  }
  return Object.fromEntries([...by].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, { n: v.length, median: round1(median(v)), p25: round1(quantile(v, 0.25)), p75: round1(quantile(v, 0.75)) }]));
}

/**
 * Gatens maaling: pr. afslutning Grand Tour-etaperne, naar der er mindst
 * MOTOR_GAP_MIN_BENCHMARK_N forskellige af dem; ellers alle bench-etaper med afslutningen
 * (saesonens andre loeb, se finishesNeedingSeasonSample). Kilden staar i `sources`.
 */
export function gateMeasurement(rows, benchmark) {
  const medians = {};
  const sources = {};
  for (const finish of [...new Set(rows.map((r) => r.finish))].sort()) {
    const { rows: pick, source } = gateRowsFor(rows, finish);
    const m = benchMedians(pick)[finish];
    if (m == null) continue;
    medians[finish] = m;
    sources[finish] = source;
  }
  return { medians, sources, verdicts: motorGapVerdicts({ medians, benchmark }) };
}

/**
 * Raekkerne gaten maaler en afslutning paa: Grand Tour-etaperne naar der er mindst
 * MOTOR_GAP_MIN_BENCHMARK_N forskellige af dem, ellers alle bench-etaper med afslutningen.
 */
export function gateRowsFor(rows, finish) {
  const distinct = (rs) => new Set(rs.map((r) => `${r.seasonId}:${r.raceId}:${r.stage_number}`)).size;
  const gt = rows.filter((r) => r.finish === finish && r.grandTour);
  const useGt = distinct(gt) >= MOTOR_GAP_MIN_BENCHMARK_N;
  return { rows: useGt ? gt : rows.filter((r) => r.finish === finish), source: useGt ? "grand_tours" : "season" };
}

/** Ryttertypen der vinder flest af raekkerne (null uden vindere). Uafgjort: alfabetisk. */
export function dominantWinnerType(rows) {
  const counts = {};
  for (const r of rows) if (r.winnerType) counts[r.winnerType] = (counts[r.winnerType] ?? 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] ?? null;
}

/** Andelen af raekkerne den forventede type vinder (tal: kun til balance-internals). */
export function expectedWinnerShares(rows) {
  const out = {};
  for (const [finish, type] of Object.entries(S5_WINNER_EXPECTATIONS)) {
    const rs = gateRowsFor(rows, finish).rows;
    out[finish] = rs.length ? rs.filter((r) => r.winnerType === type).length / rs.length : null;
  }
  return out;
}

/**
 * Vindertype-dommen pr. afslutning i S5_WINNER_EXPECTATIONS, maalt paa gatens raekker
 * (gateRowsFor): "pass" naar den forventede type vinder en stoerre andel end den private
 * taerskel, ellers "fail". Ingen tal i resultatet (det er det fixturen baerer).
 */
export function winnerVerdicts(rows, thresholds) {
  if (!thresholds?.minWinnerShare) throw new Error("winnerVerdicts: de private vinder-taerskler mangler (balance-internals/6362/winner-thresholds.json)");
  const shares = expectedWinnerShares(rows);
  return Object.fromEntries(Object.entries(S5_WINNER_EXPECTATIONS).map(([finish, expected]) => {
    const s = shares[finish];
    return [finish, { expected, verdict: s != null && s > thresholds.minWinnerShare[finish] ? "pass" : "fail" }];
  }));
}

/** Hele opsummeringen (tal; skrives kun til balance-internals). */
export function summarizeS5MotorBench(rows, benchmark) {
  const gt = rows.filter((r) => r.grandTour);
  return {
    gate: gateMeasurement(rows, benchmark),
    expectedWinnerShares: expectedWinnerShares(rows),
    gt: {
      byFinish: groupBy(gt, (r) => r.finish),
      byTerrainFinish: groupBy(gt, (r) => `${r.terrain}/${r.finish}`),
    },
    all: {
      byFinish: groupBy(rows, (r) => r.finish),
      byTerrainFinish: groupBy(rows, (r) => `${r.terrain}/${r.finish}`),
    },
    benchmark: { byFinish: benchmarkGapIntervals(benchmark), byTerrainFinish: benchmarkByTerrainFinish(benchmark) },
  };
}

/** Fixturen gaten laeser: kun dommene, ingen tal og ingen taerskler (hard rule 17). */
export function fixtureFromSummary(summary, winners) {
  if (!winners) throw new Error("fixtureFromSummary: vindertype-dommen mangler");
  return {
    stub: false,
    source: "#6362 motor-bench: v4 under s5_profiles_v1 (kun bench) paa S5-ruter fra generatoren, anonymiseret Giro-felt. Dom pr. afslutning: median gap10 mod benchmarkens kvartil-interval; kilde grand_tours, eller season naar GT'erne har for faa etaper med afslutningen. Vindertype: forventet type pr. afslutning, doemt mod en privat taerskel. Tal og taerskler: balance-internals/6362/. Skrives af backend/scripts/dev/s5MotorBench.mjs --write-fixture.",
    config: { ...S5_MOTOR_BENCH_CONFIG },
    verdicts: summary.gate.verdicts,
    sources: summary.gate.sources,
    winners,
  };
}

function table(title, groups, bench = null) {
  const ud = [`### ${title}`, "", "| Gruppe | n | gap10 median | p25-p75 | udbrud vandt | vindertyper | top-10-typer | vinder-percentil (spurt/acc/punch/klatr/tt/dur) |" + (bench ? " benchmark median (p25-p75, n) |" : ""), "|---|---|---|---|---|---|---|---|" + (bench ? "---|" : "")];
  const fmt = (o) => Object.entries(o).slice(0, 4).map(([k, v]) => `${k} ${v} %`).join(", ");
  for (const [k, g] of Object.entries(groups)) {
    const b = bench?.[k];
    const prof = PROFILE_ABILITIES.map((a) => g.winnerProfile[a] ?? "-").join("/");
    ud.push(`| ${k} | ${g.n} | ${g.median ?? "-"} s | ${g.p25 ?? "-"}-${g.p75 ?? "-"} s | ${g.breakawayWinPct ?? "-"} % | ${fmt(g.winnerTypesPct)} | ${fmt(g.top10TypesPct)} | ${prof} |` + (bench ? ` ${b ? `${round1(b.median)} s (${round1(b.p25)}-${round1(b.p75)}, n=${b.n})` : "-"} |` : ""));
  }
  return [...ud, ""];
}

export function renderS5MotorBenchMarkdown(summary, { scope, config, thresholds = null }) {
  const lines = [
    `# S5 motor-bench (#6362) - PRIVAT (hard rule 17)`,
    "",
    `Revision ${config.revision} (kun bench) · foerste loebsdag ${config.firstDay} · ${config.genSeeds} saeson-traek · ${config.simSeeds} motor-seeds · felt ${config.field} · scope ${scope}`,
    "",
    "## Gatens del 4",
    "",
    "| Afslutning | kilde | motor median | benchmark p25-p75 | dom |",
    "|---|---|---|---|---|",
    ...Object.entries(summary.gate.medians).map(([k, m]) => {
      const b = summary.benchmark.byFinish[k];
      return `| ${k} | ${summary.gate.sources[k]} | ${m} s | ${b ? `${round1(b.p25)}-${round1(b.p75)} s (n=${b.n})` : "-"} | ${summary.gate.verdicts[k] ?? "ikke dømt"} |`;
    }),
    "",
    "### Vindertype (privat taerskel: balance-internals/6362/winner-thresholds.json)",
    "",
    "| Afslutning | forventet type | andel vundet af typen | taerskel | dom |",
    "|---|---|---|---|---|",
    ...Object.entries(S5_WINNER_EXPECTATIONS).map(([k, type]) => {
      const s = summary.expectedWinnerShares?.[k];
      const t = thresholds?.minWinnerShare?.[k];
      const verdict = s == null || t == null ? "-" : s > t ? "pass" : "fail";
      return `| ${k} | ${type} | ${s == null ? "-" : `${round1(s * 100)} %`} | ${t == null ? "mangler" : `> ${round1(t * 100)} %`} | ${verdict} |`;
    }),
    "",
    ...table("Grand Tours pr. afslutning", summary.gt.byFinish, summary.benchmark.byFinish),
    ...table("Grand Tours pr. terraen/afslutning", summary.gt.byTerrainFinish),
  ];
  if (scope === "all") {
    lines.push(...table("Alle loeb pr. afslutning", summary.all.byFinish), ...table("Alle loeb pr. terraen/afslutning", summary.all.byTerrainFinish));
  }
  lines.push("## Benchmark (GT 2021-2025) pr. terraen/afslutning", "", "| Gruppe | n | median | p25-p75 |", "|---|---|---|---|");
  for (const [k, b] of Object.entries(summary.benchmark.byTerrainFinish)) lines.push(`| ${k} | ${b.n} | ${b.median} s | ${b.p25}-${b.p75} s |`);
  return lines.join("\n");
}

function arg(argv, name, fallback = null) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return argv.includes(`--${name}`) ? true : fallback;
}

async function main(argv) {
  const scope = arg(argv, "scope", "gate");
  const outDir = arg(argv, "out", null);
  const config = S5_MOTOR_BENCH_CONFIG;
  const t0 = performance.now();
  const rows = await runS5MotorBench({ races: buildS5BenchRaces({ scope }) });
  const benchmark = loadS5Benchmark();
  const summary = summarizeS5MotorBench(rows, benchmark);
  const thresholds = loadWinnerThresholds();
  const md = renderS5MotorBenchMarkdown(summary, { scope, config, thresholds });
  if (outDir) {
    const dir = path.isAbsolute(outDir) ? outDir : path.join(REPO_ROOT, outDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `motor-bench-${scope}.json`), JSON.stringify({ config, scope, summary, rows }, null, 2));
    writeFileSync(path.join(dir, `motor-bench-${scope}.md`), md);
    console.error(`skrev ${path.join(dir, `motor-bench-${scope}.{json,md}`)}`);
  } else {
    console.log(md);
  }
  if (arg(argv, "write-fixture") === true) {
    if (scope === "gt") throw new Error("--write-fixture kraever --scope=gate eller all (gt-scope mangler saesonens stikproeve)");
    if (!thresholds) throw new Error(`--write-fixture kraever de private vinder-taerskler: ${DEFAULT_WINNER_THRESHOLDS_PATH} (eller CZ_6362_WINNER_THRESHOLDS)`);
    writeFileSync(DEFAULT_MOTOR_BENCH_PATH, `${JSON.stringify(fixtureFromSummary(summary, winnerVerdicts(rows, thresholds)), null, 2)}\n`);
    console.error(`skrev ${DEFAULT_MOTOR_BENCH_PATH}`);
  }
  console.error(`${rows.length} etape-koersler paa ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err); process.exit(1); });
}
