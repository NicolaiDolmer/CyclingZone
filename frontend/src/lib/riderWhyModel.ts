// #7717 · Hvorfor?-knappen: den sande forklaring paa en rytters resultat, som ord.
//
// KILDE: kun loebets egne haendelser (`events` og `story` fra
// GET /api/races/:raceId/timeline?stage=N&story=1) og resultatraekken. Intet her
// gaetter: kan loggen ikke baere en paastand, bliver den ikke sagt, og svaret er
// "ikke kendt". Teksten baerer aldrig tal; steder er stigningens navn eller "finalen".
//
// Raekkefoelgen er bevidst:
//   1. udgaaet: aarsagen fra raekken og uheldet,
//   2. enkeltstart: ingen grupper, saa kun uheld, dagsform (med vejr) og rute,
//      og kun naar det passer til placeringen,
//   2b. ingen gruppe-log (holdtidskoersel, gammel tidslinje): ikke kendt,
//   3. i maal foran: en rytter i frontgruppen blev aldrig sat, heller ikke selvom
//      han var tabt undervejs og kom tilbage,
//   4. bag fronten: det foerste tilbageslag der stod ved magt (buildOwnTimeLoss
//      vogter "kom han tilbage"), og hvad der foerte til det.
import { attackCompanions, checkpointGapForRider, dayWordsByRider, mainGroupId, FINALE_KM, type AttackCompanions, type Cast, type RaceStory, type StoryMoment } from "../components/race/stagePageV2/raceStoryModel.ts";
import type { Climb } from "../components/race/stagePageV2/stagePageV2Model.ts";
import { buildOwnTimeLoss, hasGroupGaps, type DropReason, type TimelineEvent } from "./stageSplitTimes.ts";

export type WhyMain =
  | "unknown"
  | "abandonedCrash" | "abandonedMechanical" | "abandoned" | "timeLimit" | "withdrawal"
  | "won" | "wonSprint" | "wonAttack" | "survived" | "front" | "frontSprint"
  | "dropEmpty" | "dropPace" | "dropGrupetto" | "dropCobbles" | "dropGeneric" | "dropFromBreak"
  | "crack" | "allOut" | "allOutGain" | "crashLoss" | "mechanicalLoss" | "incidentLoss" | "caught"
  | "badDayFatigue" | "badDayForm" | "badDayIllness" | "badDayRain" | "badDayWind" | "badDayHeat"
  | "attackBehind" | "bunchBehindSprint" | "pelotonBehindBreak" | "pelotonBehind"
  | "ttFastest" | "ttDayGreat" | "ttDayGood" | "ttRouteGood" | "ttRouteBad";

export type WhyLead =
  | "afterBreak" | "afterDrop"
  | "badDayFatigue" | "badDayForm" | "badDayIllness" | "badDayRain" | "badDayWind" | "badDayHeat"
  | "ttRouteGood" | "ttRouteBad";

export type WhyPlace =
  | { kind: "none" }
  | { kind: "climb"; name: string }
  | { kind: "sector"; name: string }
  | { kind: "lastClimb" }
  | { kind: "someClimb" }
  | { kind: "finale" };

export interface RiderWhy {
  known: boolean;
  main: WhyMain;
  where: WhyPlace;
  lead: WhyLead | null;
  /** Stedet for tilbageslaget i `lead` ("efter at have mistet kontakten paa ..."). */
  leadWhere: WhyPlace;
  /** #7754: hvem din rytter angreb sammen med; feltet findes kun, naar haendelserne viser det. */
  companions?: AttackCompanions;
}

export interface RiderWhyInput {
  riderId: string | null | undefined;
  rank: number | null | undefined;
  status?: "dnf" | "dns" | null;
  reasonKey?: string | null;
  events: readonly TimelineEvent[] | null | undefined;
  story: RaceStory | null | undefined;
  climbs: readonly Climb[];
  /** #7754: navne og dine egne ryttere. Uden den siges intet om, hvem han angreb med. */
  cast?: Cast | null;
  /** #7717: rute-match pr. egen rytter paa denne etape. Uden den siges intet om ruten. */
  routeFits?: ReadonlyMap<string, number | null> | null;
}

