import { authHeaders } from "./supabase";
import { createRankingsClient } from "./rankingsClient.ts";

export const {
  fetchGlobalRanks, getGlobalRank, fetchRiderRankings, getRiderRankings,
  getTopRiderRankings, fetchTeamStandings, fetchTeamRacePoints,
  getRaceDayPoints, getRaceCount,
} = createRankingsClient({
  baseUrl: import.meta.env.VITE_API_URL || "",
  headers: () => authHeaders({ json: false }),
  // Resolve global fetch at request time so preview interceptors stay effective.
  fetcher: (...args) => fetch(...args),
});
