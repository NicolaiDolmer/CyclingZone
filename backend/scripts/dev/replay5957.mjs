// #5957: genafspil S4-etaper (v4) deterministisk for at skille motor fra data.
//
// READ-ONLY. To trin:
//   1) --fetch: hent v4-koersler (race_simulation_runs.engine_version=4) +
//      etapeprofil, startfelt, roller, hold, AI-flag, ordrer, evner og de
//      rigtige placeringer fra prod, og gem dem i en LOKAL cache-fil
//      (balance-internals/5957/, gitignoreret: rummer hold-/rytter-id'er).
//   2) uden --fetch: genafspil hver etape fra cachen gennem v4 (og v3 som
//      reference) og maal Spearman mellem den relevante evne og placeringen,
//      pr. etapetype. Skriver kun til stdout og evt. --out=<fil>.
//
// Koer:
//   infisical run --env=prod -- node backend/scripts/dev/replay5957.mjs --fetch
//   node backend/scripts/dev/replay5957.mjs [--cache=<fil>] [--out=<fil>] [--variant=prod|neutral]
//
// Tallene er private (repoet er offentligt): print/skriv dem kun lokalt.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..", "..");
const DEFAULT_CACHE = join(REPO_ROOT, "balance-internals", "5957", "replay-cache.json");

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

// Relevant evne pr. etapetype (samme kort som undersoegelsen 1/10).
export const RELEVANT_ABILITY = Object.freeze({
  flat: "sprint",
  rolling: "punch",
  hilly: "punch",
  classic: "punch",
  cobbles: "cobblestone",
  gravel: "cobblestone",
  mountain: "climbing",
  high_mountain: "climbing",
  itt: "time_trial",
  time_trial: "time_trial",
});

function averageRanks(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}

/** Spearman mellem evne (hoej = god) og placering (lav = god); 1 = evnen afgoer alt. */
export function spearmanAbilityVsRank(pairs) {
  if (pairs.length < 3) return null;
  const a = averageRanks(pairs.map((p) => -p.ability));
  const r = averageRanks(pairs.map((p) => p.rank));
  const n = pairs.length;
  const mean = (n + 1) / 2;
  let num = 0, da = 0, dr = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - mean) * (r[i] - mean);
    da += (a[i] - mean) ** 2;
    dr += (r[i] - mean) ** 2;
  }
  return da && dr ? num / Math.sqrt(da * dr) : null;
}

// ---------------------------------------------------------------------------
// Fetch (read-only prod)
// ---------------------------------------------------------------------------

async function fetchCache(cachePath) {
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (infisical run --env=prod)");
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { ABILITY_KEYS } = await import("../../lib/raceSimulator.js");

  async function all(table, columns, apply) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      let q = db.from(table).select(columns).range(from, from + 999);
      if (apply) q = apply(q);
      const { data, error } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  async function inChunks(table, columns, col, ids, apply) {
    const out = [];
    for (let i = 0; i < ids.length; i += 150) {
      out.push(...await all(table, columns, (q) => { q = q.in(col, ids.slice(i, i + 150)); return apply ? apply(q) : q; }));
    }
    return out;
  }

  const runs = await all("race_simulation_runs", "race_id, stage_number, seed, engine_version, entrant_snapshot, created_at, salt_version",
    (q) => q.in("engine_version", [2, 4]));
  const raceIds = [...new Set(runs.map((r) => r.race_id))];
  const races = await inChunks("races", "id, season_id, race_type, stages, squad, race_class, name", "id", raceIds);
  const profiles = await inChunks("race_stage_profiles", "*", "race_id", raceIds);
  const entries = await inChunks("race_entries", "race_id, rider_id, team_id, race_role", "race_id", raceIds);
  const orders = await inChunks("race_team_orders", "team_id, race_id, stage_number, breakaway_stance, riders", "race_id", raceIds);
  const results = await inChunks("race_results", "race_id, stage_number, result_type, rank, rider_id, in_breakaway", "race_id", raceIds,
    (q) => q.in("result_type", ["stage", "gc"]));
  const teamIds = [...new Set(entries.map((e) => e.team_id).filter(Boolean))];
  const teams = await inChunks("teams", "id, is_ai", "id", teamIds);
  const riderIds = [...new Set(runs.flatMap((r) => (Array.isArray(r.entrant_snapshot) ? r.entrant_snapshot : [])))];
  const abilities = await inChunks("rider_derived_abilities", ["rider_id", ...ABILITY_KEYS].join(", "), "rider_id", riderIds);

  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ fetched_at: new Date().toISOString(), runs, races, profiles, entries, orders, results, teams, abilities }));
  console.log(`cache: ${runs.length} koersler, ${races.length} loeb, ${riderIds.length} ryttere -> ${cachePath}`);
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/**
 * Byg replay-tilfaelde fra cachen. Kun etaper hvor den rigtige placering
 * findes, feltet er 30+ og etapetypen har en relevant evne.
 */
