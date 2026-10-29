// backend/lib/stagePlan.ts
// #7003 (ejer 25/10, spec 2026-10-25-taktik-roller-design.md §11 punkt 2):
// ETAPEPLAN LANGS RUTEN. Kontrakten: ordforraad, regler, assistentens forslag.
//
// Hver rytter kan faa en kort KAEDE af opgaver for etapen. Kaeden skifter opgave
// ved rutens rigtige punkter, ikke ved faste faser:
//
//   leg 0: opgave                         (fra start)
//   leg 1: opgave, fra toppen af en kategoriseret stigning | fra de sidste km
//   leg 2: opgave, fra "naar han er sat" (eller et senere rutepunkt)
//
// Reglerne (kun logiske skift, ingen smuthuller):
//   - 1 til MAX_LEGS led. Foerste led har intet skift-punkt, alle andre har et.
//   - Rutepunkterne staar i kronologisk orden (strengt stigende km).
//   - "Naar han er sat" kan kun vaere det SIDSTE led (det er en haendelse, ikke et
//     sted: motoren springer direkte dertil, uanset hvor langt kaeden er naaet).
//   - Udbrud kan kun vaere foerste opgave (morgenudbruddet koeres paa etapens
//     foerste segment; et "senere udbrud" ville vaere et smuthul uden motor bag).
//   - Grupetto, kør i mål og sprinttog er slut-opgaver: kun sidste led. Derfor kan
//     grupetto aldrig komme foer arbejdet.
//   - Sprinttog kan ikke starte "naar han er sat" (en sat rytter trækker ikke spurten).
//   - Sprinttog kan ikke foelge udbrud (#7003, spec §3: toget sidder i feltet til finalen).
//   - Opgaven skal passe til rollen (kaptajnen koerer aldrig grupetto).
//   - Indsatsen foelger opgaven (TASK_EFFORT); spilleren vaelger den ikke ved siden af.
//
// Bagudkompatibilitet: kaeden gemmes som `plan` paa rytterens raekke i
// race_team_orders.riders (jsonb). De gamle felter (effort, try_break, leadout)
// udledes af kaeden ved gem (legacyOrderFromPlan), saa en motor-revision der ikke
// kender kaeden (alt foer s5_profiles_v3) koerer rytterens FOERSTE opgave hele dagen
// med samme udbruds- og tog-flag som foer. Motoren laeser kun kaeden under
// s5_profiles_v3 (stagePlanEngine.ts).
//
// Fog of war: ingen tal paa skaermen. Effort-oversaettelsen er enum til enum.
//
// Frontend-kopien bor i frontend/src/components/race/StagePlanModel.ts og holdes
// lig denne fil af stagePlan.parity.test.js.

export const STAGE_PLAN_MAX_LEGS = 3;
/** "De sidste km": skiftet sker ved dette antal km fra maal (spillertekst: "the last 10 km"). */
export const STAGE_PLAN_FINAL_KM = 10;

// #7239: delt kaptajn (#5981) er en leder som kaptajnen, ikke en fri rolle.
export type StagePlanRole = "captain" | "co_captain" | "sprint_captain" | "helper" | "hunter" | "free_role";
export type StagePlanEffort = "grupetto" | "save" | "normal" | "protect" | "all_out";

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

/** Indsatsen foelger opgaven (enum -> enum; ingen tal). */
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

const ALL_ROLES: readonly StagePlanRole[] = ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"];
const LEADERS: readonly StagePlanRole[] = ["captain", "co_captain", "sprint_captain"];

/** Hvem kan faa opgaven. */
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

/** Slut-opgaver: kun sidste led. */
export const TERMINAL_TASKS: ReadonlySet<StagePlanTask> = new Set<StagePlanTask>(["sprint_train", "grupetto", "ride_in"]);

export type StagePlanTrigger =
  | { at: "kom"; kom_index: number }
  | { at: "final_km" }
  | { at: "dropped" };

export type StagePlanLeg = { task: StagePlanTask; from?: StagePlanTrigger };

/** En kategoriseret stigning paa ruten (rutens raa `climbs`-index, samme som waypoints). */
export type StagePlanClimb = { index: number; km: number; name: string | null; category: string };

export type StagePlanRoute = {
  distance_km: number;
  profile_type: string | null;
  climbs: readonly StagePlanClimb[];
  /** Etapen ender paa en stigning (den staar ikke i `climbs`: toppen er maal). */
  summit_finish?: boolean;
};

const CATEGORIES = new Set(["HC", "1", "2", "3", "4"]);
const TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);

export function isStagePlanTask(value: unknown): value is StagePlanTask {
  return typeof value === "string" && (STAGE_PLAN_TASKS as readonly string[]).includes(value);
}

