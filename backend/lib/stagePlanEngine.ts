// backend/lib/stagePlanEngine.ts
// #7003 (KUN s5_profiles_v3, slukket bag stadie-flaget stage_plan_v1): motorens
// side af etapeplanen langs ruten (kontrakten bor i stagePlan.ts).
//
// HVORDAN MOTOREN SKIFTER OPGAVE (kronologisk, ingen smuthuller):
//   1. Planen kommer ind som en ordre af arten `stage_plan` i StageInput.orders
//      (den aabne konvolut, types.ts TeamOrder). Ordre-adapteren laver den kun
//      under s5_profiles_v3, og segment-loopet laeser den kun dér.
//   2. Hver kaede valideres igen her mod rutens egne stigninger og rytterens
//      rolle (samme validateStagePlanLegs som API'et). En ugyldig kaede ignoreres
//      helt: rytteren koerer paa sin almindelige ordre, aldrig paa en halv plan.
//   3. Ved STARTEN af hvert segment (fra segment 2) afgoeres skift ud fra
//      tilstanden ved udgangen af det forrige segment. Saa ser alle mekanikker i
//      et segment den samme opgave, og et skift kan aldrig ramme bagud i tid:
//        - "naar han er sat": rytterens gruppe ligger bag holdlederens gruppe
//          (eller bag forreste gruppe, der ikke er et udbrud, hvis han selv er
//          lederen / lederen ikke koerer med). For en rytter i udbrudsopgaven er
//          "sat" at han ikke (laengere) er i udbruddet: hentet eller kom ikke med.
//          Motoren springer direkte til sat-leddet, uanset hvor langt kaeden er.
//          #7635 (slukket kontakt stage_plan_dropped_front_7635): kun en rigtig opdeling
//          af feltet er fronten. En gruppe opstaaet ved et angreb (udbrud, nedkoerselsangreb,
//          finale- og kontraangreb, observeGroups7635) goer aldrig resten af feltet sat, og
//          "sat" kraever en reel afstand der holder over flere segmentgraenser i traek
//          (STAGE_PLAN_DROPPED_7635_TUNING). Slukket er reglen ovenfor uaendret.
//        - rutepunkt (top af en stigning / de sidste km): ved den segmentgraense der
//          ligger naermest punktet, dvs. ved segmentets start naar mindst halvdelen
//          af segmentet ligger efter punktet. Flere punkter kan passeres i samme
//          segment; kaeden rykker saa frem led for led i orden. Toppen af en
//          stigning ER en segmentgraense, saa den rammes praecist.
//        - #7333: i etapens sidste segment er maalstregen den sidste graense. Et
//          punkt i segmentets anden halvdel skifter derfor til finalen
//          (advanceStagePlanAtFinish), lige foer opgoerelsen ved maal, og ikke ved
//          segmentets start (et langt sidste segment gav ellers "de sidste 10 km"
//          mange km for tidligt). Er etapen kun ét segment, gaelder samme regel
//          (kun rutepunkter ved start, aldrig "sat").
//        - #7383 (slukket motorkontakt, engine/v4/adapters/finalKmBoundary7383.ts): med
//          kontakten taendt er "de sidste 10 km" altid en segmentgraense (undtagen paa en
//          nedkoersel). Punktet er saa starten af et segment, og reglen ovenfor skifter
//          ALLE opgaver praecis dér; finale-undtagelsen (advanceStagePlanAtFinish og
//          holdarbejdets SEGMENT_WORK_TASKS) rammer aldrig "de sidste 10 km". Den bliver
//          staaende for de punkter der stadig kan ligge midt i sidste segment (en
//          nedkoerselsfinale), og slukket er alt her uaendret.
//   4. Opgavens indsats (TASK_EFFORT) erstatter rytterens `effort` for segmentet.
//      Intet andet felt paa rytteren roeres. Udbrudsforsoeg og sprinttog kommer
//      fra de udledte ordre-felter (stagePlan.legacyOrderFromPlan), som motoren
//      allerede laeser.
//   5. Hvert skift skrives som et `stage_plan_leg`-event paa segmentets start-km
//      (rider_id, led, opgave, aarsag). Fog of war: ingen tal ud over km.
//      Opsummeringen efter etapen laeser kun disse events. #6350: km er hvor opgaven
//      skifter; hvor han reelt blev sat laegges paa som exact_km (raceTimeline.withEventPlaces).
//
// #5982: en luksushjaelper uden gemt plan faar sin standardplan her
// (mechanics/luxuryHelper5982.ts, samme forslag som fladen viser).
//
// #7333 (Codex-review): undtagelsen er holdarbejde (SEGMENT_WORK_TASKS). Det virker i
// segmentets mekanik og ikke i finalen, saa paa sidste segment skifter det ved start.
//
// Uden en stage_plan-ordre og uden en luksushjaelper returnerer createStagePlanRuntime
// null, og loopet er byte-identisk med foer.

