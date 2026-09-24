// #5631: My Teams gruppe-filter, Senior / U23 / Junior i stedet for
// Seniors / Academy (spillere i beta-forummet 24/9).
//
// Hvem der er U23 og hvem der er junior afgøres af SERVEREN (GET
// /api/youth-squads → effectiveSquad), aldrig af en alder i klienten (samme
// regel som trup-siderne, #5519). Er kontakten youth_squad_pages slukket, eller
// kan truppen ikke hentes, falder filteret tilbage til Seniors / Academy,
// præcis som før.
//
// Ren .ts uden React-import, så node --test kan loade den.
import { riderIdsForSquad } from "../../lib/youthSquadPages.ts";

export type SquadGroup = "senior" | "u23" | "junior" | "academy";

/** Rytter-id'er pr. ungdomstrup fra serveren, eller null = brug Seniors/Academy. */
export interface YouthSplit { u23: Set<string>; junior: Set<string> }

export function youthSplitFromPayload(payload: unknown): YouthSplit {
  return {
    u23: new Set(riderIdsForSquad(payload, "u23")),
    junior: new Set(riderIdsForSquad(payload, "junior")),
  };
}

export interface GroupRider { id: string; is_academy?: boolean | null }

/**
 * Rytterens gruppe. Seniorer er seniorer uanset alder (senior-truppen afgøres
 * af is_academy, squads.js). En akademirytter serveren ikke har placeret (fx
 * uden fødselsdato) står under U23, så han aldrig forsvinder fra listen.
 */
export function squadGroupOf(rider: GroupRider, split: YouthSplit | null): SquadGroup {
  if (!rider.is_academy) return "senior";
  if (!split) return "academy";
  return split.junior.has(rider.id) ? "junior" : "u23";
}

export function squadGroupsFor(split: YouthSplit | null): SquadGroup[] {
  return split ? ["senior", "u23", "junior"] : ["senior", "academy"];
}

export type GroupVisibility = Record<SquadGroup, boolean>;

export const ALL_GROUPS_VISIBLE: GroupVisibility = { senior: true, u23: true, junior: true, academy: true };

/** Tællere pr. gruppe for de ryttere filteret styrer. */
export function countSquadGroups(riders: GroupRider[], split: YouthSplit | null): Record<SquadGroup, number> {
  const counts: Record<SquadGroup, number> = { senior: 0, u23: 0, junior: 0, academy: 0 };
  for (const r of riders) counts[squadGroupOf(r, split)] += 1;
  return counts;
}

/**
 * Samme grundregel som det gamle filter (AcademySquadFilter, #1929/#5075): vis
 * kun kontrollen når der er ungdomsryttere at filtrere på, ELLER når en gruppe
 * med ryttere er skjult (ellers er der ingen vej tilbage uden en reload).
 */
export function shouldShowGroupFilter(
  counts: Record<SquadGroup, number>,
  visible: GroupVisibility,
  split: YouthSplit | null,
): boolean {
  const groups = squadGroupsFor(split);
  const youth = groups.filter((g) => g !== "senior").reduce((sum, g) => sum + counts[g], 0);
  if (youth > 0) return true;
  return groups.some((g) => counts[g] > 0 && !visible[g]);
}
