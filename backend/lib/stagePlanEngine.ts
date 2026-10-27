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
//        - rutepunkt (top af en stigning / de sidste km): naar mindst halvdelen af
//          segmentet ligger efter punktet. Flere punkter kan passeres i samme
//          segment; kaeden rykker saa frem led for led i orden. I etapens sidste
//          segment skifter et punkt inde i det ved segmentets start; er etapen kun
//          ét segment, gaelder det ogsaa segment 1 (kun rutepunkter, aldrig "sat").
//   4. Opgavens indsats (TASK_EFFORT) erstatter rytterens `effort` for segmentet.
//      Intet andet felt paa rytteren roeres. Udbrudsforsoeg og sprinttog kommer
//      fra de udledte ordre-felter (stagePlan.legacyOrderFromPlan), som motoren
//      allerede laeser.
//   5. Hvert skift skrives som et `stage_plan_leg`-event paa segmentets start-km
//      (rider_id, led, opgave, aarsag). Fog of war: ingen tal ud over km.
//      Opsummeringen efter etapen laeser kun disse events.
//
// Uden en stage_plan-ordre returnerer createStagePlanRuntime null, og loopet er
// byte-identisk med foer.

import type { EffortLevel, EngineState, Entrant, RaceGroup, RouteV2, Segment, TeamOrder, TimelineEvent } from "./engine/v4/types.ts";
import {
  STAGE_PLAN_FINAL_KM,
  TASK_EFFORT,
  validateStagePlanLegs,
  type StagePlanLeg,
  type StagePlanRole,
  type StagePlanRoute,
  type StagePlanTask,
} from "./stagePlan.ts";

export const STAGE_PLAN_ORDER_KIND = "stage_plan";
export const STAGE_PLAN_LEG_EVENT = "stage_plan_leg";

export type StagePlanSwitchReason = "kom" | "final_km" | "dropped" | "caught" | "missed_break";

type ResolvedLeg = {
  task: StagePlanTask;
  effort: EffortLevel;
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
};

// #7239: delt kaptajn valideres som leder (stagePlan.ts), ikke som fri rolle.
const ROLES: ReadonlySet<string> = new Set(["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"]);

/** Rutens skift-punkter fra motorens egne vejpunkter (samme index som race_stage_profiles.climbs). */
export function stagePlanRouteFromV4(route: RouteV2): StagePlanRoute {
  const komWaypoints = route.waypoints.filter((w) => w.kind === "kom");
  return {
    distance_km: route.distance_km,
    profile_type: route.profile_type,
    climbs: komWaypoints
      .filter((w) => w.summit_finish !== true && w.category !== undefined && Number.isFinite(w.km) && w.km > 0 && w.km < route.distance_km)
      .map((w) => ({ index: w.index, km: w.km, name: w.name ?? null, category: String(w.category) }))
      .sort((a, b) => a.km - b.km || a.index - b.index),
    summit_finish: komWaypoints.some((w) => w.summit_finish === true),
  };
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
    return { task: leg.task, effort: TASK_EFFORT[leg.task] as EffortLevel, fromKm, fromDropped: from?.at === "dropped", routeReason };
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
): StagePlanRuntime | null {
  const planRoute = stagePlanRouteFromV4(route);
  const legs = new Map<string, ResolvedLeg[]>();
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
      if (validateStagePlanLegs(plan, role, planRoute) !== null) continue;
      legs.set(riderId, resolveLegs(plan as StagePlanLeg[], planRoute));
    }
  }
  if (legs.size === 0) return null;
  const riderIds = [...legs.keys()].sort();
  return { legs, current: new Map(riderIds.map((id) => [id, 0])), everInEscape: new Set(), ridden: new Map(riderIds.map((id) => [id, new Set([0])])), riderIds };
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
 * Skift ved segmentets start (tilstanden er udgangen af det forrige segment).
 * Returnerer skift-events; opdaterer runtime'ens led-pegere.
 */
export function advanceStagePlan(
  rt: StagePlanRuntime,
  args: { state: EngineState; segment: Segment; segmentIndex: number; isLastSegment?: boolean; entrants: Readonly<Record<string, Entrant>> },
): TimelineEvent[] {
  const { state, segment, segmentIndex, isLastSegment = false, entrants } = args;
  const events: TimelineEvent[] = [];
  // Foerste segment: intet forrige segment at laese tilstanden af. Er det OGSAA etapens
  // eneste segment (en flad etape kan genereres som ét stykke), gaelder sidste-segment-
  // reglen nedenfor for rutepunkterne, ellers ville et gyldigt led aldrig koeres. "Sat"
  // afgoeres aldrig ved start (ingen grupper endnu).
  if (segmentIndex === 0 && !isLastSegment) return events;
  const atStart = segmentIndex === 0;
  // Etapens sidste segment: et punkt inde i det skifter ved segmentets start (der kommer
  // intet senere segment at skifte paa), saa et gyldigt sidste led altid koeres.
  const switchPointKm = isLastSegment ? segment.to_km - 1e-9 : segment.from_km + (segment.to_km - segment.from_km) / 2;
  for (const riderId of rt.riderIds) {
    if (state.riders[riderId]?.status !== "racing") continue;
    const legs = rt.legs.get(riderId)!;
    const cur = rt.current.get(riderId) ?? 0;
    const group = groupOf(state.groups, riderId);
    const inEscape = group !== undefined && isEscape(group);
    if (inEscape) rt.everInEscape.add(riderId);

    const droppedIdx = legs.findIndex((l) => l.fromDropped);
    const breakawayLeg = legs[cur].task === "breakaway";
    const dropped = breakawayLeg ? !inEscape : isRiderDropped(riderId, state, entrants);
    let next = cur;
    let reason: StagePlanSwitchReason | null = null;
    if (!atStart && droppedIdx > cur && dropped) {
      next = droppedIdx;
      reason = breakawayLeg ? (rt.everInEscape.has(riderId) ? "caught" : "missed_break") : "dropped";
    } else {
      while (next + 1 < legs.length && legs[next + 1].fromKm !== null && (legs[next + 1].fromKm as number) <= switchPointKm) {
        next += 1;
        reason = legs[next].routeReason;
      }
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

const EFFORT_RANK: Readonly<Record<EffortLevel, number>> = { grupetto: 0, save: 1, normal: 2, protect: 3, all_out: 4 };

/**
 * Etapens belastning (traethed bagefter, model C) kender kun EN indsats pr. rytter.
 * Med en plan er det den haardeste indsats han faktisk har koert: et sent angreb
 * kan aldrig koeres paa et tidligt leds billige traethed (intet smuthul).
 */
export function stagePlanLoadEfforts(rt: StagePlanRuntime): Record<string, EffortLevel> {
  const out: Record<string, EffortLevel> = {};
  for (const riderId of rt.riderIds) {
    const legs = rt.legs.get(riderId)!;
    let best: EffortLevel = legs[0].effort;
    for (const idx of rt.ridden.get(riderId) ?? []) if (EFFORT_RANK[legs[idx].effort] > EFFORT_RANK[best]) best = legs[idx].effort;
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
  const riders: Array<{ rider_id: string; legs: unknown }> = [];
  for (const r of row.riders) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    if (typeof rec["rider_id"] !== "string" || !Array.isArray(rec["plan"])) continue;
    riders.push({ rider_id: rec["rider_id"], legs: rec["plan"] });
  }
  return riders.length ? { team_id: teamId, kind: STAGE_PLAN_ORDER_KIND, params: { riders } } : null;
}
