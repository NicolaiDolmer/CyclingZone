import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase.ts";
import { createDataRuntime, viewerKey, type DataRuntime } from "./queryRuntime.ts";

// #6494: one lazily created browser runtime shared by every migrated page. It is only
// created when a migrated page renders, so the public landing/prerender graph never loads
// Query. On the server each call gets its own runtime, so private data is never shared.
let browserRuntime: DataRuntime | undefined;
export function appRuntime(): DataRuntime {
  if (typeof window === "undefined") return createDataRuntime();
  if (browserRuntime) return browserRuntime;
  const runtime = createDataRuntime();
  browserRuntime = runtime;
  // Kept mounted for the app's lifetime so focus/reconnect refresh keeps working between pages.
  runtime.client.mount();
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

/** Viewer/team scope for migrated pages. Must render inside DataProvider. */
export function useDataScope() {
  const runtime = appRuntime();
  const scope = useSyncExternalStore(runtime.subscribe, runtime.scope, runtime.scope);
  const viewerId = scope.viewerId;
  const team = useQuery({
    queryKey: viewerKey(scope, "team"),
    enabled: scope.ready && viewerId !== null,
    queryFn: async ({ signal }) => {
      const revision = await runtime.beforeRead(signal);
      const { data, error } = await supabase.from("teams").select("*").eq("user_id", viewerId ?? "").abortSignal(signal).maybeSingle();
      if (error) throw error;
      runtime.assertReadCurrent(scope, revision);
      return data;
    },
  });
  useEffect(() => {
    if (team.data !== undefined) runtime.setTeam(team.data?.id ?? null);
  }, [runtime, team.data]);
  return {
    runtime,
    scope,
    team: team.data && scope.teamId === team.data.id ? team.data : null,
    ready: scope.ready && team.data !== undefined && scope.teamId === (team.data?.id ?? null),
    bootstrapLoading: !scope.ready || (viewerId !== null && team.isPending),
    error: team.error,
  };
}