export function buildCases(cache, { engineVersion = 4 } = {}) {
  const raceById = new Map(cache.races.map((r) => [r.id, r]));
  const profileByKey = new Map(cache.profiles.map((p) => [`${p.race_id}:${p.stage_number}`, p]));
  const profilesByRace = groupBy(cache.profiles, (p) => p.race_id);
  const entriesByRace = groupBy(cache.entries, (e) => e.race_id);
  const ordersByRace = groupBy(cache.orders, (o) => o.race_id);
  const resultsByKey = groupBy(cache.results, (r) => `${r.race_id}:${r.stage_number}`);
  const aiByTeam = new Map(cache.teams.map((t) => [t.id, t.is_ai === true]));
  const abilitiesById = new Map(cache.abilities.map((a) => [a.rider_id, a]));
  const cases = [];
  for (const run of cache.runs) {
    if (run.engine_version !== engineVersion) continue;
    const race = raceById.get(run.race_id);
    const profile = profileByKey.get(`${run.race_id}:${run.stage_number}`);
    if (!race || !profile) continue;
    const ability = RELEVANT_ABILITY[profile.profile_type];
    if (!ability) continue;
    const isStageRace = (race.stages || 1) > 1;
    const resRows = (resultsByKey.get(`${run.race_id}:${run.stage_number}`) || [])
      .filter((r) => r.result_type === (isStageRace ? "stage" : "gc") && Number.isFinite(Number(r.rank)));
    const snapshot = Array.isArray(run.entrant_snapshot) ? run.entrant_snapshot : [];
    if (snapshot.length < 30 || resRows.length < 30) continue;
    const entryById = new Map((entriesByRace.get(run.race_id) || []).map((e) => [e.rider_id, e]));
    const finishers = new Set(resRows.map((r) => r.rider_id));
    // Startfeltet = de ryttere der faktisk har en placering paa etapen (de
    // udgaaede fra tidligere etaper er ikke med i resultatet).
    const entrants = snapshot.filter((id) => finishers.has(id) && abilitiesById.has(id)).map((id) => {
      const entry = entryById.get(id) || {};
      const { rider_id: _r, ...abilities } = abilitiesById.get(id);
      return {
        rider_id: id,
        team_id: entry.team_id ?? null,
        team_is_ai: aiByTeam.get(entry.team_id) === true,
        race_role: entry.race_role ?? null,
        effort: "normal",
        abilities,
      };
    });
    cases.push({
      race_id: run.race_id,
      stage_number: run.stage_number,
      profile_type: profile.profile_type,
      ability,
      isStageRace,
      race,
      profile,
      raceStages: (profilesByRace.get(run.race_id) || []).slice().sort((a, b) => a.stage_number - b.stage_number),
      teamOrderRows: ordersByRace.get(run.race_id) || [],
      entrants,
      actual: resRows.map((r) => ({ rider_id: r.rider_id, rank: Number(r.rank), in_breakaway: r.in_breakaway === true })),
    });
  }
  return cases;
}

function spearmanFor(c, rankedRows) {
  const abilityById = new Map(c.entrants.map((e) => [e.rider_id, Number(e.abilities[c.ability]) || 0]));
  const pairs = rankedRows.filter((r) => abilityById.has(r.rider_id)).map((r) => ({ ability: abilityById.get(r.rider_id), rank: r.rank }));
  return spearmanAbilityVsRank(pairs);
}

export async function replayCases(cases, { variant = "prod", withV3 = true } = {}) {
  const { loadRaceEngineV4 } = await import("../../lib/raceEngineV4Bridge.js");
  const { simulateStage, stableSeed } = await import("../../lib/raceSimulator.js");
  const v4 = await loadRaceEngineV4();
  const out = [];
  for (const c of cases) {
    const entrants = variant === "neutral"
      ? c.entrants.map((e) => ({ ...e, race_role: "free_role", team_id: null, team_is_ai: false }))
      : c.entrants;
    const seedString = `${c.race_id}:${c.stage_number}`; // usaltet: replay skal ikke kende prod-salten
    const v4Res = v4.simulateStage({
      entrants, stageProfile: c.profile, seedString, stageNumber: c.stage_number,
      teamOrderRows: variant === "neutral" ? [] : c.teamOrderRows, isStageRace: c.isStageRace, raceStages: c.raceStages,
      squad: c.race.squad ?? null,
    });
    const row = {
      profile_type: c.profile_type,
      n: entrants.length,
      actual: spearmanFor(c, c.actual),
      v4: spearmanFor(c, v4Res.ranked),
      v4_breakaway: v4Res.ranked.filter((r) => r.components?.breakaway).length,
    };
    if (withV3) {
      const v3Res = simulateStage({ entrants, stageProfile: c.profile, seed: stableSeed(seedString), v3: true });
      row.v3 = spearmanFor(c, v3Res.ranked);
    }
    out.push(row);
  }
  return out;
}

