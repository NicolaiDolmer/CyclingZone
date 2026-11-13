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
  // #7855 (kun med kontakten jersey_hunt_7855): troejejagt.
  "hunt_points",
  "hunt_kom",
] as const);

export type StagePlanTask = (typeof STAGE_PLAN_TASKS)[number];

/** #7855: troejejagten, kun naar ruten baerer `jersey_hunt_7855` (samme som serveren). */
export const JERSEY_HUNT_TASKS: Readonly<Partial<Record<StagePlanTask, "sprint" | "kom">>> = Object.freeze({
  hunt_points: "sprint",
  hunt_kom: "kom",
});
// #7239: delt kaptajn (#5981) er en leder som kaptajnen, ikke en fri rolle.
export type StagePlanRole = "captain" | "co_captain" | "sprint_captain" | "helper" | "hunter" | "free_role";
export type StagePlanEffort = "grupetto" | "save" | "normal" | "protect" | "all_out";
export type StagePlanTrigger = { at: "kom"; kom_index: number } | { at: "final_km" } | { at: "dropped" };
/** #7855: opgaverne der jager en passage (point i spurterne / bjergpoint). */
export type JerseyHuntTask = "hunt_points" | "hunt_kom";
/** `hunt` (#7855, ejer 12/11 valg A, kun med kontakten): troejejagten paa udbrudsleddet, som serveren. */
export type StagePlanLeg = { task: StagePlanTask; from?: StagePlanTrigger; hunt?: JerseyHuntTask };
export type StagePlanClimb = { index: number; km: number; name: string | null; category: string };
export type StagePlanRoute = {
  distance_km: number;
  profile_type: string | null;
  climbs: readonly StagePlanClimb[];
  summit_finish?: boolean;
  /** #7855: de indlagte spurter. Kun naar kilden har dem. */
  sprints?: readonly StagePlanSprint[];
  /** #7855: troejejagten er slaaet til for loebet. */
  jersey_hunt_7855?: true;
};
export type StagePlanSprint = { index: number; km: number; name: string | null };

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
  hunt_points: "protect", // #7855
  hunt_kom: "protect",
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
  hunt_points: ["sprint_captain", "helper", "hunter", "free_role"], // #7855
  hunt_kom: ["helper", "hunter", "free_role"],
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

/** #7855: de indlagte spurter (samme regel som serveren og motorens vejpunkter). */
export function stagePlanSprintsFromRaw(rawSprints: unknown, distanceKm: number): StagePlanSprint[] {
  const list: unknown[] = Array.isArray(rawSprints) ? rawSprints : [];
  const out: StagePlanSprint[] = [];
  let index = 0;
  for (const s of list) {
    if (!s || typeof s !== "object" || (s as Rec).kind !== "intermediate") continue;
    const sprint = s as Rec;
    const km = Number(sprint.km);
    if (Number.isFinite(km) && km > 0 && km < distanceKm) out.push({ index, km, name: typeof sprint.name === "string" ? sprint.name : null });
    index += 1;
  }
  return out.sort((a, b) => a.km - b.km || a.index - b.index);
}

export function stagePlanRouteFromRaw(raw: { distance_km?: unknown; profile_type?: unknown; climbs?: unknown; sprints?: unknown } | null | undefined): StagePlanRoute {
  const distance = Number(raw?.distance_km);
  const distanceKm = Number.isFinite(distance) && distance > 0 ? distance : 0;
  const rawClimbs: unknown[] = Array.isArray(raw?.climbs) ? (raw?.climbs as unknown[]) : [];
  return {
    distance_km: distanceKm,
    profile_type: typeof raw?.profile_type === "string" ? raw.profile_type : null,
    climbs: stagePlanClimbsFromRaw(rawClimbs, distanceKm),
    summit_finish: rawClimbs.some((c) => !!c && typeof c === "object" && (c as Rec).summit_finish === true),
    ...(Array.isArray(raw?.sprints) ? { sprints: stagePlanSprintsFromRaw(raw?.sprints, distanceKm) } : {}), // #7855
  };
}

/** #7855: ruten med troejejagten slaaet til. Slukket = samme objekt. */
export function withJerseyHunt7855(route: StagePlanRoute, on: boolean): StagePlanRoute {
  return on === true ? { ...route, jersey_hunt_7855: true } : route;
}

/** #7855: har straekningen (fromKm, toKm] en passage af artens slags? */
export function stretchHasHuntPassage(route: StagePlanRoute, kind: "sprint" | "kom", fromKm: number, toKm: number): boolean {
  const kms = kind === "kom" ? route.climbs.map((c) => c.km) : (route.sprints ?? []).map((s) => s.km);
  return kms.some((km) => km > fromKm && km <= toKm);
}

/** #7855: den jagt-opgave leddet koerer (et jagt-led, eller udbrudsleddets `hunt`), ellers null. Som serveren. */
export function legHuntTask(leg: StagePlanLeg): JerseyHuntTask | null {
  if (JERSEY_HUNT_TASKS[leg.task] !== undefined) return leg.task as JerseyHuntTask;
  return leg.hunt !== undefined && JERSEY_HUNT_TASKS[leg.hunt] !== undefined ? leg.hunt : null;
}

