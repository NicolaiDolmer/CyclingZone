/** Pure shared projection of recorded race events, with no engine tuning or IO. */
export type ParticipationEvent = { type: string; km?: number; params?: Record<string, unknown> | null };
/**
 * #6185: a morning escapee ends in ONE of three states: caught, dropped from
 * the break (left it behind before the line without being caught), or held on
 * to the finish (survived). `dropped` is its own state, never a variant of the
 * other two.
 * `swallowed`: after leaving the break, the rider was merged with non-escapees
 * (the bunch or a chase with non-escapees in it). It only matters for a
 * dropped rider; see settleBreakawayOutcome.
 */
export type RiderParticipation = { morning: boolean; caught: boolean; survived: boolean; dropped: boolean; swallowed: boolean; laterAttack: boolean };
export type ParticipationHistory = { complete: boolean; morningRiderIds: ReadonlySet<string>; riders: ReadonlyMap<string, RiderParticipation> };
export type BreakawayOutcome = "caught" | "dropped" | "survived";

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
    if (!value) { value = { morning: false, caught: false, survived: false, dropped: false, swallowed: false, laterAttack: false }; riders.set(id, value); }
    return value;
  };
  // A dropped rider keeps that state when a merge sweeps him up: being
  // swallowed by the bunch afterwards is the consequence of the drop, not a
  // catch of the break. The merge is recorded as `swallowed`, which makes the
  // drop final (settleBreakawayOutcome). An explicit `breakaway_caught` that
  // names him is different: the engine lists the members of the break group at
  // the catch, so he was back in the break when it was caught.
  const catchMorning = (ids: Iterable<string>, explicit = false) => {
    for (const id of ids) if (morningRiderIds.has(id)) {
      const value = entry(id);
      if (value.dropped && !explicit) { value.swallowed = true; continue; }
      value.caught = true; value.survived = false; value.dropped = false; value.swallowed = false;
    }
  };
  // #6185 review: a dropped escapee who merges into a group that still holds
  // an active morning escapee (and nobody else) is back in the break.
  // engine/v4 does this: mergeGroupsDetailed folds a split behind the break
  // back into it when the gap closes, sometimes in the same segment.
  const rejoinBreak = (combined: ReadonlySet<string>) => {
    const active = [...combined].some((id) => { const value = riders.get(id); return !!value?.morning && !value.dropped && !value.caught; });
    if (!active) return;
    for (const id of combined) { const value = riders.get(id); if (value?.morning && value.dropped && !value.caught) { value.dropped = false; value.swallowed = false; } }
  };
  // #6185: leaving the break (a split in either direction, lost time, or the
  // engine's own future `breakaway_dropped` event) before any catch. The engine
  // names only the group of kind `breakaway` in its survived/caught verdicts,
  // so a piece that rode AWAY from the break is marked dropped here too; the
  // finish settles it (settleBreakawayOutcome: never swallowed and no
  // non-escapee ahead at the line = held home).
  const dropMorning = (ids: Iterable<string>) => {
    for (const id of ids) if (morningRiderIds.has(id)) { const value = entry(id); if (value.caught || value.survived) continue; value.dropped = true; }
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
      if (p.outcome === "time_loss") dropMorning([p.rider_id]);
    } else if (event.type === "peloton_splits") {
      const source = typeof p.source_group_id === "string" ? p.source_group_id : null;
      if (source) for (const id of ids) groups.get(source)?.delete(id);
      if (groupId) groups.set(groupId, new Set(ids));
      // A split takes the named riders out of their source group, ahead of it
      // or behind it (the event does not say which).
      dropMorning(ids);
    } else if (event.type === "breakaway_dropped") {
      // #6185 part 2 (engine, later): an explicit drop event wins when present.
      dropMorning(ids);
    } else if (event.type === "group_merged" && groupId && typeof p.into_group_id === "string") {
      const target = groups.get(p.into_group_id) ?? new Set<string>();
      const incoming = ids.length ? ids : [...(groups.get(groupId) ?? [])];
      const combined = new Set([...target, ...incoming]);
      // Only actual known members can prove a reunion with non-escapees.
      if ([...combined].some((id) => !morningRiderIds.has(id))) catchMorning(combined);
      else rejoinBreak(combined);
      groups.delete(groupId);
      groups.set(p.into_group_id, combined);
    } else if (event.type === "breakaway_caught") {
      catchMorning(ids, true);
    } else if (event.type === "breakaway_survived") {
      // The engine's verdict at the line: the riders it names were in the
      // group of kind `breakaway` at the finish, so they held on, even after
      // an earlier split. Riders it does not name are settled at the finish.
      for (const id of ids) if (morningRiderIds.has(id) && !entry(id).caught) { const value = entry(id); value.survived = true; value.dropped = false; value.swallowed = false; }
    }
  }
  const complete = events.some((event) => event.type === "stage_start") && events.some((event) => event.type === "finish");
  return { complete, morningRiderIds, riders };
}

