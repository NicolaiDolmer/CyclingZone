import { authHeaders } from "./supabase";
import { createRankingsClient } from "./rankingsClient.ts";
import { reportLoadFailure } from "./actionTelemetry.js";

export const {
  fetchGlobalRanks, getGlobalRank, fetchRiderRankings, getRiderRankings,
  getTopRiderRankings, fetchTeamStandings, fetchTeamRacePoints,
  getRaceDayPoints, getRaceCount, getSeasonHonours,
} = createRankingsClient({
  baseUrl: import.meta.env.VITE_API_URL || "",
  headers: () => authHeaders({ json: false }),
  // Resolve global fetch at request time so preview interceptors stay effective.
  fetcher: (...args) => fetch(...args),
  // #5186: fem af de seks flader viste bare tomt paa en 4xx/5xx uden signal.
  // path+status only - aldrig query-vaerdier (team_id/season_id udelades).
  reportError: (error, context) => reportLoadFailure("rankings_client", {
    kind: "http", status: context.status, cause: error, context: { path: context.path },
  }),
});