import type { EffortLevel, EngineState, Entrant, RaceGroup, RouteV2, Segment, TeamOrder, TimelineEvent } from "./engine/v4/types.ts";
import {
  JERSEY_HUNT_TASKS,
  STAGE_PLAN_FINAL_KM,
  TASK_EFFORT,
  legHuntTask,
  stretchHasHuntPassage,
  validateStagePlanLegs,
  type StagePlanLeg,
  type StagePlanRole,
  type StagePlanRoute,
  type StagePlanTask,
} from "./stagePlan.ts";
import { luxuryHelperDefaultPlans } from "./engine/v4/mechanics/luxuryHelper5982.ts"; // #5982
import { STAGE_PLAN_DROPPED_7635_TUNING } from "./engine/v4/tuning.ts"; // #7635

export const STAGE_PLAN_ORDER_KIND = "stage_plan";
export const STAGE_PLAN_LEG_EVENT = "stage_plan_leg";
/** #7855: rytteren koerte planen uden troejejagt, fordi opgaverne ikke gjaldt i dette loeb. */
export const STAGE_PLAN_HUNT_FALLBACK_EVENT = "stage_plan_hunt_fallback";

/** #7333: opgaver hvis virkning er segmentets holdarbejde, ikke opgoerelsen ved maal. */
const SEGMENT_WORK_TASKS: ReadonlySet<StagePlanTask> = new Set<StagePlanTask>(["tempo", "shelter_leader"]);

export type StagePlanSwitchReason = "kom" | "final_km" | "dropped" | "caught" | "missed_break";

type ResolvedLeg = {
  task: StagePlanTask;
  effort: EffortLevel;
  /** #7855: den jagt-opgave leddet koerer (et jagt-led, eller et udbrudsled med jagt, valg A), ellers null. */
  hunt: StagePlanTask | null;
  /** Rutepunktets km, eller null for foerste led og sat-leddet. */
  fromKm: number | null;
  fromDropped: boolean;
  routeReason: "kom" | "final_km" | null;
};

export type StagePlanRuntime = {
  legs: Map<string, ResolvedLeg[]>;
  current: Map<string, number>;
  /** Ryttere der har vaeret i et udbrud paa etapen (hentet vs. kom ikke med). */
  everInEscape: Set<string>;
  /** De led hver rytter faktisk har redet (foerste led altid). */
  ridden: Map<string, Set<number>>;
  riderIds: string[];
  /** #7635 (KUN kontakten stage_plan_dropped_front_7635): "sat"-reglens hukommelse. Udeladt = som foer. */
  front7635?: Front7635State;
  /** #7855 (KUN kontakten): rutens passager, saa et jagt-led er aktivt i de segmenter hans passager ligger i. Udeladt = som foer. */
  huntRoute7855?: StagePlanRoute;
  /** #7855: ryttere der koerer planen uden jagt (se createStagePlanRuntime). Udeladt = ingen. */
  huntFallback7855?: string[];
  /**
   * #7855 valg 3 (ejer 13/11, "Samme pris", KUN kontakten): hjaelpere med "Gaa i udbrud + Hent point"
   * (`eligible`), og dem af dem, der ikke kom med i udbruddet og derfor jagede fra feltet (`fromField`).
   * Udeladt = ingen saadan rytter (bit-identisk).
   */
  missedBreakHunt7855?: { eligible: ReadonlySet<string>; fromField: Set<string> };
};

/**
 * #7635: hvad "sat"-reglen husker mellem segmentgraenserne (kun med kontakten).
 *  - attackGroups: grupper opstaaet ved et angreb (udbrud, nedkoerselsangreb, finale- og
 *    kontraangreb), set ud fra hvordan gruppen opstod: den laa foran den gruppe rytterne kom fra.
 *  - streak: segmentgraenser i traek hvor rytteren laa reelt bag fronten.
 */
export type Front7635State = {
  prevGroupOf: Map<string, string> | null;
  seen: Set<string>;
  attackGroups: Set<string>;
  streak: Map<string, number>;
};

// #7239: delt kaptajn valideres som leder (stagePlan.ts), ikke som fri rolle.
const ROLES: ReadonlySet<string> = new Set(["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"]);

/**
 * Rutens skift-punkter fra motorens egne vejpunkter (samme index som race_stage_profiles.climbs).
 * #7855 (slukket): med `jerseyHunt7855` baerer ruten ogsaa de indlagte spurter og kontakten, saa
 * troejejagtens opgaver findes. Uden den er ruten praecis som foer.
 */
