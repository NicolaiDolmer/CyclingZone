import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase.ts";
import { createRaceLibraryReader } from "../lib/race-library/queries.ts";
import type { LibraryScope, LibrarySeason, LibraryPool } from "../lib/race-library/types.ts";
export const raceLibraryReader = createRaceLibraryReader(supabase);
export type LibraryContext = Awaited<ReturnType<typeof raceLibraryReader.bootstrap>>;
export function useLibraryRequest<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>
) {
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  }, [load]);
  const cache = useRef(new Map<string, T>());
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string | null;
    data: T | null;
    error: unknown;
    loading: boolean;
  }>({ key: null, data: null, error: null, loading: false });
  useEffect(() => {
    if (key === null) return;
    const ac = new AbortController();
    const cached = cache.current.get(key);
    if (cached !== undefined) {
      setState({ key, data: cached, error: null, loading: false });
      return;
    }
    setState({ key, data: null, error: null, loading: true });
    loader
      .current(ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        cache.current.set(key, data);
        setState({ key, data, error: null, loading: false });
      })
      .catch((error) => {
        if (!ac.signal.aborted) setState({ key, data: null, error, loading: false });
      });
    return () => ac.abort();
  }, [key, revision]);
  const reload = useCallback(() => {
    cache.current.clear();
    setRevision((r) => r + 1);
  }, []);
  const current =
    state.key === key ? state : { key, data: null, error: null, loading: key !== null };
  return { ...current, reload };
}
export function useLibraryContext() {
  return useLibraryRequest<LibraryContext>("context", (signal) =>
    raceLibraryReader.bootstrap(signal)
  );
}
export function resolveLibraryScope(
  params: URLSearchParams,
  context: LibraryContext
): LibraryScope {
  const { seasons, pools, ownPoolId } = context;
  const seasonParam = params.get("season");
  const selected =
    seasonParam !== null
      ? seasons.find((s) => s.number === Number(seasonParam))
      : (seasons.find((s) => s.status === "active") ?? seasons[0]);
  if (!selected) throw new Error("Invalid library season scope");
  const own = pools.find((p) => p.id === ownPoolId);
  const division = params.get("division");
  const tier =
    division === null ? (own?.tier ?? null) : division === "all" ? null : Number(division);
  if (tier !== null && (!Number.isInteger(tier) || !pools.some((p) => p.tier === tier)))
    throw new Error("Invalid library division scope");
  const poolParam = params.get("pool");
  const poolId =
    poolParam === null
      ? tier === own?.tier
        ? ownPoolId
        : null
      : poolParam === "all"
        ? null
        : Number(poolParam);
  if (
    poolId !== null &&
    (!Number.isInteger(poolId) ||
      !pools.some((p) => p.id === poolId && (tier === null || p.tier === tier)))
  )
    throw new Error("Invalid library pool scope");
  return { seasonId: selected.id, tier, poolId, squad: "senior" };
}
export function useRaceLibrary(
  scope: LibraryScope | null,
  seasons: LibrarySeason[],
  pools: LibraryPool[],
  tab: "upcoming" | "history"
) {
  const key = scope ? JSON.stringify([scope, tab]) : null;
  return useLibraryRequest(key, (signal) =>
    raceLibraryReader.listRaceLibrary(scope!, seasons, pools, signal, tab)
  );
}
