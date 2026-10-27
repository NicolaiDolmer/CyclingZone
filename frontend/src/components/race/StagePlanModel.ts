// #7003: etapeplan langs ruten, frontendens kopi af kontrakten.
//
// SSOT er backend/lib/stagePlan.ts. Denne fil SKAL give samme svar (opgaver,
// roller, regler, assistentens forslag); backend/lib/stagePlan.parity.test.js
// sammenligner de to over et gitter af roller og ruter. Hertil kommer de rene
// UI-hjaelpere: hvilke valg et led kan faa, reparation efter et valg, og
// opsummeringen efter etapen ud fra tidslinjens stage_plan_leg-events.
//
// Fog of war: kun enum-vaerdier og km. Ingen tal fra motoren.

export const STAGE_PLAN_MAX_LEGS = 3;
export const STAGE_PLAN_FINAL_KM = 10;

export const STAGE_PLAN_TASKS = Object.freeze([
  "breakaway",
  "stay_sheltered",
  "shelter_leader",
  "tempo",
  "follow_moves",
  "attack",
  "ride_for_result",
  "sprint_train",
  "grupetto",
  "ride_in",
] as const);

export type StagePlanTask = (typeof STAGE_PLAN_TASKS)[number];
// #7239: delt kaptajn (#5981) er en leder som kaptajnen, ikke en fri rolle.
export type StagePlanRole = "captain" | "co_captain" | "sprint_captain" | "helper" | "hunter" | "free_role";
export type StagePlanEffort = "grupetto" | "save" | "normal" | "protect" | "all_out";
export type StagePlanTrigger = { at: "kom"; kom_index: number } | { at: "final_km" } | { at: "dropped" };
export type StagePlanLeg = { task: StagePlanTask; from?: StagePlanTrigger };
export type StagePlanClimb = { index: number; km: number; name: string | null; category: string };
export type StagePlanRoute = {
  distance_km: number;
  profile_type: string | null;
  climbs: readonly StagePlanClimb[];
  summit_finish?: boolean;
};

export const TASK_EFFORT: Readonly<Record<StagePlanTask, StagePlanEffort>> = Object.freeze({
  breakaway: "normal",
  stay_sheltered: "save",
  shelter_leader: "normal",
  tempo: "protect",
  follow_moves: "protect",
  attack: "all_out",
  ride_for_result: "normal",
  sprint_train: "normal",
  grupetto: "grupetto",
  ride_in: "save",
});

const ALL_ROLES: StagePlanRole[] = ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"];
const LEADERS: StagePlanRole[] = ["captain", "co_captain", "sprint_captain"];

export const TASK_ROLES: Readonly<Record<StagePlanTask, readonly StagePlanRole[]>> = Object.freeze({
  breakaway: ALL_ROLES,
  stay_sheltered: ALL_ROLES,
  shelter_leader: ["helper", "hunter"],
  tempo: ["helper", "hunter"],
  follow_moves: [...LEADERS, "free_role"],
  attack: [...LEADERS, "hunter", "free_role"],
  ride_for_result: [...LEADERS, "hunter", "free_role"],
  sprint_train: ["helper", "hunter"],
  grupetto: ["sprint_captain", "helper", "hunter", "free_role"],
  ride_in: ALL_ROLES,
});

export const TERMINAL_TASKS: ReadonlySet<StagePlanTask> = new Set<StagePlanTask>(["sprint_train", "grupetto", "ride_in"]);

const CATEGORIES = new Set(["HC", "1", "2", "3", "4"]);
const TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);

type Rec = Record<string, unknown>;

export function isStagePlanTask(value: unknown): value is StagePlanTask {
  return typeof value === "string" && (STAGE_PLAN_TASKS as readonly string[]).includes(value);
}

export function isTimeTrialProfile(profileType: unknown): boolean {
  return typeof profileType === "string" && TIME_TRIAL_PROFILES.has(profileType);
}

/**
 * Erstatter etapeplanen taktiktabellen paa denne etape? Aldrig paa en enkeltstart eller
 * holdtidskoersel: motoren bruger indsatsen dér, og de almindelige kontroller (og gemte
 * valg) skal blive staaende.
 */
