import { useQuery } from "@tanstack/react-query";
import { readTodayStages } from "../hooks/useTodayStages.js";
import { privateKey } from "./queryRuntime.ts";
import { useDataScope } from "./useDataScope.ts";

// #3915/#6569/#6494: "Today's stages" for the viewer's team, one Query key per viewer/team.
// The existing minute tick (scheduled -> live -> finished without a reload) is kept as the
// resource's refetch interval while the strip is mounted; it is not new polling.
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy card shape from the JS reader. */
export interface TodayStagesState { loading: boolean; cards: Array<Record<string, any>> }
const PENDING: TodayStagesState = { loading: true, cards: [] };

export function useTodayStagesData(): TodayStagesState {
  const { runtime, scope, team, ready } = useDataScope();
  const teamId = (team as { id?: string } | null)?.id ?? null;
  const key = privateKey(scope, "dashboard:today-stages");
  const query = useQuery({
    queryKey: key,
    enabled: ready && teamId !== null,
    refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      await runtime.beforeRead(signal);
      const previous = runtime.client.getQueryData<TodayStagesState>(key);
      return readTodayStages({
        teamId: teamId as string,
        signal,
        previousCards: previous?.cards ?? [],
        // The presence decision renders before the optional enrichment finishes.
        publish: (state: TodayStagesState) => {
          if (!signal.aborted) runtime.client.setQueryData(key, state);
        },
      }).then((state) => { runtime.assertCurrent(scope); return state; });
    },
  }, runtime.client);
  // No identity is not evidence of an empty day: the strip stays pending until the team is known.
  return query.data ?? PENDING;
}
