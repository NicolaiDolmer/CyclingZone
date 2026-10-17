import type { RaceGroup, SegmentHookResult, TimelineEvent } from "../types.ts";
import type { FinaleGroupTrace } from "../groups.ts";

/** #6748: gruppen rytteren koerer i, naar den er af dagens udbrud (oprindelse "breakaway", enhver art). */
function morningOriginGroupOf(groups: readonly RaceGroup[], riderId: string): RaceGroup | null {
  const group = groups.find((g) => g.rider_ids.includes(riderId));
  return group && group.origin === "breakaway" ? group : null;
}

/**
 * #6748 (KUN s5_profiles_v2): udbrudsdommen (groups.isBreakawayWin) uden
 * kravet om gruppens art. En udbryder der faldt bagud fra udbrudsgruppen og
 * vandt fra et stykke af udbruddet (oprindelse "breakaway", kun udbrydere),
 * vandt fra udbruddet, ligesom maal-afgoerelsen (raceParticipationHistory's
 * settleBreakawayOutcome) siger "holdt hjem". Finalens krav er uaendret: tog
 * finalen ikke-udbrydere med i opgoeret, er udbruddet hentet.
 * Er sand overalt hvor isBreakawayWin er sand. REN.
 */
export function isS5V2BreakawayWin(trace: FinaleGroupTrace, winnerId: string | null): boolean {
  if (!winnerId) return false;
  if (!morningOriginGroupOf(trace.entryGroups, winnerId) || !morningOriginGroupOf(trace.preFinaleGroups, winnerId)) return false;
  const escapeRiderIds = new Set(trace.preFinaleGroups.filter((g) => g.origin === "breakaway").flatMap((g) => g.rider_ids));
  const preFinaleIds = new Set(trace.preFinaleGroups.map((g) => g.id));
  const finaleBuilt = trace.postFinaleGroups.filter((g) => !preFinaleIds.has(g.id));
  if (!finaleBuilt.some((g) => g.rider_ids.includes(winnerId))) return morningOriginGroupOf(trace.postFinaleGroups, winnerId) !== null;
  return finaleBuilt.every((g) => g.rider_ids.every((id) => escapeRiderIds.has(id)));
}

/**
 * #6748 (KUN s5_profiles_v2): vinderen fra et stykke af udbruddet faar sit
 * eget udfald paa stregen. Motoren udsender kun udfald for udbrudsgruppen
 * (breakaway_survived/-caught), saa en udbryder der faldt bagud og vandt
 * bagfra, stod som "sat af" mod motorens udbrudsdom. Navngiver intet udfald
 * vinderen, og koerte han lige foer finalen i en gruppe af dagens udbrud,
 * tilfoejes `breakaway_survived` (udbruddet vandt) eller `breakaway_caught`
 * (finalen tog feltet med i opgoeret) paa maalstregen for netop ham. Samme dom
 * som `breakawayWin`. REN: input muteres ikke.
 */
export function withWinnerEscapeOutcome(
  events: readonly TimelineEvent[],
  args: { trace: FinaleGroupTrace | null; winnerId: string | null; breakawayWin: boolean; km: number },
): TimelineEvent[] {
  const { trace, winnerId } = args;
  if (!trace || !winnerId) return [...events];
  const named = events.some((e) => (e.type === "breakaway_survived" || e.type === "breakaway_caught")
    && Array.isArray(e.params.rider_ids) && e.params.rider_ids.includes(winnerId));
  const group = named ? null : morningOriginGroupOf(trace.preFinaleGroups, winnerId);
  if (!group) return [...events];
  return [...events, { km: args.km, type: args.breakawayWin ? "breakaway_survived" : "breakaway_caught", params: { group_id: group.id, rider_ids: [winnerId] } }];
}

/** A pursuing group must be physically behind the group it is chasing. */
export function findChaseGroup(groups: readonly RaceGroup[], target: RaceGroup): RaceGroup | null {
  const candidates = groups.filter((group) => group.id !== target.id && group.kind !== "breakaway" && group.rider_ids.length > 0 && group.gap_seconds >= target.gap_seconds);
  candidates.sort((a, b) => a.gap_seconds - b.gap_seconds || b.rider_ids.length - a.rider_ids.length || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/**
 * #6199: dagens udbryderes saet, som isMorningRegroupCatch maaler paa (segmentLoop).
 * #6748 (KUN s5_profiles_v2): et nyt udbrud med `separate_formation` er den
 * AKTIVE formation og nulstiller saettet, saa det hentede udbruds ryttere der
 * henter det nye udbrud, er en indhentning, ikke en sammenlaegning (samme regel
 * som raceParticipationHistory.ts). Uden maerket vokser saettet som foer.
 */
export function noteFormationRiders(formation: Set<string>, event: TimelineEvent): void {
  if (event.type !== "breakaway_formed") return;
  if (event.params.separate_formation === true) formation.clear();
  for (const id of Array.isArray(event.params.rider_ids) ? event.params.rider_ids : []) if (typeof id === "string") formation.add(id);
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