export function stagePlanReplacesControls(enabled: boolean, profileType: unknown): boolean {
  return enabled === true && !isTimeTrialProfile(profileType);
}

export function stagePlanClimbsFromRaw(rawClimbs: unknown, distanceKm: number): StagePlanClimb[] {
  const list: unknown[] = Array.isArray(rawClimbs) ? rawClimbs : [];
  const out: StagePlanClimb[] = [];
  list.forEach((c, index) => {
    if (!c || typeof c !== "object") return;
    const climb = c as Rec;
    const km = Number(climb.crest_km ?? climb.km);
    const category = String(climb.category ?? "");
    if (!Number.isFinite(km) || !CATEGORIES.has(category)) return;
    if (climb.summit_finish === true) return;
    if (!(km > 0 && km < distanceKm)) return;
    out.push({ index, km, name: typeof climb.name === "string" ? climb.name : null, category });
  });
  return out.sort((a, b) => a.km - b.km || a.index - b.index);
}

export function stagePlanRouteFromRaw(raw: { distance_km?: unknown; profile_type?: unknown; climbs?: unknown } | null | undefined): StagePlanRoute {
  const distance = Number(raw?.distance_km);
  const distanceKm = Number.isFinite(distance) && distance > 0 ? distance : 0;
  const rawClimbs: unknown[] = Array.isArray(raw?.climbs) ? (raw?.climbs as unknown[]) : [];
  return {
    distance_km: distanceKm,
    profile_type: typeof raw?.profile_type === "string" ? raw.profile_type : null,
    climbs: stagePlanClimbsFromRaw(rawClimbs, distanceKm),
    summit_finish: rawClimbs.some((c) => !!c && typeof c === "object" && (c as Rec).summit_finish === true),
  };
}

export function triggerKm(trigger: StagePlanTrigger | undefined, route: StagePlanRoute): number | null {
  if (!trigger) return null;
  if (trigger.at === "final_km") return Math.max(0, route.distance_km - STAGE_PLAN_FINAL_KM);
  if (trigger.at === "kom") {
    const climb = route.climbs.find((c) => c.index === trigger.kom_index);
    return climb ? climb.km : null;
  }
  return null;
}

export function validateStagePlanLegs(legs: unknown, role: StagePlanRole, route: StagePlanRoute): string | null {
  if (isTimeTrialProfile(route.profile_type)) return "stage_plan_time_trial";
  if (!Array.isArray(legs) || legs.length === 0) return "stage_plan_empty";
  if (legs.length > STAGE_PLAN_MAX_LEGS) return "stage_plan_too_many_legs";
  let lastKm = -Infinity;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i] as Rec | null;
    if (!leg || typeof leg !== "object" || Array.isArray(leg)) return "stage_plan_invalid_leg";
    if (Object.keys(leg).some((k) => k !== "task" && k !== "from")) return "stage_plan_invalid_leg";
    const task = leg.task;
    if (!isStagePlanTask(task)) return "stage_plan_unknown_task";
    if (!TASK_ROLES[task].includes(role)) return "stage_plan_task_not_for_role";
    if (task === "breakaway" && i > 0) return "stage_plan_breakaway_not_first";
    if (TERMINAL_TASKS.has(task) && i < legs.length - 1) return "stage_plan_terminal_not_last";
    if (task === "sprint_train" && i > 0 && (legs[0] as Rec).task === "breakaway") return "stage_plan_train_after_breakaway"; // #7003 fund 3
    if (i > 0 && (legs[i - 1] as Rec).task === task) return "stage_plan_repeat_task";
    const from = leg.from;
    if (i === 0) {
      if (from !== undefined) return "stage_plan_first_has_trigger";
      continue;
    }
    if (!from || typeof from !== "object" || Array.isArray(from)) return "stage_plan_missing_trigger";
    const trig = from as Rec;
    if (trig.at === "dropped") {
      if (Object.keys(trig).length !== 1) return "stage_plan_unknown_trigger";
      if (i < legs.length - 1) return "stage_plan_dropped_not_last";
      if (task === "sprint_train") return "stage_plan_train_after_dropped";
      continue;
    }
    let km: number | null;
    if (trig.at === "final_km") {
      if (Object.keys(trig).length !== 1) return "stage_plan_unknown_trigger";
      km = triggerKm({ at: "final_km" }, route);
    } else if (trig.at === "kom") {
      if (Object.keys(trig).length !== 2 || !Number.isInteger(trig.kom_index)) return "stage_plan_unknown_trigger";
      km = triggerKm({ at: "kom", kom_index: trig.kom_index as number }, route);
      if (km === null) return "stage_plan_unknown_climb";
    } else {
      return "stage_plan_unknown_trigger";
    }
    if (km === null || !(km > lastKm) || !(km > 0)) return "stage_plan_not_chronological";
    lastKm = km;
  }
  return null;
}

