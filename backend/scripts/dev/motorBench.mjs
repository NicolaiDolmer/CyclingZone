// Motor-testbaenken (ejer-design 10/10, docs/sessions/2026-10-11-session-design.md):
// skyggeloeb af RIGTIGE prod-etaper (felter, roller, holdordrer, evner,
// etapeprofiler) under to regel-revisioner side om side, over flere seeds.
//
// READ-ONLY: Supabase bruges kun til SELECT (samme hentning som tourDryRun.mjs).
// Output skrives KUN lokalt (default balance-internals/motor-bench/, gitignoreret)
// og bruges som data til den private testbaenk-Artifact. Aldrig spillervendt.
//
// --engine-root peger paa den checkout hvis motor + scorecard skal koeres (fx en
// worktree med den nyeste revision). Default: denne checkout.
//
// Koer:
//   infisical run --env=prod --silent -- node backend/scripts/dev/motorBench.mjs --days=3 --seeds=5 \
//     --revisions=official_times_v2,official_times_v3 --race-name="Tour de l'Hexagone" \
//     [--engine-root=C:/Dev/CyclingZone-worktrees/<revision>] [--max-races=200] [--out=balance-internals/motor-bench/bench.json]
//   node backend/scripts/dev/motorBench.mjs --from-cache=balance-internals/motor-bench/races.json ...   (uden prod)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..");

export function parseArgs(argv) {
  const get = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const seeds = Number(get("seeds", "5"));
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error("--seeds skal vaere et positivt heltal");
  const days = Number(get("days", "3"));
  if (!(days > 0)) throw new Error("--days skal vaere positiv");
  return {
    days,
    seeds,
    revisions: get("revisions", "official_times_v2,official_times_v3").split(",").map((s) => s.trim()).filter(Boolean),
    raceNames: argv.filter((a) => a.startsWith("--race-name=")).map((a) => a.slice("--race-name=".length)),
    engineRoot: get("engine-root", REPO_ROOT),
    maxRaces: Number(get("max-races", "400")),
    out: get("out", "balance-internals/motor-bench/bench.json"),
    saveCache: get("save-cache", null),
    fromCache: get("from-cache", null),
  };
}