const NOWHERE: WhyPlace = { kind: "none" };
const UNKNOWN: RiderWhy = { known: false, main: "unknown", where: NOWHERE, lead: null, leadWhere: NOWHERE };

function said(main: WhyMain, where: WhyPlace = NOWHERE, lead: WhyLead | null = null, leadWhere: WhyPlace = NOWHERE): RiderWhy {
  return { known: true, main, where, lead, leadWhere };
}

const EPS = 1e-6;
/** "Efter en dag i udbruddet" kraever mindst denne del af etapen foran. */
const LONG_BREAK_SHARE = 0.25;
const FIELD_GROUP = "peloton-0";
/** En stigning og dens top i loggen er samme sted, selvom kilderne runder forskelligt. */
const CREST_MATCH_KM = 0.5;

function ridersOf(m: StoryMoment): string[] {
  const list = Array.isArray(m.data.rider_ids) ? m.data.rider_ids.filter((x): x is string => typeof x === "string") : [];
  return typeof m.data.rider_id === "string" && !list.includes(m.data.rider_id) ? [...list, m.data.rider_id] : list;
}

/**
 * Stedet i ord. Kender loggen kun et stykke vej (km_span), siges en stigning kun
 * hvis hele stykket ligger paa den; ellers intet sted.
 */
export function placeOf(moment: StoryMoment | null | undefined, story: RaceStory, climbs: readonly Climb[]): WhyPlace {
  if (!moment) return NOWHERE;
  const from = moment.km_span ? moment.km_span.from : moment.km;
  const to = moment.km_span ? moment.km_span.to : moment.km;
  const at = climbs.findIndex((c) => from >= Number(c.crest_km) - Number(c.length_km) - EPS && to <= Number(c.crest_km) + EPS);
  if (at >= 0) {
    const climb = climbs[at];
    const top = story.checkpoints.find((c) => c.kind === "climb" && c.name && Math.abs(c.km - Number(climb.crest_km)) <= CREST_MATCH_KM);
    const name = climb.name?.trim() || top?.name || null;
    if (name) return { kind: "climb", name };
    return at === climbs.length - 1 ? { kind: "lastClimb" } : { kind: "someClimb" };
  }
  if (story.distance_km != null && from >= story.distance_km - FINALE_KM - EPS) return { kind: "finale" };
  return NOWHERE;
}

const BAD_DAY: Record<string, { main: WhyMain; lead: WhyLead }> = {
  fatigue: { main: "badDayFatigue", lead: "badDayFatigue" },
  form: { main: "badDayForm", lead: "badDayForm" },
  illness: { main: "badDayIllness", lead: "badDayIllness" },
  rain: { main: "badDayRain", lead: "badDayRain" },
  wind: { main: "badDayWind", lead: "badDayWind" },
  heat: { main: "badDayHeat", lead: "badDayHeat" },
};

const DROP_MAIN: Record<DropReason, WhyMain> = {
  wprime_depleted: "dropEmpty",
  climb_deficit: "dropPace",
  grupetto: "dropGrupetto",
  cobbles_sector: "dropCobbles",
  mixed: "dropGeneric",
  unknown: "dropGeneric",
};

function badDayOf(moments: StoryMoment[]) {
  const moment = moments.find((m) => m.type === "bad_day");
  if (!moment) return null;
  const cause = moment.data.reason === "weather" ? moment.data.weather : moment.data.reason;
  return typeof cause === "string" ? BAD_DAY[cause] ?? null : null;
}

/** Holdt angrebet til stregen? Blev han eller hans gruppe hentet bagefter, gjorde det ikke. */
function attackHeld(attack: StoryMoment, story: RaceStory, riderId: string): boolean {
  const groupId = attack.data.group_id;
  return !story.moments.some((m) => ["breakaway_caught", "group_caught", "group_merged"].includes(m.type) && m.km >= attack.km - EPS
    && (ridersOf(m).includes(riderId) || (groupId != null && m.data.group_id === groupId)));
}

