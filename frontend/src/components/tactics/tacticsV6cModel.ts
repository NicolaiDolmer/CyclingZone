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
  // #8828 (ejer 26/11): en stigning uden navn vises med kategori og km ("Kat. 3 ved km 87").
  | { key: "toClimbUnnamed"; category: string; km: number }
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
 * Rutedelene. #8828 (ejer 26/11, K1 på #7884): HVER kategoriseret stigning før de sidste 10 km
 * er en grænse, så ingen stigning skjules (før delte de faste dele ruten i "To <første>",
 * "To <sidste>", "Last 10 km", og en midterste stigning fandtes ikke). Delene er:
 * "To <stigning 1>", "To <stigning 2>", ..., derefter "To <målstigningen>" ved en topafslutning
 * (ellers "To the last 10 km"), og "Last 10 km". Uden stigninger: "To the last 10 km", "Last 10 km".
 * Hver del begynder ved et skift-punkt motoren kender (toppen af forrige stigning, 10 km fra mål),
 * så kæden kan gemmes; en stigning uden navn vises med kategori og km.
 */
export function routeParts(route: StagePlanRoute, named: readonly NamedClimb[] = []): RoutePart[] {
  const finalKm = triggerKm({ at: "final_km" }, route) ?? 0;
  const lastTen: RoutePart = { km: finalKm, from: { at: "final_km" }, label: { key: "lastTen" } };
  const climbs = [...route.climbs].filter((c) => c.km < finalKm).sort((a, b) => a.km - b.km || a.index - b.index);
  if (!climbs.length) return [{ km: 0, from: null, label: { key: "toLastTen" } }, lastTen];
  const allNamed = [...named].sort((a, b) => a.km - b.km);
  const nameOf = (km: number, fallback: string | null) => allNamed.find((c) => Math.abs(c.km - km) < 0.05)?.name || fallback || null;
  const climbLabel = (c: (typeof climbs)[number]): RoutePartLabel => {
    const name = nameOf(c.km, c.name);
    return name ? { key: "toClimb", name } : { key: "toClimbUnnamed", category: c.category, km: Math.round(c.km) };
  };
  const lastClimb = climbs[climbs.length - 1];
  const last = allNamed.length ? allNamed[allNamed.length - 1] : null;
  const afterLast: RoutePartLabel = last && last.km > lastClimb.km + 0.05 && last.name ? { key: "toClimb", name: last.name } : { key: "toLastTen" };
  return [
    { km: 0, from: null, label: climbLabel(climbs[0]) },
    ...climbs.map((c, i): RoutePart => ({ km: c.km, from: { at: "kom", kom_index: c.index }, label: i + 1 < climbs.length ? climbLabel(climbs[i + 1]) : afterLast })),
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

/** Et led som kædens første: uden skift-punkt, men med al anden metadata (fx trøjejagten `hunt`). */
function openingLeg(leg: StagePlanLeg): StagePlanLeg {
  const { from: _from, ...rest } = leg;
  return rest;
}

/**
 * Kæden for en opgave pr. rutedel. Ens nabo-dele bliver ét led; en afsluttende opgave
 * (sprinttog, grupetto, kør ind) slutter kæden. Et eksisterende "hvis han bliver sat"-led
 * bevares, hvis kæden stadig er gyldig med det. Ugyldigt = længste gyldige begyndelse.
 *
 * `original` (Codex P1 #8298): den gemte kæde. En rutedel, hvis opgave ikke er ændret, beholder
 * sine oprindelige led med deres egne skift-punkter (fx et angreb fra den ANDEN stigning inde i
 * delen), så en ændring i én del aldrig flytter ordrer i en anden. Kun en ændret del får delens
 * skift-punkt.
 */
export function legsFromParts(tasks: readonly StagePlanTask[], parts: readonly RoutePart[], role: StagePlanRole, route: StagePlanRoute, keepDropped: StagePlanLeg | null = null, original: readonly StagePlanLeg[] | null = null): StagePlanLeg[] {
  const before = original ? partTasks(original, route, parts) : null;
  const positioned = (original ?? [])
    .map((leg, i) => ({ leg, km: i === 0 ? 0 : triggerKm(leg.from, route) }))
    .filter((l): l is { leg: StagePlanLeg; km: number } => l.km !== null);
  const candidates: StagePlanLeg[] = [];
  tasks.forEach((task, i) => {
    const end = parts[i + 1]?.km ?? Infinity;
    const kept = before && before[i] === task
      ? positioned.filter((l) => (i === 0 ? l.km < end : l.km >= parts[i].km && l.km < end)).map((l) => l.leg)
      : [];
    if (kept.length) { candidates.push(...kept); return; }
    const from = parts[i]?.from;
    candidates.push(i === 0 || !from ? { task } : { task, from });
  });
  const legs: StagePlanLeg[] = [];
  candidates.forEach((leg, i) => {
    const prev = legs[legs.length - 1];
    if (prev && (prev.task === leg.task || TERMINAL_TASKS.has(prev.task))) return;
    // Første led har intet skift-punkt, men beholder resten (Codex P1 #8298: udbrudsleddets `hunt`).
    legs.push(i === 0 || legs.length === 0 ? openingLeg(leg) : leg);
  });
  if (keepDropped && !TERMINAL_TASKS.has(legs[legs.length - 1].task)) {
    const withDropped = [...legs, keepDropped];
    if (validateStagePlanLegs(withDropped, role, route) === null) return withDropped;
  }
  return repairLegs(legs, role, route);
}

const PICKABLE: readonly StagePlanTask[] = STAGE_PLAN_TASKS.filter((t) => t !== "hunt_points" && t !== "hunt_kom");

/** De opgaver en rutedel kan få for rollen: kun dem kæden kan gemme med. */
export function partTaskOptions(tasks: readonly StagePlanTask[], index: number, parts: readonly RoutePart[], role: StagePlanRole, route: StagePlanRoute, original: readonly StagePlanLeg[] | null = null): StagePlanTask[] {
  return PICKABLE.filter((task) => {
    if (!TASK_ROLES[task].includes(role)) return false;
    const next = setPartTask(tasks, index, task);
    const legs = legsFromParts(next, parts, role, route, null, original);
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
  | { key: "attack"; climb: string } | { key: "attackFinale" } | { key: "attackUnspecified" }
  | { key: "shelterLeader"; leader: string | null }
  | { key: Exclude<StagePlanTask, "attack" | "shelter_leader" | "breakaway" | "hunt_points" | "hunt_kom"> }
  | { key: "huntPoints" };

/** Dagens plan i rækkefølge. Ordren ved afsætning vises under ordrer. */
export function todayTasks(legs: readonly StagePlanLeg[], climbs: StagePlanRoute["climbs"], leader: string | null): TodayLine[] {
  const positioned = legs.filter((leg) => leg.from?.at !== "dropped");
  return (positioned.length ? positioned : legs).map(({ task, from }): TodayLine => {
    switch (task) {
      case "attack": {
        if (from?.at === "final_km") return { key: "attackFinale" };
        const climb = from?.at === "kom" ? climbs.find(c => c.index === from.kom_index)?.name : null;
        return climb ? { key: "attack", climb } : { key: "attackUnspecified" };
      }
      case "shelter_leader": return { key: "shelterLeader", leader };
      case "hunt_points":
      case "hunt_kom": return { key: "huntPoints" };
      default: return { key: task };
    }
  });
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
