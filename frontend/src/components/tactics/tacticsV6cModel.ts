// #8298 · Wireframe v6c's taktik-række som ren logik (ingen React, ingen I/O).
//
// Ejerens beslutninger 17/11 (#8354, #8364), gengivet af PC1-dirigenten:
// - Indsatsen er Easy | Medium | Hard på én linje, let til venstre. Ordrerne langs ruten
//   skifter selv efter valget. De fem trin og ordrerne pr. rutedel ligger bag "All orders".
// - Ruten er delt i wireframets rutedele: "To <første stigning>", "To <sidste stigning>",
//   "Last 10 km". Hver del har én opgave; kæden gemmes som serverens etapeplan (legs), så
//   motoren, valideringen og gem-vejen er præcis de samme som før.
// - "Day load" er dagens forventede belastning i ord og pil, aldrig et facit for aftenen.
//   Ordet følger motorens egen regel for dagens pris: etapens belastning ganges med
//   indsats-faktoren for planens HÅRDESTE opgave (hardestPlanEffort, #7715;
//   backend/lib/conditionModelV2.js stageLoadV2 + raceRoles.effortFatigueMultiplier).
//   Faktorerne stiger i samme orden på alle profiler: grupetto < spar < normal < beskyt <
//   alt ud. Et udbrud er det ene navngivne undtagelse, som prisordet (TASK_COST_EXCEPTIONS):
//   motoren lægger ekstra arbejde til for tid i en front-gruppe, så det er mindst en hård dag.
import {
  STAGE_PLAN_TASKS, TASK_ROLES, TERMINAL_TASKS, hardestPlanEffort, repairLegs, triggerKm, validateStagePlanLegs,
  type StagePlanEffort, type StagePlanLeg, type StagePlanRole, type StagePlanRoute, type StagePlanTask, type StagePlanTrigger,
} from "../race/StagePlanModel.ts";

// ── Rutedelene ───────────────────────────────────────────────────────────────

export type RoutePartLabel =
  | { key: "toClimb"; name: string }
  | { key: "toLastTen" }
  | { key: "lastTen" };

export interface RoutePart {
  /** Hvor delen begynder (km fra start). */
  km: number;
  /** Skift-punktet delen begynder ved; null for den første del. */
  from: StagePlanTrigger | null;
  label: RoutePartLabel;
}

/** Stigningerne med navn, inkl. en topafslutning (ruten selv udelader den som skift-punkt). */
export interface NamedClimb { km: number; name: string | null; summit: boolean }

/**
 * Wireframets rutedele (legNames i v6c): to stigninger eller flere giver "To <første>",
 * "To <sidste>", "Last 10 km"; én stigning "To <den>", "To the last 10 km", "Last 10 km";
 * ingen stigninger "To the last 10 km", "Last 10 km". Delene begynder ved et skift-punkt,
 * motoren kender (toppen af den første stigning, 10 km fra mål), så kæden kan gemmes.
 */
export function routeParts(route: StagePlanRoute, named: readonly NamedClimb[] = []): RoutePart[] {
  const finalKm = triggerKm({ at: "final_km" }, route) ?? 0;
  const lastTen: RoutePart = { km: finalKm, from: { at: "final_km" }, label: { key: "lastTen" } };
  const climbs = [...route.climbs].filter((c) => c.km < finalKm).sort((a, b) => a.km - b.km);
  const first = climbs[0] ?? null;
  if (!first) return [{ km: 0, from: null, label: { key: "toLastTen" } }, lastTen];
  const allNamed = [...named].sort((a, b) => a.km - b.km);
  const nameOf = (km: number, fallback: string | null) => allNamed.find((c) => Math.abs(c.km - km) < 0.05)?.name ?? fallback;
  const last = allNamed.length ? allNamed[allNamed.length - 1] : null;
  const firstName = nameOf(first.km, first.name) ?? "";
  const middle: RoutePartLabel = last && last.km > first.km + 0.05 && last.name ? { key: "toClimb", name: last.name } : { key: "toLastTen" };
  return [
    { km: 0, from: null, label: { key: "toClimb", name: firstName } },
    { km: first.km, from: { at: "kom", kom_index: first.index }, label: middle },
    lastTen,
  ];
}

