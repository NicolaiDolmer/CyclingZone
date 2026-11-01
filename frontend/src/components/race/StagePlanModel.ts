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

// ── #7383: kan et valgt skift naas? ──────────────────────────────────────────
//
// Motoren skifter opgave ved en segmentgraense (backend/lib/stagePlanEngine.ts, den
// naermeste graense; i sidste segment er maalstregen den sidste graense, og holdarbejde
// skifter ved segmentets start). En stigning, en brostenssektor og nedkoerslen mod maal
// er hver eet segment. Ligger "de sidste 10 km" inde i en af dem, sker skiftet derfor
// ved dens start eller slutning, eller foerst i finalen, ikke 10 km fra maal. Med
// motorkontakten (backend/lib/engine/v4/adapters/finalKmBoundary7383.ts) deles en
// stigning/sektor praecis dér; nedkoerslen deles aldrig.
//
// Kopien af kontakten SKAL vaere den samme som motorens (finalKmBoundary7383.test.ts).
export const FINAL_KM_BOUNDARY_7383_ACTIVE = true; // ejer-go 31/10

export type StagePlanFeature = { kind: "climb" | "sector" | "descent"; from_km: number; to_km: number };
export type StagePlanSwitchNote =
  | { kind: "feature"; leg: number; feature: StagePlanFeature["kind"]; place: "start" | "end" | "finale" }
  | { kind: "same_point"; leg: number; next: number };

const NOTE_EPS_KM = 0.01;
/** Holdarbejde skifter ved sidste segments start (stagePlanEngine.ts SEGMENT_WORK_TASKS). */
const SEGMENT_WORK_TASKS: ReadonlySet<StagePlanTask> = new Set<StagePlanTask>(["tempo", "shelter_leader"]);

/**
 * Rutens stykker der er eet segment i motoren, ud fra profilens egne felter: stigninger
 * (crest_km/length_km), sektorer (start_km/length_km) og nedkoerslen mod maal paa en
 * nedkoerselsfinale (fra sidste top til maal, som rutegeneratoren bygger den).
 */
export function stagePlanFeaturesFromRaw(raw: { distance_km?: unknown; finale_type?: unknown; climbs?: unknown; sectors?: unknown } | null | undefined): StagePlanFeature[] {
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
    resolved.push({ kind: "descent", from_km: last.to_km, to_km: distance });
  }
  return resolved;
}

type Resolved = { km: number; finale: boolean };

/** Hvor motoren faktisk skifter til led `i` (kun naar det vides sikkert; ellers punktet selv). */
function resolvedSwitch(leg: StagePlanLeg, route: StagePlanRoute, features: readonly StagePlanFeature[], boundaryActive: boolean): { at: Resolved; note: StagePlanSwitchNote | null } | null {
  const km = triggerKm(leg.from, route);
  if (km === null) return null;
  if (leg.from?.at !== "final_km") return { at: { km, finale: false }, note: null };
  const feature = features.find((f) => f.from_km + NOTE_EPS_KM < km && km < f.to_km - NOTE_EPS_KM);
  if (!feature || (boundaryActive && feature.kind !== "descent")) return { at: { km, finale: false }, note: null };
  const isLast = Math.abs(feature.to_km - route.distance_km) < NOTE_EPS_KM;
  const firstHalf = km - feature.from_km <= (feature.to_km - feature.from_km) / 2;
  const place: "start" | "end" | "finale" = (isLast && SEGMENT_WORK_TASKS.has(leg.task)) || firstHalf ? "start" : isLast ? "finale" : "end";
  const at: Resolved = place === "start" ? { km: feature.from_km, finale: false } : place === "end" ? { km: feature.to_km, finale: false } : { km: route.distance_km, finale: true };
  return { at, note: { kind: "feature", leg: -1, feature: feature.kind, place } };
}

/**
 * #7383: de valgte skift motoren ikke kan ramme som valgt (til kontakten taendes): "de
 * sidste 10 km" inde i en stigning/sektor/nedkoersel, og to skift der falder samme sted
 * (saa det foerste led aldrig koeres). Kun det der vides sikkert ud fra profilen: et skift
 * paa aaben vej giver ingen note. Tom liste = alle skift sker som valgt.
 */
export function stagePlanSwitchNotes(
  legs: readonly StagePlanLeg[],
  route: StagePlanRoute,
  features: readonly StagePlanFeature[],
  boundaryActive: boolean = FINAL_KM_BOUNDARY_7383_ACTIVE,
): StagePlanSwitchNote[] {
  const notes: StagePlanSwitchNote[] = [];
  let previous: { leg: number; at: Resolved } | null = null;
  for (let i = 1; i < legs.length; i++) {
    const resolved = resolvedSwitch(legs[i], route, features, boundaryActive);
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
      return { task: leg.task, status: i < lastReached ? "skipped" : "not_reached", endReason: null, endKm: null, fromKm: null, endLeg: null };
    }
    const fromKm = reached.get(i) ?? 0;
    const nextSwitch = switches.find((s) => s.leg > i);
    if (nextSwitch) return { task: leg.task, status: "done", endReason: nextSwitch.reason, endKm: nextSwitch.km, fromKm, endLeg: nextSwitch.leg };
    if (abandon) return { task: leg.task, status: "abandoned", endReason: "abandoned", endKm: Number(abandon.km), fromKm, endLeg: null };
    return { task: leg.task, status: "to_finish", endReason: "finish", endKm: null, fromKm, endLeg: null };
  });
}
