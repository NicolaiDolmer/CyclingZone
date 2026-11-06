import type { RaceGroup, SegmentHookResult, StageInput, TimelineEvent } from "../types.ts";
import type { FinaleGroupTrace } from "../groups.ts";
import { compareIds } from "../../../compareIds.ts";
import { isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts";
import { TEAM_REACTION_TUNING } from "./teamChaseReaction.ts";

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

/**
 * #7730 (KUN s5_profiles_v3 + StageInput.team_chase_7730, SLUKKET): hvor sent feltet henter
 * udbruddet paa jagt-gulvet afgoeres af de hold der jager, ikke af etapens lodtraekning.
 * Spec: docs/superpowers/specs/2026-11-06-7730-jagt-efter-hold-design.md.
 *
 * START-KANDIDATER, kalibreres privat (balance-internals/7730/).
 */
export const TEAM_CHASE_7730_TUNING = Object.freeze({
  /** Et hold bidrager hoejst saa meget: ét hold kan ikke alene vaere i tide, flere hold deler foeringerne. */
  teamPullCap: 2,
  /** Under dette traek kommer jagten for sent, over det naeste er den til tiden. Imellem glider maalet. */
  latePull: 0.75,
  onTimePull: 2.5,
  /** Rytterens motor set mod udbruddets, begraenset saa én stjerne ikke er et helt hold. */
  engineRatioBounds: [0.7, 1.3] as const,
});

/** `no_chasers`: holdene der ville jage havde ingen ryttere. `nobody_wanted`: intet hold ville jage. */
export type FloorChaseShortReason = "no_chasers" | "nobody_wanted" | "tired" | "outgunned" | "too_few";

export type FloorChaseVerdict = {
  /** Det forspring feltet koerer udbruddet ned til ved maal. Altid mellem til-tiden og for-sent. */
  targetSeconds: number;
  /** Jagten kom ikke helt i tide, og `reason` siger hvorfor. */
  short: boolean;
  reason: FloorChaseShortReason | null;
  /** Holdene der arbejdede, sorteret. */
  teamIds: string[];
};

/** Kontakten: KUN s5_profiles_v3 (og senere) og kun naar kalderen eksplicit har sat `team_chase_7730`. */
export function teamChase7730On(input: Pick<StageInput, "rules_revision" | "team_chase_7730">): boolean {
  return input.team_chase_7730 === true && isS5ProfilesV3OrLater(input.rules_revision);
}

/**
 * Jagtens dom paa jagt-gulvet. Hvem arbejder (`work`: indsats-vaegten fra jagtplanen), hvor
 * staerke de er mod udbruddet, hvor friske de er, og hvor mange hold der deler foeringerne.
 * En rytter der er for traet til at reagere (samme graense som klassementsreaktionen), traekker
 * ikke. Dommen laeses paa jagtens tilstand i segmentet, saa et hold der har arbejdet hele dagen,
 * selv betaler for det i finalen. Samme tilstand giver samme dom. REN: ingen rng, ingen IO.
 */
export function judgeFloorChase7730(input: {
  work: ReadonlyMap<string, number>;
  teamOf: (riderId: string) => string | null;
  engineOf: (riderId: string) => number;
  riders: Readonly<Record<string, { status: string; team_cp_factor?: number }>>;
  breakEngine: number;
  onTimeSeconds: number;
  lateSeconds: number;
  /** Mindst ét hold ville jage. Afgoer kun, hvad filmen maa sige, naar ingen arbejder. */
  wanted: boolean;
}, t: typeof TEAM_CHASE_7730_TUNING = TEAM_CHASE_7730_TUNING): FloorChaseVerdict {
  const [lo, hi] = t.engineRatioBounds;
  const pullByTeam = new Map<string, { actual: number; fresh: number; even: number }>();
  for (const riderId of [...input.work.keys()].sort((a, b) => compareIds(a, b))) {
    const weight = input.work.get(riderId) ?? 0;
    const teamId = input.teamOf(riderId);
    const rider = input.riders[riderId];
    if (!(weight > 0) || !teamId || rider?.status !== "racing") continue;
    const factor = Number.isFinite(rider.team_cp_factor) ? (rider.team_cp_factor as number) : 1;
    const freshness = factor < TEAM_REACTION_TUNING.minWorkerFreshness ? 0 : Math.min(1, factor);
    const ratio = input.breakEngine > 0 ? Math.min(hi, Math.max(lo, input.engineOf(riderId) / input.breakEngine)) : 1;
    const team = pullByTeam.get(teamId) ?? { actual: 0, fresh: 0, even: 0 };
    pullByTeam.set(teamId, { actual: team.actual + weight * ratio * freshness, fresh: team.fresh + weight * ratio, even: team.even + weight * Math.max(1, ratio) * freshness });
  }
  const teamIds = [...pullByTeam.keys()].sort((a, b) => compareIds(a, b));
  const sum = (key: "actual" | "fresh" | "even") => teamIds.reduce((n, id) => n + Math.min(t.teamPullCap, pullByTeam.get(id)![key]), 0);
  const pull = sum("actual");
  const share = Math.min(1, Math.max(0, (pull - t.latePull) / (t.onTimePull - t.latePull)));
  const targetSeconds = input.lateSeconds + (input.onTimeSeconds - input.lateSeconds) * share;
  if (share >= 1) return { targetSeconds, short: false, reason: null, teamIds };
  if (teamIds.length === 0) return { targetSeconds, short: true, reason: input.wanted ? "no_chasers" : "nobody_wanted", teamIds };
  return { targetSeconds, short: true, reason: floorChaseShortReason(pull, sum("fresh"), sum("even"), t.onTimePull), teamIds };
}

/** Ville noget hold jage? Etapeinteresse eller en gemt jag-ordre, ogsaa fra et hold med egen mand foran. */
export function floorChaseWanted7730(interest: { teamIds: readonly string[] } | null | false | undefined, orders: readonly { breakaway_stance: string }[]): boolean {
  return (interest ? interest.teamIds.length > 0 : false) || orders.some((order) => order.breakaway_stance === "chase");
}

/**
 * Aarsagen er det der alene havde bragt jagten i tide: friske ben, ellers ben der matcher
 * udbruddet. Kan intet af det alene goere det (ét hold naar aldrig maalet selv), er aarsagen
 * det der kostede mest af traekket, saa et udkoert hold hedder traet, ikke for faa ryttere.
 */
function floorChaseShortReason(pull: number, fresh: number, even: number, onTimePull: number): FloorChaseShortReason {
  if (fresh >= onTimePull) return "tired";
  if (even >= onTimePull) return "outgunned";
  const keptByFatigue = fresh > 0 ? pull / fresh : 1;
  const keptByStrength = even > 0 ? pull / even : 1;
  const reachedByNumbers = Math.max(fresh, even) / onTimePull;
  const worst = Math.min(keptByFatigue, keptByStrength, reachedByNumbers);
  if (worst === reachedByNumbers) return "too_few";
  return worst === keptByFatigue ? "tired" : "outgunned";
}

/** A pursuing group must be physically behind the group it is chasing. */
export function findChaseGroup(groups: readonly RaceGroup[], target: RaceGroup): RaceGroup | null {
  const candidates = groups.filter((group) => group.id !== target.id && group.kind !== "breakaway" && group.rider_ids.length > 0 && group.gap_seconds >= target.gap_seconds);
  candidates.sort((a, b) => a.gap_seconds - b.gap_seconds || b.rider_ids.length - a.rider_ids.length || compareIds(a.id, b.id));
  return candidates[0] ?? null;
}

/** #6912: the field can chase a morning break even with a small group between them.
 * Callers gate this to v3 flat/rolling stage races. Never select a dropped tail or
 * another piece of the morning break as the field. The ordinary pursuer is the fallback.
 */
export function findFieldChaseGroup(groups: readonly RaceGroup[], target: RaceGroup, minFieldShare: number): RaceGroup | null {
  const others = groups.filter((g) => g.id !== target.id && g.kind !== "breakaway" && g.origin !== "breakaway");
  const total = others.reduce((n, g) => n + g.rider_ids.length, 0);
  const field = others.filter((g) => g.kind !== "gruppetto" && g.rider_ids.length > 0
    && g.rider_ids.length >= minFieldShare * total && g.gap_seconds >= target.gap_seconds);
  field.sort((a, b) => b.rider_ids.length - a.rider_ids.length || a.gap_seconds - b.gap_seconds || compareIds(a.id, b.id));
  return field[0] ?? findChaseGroup(groups, target);
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
    .sort((a, b) => a.gap_seconds - b.gap_seconds || compareIds(a.id, b.id));
  const inBreak = new Set(breaks.flatMap((group) => group.rider_ids));
  const dropped = new Set(known.filter((id) => !inBreak.has(id)));
  const events: TimelineEvent[] = [];
  const lead = breaks[0];
  if (lead) {
    const pieces = groups.filter((group) => isBreakawayPiece(group) && group.gap_seconds > lead.gap_seconds)
      .sort((a, b) => a.gap_seconds - b.gap_seconds || compareIds(a.id, b.id));
    for (const piece of pieces) {
      const fresh = piece.rider_ids.filter((id) => !dropped.has(id));
      for (const id of fresh) dropped.add(id);
      const named = fresh.filter((id) => !silent(id)).sort((a, b) => compareIds(a, b));
      if (named.length > 0) events.push({ km, type: "breakaway_dropped", params: { group_id: piece.id, from_group_id: lead.id, rider_ids: named } });
    }
  }
  return { events, dropped: [...dropped].sort((a, b) => compareIds(a, b)) };
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