export function isTimeTrialProfile(profileType: unknown): boolean {
  return typeof profileType === "string" && TIME_TRIAL_PROFILES.has(profileType);
}

/**
 * Rutens skift-punkter fra en etapes raa `climbs` (race_stage_profiles.climbs,
 * samme raekkefoelge som waypoint-index). Kun kategoriserede stigninger med en
 * top foer maal; en topankomst er maal, ikke et skift.
 */
export function stagePlanClimbsFromRaw(rawClimbs: unknown, distanceKm: number): StagePlanClimb[] {
  const list = Array.isArray(rawClimbs) ? rawClimbs : [];
  const out: StagePlanClimb[] = [];
  list.forEach((c: unknown, index: number) => {
    if (!c || typeof c !== "object") return;
    const climb = c as Record<string, unknown>;
    const km = Number(climb["crest_km"] ?? climb["km"]);
    const category = String(climb["category"] ?? "");
    if (!Number.isFinite(km) || !CATEGORIES.has(category)) return;
    if (climb["summit_finish"] === true) return;
    if (!(km > 0 && km < distanceKm)) return;
    out.push({ index, km, name: typeof climb["name"] === "string" ? (climb["name"] as string) : null, category });
  });
  return out.sort((a, b) => a.km - b.km || a.index - b.index);
}

/** Hele planens rute fra en etapes raa felter (race_stage_profiles-raekke eller frontendens profil). */
export function stagePlanRouteFromRaw(raw: { distance_km?: unknown; profile_type?: unknown; climbs?: unknown } | null | undefined): StagePlanRoute {
  const distance = Number(raw?.distance_km);
  const distanceKm = Number.isFinite(distance) && distance > 0 ? distance : 0;
  const rawClimbs = Array.isArray(raw?.climbs) ? (raw?.climbs as unknown[]) : [];
  return {
    distance_km: distanceKm,
    profile_type: typeof raw?.profile_type === "string" ? raw.profile_type : null,
    climbs: stagePlanClimbsFromRaw(rawClimbs, distanceKm),
    summit_finish: rawClimbs.some((c) => !!c && typeof c === "object" && (c as Record<string, unknown>)["summit_finish"] === true),
  };
}

/** Skift-punktets km paa ruten; null for "naar han er sat" eller et ukendt punkt. */
export function triggerKm(trigger: StagePlanTrigger | undefined, route: StagePlanRoute): number | null {
  if (!trigger) return null;
  if (trigger.at === "final_km") return Math.max(0, route.distance_km - STAGE_PLAN_FINAL_KM);
  if (trigger.at === "kom") {
    const climb = route.climbs.find((c) => c.index === trigger.kom_index);
    return climb ? climb.km : null;
  }
  return null;
}

/**
 * Ren validering af EN rytters kaede. Returnerer den foerste fejl (snake_case),
 * eller null naar kaeden er gyldig. Fejlrækkefølgen er form -> led -> rolle ->
 * plads i kaeden -> skift-punkter -> kronologi.
 */
export function validateStagePlanLegs(legs: unknown, role: StagePlanRole, route: StagePlanRoute): string | null {
  if (isTimeTrialProfile(route.profile_type)) return "stage_plan_time_trial";
  if (!Array.isArray(legs) || legs.length === 0) return "stage_plan_empty";
  if (legs.length > STAGE_PLAN_MAX_LEGS) return "stage_plan_too_many_legs";
  let lastKm = -Infinity;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i] as Record<string, unknown> | null;
    if (!leg || typeof leg !== "object" || Array.isArray(leg)) return "stage_plan_invalid_leg";
    if (Object.keys(leg).some((k) => k !== "task" && k !== "from")) return "stage_plan_invalid_leg";
    const task = leg["task"];
    if (!isStagePlanTask(task)) return "stage_plan_unknown_task";
    if (!TASK_ROLES[task].includes(role)) return "stage_plan_task_not_for_role";
    if (task === "breakaway" && i > 0) return "stage_plan_breakaway_not_first";
    if (TERMINAL_TASKS.has(task) && i < legs.length - 1) return "stage_plan_terminal_not_last";
    if (task === "sprint_train" && i > 0 && (legs[0] as Record<string, unknown>)["task"] === "breakaway") return "stage_plan_train_after_breakaway"; // #7003 fund 3
    if (i > 0 && (legs[i - 1] as Record<string, unknown>)["task"] === task) return "stage_plan_repeat_task";
    const from = leg["from"];
    if (i === 0) {
      if (from !== undefined) return "stage_plan_first_has_trigger";
      continue;
    }
    if (!from || typeof from !== "object" || Array.isArray(from)) return "stage_plan_missing_trigger";
    const trig = from as Record<string, unknown>;
    if (trig["at"] === "dropped") {
      if (Object.keys(trig).length !== 1) return "stage_plan_unknown_trigger";
      if (i < legs.length - 1) return "stage_plan_dropped_not_last";
      if (task === "sprint_train") return "stage_plan_train_after_dropped";
      continue;
    }
    let km: number | null = null;
    if (trig["at"] === "final_km") {
      if (Object.keys(trig).length !== 1) return "stage_plan_unknown_trigger";
      km = triggerKm({ at: "final_km" }, route);
    } else if (trig["at"] === "kom") {
      if (Object.keys(trig).length !== 2 || !Number.isInteger(trig["kom_index"])) return "stage_plan_unknown_trigger";
      km = triggerKm({ at: "kom", kom_index: trig["kom_index"] as number }, route);
      if (km === null) return "stage_plan_unknown_climb";
    } else {
      return "stage_plan_unknown_trigger";
    }
    if (km === null || !(km > lastKm) || !(km > 0)) return "stage_plan_not_chronological";
    lastKm = km;
  }
  return null;
}