/** #7855 (reviewfund): samme regel som serveren (stagePlan.ts), holdt ens af paritetstesten. */
export function planHasJerseyHunt(legs: readonly StagePlanLeg[]): boolean {
  return legs.some((leg) => legHuntTask(leg) !== null);
}

export function planWithoutJerseyHunt(legs: readonly StagePlanLeg[]): StagePlanLeg[] {
  const out: StagePlanLeg[] = [];
  for (const leg of legs) {
    const task: StagePlanTask = JERSEY_HUNT_TASKS[leg.task] ? "stay_sheltered" : leg.task;
    if (out.length > 0 && out[out.length - 1].task === task) continue;
    out.push(leg.from ? { task, from: leg.from } : { task });
  }
  return out;
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
  const legKms: Array<number | null> = []; // #7855
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i] as Rec | null;
    if (!leg || typeof leg !== "object" || Array.isArray(leg)) return "stage_plan_invalid_leg";
    if (Object.keys(leg).some((k) => k !== "task" && k !== "from" && k !== "hunt")) return "stage_plan_invalid_leg";
    const task = leg.task;
    if (!isStagePlanTask(task)) return "stage_plan_unknown_task";
    if (JERSEY_HUNT_TASKS[task] && route.jersey_hunt_7855 !== true) return "stage_plan_unknown_task"; // #7855 (slukket)
    // #7855 valg 1 (ejer 13/11): bjergjagt kun paa udbrudsleddet, aldrig som eget led (som serveren).
    if (task === "hunt_kom") return "stage_plan_unknown_task";
    if (!TASK_ROLES[task].includes(role)) return "stage_plan_task_not_for_role";
    // #7855 (ejer 12/11 valg A): jagten paa udbrudsleddet (som serveren).
    if ("hunt" in leg) {
      const hunt = leg.hunt;
      if (!isStagePlanTask(hunt) || !JERSEY_HUNT_TASKS[hunt]) return "stage_plan_invalid_leg";
      if (route.jersey_hunt_7855 !== true) return "stage_plan_unknown_task";
      if (task !== "breakaway") return "stage_plan_hunt_needs_breakaway";
      if (!TASK_ROLES[hunt].includes(role)) return "stage_plan_task_not_for_role";
    }
    if (task === "breakaway" && i > 0) return "stage_plan_breakaway_not_first";
    if (TERMINAL_TASKS.has(task) && i < legs.length - 1) return "stage_plan_terminal_not_last";
    if (task === "sprint_train" && i > 0 && (legs[0] as Rec).task === "breakaway") return "stage_plan_train_after_breakaway"; // #7003 fund 3
    if (i > 0 && (legs[i - 1] as Rec).task === task) return "stage_plan_repeat_task";
    const from = leg.from;
    if (i === 0) {
      if (from !== undefined) return "stage_plan_first_has_trigger";
      legKms.push(0);
      continue;
    }
    if (!from || typeof from !== "object" || Array.isArray(from)) return "stage_plan_missing_trigger";
    const trig = from as Rec;
    if (trig.at === "dropped") {
      if (Object.keys(trig).length !== 1) return "stage_plan_unknown_trigger";
      if (i < legs.length - 1) return "stage_plan_dropped_not_last";
      if (task === "sprint_train") return "stage_plan_train_after_dropped";
      if (JERSEY_HUNT_TASKS[task]) return "stage_plan_hunt_after_dropped"; // #7855
      legKms.push(null);
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
    legKms.push(km);
  }
  // #7855: en jagt-opgave skal have mindst én passage af sin art paa sin straekning.
  for (let i = 0; i < legs.length; i++) {
    const hunt = legHuntTask(legs[i] as StagePlanLeg);
    const kind = hunt ? JERSEY_HUNT_TASKS[hunt] : undefined;
    if (!kind) continue;
    const next = legKms[i + 1];
    const toKm = typeof next === "number" ? next : route.distance_km;
    if (!stretchHasHuntPassage(route, kind, legKms[i] as number, toKm)) return kind === "kom" ? "stage_plan_hunt_no_climb" : "stage_plan_hunt_no_sprint";
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

// #5982: `luxuryHelper` = rytteren er luksushjaelper (rollen er "helper"); forslaget er hans standardplan.
type SuggestArgs = { role: StagePlanRole; route: StagePlanRoute; teamHasSprintCaptain: boolean; luxuryHelper?: boolean };

export function suggestStagePlan(args: SuggestArgs): StagePlanLeg[] | null {
  if (isTimeTrialProfile(args.route.profile_type)) return null;
  const legs = suggestionFor(args);
  return validateStagePlanLegs(legs, args.role, args.route) === null ? legs : [legs[0]];
}

function suggestionFor({ role, route, teamHasSprintCaptain, luxuryHelper = false }: SuggestArgs): StagePlanLeg[] {
  const bucket = bucketOf(route.profile_type);
  const climbs = [...route.climbs].sort((a, b) => a.km - b.km);
  const lastClimbFrom: StagePlanTrigger | null = route.summit_finish
    ? (climbs.length >= 1 ? { at: "kom", kom_index: climbs[climbs.length - 1].index } : null)
    : (climbs.length >= 2 ? { at: "kom", kom_index: climbs[climbs.length - 2].index } : null);
  // #7369: assistenten foreslaar aldrig et angreb (lederen foelger med paa dagens sidste stigning).
  const leaderFinale: StagePlanLeg = lastClimbFrom
    ? { task: "follow_moves", from: lastClimbFrom }
    : { task: "ride_for_result", from: { at: "final_km" } };
  const flatFinale = bucket === "flat";
  const sprintStage = flatFinale && teamHasSprintCaptain;

  // #5982: luksushjaelperens standardplan (spar dig -> tempo paa den afgoerende stigning -> i maal naar sat).
  const decisiveFrom: StagePlanTrigger | null = lastClimbFrom ?? (route.summit_finish ? { at: "final_km" } : null);
  if (luxuryHelper && role === "helper" && !flatFinale && decisiveFrom) {
    return [{ task: "stay_sheltered" }, { task: "tempo", from: decisiveFrom }, { task: "ride_in", from: { at: "dropped" } }];
  }

  switch (role) {
    case "captain":
    case "co_captain": // #7239: samme plan som kaptajnen
      if (flatFinale) return [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }];
      return [{ task: "stay_sheltered" }, leaderFinale];
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
      if (bucket === "high" && lastClimbFrom) return [{ task: "stay_sheltered" }, leaderFinale];
      if (bucket === "hilly" || bucket === "mountain") return [{ task: "breakaway" }, { task: "ride_for_result", from: { at: "dropped" } }];
      return [{ task: "ride_for_result" }];
  }
}

