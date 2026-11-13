import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase.ts";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { fetchGlobalRanks } from "../lib/rankingsApi.ts";
import { readFailurePresentation } from "./apiQuery.ts";
import { globalRankQueryOptions, type GlobalRankRow, type GlobalRankSources } from "./globalRankData.ts";
import { useDataScope } from "./useDataScope.ts";

// The rank view can grow past PostgREST's row cap, so the snapshots are read with fetchAllRows (#2206).
const sources: GlobalRankSources = {
  ranks: () => fetchGlobalRanks(),
  weekly: () => fetchAllRows(() => supabase
    .from("global_rank_weekly_snapshot").select("team_id, global_rank").order("team_id")),
  seasonStart: () => fetchAllRows(() => supabase
    .from("global_rank_season_start_snapshot").select("team_id, global_rank").order("team_id")),
};
const EMPTY: GlobalRankRow[] = [];

/** Global Rank page data. Same states as before the data layer: loading until the first answer
 * (and while a retry after a failure runs), the error only when there is nothing to show. */
export function useGlobalRankData() {
  const { runtime, scope, team } = useDataScope();
  const query = useQuery({ ...globalRankQueryOptions(runtime, scope, sources), enabled: scope.ready });
  const hasData = query.data !== undefined;
  const presentation = readFailurePresentation(query.error, hasData);
  return {
    teams: query.data?.teams ?? EMPTY,
    climbers: query.data?.climbers ?? EMPTY,
    bestNewManagers: query.data?.bestNewManagers ?? EMPTY,
    myTeamId: team?.id ?? null,
    loading: !hasData && (query.isPending || query.isFetching),
    error: presentation === "error" || presentation === "waiting" ? query.error : null,
    reload: () => { void query.refetch(); },
  };
}