/** Kanonisk form (kun kendte noegler), til lagring. Forudsaetter en valideret kaede. */
export function normalizeStagePlanLegs(legs: readonly StagePlanLeg[]): StagePlanLeg[] {
  return legs.map((leg, i) => {
    if (i === 0 || !leg.from) return { task: leg.task };
    const from: StagePlanTrigger = leg.from.at === "kom"
      ? { at: "kom", kom_index: leg.from.kom_index }
      : { at: leg.from.at };
    return { task: leg.task, from };
  });
}

/**
 * De gamle ordre-felter afledt af kaeden. En motor der ikke kender kaeden koerer
 * rytterens foerste opgave hele dagen; udbrudsforsoeget og toget er de samme som
 * kaeden siger.
 */
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
      return "hilly"; // rolling, hilly, classic, cobbles, gravel, ukendt
  }
}

/**
 * Assistentens forslag ud fra rolle og rute. Deterministisk og rent: samme rolle +
 * samme rute giver altid samme kaede, og kaeden er altid gyldig (testet).
 * null paa en enkeltstart (ingen kaede at planlaegge).
 */
export function suggestStagePlan(args: {
  role: StagePlanRole;
  route: StagePlanRoute;
  teamHasSprintCaptain: boolean;
  /** #5982: rytteren er luksushjaelper (rollen er "helper"); forslaget er hans standardplan. */
  luxuryHelper?: boolean;
}): StagePlanLeg[] | null {
  if (isTimeTrialProfile(args.route.profile_type)) return null;
  const legs = suggestionFor(args);
  // Sikkerhedsnet (fx en etape kortere end de sidste km): kun foerste opgave.
  return validateStagePlanLegs(legs, args.role, args.route) === null ? legs : [legs[0]];
}

function suggestionFor(args: {
  role: StagePlanRole;
  route: StagePlanRoute;
  teamHasSprintCaptain: boolean;
  luxuryHelper?: boolean;
}): StagePlanLeg[] {
  const { role, route, teamHasSprintCaptain } = args;
  const bucket = bucketOf(route.profile_type);
  const climbs = [...route.climbs].sort((a, b) => a.km - b.km);
  // Dagens sidste stigning begynder ved toppen af den foregaaende: ved en
  // topankomst er det den sidste stigning foer maal, ellers den naestsidste.
  const lastClimbFrom: StagePlanTrigger | null = route.summit_finish
    ? (climbs.length >= 1 ? { at: "kom", kom_index: climbs[climbs.length - 1].index } : null)
    : (climbs.length >= 2 ? { at: "kom", kom_index: climbs[climbs.length - 2].index } : null);
  const attackFrom: StagePlanTrigger = lastClimbFrom ?? { at: "final_km" };
  const flatFinale = bucket === "flat";
  const sprintStage = flatFinale && teamHasSprintCaptain;

  // #5982: LUKSUSHJAELPERENS standardplan (genvejen, ejer 27/10): spar dig i laeet, koer
  // tempo for lederen paa den afgoerende stigning (dagens sidste; ved en topankomst uden
  // tidligere stigning: de sidste km), koer i maal naar du er sat. Spilleren kan flytte
  // stigningen i etapeplanen. Uden en afgoerende stigning (flad etape, ingen stigning)
  // er han en almindelig hjaelper og faar hjaelperens forslag.
  const decisiveFrom: StagePlanTrigger | null = lastClimbFrom ?? (route.summit_finish ? { at: "final_km" } : null);
  if (args.luxuryHelper === true && role === "helper" && !flatFinale && decisiveFrom) {
    return [{ task: "stay_sheltered" }, { task: "tempo", from: decisiveFrom }, { task: "ride_in", from: { at: "dropped" } }];
  }

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
