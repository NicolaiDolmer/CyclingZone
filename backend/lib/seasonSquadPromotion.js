import { countSquadMembers } from "./academyGraduation.js";
import { getSquadLimits, getTeamMarketState } from "./marketUtils.js";
import { isYouthSquad, squadForSeason, SQUAD_CAPS } from "./squads.js";
import { fetchAllRowsChunkedIn } from "./supabasePagination.js";

export function planSeasonSquadPromotions(riders, seasonNumber) {
  const moves = [];
  for (const rider of riders) {
    if (!rider.team_id || rider.is_retired || !isYouthSquad(rider.squad)) continue;
    const toSquad = squadForSeason(rider.birthdate, seasonNumber);
    const movesUp = toSquad === "senior" || (rider.squad === "junior" && toSquad === "u23");
    if (movesUp) {
      moves.push({
        rider_id: rider.id,
        team_id: rider.team_id,
        from_squad: rider.squad,
        to_squad: toSquad,
      });
    }
  }
  return moves;
}

export async function promoteSeasonSquads({ supabase, seasonId, seasonNumber, transitionAtIso }) {
  const moves = [];
  const pageSize = 500;
  let afterId = null;
  for (;;) {
    let query = supabase.from("riders")
      .select("id,team_id,squad,birthdate,is_retired")
      .in("squad", ["junior", "u23"])
      .not("team_id", "is", null)
      .order("id")
      .limit(pageSize);
    if (afterId !== null) query = query.gt("id", afterId);
    const { data: riders, error } = await query;
    if (error) throw new Error(`Could not read youth squads for season promotion: ${error.message}`);
    moves.push(...planSeasonSquadPromotions(riders, seasonNumber));
    if (riders.length < pageSize) break;
    afterId = riders.at(-1).id;
  }

  const { data, error } = await supabase.rpc("promote_season_squads_7323", {
    p_season_id: seasonId,
    p_transition_at: transitionAtIso,
    p_moves: moves,
  });
  if (error) throw new Error(`Could not promote youth squads at season cutover: ${error.message}`);
  return data;
}

export async function loadSquadPromotionNotices(supabase, promotions) {
  const notices = new Map();
  for (const { team_id, to_squad, firstname, lastname } of promotions) {
    if (!notices.has(team_id)) notices.set(team_id, []);
    const squads = notices.get(team_id);
    let notice = squads.find(({ squad }) => squad === to_squad);
    if (!notice) {
      notice = { squad: to_squad, names: [] };
      squads.push(notice);
    }
    notice.names.push([firstname, lastname].filter(Boolean).join(" "));
  }

  for (const [teamId, squads] of notices) {
    for (const notice of squads) {
      if (notice.squad === "senior") {
        const state = await getTeamMarketState(supabase, teamId);
        notice.overLimit = state.future_count > getSquadLimits(state.division).max;
      } else {
        const count = await countSquadMembers(supabase, { teamId, squad: notice.squad });
        notice.overLimit = count > SQUAD_CAPS[notice.squad];
      }
    }
  }
  return notices;
}

// This allowance applies only to legacy enforcement and cutover readiness.
// The market and voluntary squad moves continue to use the actual squad count.
export async function loadProtectedSeniorRiderIds(supabase, teamByRiderId) {
  if (!teamByRiderId.size) return new Set();
  const moves = await fetchAllRowsChunkedIn([...teamByRiderId.keys()], (ids) => supabase
    .from("academy_graduation")
    .select("id,rider_id,team_id")
    .in("rider_id", ids)
    .eq("automatic", true)
    .eq("status", "promoted")
    .eq("to_squad", "senior")
    .order("id"));
  return new Set(moves
    .filter((move) => teamByRiderId.get(move.rider_id) === move.team_id)
    .map((move) => move.rider_id));
}