export function stagePlanRouteFromV4(route: RouteV2, opts: { jerseyHunt7855?: boolean } = {}): StagePlanRoute {
  const komWaypoints = route.waypoints.filter((w) => w.kind === "kom");
  const base: StagePlanRoute = {
    distance_km: route.distance_km,
    profile_type: route.profile_type,
    climbs: komWaypoints
      .filter((w) => w.summit_finish !== true && w.category !== undefined && Number.isFinite(w.km) && w.km > 0 && w.km < route.distance_km)
      .map((w) => ({ index: w.index, km: w.km, name: w.name ?? null, category: String(w.category) }))
      .sort((a, b) => a.km - b.km || a.index - b.index),
    summit_finish: komWaypoints.some((w) => w.summit_finish === true),
  };
  if (opts.jerseyHunt7855 !== true) return base;
  const sprints = route.waypoints
    .filter((w) => w.kind === "sprint" && Number.isFinite(w.km) && w.km > 0 && w.km < route.distance_km)
    .map((w) => ({ index: w.index, km: w.km, name: w.name ?? null }))
    .sort((a, b) => a.km - b.km || a.index - b.index);
  return { ...base, sprints, jersey_hunt_7855: true };
}

function resolveLegs(legs: readonly StagePlanLeg[], route: StagePlanRoute): ResolvedLeg[] {
  return legs.map((leg) => {
    const from = leg.from;
    let fromKm: number | null = null;
    let routeReason: ResolvedLeg["routeReason"] = null;
    if (from?.at === "final_km") {
      fromKm = Math.max(0, route.distance_km - STAGE_PLAN_FINAL_KM);
      routeReason = "final_km";
    } else if (from?.at === "kom") {
      fromKm = route.climbs.find((c) => c.index === from.kom_index)?.km ?? null;
      routeReason = "kom";
    }
    return { task: leg.task, effort: TASK_EFFORT[leg.task] as EffortLevel, hunt: legHuntTask(leg), fromKm, fromDropped: from?.at === "dropped", routeReason };
  });
}

/**
 * Laes etapens planer. null naar ingen gyldig plan findes (loopet er da uroert).
 * Deterministisk: rytterne behandles altid i rider_id-orden.
 */
export function createStagePlanRuntime(
  orders: readonly TeamOrder[],
  route: RouteV2,
  entrants: Readonly<Record<string, Entrant>>,
  opts: { droppedFront7635?: boolean; jerseyHunt7855?: boolean } = {},
): StagePlanRuntime | null {
  const planRoute = stagePlanRouteFromV4(route, { jerseyHunt7855: opts.jerseyHunt7855 === true }); // #7855 (slukket)
  const legs = new Map<string, ResolvedLeg[]>();
  const huntFallback: string[] = []; // #7855
  for (const order of orders) {
    if (order.kind !== STAGE_PLAN_ORDER_KIND) continue;
    const riders = order.params?.["riders"];
    if (!Array.isArray(riders)) continue;
    for (const raw of riders) {
      if (!raw || typeof raw !== "object") continue;
      const riderId = (raw as Record<string, unknown>)["rider_id"];
      const plan = (raw as Record<string, unknown>)["legs"];
      if (typeof riderId !== "string" || legs.has(riderId)) continue;
      const entrant = entrants[riderId];
      // Kun hold-egne ryttere: en ordre kan aldrig styre et andet holds rytter.
      if (!entrant || String(entrant.team_id ?? "") !== String(order.team_id)) continue;
      const role = ROLES.has(entrant.role) ? (entrant.role as StagePlanRole) : "free_role";
      if (validateStagePlanLegs(plan, role, planRoute) !== null) {
        // #7855: en plan med troejejagt har sin egen udgave uden jagt med fra gemningen. Den koeres,
        // naar jagten ikke gaelder (kontakten slukket foer foerste etape, eller "stop"). Andre
        // ugyldige planer har ingen, og ignoreres helt som hidtil.
        const fallback = (raw as Record<string, unknown>)["fallback_legs"];
        if (!Array.isArray(fallback) || validateStagePlanLegs(fallback, role, planRoute) !== null) continue;
        legs.set(riderId, resolveLegs(fallback as StagePlanLeg[], planRoute));
        huntFallback.push(riderId);
        continue;
      }
      legs.set(riderId, resolveLegs(plan as StagePlanLeg[], planRoute));
    }
  }
  // #5982: en luksushjaelper uden gemt plan koerer sin standardplan (rollen er en genvej
  // til etapeplanen). Uden en luksushjaelper i feltet: ingen aendring (byte-identisk).
  for (const [riderId, plan] of luxuryHelperDefaultPlans(planRoute, entrants, (id) => legs.has(id))) {
    legs.set(riderId, resolveLegs(plan, planRoute));
  }
  if (legs.size === 0) return null;
  const riderIds = [...legs.keys()].sort();
  const rt: StagePlanRuntime = { legs, current: new Map(riderIds.map((id) => [id, 0])), everInEscape: new Set(), ridden: new Map(riderIds.map((id) => [id, new Set([0])])), riderIds };
  // #7635: kun med kontakten; slukket har runtime'en praecis de samme felter som foer.
  if (opts.droppedFront7635 === true) rt.front7635 = { prevGroupOf: null, seen: new Set(), attackGroups: new Set(), streak: new Map() };
  if (opts.jerseyHunt7855 === true) rt.huntRoute7855 = planRoute; // #7855
  if (huntFallback.length > 0) rt.huntFallback7855 = huntFallback.sort(); // #7855
  // #7855 valg 3 (ejer 13/11): den forsigtige laesning (dommerens S5, S6, S7 er aabne ejer-valg):
  // kun hjaelperen og kun "Hent point" paa udbrudsleddet; kun traetheden efter etapen aendres.
  if (opts.jerseyHunt7855 === true) {
    const eligible = riderIds.filter((id) => entrants[id]?.role === "helper" && legs.get(id)![0].task === "breakaway" && legs.get(id)![0].hunt === "hunt_points");
    if (eligible.length > 0) rt.missedBreakHunt7855 = { eligible: new Set(eligible), fromField: new Set() };
  }
  return rt;
}

