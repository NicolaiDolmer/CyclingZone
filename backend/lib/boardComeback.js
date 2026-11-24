import { isParkedTeam } from "./managerParking.js";

/** @typedef {{ parked_at?: string | null, comeback_season_id?: string | null,
 *   comeback_board_season_number?: number | null } | null | undefined} BoardTeam */

/**
 * @param {BoardTeam} team
 * @param {string | null | undefined} seasonId
 * @param {number | null | undefined} seasonNumber
 */
export function isComebackSeason(team, seasonId, seasonNumber) {
  if (seasonNumber != null && team?.comeback_board_season_number != null) {
    return team.comeback_board_season_number === seasonNumber;
  }
  return seasonId != null && team?.comeback_season_id === seasonId;
}

/**
 * The parking sweep can record the receiving season before the season row exists.
 * @param {BoardTeam} team
 * @param {string | null | undefined} seasonId
 * @param {number | null | undefined} seasonNumber
 */
export function boardJudgmentHold(team, seasonId, seasonNumber) {
  if (isParkedTeam(team)) return "parked_team";
  if (isComebackSeason(team, seasonId, seasonNumber)
      || (seasonNumber != null && team?.comeback_board_season_number != null
        && seasonNumber < team.comeback_board_season_number)) {
    return "comeback_season";
  }
  return null;
}
