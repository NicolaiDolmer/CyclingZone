/** Pure shared projection of recorded race events, with no engine tuning or IO. */
export type ParticipationEvent = { type: string; km?: number; params?: Record<string, unknown> | null };
export type RiderParticipation = { morning: boolean; caught: boolean; survived: boolean; laterAttack: boolean };
export type ParticipationHistory = { complete: boolean; morningRiderIds: ReadonlySet<string>; riders: ReadonlyMap<string, RiderParticipation> };

function riderIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

export function deriveParticipationHistory(events: readonly ParticipationEvent[] = [], initialRiderIds: readonly string[] = []): ParticipationHistory {
  const riders = new Map<string, RiderParticipation>();
  const morningRiderIds = new Set<string>();
  const groups = new Map<string, Set<string>>();
  if (initialRiderIds.length) groups.set("peloton-0", new Set(initialRiderIds));
  const entry = (id: string) => {
    let value = riders.get(id);
    if (!value) { value = { morning: false, caught: false, survived: false, laterAttack: false }; riders.set(id, value); }
    return value;
  };
  const catchMorning = (ids: Iterable<string>) => {
    for (const id of ids) if (morningRiderIds.has(id)) { const value = entry(id); value.caught = true; value.survived = false; }
  };
  let formationSeen = false;
  for (const event of events) {
    const p = event.params ?? {};
    const ids = riderIds(p.rider_ids);
    const groupId = typeof p.group_id === "string" ? p.group_id : null;
    if (event.type === "breakaway_formed" && !formationSeen) {
      formationSeen = true;
      for (const id of ids) { morningRiderIds.add(id); entry(id).morning = true; }
      if (groupId) groups.set(groupId, new Set(ids));
      const source = typeof p.source_group_id === "string" ? p.source_group_id : "peloton-0";
      for (const id of ids) groups.get(source)?.delete(id);
    } else if (event.type === "finale_attack" && p.kind !== "stage_decided") {
      const attackers = ids.length ? ids : typeof p.rider_id === "string" ? [p.rider_id] : [];
      for (const id of attackers) entry(id).laterAttack = true;
      if (groupId && attackers.length) {
        for (const members of groups.values()) for (const id of attackers) members.delete(id);
        groups.set(groupId, new Set(attackers));
      }
    } else if (event.type === "incident" && (p.outcome === "time_loss" || p.outcome === "abandoned") && typeof p.rider_id === "string") {
      for (const members of groups.values()) members.delete(p.rider_id);
    } else if (event.type === "peloton_splits") {
      const source = typeof p.source_group_id === "string" ? p.source_group_id : null;
      if (source) for (const id of ids) groups.get(source)?.delete(id);
      if (groupId) groups.set(groupId, new Set(ids));
    } else if (event.type === "group_merged" && groupId && typeof p.into_group_id === "string") {
      const target = groups.get(p.into_group_id) ?? new Set<string>();
      const incoming = ids.length ? ids : [...(groups.get(groupId) ?? [])];
      const combined = new Set([...target, ...incoming]);
      // Only actual known members can prove a reunion with non-escapees.
      if ([...combined].some((id) => !morningRiderIds.has(id))) catchMorning(combined);
      groups.delete(groupId);
      groups.set(p.into_group_id, combined);
    } else if (event.type === "breakaway_caught") {
      catchMorning(ids);
    } else if (event.type === "breakaway_survived") {
      for (const id of ids) if (morningRiderIds.has(id) && !entry(id).caught) entry(id).survived = true;
    }
  }
  const complete = events.some((event) => event.type === "stage_start") && events.some((event) => event.type === "finish");
  return { complete, morningRiderIds, riders };
}