function isEscape(group: RaceGroup): boolean {
  return group.origin === "breakaway" && (group.kind === "breakaway" || group.kind === "solo");
}

function groupOf(groups: readonly RaceGroup[], riderId: string): RaceGroup | undefined {
  return groups.find((g) => g.rider_ids.includes(riderId));
}

function teamLeaderId(riderId: string, state: EngineState, entrants: Readonly<Record<string, Entrant>>): string | null {
  const team = entrants[riderId]?.team_id;
  if (team == null || team === "") return null;
  const racing = (id: string) => state.riders[id]?.status === "racing";
  const teamIds = Object.keys(entrants).filter((id) => entrants[id].team_id === team && racing(id)).sort();
  return teamIds.find((id) => entrants[id].role === "captain")
    // #7239: er kaptajnen ude, kører holdet for den delte kaptajn (spec §5, "vejen afgør").
    ?? teamIds.find((id) => entrants[id].role === "co_captain")
    ?? teamIds.find((id) => entrants[id].role === "sprint_captain")
    ?? null;
}

/** Er rytteren sat? Se filens hoved, punkt 3. */
export function isRiderDropped(riderId: string, state: EngineState, entrants: Readonly<Record<string, Entrant>>): boolean {
  const own = groupOf(state.groups, riderId);
  if (!own || isEscape(own)) return false;
  let reference: RaceGroup | undefined;
  const leader = teamLeaderId(riderId, state, entrants);
  if (leader && leader !== riderId) {
    const leaderGroup = groupOf(state.groups, leader);
    if (leaderGroup && !isEscape(leaderGroup)) reference = leaderGroup;
  }
  if (!reference) {
    reference = state.groups
      .filter((g) => !isEscape(g) && g.rider_ids.length > 0)
      .reduce<RaceGroup | undefined>((best, g) => (!best || g.gap_seconds < best.gap_seconds ? g : best), undefined);
  }
  return reference !== undefined && reference.id !== own.id && own.gap_seconds > reference.gap_seconds;
}

/**
 * #7635: noter feltets grupper ved en segmentgraense og afgoer hvilke der er opstaaet ved
 * et angreb. En rigtig opdeling (stigning, brosten, uheld) saetter altid de afhaengte BAG
 * den gruppe de kom fra; et angreb saetter angriberne FORAN. Derfor:
 *  - en ny gruppe er et angreb naar den ligger foran alle de grupper, resten af rytterne fra
 *    dens kildegrupper nu sidder i, eller naar de fleste af dens ryttere kom fra et angreb;
 *  - en kendt angrebsgruppe holder op med at vaere det, naar den har opslugt en rigtig gruppe
 *    (de fleste af den gruppes ryttere sidder nu i angrebets id), uanset hvor stor den rigtige
 *    gruppe var (Codex-review). Et merge beholder den forreste gruppes id, saa uden den regel
 *    ville feltet eller en jagtgruppe arve angrebets id og maerke. Enkelte ryttere der slutter
 *    sig til (et kontraangreb) aendrer intet.
 * Ren funktion af tilstanden; ingen rng, deterministisk i gruppe-raekkefoelgen.
 */
