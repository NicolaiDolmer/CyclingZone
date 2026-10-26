// F3 taktik-ordrer v1 (#4030/#3855/#4246) — adapter: race_team_orders-raekker +
// holdudtagelsens roller → StageInput.orders. Adapter-laget er (som
// entrantAdapter/routeAdapter) den LOVLIGE graense mellem DB-former og den rene
// kerne: herfra og ind er alt deterministisk og IO-frit.
//
// #4246 (ejer 2/9 + 27/8, LAAST) — kaeden fra spiller til motor lukkes her:
//
//   holdudtagelsens rolle  ->  standardordren   (teamOrderContract.defaultTeamOrderForRoster)
//   + etapens gemte raekke ->  dagens overlay   (teamOrderContract.applyStageOverlayToOrder)
//   = én team_tactics-ordre + (naar holdet har et tog) én leadout-ordre
//
// Auditten 5/9 fandt tre huller, alle lukket her:
//   (a) standardordren gav ALLE ryttere "normal, proev ikke udbrud" uanset
//       rolle — nu er rollen standardordren (en `hunter` proever udbruddet uden
//       at spilleren skal roere noget).
//   (b) sprint-toget kunne ikke saettes af en spiller — `leadout` pr. rytter er
//       nu i kontrakten, og adapteren oversaetter det til M6's `leadout`-ordre.
//   (c) `race_role` laa i selve ordren — DB-raekker kan stadig baere feltet
//       (gamle raekker), men det LAESES ikke laengere: rollen kommer fra
//       holdudtagelsen, og taktik-kortet kan ikke overskrive den.
//
// ÉN kontrakt: formen, vokabularerne og rolle-defaulten bor i
// `../ai/teamOrderContract.ts` og importeres herfra — de fire uenige kopier
// auditten fandt er nu én.
//
// #5571 (lag 1 i "Holdmoedet", ejer 23/9) — AI-holdene faar M14 i prod:
//
//   AI-hold:      M14's ordre (generateAiTeamOrder)  = standardordren
//   Menneskehold: rollernes standardordre            = standardordren (uaendret)
//   Begge:        + etapens gemte raekke som overlay (uaendret)
//
// Samme TeamOrder-type, samme overlay-regel, samme vej ind i motoren — ingen
// sidekanal. Et menneskehold faar ALDRIG M14 (ingen autopilot for mennesker):
// kun et hold hvis ryttere baerer `is_ai: true` fra startlisten.
//
// #6441 (KUN official_times_v3, ejer 10/10): undtagelsen er udbruds-stancen.
// Et menneskehold uden egen stance for etapen faar M14's stance-regel
// (decideAiBreakawayStance) i stedet for altid neutral; resten af ordren er
// rollernes. Manageren gemte stance vinder altid (overlayet).
//
// Motoren laeser indsatsen paa `Entrant.effort`, ikke i ordren. Planen
// returnerer derfor AI-holdenes indsats pr. rytter (`aiEffortByRider`), som
// kaldstedet saetter paa startlisten. Menneskeholdenes indsatskilde roeres
// ikke her (den er #5580's "én kilde til effort").
//
// #6462 (KUN official_times_v5 og s5_profiles_v1, ejer 16/10): sprint-toget er kun
// STANDARD paa en flad etape (motorens egen tog-klassifikation,
// leadout.isSprintTrainProfile). Paa bjerg, enkeltstart, kuperet og brosten
// koerer ingen i toget, medmindre manageren selv har sat det for etapen
// (overlayet vinder altid). Samme regel for menneske- og AI-hold, og taktik-
// fladen (frontend/src/lib/tacticsPlan.js) viser praecis det samme.