export function legacyOrderFromPlan(legs: readonly StagePlanLeg[]): { effort: StagePlanEffort; try_break: boolean; leadout: boolean } {
  return {
    effort: TASK_EFFORT[legs[0].task],
    try_break: legs[0].task === "breakaway",
    leadout: legs.some((l) => l.task === "sprint_train"),
  };
}

function bucketOf(profileType: string | null): "flat" | "hilly" | "mountain" | "high" {
  switch (profileType) {
    case "flat":
      return "flat";
    case "mountain":
    case "high_mountain":
      return "high";
    case "medium_mountain":
      return "mountain";
    default:
      return "hilly";
  }
}

type SuggestArgs = { role: StagePlanRole; route: StagePlanRoute; teamHasSprintCaptain: boolean };

export function suggestStagePlan(args: SuggestArgs): StagePlanLeg[] | null {
  if (isTimeTrialProfile(args.route.profile_type)) return null;
  const legs = suggestionFor(args);
  return validateStagePlanLegs(legs, args.role, args.route) === null ? legs : [legs[0]];
}

function suggestionFor({ role, route, teamHasSprintCaptain }: SuggestArgs): StagePlanLeg[] {
  const bucket = bucketOf(route.profile_type);
  const climbs = [...route.climbs].sort((a, b) => a.km - b.km);
  const lastClimbFrom: StagePlanTrigger | null = route.summit_finish
    ? (climbs.length >= 1 ? { at: "kom", kom_index: climbs[climbs.length - 1].index } : null)
    : (climbs.length >= 2 ? { at: "kom", kom_index: climbs[climbs.length - 2].index } : null);
  const attackFrom: StagePlanTrigger = lastClimbFrom ?? { at: "final_km" };
  const flatFinale = bucket === "flat";
  const sprintStage = flatFinale && teamHasSprintCaptain;

  switch (role) {
    case "captain":
    case "co_captain": // #7239: samme plan som kaptajnen
      if (flatFinale) return [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }];
      return [{ task: "stay_sheltered" }, { task: "attack", from: attackFrom }];
    case "sprint_captain":
      if (bucket === "high") return [{ task: "stay_sheltered" }, { task: "grupetto", from: { at: "dropped" } }];
      return [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }];
    case "helper":
      if (sprintStage) return [{ task: "shelter_leader" }, { task: "sprint_train", from: { at: "final_km" } }];
      if (bucket === "high") {
        if (lastClimbFrom) {
          return [{ task: "shelter_leader" }, { task: "tempo", from: lastClimbFrom }, { task: "grupetto", from: { at: "dropped" } }];
        }
        return [{ task: "shelter_leader" }, { task: "grupetto", from: { at: "dropped" } }];
      }
      if (flatFinale) return [{ task: "shelter_leader" }];
      return [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "dropped" } }];
    case "hunter":
      if (sprintStage) return [{ task: "shelter_leader" }, { task: "sprint_train", from: { at: "final_km" } }];
      if (bucket === "high" || bucket === "mountain") return [{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }];
      return [{ task: "breakaway" }, { task: "ride_for_result", from: { at: "dropped" } }];
    case "free_role":
    default:
      if (bucket === "high" && lastClimbFrom) return [{ task: "stay_sheltered" }, { task: "attack", from: attackFrom }];
      if (bucket === "hilly" || bucket === "mountain") return [{ task: "breakaway" }, { task: "ride_for_result", from: { at: "dropped" } }];
      return [{ task: "ride_for_result" }];
  }
}

// ── UI-hjaelpere (kun frontend) ──────────────────────────────────────────────

