// #7031 (ejer 22/10, "Ja, fjern dem fra S4"): ungdomsklassementet findes ikke i U23-
// og juniorløb. Rækker der blev skrevet før reglen (`young`/`young_day` i et
// ungdomsløb) bar point, som tæller i ungdomsstillingen og ungdomsranglisten. Dette
// script nulstiller de point ÉN gang, så alle aggregater følger reglen.
//
// Ranglisterne (matview + skyggetabellerne) markeres selv som beskidte af triggerne på
// race_results (`ranking_dirty_update`, `ranking_delta_results_update`). Ungdoms-
// stillingen genberegnes her via `recompute_youth_season_standings` pr. sæson og trup.
//
// Brug (fra repo-roden):
//   infisical run --env=prod --silent -- node backend/scripts/zeroYouthClassificationPoints7031.mjs
//       → prøvekørsel (read-only): rækker, point og stillingsændringer pr. trup
//   ... --apply --owner-go
//       → skriver backup-fil FØRST (balance-internals/7031/), nulstiller, genberegner, verificerer
//   ... --restore=<backup-fil> --apply --owner-go
//       → sætter de gemte point tilbage og genberegner
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
export const YOUTH_SQUADS = ["u23", "junior"];
export const HIDDEN_TYPES = ["young", "young_day"];
const CHUNK = 200;

/** Ren: ny stilling pr. pulje når hver holds point sænkes med `deltaByTeam`. */
export function projectStandings(standings, deltaByTeam) {
  const byPool = new Map();
  for (const s of standings) {
    const key = `${s.squad}|${s.league_division_id ?? "none"}`;
    if (!byPool.has(key)) byPool.set(key, []);
    byPool.get(key).push({ ...s, after: s.total_points - (deltaByTeam.get(`${s.squad}|${s.team_id}`) ?? 0) });
  }
  const changes = [];
  for (const [pool, rows] of byPool) {
    const sorted = [...rows].sort((a, b) => b.after - a.after || String(a.team_id).localeCompare(String(b.team_id)));
    sorted.forEach((r, i) => {
      const newRank = i + 1;
      if (newRank !== r.rank_in_pool) changes.push({ pool, team_id: r.team_id, from: r.rank_in_pool, to: newRank, pointsBefore: r.total_points, pointsAfter: r.after });
    });
  }
  return changes;
}

async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const ownerGo = args.includes("--owner-go");
  const restoreArg = args.find((a) => a.startsWith("--restore="));
  if (apply && !ownerGo) throw new Error("--apply kræver --owner-go (ejerens ordrette 'kør')");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (infisical run --env=prod)");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  if (restoreArg) {
    const file = restoreArg.slice("--restore=".length);
    const backup = JSON.parse(readFileSync(file, "utf8"));
    console.log(`Restore: ${backup.rows.length} rækker fra ${file}`);
    if (!apply) return;
    for (const r of backup.rows) {
      const { error } = await supabase.from("race_results").update({ points_earned: r.points_earned }).eq("id", r.id);
      if (error) throw new Error(`restore ${r.id}: ${error.message}`);
    }
    await recompute(supabase, backup.targets);
    console.log("Restore færdig.");
    return;
  }

  const races = await fetchAll(() => supabase.from("races").select("id, season_id, squad").in("squad", YOUTH_SQUADS).order("id"));
  const raceById = new Map(races.map((r) => [r.id, r]));
  const rows = [];
  const raceIds = races.map((r) => r.id);
  for (let i = 0; i < raceIds.length; i += CHUNK) {
    const ids = raceIds.slice(i, i + CHUNK);
    rows.push(...await fetchAll(() => supabase.from("race_results")
      .select("id, race_id, rider_id, team_id, result_type, points_earned")
      .in("race_id", ids).in("result_type", HIDDEN_TYPES).gt("points_earned", 0).order("id")));
  }

  const deltaByTeam = new Map();
  const targets = new Map();
  const perSquad = {};
  for (const r of rows) {
    const race = raceById.get(r.race_id);
    targets.set(`${race.season_id}|${race.squad}`, { seasonId: race.season_id, squad: race.squad });
    perSquad[race.squad] = perSquad[race.squad] ?? { rows: 0, points: 0 };
    perSquad[race.squad].rows += 1;
    perSquad[race.squad].points += r.points_earned;
    if (r.team_id) deltaByTeam.set(`${race.squad}|${r.team_id}`, (deltaByTeam.get(`${race.squad}|${r.team_id}`) ?? 0) + r.points_earned);
  }
  console.log(`Rækker med point: ${rows.length}`, perSquad);

  const targetList = [...targets.values()];
  const standings = [];
  for (const t of targetList) {
    standings.push(...await fetchAll(() => supabase.from("youth_season_standings")
      .select("squad, league_division_id, team_id, total_points, rank_in_pool")
      .eq("season_id", t.seasonId).eq("squad", t.squad).order("team_id")));
  }
  const changes = projectStandings(standings, deltaByTeam);
  console.log(`Placeringsændringer i ungdomsstillingen (tilnærmet, team_id på rækken): ${changes.length}`);
  for (const c of changes.slice(0, 40)) console.log(`  ${c.pool}  hold ${c.team_id.slice(0, 8)}  ${c.from} -> ${c.to}  (${c.pointsBefore} -> ${c.pointsAfter})`);

  if (!apply) { console.log("\nPrøvekørsel. Intet skrevet. Kør med --apply --owner-go på ejerens 'kør'."); return; }

  const dir = join(REPO_ROOT, "balance-internals", "7031");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `zero-youth-classification-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), targets: targetList, rows: rows.map((r) => ({ id: r.id, points_earned: r.points_earned })) }, null, 2));
  console.log(`Backup skrevet: ${file}  (restore: --restore=${file} --apply --owner-go)`);

  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await supabase.from("race_results").update({ points_earned: 0 }).in("id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`nulstilling: ${error.message} (backup: ${file})`);
  }
  await recompute(supabase, targetList);

  let left = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { count, error } = await supabase.from("race_results").select("id", { count: "exact", head: true })
      .in("id", ids.slice(i, i + CHUNK)).gt("points_earned", 0);
    if (error) throw new Error(error.message);
    left += count ?? 0;
  }
  console.log(left === 0 ? "Verificeret: 0 rækker med point tilbage." : `FEJL: ${left} rækker har stadig point.`);
  if (left !== 0) process.exitCode = 1;
}

async function recompute(supabase, targets) {
  for (const t of targets) {
    const { data, error } = await supabase.rpc("recompute_youth_season_standings", { p_season_id: t.seasonId, p_squad: t.squad });
    if (error) throw new Error(`recompute ${t.squad}: ${error.message}`);
    console.log(`Ungdomsstilling genberegnet ${t.squad}:`, data);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
