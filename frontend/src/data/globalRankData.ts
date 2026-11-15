import { viewerKey, type DataRuntime, type DataScope } from "./queryRuntime.ts";

// Global Rank (#2453), moved onto the shared data layer in #6494. One ranking across all
// managers, read from the precomputed rank view plus the two snapshot tables (weekly
// movement, season start). No live aggregation. Inactive managers are hidden from the list;
// their points stay in the database.

export interface GlobalRankRow {
  team_id: string;
  name: string;
  division: number;
  banked_points: number;
  season_points: number;
  global_points: number;
  global_rank: number | null;
  is_rookie: boolean;
  movement: number | null;
  places_gained: number | null;
}
export interface GlobalRankData {
  teams: GlobalRankRow[];
  climbers: GlobalRankRow[];
  bestNewManagers: GlobalRankRow[];
}
type SourceRow = Record<string, unknown>;
export interface GlobalRankSources {
  /** Aggregated ranks from the API. Its transport cannot abort, so no signal is passed. */
  ranks: () => Promise<SourceRow[]>;
  weekly: () => Promise<SourceRow[]>;
  seasonStart: () => Promise<SourceRow[]>;
}

const num = (value: unknown): number | null => (value == null ? null : Number(value) || 0);

function rankByTeam(rows: SourceRow[] | null | undefined) {
  return new Map((rows || []).map(row => [row.team_id, num(row.global_rank)]));
}

export function buildGlobalRankData(
  ranks: SourceRow[] | null | undefined,
  weekly: SourceRow[] | null | undefined,
  seasonStart: SourceRow[] | null | undefined,
): GlobalRankData {
  const weeklyRankByTeam = rankByTeam(weekly);
  const seasonStartRankByTeam = rankByTeam(seasonStart);
  // Managers inactive for two or more seasons are hidden; their points are kept.
  const teams = (ranks || []).filter(row => row.active_recent).map((row): GlobalRankRow => {
    const currentRank = num(row.global_rank);
    const prevRank = weeklyRankByTeam.get(row.team_id) ?? null;
    const startRank = seasonStartRankByTeam.get(row.team_id) ?? null;
    return {
      team_id: row.team_id as string,
      name: row.name as string,
      division: row.division as number,
      banked_points: num(row.banked_points) || 0,
      season_points: num(row.season_points) || 0,
      global_points: num(row.global_points) || 0,
      global_rank: currentRank,
      is_rookie: !!row.is_rookie,
      movement: prevRank == null || currentRank == null ? null : prevRank - currentRank,
      places_gained: startRank == null || currentRank == null ? null : startRank - currentRank,
    };
  });
  return {
    teams,
    climbers: teams.filter(row => row.places_gained != null && row.places_gained > 0)
      .sort((a, b) => (b.places_gained ?? 0) - (a.places_gained ?? 0))
      .slice(0, 10),
    bestNewManagers: teams.filter(row => row.is_rookie)
      .sort((a, b) => b.global_points - a.global_points)
      .slice(0, 10),
  };
}

/** Query options for the ranking. The key is viewer-scoped (the list itself is the same for
 * every team), so it does not change while the viewer's team bootstrap resolves. */
export function globalRankQueryOptions(runtime: DataRuntime, scope: DataScope, sources: GlobalRankSources) {
  return {
    queryKey: viewerKey(scope, "global-rank"),
    queryFn: async (): Promise<GlobalRankData> => {
      const revision = await runtime.beforeRead();
      const [ranks, weekly, seasonStart] = await Promise.all([sources.ranks(), sources.weekly(), sources.seasonStart()]);
      // A viewer or team change while the read was in flight discards the old answer.
      runtime.assertReadCurrent(scope, revision);
      return buildGlobalRankData(ranks, weekly, seasonStart);
    },
  };
}
