// Global Rank (#2453): ugentligt bevægelses-snapshot ("▲/▼ siden sidste uge").
// Kalder take_global_rank_weekly_snapshot()-RPC'en (database/2026-07-17-global-
// rank.sql), som selv no-op'er medmindre >= 7 dage er gået siden seneste
// snapshot — så den kan kaldes fra en 24h-cron (dagligt tjek, ugentlig effekt),
// samme mønster som andre 24h-jobs i cron.js.
//
// BEST-EFFORT: fejler stille (samme disciplin som refreshRankingMatviewsSafe) —
// en manglende snapshot betyder blot at bevægelses-pilen viser "NEW" en dag
// længere, ikke at leaderboardet går i stykker.
export async function takeGlobalRankWeeklySnapshotSafe(supabase) {
  try {
    const { error } = await supabase.rpc("take_global_rank_weekly_snapshot");
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.warn(`⚠️  take_global_rank_weekly_snapshot fejlede (best-effort): ${err.message}`);
    return false;
  }
}
