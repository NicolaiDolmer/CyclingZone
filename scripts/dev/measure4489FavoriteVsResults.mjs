// READ-ONLY måling til #4489 — sammenligner motorens interne
// favorit/outsider-mærke (terrainRanking i raceNarrative.js / observeRace i
// raceDominanceMetrics.js) mod de faktiske løbsresultater for S3.
//
// Ingen skrivning. Bruger backend/.env (SUPABASE_URL + SUPABASE_SERVICE_KEY).
// Kun aggregerede tal skrives til stdout — ingen rytternavne, ingen rå vægte.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const BATCH = 40;
async function inBatches(ids, fn) {
  const out = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const rows = await fn(batch);
    out.push(...rows);
  }
  return out;
}

async function main() {
  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("id, number, status").eq("number", 3).maybeSingle();
  if (seasonErr || !season) { console.error("Kunne ikke finde S3", seasonErr); process.exit(1); }

  const { data: races, error: racesErr } = await supabase
    .from("races")
    .select("id, race_type, race_class, league_division_id, stages, stages_completed, status")
    .eq("season_id", season.id);
  if (racesErr) { console.error(racesErr); process.exit(1); }

  const raceById = new Map(races.map((r) => [r.id, r]));
  const raceIds = races.map((r) => r.id);

  // Seneste simulation-run pr. (race_id, stage_number)
  const runs = await inBatches(raceIds, async (batch) => {
    const { data, error } = await supabase
      .from("race_simulation_runs")
      .select("id, race_id, stage_number, created_at")
      .in("race_id", batch);
    if (error) throw error;
    return data;
  });

  const latestRunByStage = new Map(); // key race_id:stage_number -> run
  for (const run of runs) {
    const key = `${run.race_id}:${run.stage_number}`;
    const prev = latestRunByStage.get(key);
    if (!prev || new Date(run.created_at) > new Date(prev.created_at)) latestRunByStage.set(key, run);
  }
  const runIds = [...latestRunByStage.values()].map((r) => r.id);
  if (runIds.length === 0) { console.log("Ingen simulation-runs fundet for S3."); return; }

  // Hent scores i batches (Supabase .in() har praktisk URL-grænse)
  const scoresByRunId = new Map();
  const scoreRows = await inBatches(runIds, async (batch) => {
    const { data, error } = await supabase
      .from("race_simulation_rider_scores")
      .select("run_id, rider_id, rank, components")
      .in("run_id", batch);
    if (error) throw error;
    return data;
  });
  for (const s of scoreRows) {
    if (!scoresByRunId.has(s.run_id)) scoresByRunId.set(s.run_id, []);
    scoresByRunId.get(s.run_id).push(s);
  }

  // Faktiske resultater (vinder pr. race_id+stage_number)
  const results = await inBatches(raceIds, async (batch) => {
    const { data, error } = await supabase
      .from("race_results")
      .select("race_id, stage_number, rider_id, rank, result_type")
      .in("race_id", batch)
      .eq("rank", 1);
    if (error) throw error;
    return data;
  });
  const winnerByStage = new Map(); // race_id:stage_number -> rider_id (first rank=1 row)
  for (const r of results) {
    const key = `${r.race_id}:${r.stage_number}`;
    if (!winnerByStage.has(key)) winnerByStage.set(key, r.rider_id);
  }

  let total = 0, favoriteWon = 0;
  const byRaceType = new Map();
  const byDivision = new Map();
  const bump = (map, key, won) => {
    if (!map.has(key)) map.set(key, { total: 0, favoriteWon: 0 });
    const e = map.get(key);
    e.total += 1;
    if (won) e.favoriteWon += 1;
  };

  for (const [key, run] of latestRunByStage) {
    const scores = scoresByRunId.get(run.id);
    if (!scores || scores.length === 0) continue;
    const winnerId = winnerByStage.get(key);
    if (!winnerId) continue; // stage ikke afviklet/importeret endnu

    // Favorit: højeste components.terrain, tie -> laveste rider_id (samme regel som raceNarrative.js)
    let favorite = null;
    for (const s of scores) {
      const t = Number(s.components?.terrain ?? -Infinity);
      if (!favorite) { favorite = { rider_id: s.rider_id, terrain: t }; continue; }
      if (t > favorite.terrain || (t === favorite.terrain && String(s.rider_id) < String(favorite.rider_id))) {
        favorite = { rider_id: s.rider_id, terrain: t };
      }
    }
    if (!favorite) continue;

    total += 1;
    const won = String(favorite.rider_id) === String(winnerId);
    if (won) favoriteWon += 1;

    const race = raceById.get(run.race_id);
    const rt = race?.race_type ?? race?.race_class ?? "ukendt";
    bump(byRaceType, rt, won);
    bump(byDivision, race?.league_division_id ?? "ukendt", won);
  }

  console.log("=== #4489 — favorit vs. faktisk vinder, S3, read-only prod-maaling ===");
  console.log(`Etaper/enkeltloeb maalt: ${total}`);
  console.log(`Favorit vandt: ${favoriteWon} (${total ? (100 * favoriteWon / total).toFixed(1) : "n/a"}%)`);
  console.log(`Outsider vandt: ${total - favoriteWon} (${total ? (100 * (total - favoriteWon) / total).toFixed(1) : "n/a"}%)`);
  console.log("\n-- pr. race_type --");
  for (const [rt, e] of byRaceType) {
    console.log(`${rt}: n=${e.total}, favorit-vinderrate=${(100 * e.favoriteWon / e.total).toFixed(1)}%`);
  }
  console.log("\n-- pr. division (league_division_id) --");
  for (const [d, e] of byDivision) {
    console.log(`${d}: n=${e.total}, favorit-vinderrate=${(100 * e.favoriteWon / e.total).toFixed(1)}%`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
