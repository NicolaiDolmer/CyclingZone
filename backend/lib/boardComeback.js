import { isParkedTeam } from "./managerParking.js";

/**
 * The parking sweep can record the receiving season before the season row exists.
 * @param {{ parked_at?: string | null, comeback_season_id?: string | null,
 *   comeback_board_season_number?: number | null } | null | undefined} team
 * @param {string | null | undefined} seasonId
 * @param {number | null | undefined} seasonNumber
 */
export function boardJudgmentHold(team, seasonId, seasonNumber) {
  if (isParkedTeam(team)) return "parked_team";
  if (
    (seasonId != null && team?.comeback_season_id === seasonId) ||
    (seasonNumber != null && team?.comeback_board_season_number != null && seasonNumber <= team.comeback_board_season_number)
  ) return "comeback_season";
  return null;
}
