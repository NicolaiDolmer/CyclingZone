#!/usr/bin/env node
// scripts/dev/s5ProfileDryRun.mjs
// #6359 (S5-etapeprofiler, Spor 1): offline tørkørsel af S5-generatoren mod prod-kataloget.
//
// 100 % OFFLINE. Ingen database, intet netværk, ingen filer skrives: kataloget læses fra
// fixturen backend/lib/__fixtures__/racePoolCatalog.prod.json, kalenderen pakkes med
// buildTierMaterializationPlan (samme kode som buildSeasonCalendar), og hvert løb i hver
// divisions repræsentative pulje genereres med BÅDE v5 (som i dag, inkl. kvote-fordelte
// finaler) og S5 (profileModel "s5"). Rapporten går til stdout.
//
// Det er byg-planens §2.2-måling gjort permanent: terræn-fordeling efter B+, andelen af
// etaper hvis type ikke passer med ruten, afslutninger uden for matrixen, Grand Tour-kvoter
// og højdemeter pr. terræn mod benchmarken (docs/design/s5-benchmark/gt-2021-2025.json).
//
// S5's første løbsdag er ikke fastlagt (#5833), så datoen er en PARAMETER og kræves:
//   node scripts/dev/s5ProfileDryRun.mjs --first-day=2026-10-26
//   node scripts/dev/s5ProfileDryRun.mjs --first-day=2026-10-26 --seeds=5 --json
//   node scripts/dev/s5ProfileDryRun.mjs --first-day=2026-10-28 --last-day=2026-11-29 --seeds=5
// --last-day (inklusiv) eller --race-days N saetter saesonens laengde; default 28 (#6367).
// --now (default dagen før --first-day) fryser "i dag", så kørslen er gentagelig.
// --seeds=N kører N sæson-træk (season_id "s5-dryrun-<i>"); default 3.
//
// Ikke med: realisme-gen-trækket (season_variant) og den tier-tiltede arketype-tabel; de
// ændrer hvilket træk et løb får, ikke hvordan S5 bygger etapen.
//
// Refs #6359 #6366 #6369

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan, TIER_DENSITY } from "../../backend/lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../../backend/lib/calendarStartDate.js";
import {
  generateRaceStageProfiles, balanceFinaleQuotas, isTimeTrial, grandTourTypeFor, S5_GRAND_TOUR_QUOTAS,
} from "../../backend/lib/raceStageProfileGenerator.js";
import { deriveTerrainType } from "../../backend/lib/raceRouteGenerator.js";
import { buildElevationProfile, checkElevationProfile, elevationSeedKey } from "../../backend/lib/routeElevationProfile.js";
import { TERRAIN_TYPES, isFinishAllowed, canonicalFinaleType } from "../../backend/lib/stageProfileTypes.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = join(ROOT, "backend", "lib", "__fixtures__", "racePoolCatalog.prod.json");
const BENCHMARK = join(ROOT, "docs", "design", "s5-benchmark", "gt-2021-2025.json");
const DEFAULT_REAL_DAYS = 28;

function arg(name, fallback = null) {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return argv.includes(`--${name}`) ? true : fallback;
}

const firstDay = arg("first-day");
if (typeof firstDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(firstDay)) {
  console.error("Kræver --first-day=YYYY-MM-DD (S5's første løbsdag, #5833). Ingen standarddato.");
  process.exit(2);
}
const nowDay = arg("now") ?? new Date(Date.parse(`${firstDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
// #6367: saesonens laengde er ogsaa en parameter (S5's vindue er ikke laast). --last-day
// (inklusiv) eller --race-days; uden dem 28 loebsdatoer som foer.
const lastDayArg = arg("last-day");
const raceDaysArg = arg("race-days");
if (lastDayArg != null && raceDaysArg != null) {
  console.error("Angiv enten --last-day eller --race-days, ikke begge.");
  process.exit(2);
}
let REAL_DAYS = DEFAULT_REAL_DAYS;
if (lastDayArg != null) {
  if (typeof lastDayArg !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(lastDayArg)) {
    console.error("--last-day skal vaere YYYY-MM-DD.");
    process.exit(2);
  }
  REAL_DAYS = Math.round((Date.parse(`${lastDayArg}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000) + 1;
} else if (raceDaysArg != null) {
  REAL_DAYS = Number(raceDaysArg);
}
if (!Number.isInteger(REAL_DAYS) || REAL_DAYS < 1) {
  console.error(`Ugyldig saesonlaengde (${REAL_DAYS} loebsdatoer).`);
  process.exit(2);
}
const seeds = Math.max(1, Number(arg("seeds", 3)) || 3);
const asJson = arg("json") === true;

