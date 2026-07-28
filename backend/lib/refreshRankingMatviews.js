// #2175/#3013: refresh af rangliste-matviews (rider_rankings_mv,
// team_standings_ext_mv, team_race_points_mv, global_rank_mv).
//
// Matviews aggregerer fra race_results, så de skal refreshes når nye resultater
// skrives (race-finalization) — ellers driver /standings + /rider-rankings.
// En cron-fallback (cron.js) kalder den samme funktion periodisk og fanger enhver
// misset refresh (fx hvis en finalization-sti fejlede halvvejs).
//
// #3013: fire SEPARATE RPC-kald i stedet for ét. REFRESH MATERIALIZED VIEW uden
// CONCURRENTLY tager ACCESS EXCLUSIVE-lås; den gamle refresh_ranking_matviews()
// kørte alle fire i ÉN transaktion, så en læser af den HURTIGSTE matview kunne
// stå og vente på den LANGSOMSTE (målt maks 7,8s i prod mod 8s statement_timeout).
// Fire separate transaktioner (database/2026-07-27-3013-refresh-matviews-
// concurrently.sql) frigiver hver lås så snart DEN matview er færdig i stedet for
// at holde alle fire til den sidste er done. CONCURRENTLY er IKKE muligt her —
// Postgres afviser den fra enhver funktion kaldt via RPC/SPI, se migrationens
// header-kommentar. Ægte nul-blokering kræver en transport-ændring (pg_cron eller
// rå pg-forbindelse), sporet som opfølgning på #3013.
//
// Heartbeat-atomicitet (#2196 Del 2): den ORIGINALE refresh_ranking_matviews()
// skrev matview_refresh_heartbeat KUN hvis alle fire REFRESH lykkedes i samme
// transaktion ("heartbeat kan ikke lyve"). Med fire separate RPC'er kan det ikke
// garanteres i databasen længere, så Node overtager invarianten: heartbeat
// upsertes KUN herfra, og KUN hvis alle fire RPC-kald returnerede uden fejl.
//
// BEST-EFFORT: en refresh-fejl logges + rapporteres til Sentry, men kastes ALDRIG
// videre. Kaldere er race-finalization (resultaterne ER allerede skrevet — en
// refresh-fejl må ikke vælte afviklingen) + cron (næste tick prøver igen).
// Fejler en RPC fordi migrationen endnu ikke er applied i prod (funktionen findes
// ikke endnu), er warn'en forventet og ufarlig — de andre matviews refreshes
// stadig (best-effort pr. matview, ikke alt-eller-intet).
const REFRESH_RPCS = [
  { rpc: "refresh_rider_rankings_mv", label: "rider_rankings_mv" },
  { rpc: "refresh_team_standings_ext_mv", label: "team_standings_ext_mv" },
  { rpc: "refresh_team_race_points_mv", label: "team_race_points_mv" },
  { rpc: "refresh_global_rank_mv", label: "global_rank_mv" },
];

export async function refreshRankingMatviewsSafe(supabase, { captureExceptionFn } = {}) {
  const failures = [];

  for (const { rpc, label } of REFRESH_RPCS) {
    try {
      const { error } = await supabase.rpc(rpc);
      if (error) throw new Error(error.message);
    } catch (err) {
      failures.push({ label, message: err.message });
      console.warn(`⚠️  ${rpc} fejlede (best-effort, cron fanger den): ${err.message}`);
    }
  }

  if (failures.length > 0) {
    if (captureExceptionFn) {
      captureExceptionFn(
        new Error(`refreshRankingMatviewsSafe: ${failures.length}/${REFRESH_RPCS.length} matview-refresh fejlede`),
        {
          tags: { lib: "refreshRankingMatviews" },
          extra: { failures },
        }
      );
    }
    return false;
  }

  // Alle fire lykkedes → heartbeat opdateres (bevarer "heartbeat kan ikke lyve"-
  // invarianten fra #2196 Del 2, nu på Node-siden i stedet for i én DB-transaktion).
  try {
    const { error: hbError } = await supabase
      .from("matview_refresh_heartbeat")
      .upsert({ matview_group: "ranking", refreshed_at: new Date().toISOString() }, { onConflict: "matview_group" });
    if (hbError) throw new Error(hbError.message);
  } catch (err) {
    console.warn(`⚠️  matview_refresh_heartbeat upsert fejlede (best-effort): ${err.message}`);
    if (captureExceptionFn) {
      captureExceptionFn(new Error(`refreshRankingMatviewsSafe heartbeat upsert: ${err.message}`), {
        tags: { lib: "refreshRankingMatviews" },
      });
    }
    // Matviews ER friske selvom heartbeat-skrivningen fejlede — returnér true,
    // stall-watchdog degraderer gracefully hvis heartbeat-rækken mangler/er stale
    // (samme disciplin som resten af filen: en observability-fejl må ikke
    // fremstå som en data-fejl).
  }

  return true;
}