/** Sad han reelt i udbruddet en stor del af dagen? Et udbrud hentet efter faa km forklarer intet. */
function longBreak(story: RaceStory, moments: StoryMoment[]): boolean {
  const formed = moments.find((m) => m.type === "breakaway_formed") ?? story.moments.find((m) => m.type === "breakaway_formed");
  const end = moments.find((m) => m.type === "breakaway_caught" || m.type === "breakaway_dropped");
  if (!formed || !end || story.distance_km == null) return false;
  return end.km - formed.km >= story.distance_km * LONG_BREAK_SHARE - EPS;
}

/** Kom han tilbage i feltet efter km? Saa er et senere tilbageslag aarsagen, ikke uheldet. */
function rejoinedField(events: RiderWhyInput["events"], riderId: string, km: number): boolean {
  return (events ?? []).some((e) => e?.type === "group_merged" && (e.km ?? 0) > km + EPS && e.params?.into_group_id === FIELD_GROUP
    && Array.isArray(e.params?.rider_ids) && (e.params.rider_ids as unknown[]).includes(riderId));
}

type Setback = { main: WhyMain; moment: StoryMoment | null; sector: string | null; climbName: string | null };

/**
 * Det foerste tilbageslag der stod ved magt. Et uheld taeller kun bort, naar han
 * kom i maal med feltet (`backInField`): en sammenlaegning med en gruppe laengere
 * tilbage er ikke at vaere kommet tilbage.
 */
function firstSetback(input: RiderWhyInput, moments: StoryMoment[], backInField = false): Setback | null {
  const riderId = input.riderId as string;
  // Haendelsen staar paa tjekpunktets km, men momentet paa det praecise sted (exact_km).
  const exactKms = (type: string, km: number): number[] => (input.events ?? []).flatMap((e) => {
    const exact = e?.params?.exact_km;
    return e?.type === type && Math.abs((e.km ?? Number.NaN) - km) < EPS && typeof exact === "number" ? [exact] : [];
  });
  const near = (m: StoryMoment, km: number) => [km, ...exactKms(m.type, km)]
    .some((k) => Math.abs((m.recorded_km ?? m.km) - k) < EPS || Math.abs(m.km - k) < EPS);
  for (const entry of buildOwnTimeLoss(input.events, { ownRiderIds: [riderId] })) {
    if (entry.type === "drop") {
      const moment = moments.find((m) => m.type === "peloton_splits" && near(m, entry.km)) ?? null;
      return {
        main: entry.from === "breakaway" ? "dropFromBreak" : DROP_MAIN[entry.reason],
        moment,
        sector: entry.sectorName,
        climbName: entry.climbName,
      };
    }
    const type = entry.event.type;
    const moment = moments.find((m) => m.type === type && near(m, entry.km)) ?? null;
    if (type === "favorite_crack") return { main: "crack", moment, sector: null, climbName: null };
    if (type !== "incident" || entry.event.params?.outcome !== "time_loss") continue;
    if (backInField || rejoinedField(input.events, riderId, entry.km)) continue;
    const kind = entry.event.params?.kind;
    return { main: kind === "crash" ? "crashLoss" : kind === "mechanical" ? "mechanicalLoss" : "incidentLoss", moment, sector: null, climbName: null };
  }
  const dropped = moments.find((m) => m.type === "breakaway_dropped") ?? null;
  return dropped ? { main: "dropFromBreak", moment: dropped, sector: null, climbName: null } : null;
}

function setbackPlace(setback: Setback, story: RaceStory, climbs: readonly Climb[]): WhyPlace {
  if (setback.sector) return { kind: "sector", name: setback.sector };
  const place = placeOf(setback.moment, story, climbs);
  return place.kind === "none" && setback.climbName && !setback.moment?.km_span ? { kind: "climb", name: setback.climbName } : place;
}