export function observeGroups7635(f: Front7635State, groups: readonly RaceGroup[]): void {
  const prev = f.prevGroupOf;
  const groupOfNow = new Map<string, string>();
  for (const g of groups) for (const id of g.rider_ids) groupOfNow.set(id, g.id);
  const gapOf = new Map(groups.map((g) => [g.id, g.gap_seconds]));
  const next = new Set<string>();
  if (prev) {
    const cameFromAttack = (id: string) => {
      const p = prev.get(id);
      return p !== undefined && f.attackGroups.has(p);
    };
    // De rigtige grupper ved forrige graense og deres ryttere, der stadig er i loebet.
    const prevRegular = new Map<string, string[]>();
    for (const [id, p] of prev) {
      if (f.attackGroups.has(p) || !groupOfNow.has(id)) continue;
      if (!prevRegular.has(p)) prevRegular.set(p, []);
      prevRegular.get(p)!.push(id);
    }
    // Codex-review 2: en rigtig gruppe kan splittes og opsluges i SAMME segment (stigningen
    // koerer foer jagt og merge). Fronten beholder gruppens id og de afhaengte faar et nyt;
    // naar fronten saa samles med angrebet, forsvinder id'et ind i angrebets. Derfor taeller
    // det ogsaa som opslugt, naar den rigtige gruppes id er vaek og dens ryttere sidder i
    // angrebet. Et kontraangreb fra feltet laader feltets id staa og aendrer intet.
    const groupIdsNow = new Set(groups.map((g) => g.id));
    const absorbedRegular = (g: RaceGroup) => {
      for (const [p, ids] of prevRegular) {
        if (p === g.id) continue;
        const inG = ids.filter((id) => groupOfNow.get(id) === g.id).length;
        if (inG * 2 >= ids.length) return true;
        if (inG > 0 && !groupIdsNow.has(p)) return true;
      }
      return false;
    };
    for (const g of groups) {
      if (g.rider_ids.length === 0) continue;
      const fromAttack = g.rider_ids.filter(cameFromAttack).length * 2 >= g.rider_ids.length;
      if (f.seen.has(g.id)) {
        if (f.attackGroups.has(g.id) && !absorbedRegular(g)) next.add(g.id);
        continue;
      }
      if (fromAttack) {
        next.add(g.id);
        continue;
      }
      const members = new Set(g.rider_ids);
      const sources = new Set(g.rider_ids.map((id) => prev.get(id)).filter((s): s is string => s !== undefined));
      let restMinGap = Infinity;
      for (const [id, src] of prev) {
        if (!sources.has(src) || members.has(id)) continue;
        const now = groupOfNow.get(id);
        if (now !== undefined) restMinGap = Math.min(restMinGap, gapOf.get(now) ?? Infinity);
      }
      if (Number.isFinite(restMinGap) && g.gap_seconds < restMinGap) next.add(g.id);
    }
  }
  for (const g of groups) f.seen.add(g.id);
  f.attackGroups = next;
  f.prevGroupOf = groupOfNow;
}

function isAttackGroup7635(group: RaceGroup, attackGroups: ReadonlySet<string>): boolean {
  return group.origin === "breakaway" || group.origin === "descent" || attackGroups.has(group.id);
}

/**
 * #7635 (KUN kontakten): ligger rytteren reelt bag fronten ved denne segmentgraense?
 * Kun en rigtig opdeling af feltet kan vaere fronten: en gruppe opstaaet ved et angreb er
 * aldrig referencen, og en rytter i en angrebsgruppe er aldrig sat. Afstanden skal vaere
 * reel (STAGE_PLAN_DROPPED_7635_TUNING). At den holder, afgoer advanceStagePlan.
 */
export function isRiderBehindFront7635(
  riderId: string,
  state: EngineState,
  entrants: Readonly<Record<string, Entrant>>,
  attackGroups: ReadonlySet<string>,
): boolean {
  const own = groupOf(state.groups, riderId);
  if (!own || isAttackGroup7635(own, attackGroups)) return false;
  let reference: RaceGroup | undefined;
  const leader = teamLeaderId(riderId, state, entrants);
  if (leader && leader !== riderId) {
    const leaderGroup = groupOf(state.groups, leader);
    if (leaderGroup && !isAttackGroup7635(leaderGroup, attackGroups)) reference = leaderGroup;
  }
  if (!reference) {
    reference = state.groups
      .filter((g) => !isAttackGroup7635(g, attackGroups) && g.rider_ids.length > 0)
      .reduce<RaceGroup | undefined>((best, g) => (!best || g.gap_seconds < best.gap_seconds ? g : best), undefined);
  }
  return reference !== undefined && reference.id !== own.id && own.gap_seconds - reference.gap_seconds >= STAGE_PLAN_DROPPED_7635_TUNING.minGapSeconds;
}

/**
 * Skift ved segmentets start (tilstanden er udgangen af det forrige segment).
 * Returnerer skift-events; opdaterer runtime'ens led-pegere.
 */
