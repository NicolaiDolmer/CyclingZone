import type { Query } from "@tanstack/react-query";
import type { DataScope } from "./queryRuntime.ts";

// #6494: pure cache policy for the Dashboard, kept free of Supabase so it is testable with a
// real QueryClient.

/** Resources the Dashboard's live channel (seasons/races) refreshes: the set the legacy loadAll
 * re-read, directly or through its dependent effects. The push modules, cards and today's
 * strip keep their own freshness. */
export const LIVE_RESOURCES: ReadonlySet<string> = new Set([
  "team", "dashboard:season", "dashboard:core", "dashboard:auctions", "transfer-offers",
  "dashboard:team-race-entries", "dashboard:forecast", "dashboard:discord", "dashboard:onboarding", "dashboard:signup",
  // Derived reads the legacy effects re-ran: a finished stage moves the countdown to the next
  // stage, and an auto-filled squad clears the selection nudge.
  "dashboard:next-stage", "dashboard:squad-selection",
]);

/** keepPreviousData, but only inside the same auth generation, viewer and team: a parameter
 * change (season, race ids) keeps the known value until the new read lands (no skeleton
 * flash), while a scope change never shows another viewer's or team's data. */
export function sameScopePlaceholder(scope: DataScope) {
  return <T,>(previous: T | undefined, previousQuery: Pick<Query, "queryKey"> | undefined): T | undefined => {
    const key = previousQuery?.queryKey;
    return key && key[1] === scope.generation && key[2] === scope.viewerId && key[3] === scope.teamId ? previous : undefined;
  };
}

export function inScope(query: Pick<Query, "queryKey">, scope: DataScope) {
  const key = query.queryKey;
  return key[0] === "private" && key[1] === scope.generation && key[2] === scope.viewerId;
}

export function isScopeResource(query: Pick<Query, "queryKey">, scope: DataScope, resources: ReadonlySet<string>) {
  return inScope(query, scope) && resources.has(String(query.queryKey[4]));
}

/** After a write: refetch the scope's reads the write barrier cancelled before they had data. */
export function cancelledWithoutData(query: Pick<Query, "queryKey" | "state">, scope: DataScope) {
  return inScope(query, scope) && query.state.data === undefined;
}

/** A list module: null while unknown (skeleton), [] once confirmed empty or failed with nothing
 * known, otherwise the known rows (also after a failed refresh). */
export function settledList<T>(query: { data?: T[]; isError: boolean }, empty: T[]): T[] | null {
  return query.data ?? (query.isError ? empty : null);
}
