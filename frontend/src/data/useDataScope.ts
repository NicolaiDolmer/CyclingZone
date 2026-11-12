import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase.ts";
import { createDataRuntime, type DataRuntime, type DataScope } from "./queryRuntime.ts";
import { DataError } from "./apiQuery.ts";
import { installTransferListingsQueryOwner } from "./transferListingsOwner.ts";

let browserRuntime: DataRuntime | undefined;
function appRuntime(): DataRuntime {
  if (typeof window === "undefined") return createDataRuntime();
  if (browserRuntime) return browserRuntime;
  const runtime = createDataRuntime();
  browserRuntime = runtime;
  runtime.client.mount();
  installTransferListingsQueryOwner(runtime, () => scopedHeaders(runtime, runtime.scope(), false));
  let authEvent = 0;
  supabase.auth.onAuthStateChange((_event, session) => {
    authEvent += 1;
    runtime.setViewer(session?.user?.id ?? null);
  });
  const initialEvent = authEvent;
  void supabase.auth.getSession().then(({ data }) => {
    if (initialEvent === authEvent) runtime.setViewer(data.session?.user?.id ?? null);
  });
  return runtime;
}
export function useDataScope() {
  const runtime = appRuntime();
  const scope = useSyncExternalStore(runtime.subscribe, runtime.scope, runtime.scope);
  const team = useQuery({
    queryKey: ["private", scope.generation, scope.viewerId, null, "team"],
    enabled: scope.ready && scope.viewerId !== null,
    queryFn: async ({ signal }) => {
      const revision = await runtime.beforeRead(signal);
      const { data, error } = await supabase.from("teams").select("*").eq("user_id", scope.viewerId!).abortSignal(signal).maybeSingle();
      if (error) throw error;
      runtime.assertReadCurrent(scope, revision);
      return data;
    },
  }, runtime.client);
  useEffect(() => {
    if (team.data !== undefined) runtime.setTeam(team.data?.id ?? null);
  }, [runtime, team.data]);
  return { runtime, scope, team: scope.teamId === team.data?.id ? team.data : null, ready: scope.ready && team.data !== undefined && scope.teamId === (team.data?.id ?? null), bootstrapLoading: !scope.ready || (scope.viewerId !== null && team.isPending), error: team.error };
}
export async function scopedHeaders(runtime: DataRuntime, captured: DataScope, json = true): Promise<Record<string, string>> {
  runtime.assertCurrent(captured);
  const { data } = await supabase.auth.getSession();
  runtime.assertCurrent(captured);
  const session = data.session;
  if (!session?.access_token || session.user.id !== captured.viewerId) throw new DataError("unauthorized", 401);
  return json ? { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" } : { Authorization: `Bearer ${session.access_token}` };
}
export function invalidateScope(runtime: DataRuntime, scope: DataScope) {
  runtime.assertCurrent(scope);
  return runtime.resync(scope);
}
