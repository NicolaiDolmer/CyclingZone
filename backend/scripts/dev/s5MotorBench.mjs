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
// ryttertype (computeRiderTypes mod den voksne baseline).
//
// TO SCOPES.
//   gt   Grand Tours (som benchmarken). Det er HER gatens dom kommer fra: median gap10 pr.
//        afslutning mod benchmarkens kvartil-interval -> "inside" / "below" / "above".
//   all  alle unikke loeb i saesonen (etapeloeb koeres i raekkefoelge med klassement).
//        Kun til rapporten (mellembjerg og stigende spurt har faa GT-etaper).
//
// HARD RULE 17. Maalte tal (medianer, fordelinger) skrives KUN til balance-internals/
// (gitignoreret). Den committede fixture (backend/lib/__fixtures__/s5MotorBench.json)
// indeholder kun dommen pr. afslutning; s5MotorBench.test.ts koerer benchen igen og
// kraever at dommen stadig passer, saa fixturen kan ikke drive fra motoren.
//
// Koer (offline, ingen DB, intet netvaerk):
//   node backend/scripts/dev/s5MotorBench.mjs                      # gt-scope, rapport til stdout
//   node backend/scripts/dev/s5MotorBench.mjs --scope=all --out=balance-internals/6362
//   node backend/scripts/dev/s5MotorBench.mjs --write-fixture      # opdaterer dommen i fixturen
//
// Refs #6362 #6367

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildTierMaterializationPlan, TIER_DENSITY } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../../lib/calendarStartDate.js";
import { generateRaceStageProfiles } from "../../lib/raceStageProfileGenerator.js";
import { computeRiderTypes } from "../../lib/riderTypes.js";
import { loadRaceEngineV4 } from "../../lib/raceEngineV4Bridge.js";
import {
  benchmarkGapIntervals, deriveTerrainTypeBPlus, isGrandTourRace, loadS5Benchmark, motorGapVerdicts,
  DEFAULT_MOTOR_BENCH_PATH, s5FinishOf,
} from "../../lib/s5BenchmarkGate.js";
import { breakawayWin, runStagesInOrder } from "./lib/tourScorecard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(here, "..", "..");
const REPO_ROOT = path.resolve(BACKEND, "..");
const CATALOG_FIXTURE = path.join(BACKEND, "lib", "__fixtures__", "racePoolCatalog.prod.json");
const FIELD_FIXTURE = path.join(BACKEND, "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const TYPES_BASELINE = path.join(BACKEND, "lib", "riderTypesBaseline.json");
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

/**
 * S5-loebene for hvert saeson-traek, som dry-run-scriptet bygger dem: kalender-planen fra
 * prod-katalog-fixturen, hver divisions repraesentative pulje, og hvert unikt loeb (samme
 * loeb i flere divisioner = samme parcours) genereret med profileModel "s5".
 * @returns {Array<{ seasonId: string, race: object, stages: object[], grandTour: boolean }>}
 */
export function buildS5BenchRaces({ firstDay = S5_MOTOR_BENCH_CONFIG.firstDay, genSeeds = S5_MOTOR_BENCH_CONFIG.genSeeds, scope = "gt" } = {}) {
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
        const grandTour = isGrandTourRace({ ...race, stages: [] }) || race.terrain_archetype === "grand_tour";
        if (scope === "gt" && !grandTour) continue;
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

/** Primaer ryttertype pr. rytter (samme klassifikator som spillet, voksen-baselinen). */
export function riderTypeById(field) {
  const baseline = JSON.parse(readFileSync(TYPES_BASELINE, "utf8"));
  return new Map(field.abilities.map(({ rider_id, ...abilities }) => [rider_id, computeRiderTypes(abilities, baseline).primary.key]));
}

/** Etapens maalinger fra motorens output (ren). */
export function measureStage({ profile, out, typeById }) {
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
  const rows = [];
  for (const { seasonId, race, stages, grandTour } of races) {
    const raceId = `${race.id}:${seasonId}`;
    const profiles = stages.map((p) => ({ ...p, race_id: raceId }));
    const data = { ...field, race: { ...field.race, id: raceId, stages: profiles.length }, profiles };
    for (let seed = 1; seed <= simSeeds; seed++) {
      runStagesInOrder({
        v4: engine, data, revision, seedTag: `s5bench-${seed}`,
        onStage: ({ profile, res }) => {
          rows.push({ seasonId, raceId: race.id, raceName: race.name, grandTour, simSeed: seed, ...measureStage({ profile, out: res.v4Output, typeById }) });
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

/** Hele opsummeringen (tal; skrives kun til balance-internals). */
export function summarizeS5MotorBench(rows, benchmark) {
  const gt = rows.filter((r) => r.grandTour);
  const medians = benchMedians(gt);
  return {
    gt: {
      byFinish: groupBy(gt, (r) => r.finish),
      byTerrainFinish: groupBy(gt, (r) => `${r.terrain}/${r.finish}`),
      medians,
      verdicts: motorGapVerdicts({ medians, benchmark }),
    },
    all: {
      byFinish: groupBy(rows, (r) => r.finish),
      byTerrainFinish: groupBy(rows, (r) => `${r.terrain}/${r.finish}`),
    },
    benchmark: { byFinish: benchmarkGapIntervals(benchmark), byTerrainFinish: benchmarkByTerrainFinish(benchmark) },
  };
}

/** Fixturen gaten laeser: kun dommen pr. afslutning, ingen tal (hard rule 17). */
export function fixtureFromSummary(summary) {
  return {
    stub: false,
    source: "#6362 motor-bench: v4 under s5_profiles_v1 (kun bench) paa S5-ruter fra generatoren, Grand Tours, anonymiseret Giro-felt. Dom pr. afslutning: median gap10 mod benchmarkens kvartil-interval. Tal: balance-internals/6362/. Skrives af backend/scripts/dev/s5MotorBench.mjs --write-fixture.",
    config: { ...S5_MOTOR_BENCH_CONFIG },
    verdicts: summary.gt.verdicts,
  };
}

function table(title, groups, bench = null) {
  const ud = [`### ${title}`, "", "| Gruppe | n | gap10 median | p25-p75 | udbrud vandt | vindertyper | top-10-typer |" + (bench ? " benchmark median (p25-p75, n) |" : ""), "|---|---|---|---|---|---|---|" + (bench ? "---|" : "")];
  const fmt = (o) => Object.entries(o).slice(0, 4).map(([k, v]) => `${k} ${v} %`).join(", ");
  for (const [k, g] of Object.entries(groups)) {
    const b = bench?.[k];
    ud.push(`| ${k} | ${g.n} | ${g.median ?? "-"} s | ${g.p25 ?? "-"}-${g.p75 ?? "-"} s | ${g.breakawayWinPct ?? "-"} % | ${fmt(g.winnerTypesPct)} | ${fmt(g.top10TypesPct)} |` + (bench ? ` ${b ? `${round1(b.median)} s (${round1(b.p25)}-${round1(b.p75)}, n=${b.n})` : "-"} |` : ""));
  }
  return [...ud, ""];
}

export function renderS5MotorBenchMarkdown(summary, { scope, config }) {
  const lines = [
    `# S5 motor-bench (#6362) - PRIVAT (hard rule 17)`,
    "",
    `Revision ${config.revision} (kun bench) · foerste loebsdag ${config.firstDay} · ${config.genSeeds} saeson-traek · ${config.simSeeds} motor-seeds · felt ${config.field} · scope ${scope}`,
    "",
    "## Gatens del 4 (Grand Tours)",
    "",
    "| Afslutning | motor median | dom |",
    "|---|---|---|",
    ...Object.entries(summary.gt.verdicts).map(([k, v]) => `| ${k} | ${summary.gt.medians[k] ?? "-"} s | ${v} |`),
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
  const scope = arg(argv, "scope", "gt");
  if (scope !== "gt" && scope !== "all") throw new Error("--scope skal vaere gt eller all");
  const outDir = arg(argv, "out", null);
  const config = S5_MOTOR_BENCH_CONFIG;
  const t0 = performance.now();
  const rows = await runS5MotorBench({ races: buildS5BenchRaces({ scope }) });
  const benchmark = loadS5Benchmark();
  const summary = summarizeS5MotorBench(rows, benchmark);
  const md = renderS5MotorBenchMarkdown(summary, { scope, config });
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
    if (scope !== "gt") throw new Error("--write-fixture kraever --scope=gt (gatens dom er Grand Tours)");
    writeFileSync(DEFAULT_MOTOR_BENCH_PATH, `${JSON.stringify(fixtureFromSummary(summary), null, 2)}\n`);
    console.error(`skrev ${DEFAULT_MOTOR_BENCH_PATH}`);
  }
  console.error(`${rows.length} etape-koersler paa ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err); process.exit(1); });
}
