// trainingGroupsModel — ren logik bag traeningsgrupper (#6000). Ingen React,
// ingen fetch, saa node --test kan koere den uden en browser.

export type GroupMember = { riderId: string; followsGroup: boolean };
export type TrainingGroup = {
  id: string;
  name: string;
  days: Record<string, unknown> | null;
  isSeed: boolean;
  programKey: string | null;
  fatigue: { threshold: number | null; fallback: string } | null;
  members: GroupMember[];
};
export type PlanForSection = "groups" | "riders";
export type PlanForEntry = { value: string; label: string; section?: PlanForSection };
type ForecastEntryLike = { fatigue: number; band: string | null; raceSlots?: number[] };

// "Plan for"-vaelgerens vaerdi for en gruppe, og for "+ New group".
export const GROUP_PREFIX = "group:";
export const NEW_GROUP_VALUE = "group:new";

export function groupValue(id: string): string {
  return `${GROUP_PREFIX}${id}`;
}

export function isGroupValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(GROUP_PREFIX) && value !== NEW_GROUP_VALUE;
}

export function groupIdOf(value: string | null | undefined): string | null {
  return isGroupValue(value) ? (value as string).slice(GROUP_PREFIX.length) : null;
}

// Mockup pin 1: Hold, saa Groups (+ New group nederst), saa ryttere. Ingen ny
// fane, intet nyt kort: kun nye linjer i den vaelger der allerede findes.
export function planForWithGroups(
  options: readonly PlanForEntry[],
  groups: readonly TrainingGroup[],
  // followerLabel: rytterens linje naar han foelger en gruppe ("M. Rossi · Climbers"), ellers null.
  labels: { count: (n: number) => string; newGroup: string; followerLabel?: (riderId: string) => string | null },
): PlanForEntry[] {
  const [team, ...riders] = options;
  const groupEntries: PlanForEntry[] = groups.map((group) => ({
    value: groupValue(group.id),
    label: `${group.name} · ${labels.count(group.members.length)}`,
    section: "groups",
  }));
  return [
    ...(team ? [team] : []),
    ...groupEntries,
    { value: NEW_GROUP_VALUE, label: labels.newGroup, section: "groups" },
    ...riders.map((option) => ({
      ...option, label: labels.followerLabel?.(option.value) ?? option.label, section: "riders" as const,
    })),
  ];
}

// rider_id → gruppens navn (kun medlemmer der foelger gruppen).
export function groupNameByRider(groups: readonly TrainingGroup[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const group of groups) {
    for (const member of group.members) if (member.followsGroup) out.set(member.riderId, group.name);
  }
  return out;
}

// Mockup pin 2: "Fatigue tonight" for en gruppe = gruppens mest traette rytter.
export function groupForecastEntry(
  riders: Record<string, ForecastEntryLike> | null | undefined,
  memberIds: readonly string[],
): ForecastEntryLike | null {
  let top: ForecastEntryLike | null = null;
  for (const id of memberIds) {
    const entry = riders?.[id];
    if (entry && Number.isFinite(entry.fatigue) && (!top || entry.fatigue > top.fatigue)) top = entry;
  }
  return top;
}

// Regel A i gruppens gitter: et felt vises som "Stage" kun naar ALLE gruppens
// ryttere har en etape i det (ellers kan feltet stadig rettes for de andre;
// rytterne med etape beholder etapen).
export function groupLockedSlots(slotSets: ReadonlyArray<ReadonlySet<number>>): Set<number> {
  if (slotSets.length === 0) return new Set();
  const [first, ...rest] = slotSets;
  return new Set([...first].filter((slot) => rest.every((set) => set.has(slot))));
}

// Rytter-typer der findes i truppen, i foerste-forekomst-raekkefoelge (til "Start from").
export function riderTypesInSquad(riders: ReadonlyArray<{ type: string | null }>): string[] {
  const seen: string[] = [];
  for (const rider of riders) if (rider.type && !seen.includes(rider.type)) seen.push(rider.type);
  return seen;
}