export function advanceStagePlan(
  rt: StagePlanRuntime,
  args: { state: EngineState; segment: Segment; segmentIndex: number; isLastSegment?: boolean; entrants: Readonly<Record<string, Entrant>> },
): TimelineEvent[] {
  const { state, segment, segmentIndex, isLastSegment = false, entrants } = args;
  const events: TimelineEvent[] = [];
  // #7635 (KUN kontakten): feltets grupper noteres ved hver graense, ogsaa ved start.
  const front = rt.front7635;
  if (front) observeGroups7635(front, state.groups);
  // #7855: en gang pr. etape, paa etapens start, saa opsummeringen kan sige det samme som motoren.
  if (segmentIndex === 0 && rt.huntFallback7855) {
    for (const riderId of rt.huntFallback7855) events.push({ km: 0, type: STAGE_PLAN_HUNT_FALLBACK_EVENT, params: { rider_id: riderId } });
  }
  // Foerste segment: intet forrige segment at laese tilstanden af. Er det OGSAA etapens
  // eneste segment (en flad etape kan genereres som ét stykke), skifter et rutepunkt i
  // segmentets foerste halvdel ved start; resten tager finalen (advanceStagePlanAtFinish).
  // "Sat" afgoeres aldrig ved start (ingen grupper endnu).
  if (segmentIndex === 0 && !isLastSegment) return events;
  const atStart = segmentIndex === 0;
  // #7333: naermeste graense, ogsaa i etapens sidste segment (maalstregen er dens sidste
  // graense, og et punkt i anden halvdel skifter til finalen, se filens hoved).
  const midKm = segment.from_km + (segment.to_km - segment.from_km) / 2;
  // Codex-review #7333: holdarbejde (tempo, hold lederen fremme) virker i segmentets
  // mekanik, ikke i opgoerelsen ved maal. Paa etapens sidste segment skifter det derfor
  // stadig ved segmentets start, saa hjaelperen faktisk koerer det arbejde han faar.
  const switchPointKm = (task: StagePlanTask) => (isLastSegment && SEGMENT_WORK_TASKS.has(task) ? segment.to_km : midKm);
  // #7855 (reviewfund, KUN kontakten): passager afgoeres pr. segment med opgaven ved segmentets
  // start. Et jagt-led med en passage paa sin straekning i dette segment skal derfor vaere aktivt
  // nu: det starter ved segmentets start, ogsaa naar punktet ligger i anden halvdel (ellers er
  // spurten koert, foer han skifter), og det slipper ikke foer segmentet er forbi. Hvilken
  // passage han kaemper om, afgoer stadig straekningen (stagePlanHuntWindows7855).
  const huntRoute = rt.huntRoute7855;
  const huntHasPassageHere = (leg: ResolvedLeg, fromKm: number, toKm: number) => {
    const kind = leg.hunt ? JERSEY_HUNT_TASKS[leg.hunt] : undefined; // #7855: ogsaa udbrudsleddets jagt (valg A)
    return huntRoute !== undefined && kind !== undefined && stretchHasHuntPassage(huntRoute, kind, Math.max(fromKm, segment.from_km), Math.min(toKm, segment.to_km));
  };
  const switchesNow = (next: ResolvedLeg) => {
    const fromKm = next.fromKm as number;
    return fromKm <= switchPointKm(next.task) || huntHasPassageHere(next, fromKm, segment.to_km);
  };
  const holdsForHunt = (leg: ResolvedLeg, nextFromKm: number) => huntHasPassageHere(leg, leg.fromKm ?? 0, nextFromKm);
  for (const riderId of rt.riderIds) {
    if (state.riders[riderId]?.status !== "racing") continue;
    const legs = rt.legs.get(riderId)!;
    const cur = rt.current.get(riderId) ?? 0;
    const group = groupOf(state.groups, riderId);
    const inEscape = group !== undefined && isEscape(group);
    if (inEscape) rt.everInEscape.add(riderId);

    const droppedIdx = legs.findIndex((l) => l.fromDropped);
    const breakawayLeg = legs[cur].task === "breakaway";
    // #7635 (KUN kontakten): "sat" kun bag en rigtig front, og kun naar afstanden har holdt.
    let behind7635 = false;
    if (front) {
      const streak = isRiderBehindFront7635(riderId, state, entrants, front.attackGroups) ? (front.streak.get(riderId) ?? 0) + 1 : 0;
      front.streak.set(riderId, streak);
      behind7635 = streak >= STAGE_PLAN_DROPPED_7635_TUNING.consecutiveChecks;
    }
    const dropped = breakawayLeg ? !inEscape : (front ? behind7635 : isRiderDropped(riderId, state, entrants));
    let next = cur;
    let reason: StagePlanSwitchReason | null = null;
    if (!atStart && droppedIdx > cur && dropped) {
      next = droppedIdx;
      reason = breakawayLeg ? (rt.everInEscape.has(riderId) ? "caught" : "missed_break") : "dropped";
    } else {
      while (next + 1 < legs.length && legs[next + 1].fromKm !== null && switchesNow(legs[next + 1]) && !holdsForHunt(legs[next], legs[next + 1].fromKm as number)) {
        next += 1;
        reason = legs[next].routeReason;
      }
    }
    // #7855 valg 3: koerer han segmentet paa udbrudsleddet med jagt uden nogensinde at have vaeret i
    // udbruddet, jager han fra feltet. Kun noteret; loebet er uaendret (se stagePlanLoadEfforts).
    const missed = rt.missedBreakHunt7855;
    if (missed && !atStart && missed.eligible.has(riderId) && !inEscape && !rt.everInEscape.has(riderId)) {
      const legNow = legs[next !== cur && reason !== null ? next : cur];
      if (legNow.task === "breakaway" && legNow.hunt !== null) missed.fromField.add(riderId);
    }
    if (next === cur || reason === null) continue;
    rt.current.set(riderId, next);
    rt.ridden.get(riderId)?.add(next);
    events.push({
      km: Math.round(segment.from_km * 100) / 100,
      type: STAGE_PLAN_LEG_EVENT,
      params: { rider_id: riderId, leg: next, task: legs[next].task, reason },
    });
  }
  return events;
}

