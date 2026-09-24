// #5631: den bundne ungdomsstillings-klient (auth-headere + apiFetch).
//
// Selve klienten er ren og testet i lib/youthRankingsClient.ts; her får den
// kun sine afhængigheder, samme lagdeling som lib/rankingsApi.ts. apiFetch
// giver 429-backoff og ÉN 401-håndtering (#5242).
import { authHeaders, supabase } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import { reportLoadFailure } from "../../lib/actionTelemetry.js";
import { createYouthRankingsClient, type YouthStandingsNames } from "../../lib/youthRankingsClient.ts";

// Holdlisten kan være lang; .in() i bidder, så URL'en holder sig kort.
const ID_CHUNK = 100;

// Endpointet (#5647) sender kun youth_season_standings' egne kolonner. Hold-
// navn og gruppe slås op her, samme tabeller som resten af appen læser.
async function lookupNames({ teamIds, poolIds }: { teamIds: string[]; poolIds: number[] }): Promise<YouthStandingsNames> {
  const names: YouthStandingsNames = { teams: {}, pools: {} };
  const teamChunks: string[][] = [];
  for (let i = 0; i < teamIds.length; i += ID_CHUNK) teamChunks.push(teamIds.slice(i, i + ID_CHUNK));
  const [teamResults, poolResult] = await Promise.all([
    Promise.all(teamChunks.map((ids) => supabase.from("teams").select("id, name").in("id", ids))),
    poolIds.length
      ? supabase.from("league_divisions").select("id, pool_index, label").in("id", poolIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const { data, error } of teamResults) {
    if (error) throw error;
    for (const team of (data ?? []) as { id: string; name: string | null }[]) {
      if (team.name) names.teams[team.id] = team.name;
    }
  }
  if (poolResult.error) throw poolResult.error;
  for (const pool of (poolResult.data ?? []) as { id: number; pool_index: number | null; label: string | null }[]) {
    names.pools[String(pool.id)] = { index: pool.pool_index ?? null, label: pool.label ?? null };
  }
  return names;
}

export const { getYouthStandings } = createYouthRankingsClient({
  baseUrl: import.meta.env.VITE_API_URL || "",
  headers: () => authHeaders({ json: false }),
  request: (url, init) => apiFetch(url, init, { source: "youth-standings" }),
  lookupNames,
  // path+status only, aldrig query-værdier (samme regel som rankingsApi.ts).
  reportError: (error, context) => reportLoadFailure("youth_rankings_client", {
    kind: "http", status: context.status, cause: error, context: { path: context.path },
  }),
});