const TERRAIN_LABEL = {
  flat: "Flad", rolling: "Bølget", hilly: "Kuperet", medium_mountain: "Mellembjerg", mountain: "Bjerg", high_mountain: "Højbjerg",
};
const BENCHMARK_TERRAIN = {
  flad: "flat", boelget: "rolling", kuperet: "hilly", mellembjerg: "medium_mountain", bjerg: "mountain", hojbjerg: "high_mountain",
};
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function buildPlan() {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = resolveCalendarFrom({ firstRaceDate: firstDay, now: new Date(`${nowDay}T12:00:00Z`) });
  const quotas = Object.fromEntries(Object.entries(TIER_DENSITY).map(([t, d]) => [t, d * REAL_DAYS]));
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from, realDays: REAL_DAYS, quotas, baseSeed: 1, raceTypeSpreadEnabled: false });
  const externalIdByPoolRace = new Map(catalog.map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map(catalog.map((c) => [c.id, c.terrain_archetype ?? null]));
  return { tierPlans, externalIdByPoolRace, archetypeByPoolRace };
}

function seedRace(r, maps, seasonId) {
  return {
    id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
    external_id: maps.externalIdByPoolRace.get(r.pool_race_id) ?? null,
    terrain_archetype: maps.archetypeByPoolRace.get(r.pool_race_id) ?? null,
    race_class: r.race_class ?? null, season_id: seasonId, season_variant: 0,
  };
}

function emptyCounts() {
  return Object.fromEntries([...TERRAIN_TYPES, "tt"].map((t) => [t, 0]));
}

function measure(model, plan, seasonId) {
  const all = { n: 0, byTerrain: emptyCounts(), typeMismatch: 0, terrainStages: 0, outsideMatrix: 0, finishes: {}, elevationByTerrain: {}, series: { n: 0, bad: 0, bytes: 0, ms: 0 } };
  /** @type {Record<number, Record<string, number>>} */
  const byTier = {};
  const grandTours = [];
  const seen = new Set();
  for (const tierPlan of plan.tierPlans) {
    const rows = tierPlan.pools?.[0]?.raceRows ?? [];
    const races = rows.map((r) => seedRace(r, plan, seasonId));
    let generated = races.map((race) => generateRaceStageProfiles(race, { profileModel: model }));
    if (model === "v5") generated = balanceFinaleQuotas(generated);
    // #6367: terræn efter B+ pr. division (uden dedup: et løb tæller i hver division det kører i).
    const tierCounts = (byTier[tierPlan.tier] ??= { n: 0, ...emptyCounts() });
    for (const stages of generated) {
      for (const p of stages) {
        tierCounts.n += 1;
        tierCounts[isTimeTrial(p.profile_type) ? "tt" : deriveTerrainType(p.climbs)] += 1;
      }
    }
    generated.forEach((stages, idx) => {
      const race = races[idx];
      if (seen.has(race.id)) return; // én række pr. unikt parcours (samme løb i flere tiers tæller én gang)
      seen.add(race.id);
      if (race.terrain_archetype === "grand_tour") grandTours.push({ race, stages });
      for (const p of stages) {
        all.n += 1;
        all.finishes[p.finale_type] = (all.finishes[p.finale_type] ?? 0) + 1;
        if (p.elevation_profile !== undefined) { // #6594: højdeprofilen (tid målt ved genberegning)
          const t0 = performance.now();
          buildElevationProfile(p, elevationSeedKey(race, p.stage_number));
          Object.assign(all.series, { n: all.series.n + 1, bad: all.series.bad + (checkElevationProfile(p) ? 1 : 0), bytes: all.series.bytes + JSON.stringify(p.elevation_profile).length, ms: all.series.ms + performance.now() - t0 });
        }
        if (isTimeTrial(p.profile_type)) { all.byTerrain.tt += 1; continue; }
        const terrain = deriveTerrainType(p.climbs);
        all.byTerrain[terrain] += 1;
        (all.elevationByTerrain[terrain] ??= []).push(p.elevation_gain_m);
        if (TERRAIN_TYPES.includes(p.profile_type)) {
          all.terrainStages += 1;
          if (p.profile_type !== terrain) all.typeMismatch += 1;
        }
        // v5-navne oversaettes (massespurt/reduceret spurt = flad spurt); udbrud er ingen afslutning i S5.
        if (!isFinishAllowed(terrain, canonicalFinaleType(p.finale_type))) all.outsideMatrix += 1;
      }
    });
  }
  const gts = grandTours.map(({ race, stages }) => {
    const counts = emptyCounts();
    let summits = 0;
    for (const p of stages) {
      if (isTimeTrial(p.profile_type)) counts.tt += 1;
      else counts[deriveTerrainType(p.climbs)] += 1;
      if (p.finale_type === "long_climb") summits += 1;
    }
    return { name: race.name, gtType: grandTourTypeFor(race), stages: stages.length, counts, summits, sequence: stages.map((p) => p.profile_type) };
  });
  return { all, gts, byTier };
}

function benchmarkElevation() {
  const rows = JSON.parse(readFileSync(BENCHMARK, "utf8"));
  const by = {};
  for (const r of rows) {
    const t = BENCHMARK_TERRAIN[r.terrain];
    if (t && Number.isFinite(r.vert)) (by[t] ??= []).push(r.vert);
  }
  return Object.fromEntries(Object.entries(by).map(([t, xs]) => [t, median(xs)]));
}