/** Den opgave hver rutedel kører i kæden. Et led der begynder inde i en del, gælder for delen. */
export function partTasks(legs: readonly StagePlanLeg[] | null | undefined, route: StagePlanRoute, parts: readonly RoutePart[]): StagePlanTask[] | null {
  if (!Array.isArray(legs) || legs.length === 0) return null;
  const positioned = legs
    .map((leg, i) => ({ task: leg.task, km: i === 0 ? 0 : triggerKm(leg.from, route) }))
    .filter((l): l is { task: StagePlanTask; km: number } => l.km !== null);
  return parts.map((part, i) => {
    const end = parts[i + 1]?.km ?? Infinity;
    const inside = positioned.filter((l) => l.km >= part.km && l.km < end);
    if (inside.length) return inside[inside.length - 1].task;
    const before = positioned.filter((l) => l.km <= part.km);
    return (before[before.length - 1] ?? positioned[0]).task;
  });
}

/** Leddet "hvis han bliver sat" (dropped) står ikke på en rutedel; det vises for sig. */
export function droppedLeg(legs: readonly StagePlanLeg[] | null | undefined): StagePlanLeg | null {
  const last = Array.isArray(legs) ? legs[legs.length - 1] : undefined;
  return last && last.from?.at === "dropped" ? last : null;
}

/**
 * Kæden for en opgave pr. rutedel. Ens nabo-dele bliver ét led; en afsluttende opgave
 * (sprinttog, grupetto, kør ind) slutter kæden. Et eksisterende "hvis han bliver sat"-led
 * bevares, hvis kæden stadig er gyldig med det. Ugyldigt = længste gyldige begyndelse.
 */
export function legsFromParts(tasks: readonly StagePlanTask[], parts: readonly RoutePart[], role: StagePlanRole, route: StagePlanRoute, keepDropped: StagePlanLeg | null = null): StagePlanLeg[] {
  const legs: StagePlanLeg[] = [];
  tasks.forEach((task, i) => {
    const prev = legs[legs.length - 1];
    if (prev && (prev.task === task || TERMINAL_TASKS.has(prev.task))) return;
    const from = parts[i]?.from;
    legs.push(i === 0 || !from ? { task } : { task, from });
  });
  if (keepDropped && !TERMINAL_TASKS.has(legs[legs.length - 1].task)) {
    const withDropped = [...legs, keepDropped];
    if (validateStagePlanLegs(withDropped, role, route) === null) return withDropped;
  }
  return repairLegs(legs, role, route);
}

const PICKABLE: readonly StagePlanTask[] = STAGE_PLAN_TASKS.filter((t) => t !== "hunt_points" && t !== "hunt_kom");

/** De opgaver en rutedel kan få for rollen: kun dem kæden kan gemme med. */
export function partTaskOptions(tasks: readonly StagePlanTask[], index: number, parts: readonly RoutePart[], role: StagePlanRole, route: StagePlanRoute): StagePlanTask[] {
  return PICKABLE.filter((task) => {
    if (!TASK_ROLES[task].includes(role)) return false;
    const next = setPartTask(tasks, index, task);
    const legs = legsFromParts(next, parts, role, route);
    return validateStagePlanLegs(legs, role, route) === null && partTasks(legs, route, parts)?.[index] === task;
  });
}

/** Sæt én rutedels opgave. En afsluttende opgave gælder også resten af ruten. */
export function setPartTask(tasks: readonly StagePlanTask[], index: number, task: StagePlanTask): StagePlanTask[] {
  return tasks.map((current, i) => (i === index || (i > index && TERMINAL_TASKS.has(task)) ? task : current));
}

// ── Easy | Medium | Hard ─────────────────────────────────────────────────────

