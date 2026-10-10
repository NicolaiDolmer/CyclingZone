// assistantProgramSuggestions.ts — ren logik bag programsektionen i "Get
// suggestions from the assistant"-panelet (#4522, rest: "Sprinter-program til
// disse 4").
//
// Forslaget: grupper ryttere efter primary_type, find det katalogprogram der er
// lavet til typen (targetTypes), og foreslaa det til de ryttere der kan faa det.
// "Kan faa det" = ingen egen ugeplan-raekke og foelger ikke en traeningsgruppe
// (#6000). Serveren haandhaever det samme (POST /api/training/programs/apply med
// riderIds + keepOwn), saa et forslag aldrig overskriver en egen plan.
//
// Ingen DB, ingen React, ingen Date: unit-testes isoleret med node --test.

import type { CatalogProgram } from "./trainingPrograms.ts";

export type ProgramSuggestionRider = {
  id: string;
  firstname?: string | null;
  lastname?: string | null;
  primary_type?: string | null;
};

export type ProgramSuggestionGroup = {
  riderType: string;
  programKey: string;
  riderIds: string[];
  names: string[];
};

// Programmet til en rytter-type: et program lavet KUN til typen foer et der
// deler den med en anden (fx classics for brostensrytter/puncheur), i katalogets
// egen raekkefoelge. Programmer uden type (audience) foreslaas aldrig.
export function programForRiderType(
  catalog: readonly CatalogProgram[] | null | undefined,
  riderType: string | null | undefined,
): CatalogProgram | null {
  if (!riderType) return null;
  const list = catalog ?? [];
  return list.find((p) => p.targetTypes.length === 1 && p.targetTypes[0] === riderType)
    ?? list.find((p) => p.targetTypes.includes(riderType))
    ?? null;
}

// Ryttere som forslaget maa tilbyde: hverken egen ugeplan-raekke (`ownPlanIds`)
// eller gruppefoelger (`groupFollowerIds`).
export function buildProgramSuggestionGroups({
  riders, catalog, ownPlanIds, groupFollowerIds,
}: {
  riders: readonly ProgramSuggestionRider[] | null | undefined;
  catalog: readonly CatalogProgram[] | null | undefined;
  ownPlanIds?: ReadonlySet<string> | null;
  groupFollowerIds?: ReadonlySet<string> | null;
}): ProgramSuggestionGroup[] {
  const byType = new Map<string, ProgramSuggestionGroup>();
  for (const rider of riders ?? []) {
    const riderType = rider.primary_type;
    if (!riderType || ownPlanIds?.has(rider.id) || groupFollowerIds?.has(rider.id)) continue;
    const program = programForRiderType(catalog, riderType);
    if (!program) continue;
    let group = byType.get(riderType);
    if (!group) {
      group = { riderType, programKey: program.key, riderIds: [], names: [] };
      byType.set(riderType, group);
    }
    group.riderIds.push(rider.id);
    group.names.push(`${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim());
  }
  // Stoerste gruppe foerst; ved lighed den foerst sete type (Map bevarer raekkefoelgen).
  return [...byType.values()].sort((a, b) => b.riderIds.length - a.riderIds.length);
}

// De id'er et klik maa sende: gruppens ryttere minus dem der har faaet en egen
// plan siden forslaget blev bygget (fx i en anden fane).
export function acceptableGroupRiderIds(
  group: Pick<ProgramSuggestionGroup, "riderIds">,
  ownPlanIds?: ReadonlySet<string> | null,
  groupFollowerIds?: ReadonlySet<string> | null,
): string[] {
  return group.riderIds.filter((id) => !ownPlanIds?.has(id) && !groupFollowerIds?.has(id));
}