const plan = buildPlan();
const runs = [];
for (let i = 0; i < seeds; i++) {
  const seasonId = `s5-dryrun-${i}`;
  runs.push({ seasonId, v5: measure("v5", plan, seasonId), s5: measure("s5", plan, seasonId) });
}
const bench = benchmarkElevation();

if (asJson) {
  console.log(JSON.stringify({ firstDay, nowDay, realDays: REAL_DAYS, seeds, runs, benchmarkElevationMedian: bench }, null, 2));
  process.exit(0);
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : "-");
const lines = [];
lines.push(`# S5-tørkørsel (offline, intet skrevet) - første løbsdag ${firstDay}, ${REAL_DAYS} løbsdatoer, ${seeds} sæson-træk`);
lines.push("");
lines.push("## Terræn efter B+ pr. division (S5, alle etaper i divisionens repræsentative pulje)");
lines.push("");
lines.push(`| Træk | Division | n | ${TERRAIN_TYPES.map((t) => TERRAIN_LABEL[t]).join(" | ")} | TT |`);
lines.push(`|---|---|---|${TERRAIN_TYPES.map(() => "---").join("|")}|---|`);
for (const run of runs) {
  for (const [tier, c] of Object.entries(run.s5.byTier)) {
    lines.push(`| ${run.seasonId} | D${tier} | ${c.n} | ${TERRAIN_TYPES.map((t) => c[t]).join(" | ")} | ${c.tt} |`);
  }
}
lines.push("");
lines.push("## Terræn efter B+ (alle unikke etaper) og typer der ikke passer med ruten");
lines.push("");
lines.push(`| Træk | Model | n | ${TERRAIN_TYPES.map((t) => TERRAIN_LABEL[t]).join(" | ")} | TT | Type ≠ B+ | Uden for matrix |`);
lines.push(`|---|---|---|${TERRAIN_TYPES.map(() => "---").join("|")}|---|---|---|`);
for (const run of runs) {
  for (const model of ["v5", "s5"]) {
    const a = run[model].all;
    lines.push(`| ${run.seasonId} | ${model} | ${a.n} | ${TERRAIN_TYPES.map((t) => a.byTerrain[t]).join(" | ")} | ${a.byTerrain.tt} | ${a.typeMismatch} af ${a.terrainStages} (${pct(a.typeMismatch, a.terrainStages)}) | ${a.outsideMatrix} |`);
  }
}
lines.push("");
lines.push("## Grand Tours (S5) mod ejerens kvoter");
lines.push("");
lines.push(`| Træk | Løb | Type | ${TERRAIN_TYPES.map((t) => TERRAIN_LABEL[t]).join(" | ")} | TT | Bjergtop |`);
lines.push(`|---|---|---|${TERRAIN_TYPES.map(() => "---").join("|")}|---|---|`);
for (const run of runs) {
  for (const gt of run.s5.gts) {
    const q = S5_GRAND_TOUR_QUOTAS[gt.gtType];
    const cell = (t) => `${gt.counts[t]}/${q[t]}`;
    lines.push(`| ${run.seasonId} | ${gt.name} | ${gt.gtType} | ${TERRAIN_TYPES.map(cell).join(" | ")} | ${gt.counts.tt}/${q.itt + q.ttt} | ${gt.summits}/${q.summits} |`);
  }
}
lines.push("");
lines.push("Celle = genereret/kvote. Rækkefølge (første træk):");
for (const gt of runs[0].s5.gts) lines.push(`- ${gt.name}: ${gt.sequence.join(" · ")}`);
lines.push("");
lines.push("## Afslutninger (første træk)");
lines.push("");
for (const model of ["v5", "s5"]) {
  const f = runs[0][model].all.finishes;
  const total = Object.values(f).reduce((s, x) => s + x, 0);
  lines.push(`- ${model}: ${Object.entries(f).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${pct(v, total)})`).join(" · ")}`);
}
lines.push("");
lines.push("## Højdemeter, median pr. terræn (første træk) mod benchmarken");
lines.push("");
lines.push("| Terræn | v5 | S5 | Benchmark |");
lines.push("|---|---|---|---|");
for (const t of TERRAIN_TYPES) {
  lines.push(`| ${TERRAIN_LABEL[t]} | ${median(runs[0].v5.all.elevationByTerrain[t] ?? []) ?? "-"} | ${median(runs[0].s5.all.elevationByTerrain[t] ?? []) ?? "-"} | ${bench[t] ?? "-"} |`);
}
const es = runs[0].s5.all.series;
lines.push("", `Højdeprofil (#6594, S5, første træk): ${es.n} af ${runs[0].s5.all.n} etaper med serie · ${es.bad} med sum ≠ elevation_gain_m eller negativ højde · gns. ${es.n ? Math.round(es.bytes / es.n) : 0} B · ${es.n ? (es.ms / es.n).toFixed(2) : "-"} ms/etape`);
console.log(lines.join("\n"));
