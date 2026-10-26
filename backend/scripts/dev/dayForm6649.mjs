#!/usr/bin/env node
// backend/scripts/dev/dayForm6649.mjs
// #6649 (ejer 26/10, designbord S6): "den bedste vinder som i virkeligheden".
// Maaler pr. loebsgruppe hvor tit DEN BEDSTE rytter paa dagens rute vinder.
//
// Kilde: en motor-testport-eksport (motorTestport.mjs): en mappe med
// <race_id>/cache.json (startfelt, evner, etaper) og tourDryRun-JSON'en ved siden
// af (runs[].perSeed[].rows[].winnerId + gcWinner). Scriptet koerer ingen motor;
// det laeser kun resultater, saa samme script maaler baade foer (eksisterende
// eksport) og efter (en ny motorTestport-koersel med --from-dir).
//
// Definitionen (spec docs/superpowers/specs/2026-10-26-6649-dagsform-design.md):
//   - "Evne paa dagens rute" = etapens demand_vector (generatorens terraen-vaegte,
//     uden noeglen `randomness`) gange rytterens evner (0-99, normaliseret).
//   - Etapens bedste = den startende rytter med hoejest evne paa ruten
//     (lige evne: rider_id bryder, saa maalingen er deterministisk).
//   - Klassementets bedste = hoejeste sum over etaper der ikke er flade/rullende
//     (alle etaper hvis loebet kun har flade/rullende).
//   - bestRiderWinShare = andelen af etaper (eller loeb for klassementet) hvor
//     den bedste vinder. Favorit (top 3) maales ved siden af (raceGroupBands).
//
// Loebsgrupper: monument, one_day, stage_race_stage, stage_race_gc, gt_stage,
// gt_gc; samme grupper pr. trup (u23:/junior:). Senior-grupperne staar uden praefiks.
//
// HARD RULE 17: tal og baand skrives KUN til balance-internals/ (gitignoreret).
// Baandet laeses fra den private taerskelfil (v3Gates.bestRiderWinShare).
//
// Koer (offline, ingen DB):
//   node backend/scripts/dev/dayForm6649.mjs --dir=<eksport>/races --revision=s5_profiles_v3 \
//     --thresholds=<privat taerskelfil> --out=balance-internals/6649/baseline.json
//
// Refs #6649

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NON_ABILITY_KEYS = new Set(["randomness"]);
const GC_SKIP_PROFILES = new Set(["flat", "rolling"]);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Evne paa ruten: demand_vector x normaliserede evner (0-99). */
export function routeAbility(abilities, demandVector) {
  let sum = 0;
  for (const [key, w] of Object.entries(demandVector ?? {})) {
    if (NON_ABILITY_KEYS.has(key)) continue;
    const weight = Number(w);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    sum += weight * (clamp(Number(abilities?.[key]) || 0, 0, 99) / 99);
  }
  return sum;
}

/** Rangliste (bedst foerst) af rytterne efter en score; rider_id bryder lige. */
export function rankBy(riderIds, scoreOf) {
  return [...riderIds]
    .map((id) => ({ id, v: scoreOf(id) }))
    .sort((a, b) => b.v - a.v || String(a.id).localeCompare(String(b.id)))
    .map((x) => x.id);
}

/** Loebsgruppe for en etape/et klassement. */
export function groupKey({ stages, raceClass, squad, gc = false }) {
  const prefix = squad && squad !== "senior" ? `${squad}:` : "";
  if (stages <= 1) return `${prefix}${raceClass === "Monuments" ? "monument" : "one_day"}`;
  const base = stages >= 15 ? "gt" : "stage_race";
  return `${prefix}${base}_${gc ? "gc" : "stage"}`;
}

/** Loebets kontekst: bedste og top 3 pr. etape og i klassementet. */
export function raceContext(cache) {
  const abilities = new Map((cache?.abilities ?? []).map((a) => [a.rider_id, a]));
  const starters = (cache?.entries ?? []).map((e) => e.rider_id).filter((id) => abilities.has(id));
  const profiles = [...(cache?.profiles ?? [])].sort((a, b) => a.stage_number - b.stage_number);
  const stages = profiles.length || Number(cache?.race?.stages) || 1;
  const byStage = new Map();
  const gcSum = new Map(starters.map((id) => [id, 0]));
  const gcProfiles = profiles.some((p) => !GC_SKIP_PROFILES.has(p.profile_type)) ? profiles.filter((p) => !GC_SKIP_PROFILES.has(p.profile_type)) : profiles;
  for (const p of profiles) {
    const term = (id) => routeAbility(abilities.get(id), p.demand_vector);
    const ranked = rankBy(starters, term);
    byStage.set(p.stage_number, { best: ranked[0] ?? null, top3: new Set(ranked.slice(0, 3)), profile: p.profile_type });
    if (gcProfiles.includes(p)) for (const id of starters) gcSum.set(id, gcSum.get(id) + term(id));
  }
  const gcRanked = rankBy(starters, (id) => gcSum.get(id) ?? 0);
  return {
    raceId: cache?.race?.id ?? null,
    stages,
    squad: cache?.race?.squad ?? "senior",
    raceClass: cache?.race?.race_class ?? null,
    byStage,
    gc: { best: gcRanked[0] ?? null, top3: new Set(gcRanked.slice(0, 3)) },
  };
}

