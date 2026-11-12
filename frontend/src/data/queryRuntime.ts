import { QueryClient } from "@tanstack/react-query";

export interface DataScope {
  readonly generation: number;
  readonly viewerId: string | null;
  readonly teamId: string | null;
  readonly ready: boolean;
}
export function privateKey(scope: DataScope, resource: string, ...parameters: unknown[]) {
  return ["private", scope.generation, scope.viewerId, scope.teamId, resource, ...parameters] as const;
}
export function createDataRuntime() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 300_000, retry: false, refetchOnWindowFocus: true, refetchOnReconnect: "always" },
      mutations: { retry: false },
    },
  });
  let scope: DataScope = { generation: 0, viewerId: null, teamId: null, ready: false };
  let invalidation: { generation: number; viewerId: string | null; dirty: boolean; promise: Promise<void> } | null = null;
  let readRevision = 0;
  let activeWrites = 0;
  const writeWaiters = new Set<() => void>();
  const releaseReads = () => { for (const release of writeWaiters) release(); writeWaiters.clear(); };
  const listeners = new Set<() => void>();
  const publish = (next: DataScope) => {
    scope = next;
    for (const listener of listeners) listener();
  };
  const reset = (next: DataScope) => {
    invalidation = null;
    readRevision += 1;
    activeWrites = 0;
    releaseReads();
    void client.cancelQueries();
    client.clear();
    publish(next);
  };
  return {
    client,
    scope: () => scope,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setViewer(viewerId: string | null) {
      if (scope.ready && viewerId === scope.viewerId) return;
      const next = { generation: scope.generation + (scope.ready ? 1 : 0), viewerId, teamId: null, ready: true };
      if (scope.ready) reset(next); else publish(next);
    },
    setTeam(teamId: string | null) {
      if (teamId === scope.teamId) return;
      const next = { ...scope, teamId, generation: scope.generation + (scope.teamId ? 1 : 0) };
      if (scope.teamId) reset(next); else publish(next);
    },
    resync(captured: DataScope): Promise<void> {
      this.assertCurrent(captured);
      if (invalidation && invalidation.generation === captured.generation && invalidation.viewerId === captured.viewerId) {
        invalidation.dirty = true;
        return invalidation.promise;
      }
      const row = { generation: captured.generation, viewerId: captured.viewerId, dirty: false, promise: Promise.resolve() };
      invalidation = row;
      row.promise = client.invalidateQueries(
        { queryKey: ["private", captured.generation, captured.viewerId] },
        { cancelRefetch: false },
      ).finally(() => {
        if (invalidation !== row) return;
        invalidation = null;
        if (row.dirty && scope.generation === captured.generation && scope.viewerId === captured.viewerId) void this.resync(captured);
      });
      return row.promise;
    },
    async beforeRead(signal: AbortSignal) {
      if (signal.aborted) throw new DOMException("Read cancelled", "AbortError");
      if (activeWrites > 0) await new Promise<void>((resolve, reject) => {
        const release = () => { signal.removeEventListener("abort", abort); resolve(); };
        const abort = () => { writeWaiters.delete(release); reject(new DOMException("Read cancelled", "AbortError")); };
        writeWaiters.add(release);
        signal.addEventListener("abort", abort, { once: true });
      });
      if (signal.aborted) throw new DOMException("Read cancelled", "AbortError");
      return readRevision;
    },
    assertReadCurrent(captured: DataScope, revision: number) {
      this.assertCurrent(captured);
      if (revision !== readRevision || activeWrites > 0) throw new DOMException("Read superseded by write", "AbortError");
    },
    beginWrite(captured: DataScope) {
      this.assertCurrent(captured);
      readRevision += 1;
      activeWrites += 1;
      void client.cancelQueries({ queryKey: ["private", captured.generation, captured.viewerId] });
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        if (captured.generation !== scope.generation || captured.viewerId !== scope.viewerId) return;
        activeWrites = Math.max(0, activeWrites - 1);
        if (activeWrites === 0) releaseReads();
      };
    },
    assertCurrent(captured: DataScope) {
      if (captured.generation !== scope.generation || captured.viewerId !== scope.viewerId
        || (captured.teamId !== null && captured.teamId !== scope.teamId)) {
        throw new DOMException("Data scope changed", "AbortError");
      }
    },
  };
}
export type DataRuntime = ReturnType<typeof createDataRuntime>;
