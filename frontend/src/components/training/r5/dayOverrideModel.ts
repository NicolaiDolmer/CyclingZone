// #8592 · "Kun denne dag": ren model bag dagsvælgerens valg pr. dato (ingen React, så node --test
// kan køre den). Serveren er kilden: ugens svar har `dayOverrides` pr. dag, og motoren bruger
// samme forrang (løb, binding og skade vinder altid). Dommer-scenarier: docs/audits/8592-kun-denne-dag-dommer-scenarier.md.
import type { WeekDay, WeekRiderFields } from "./dayPickerModel.ts";

export type DayOverride = { session: string };
export const OVERRIDE_FIELDS = 5;

/** Datoens valg pr. rytter (tom uden kontakten eller uden valg). */
export function dayOverridesOf(day: WeekDay | null | undefined): Record<string, DayOverride> {
  return day?.dayOverrides ?? {};
}

export function hasDayOverrides(day: WeekDay | null | undefined): boolean {
  return Object.keys(dayOverridesOf(day)).length > 0;
}

/**
 * Hvor meget af valget et løb (eller en binding eller skade) tager på datoen (ejer punkt 4):
 * "all" = alle fem felter, "some" = nogle felter, null = intet.
 */
export function overrideReplaced(fields: WeekRiderFields | null | undefined): "all" | "some" | null {
  const taken = new Set([...(fields?.raceSlots ?? []), ...(fields?.restSlots ?? [])]);
  if (taken.size === 0) return null;
  return taken.size >= OVERRIDE_FIELDS ? "all" : "some";
}

/** Rytterne i de valgte grupper plus de enkeltvalgte, uden dubletter og kun holdets egne. */
export function selectedRiderIds({
  riderIds, groupIds, groups, roster,
}: {
  riderIds: Iterable<string>;
  groupIds: Iterable<string>;
  groups: ReadonlyArray<{ id: string; members: ReadonlyArray<{ riderId: string }> }>;
  roster: ReadonlyArray<{ id: string }>;
}): string[] {
  const own = new Set(roster.map((r) => r.id));
  const out = new Set<string>();
  const chosenGroups = new Set(groupIds);
  for (const group of groups) if (chosenGroups.has(group.id)) for (const m of group.members) out.add(m.riderId);
  for (const id of riderIds) out.add(id);
  return roster.map((r) => r.id).filter((id) => out.has(id) && own.has(id));
}

/** Pas-listen i dialogen: hele dage først, så færdighed, så træning efter niveau. */
export function overrideSessionGroups({
  skill, byLevel,
}: {
  skill: readonly string[];
  byLevel: Record<string, readonly string[]>;
}): Array<{ key: string; sessions: string[] }> {
  return [
    { key: "wholeDay", sessions: ["rest", "recovery"] },
    { key: "skill", sessions: [...skill] },
    ...Object.entries(byLevel).map(([level, sessions]) => ({ key: level, sessions: [...sessions] })),
  ];
}