export function summarize(rows) {
  const by = groupBy(rows, (r) => r.profile_type);
  const mean = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const lines = [];
  for (const [type, rs] of [...by.entries()].sort()) {
    lines.push({ type, n: rs.length, actual: mean(rs.map((r) => r.actual)), v4: mean(rs.map((r) => r.v4)), v3: mean(rs.map((r) => r.v3)), v4_breakaway: mean(rs.map((r) => r.v4_breakaway)) });
  }
  return lines;
}

/**
 * Offline-tilstand (ingen prod): den pinnede population + proxy-etaper gennem
 * head-to-head-harnessen, med roller/ordrer (--orders=ai) eller uden (none).
 * Isolerer om rolle-/ordre-/holdspils-laget er det der skiller prod-felter fra
 * flip-gatens orders=none-maaling.
 */
export async function offlineCorrelation({ population, stages, seeds, fieldSize, orderMode }) {
  const { runHeadToHead } = await import("../headToHeadV4.js");
  const { rankedFromV4Output } = await import("../../lib/raceEngineV4Bridge.js");
  const abilitiesById = new Map(population.riders.map((r) => [r.id, r.abilities]));
  const rows = [];
  for (const seed of seeds) {
    const h2h = runHeadToHead({ population, stages, seedInput: seed, fieldSize, orderMode });
    for (const r of h2h) {
      const ability = RELEVANT_ABILITY[r.profileType];
      if (!ability) continue;
      const pairsOf = (ranked) => ranked
        .map((x) => ({ ability: Number(abilitiesById.get(x.rider_id)?.[ability]) || 0, rank: x.rank }));
      const v4Ranked = rankedFromV4Output(r.raw.v4Output);
      rows.push({
        profile_type: r.profileType,
        v4: spearmanAbilityVsRank(pairsOf(v4Ranked)),
        v3: spearmanAbilityVsRank(pairsOf(r.raw.v3Output.ranked)),
        v4_breakaway: v4Ranked.filter((x) => x.components?.breakaway).length,
      });
    }
  }
  return rows;
}

async function main() {
  const populationPath = argValue("population");
  if (populationPath) {
    const population = JSON.parse(readFileSync(populationPath, "utf8"));
    const stagesFile = JSON.parse(readFileSync(argValue("stages", join(REPO_ROOT, "backend/scripts/baselines/v4-proxy-stages-2026-09-06.json")), "utf8"));
    const stages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;
    const rows = await offlineCorrelation({
      population,
      stages,
      seeds: argValue("seeds", "s1,s2,s3").split(","),
      fieldSize: Number(argValue("field", "180")),
      orderMode: argValue("orders", "none"),
    });
    const fmt = (x) => (x == null ? "  -  " : x.toFixed(2));
    console.log(`offline orders=${argValue("orders", "none")} etaper=${rows.length}`);
    console.log("type            n   v4     v3     v4-udbrud");
    for (const s of summarize(rows)) {
      console.log(`${s.type.padEnd(14)} ${String(s.n).padStart(3)}   ${fmt(s.v4)}   ${fmt(s.v3)}   ${s.v4_breakaway == null ? "-" : s.v4_breakaway.toFixed(1)}`);
    }
    const outPath = argValue("out");
    if (outPath) writeFileSync(outPath, JSON.stringify({ summary: summarize(rows), rows }, null, 2));
    return;
  }
  const cachePath = argValue("cache", DEFAULT_CACHE);
  if (hasFlag("fetch")) {
    await fetchCache(cachePath);
    return;
  }
  if (!existsSync(cachePath)) throw new Error(`Ingen cache: ${cachePath} (koer --fetch foerst)`);
  const cache = JSON.parse(readFileSync(cachePath, "utf8"));
  const cases = buildCases(cache, { engineVersion: Number(argValue("engine", "4")) });
  const limit = Number(argValue("limit", "0"));
  const variant = argValue("variant", "prod");
  const selected = limit > 0 ? cases.slice(0, limit) : cases;
  const rows = await replayCases(selected, { variant, withV3: !hasFlag("no-v3") });
  const summary = summarize(rows);
  const fmt = (x) => (x == null ? "  -  " : x.toFixed(2));
  console.log(`variant=${variant} etaper=${rows.length}`);
  console.log("type            n   prod   v4-replay  v3-replay  v4-udbrud");
  for (const s of summary) {
    console.log(`${s.type.padEnd(14)} ${String(s.n).padStart(3)}   ${fmt(s.actual)}   ${fmt(s.v4)}      ${fmt(s.v3)}      ${s.v4_breakaway == null ? "-" : s.v4_breakaway.toFixed(1)}`);
  }
  const outPath = argValue("out");
  if (outPath) writeFileSync(outPath, JSON.stringify({ variant, summary, rows }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