// ── UI-hjaelpere (kun frontend) ──────────────────────────────────────────────

const KNOWN_ROLES = new Set<string>(ALL_ROLES);
export function planRole(role: unknown): StagePlanRole {
  if (role === "luxury_helper") return "helper"; // #5982: luksushjaelperen er en hjaelper i planen
  return typeof role === "string" && KNOWN_ROLES.has(role) ? (role as StagePlanRole) : "free_role";
}

/** #5982: er rollen luksushjaelper? (forslaget er da hans standardplan). */
export function isLuxuryHelperRole(role: unknown): boolean {
  return role === "luxury_helper";
}

/**
 * #7369: den korte grund under assistentens forslag (i18n-noegle, races-namespace),
 * laest af selve kaeden, saa grunden altid passer til det forslaget siger. null naar
 * der ikke er noget forslag (enkeltstart) eller ingen grund passer (fx sikkerhedsnettets
 * "bliv i laeet" alene).
 */
export function suggestionReasonKey(legs: readonly StagePlanLeg[] | null | undefined, role: StagePlanRole, luxuryHelper = false): string | null {
  if (!legs || !legs.length) return null;
  const tasks = legs.map((l) => l.task);
  const key = (name: string) => `stagePlan.suggestionReason.${name}`;
  if (luxuryHelper && tasks.includes("tempo")) return key("luxuryHelper");
  if (tasks.includes("sprint_train")) return key("sprintTrain");
  if (tasks[0] === "breakaway") return key("breakaway");
  if (tasks.includes("follow_moves")) return key("followLastClimb");
  if (role === "sprint_captain") return key(tasks.includes("grupetto") ? "sprinterMountain" : "sprinter");
  if (tasks.includes("tempo")) return key("helperClimb");
  if (tasks[0] === "shelter_leader") return key("helper");
  if (tasks.includes("ride_for_result")) return key(tasks[0] === "stay_sheltered" ? "leaderFinal" : "ownResult");
  return null;
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

const EFFORT_RANK: readonly StagePlanEffort[] = ["grupetto", "save", "normal", "protect", "all_out"];

/** Den haardeste indsats i kaeden: det motoren regner traethed efter (#7715). */
export function hardestPlanEffort(legs: readonly StagePlanLeg[]): StagePlanEffort {
  return legs.map((l) => TASK_EFFORT[l.task]).reduce((a, b) => (EFFORT_RANK.indexOf(b) > EFFORT_RANK.indexOf(a) ? b : a));
}

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
    riders: (order?.riders ?? []).map((r) => {
      if (r.rider_id !== riderId) return r;
      const { hunt_off: _handled, ...rest } = r as typeof r & { hunt_off?: unknown }; // #7855: et nyt valg er spillerens eget
      return { ...rest, plan } as typeof r;
    }),
  };
}

/**
 * #7855 (reviewfund): ordren som loebet kan koere den, naar troejejagten ikke gaelder (kontakten
 * slukket eller noedstop). Jagt-ledene bliver til planen uden jagt, og rytteren maerkes, saa boardet
 * kan sige det. Uden jagt-led: samme objekt.
 */