export type EffortLevel = "easy" | "medium" | "hard";
export const EFFORT_LEVELS: readonly EffortLevel[] = ["easy", "medium", "hard"];

/**
 * Kæderne bag de tre valg (wireframets effortPlan). Easy: i ly hele vejen og kør ind de
 * sidste 10 km. Hard: lederen følger de bedste og angriber i finalen (resultat på en etape
 * uden stigninger); en hjælper kører tempo hele vejen. Medium: holdplanens kæde for
 * rytteren (eller assistentens forslag). Kun kæder rollen må gemme; ellers rollens nærmeste.
 */
export function levelPlans(role: StagePlanRole, route: StagePlanRoute, parts: readonly RoutePart[], medium: StagePlanLeg[] | null, finaleHasClimb: boolean): Record<EffortLevel, StagePlanLeg[] | null> {
  const fit = (task: StagePlanTask, fallback: StagePlanTask): StagePlanTask => (TASK_ROLES[task].includes(role) ? task : fallback);
  const n = parts.length;
  const easy = Array.from({ length: n }, (_, i) => (i === n - 1 ? "ride_in" : "stay_sheltered") as StagePlanTask);
  const leader = TASK_ROLES.attack.includes(role);
  const hard = leader
    ? Array.from({ length: n }, (_, i) => (i === n - 1 ? fit(finaleHasClimb ? "attack" : "ride_for_result", "ride_for_result") : fit("follow_moves", "stay_sheltered")))
    : Array.from({ length: n }, () => fit("tempo", "stay_sheltered"));
  const build = (tasks: StagePlanTask[]) => {
    const legs = legsFromParts(tasks, parts, role, route);
    return validateStagePlanLegs(legs, role, route) === null ? legs : null;
  };
  return { easy: build(easy), medium: medium && medium.length ? medium : null, hard: build(hard) };
}

const sameLegs = (a: readonly StagePlanLeg[] | null | undefined, b: readonly StagePlanLeg[] | null | undefined) =>
  !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/** Hvilket af de tre valg kæden er. Alt andet end Easy og Hard er Medium (holdplanen eller spillerens egen). */
export function levelOfLegs(legs: readonly StagePlanLeg[] | null | undefined, plans: Record<EffortLevel, StagePlanLeg[] | null>): EffortLevel {
  if (sameLegs(legs, plans.easy)) return "easy";
  if (sameLegs(legs, plans.hard)) return "hard";
  return "medium";
}

/** Uden etapeplan (tidskørsel, eller planen er slået fra): de tre valg er indsats-trin. */
export function levelOfEffort(effort: string | null | undefined): EffortLevel {
  if (effort === "grupetto" || effort === "save") return "easy";
  if (effort === "protect" || effort === "all_out") return "hard";
  return "medium";
}

/** Indsats-trinnet bag et valg, blandt etapens egne trin (serverens valid_efforts). */
export function effortForLevel(level: EffortLevel, steps: readonly string[]): string | null {
  const order: Record<EffortLevel, string[]> = { easy: ["save", "grupetto"], medium: ["normal"], hard: ["protect", "all_out"] };
  return order[level].find((s) => steps.includes(s)) ?? null;
}

// ── Day load ─────────────────────────────────────────────────────────────────

export type DayLoad = "easy" | "light" | "normal" | "hard" | "veryHard";
export const DAY_LOADS: readonly DayLoad[] = ["easy", "light", "normal", "hard", "veryHard"];

const LOAD_BY_EFFORT: Readonly<Record<StagePlanEffort, DayLoad>> = Object.freeze({
  grupetto: "easy", save: "light", normal: "normal", protect: "hard", all_out: "veryHard",
});

/** Dagens belastning for en kæde (se reglen øverst i filen). */
export function dayLoadOfLegs(legs: readonly StagePlanLeg[]): DayLoad {
  const word = LOAD_BY_EFFORT[hardestPlanEffort(legs)];
  if (legs[0]?.task === "breakaway" && DAY_LOADS.indexOf(word) < DAY_LOADS.indexOf("hard")) return "hard";
  return word;
}

