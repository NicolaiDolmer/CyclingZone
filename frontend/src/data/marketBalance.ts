import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase.ts";
import { computeAvailableBalance, fetchReservedBalance } from "../lib/availableBalance.js";
import { privateKey, viewerKey } from "./queryRuntime.ts";
import { appRuntime, useDataScope } from "./useDataScope.ts";

const RESERVATION = "market:reserved-balance";

export function useMarketBalance() {
  const { runtime, scope, team, ready } = useDataScope();
  const teamId = team?.id;
  const { data: reserved } = useQuery({
    queryKey: privateKey(scope, RESERVATION),
    enabled: ready && Boolean(teamId),
    async queryFn({ signal }) {
      if (!teamId) throw new Error("Market balance has no team");
      const revision = await runtime.beforeRead(signal);
      const result = await fetchReservedBalance(supabase, teamId, signal);
      runtime.assertReadCurrent(scope, revision);
      return result;
    },
  }, runtime.client);
  if (team?.balance == null || reserved == null) return null;
  return { available: computeAvailableBalance(team.balance, reserved), reserved };
}

export function refreshMarketBalance(): void {
  const runtime = appRuntime();
  const scope = runtime.scope();
  if (!scope.ready || scope.viewerId == null) return;
  void runtime.client.invalidateQueries({ queryKey: viewerKey(scope, "team"), exact: true });
  void runtime.client.invalidateQueries({ queryKey: privateKey(scope, RESERVATION), exact: true });
}
