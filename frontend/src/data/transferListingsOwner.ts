import type { DataRuntime } from "./queryRuntime.ts";
import { privateKey } from "./queryRuntime.ts";
import { rows } from "./apiQuery.ts";
import { installTransferListingsOwner, transferListingsKeyForHeaders2176, SHARED_TTL_MS } from "../lib/sharedRequestCache.js";

/** Existing profile readers delegate to Query after the first migrated page loads. */
export function installTransferListingsQueryOwner(runtime: DataRuntime, headers: () => Promise<Record<string, string>>) {
  return installTransferListingsOwner({
    async get(key: string, loader: () => unknown) {
      const captured = runtime.scope();
      if (!captured.viewerId || !captured.teamId) return loader();
      const expected = await transferListingsKeyForHeaders2176(await headers());
      runtime.assertCurrent(captured);
      // An old request may still finish for its original caller, but never warms another viewer's cache.
      if (expected !== key) return loader();
      return runtime.client.fetchQuery({
        queryKey: privateKey(captured, "transfer-listings"),
        staleTime: SHARED_TTL_MS.transferListings,
        queryFn: async ({ signal }) => {
          const revision = await runtime.beforeRead(signal);
          const value = rows(await loader());
          runtime.assertReadCurrent(captured, revision);
          return value;
        },
      });
    },
    invalidate() {
      void runtime.client.cancelQueries({ predicate: query => query.queryKey[4] === "transfer-listings" });
      void runtime.client.invalidateQueries({ predicate: query => query.queryKey[4] === "transfer-listings", refetchType: "none" });
    },
    clear() {
      void runtime.client.cancelQueries({ predicate: query => query.queryKey[4] === "transfer-listings" });
      runtime.client.removeQueries({ predicate: query => query.queryKey[4] === "transfer-listings" });
    },
  });
}