function outOfRace(input: RiderWhyInput, story: RaceStory | null, moments: StoryMoment[]): RiderWhy {
  const incident = moments.find((m) => m.type === "incident" && m.data.outcome === "abandoned") ?? null;
  const where = story ? placeOf(incident, story, input.climbs) : NOWHERE;
  const kind = (incident?.data.kind as string | undefined) ?? input.reasonKey ?? null;
  if (kind === "crash") return said("abandonedCrash", where);
  if (kind === "mechanical") return said("abandonedMechanical", where);
  if (input.reasonKey === "time_limit" || input.reasonKey === "withdrawal") {
    const main = input.reasonKey === "time_limit" ? "timeLimit" : "withdrawal";
    const setback = story && hasGroupGaps(input.events) ? firstSetback(input, moments) : null;
    return setback ? said(main, NOWHERE, "afterDrop", setbackPlace(setback, story as RaceStory, input.climbs)) : said(main);
  }
  return incident ? said("abandoned", where) : UNKNOWN;
}

// Grov placering og rute-match i forhold til holdkammeraterne: kun til at afgoere, om en
// aarsag passer til resultatet. Rute-tallet er absolut og siger intet alene.
const TT_TOP_SHARE = 0.25;
const TT_POOR_SHARE = 0.6;
const TT_ROUTE_SUITED = 1.2;
const TT_ROUTE_UNSUITED = 0.8;

type TtPlacing = "top" | "mid" | "poor" | null;

function timeTrialPlacing(rank: number | null | undefined, field: number | null): TtPlacing {
  if (rank == null || !field) return null;
  if (rank <= Math.max(1, Math.ceil(field * TT_TOP_SHARE))) return "top";
  return rank > Math.ceil(field * TT_POOR_SHARE) ? "poor" : "mid";
}

/** Passede ruten ham bedre eller daarligere end holdkammeraterne, og viste resultatet det? */
function timeTrialRoute(input: RiderWhyInput, placing: TtPlacing): "good" | "bad" | null {
  const fit = input.routeFits?.get(input.riderId as string);
  const squad = [...(input.routeFits?.values() ?? [])].filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (typeof fit !== "number" || squad.length < 2) return null;
  const middle = squad.length / 2;
  const median = squad.length % 2 ? squad[Math.floor(middle)] : (squad[middle - 1] + squad[middle]) / 2;
  if (median <= 0) return null;
  if (placing === "top" && fit >= median * TT_ROUTE_SUITED) return "good";
  return placing === "poor" && fit <= median * TT_ROUTE_UNSUITED ? "bad" : null;
}

/**
 * Enkeltstarten: rytteren koerer alene, saa der er ingen grupper at laese. Det vi ved
 * er uheld, dagens ben fra motoren (vejret er en af dens aarsager) og ruten. Vejret
 * logges ikke for hver rytter, saa det naevnes kun som aarsag til en daarlig dag.
 */
function timeTrialWhy(input: RiderWhyInput, story: RaceStory, moments: StoryMoment[]): RiderWhy {
  const riderId = input.riderId as string;
  const word = dayWordsByRider(input.events).get(riderId) ?? null;
  const badDay = badDayOf(moments) ?? (word ? BAD_DAY[word] ?? null : null);
  const loss = moments.find((m) => m.type === "incident" && m.data.outcome === "time_loss");
  if (loss) {
    const main = loss.data.kind === "crash" ? "crashLoss" : loss.data.kind === "mechanical" ? "mechanicalLoss" : "incidentLoss";
    return said(main, placeOf(loss, story, input.climbs), badDay?.lead ?? null);
  }
  const placing = timeTrialPlacing(input.rank, story.field_count);
  const route = timeTrialRoute(input, placing);
  // Vinderen tabte ikke paa dagen, heller ikke med tunge ben.
  if (badDay && input.rank !== 1) return said(badDay.main, NOWHERE, route === "bad" ? "ttRouteBad" : null);
  if ((word === "great" || word === "good") && placing !== "poor") {
    return said(word === "great" ? "ttDayGreat" : "ttDayGood", NOWHERE, route === "good" ? "ttRouteGood" : null);
  }
  if (route) return said(route === "good" ? "ttRouteGood" : "ttRouteBad");
  return input.rank === 1 ? said("ttFastest") : UNKNOWN;
}