function bump(map, key, hit, fav) {
  const cell = map.get(key) ?? { n: 0, bestWins: 0, favouriteWins: 0 };
  cell.n += 1;
  if (hit) cell.bestWins += 1;
  if (fav) cell.favouriteWins += 1;
  map.set(key, cell);
}

/** Taeller etaper og klassementer for én revision i ét loeb. */
export function tallyRace(ctx, run, cells) {
  for (const seed of run?.perSeed ?? []) {
    for (const row of seed.rows ?? []) {
      const st = ctx.byStage.get(row.stage);
      if (!st?.best || !row.winnerId) continue;
      bump(cells, groupKey({ stages: ctx.stages, raceClass: ctx.raceClass, squad: ctx.squad }), row.winnerId === st.best, st.top3.has(row.winnerId));
    }
    if (ctx.stages > 1 && ctx.gc.best && seed.gcWinner) {
      bump(cells, groupKey({ stages: ctx.stages, raceClass: ctx.raceClass, squad: ctx.squad, gc: true }), seed.gcWinner === ctx.gc.best, ctx.gc.top3.has(seed.gcWinner));
    }
  }
}

/** Alle-trupper-grupperne (praefikset fjernet) oven i pr.-trup-grupperne. */
export function withAllSquads(cells) {
  const out = new Map(cells);
  for (const [key, c] of cells) {
    if (!key.includes(":")) continue;
    const all = `all:${key.split(":")[1]}`;
    const acc = out.get(all) ?? { n: 0, bestWins: 0, favouriteWins: 0 };
    out.set(all, { n: acc.n + c.n, bestWins: acc.bestWins + c.bestWins, favouriteWins: acc.favouriteWins + c.favouriteWins });
  }
  for (const [key, c] of cells) {
    if (key.includes(":")) continue;
    const all = `all:${key}`;
    const acc = out.get(all) ?? { n: 0, bestWins: 0, favouriteWins: 0 };
    out.set(all, { n: acc.n + c.n, bestWins: acc.bestWins + c.bestWins, favouriteWins: acc.favouriteWins + c.favouriteWins });
  }
  return out;
}

export function summarize(cells, band = null) {
  const rows = {};
  for (const [key, c] of [...withAllSquads(cells)].sort(([a], [b]) => a.localeCompare(b))) {
    const bestShare = c.n ? c.bestWins / c.n : null;
    const inBand = band && bestShare !== null ? bestShare >= band.min && bestShare <= band.max : null;
    rows[key] = { ...c, bestShare, favouriteShare: c.n ? c.favouriteWins / c.n : null, inBand };
  }
  return rows;
}

function readRace(dir, revision) {
  const cachePath = path.join(dir, "cache.json");
  if (!existsSync(cachePath)) return null;
  const resultFile = readdirSync(dir).find((f) => f.endsWith(".json") && f !== "cache.json");
  if (!resultFile) return null;
  const cache = JSON.parse(readFileSync(cachePath, "utf8"));
  const result = JSON.parse(readFileSync(path.join(dir, resultFile), "utf8"));
  const run = (result.runs ?? []).find((r) => r.revision === revision);
  return run ? { cache, run } : null;
}

function parseArgs(argv) {
  const get = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const dir = get("dir");
  if (!dir) throw new Error("--dir=<eksportens races-mappe> kraeves");
  const out = get("out");
  if (out && !path.resolve(out).split(path.sep).includes("balance-internals")) throw new Error("--out skal ligge under balance-internals/ (hard rule 17)");
  return { dir, revision: get("revision", "s5_profiles_v3"), thresholds: get("thresholds"), out };
}

export function run(argv) {
  const opts = parseArgs(argv);
  const band = opts.thresholds ? JSON.parse(readFileSync(opts.thresholds, "utf8"))?.v3Gates?.bestRiderWinShare ?? null : null;
  const cells = new Map();
  let races = 0;
  let skipped = 0;
  for (const id of readdirSync(opts.dir)) {
    const dir = path.join(opts.dir, id);
    const race = readRace(dir, opts.revision);
    if (!race) { skipped += 1; continue; }
    tallyRace(raceContext(race.cache), race.run, cells);
    races += 1;
  }
  const report = { issue: 6649, revision: opts.revision, source: opts.dir, races, skipped, band, groups: summarize(cells, band) };
  if (opts.out) {
    mkdirSync(path.dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const report = run(process.argv.slice(2));
  const pct = (v) => (v === null ? "-" : `${(v * 100).toFixed(1)} %`);
  console.log(`#6649 bedste rytter (${report.revision}): ${report.races} loeb, ${report.skipped} sprunget over`);
  for (const [key, r] of Object.entries(report.groups)) {
    console.log(`${key.padEnd(24)} n ${String(r.n).padStart(5)} · bedste ${pct(r.bestShare).padStart(8)} · favorit ${pct(r.favouriteShare).padStart(8)}${r.inBand === null ? "" : r.inBand ? " · I BAAND" : " · UDE"}`);
  }
}
