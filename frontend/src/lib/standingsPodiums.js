// Podie-tælling pr. hold til ranglisten (#1093).
//
// Rod-årsag bag buggen: StandingsPage læste `s.podiums` fra season_standings,
// men den kolonne har aldrig eksisteret i DB'en (se database/schema.sql), og
// backend-aggregeringen (updateStandings i economyEngine.js) tæller kun
// points/stage_wins/gc_wins. Kolonnen viste derfor altid 0. Podier beregnes nu
// client-side fra race_results — samme mønster som holdkonkurrence- og
// præmiepenge-kolonnerne på samme side.
//
// Semantik (bevidst konsistent med rytter-ranglistens "Top 3"-kolonne,
// RiderRankingsPage.jsx): kun etape-placeringer (result_type='stage') og
// samlet/klassiker-placeringer (result_type='gc') med rank <= 3 tæller.
// Trøje-klassementer (points/mountain/young + *_day-rækker) og
// holdkonkurrencen (result_type='team') tæller IKKE — holdkonkurrencen har
// sin egen kolonne på ranglisten.
//
// Team-attribution følger backend updateStandings: resultatets team_id-
// snapshot foretrækkes, med fallback til rytterens nuværende hold.
const PODIUM_RESULT_TYPES = new Set(["stage", "gc"]);

export function countTeamPodiums(results) {
  const podiums = {};
  for (const r of results || []) {
    if (!r || !PODIUM_RESULT_TYPES.has(r.result_type)) continue;
    const rank = Number(r.rank);
    if (!Number.isFinite(rank) || rank < 1 || rank > 3) continue;
    const teamId = r.team_id || r.rider?.team_id;
    if (!teamId) continue;
    podiums[teamId] = (podiums[teamId] || 0) + 1;
  }
  return podiums;
}