/**
 * Dagens belastning for et indsats-trin uden etapeplan. På en tidskørsel (s5_profiles_v3)
 * gælder motorens tidskørsels-regel: spar, beskyt og grupetto får spar-rabatten (#7332),
 * alt ud koster mest (#7280), normal er etapens fulde belastning.
 */
export function dayLoadOfEffort(effort: string | null | undefined, timeTrial: boolean): DayLoad {
  const e = (effort ?? "normal") as StagePlanEffort;
  if (timeTrial) return e === "all_out" ? "veryHard" : e === "normal" ? "normal" : "light";
  return LOAD_BY_EFFORT[e] ?? "normal";
}

/** Pilens retning og størrelse: energi op, uændret, lidt ned, ned, meget ned. */
export const DAY_LOAD_ARROW: Readonly<Record<DayLoad, "up" | "flat" | "downSlight" | "down" | "downMuch">> = Object.freeze({
  easy: "up", light: "flat", normal: "downSlight", hard: "down", veryHard: "downMuch",
});

/** Farven fra træthedens varme skala (#8364): neutral, rav, rød. */
export function dayLoadTone(load: DayLoad): "neutral" | "amber" | "red" {
  if (load === "veryHard") return "red";
  if (load === "hard") return "amber";
  return "neutral";
}

// ── Træthedens varme skala (#8364) ───────────────────────────────────────────

/**
 * Træthed nu på en varm skala: neutral (frisk) → rav → rød (meget træt). Samme grænser
 * som spillets ord for træthed (freshnessTier: frisk under 34, OK under 67, træt derover),
 * med rav der vokser jævnt hen over midten. Rød er kun advarslen øverst.
 */
export function fatigueTone(value: number | null | undefined): { tone: "neutral" | "amber" | "red"; strength: number } {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 34) return { tone: "neutral", strength: 0 };
  if (value < 67) return { tone: "amber", strength: Math.round(((value - 34) / 33) * 100) };
  return { tone: "red", strength: Math.round(Math.min(1, (value - 67) / 33) * 100) };
}

// ── "Today" (wireframets say) ────────────────────────────────────────────────

export type TodayLine =
  | { key: "breakaway" }
  | { key: "attack"; climb: string | null }
  | { key: "shelterLeader"; leader: string | null }
  | { key: Exclude<StagePlanTask, "attack" | "shelter_leader" | "breakaway" | "hunt_points" | "hunt_kom"> }
  | { key: "huntPoints" };

/** Dagens linje ud fra kæden: udbruddet, ellers finalens opgave. */
export function todayLine(legs: readonly StagePlanLeg[], decisiveClimb: string | null, leader: string | null): TodayLine {
  if (legs[0]?.task === "breakaway") return { key: "breakaway" };
  const positioned = legs.filter((l) => l.from?.at !== "dropped");
  const last = (positioned[positioned.length - 1] ?? legs[0]).task;
  if (last === "attack") return { key: "attack", climb: decisiveClimb };
  if (last === "shelter_leader") return { key: "shelterLeader", leader };
  if (last === "hunt_points" || last === "hunt_kom") return { key: "huntPoints" };
  return { key: last } as TodayLine;
}

// ── Låsen ────────────────────────────────────────────────────────────────────

/**
 * Holdplanen lagt oven på kladden, med de låste ryttere uændrede (ejer 17/11, valg A):
 * en låst rytter beholder sin kæde, sine felter og sin rolle, når holdplanen skiftes.
 */
export function withLockedRiders<R extends { rider_id: string }, O extends { riders?: R[] }>(planOrder: O, current: O, locked: ReadonlySet<string>): O {
  if (!locked.size) return planOrder;
  const keep = new Map((current.riders ?? []).map((r) => [r.rider_id, r]));
  return { ...planOrder, riders: (planOrder.riders ?? []).map((r) => (locked.has(r.rider_id) && keep.has(r.rider_id) ? keep.get(r.rider_id)! : r)) };
}