/**
 * #6185: final state of one escapee, with the finish-line safety net.
 * `nonEscapeeAhead`: true = at least one non-escapee finished ahead of the
 * rider, false = none did, null = not known.
 * - A rider who left the break (dropped) is "dropped" once he was swallowed by
 *   non-escapees or a non-escapee finished ahead of him. Never swallowed and
 *   nobody but escapees ahead at the line (false) = he rode away from the
 *   break or stayed clear of the bunch: "survived". Unknown finish order
 *   (null) keeps the drop.
 * - Any other escapee with a non-escapee ahead can never have held on:
 *   recorded as "survived" means someone came across (caught), recorded as
 *   nothing means they fell behind the break (dropped).
 * Returns null for non-escapees and for escapees whose outcome is unknown.
 */
export function settleBreakawayOutcome(
  participation: (Pick<RiderParticipation, "morning" | "caught" | "survived" | "dropped"> & { swallowed?: boolean }) | null | undefined,
  nonEscapeeAhead: boolean | null = null,
): BreakawayOutcome | null {
  if (!participation?.morning) return null;
  if (participation.caught) return "caught";
  if (participation.dropped) return !participation.swallowed && nonEscapeeAhead === false ? "survived" : "dropped";
  if (nonEscapeeAhead === true) return participation.survived ? "caught" : "dropped";
  return participation.survived ? "survived" : null;
}

/**
 * #6185: per finisher, did a non-escapee (not in the morning break of
 * `history`) finish ahead of them? The ONE definition used by the stored-row
 * backfill and the race page, so both settle with the same escapee set as the
 * engine run (raceSimulator.deriveBreakawayStatus ranks on the same set).
 */
export function nonEscapeeAheadByRider(history: Pick<ParticipationHistory, "morningRiderIds">, rows: readonly { rider_id?: string | null; rank?: number | null }[]): Map<string, boolean> {
  const finishers = rows.filter((row): row is { rider_id: string; rank: number } => typeof row.rider_id === "string" && typeof row.rank === "number");
  const best = bestNonEscapeeRank(finishers.map((row) => ({ rank: row.rank, escapee: history.morningRiderIds.has(row.rider_id) })));
  return new Map(finishers.map((row) => [row.rider_id, row.rank > best]));
}

/** Best rank among non-escapees (Infinity when every finisher was an escapee). */
export function bestNonEscapeeRank(rows: readonly { rank?: number | null; escapee: boolean }[]): number {
  let best = Infinity;
  for (const row of rows) if (!row.escapee && typeof row.rank === "number" && row.rank < best) best = row.rank;
  return best;
}

/**
 * Persisted race_results flags for one outcome. `breakaway_caught` stays a
 * NOT NULL compatibility flag; `breakaway_dropped` carries the third state and
 * keeps null for "not known" instead of forcing false.
 */
export function breakawayFlagsForOutcome(inBreakaway: boolean, outcome: BreakawayOutcome | null): { in_breakaway: boolean; breakaway_caught: boolean; breakaway_dropped: boolean | null } {
  if (!inBreakaway) return { in_breakaway: false, breakaway_caught: false, breakaway_dropped: false };
  return { in_breakaway: true, breakaway_caught: outcome === "caught", breakaway_dropped: outcome === "dropped" ? true : outcome ? false : null };
}