const KNOWN_ROLES = new Set<string>(ALL_ROLES);
export function planRole(role: unknown): StagePlanRole {
  return typeof role === "string" && KNOWN_ROLES.has(role) ? (role as StagePlanRole) : "free_role";
}

/** Laengste gyldige praefiks (mindst foerste led). Bruges efter hvert valg. */
export function repairLegs(legs: StagePlanLeg[], role: StagePlanRole, route: StagePlanRoute): StagePlanLeg[] {
  for (let n = legs.length; n >= 1; n--) {
    const prefix = legs.slice(0, n);
    if (validateStagePlanLegs(prefix, role, route) === null) return prefix;
  }
  return legs.slice(0, 1);
}

/** De opgaver led `i` kan faa (praefikset til og med leddet skal vaere gyldigt). */
export function taskOptions(legs: StagePlanLeg[], i: number, role: StagePlanRole, route: StagePlanRoute): StagePlanTask[] {
  return STAGE_PLAN_TASKS.filter((task) => {
    const leg: StagePlanLeg = i === 0 ? { task } : { ...(legs[i] ?? {}), task };
    return validateStagePlanLegs([...legs.slice(0, i), leg], role, route) === null;
  });
}

/** Alle skift-punkter paa ruten i rutens orden, som de kan staa paa et led. */
export function allTriggers(route: StagePlanRoute): StagePlanTrigger[] {
  return [
    ...route.climbs.map((c): StagePlanTrigger => ({ at: "kom", kom_index: c.index })),
    { at: "final_km" },
    { at: "dropped" },
  ];
}

export function triggerKey(trigger: StagePlanTrigger | undefined): string {
  if (!trigger) return "";
  return trigger.at === "kom" ? `kom:${trigger.kom_index}` : trigger.at;
}

/** De skift-punkter led `i` (> 0) kan faa. */
export function triggerOptions(legs: StagePlanLeg[], i: number, role: StagePlanRole, route: StagePlanRoute): StagePlanTrigger[] {
  return allTriggers(route).filter((from) => {
    const prefix = [...legs.slice(0, i), { ...legs[i], from }];
    return validateStagePlanLegs(prefix, role, route) === null;
  });
}

export function setLegTask(legs: StagePlanLeg[], i: number, task: StagePlanTask, role: StagePlanRole, route: StagePlanRoute): StagePlanLeg[] {
  return repairLegs(legs.map((l, j) => (j === i ? { ...l, task } : l)), role, route);
}

export function setLegTrigger(legs: StagePlanLeg[], i: number, from: StagePlanTrigger, role: StagePlanRole, route: StagePlanRoute): StagePlanLeg[] {
  return repairLegs(legs.map((l, j) => (j === i ? { ...l, from } : l)), role, route);
}

export function removeLeg(legs: StagePlanLeg[], i: number, role: StagePlanRole, route: StagePlanRoute): StagePlanLeg[] {
  if (i === 0 || legs.length <= 1) return legs;
  return repairLegs(legs.filter((_, j) => j !== i), role, route);
}

/** Naeste led der kan tilfoejes (foerste gyldige opgave + skift-punkt), eller null. */
export function nextLeg(legs: StagePlanLeg[], role: StagePlanRole, route: StagePlanRoute): StagePlanLeg | null {
  if (legs.length >= STAGE_PLAN_MAX_LEGS) return null;
  for (const from of allTriggers(route)) {
    for (const task of STAGE_PLAN_TASKS) {
      if (validateStagePlanLegs([...legs, { task, from }], role, route) === null) return { task, from };
    }
  }
  return null;
}

type OrderRider = Rec & { rider_id: string; plan?: StagePlanLeg[] | null };
type Order = Rec & { riders?: OrderRider[] };

/** Ordren med planernes felter: de gamle felter udledes af kaeden (samme regel som serveren). */
export function withStagePlanFields<T extends Order>(order: T): T {
  return {
    ...order,
    riders: (order?.riders ?? []).map((r) => (Array.isArray(r.plan) && r.plan.length
      ? { ...r, ...legacyOrderFromPlan(r.plan) }
      : r)),
  };
}

/**
 * En rytter uden plan koerer paa sine almindelige valg: dagens indsats (intentionen,
 * standard "normal") og ordrens udbrud/tog. Afviger de fra rollens standard, skal
 * boardet sige hvad han faktisk koerer paa, ikke "efter sin rolle". Returnerer
 * i18n-noegler (races-namespace), eller [] naar han koerer helt paa rollen.
 */
