import type { RaceGroup } from "../types.ts";

/** A pursuing group must be physically behind the group it is chasing. */
export function findChaseGroup(groups: readonly RaceGroup[], target: RaceGroup): RaceGroup | null {
  const candidates = groups.filter((group) => group.id !== target.id && group.kind !== "breakaway" && group.rider_ids.length > 0 && group.gap_seconds >= target.gap_seconds);
  candidates.sort((a, b) => a.gap_seconds - b.gap_seconds || b.rider_ids.length - a.rider_ids.length || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}
