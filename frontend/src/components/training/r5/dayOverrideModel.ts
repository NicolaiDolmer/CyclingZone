// #8592 + #8819 · "Kun denne dag": ren model bag dagsvælgerens valg pr. dato (ingen React, så
// node --test kan køre den). Serveren er kilden: ugens svar har `dayOverrides` pr. dag og
// grænsens markering for i morgen, prognosen for i dag har `dateOverride.outcome`, og GET har
// `recent` (hvordan valgene gik). Dommer-scenarier: docs/audits/8592-kun-denne-dag-dommer-scenarier.md.
import type { WeekDay, WeekRiderFields } from "./dayPickerModel.ts";

export type DayOverride = { session: string; beatsRule?: boolean };
export type OverrideOutcome = "trained" | "race" | "bound_rest" | "injured" | "fatigue_rule" | "unavailable" | "unknown";
export type RuleMark = { kind: "fatigue" | "after_stage"; fallback: "light" | "recovery" | "rest" };
export type TodayOverride = DayOverride & { outcome?: OverrideOutcome; some?: boolean };
export type RecentOverride = { date: string; riderId: string; session: string; outcome: OverrideOutcome; some?: boolean; beatsRule?: boolean };
export const OVERRIDE_FIELDS = 5;

const OUTCOMES: readonly OverrideOutcome[] = ["trained", "race", "bound_rest", "injured", "fatigue_rule", "unavailable", "unknown"];

/** Datoens valg pr. rytter (tom uden kontakten eller uden valg). */
export function dayOverridesOf(day: WeekDay | null | undefined): Record<string, DayOverride> {
  return day?.dayOverrides ?? {};
}

export function hasDayOverrides(day: WeekDay | null | undefined): boolean {
  return Object.keys(dayOverridesOf(day)).length > 0;
}

/** DO-10: grænsens markering pr. rytter for datoen (kun i morgen har en; tom ellers). */
export function ruleMarksOf(day: WeekDay | null | undefined): Record<string, RuleMark> {
  return day?.fatigueRuleAhead ?? {};
}

/**
 * Hvor meget af valget et løb (eller en binding eller skade) tager på datoen (ejer punkt 4):
 * "all" = alle fem felter, "some" = nogle felter, null = intet.
 */
// "rest" = ingen løb, men hvile i alle felter (skade eller hviledag i et etapeløb), så teksten
// aldrig siger "løbet", når det ikke er et løb.
export function overrideReplaced(fields: WeekRiderFields | null | undefined): "all" | "some" | "rest" | null {
  const races = fields?.raceSlots ?? [];
  const taken = new Set([...races, ...(fields?.restSlots ?? [])]);
  if (taken.size === 0) return null;
  if (taken.size >= OVERRIDE_FIELDS) return races.length > 0 ? "all" : "rest";
  return "some";
}

/**
 * #8819 fund 1: linjens nøgle for det, der skete med valget. "trained" med beatsRule siger, at
 * valget gik forud for grænsen; "trained" uden siger intet ekstra (null). Ukendt = null.
 */
export function outcomeLineKey(entry: { outcome?: string | null; some?: boolean; beatsRule?: boolean } | null | undefined): string | null {
  const outcome = entry?.outcome;
  if (!outcome || !(OUTCOMES as readonly string[]).includes(outcome)) return null;
  if (outcome === "trained") return entry?.beatsRule ? "dayOverride.outcome.beatsRule" : null;
  return entry?.some ? `dayOverride.outcome.${outcome}Some` : `dayOverride.outcome.${outcome}`;
}

type ForecastRiders = Record<string, { dateOverride?: TodayOverride | null } | undefined> | null | undefined;

/** I dag (DO-12): holdets valg for i dag, i trupens rækkefølge. */
export function todayOverrides(riders: ForecastRiders, roster: ReadonlyArray<{ id: string }>): Array<{ riderId: string } & TodayOverride> {
  return roster.flatMap((r) => {
    const o = riders?.[r.id]?.dateOverride;
    return o?.session ? [{ riderId: r.id, ...o }] : [];
  });
}

/** Efter datoen (DO-12): de seneste valg grupperet pr. dato, nyeste først, kun holdets egne ryttere. */
export function recentByDate(recent: ReadonlyArray<RecentOverride> | null | undefined, roster: ReadonlyArray<{ id: string }>): Array<{ date: string; entries: RecentOverride[] }> {
  const own = new Set(roster.map((r) => r.id));
  const order = new Map(roster.map((r, i) => [r.id, i]));
  const byDate = new Map<string, RecentOverride[]>();
  for (const entry of recent ?? []) {
    if (!own.has(entry.riderId)) continue;
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date)!.push(entry);
  }
  return [...byDate].sort(([a], [b]) => b.localeCompare(a))
    .map(([date, entries]) => ({ date, entries: entries.sort((x, y) => (order.get(x.riderId) ?? 0) - (order.get(y.riderId) ?? 0)) }));
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