import type { AbilityKey, TeamOrder as EngineTeamOrder } from "../types.ts";
import {
  decideAiBreakawayStance,
  generateAiTeamOrder,
  type AiFieldRider,
  type AiRaceContext,
  type AiTacticsRoute,
} from "../ai/aiTactics.ts";
import {
  applyStageOverlayToOrder,
  defaultTeamOrderForRoster,
  BREAKAWAY_STANCE_VALUES,
  EFFORT_LEVEL_VALUES,
  RIDER_ROLE_VALUES,
  type BreakawayStance,
  type EffortLevel,
  type RiderRole,
  type RosterEntry,
  type StageOverlay,
  type StageOverlayRider,
  type TeamOrder as TeamTacticsOrder,
} from "../ai/teamOrderContract.ts";
import { TEAM_TACTICS_ORDER_KIND, s5MorningGcBlockedRiders } from "../mechanics/breakaway.ts";
import { eligibleKomHunters } from "../mechanics/komJersey6937.ts"; // #6937
import { LEADOUT_ORDER_KIND, isSprintTrainProfile, sprintTrainLeadoutOrder } from "../mechanics/leadout.ts";
import { isOfficialTimesV3OrLater, isOfficialTimesV5OrLater, isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts";
import { CO_CAPTAIN_ROLE, aiCoCaptainId } from "../mechanics/sharedCaptain.ts";
import { stagePlanOrderFromRow } from "../../../stagePlanEngine.ts"; // #7003

export type { BreakawayStance, TeamTacticsOrder };

/** Raekkeform fra race_team_orders (DB) — kun felterne adapteren laeser. */
export type TeamOrderRow = {
  team_id: string;
  stage_number: number;
  breakaway_stance?: string | null;
  riders?: unknown;
};

/**
 * Startlistens hold + roller: hvem koerer, og hvad er deres opgave.
 * `is_ai` + `abilities` (#5571) er kun noedvendige for AI-hold: M14 vaelger
 * taktik ud fra evnerne, og holdet genkendes paa flaget.
 */
export type RosterRider = {
  team_id: string;
  rider_id: string;
  role?: string | null;
  is_ai?: boolean | null;
  abilities?: Record<string, unknown> | null;
};

/** Dagens rute + loebet omkring den: det M14 skal kende for at vaelge taktik. */
export type StageOrderContext = {
  route: AiTacticsRoute;
  race?: AiRaceContext;
  /** #6097 (VALGFRIT): loebets regel-revision, videre til M14. Udeladt = uaendret. */
  rules_revision?: string;
  /**
   * #6818 (VALGFRIT, KUN s5_profiles_v2): samme gc_context som motoren faar. AI-holdene sender
   * saa ikke en rytter, motoren blokerer i morgenudbruddet (stillingens top / klassementspotentiale),
   * men naeste passende rytter. Udeladt = uaendret.
   */
  gc_context?: unknown;
  /** #2757 S1 (VALGFRIT, KUN s5_profiles_v3): pointtroejens foerer foer etapen, videre til M14. */
  points_leader_rider_id?: string | null;
  /** #6937 B1 (VALGFRIT, KUN s5_profiles_v3): bjergjaegerne foer etapen, videre til M14. */
  kom_hunter_rider_ids?: readonly string[] | null;
};

export type StageOrderPlan = {
  orders: EngineTeamOrder[];
  /** KUN AI-holdenes ryttere: indsatsen fra deres ordre (motoren laeser Entrant.effort). */
  aiEffortByRider: Map<string, EffortLevel>;
  /** #5981 (KUN s5_profiles_v3, etapeloeb): AI-holdenes delte kaptajn -> rollen motoren skal se. Kun sat naar ikke tom. */
  aiRoleByRider?: Map<string, RiderRole>;
};

const VALID_STANCES: ReadonlySet<string> = new Set(BREAKAWAY_STANCE_VALUES);
const VALID_EFFORTS: ReadonlySet<string> = new Set(EFFORT_LEVEL_VALUES);
const VALID_ROLES: ReadonlySet<string> = new Set(RIDER_ROLE_VALUES);

/** Ukendt/manglende rolle → `free_role` (ingen bunden opgave), aldrig et kast. */
function toRole(role: string | null | undefined): RiderRole {
  return VALID_ROLES.has(role ?? "") ? (role as RiderRole) : "free_role";
}

/**
 * Én DB-raekke → etapens overlay. Defensiv mod jsonb-drift (shape haandhaeves i
 * API-laget, ikke DB): ukendte stances/efforts droppes som "ikke valgt" i
 * stedet for at blive tvunget til neutral/normal — en ulaeselig vaerdi maa
 * falde tilbage paa ROLLENS standard, ikke overskrive den. Ikke-arrays bliver
 * en tom liste; en korrupt raekke maa aldrig vaelte en simulering.
 *
 * `race_role` i raekken ignoreres bevidst (#4246, ejer 27/8).
 */
export function rowToStageOverlay(row: TeamOrderRow): StageOverlay {
  const stance = VALID_STANCES.has(row.breakaway_stance ?? "")
    ? (row.breakaway_stance as BreakawayStance)
    : undefined;
  const rawRiders = Array.isArray(row.riders) ? row.riders : [];
  const riders: StageOverlayRider[] = rawRiders
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .filter((r) => typeof r["rider_id"] === "string")
    .map((r) => {
      const entry: StageOverlayRider = { rider_id: r["rider_id"] as string };
      if (VALID_EFFORTS.has((r["effort"] as string) ?? "")) entry.effort = r["effort"] as EffortLevel;
      if (typeof r["try_break"] === "boolean") entry.try_break = r["try_break"];
      if (typeof r["leadout"] === "boolean") entry.leadout = r["leadout"];
      return entry;
    });
  return { breakaway_stance: stance, riders };
}

/**
 * Standardordre (rollerne) + evt. etape-overlay for ÉT hold.
 * Uden raekke er resultatet ren rolle-default — T4: kernen kraever ALDRIG ordrer.
 */
export function teamOrderFor(teamId: string, roster: readonly RosterEntry[], row?: TeamOrderRow): TeamTacticsOrder {
  const base = defaultTeamOrderForRoster(teamId, roster);
  return row ? applyStageOverlayToOrder(base, rowToStageOverlay(row)) : base;
}

/** Pak T3-formen ind i types.ts's aabne TeamOrder-konvolut (kind + params). */
export function toEngineTeamOrder(order: TeamTacticsOrder): EngineTeamOrder {
  return {
    team_id: order.team_id,
    kind: TEAM_TACTICS_ORDER_KIND,
    params: { breakaway_stance: order.breakaway_stance, riders: order.riders },
  };
}

/**
 * M6-ordren (sprint-toget) afledt af ÉN holdordre + holdets roller.
 *
 * Togets MAAL er rollen `sprint_captain` — aldrig noget taktik-kortet kan
 * flytte (#4246). Togets MANDSKAB er ordrens `leadout`-flag, som rollen
 * `helper` saetter som standard og spilleren kan aendre for dagen.
 *
 * `null` naar holdet ikke har en spurt-kaptajn paa etapen, eller naar ingen
 * koerer for ham — M6 giver pr. sin egen kontrakt ingen bonus for et tomt tog,
 * saa en tom ordre ville kun vaere stoej i `StageInput.orders`.
 */
export function toEngineLeadoutOrder(
  order: TeamTacticsOrder,
  roster: readonly RosterEntry[],
): EngineTeamOrder | null {
  const captain = roster.find((r) => r.role === "sprint_captain");
  if (!captain) return null;
  const train = order.riders
    .filter((r) => r.leadout === true && r.rider_id !== captain.rider_id)
    .map((r) => r.rider_id);
  if (train.length === 0) return null;
  return {
    team_id: order.team_id,
    kind: LEADOUT_ORDER_KIND,
    params: { captain_rider_id: captain.rider_id, leadout_rider_ids: train },
  };
}

/** Startlistens ryttere grupperet pr. hold, i deterministisk hold-orden (team_id stigende). */
export function rosterByTeam(roster: readonly RosterRider[]): Map<string, RosterEntry[]> {
  const byTeam = new Map<string, RosterEntry[]>();
  for (const rider of roster) {
    if (rider.team_id == null || rider.rider_id == null) continue;
    const teamId = String(rider.team_id);
    if (!byTeam.has(teamId)) byTeam.set(teamId, []);
    byTeam.get(teamId)!.push({ rider_id: String(rider.rider_id), role: toRole(rider.role) });
  }
  return new Map([...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/** Evne-raekken som M14 laeser den. M14 clamper selv hver vaerdi (null/streng → tal). */
function toAbilities(raw: Record<string, unknown> | null | undefined): Record<AbilityKey, number> {
  return (raw ?? {}) as Record<AbilityKey, number>;
}

/** Hold hvis ryttere baerer `is_ai: true` fra startlisten (holdet er AI-styret). */
function aiTeamIds(roster: readonly RosterRider[]): Set<string> {
  const ids = new Set<string>();
  for (const rider of roster) {
    if (rider.is_ai === true && rider.team_id != null) ids.add(String(rider.team_id));
  }
  return ids;
}

/**
 * #6441 (KUN official_times_v3, ejer 10/10 kl. 22:40): et menneskeholds
 * standardordre er rollernes (uaendret), men holdets udbruds-stance er den
 * samme som et AI-hold ville vaelge (decideAiBreakawayStance, M14 punkt 1-4):
 * kaptajnen blandt feltets favoritter paa dagens terraen -> chase, ellers
 * neutral (ejer 11/10: M14's let_go bliver neutral for et menneskehold). Kun stancen; indsats, udbrudsforsoeg og tog er
 * rollernes. En stance manageren selv har gemt for etapen laegges ovenpaa som
 * overlay og vinder altid. Mangler holdets evner (ingen raekke at maale
 * kaptajnen paa), bliver stancen rollernes neutrale standard.
 */
function humanDefaultOrderV3(
  teamId: string,
  teamRoster: readonly RosterEntry[],
  route: AiTacticsRoute,
  field: readonly AiFieldRider[],
  abilitiesByRider: ReadonlyMap<string, Partial<Record<AbilityKey, number>>>,
): TeamTacticsOrder {
  const base = defaultTeamOrderForRoster(teamId, teamRoster);
  if (!teamRoster.some((r) => abilitiesByRider.has(r.rider_id))) return base;
  const { stance } = decideAiBreakawayStance({
    route,
    roster: teamRoster.map((r) => ({
      rider_id: r.rider_id,
      role: r.role,
      abilities: toAbilities(abilitiesByRider.get(r.rider_id) ?? null),
    })),
    field,
  });
  // #6441 (ejer 11/10 kl. 00:50): et menneskehold uden ordre lader aldrig selv
  // et udbrud gaa. M14's "let_go" (ingen chance) bliver neutral; kun "chase"
  // (kaptajnen er favorit) overtages. AI-holdenes egen beslutning er uaendret.
  return { ...base, breakaway_stance: stance === "let_go" ? "neutral" : stance };
}

/**
 * #6462 (ejer 16/10): er sprint-toget STANDARD paa dagens etape? Under
 * official_times_v5 og senere (isOfficialTimesV5OrLater, slukket indtil
 * taend-PR'en) kun paa en flad etape (isSprintTrainProfile). official_times_v4
 * og aeldre (loeb der allerede er bundet, frosne digests) samt et kald uden
 * kontekst (ruten er ukendt) beholder den gamle regel: rollens standard gaelder
 * paa alle etaper.
 */
export function trainIsDefaultOnStage(context: StageOrderContext | undefined): boolean {
  if (context === undefined || !isOfficialTimesV5OrLater(context.rules_revision)) return true;
  return isSprintTrainProfile(context.route.profile_type);
}

/** #6462: standardordren uden tog-flag. Ny ordre; input muteres ikke. */
export function withoutDefaultTrain(order: TeamTacticsOrder): TeamTacticsOrder {
  return { ...order, riders: order.riders.map((r) => ({ ...r, leadout: false })) };
}

/**
 * Alle raekker for ÉN etape + startlistens hold og roller → komplet
 * `StageInput.orders` + AI-holdenes indsats pr. rytter.
 *
 * Raekker for andre etaper ignoreres; raekker for hold UDENFOR startlisten
 * droppes (holdet stiller ikke op). Standardordren er rollernes for et
 * menneskehold og M14's for et AI-hold (#5571); etapens raekke laegges oven
 * paa begge. Uden `context` kender adapteren ikke dagens rute, og AI-holdene
 * falder tilbage paa rollernes standard (T4: kernen kraever aldrig ordrer).
 * Deterministisk output-orden: hold sorteret paa team_id, og pr. hold foerst
 * `team_tactics`, saa evt. `leadout`.
 */
export function buildStageOrderPlan(args: {
  rows: readonly TeamOrderRow[];
  stageNumber: number;
  roster: readonly RosterRider[];
  context?: StageOrderContext;
}): StageOrderPlan {
  const { rows, stageNumber, roster, context } = args;
  const byTeam = new Map<string, TeamOrderRow>();
  for (const row of rows) {
    if (row.stage_number === stageNumber) byTeam.set(String(row.team_id), row);
  }
  const aiTeams = context ? aiTeamIds(roster) : new Set<string>();
  // #6441 (KUN official_times_v3): menneskeholdenes standard-stance laeser ogsaa feltet.
  const v3HumanStance = context !== undefined && isOfficialTimesV3OrLater(context.rules_revision);
  const abilitiesByRider = new Map<string, Record<AbilityKey, number>>();
  if (aiTeams.size > 0 || v3HumanStance) {
    for (const rider of roster) {
      if (rider.rider_id != null) abilitiesByRider.set(String(rider.rider_id), toAbilities(rider.abilities));
    }
  }
  // #6434: alle rytteres evner (ogsaa menneskeholdenes), til sprinterprofilen.
  const rawAbilitiesByRider = new Map<string, Partial<Record<AbilityKey, number>>>();
  for (const rider of roster) {
    if (rider.rider_id != null && rider.abilities) rawAbilitiesByRider.set(String(rider.rider_id), toAbilities(rider.abilities));
  }
  // Hele dagens startliste: M14 placerer kaptajnen i FELTET, ikke i holdet.
  const field: AiFieldRider[] = [...abilitiesByRider.entries()].map(([rider_id, abilities]) => ({ rider_id, abilities }));
  // #6818 (KUN s5_profiles_v2): de ryttere motoren blokerer i morgenudbruddet (samme funktion som motoren).
  const breakBlocked = context?.gc_context !== undefined && aiTeams.size > 0
    ? s5MorningGcBlockedRiders(
      { gcContext: context.gc_context as never, entrants: Object.fromEntries(roster.filter((r) => r.rider_id != null).map((r) => [String(r.rider_id), { rider_id: String(r.rider_id), abilities: rawAbilitiesByRider.get(String(r.rider_id)) ?? {} }])) as never },
      roster.filter((r) => r.rider_id != null).map((r) => String(r.rider_id)),
    )
    : null;
  const trainByDefault = trainIsDefaultOnStage(context);
  // #6937 (KUN s5_profiles_v3, ejer 25/10): jaegerne = de forreste der hverken er kaptajn eller klassementsrytter.
  const komHunterIds = context?.kom_hunter_rider_ids?.length ? eligibleKomHunters(context.kom_hunter_rider_ids, (id) => { const r = roster.find((x) => String(x.rider_id) === id); return r ? toRole(r.role) : undefined; }, breakBlocked ?? new Set()) : null;

  const orders: EngineTeamOrder[] = [];
  const aiEffortByRider = new Map<string, EffortLevel>();
  // #5981 (KUN s5_profiles_v3, etapeloeb): AI-hold faar en delt kaptajn (sharedCaptain.aiCoCaptainId).
  const aiCoCaptains = context !== undefined && context.race?.is_stage_race === true && isS5ProfilesV3OrLater(context.rules_revision);
  const aiRoleByRider = new Map<string, RiderRole>();
  for (const [teamId, holdRoster] of rosterByTeam(roster)) {
    const isAiTeam = context !== undefined && aiTeams.has(teamId);
    const coId = isAiTeam && aiCoCaptains ? aiCoCaptainId(holdRoster, (id) => rawAbilitiesByRider.get(id)) : null;
    if (coId) aiRoleByRider.set(coId, CO_CAPTAIN_ROLE);
    const teamRoster = coId ? holdRoster.map((r) => (r.rider_id === coId ? { ...r, role: CO_CAPTAIN_ROLE } : r)) : holdRoster;
    const roleBase = isAiTeam
      ? generateAiTeamOrder({
          team_id: teamId,
          route: context.route,
          roster: teamRoster.map((r) => ({
            rider_id: r.rider_id,
            role: r.role,
            abilities: abilitiesByRider.get(r.rider_id) ?? toAbilities(null),
          })),
          field,
          race: context.race,
          ...(context.rules_revision ? { rules_revision: context.rules_revision } : {}),
          ...(breakBlocked ? { break_blocked_rider_ids: breakBlocked } : {}),
          ...(context.points_leader_rider_id ? { points_leader_rider_id: context.points_leader_rider_id } : {}),
          ...(komHunterIds?.length ? { kom_hunter_rider_ids: komHunterIds } : {}),
        }).order
      : v3HumanStance
        ? humanDefaultOrderV3(teamId, teamRoster, context.route, field, rawAbilitiesByRider)
        : defaultTeamOrderForRoster(teamId, teamRoster);
    // #6462: toget er kun standard paa en flad etape; manageren gemte valg (overlayet) vinder.
    const base = trainByDefault ? roleBase : withoutDefaultTrain(roleBase);
    const row = byTeam.get(teamId);
    const order = row ? applyStageOverlayToOrder(base, rowToStageOverlay(row)) : base;
    if (isAiTeam) {
      for (const rider of order.riders) aiEffortByRider.set(rider.rider_id, rider.effort);
    }
    orders.push(toEngineTeamOrder(order));
    // #7003 (KUN s5_profiles_v3): etapeplanen langs ruten som egen ordre-art.
    const stagePlanOrder = stagePlanOrderFromRow(teamId, row, context?.rules_revision, isS5ProfilesV3OrLater);
    if (stagePlanOrder) orders.push(stagePlanOrder);
    // #6434 (KUN official_times_v3): togets maal kan ogsaa vaere en kaptajn med
    // sprinterprofil paa en flad etape (sprintTrainLeadoutOrder, #6352), for
    // menneske- og AI-hold. Aeldre revisioner: den gamle regel, uaendret.
    const managerSetTrain = row ? (rowToStageOverlay(row).riders ?? []).some((r) => typeof r.leadout === "boolean") : false;
    const leadout = context !== undefined && isOfficialTimesV3OrLater(context.rules_revision)
      ? sprintTrainLeadoutOrder({
          team_id: teamId,
          riders: order.riders,
          roster: teamRoster.map((r) => ({ rider_id: r.rider_id, role: r.role, abilities: rawAbilitiesByRider.get(r.rider_id) ?? null })),
          profileType: context.route.profile_type,
          rulesRevision: context.rules_revision,
          managerSetTrain,
        })
      : toEngineLeadoutOrder(order, teamRoster);
    if (leadout) orders.push(leadout);
  }
  return aiRoleByRider.size > 0 ? { orders, aiEffortByRider, aiRoleByRider } : { orders, aiEffortByRider };
}

/** Kun ordrerne (bagudkompatibel form) — se `buildStageOrderPlan`. */
export function buildStageOrders(args: {
  rows: readonly TeamOrderRow[];
  stageNumber: number;
  roster: readonly RosterRider[];
  context?: StageOrderContext;
}): EngineTeamOrder[] {
  return buildStageOrderPlan(args).orders;
}
