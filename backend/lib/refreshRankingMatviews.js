// #2175: refresh af rangliste-matviews (rider_rankings_mv, team_standings_ext_mv,
// team_race_points_mv) via refresh_ranking_matviews()-RPC'en.
//
// Matviews aggregerer fra race_results, så de skal refreshes når nye resultater
// skrives (race-finalization) — ellers driver /standings + /rider-rankings.
// En cron-fallback (cron.js) kalder den samme funktion periodisk og fanger enhver
// misset refresh (fx hvis en finalization-sti fejlede halvvejs).
//
// BEST-EFFORT: en refresh-fejl logges men kastes ALDRIG videre. Kaldere er race-
// finalization (resultaterne ER allerede skrevet — en refresh-fejl må ikke vælte
// afviklingen) + cron (næste tick prøver igen). Fejler RPC'en fordi migrationen
// endnu ikke er applied i prod, er warn'en forventet og ufarlig.
export async function refreshRankingMatviewsSafe(supabase) {
  try {
    const { error } = await supabase.rpc("refresh_ranking_matviews");
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.warn(`⚠️  refresh_ranking_matviews fejlede (best-effort, cron fanger den): ${err.message}`);
    return false;
  }
}