/**
 * #7333: finalen paa etapens sidste segment. Et rutepunkt der ligger i segmentets anden
 * halvdel (naermere maalstregen end segmentets start) skifter her, lige foer opgoerelsen
 * ved maal, saa "de sidste 10 km" aldrig koeres fra starten af et langt sidste segment.
 * "Sat" afgoeres ikke her (det sker kun ved segmentgraenser, ud fra tilstanden der).
 * Eventet staar paa punktets km (de sidste km ligger i finalen), aldrig foer segmentet.
 * null naar ingen skifter: finalen ser da praecis den samme startliste som foer.
 */
export function advanceStagePlanAtFinish(
  rt: StagePlanRuntime,
  args: { state: EngineState; segment: Segment; entrants: Readonly<Record<string, Entrant>> },
): { events: TimelineEvent[]; entrants: Record<string, Entrant> } | null {
  const { state, segment, entrants } = args;
  const events: TimelineEvent[] = [];
  for (const riderId of rt.riderIds) {
    if (state.riders[riderId]?.status !== "racing") continue;
    const legs = rt.legs.get(riderId)!;
    const cur = rt.current.get(riderId) ?? 0;
    let next = cur;
    while (next + 1 < legs.length && legs[next + 1].fromKm !== null && (legs[next + 1].fromKm as number) <= segment.to_km) next += 1;
    if (next === cur) continue;
    rt.current.set(riderId, next);
    rt.ridden.get(riderId)?.add(next);
    const km = Math.max(segment.from_km, legs[cur + 1].fromKm as number);
    events.push({
      km: Math.round(km * 100) / 100,
      type: STAGE_PLAN_LEG_EVENT,
      // Codex-review #7333: at_finish = skiftet gaelder kun finalen. Segmentets egne
      // mekanikker (fx stigningens split ved segment.to_km) koerte paa det forrige led.
      params: { rider_id: riderId, leg: next, task: legs[next].task, reason: legs[next].routeReason as StagePlanSwitchReason, at_finish: true },
    });
  }
  return events.length ? { events, entrants: stagePlanEntrants(rt, entrants) } : null;
}

/** Startlisten for segmentet: planens indsats paa de ryttere der har en plan. */
export function stagePlanEntrants(
  rt: StagePlanRuntime,
  base: Readonly<Record<string, Entrant>>,
): Record<string, Entrant> {
  const out: Record<string, Entrant> = { ...base };
  for (const riderId of rt.riderIds) {
    const entrant = base[riderId];
    if (!entrant) continue;
    const effort = rt.legs.get(riderId)![rt.current.get(riderId) ?? 0].effort;
    if (effort !== entrant.effort) out[riderId] = { ...entrant, effort };
  }
  return out;
}

/** #7380: den opgave hver rytter med plan koerer segmentet med (samme led som stagePlanEntrants). */
export function stagePlanCurrentTasks(rt: StagePlanRuntime): Record<string, StagePlanTask> {
  const out: Record<string, StagePlanTask> = {};
  for (const riderId of rt.riderIds) out[riderId] = rt.legs.get(riderId)![rt.current.get(riderId) ?? 0].task;
  return out;
}

/**
 * #7855: straekningen hver rytter paa et jagt-led kaemper paa (som valideringen: efter leddets
 * rutepunkt, til og med naeste leds rutepunkt). undefined uden kontakten eller uden jaegere.
 */
export function stagePlanHuntWindows7855(rt: StagePlanRuntime): Record<string, { fromKm: number; toKm: number }> | undefined {
  if (!rt.huntRoute7855) return undefined;
  let out: Record<string, { fromKm: number; toKm: number }> | undefined;
  for (const riderId of rt.riderIds) {
    const legs = rt.legs.get(riderId)!;
    const cur = rt.current.get(riderId) ?? 0;
    if (!legs[cur].hunt) continue;
    out ??= {};
    out[riderId] = { fromKm: legs[cur].fromKm ?? 0, toKm: legs[cur + 1]?.fromKm ?? Infinity };
  }
  return out;
}