export function orderWithoutJerseyHunt<T extends Order>(order: T): T {
  const riders = order?.riders ?? [];
  if (!riders.some((r) => Array.isArray(r.plan) && planHasJerseyHunt(r.plan))) return order;
  return {
    ...order,
    riders: riders.map((r) => (Array.isArray(r.plan) && planHasJerseyHunt(r.plan) ? { ...r, plan: planWithoutJerseyHunt(r.plan), hunt_off: true } : r)),
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

// ── #7383: kan et valgt skift naas? ──────────────────────────────────────────
//
// Motoren skifter opgave ved en segmentgraense (backend/lib/stagePlanEngine.ts, den
// naermeste graense; i sidste segment er maalstregen den sidste graense, og holdarbejde
// skifter ved segmentets start). 10 km fra maal er altid en graense
// (backend/lib/engine/v4/adapters/finalKmBoundary7383.ts): en stigning eller
// brostenssektor over punktet deles praecis dér. Kun nedkoerslen mod maal deles aldrig;
// ligger "de sidste 10 km" inde i den, sker skiftet ved dens start eller foerst i finalen.

export type StagePlanFeature = {
  kind: "climb" | "sector" | "descent";
  from_km: number;
  to_km: number;
  /** Nedkoersel: hvor vejen reelt holder op med at falde, naar hoejdeprofilen kendes (#7625). */
  down_to_km?: number;
};
export type StagePlanSwitchNote =
  | { kind: "feature"; leg: number; feature: "descent" | "flat"; place: "start" | "finale" }
  | { kind: "same_point"; leg: number; next: number };

const NOTE_EPS_KM = 0.01;
/** Holdarbejde skifter ved sidste segments start (stagePlanEngine.ts SEGMENT_WORK_TASKS). */
const SEGMENT_WORK_TASKS: ReadonlySet<StagePlanTask> = new Set<StagePlanTask>(["tempo", "shelter_leader"]);

/**
 * Rutens stykker der er eet segment i motoren, ud fra profilens egne felter: stigninger
 * (crest_km/length_km), sektorer (start_km/length_km) og nedkoerslen mod maal paa en
 * nedkoerselsfinale (fra sidste top til maal, som rutegeneratoren bygger den).
 */
export function stagePlanFeaturesFromRaw(raw: { distance_km?: unknown; finale_type?: unknown; climbs?: unknown; sectors?: unknown; elevation_profile?: unknown } | null | undefined): StagePlanFeature[] {
  const distance = Number(raw?.distance_km);
  if (!Number.isFinite(distance) || !(distance > 0)) return [];
  const out: StagePlanFeature[] = [];
  for (const c of Array.isArray(raw?.climbs) ? (raw?.climbs as unknown[]) : []) {
    if (!c || typeof c !== "object") continue;
    const crest = Number((c as Rec).crest_km ?? (c as Rec).km);
    const length = Number((c as Rec).length_km);
    if (!Number.isFinite(crest) || !(length > 0)) continue;
    const to = Math.min(distance, crest);
    out.push({ kind: "climb", from_km: Math.max(0, to - length), to_km: to });
  }
  for (const s of Array.isArray(raw?.sectors) ? (raw?.sectors as unknown[]) : []) {
    if (!s || typeof s !== "object") continue;
    const start = Number((s as Rec).start_km);
    const length = Number((s as Rec).length_km);
    if (!Number.isFinite(start) || !(length > 0)) continue;
    out.push({ kind: "sector", from_km: Math.max(0, start), to_km: Math.min(distance, start + length) });
  }
  // Codex-review: samme overlap-regel som rutegeneratoren (routeSegments.buildSegments):
  // sorteret efter start, en tidligere feature vinder, og en senere starter hvor den slutter.
  out.sort((a, b) => a.from_km - b.from_km || a.to_km - b.to_km);
  const resolved: StagePlanFeature[] = [];
  let cursor = 0;
  for (const f of out) {
    const from = Math.max(f.from_km, cursor);
    if (from >= f.to_km) continue;
    resolved.push({ ...f, from_km: from });
    cursor = f.to_km;
  }
  const last = resolved[resolved.length - 1];
  if (raw?.finale_type === "descent" && last?.kind === "climb" && distance - last.to_km > NOTE_EPS_KM) {
    const downTo = roadStopsFallingAtKm(raw?.elevation_profile, last.to_km, distance);
    resolved.push({ kind: "descent", from_km: last.to_km, to_km: distance, ...(downTo === null ? {} : { down_to_km: downTo }) });
  }
  return resolved;
}

/** Hoejdeforskel (m) over maal der stadig tæller som fald; under den er vejen flad. */
const FLAT_TOLERANCE_M = 5;

/**
 * #7625: nedkoerselsfinalen er et helt segment i motoren (fra sidste top til maal), men vejen
 * falder ofte kun lidt af det og er derefter flad. Med hoejdeprofilen findes det sted hvor
 * vejen er faldet til maalets hoejde; foer det er det en nedkoersel, efter det er det flad vej.
 * Uden en gyldig profil vides det ikke (null), og segmentet regnes helt som nedkoersel.
 */
function roadStopsFallingAtKm(profile: unknown, fromKm: number, distance: number): number | null {
  const ep = profile as { h?: unknown; step_km?: unknown } | null | undefined;
  if (!ep || !Array.isArray(ep.h) || ep.h.length < 2 || !ep.h.every((v) => Number.isFinite(v))) return null;
  const h = ep.h as number[];
  const step = Number(ep.step_km) > 0 ? Number(ep.step_km) : distance / (h.length - 1);
  const end = h[h.length - 1];
  for (let i = Math.max(0, Math.ceil(fromKm / step)); i < h.length; i++) {
    if (h[i] <= end + FLAT_TOLERANCE_M) return Math.min(distance, i * step);
  }
  return distance;
}

type Resolved = { km: number; finale: boolean };

/** Hvor motoren faktisk skifter til led `i` (kun naar det vides sikkert; ellers punktet selv). */
function resolvedSwitch(leg: StagePlanLeg, route: StagePlanRoute, features: readonly StagePlanFeature[]): { at: Resolved; note: StagePlanSwitchNote | null } | null {
  const km = triggerKm(leg.from, route);
  if (km === null) return null;
  if (leg.from?.at !== "final_km") return { at: { km, finale: false }, note: null };
  // Nedkoerslen mod maal er altid etapens sidste segment (stagePlanFeaturesFromRaw).
  const descent = features.find((f) => f.kind === "descent" && f.from_km + NOTE_EPS_KM < km && km < f.to_km - NOTE_EPS_KM);
  if (!descent) return { at: { km, finale: false }, note: null };
  // #7625: motoren skifter stadig ved nedkoerselssegmentet, men teksten siger kun "nedkoersel"
  // naar vejen reelt stadig falder dér; er den flad, staar der ingen paastand om nedkoersel.
  const stillFalling = descent.down_to_km === undefined || km < descent.down_to_km - NOTE_EPS_KM;
  const firstHalf = km - descent.from_km <= (descent.to_km - descent.from_km) / 2;
  const place: "start" | "finale" = SEGMENT_WORK_TASKS.has(leg.task) || firstHalf ? "start" : "finale";
  const at: Resolved = place === "start" ? { km: descent.from_km, finale: false } : { km: route.distance_km, finale: true };
  return { at, note: { kind: "feature", leg: -1, feature: stillFalling ? "descent" : "flat", place } };
}

/**
 * #7383: de valgte skift motoren ikke kan ramme som valgt: "de sidste 10 km" inde i
 * nedkoerslen mod maal, og to skift der falder samme sted (saa det foerste led aldrig
 * koeres). Kun det der vides sikkert ud fra profilen: et skift paa aaben vej, en
 * stigning eller en sektor giver ingen note. Tom liste = alle skift sker som valgt.
 */
export function stagePlanSwitchNotes(
  legs: readonly StagePlanLeg[],
  route: StagePlanRoute,
  features: readonly StagePlanFeature[],
): StagePlanSwitchNote[] {
  const notes: StagePlanSwitchNote[] = [];
  let previous: { leg: number; at: Resolved } | null = null;
  for (let i = 1; i < legs.length; i++) {
    const resolved = resolvedSwitch(legs[i], route, features);
    if (!resolved) {
      previous = null;
      continue;
    }
    if (resolved.note) notes.push({ ...resolved.note, leg: i } as StagePlanSwitchNote);
    if (previous && previous.at.finale === resolved.at.finale && Math.abs(previous.at.km - resolved.at.km) < NOTE_EPS_KM) {
      notes.push({ kind: "same_point", leg: previous.leg, next: i });
    }
    previous = { leg: i, at: resolved.at };
  }
  return notes;
}

/** i18n-noegle (races-namespace) og parametre til en note (trin-numre er 1-baserede). */
export function stagePlanSwitchNoteText(note: StagePlanSwitchNote): { key: string; params: Record<string, number> } {
  if (note.kind === "same_point") return { key: "stagePlan.switchNote.samePoint", params: { first: note.leg + 1, second: note.next + 1 } };
  return { key: `stagePlan.switchNote.${note.feature}.${note.place}`, params: { number: note.leg + 1 } };
}

export type StagePlanRecapItem = {
  task: StagePlanTask;
  status: "done" | "to_finish" | "skipped" | "not_reached" | "abandoned";
  endReason: string | null;
  endKm: number | null;
  fromKm: number | null;
  /** #7368: det led der faktisk afloeste dette (kan springe et led over); null = ingen. */
  endLeg: number | null;
  /** #7636: leddets eget skift-punkt ("naar han er sat") vises ikke, fordi filmen ikke viser det. */
  fromHidden?: true;
};

export type StagePlanRecapOptions = {
  /**
   * #7636 (kontakten stage_plan_dropped_front_7635): sad rytteren forrest eller i feltet
   * ved km? true = ja, false = nej, null = ukendt. Med kontakten giver fladen
   * stageSplitTimes.riderInFrontOrFieldAt; uden den krydstjekkes intet (som foer).
   */
  inFrontOrFieldAt?: (km: number) => boolean | null;
};

type TimelineEventLike = { type?: unknown; km?: unknown; params?: Rec | null };

/**
 * Hvad rytteren faktisk gjorde i hvert led, ud fra tidslinjens stage_plan_leg-
 * events (motoren skriver et pr. skift) og et evt. udgaaet-uheld.
 */
export function stagePlanRecap(
  legs: readonly StagePlanLeg[],
  events: readonly TimelineEventLike[] | null | undefined,
  riderId: string,
  opts: StagePlanRecapOptions = {},
): StagePlanRecapItem[] {
  const items = stagePlanRecapFromEvents(legs, events, riderId);
  const check = opts.inFrontOrFieldAt;
  // #7636: resumeet paastaar aldrig noget filmen ikke viser. Siger motoren "sat", men sad
  // rytteren forrest eller i feltet paa stedet, skrives hverken "sat" eller "sprunget
  // over, han var sat": leddet faar ingen slutgrund, de oversprungne led staar som ikke
  // naaet, og sat-leddets eget skift-punkt vises ikke. Sat-leddet er altid kaedens sidste,
  // saa der er hoejst ét saadant skift.
  const d = check ? items.findIndex((it) => it.endReason === "dropped" && check(it.endKm as number) === true) : -1;
  if (d < 0) return items;
  const to = items[d].endLeg as number;
  return items.map((it, i) => (i === d ? { ...it, endReason: null } : i === to ? { ...it, fromHidden: true } : i < to && it.status === "skipped" ? { ...it, status: "not_reached" } : it));
}

// ── #7706: et flueben lover ikke succes ──────────────────────────────────────
//
// Status ovenfor siger kun om leddet blev koert. Udfaldet siger hvad filmen og maalresultatet
// kan bevise: et flueben og en fiasko kraever bevis, en neutral kendsgerning (placering, hvem
// han sad med) er ingen dom, og uden bevis staar der intet. Fog of war: kun fakta spilleren
// allerede kan se, ingen tal fra motoren.

/** Markeringen: "info" = en kendsgerning uden dom, "none" = intet at vise. */
export type StagePlanOutcomeMark = "done" | "failed" | "not_reached" | "info" | "none";
export type StagePlanOutcome = {
  mark: StagePlanOutcomeMark;
  /** i18n-noegle (races-namespace) og parametre; null = ingen tekst, linjen siger det selv. */
  word: { key: string; params?: Record<string, string | number> } | null;
};

export type StagePlanOutcomeOptions = {
  /**
   * Hvor rytteren mistede kontakten og ikke kom tilbage: km, null = filmen viser ingen
   * saadan km, undefined = filmen kan ikke svare (ingen gruppe-gab).
   */
  lostContactKm?: number | null;
  /**
   * Sad han i sin gruppe hele strækningen, ifoelge filmen? stageSplitTimes.riderHeldContact;
   * kun true er bevis. lostContactKm kan ikke svare: et fald han kom tilbage fra staar ikke dér.
   */
  heldContact?: (fromKm: number, toKm: number) => boolean | null;
  /** Hans placering paa etapen fra maalresultatet; ellers filmens top i maal. */
  rank?: number | null;
  /**
   * Den rytter holdarbejdet gjaldt. `splitKm`: stageSplitTimes.ridersSplitKm for leddet.
   * Vises ved navn, saa teksten kun siger hvem han sad med, ikke hvem der var leder.
   */
  leader?: { name: string; splitKm: (fromKm: number, toKm: number) => number | null | undefined } | null;
};

/** Opgaver hvor det at falde bagud betyder at opgaven ikke lykkedes. */
const CONTACT_TASKS: ReadonlySet<StagePlanTask> = new Set<StagePlanTask>(["attack", "follow_moves", "ride_for_result"]);
/** Opgaver der er loest naar rytteren er kommet i maal (at falde bagud er meningen). */
const RIDE_HOME_TASKS: ReadonlySet<StagePlanTask> = new Set<StagePlanTask>(["grupetto", "ride_in"]);
/** Holdarbejde: filmen navngiver ikke hjaelperens arbejde, kun hvem han sad i gruppe med. */
const TEAM_WORK_TASKS: ReadonlySet<StagePlanTask> = new Set<StagePlanTask>(["shelter_leader", "tempo", "sprint_train"]);
/** Kun rigtige angreb: motorens sene angreb og dens nedkoerselsangreb; resten af finale_attack er bogfoering eller uden art. */
function isRealAttack(params: Rec | null | undefined): boolean {
  return params?.kind === "late_attack" || params?.direction === "descent";
}

function eventRiderIds(params: Rec | null | undefined, key = "rider_ids"): unknown[] {
  const ids = params?.[key];
  return Array.isArray(ids) ? ids : [];
}

const outcomeOf = (mark: StagePlanOutcomeMark, word?: string, params?: Record<string, string | number>): StagePlanOutcome => ({
  mark,
  word: word ? { key: `stagePlan.recap.outcome.${word}`, ...(params ? { params } : {}) } : null,
});
const NOTHING_TO_SHOW = outcomeOf("none");

/** Kom han i udbruddet? true/false kun naar filmen navngiver ham; ellers null. */
function madeTheBreak(list: readonly TimelineEventLike[], riderId: string): boolean | null {
  if (list.some((e) => e?.type === "breakaway_formed" && eventRiderIds(e.params).includes(riderId))) return true;
  const attempted = list.some((e) => e?.type === "breakaway_attempt" && eventRiderIds(e.params).includes(riderId));
  return attempted ? false : null;
}

/** Km for hans eget angreb inden for leddet; null = filmen viser intet. */
function attackKmInLeg(list: readonly TimelineEventLike[], riderId: string, item: StagePlanRecapItem): number | null {
  const from = item.fromKm ?? 0;
  const to = item.endKm ?? Infinity;
  const attack = list.find((e) => {
    const km = Number(e?.km);
    // Et angreb paa selve skiftets km hoerer til det forrige led (motoren skriver det foer skiftet).
    if (!(km > from && km <= to)) return false;
    const named = e?.params?.rider_id === riderId || eventRiderIds(e?.params).includes(riderId);
    if (e?.type === "finale_attack") return named && isRealAttack(e.params);
    return e?.type === "peloton_splits" && e.params?.cause === "attack" && named;
  });
  return attack ? Number(attack.km) : null;
}

/** Filmens top i maal (motoren navngiver kun de forreste). */
function rankInFinish(list: readonly TimelineEventLike[], riderId: string): number | null {
  const top = list.find((e) => e?.type === "finish")?.params?.top;
  const hit = Array.isArray(top) ? top.find((row) => (row as Rec | null)?.rider_id === riderId) as Rec | undefined : undefined;
  return typeof hit?.rank === "number" ? hit.rank : null;
}

/** Var han uden for tidsgraensen, uden at juryen tog ham ind igen? */
function outOfTime(list: readonly TimelineEventLike[], riderId: string): boolean {
  const named = (type: string) => list.some((e) => e?.type === type && eventRiderIds(e.params).includes(riderId));
  return named("outside_time_limit") && !named("jury_reinstated");
}

/** Et styrt eller en defekt koster tid uden at filmen kalder det et fald, ogsaa i de led der foelger efter. */
function incidentByLegEnd(list: readonly TimelineEventLike[], riderId: string, item: StagePlanRecapItem): boolean {
  const to = item.endKm ?? Infinity;
  return list.some((e) => e?.type === "incident" && e.params?.rider_id === riderId && e.params?.outcome !== "protected_three_km_rule" && Number(e.km) <= to);
}

const roundKm = (km: number) => Math.round(km);

/** Udfaldet af hvert led i et resume (samme raekkefoelge som `items`). */
export function stagePlanOutcomes(
  items: readonly StagePlanRecapItem[],
  events: readonly TimelineEventLike[] | null | undefined,
  riderId: string,
  { lostContactKm, heldContact, rank = null, leader = null }: StagePlanOutcomeOptions = {},
): StagePlanOutcome[] {
  const list = events ?? [];
  const late = outOfTime(list, riderId);
  const finishRank = rank ?? rankInFinish(list, riderId);
  const finishKm = list.find((e) => e?.type === "finish")?.km;
  const filmSilent = lostContactKm === undefined;

  return items.map((item): StagePlanOutcome => {
    if (item.status === "skipped" || item.status === "not_reached") return outcomeOf("not_reached");
    // Linjen siger selv "udgik ved km".
    if (item.status === "abandoned") return outcomeOf("failed");
    const toFinish = item.status === "to_finish";
    if (toFinish && late) return outcomeOf("failed", "outOfTime");

    if (item.task === "breakaway") {
      const made = madeTheBreak(list, riderId);
      // Et udbrud der dannes og hentes inden for samme segment: filmen navngiver ham, motoren saa det ikke.
      if (item.endReason === "missed_break") return made === true ? NOTHING_TO_SHOW : outcomeOf("failed", "failed");
      if (item.endReason === "caught" || made === true) return outcomeOf("done", "inBreak");
      return made === false ? outcomeOf("failed", "failed") : NOTHING_TO_SHOW;
    }

    // Kun en raekke i maalresultatet beviser at han kom i maal: at filmen intet siger, goer ikke.
    if (RIDE_HOME_TASKS.has(item.task)) return toFinish && finishRank !== null ? outcomeOf("done", "finished") : NOTHING_TO_SHOW;

    // #7855: troejejagten. Beviset er filmens passager paa leddets straekning, hvor motoren
    // navngiver ham som jaeger; pointene er dem klassementet ogsaa viser. Uden en saadan passage
    // staar der intet.
    const huntKind = JERSEY_HUNT_TASKS[item.task];
    if (huntKind) {
      const type = huntKind === "kom" ? "kom_passage" : "intermediate_sprint";
      const from = item.fromKm ?? 0;
      const to = item.endKm ?? Infinity;
      const hunted = list.filter((e) => e?.type === type && Number(e.km) > from && Number(e.km) <= to && eventRiderIds(e.params, "hunters").includes(riderId));
      if (!hunted.length) return NOTHING_TO_SHOW;
      const points = hunted.reduce((sum, e) => {
        const top = Array.isArray(e.params?.top) ? (e.params?.top as Rec[]) : [];
        const row = top.find((r) => r?.rider_id === riderId);
        return sum + (typeof row?.points === "number" ? row.points : 0);
      }, 0);
      return points > 0 ? outcomeOf("done", huntKind === "kom" ? "komPoints" : "sprintPoints", { points }) : outcomeOf("failed", "noPoints");
    }

    const behind = typeof lostContactKm === "number" && lostContactKm <= (item.endKm ?? Infinity);
    const lost = () => ({ km: roundKm(lostContactKm as number) });
    // Slut paa leddet uden tvivl: filmen viser ham i gruppen hele leddet, motoren siger ikke "sat",
    // intet uheld indtil da, og han er i maal hvis leddet gik dertil.
    const heldOn = !behind && item.endReason !== "dropped" && item.endReason !== null
      && heldContact?.(item.fromKm ?? 0, item.endKm ?? Infinity) === true
      && !incidentByLegEnd(list, riderId, item) && (!toFinish || finishRank !== null);

    if (CONTACT_TASKS.has(item.task)) {
      const attackKm = item.task === "attack" ? attackKmInLeg(list, riderId, item) : null;
      if (item.task !== "follow_moves" && toFinish && finishRank !== null && attackKm === null) return outcomeOf("info", "rank", { rank: finishRank });
      if (behind) return outcomeOf("failed", "lostContact", lost());
      // Motoren siger "sat", men filmen viser intet tab: saa paastaas ingen fiasko (#7636).
      if (item.endReason === "dropped" && filmSilent) return outcomeOf("failed", "failed");
      if (attackKm !== null) return outcomeOf("done", "attacked", { km: roundKm(attackKm) });
      if (item.task === "attack" || !heldOn) return NOTHING_TO_SHOW;
      return outcomeOf(item.task === "follow_moves" ? "done" : "info", "keptContact");
    }

    // Holdarbejde: en kendsgerning om hvem han sad med, ingen dom over arbejdet.
    if (TEAM_WORK_TASKS.has(item.task) && leader) {
      const splitKm = leader.splitKm(item.fromKm ?? 0, item.endKm ?? (typeof finishKm === "number" ? finishKm : Infinity));
      if (splitKm === null) return outcomeOf("info", "withRider", { name: leader.name });
      if (typeof splitKm === "number") return outcomeOf("info", "withRiderTo", { name: leader.name, km: roundKm(splitKm) });
    }

    // Laeet og holdarbejde uden en leder at maale paa: at blive sat kan vaere planen (hjaelperen
    // har gjort sit, sprinteren paa bjergetapen sparer sig), saa det er ingen fiasko.
    if (behind) return outcomeOf("info", "lostContact", lost());
    if (!heldOn) return NOTHING_TO_SHOW;
    return outcomeOf(item.task === "stay_sheltered" ? "done" : "info", "keptContact");
  });
}

function stagePlanRecapFromEvents(legs: readonly StagePlanLeg[], events: readonly TimelineEventLike[] | null | undefined, riderId: string): StagePlanRecapItem[] {
  const list = events ?? [];
  const switches = list
    .filter((e) => e?.type === "stage_plan_leg" && e.params?.rider_id === riderId)
    .map((e) => ({ km: Number(e.km), place: Number(e.params?.exact_km ?? e.km), leg: Number(e.params?.leg), reason: String(e.params?.reason ?? "") }))
    .sort((a, b) => a.km - b.km)
    // #6350: "sat ved km" er hvor han reelt blev sat, aldrig foer det forrige skift i kaeden.
    .map((s, i, all) => ({ ...s, km: i === 0 ? s.place : Math.max(all[i - 1].km, s.place) }));
  const abandon = list.find((e) => e?.type === "incident" && e.params?.rider_id === riderId && e.params?.outcome === "abandoned");
  const reached = new Map<number, number>([[0, 0]]);
  for (const s of switches) reached.set(s.leg, s.km);
  const lastReached = Math.max(...reached.keys());
  return legs.map((leg, i): StagePlanRecapItem => {
    if (!reached.has(i)) {
      return { task: leg.task, status: i < lastReached ? "skipped" : "not_reached", endReason: null, endKm: null, fromKm: null, endLeg: null };
    }
    const fromKm = reached.get(i) ?? 0;
    const nextSwitch = switches.find((s) => s.leg > i);
    if (nextSwitch) return { task: leg.task, status: "done", endReason: nextSwitch.reason, endKm: nextSwitch.km, fromKm, endLeg: nextSwitch.leg };
    if (abandon) return { task: leg.task, status: "abandoned", endReason: "abandoned", endKm: Number(abandon.km), fromKm, endLeg: null };
    return { task: leg.task, status: "to_finish", endReason: "finish", endKm: null, fromKm, endLeg: null };
  });
}
