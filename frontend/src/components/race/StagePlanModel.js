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
]);

export const TASK_EFFORT = Object.freeze({
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

const ALL_ROLES = ["captain", "sprint_captain", "helper", "hunter", "free_role"];
const LEADERS = ["captain", "sprint_captain"];

export const TASK_ROLES = Object.freeze({
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

export const TERMINAL_TASKS = new Set(["sprint_train", "grupetto", "ride_in"]);

const CATEGORIES = new Set(["HC", "1", "2", "3", "4"]);
const TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);

export function isStagePlanTask(value) {
  return typeof value === "string" && STAGE_PLAN_TASKS.includes(value);
}

export function isTimeTrialProfile(profileType) {
  return typeof profileType === "string" && TIME_TRIAL_PROFILES.has(profileType);
}

export function stagePlanClimbsFromRaw(rawClimbs, distanceKm) {
  const list = Array.isArray(rawClimbs) ? rawClimbs : [];
  const out = [];
  list.forEach((climb, index) => {
    if (!climb || typeof climb !== "object") return;
    const km = Number(climb.crest_km ?? climb.km);
    const category = String(climb.category ?? "");
    if (!Number.isFinite(km) || !CATEGORIES.has(category)) return;
    if (climb.summit_finish === true) return;
    if (!(km > 0 && km < distanceKm)) return;
    out.push({ index, km, name: typeof climb.name === "string" ? climb.name : null, category });
  });
  return out.sort((a, b) => a.km - b.km || a.index - b.index);
}

export function stagePlanRouteFromRaw(raw) {
  const distance = Number(raw?.distance_km);
  const distanceKm = Number.isFinite(distance) && distance > 0 ? distance : 0;
  const rawClimbs = Array.isArray(raw?.climbs) ? raw.climbs : [];
  return {
    distance_km: distanceKm,
    profile_type: typeof raw?.profile_type === "string" ? raw.profile_type : null,
    climbs: stagePlanClimbsFromRaw(rawClimbs, distanceKm),
    summit_finish: rawClimbs.some((c) => !!c && typeof c === "object" && c.summit_finish === true),
  };
}

export function triggerKm(trigger, route) {
  if (!trigger) return null;
  if (trigger.at === "final_km") return Math.max(0, route.distance_km - STAGE_PLAN_FINAL_KM);
  if (trigger.at === "kom") {
    const climb = route.climbs.find((c) => c.index === trigger.kom_index);
    return climb ? climb.km : null;
  }
  return null;
}

export function validateStagePlanLegs(legs, role, route) {
  if (isTimeTrialProfile(route.profile_type)) return "stage_plan_time_trial";
  if (!Array.isArray(legs) || legs.length === 0) return "stage_plan_empty";
  if (legs.length > STAGE_PLAN_MAX_LEGS) return "stage_plan_too_many_legs";
  let lastKm = -Infinity;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (!leg || typeof leg !== "object" || Array.isArray(leg)) return "stage_plan_invalid_leg";
    if (Object.keys(leg).some((k) => k !== "task" && k !== "from")) return "stage_plan_invalid_leg";
    const task = leg.task;
    if (!isStagePlanTask(task)) return "stage_plan_unknown_task";
    if (!TASK_ROLES[task].includes(role)) return "stage_plan_task_not_for_role";
    if (task === "breakaway" && i > 0) return "stage_plan_breakaway_not_first";
    if (TERMINAL_TASKS.has(task) && i < legs.length - 1) return "stage_plan_terminal_not_last";
    if (i > 0 && legs[i - 1].task === task) return "stage_plan_repeat_task";
    const from = leg.from;
    if (i === 0) {
      if (from !== undefined) return "stage_plan_first_has_trigger";
      continue;
    }
    if (!from || typeof from !== "object" || Array.isArray(from)) return "stage_plan_missing_trigger";
    if (from.at === "dropped") {
      if (Object.keys(from).length !== 1) return "stage_plan_unknown_trigger";
      if (i < legs.length - 1) return "stage_plan_dropped_not_last";
      if (task === "sprint_train") return "stage_plan_train_after_dropped";
      continue;
    }
    let km;
    if (from.at === "final_km") {
      if (Object.keys(from).length !== 1) return "stage_plan_unknown_trigger";
      km = triggerKm({ at: "final_km" }, route);
    } else if (from.at === "kom") {
      if (Object.keys(from).length !== 2 || !Number.isInteger(from.kom_index)) return "stage_plan_unknown_trigger";
      km = triggerKm({ at: "kom", kom_index: from.kom_index }, route);
      if (km === null) return "stage_plan_unknown_climb";
    } else {
      return "stage_plan_unknown_trigger";
    }
    if (km === null || !(km > lastKm) || !(km > 0)) return "stage_plan_not_chronological";
    lastKm = km;
  }
  return null;
}

export function legacyOrderFromPlan(legs) {
  return {
    effort: TASK_EFFORT[legs[0].task],
    try_break: legs[0].task === "breakaway",
    leadout: legs.some((l) => l.task === "sprint_train"),
  };
}

function bucketOf(profileType) {
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

export function suggestStagePlan({ role, route, teamHasSprintCaptain }) {
  if (isTimeTrialProfile(route.profile_type)) return null;
  const legs = suggestionFor({ role, route, teamHasSprintCaptain });
  return validateStagePlanLegs(legs, role, route) === null ? legs : [legs[0]];
}

function suggestionFor({ role, route, teamHasSprintCaptain }) {
  const bucket = bucketOf(route.profile_type);
  const climbs = [...route.climbs].sort((a, b) => a.km - b.km);
  const lastClimbFrom = route.summit_finish
    ? (climbs.length >= 1 ? { at: "kom", kom_index: climbs[climbs.length - 1].index } : null)
    : (climbs.length >= 2 ? { at: "kom", kom_index: climbs[climbs.length - 2].index } : null);
  const attackFrom = lastClimbFrom ?? { at: "final_km" };
  const flatFinale = bucket === "flat";
  const sprintStage = flatFinale && teamHasSprintCaptain;

  switch (role) {
    case "captain":
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

const KNOWN_ROLES = new Set(ALL_ROLES);
export function planRole(role) {
  return KNOWN_ROLES.has(role) ? role : "free_role";
}

/** Laengste gyldige praefiks (mindst foerste led). Bruges efter hvert valg. */
export function repairLegs(legs, role, route) {
  for (let n = legs.length; n >= 1; n--) {
    const prefix = legs.slice(0, n);
    if (validateStagePlanLegs(prefix, role, route) === null) return prefix;
  }
  return legs.slice(0, 1);
}

/** De opgaver led `i` kan faa (praefikset til og med leddet skal vaere gyldigt). */
export function taskOptions(legs, i, role, route) {
  return STAGE_PLAN_TASKS.filter((task) => {
    const prefix = [...legs.slice(0, i), { ...(legs[i] ?? {}), task }];
    if (i === 0) delete prefix[0].from;
    return validateStagePlanLegs(prefix, role, route) === null;
  });
}

/** Alle skift-punkter paa ruten i rutens orden, som de kan staa paa et led. */
export function allTriggers(route) {
  return [
    ...route.climbs.map((c) => ({ at: "kom", kom_index: c.index })),
    { at: "final_km" },
    { at: "dropped" },
  ];
}

export function triggerKey(trigger) {
  if (!trigger) return "";
  return trigger.at === "kom" ? `kom:${trigger.kom_index}` : trigger.at;
}

/** De skift-punkter led `i` (> 0) kan faa. */
export function triggerOptions(legs, i, role, route) {
  return allTriggers(route).filter((from) => {
    const prefix = [...legs.slice(0, i), { ...legs[i], from }];
    return validateStagePlanLegs(prefix, role, route) === null;
  });
}

export function setLegTask(legs, i, task, role, route) {
  const next = legs.map((l, j) => (j === i ? { ...l, task } : l));
  return repairLegs(next, role, route);
}

export function setLegTrigger(legs, i, from, role, route) {
  const next = legs.map((l, j) => (j === i ? { ...l, from } : l));
  return repairLegs(next, role, route);
}

export function removeLeg(legs, i, role, route) {
  if (i === 0 || legs.length <= 1) return legs;
  return repairLegs(legs.filter((_, j) => j !== i), role, route);
}

/** Naeste led der kan tilfoejes (foerste gyldige opgave + skift-punkt), eller null. */
export function nextLeg(legs, role, route) {
  if (legs.length >= STAGE_PLAN_MAX_LEGS) return null;
  for (const from of allTriggers(route)) {
    for (const task of STAGE_PLAN_TASKS) {
      const candidate = [...legs, { task, from }];
      if (validateStagePlanLegs(candidate, role, route) === null) return { task, from };
    }
  }
  return null;
}

/** Ordren med planernes felter: de gamle felter udledes af kaeden (samme regel som serveren). */
export function withStagePlanFields(order) {
  return {
    ...order,
    riders: (order?.riders ?? []).map((r) => (Array.isArray(r.plan) && r.plan.length
      ? { ...r, ...legacyOrderFromPlan(r.plan) }
      : r)),
  };
}

/** Kopi til en anden etape: planer haenger paa ruten og kopieres ikke med. */
export function withoutStagePlans(order) {
  return {
    ...order,
    riders: (order?.riders ?? []).map((r) => {
      if (!("plan" in r)) return r;
      const { plan: _plan, ...rest } = r;
      return rest;
    }),
  };
}

export function setRiderPlan(order, riderId, plan) {
  return {
    ...order,
    riders: (order?.riders ?? []).map((r) => (r.rider_id === riderId ? { ...r, plan } : r)),
  };
}

/**
 * Hvad rytteren faktisk gjorde i hvert led, ud fra tidslinjens stage_plan_leg-
 * events (motoren skriver et pr. skift) og et evt. udgaaet-uheld.
 * Returnerer et element pr. led: { task, status, endReason, endKm, fromKm }.
 *   status: "done" (redet og afsluttet), "to_finish" (sidste redne led),
 *           "skipped" (sprunget over: han blev sat foer), "not_reached",
 *           "abandoned" (udgik i dette led).
 */
export function stagePlanRecap(legs, events, riderId) {
  const switches = (events ?? [])
    .filter((e) => e?.type === "stage_plan_leg" && e.params?.rider_id === riderId)
    .map((e) => ({ km: Number(e.km), leg: Number(e.params.leg), reason: e.params.reason }))
    .sort((a, b) => a.km - b.km);
  const abandon = (events ?? []).find((e) => e?.type === "incident" && e.params?.rider_id === riderId && e.params?.outcome === "abandoned");
  const reached = new Map([[0, 0]]);
  for (const s of switches) reached.set(s.leg, s.km);
  const lastReached = Math.max(...reached.keys());
  return legs.map((leg, i) => {
    if (!reached.has(i)) {
      return { task: leg.task, status: i < lastReached ? "skipped" : "not_reached", endReason: null, endKm: null, fromKm: null };
    }
    const fromKm = reached.get(i);
    const nextSwitch = switches.find((s) => s.leg > i);
    if (nextSwitch) return { task: leg.task, status: "done", endReason: nextSwitch.reason, endKm: nextSwitch.km, fromKm };
    if (abandon) return { task: leg.task, status: "abandoned", endReason: "abandoned", endKm: Number(abandon.km), fromKm };
    return { task: leg.task, status: "to_finish", endReason: "finish", endKm: null, fromKm };
  });
}