export function fallbackOrderKeys(effort: unknown, rider: Rec | null | undefined, roleDefault: Rec | null | undefined): string[] {
  const eff = typeof effort === "string" && effort ? effort : "normal";
  const tryBreak = rider?.["try_break"] === true;
  const leadout = rider?.["leadout"] === true;
  const custom = eff !== "normal" || tryBreak !== (roleDefault?.["try_break"] === true) || leadout !== (roleDefault?.["leadout"] === true);
  if (!custom) return [];
  return [`intention.step.${eff}`, ...(tryBreak ? ["tacticsOrders.tryBreak"] : []), ...(leadout ? ["tacticsOrders.leadout"] : [])];
}

/** Kopi til en anden etape: planer haenger paa ruten og kopieres ikke med. */
export function withoutStagePlans<T extends Order>(order: T): T {
  return {
    ...order,
    riders: (order?.riders ?? []).map((r) => {
      if (!("plan" in r)) return r;
      const { plan: _plan, ...rest } = r;
      return rest as OrderRider;
    }),
  };
}

export function setRiderPlan<T extends Order>(order: T, riderId: string, plan: StagePlanLeg[] | null): T {
  return {
    ...order,
    riders: (order?.riders ?? []).map((r) => (r.rider_id === riderId ? { ...r, plan } : r)),
  };
}

/**
 * Fjern rytterens plan og genskab rollens standardfelter (effort, udbrud, tog), saa
 * de felter planen udledte ikke bliver liggende som skjulte overstyringer.
 */
export function clearRiderPlan<T extends Order>(order: T, riderId: string, roleDefault: Record<string, unknown> | null | undefined): T {
  const defaults: Record<string, unknown> = {};
  for (const key of ["effort", "try_break", "leadout"]) if (roleDefault && key in roleDefault) defaults[key] = roleDefault[key];
  return {
    ...order,
    riders: (order?.riders ?? []).map((r) => (r.rider_id === riderId ? { ...r, ...defaults, plan: null } : r)),
  };
}

export type StagePlanRecapItem = {
  task: StagePlanTask;
  status: "done" | "to_finish" | "skipped" | "not_reached" | "abandoned";
  endReason: string | null;
  endKm: number | null;
  fromKm: number | null;
};

type TimelineEventLike = { type?: unknown; km?: unknown; params?: Rec | null };

/**
 * Hvad rytteren faktisk gjorde i hvert led, ud fra tidslinjens stage_plan_leg-
 * events (motoren skriver et pr. skift) og et evt. udgaaet-uheld.
 */
export function stagePlanRecap(legs: readonly StagePlanLeg[], events: readonly TimelineEventLike[] | null | undefined, riderId: string): StagePlanRecapItem[] {
  const list = events ?? [];
  const switches = list
    .filter((e) => e?.type === "stage_plan_leg" && e.params?.rider_id === riderId)
    .map((e) => ({ km: Number(e.km), leg: Number(e.params?.leg), reason: String(e.params?.reason ?? "") }))
    .sort((a, b) => a.km - b.km);
  const abandon = list.find((e) => e?.type === "incident" && e.params?.rider_id === riderId && e.params?.outcome === "abandoned");
  const reached = new Map<number, number>([[0, 0]]);
  for (const s of switches) reached.set(s.leg, s.km);
  const lastReached = Math.max(...reached.keys());
  return legs.map((leg, i): StagePlanRecapItem => {
    if (!reached.has(i)) {
      return { task: leg.task, status: i < lastReached ? "skipped" : "not_reached", endReason: null, endKm: null, fromKm: null };
    }
    const fromKm = reached.get(i) ?? 0;
    const nextSwitch = switches.find((s) => s.leg > i);
    if (nextSwitch) return { task: leg.task, status: "done", endReason: nextSwitch.reason, endKm: nextSwitch.km, fromKm };
    if (abandon) return { task: leg.task, status: "abandoned", endReason: "abandoned", endKm: Number(abandon.km), fromKm };
    return { task: leg.task, status: "to_finish", endReason: "finish", endKm: null, fromKm };
  });
}
