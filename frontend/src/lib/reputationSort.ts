import { riderReputationValue, type RiderReputationLike } from "./riderReputationView.ts";

export function compareDisplayedReputation(a: RiderReputationLike, b: RiderReputationLike, ascending: boolean): number {
  const av = riderReputationValue(a, true);
  const bv = riderReputationValue(b, true);
  if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
  return ascending ? av - bv : bv - av;
}

export function mergeReputationSortedIds(rows: (RiderReputationLike & { id: string })[], ascending = false): string[] {
  return [...rows].sort((a,b) => compareDisplayedReputation(a,b,ascending)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(r => r.id);
}

export function reputationSortKey(sort: string, enabled: boolean): string {
  return sort === "popularity" || sort === "reputation" ? (enabled ? "reputation" : "popularity") : sort;
}
