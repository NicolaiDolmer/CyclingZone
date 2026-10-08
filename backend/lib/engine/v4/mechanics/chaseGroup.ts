import type { RaceGroup, SegmentHookResult, TimelineEvent } from "../types.ts";

/** A pursuing group must be physically behind the group it is chasing. */
export function findChaseGroup(groups: readonly RaceGroup[], target: RaceGroup): RaceGroup | null {
  const candidates = groups.filter((group) => group.id !== target.id && group.kind !== "breakaway" && group.rider_ids.length > 0 && group.gap_seconds >= target.gap_seconds);
  candidates.sort((a, b) => a.gap_seconds - b.gap_seconds || b.rider_ids.length - a.rider_ids.length || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/**
 * #6234 (KUN orders_gc_v3): et stykke af dagens udbrud (oprindelse "breakaway")
 * der ikke selv er udbrudsgruppen. Gruppen rummer kun udbrydere: en
 * sammenlaegning med ikke-udbrydere giver den anden parts oprindelse
 * (groups.ts's mergedOrigin). Naar et saadant stykke lukker hullet til
 * udbruddet, er udbruddet ikke hentet: stykket er kommet tilbage.
 */
export function isBreakawayPiece(group: Pick<RaceGroup, "kind" | "origin">): boolean {
  return group.origin === "breakaway" && group.kind !== "breakaway";
}

/**
 * #6199 (KUN official_times_v2): a "catch" where both sides are only riders of
 * the day's breakaway is a regroup inside the break, not the breakaway being
 * caught. A dropped escapee (or a group of them that lost the breakaway origin
 * through an earlier merge) closing back up to his own break must never read
 * "the breakaway was caught" in the film. `groups` is the group picture at the
 * moment the event was reported (the catcher still separate, or already joined:
 * the catcher's riders are its group minus the caught riders either way).
 * The physical merge itself is unchanged; only the event is not a catch.
 */
export function isMorningRegroupCatch(event: TimelineEvent, groups: readonly RaceGroup[], morningRiderIds: ReadonlySet<string>): boolean {
  if (event.type !== "breakaway_caught" || morningRiderIds.size === 0) return false;
  const caught = Array.isArray(event.params.rider_ids) ? event.params.rider_ids.filter((id): id is string => typeof id === "string") : [];
  const chaseId = event.params.chase_group_id;
  if (caught.length === 0 || typeof chaseId !== "string") return false;
  const chase = groups.find((group) => group.id === chaseId);
  if (!chase) return false;
  const caughtSet = new Set(caught);
  const catchers = chase.rider_ids.filter((id) => !caughtSet.has(id));
  return catchers.length > 0 && catchers.every((id) => morningRiderIds.has(id)) && caught.every((id) => morningRiderIds.has(id));
}

/**
 * #6234 (KUN orders_gc_v3): stykket smelter ind i udbruddet, som beholder id,
 * art og hul (samme konvention som den almindelige merge: den forreste gruppe
 * beholder id og gap). Udbruddet forbliver dermed et udbrud, ogsaa naar stykket
 * er stoerre end resten. Returnerer `groups` uaendret, hvis en af dem mangler.
 */
export function rejoinBreakawayPiece(groups: readonly RaceGroup[], pieceId: string, breakawayId: string): RaceGroup[] {
  const piece = groups.find((group) => group.id === pieceId);
  const breakaway = groups.find((group) => group.id === breakawayId);
  if (!piece || !breakaway || piece === breakaway) return [...groups];
  return groups
    .filter((group) => group.id !== pieceId)
    .map((group) => group.id === breakawayId
      ? { ...group, rider_ids: [...group.rider_ids, ...piece.rider_ids], cohesion: Math.min(group.cohesion, piece.cohesion) }
      : group);
}

/**
 * #6185 del 2 (KUN orders_gc_v3): motoren melder selv "sat af fra udbruddet".
 *
 * En udbryder er sat af, naar han koerer i et stykke af udbruddet
 * (isBreakawayPiece) der ligger BAG udbrudsgruppen. Et stykke foran (et angreb
 * ud af udbruddet) er ikke sat af. `known` er de ryttere der allerede er meldt;
 * en rytter der er tilbage i udbrudsgruppen, slettes fra listen og kan meldes
 * igen, hvis han saettes af paa ny. `silent` er ryttere der tilfoejes listen uden
 * en melding (et uheldsoffer: uheldets egen linje fortaeller hvor det skete).
 *
 * Ét event pr. stykke: { group_id: stykket, from_group_id: udbruddet, rider_ids }.
 * Ingen tal (fog-gate, #1791). Uden en udbrudsgruppe (hentet eller aldrig dannet)
 * meldes intet. REN: input muteres aldrig.
 */
export function breakawayDropEvents(
  groups: readonly RaceGroup[],
  known: readonly string[],
  km: number,
  silent: (riderId: string) => boolean = () => false,
): { events: TimelineEvent[]; dropped: string[] } {
  const breaks = groups.filter((group) => group.kind === "breakaway" && group.origin === "breakaway" && group.rider_ids.length > 0)
    .sort((a, b) => a.gap_seconds - b.gap_seconds || a.id.localeCompare(b.id));
  const inBreak = new Set(breaks.flatMap((group) => group.rider_ids));
  const dropped = new Set(known.filter((id) => !inBreak.has(id)));
  const events: TimelineEvent[] = [];
  const lead = breaks[0];
  if (lead) {
    const pieces = groups.filter((group) => isBreakawayPiece(group) && group.gap_seconds > lead.gap_seconds)
      .sort((a, b) => a.gap_seconds - b.gap_seconds || a.id.localeCompare(b.id));
    for (const piece of pieces) {
      const fresh = piece.rider_ids.filter((id) => !dropped.has(id));
      for (const id of fresh) dropped.add(id);
      const named = fresh.filter((id) => !silent(id)).sort((a, b) => a.localeCompare(b));
      if (named.length > 0) events.push({ km, type: "breakaway_dropped", params: { group_id: piece.id, from_group_id: lead.id, rider_ids: named } });
    }
  }
  return { events, dropped: [...dropped].sort((a, b) => a.localeCompare(b)) };
}

/**
 * #6185 del 2 (KUN orders_gc_v3): M5-hookets resultat plus meldingerne om
 * afsatte udbrydere, maalt paa grupperne EFTER hooket (et stykke der lukkede
 * hullet i samme segment, er allerede tilbage, rejoinBreakawayPiece). Splits
 * fra dagens terraen (M2/M3/M8) sker FOER M5 i samme segment, saa `km`
 * (segmentets slut-km) er samme km som deres `peloton_splits`. Et uheldsoffer
 * (state.incident_chasers) meldes ikke: uheldets egen linje fortaeller det.
 * `breakaway_formed` faar `drops_reported: true`, saa historikken ved at
 * motoren melder afsatte ryttere og bruger haendelsen frem for projektionen.
 */
export function withBreakawayDrops(result: SegmentHookResult, km: number): SegmentHookResult {
  const known = result.state.breakaway_dropped_ids ?? [];
  const chasers = result.state.incident_chasers ?? {};
  const drops = breakawayDropEvents(result.state.groups, known, km, (id) => chasers[id] !== undefined);
  const events = result.events.map((e) => e.type === "breakaway_formed" ? { ...e, params: { ...e.params, drops_reported: true } } : e);
  const same = drops.dropped.length === known.length && drops.dropped.every((id, i) => id === known[i]);
  return { state: same ? result.state : { ...result.state, breakaway_dropped_ids: drops.dropped }, events: [...events, ...drops.events] };
}