function isIndividualTimeTrial(events: RiderWhyInput["events"], story: RaceStory): boolean {
  const start = (events ?? []).find((e) => e?.type === "stage_start");
  return story.time_trial && /^itt/.test(String(start?.params?.profile_type ?? ""));
}

/** Forklaringen paa een raekke i resultatet. Kendes den ikke, er `known` false. */
export function riderWhy(input: RiderWhyInput): RiderWhy {
  const why = explain(input);
  const { riderId, story, cast } = input;
  const companions = why.known && riderId && story && cast ? attackCompanions(story, riderId, cast) : null;
  return companions ? { ...why, companions } : why;
}

function explain(input: RiderWhyInput): RiderWhy {
  const { riderId, rank, status, story, climbs } = input;
  if (!riderId || status === "dns") return UNKNOWN;
  const moments = story ? story.moments.filter((m) => ridersOf(m).includes(riderId)) : [];
  if (status === "dnf") return outOfRace(input, story ?? null, moments);
  if (story && isIndividualTimeTrial(input.events, story)) return timeTrialWhy(input, story, moments);
  if (!story || story.time_trial || !hasGroupGaps(input.events)) return UNKNOWN;

  const finish = story.checkpoints.find((c) => c.kind === "finish");
  const gap = finish ? checkpointGapForRider(finish, riderId) : null;
  if (!finish || !gap) return UNKNOWN;

  const outcomes = story.breakaway?.outcomes ?? null;
  const outcome = outcomes?.[riderId] ?? null;
  // Motoren skriver kun sprint_decided naar etapen blev afgjort i en spurt.
  const sprint = story.moments.find((m) => m.type === "sprint_decided") ?? null;
  const group = finish.groups.find((g) => g.group_id === gap.group_id) ?? null;
  const attacks = moments.filter((m) => m.type === "finale_attack");
  const attack = attacks[attacks.length - 1] ?? null;
  // Maalets placeringsgrupper (finale-*) er feltet delt op paa stregen, ikke et hul paa vejen.
  const finaleGroup = gap.group_id.startsWith("finale-");
  if (outcome === "survived") return said("survived");
  if (rank === 1) {
    if (sprint?.data.winner_rider_id === riderId) return said("wonSprint");
    return attack && group?.size === 1 && attackHeld(attack, story, riderId) ? said("wonAttack", placeOf(attack, story, climbs)) : said("won");
  }
  if (gap.in_front) return said(sprint ? "frontSprint" : "front");

  const badDay = badDayOf(moments);
  const leadFor = (): WhyLead | null => badDay?.lead ?? ((outcome === "caught" || outcome === "dropped") && longBreak(story, moments) ? "afterBreak" : null);
  const allOut = moments.find((m) => m.type === "all_out_cracked");
  if (allOut) return said("allOut", placeOf(allOut, story, climbs), leadFor());
  const setback = firstSetback(input, moments, gap.via_rest || finaleGroup);
  if (setback) {
    const lead = setback.main === "dropFromBreak" ? badDay?.lead ?? null : leadFor();
    return said(setback.main, setbackPlace(setback, story, climbs), lead);
  }
  if (outcome === "caught") {
    const caught = moments.find((m) => m.type === "breakaway_caught") ?? null;
    return said("caught", placeOf(caught, story, climbs), badDay?.lead ?? null);
  }
  // Han vandt tid paa stigningen: det forklarer resultatet bedre end dagens form alene.
  const allOutGain = moments.find((m) => m.type === "all_out_gain");
  if (allOutGain) return said("allOutGain", placeOf(allOutGain, story, climbs), badDay?.lead ?? null);
  if (badDay) return said(badDay.main);
  // Kun et angreb der faktisk blev hentet: at slutte bag et udbrud er ikke at fejle.
  if (attack && !attackHeld(attack, story, riderId)) return said("attackBehind", placeOf(attack, story, climbs));
  if (finaleGroup && sprint) return said("bunchBehindSprint");
  if (group && mainGroupId(finish.groups) === group.group_id) {
    const survivors = Object.values(outcomes ?? {}).some((o) => o === "survived");
    return said(survivors ? "pelotonBehindBreak" : "pelotonBehind");
  }
  return UNKNOWN;
}