const abs = (p) => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));
const median = (xs) => {
  const s = xs.filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const share = (xs) => (xs.length ? xs.filter(Boolean).length / xs.length : null);

async function supabase() {
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (infisical run --env=prod)");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

const one = async (q, what) => { const { data, error } = await q; if (error) throw new Error(`${what}: ${error.message}`); return data || []; };

/** Afsluttede loeb (alle divisioner) med start inden for de sidste `days` doegn + navngivne loeb. */
async function listRaces(db, { days, raceNames, maxRaces }) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const cols = "id, name, stages, squad, race_class, status, league_division_id, scheduled_for, engine_rules_revision";
  // pagination-safe: begraenset tidsvindue + eksplicit limit (maxRaces)
  // Afsluttede loeb OG etapeloeb i gang (mindst én koert etape).
  const recent = await one(db.from("races").select(`${cols}, stages_completed`).or("status.eq.completed,stages_completed.gt.0").gte("scheduled_for", since).order("scheduled_for", { ascending: true }).limit(maxRaces), "races");
  const named = [];
  for (const name of raceNames) {
    // pagination-safe: ét navn, én pr. division og saeson
    named.push(...await one(db.from("races").select(cols).ilike("name", name.replace(/[\\%_]/g, (c) => `\\${c}`)).neq("status", "completed"), "races"));
  }
  const byId = new Map();
  for (const r of [...recent, ...named]) byId.set(r.id, r);
  return [...byId.values()];
}

async function fetchRaceData(db, race, ABILITY_KEYS) {
  const profiles = await one(db.from("race_stage_profiles").select("*").eq("race_id", race.id), "race_stage_profiles"); // pagination-safe: ét loebs etaper
  const entries = await one(db.from("race_entries").select("rider_id, team_id, race_role").eq("race_id", race.id), "race_entries"); // pagination-safe: ét loebs startliste
  const orders = await one(db.from("race_team_orders").select("team_id, race_id, stage_number, breakaway_stance, riders").eq("race_id", race.id), "race_team_orders"); // pagination-safe: hold x etaper
  const teamIds = [...new Set(entries.map((e) => e.team_id).filter(Boolean))];
  const riderIds = entries.map((e) => e.rider_id);
  const teams = [];
  for (let i = 0; i < teamIds.length; i += 50) teams.push(...await one(db.from("teams").select("id, is_ai, name").in("id", teamIds.slice(i, i + 50)), "teams"));
  const abilities = [];
  const riders = [];
  for (let i = 0; i < riderIds.length; i += 50) {
    const ids = riderIds.slice(i, i + 50);
    abilities.push(...await one(db.from("rider_derived_abilities").select(["rider_id", ...ABILITY_KEYS].join(", ")).in("rider_id", ids), "abilities"));
    riders.push(...await one(db.from("riders").select("id, firstname, lastname").in("id", ids), "riders"));
  }
  return { race, profiles, entries, orders, teams, abilities, riders };
}

/** Pr. etape og seed: det testbaenken viser. Ren funktion af broens svar. */
export function stageView({ sc, res, profile, gcBefore, abilitiesById, teamByRider, roleByRider, riderIds }) {
  const m = sc.stageMetrics({ res, profile, gcBefore, abilitiesById, teamByRider, riderIds, roleByRider });
  const out = res.v4Output;
  const fin = (out?.results ?? []).filter((r) => r.status === "finished").sort((a, b) => a.time_seconds - b.time_seconds);
  const winner = fin[0] ?? null;
  // Grupper i maal: nye gruppe naar hullet til forrige rytter er over 3 s (blandt top 60).
  let groups = fin.length ? 1 : 0;
  for (let i = 1; i < Math.min(fin.length, 60); i++) if (fin[i].time_seconds - fin[i - 1].time_seconds > 3) groups++;
  // Bedste klatrer paa feltet (hoejeste climbing): hans placering.
  let bestClimber = null;
  for (const id of riderIds) {
    const c = Number(abilitiesById.get(id)?.climbing);
    if (Number.isFinite(c) && (!bestClimber || c > bestClimber.c)) bestClimber = { id, c };
  }
  const climberRank = bestClimber ? fin.findIndex((r) => r.rider_id === bestClimber.id) + 1 || null : null;
  return {
    winner: winner?.rider_id ?? null,
    winnerTeam: winner ? teamByRider.get(winner.rider_id) ?? null : null,
    winType: m.winType,
    gapTo10: m.gapTo10, gapTo30: m.gapTo30,
    ittGapTo10Per40Km: m.ittGapTo10Per40Km,
    breakawaySize: m.breakawaySize, breakawayAttempts: m.breakawayAttempts,
    breakawayWon: m.breakawayWon, breakawayWinMargin: m.breakawayWinMargin,
    groupsTop60: groups, bestClimberRank: climberRank,
    finishers: fin.length,
  };
}

/** Median/andel over seeds + benchmarkdom pr. noegletal. */
export function summarizeStage(sc, profile, seedsViews) {
  const cls = sc.profileClass(profile.profile_type);
  const col = (k) => seedsViews.map((v) => v[k]);
  const s = {
    gapTo10: median(col("gapTo10")), gapTo30: median(col("gapTo30")),
    ittGapTo10Per40Km: median(col("ittGapTo10Per40Km")),
    breakawaySize: median(col("breakawaySize")), breakawayAttempts: median(col("breakawayAttempts")),
    breakawayWinShare: share(col("breakawayWon").filter((v) => v !== null)),
    groupsTop60: median(col("groupsTop60")), bestClimberRank: median(col("bestClimberRank")),
    winners: col("winner"), winnerTeams: col("winnerTeam"),
  };
  const B = sc.TOUR_BENCHMARKS;
  s.verdicts = {};
  for (const key of ["gapTo10", "gapTo30", "ittGapTo10Per40Km", "breakawaySize"]) {
    const band = B[key]?.byClass?.[cls];
    if (band && s[key] !== null) s.verdicts[key] = { status: sc.verdict(s[key], band), band: { min: band.min ?? null, max: band.max ?? null } };
  }
  const wb = B.breakawayWinShare?.byClass?.[profile.profile_type];
  if (wb && s.breakawayWinShare !== null) s.verdicts.breakawayWinShare = { status: sc.verdict(s.breakawayWinShare, wb), band: { min: wb.min ?? null, max: wb.max ?? null } };
  return s;
}

export function runRace({ sc, v4, data, revisions, seeds }) {
  const stages = sc.sortedStages(data);
  const { entrants } = sc.splitEntrants(data);
  const abilitiesById = new Map(data.abilities.map((a) => [a.rider_id, a]));
  const teamByRider = new Map(entrants.map((e) => [e.rider_id, e.team_id]));
  const roleByRider = new Map(entrants.map((e) => [e.rider_id, e.race_role]));
  const riderIds = entrants.map((e) => e.rider_id);
  const byRevision = {};
  for (const revision of revisions) {
    const views = new Map(stages.map((p) => [p.stage_number, []]));
    for (let s = 1; s <= seeds; s++) {
      sc.runStagesInOrder({
        v4, data, revision, seedTag: `bench-${s}`, stages, entrants,
        onStage: ({ profile, res, gcBefore }) => {
          views.get(profile.stage_number).push(stageView({ sc, res, profile, gcBefore, abilitiesById, teamByRider, roleByRider, riderIds }));
        },
      });
    }
    byRevision[revision] = Object.fromEntries(stages.map((p) => [p.stage_number, summarizeStage(sc, p, views.get(p.stage_number))]));
  }
  return stages.map((p) => ({
    stage: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type ?? null,
    cls: sc.profileClass(p.profile_type), distance_km: p.distance_km ?? null,
    revisions: Object.fromEntries(revisions.map((r) => [r, byRevision[r][p.stage_number]])),
  }));
}

/** Samlet optaelling pr. revision og noegletal: PASS/WARN/FAIL. */
export function tally(races, revisions) {
  const out = {};
  for (const rev of revisions) {
    const t = {};
    for (const race of races) for (const st of race.stages) {
      for (const [k, v] of Object.entries(st.revisions[rev]?.verdicts ?? {})) {
        t[k] ??= { PASS: 0, WARN: 0, FAIL: 0 };
        if (t[k][v.status] !== undefined) t[k][v.status]++;
      }
    }
    out[rev] = t;
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const root = path.resolve(opts.engineRoot);
  const sc = await import(pathToFileURL(path.join(root, "backend/scripts/dev/lib/tourScorecard.mjs")).href);
  const bridge = await import(pathToFileURL(path.join(root, "backend/lib/raceEngineV4Bridge.js")).href);
  const { ABILITY_KEYS } = await import(pathToFileURL(path.join(root, "backend/lib/raceSimulator.js")).href);
  let datasets;
  if (opts.fromCache) {
    datasets = JSON.parse(readFileSync(abs(opts.fromCache), "utf8"));
  } else {
    const db = await supabase();
    const races = await listRaces(db, opts);
    const divs = await one(db.from("league_divisions").select("id, tier, label, squad"), "league_divisions"); // pagination-safe: faa divisioner
    const divById = new Map(divs.map((d) => [d.id, d]));
    datasets = [];
    for (const race of races) {
      const data = await fetchRaceData(db, race, ABILITY_KEYS);
      data.division = divById.get(race.league_division_id) ?? null;
      if (data.profiles.length && data.entries.length) datasets.push(data);
    }
    if (opts.saveCache) { mkdirSync(path.dirname(abs(opts.saveCache)), { recursive: true }); writeFileSync(abs(opts.saveCache), JSON.stringify(datasets)); }
  }
  const v4 = await bridge.loadRaceEngineV4();
  const races = [];
  const names = { teams: {}, riders: {} };
  let done = 0;
  for (const data of datasets) {
    for (const t of data.teams ?? []) names.teams[t.id] = { name: t.name ?? null, ai: t.is_ai === true };
    for (const r of data.riders ?? []) names.riders[r.id] = `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
    const stages = runRace({ sc, v4, data, revisions: opts.revisions, seeds: opts.seeds });
    races.push({
      id: data.race.id, name: data.race.name, scheduled_for: data.race.scheduled_for ?? null, status: data.race.status,
      race_class: data.race.race_class ?? null, squad: data.race.squad ?? null,
      prodRevision: data.race.engine_rules_revision ?? null,
      division: data.division ? { tier: data.division.tier, label: data.division.label } : null,
      riders: data.entries.length, humanTeams: (data.teams ?? []).filter((t) => !t.is_ai).length, aiTeams: (data.teams ?? []).filter((t) => t.is_ai).length,
      orders: data.orders.length,
      stages,
    });
    done++;
    if (done % 10 === 0) console.error(`${done}/${datasets.length} loeb`);
  }
  const bench = {
    generatedAt: new Date().toISOString(), revisions: opts.revisions, seeds: opts.seeds, days: opts.days,
    benchmarks: { breakawaySize: sc.TOUR_BENCHMARKS.breakawaySize.byClass, gapTo10: sc.TOUR_BENCHMARKS.gapTo10.byClass, gapTo30: sc.TOUR_BENCHMARKS.gapTo30.byClass },
    tally: tally(races, opts.revisions), names, races,
  };
  mkdirSync(path.dirname(abs(opts.out)), { recursive: true });
  writeFileSync(abs(opts.out), JSON.stringify(bench));
  const stageCount = races.reduce((n, r) => n + r.stages.length, 0);
  console.log(`Testbaenk: ${races.length} loeb, ${stageCount} etaper, ${opts.revisions.join(" vs ")} x ${opts.seeds} seeds -> ${abs(opts.out)}`);
  return bench;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
