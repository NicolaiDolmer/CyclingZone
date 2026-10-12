// Scope-logik for "Set today's day for ..." paa Today-fanen (#6523).
//
// Intet markeret => linjen rammer ALLE ryttere i den nuvaerende visning (filtrets
// ryttere, aldrig dem et filter skjuler). Noget markeret => kun de markerede.
// Samme filter-regel som pruneSelection, saa linjen aldrig kan skifte dag for
// en rytter spilleren ikke kan se.

import { pruneSelection } from "./trainingOverview.ts";

export type BulkScope = { kind: "selected" | "all"; ids: string[] };

export function resolveBulkScope(
  selected: ReadonlySet<string>,
  filterIds: ReadonlySet<string> | null,
  selectableIds: readonly string[],
): BulkScope {
  const picked = pruneSelection(selected, filterIds);
  if (picked.size > 0) return { kind: "selected", ids: [...picked] };
  return { kind: "all", ids: [...selectableIds] };
}

// Gruppens ryttere som id-liste, begraenset til dem der er valgbare (i visningen).
export function groupBulkIds(
  groupRiderIds: readonly string[],
  selectableIds: readonly string[],
): string[] {
  const ok = new Set(selectableIds);
  return groupRiderIds.filter((id) => ok.has(id));
}
