// #6035 (ejer-loefte 1/10): Program-fanen vendt, saa man FOERST vaelger rytter
// eller gruppe og DEREFTER programmet. Ren logik til TrainingProgramAssign.
//
// - Ingen valgt modtager ved indlaesning: hele truppen er et destruktivt valg
//   (erstatter alles ugeplan), saa det skal vaelges aktivt.
// - En rytter med type faar programmerne der passer til hans type oeverst, i
//   egen sektion; resten staar under "Other programs".
import type { CatalogProgram } from "../../../lib/trainingPrograms.ts";

export type AssignRider = { id: string; name: string; type: string | null };
export type AssignTarget =
  | { kind: "none" }
  | { kind: "squad" }
  | { kind: "group"; value: string }
  | { kind: "rider"; rider: AssignRider };

export function resolveTarget(
  value: string,
  riders: readonly AssignRider[],
  groups: ReadonlyArray<{ value: string }>,
): AssignTarget {
  if (value === "squad") return { kind: "squad" };
  if (groups.some((g) => g.value === value)) return { kind: "group", value };
  const rider = riders.find((r) => r.id === value);
  return rider ? { kind: "rider", rider } : { kind: "none" };
}

export function sectionsForTarget(
  catalog: readonly CatalogProgram[],
  target: AssignTarget,
): { fits: CatalogProgram[]; others: CatalogProgram[] } {
  const list = [...(catalog ?? [])];
  const type = target.kind === "rider" ? target.rider.type : null;
  if (!type) return { fits: [], others: list };
  return {
    fits: list.filter((p) => p.targetTypes.includes(type)),
    others: list.filter((p) => !p.targetTypes.includes(type)),
  };
}

// Det program rytteren staar paa nu (fra GET /api/training/programs `assigned`).
export function currentProgramKey(
  target: AssignTarget,
  assigned: Record<string, string> | null | undefined,
): string | null {
  if (target.kind !== "rider" || !assigned) return null;
  return assigned[target.rider.id] ?? null;
}
