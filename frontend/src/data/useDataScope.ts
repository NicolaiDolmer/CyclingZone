import { useEffect, useSyncExternalStore } from "react";
import { useQuery, notifyManager } from "@tanstack/react-query";
import { supabase } from "../lib/supabase.ts";
import { createDataRuntime, frameScheduler, viewerKey, type DataRuntime, type DataScope } from "./queryRuntime.ts";
import { DataError } from "./apiQuery.ts";
import { installTransferListingsQueryOwner } from "./transferListingsOwner.ts";

// #6494: one lazily created browser runtime shared by every migrated page. It is only
// created when a migrated page renders, so the public landing/prerender graph never loads
// Query. On the server each call gets its own runtime, so private data is never shared.
let browserRuntime: DataRuntime | undefined;

export function appRuntime(): DataRuntime {
  if (typeof window === "undefined") return createDataRuntime();
  if (browserRuntime) return browserRuntime;
  const runtime = createDataRuntime();
  browserRuntime = runtime;
  // #6494: deliver observer updates once per frame. A page with many resources (the Dashboard
  // has ~25) otherwise re-renders once per answer as they land in separate ticks; measured on a
  // throttled mobile profile that doubled main-thread blocking. One pending flush coalesces
  // every batch; a timer backs up the frame so a hidden tab (no frames) keeps loading.
  if (typeof window.requestAnimationFrame === "function") notifyManager.setScheduler(frameScheduler());
  // Kept mounted for the app's lifetime so focus/reconnect refresh keeps working between pages.
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

/** Viewer/team scope for migrated pages. Renders inside DataProvider; the client is also
 * passed explicitly so a hook never silently binds to a different QueryClient. */
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
  }, runtime.client);
  useEffect(() => {
    if (team.data !== undefined) runtime.setTeam(team.data?.id ?? null);
  }, [runtime, team.data]);
  return {
    runtime,
    scope,
    team: team.data && scope.teamId === team.data.id ? team.data : null,
    ready: scope.ready && team.data !== undefined && scope.teamId === (team.data?.id ?? null),
    // Still loading until the scope carries the fetched team: between the team answer and the
    // setTeam effect `ready` is false, and a page must not read that frame as "settled, no data".
    bootstrapLoading: !scope.ready || (viewerId !== null && (team.isPending
      || (team.data !== undefined && scope.teamId !== (team.data?.id ?? null)))),
    error: team.error,
  };
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