/**
 * #7855: den jagt-opgave hver rytter koerer segmentet med (et jagt-led, eller udbrudsleddets jagt,
 * valg A). Passagerne laeser den i stedet for selve opgaven, saa en udbrudsrytter med jagt bade
 * proever udbruddet (opgaven er stadig "breakaway") og koerer om pointene. undefined uden
 * kontakten eller uden jaegere (samme betingelse som stagePlanHuntWindows7855).
 */
export function stagePlanHuntTasks7855(rt: StagePlanRuntime): Record<string, StagePlanTask> | undefined {
  if (!rt.huntRoute7855) return undefined;
  let out: Record<string, StagePlanTask> | undefined;
  for (const riderId of rt.riderIds) {
    const hunt = rt.legs.get(riderId)![rt.current.get(riderId) ?? 0].hunt;
    if (!hunt) continue;
    out ??= {};
    out[riderId] = hunt;
  }
  return out;
}

const EFFORT_RANK: Readonly<Record<EffortLevel, number>> = { grupetto: 0, save: 1, normal: 2, protect: 3, all_out: 4 };

/**
 * Etapens belastning (traethed bagefter, model C) kender kun EN indsats pr. rytter.
 * Med en plan er det den haardeste indsats han faktisk har koert: et sent angreb
 * kan aldrig koeres paa et tidligt leds billige traethed (intet smuthul).
 * #7855: et jagt-led taeller med den indsats, det koeres med i loebet, som ethvert andet led, saa
 * jagten aldrig er en billigere vej til samme loeb (dom 2, "frikortet"). Passagerne opgaven fik
 * ham til at koere med om, koster oveni (valg C, raceFatigue.stageWorkExposure).
 */
export function stagePlanLoadEfforts(rt: StagePlanRuntime): Record<string, EffortLevel> {
  const out: Record<string, EffortLevel> = {};
  for (const riderId of rt.riderIds) {
    const legs = rt.legs.get(riderId)!;
    let best: EffortLevel = legs[0].effort;
    for (const idx of rt.ridden.get(riderId) ?? []) if (EFFORT_RANK[legs[idx].effort] > EFFORT_RANK[best]) best = legs[idx].effort;
    // #7855 valg 3 (ejer 13/11, "Samme pris"): jagten fra feltet efter et misset udbrud koster det
    // samme som "Hent point" alene, saa den taeller med jagt-opgavens indsats.
    if (rt.missedBreakHunt7855?.fromField.has(riderId)) {
      const huntEffort = TASK_EFFORT[legs[0].hunt as StagePlanTask] as EffortLevel;
      if (EFFORT_RANK[huntEffort] > EFFORT_RANK[best]) best = huntEffort;
    }
    out[riderId] = best;
  }
  return out;
}

/** Indsatsen i rytterens sidste led (juryen laeser den, fx grupetto). */
export function stagePlanFinalEfforts(rt: StagePlanRuntime): Record<string, EffortLevel> {
  const out: Record<string, EffortLevel> = {};
  for (const riderId of rt.riderIds) out[riderId] = rt.legs.get(riderId)![rt.current.get(riderId) ?? 0].effort;
  return out;
}

/**
 * Ordre-adapterens side (orders/teamOrdersAdapter.ts): ét holds gemte kaeder som en
 * `stage_plan`-ordre. KUN under s5_profiles_v3; ellers null, saa aeldre revisioner
 * faar praecis de samme ordrer som foer. Kaederne valideres foerst i motoren
 * (createStagePlanRuntime), her flyttes de kun.
 */
export function stagePlanOrderFromRow(
  teamId: string,
  row: { riders?: unknown } | undefined,
  rulesRevision: unknown,
  isV3: (revision: unknown) => boolean,
): TeamOrder | null {
  if (!row || !isV3(rulesRevision) || !Array.isArray(row.riders)) return null;
  const riders: Array<{ rider_id: string; legs: unknown; fallback_legs?: unknown }> = [];
  for (const r of row.riders) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    if (typeof rec["rider_id"] !== "string" || !Array.isArray(rec["plan"])) continue;
    // #7855: kun raekker gemt med en jagt-opgave baerer plan_no_hunt; alle andre er uaendrede.
    riders.push({ rider_id: rec["rider_id"], legs: rec["plan"], ...(Array.isArray(rec["plan_no_hunt"]) ? { fallback_legs: rec["plan_no_hunt"] } : {}) });
  }
  return riders.length ? { team_id: teamId, kind: STAGE_PLAN_ORDER_KIND, params: { riders } } : null;
}
