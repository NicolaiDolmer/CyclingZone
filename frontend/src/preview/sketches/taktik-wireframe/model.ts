// Skitse #7535: taktik-modellen fra wireframe v6c (#7778), oversat ordret fra wireframets script.
// Ingen motor, ingen backend: holdplan, opgaver, prisord og "I aften" regnes som i wireframet.
// Rating, form og træthed er wireframets eksempeltal (private værdier vises kursivt og grå).

import { MY, PROFILES, SCHED, type MyRider, type StageProfile } from "./data.ts";

export type TaskId =
  | "stay_sheltered" | "shelter_leader" | "tempo" | "follow_moves" | "ride_for_result"
  | "attack" | "breakaway" | "sprint_train" | "grupetto" | "ride_in";
export type PlanKind = "gc" | "stage" | "sprint" | "break" | "save";
export type Effort = "hard" | "normal" | "easy";
export type Chase = "chase" | "neutral" | "let_go";

/** [navn, prisniveau 1-4, forklaring] */
export const TASK: Record<TaskId, [string, number, string]> = {
  stay_sheltered: ["Stay sheltered", 1, "saves energy in the bunch"],
  shelter_leader: ["Keep the leader up front", 2, "rides next to the captain"],
  tempo: ["Set the tempo", 3, "pulls at the front"],
  follow_moves: ["Follow the moves", 3, "stays with the best"],
  ride_for_result: ["Ride for a result", 2, "his own pace to the line"],
  attack: ["Attack", 4, "goes clear, the hardest task"],
  breakaway: ["Go in the break", 3, "tries for the morning break"],
  sprint_train: ["Sprint train", 2, "leads out the sprinter"],
  grupetto: ["Grupetto", 1, "saves himself, rides in safely"],
  ride_in: ["Ride in easy", 1, "no effort for the result"],
};
/** Mobilens korte navne til tids-aksen (wireframe v6b-mobil-taktik). */
export const SHORT: Record<TaskId, string> = {
  stay_sheltered: "Sheltered", shelter_leader: "Guard leader", tempo: "Tempo", follow_moves: "Follow",
  ride_for_result: "Result", attack: "Attack", breakaway: "Break", sprint_train: "Lead-out", grupetto: "Grupetto", ride_in: "Ride in",
};
export const WORD = ["", "Easy", "Medium", "Hard", "Very hard"];
export const TONIGHT = ["", "Fresh", "OK", "Tired", "Very tired"];
export const ROLE_L: Record<string, string> = {
  captain: "Captain", co_captain: "Co-captain", sprint_captain: "Sprint captain", helper: "Helper",
  luxury_helper: "Luxury helper", hunter: "Hunter", free_role: "Free role",
};
export const TYPE_LABEL: Record<string, string> = {
  mountain: "Mountain", high_mountain: "High mountain", rolling: "Rolling", hilly: "Hilly", flat: "Flat", itt: "Time trial",
};
export const FINALE: Record<string, string> = {
  long_climb: "Summit finish", flat_sprint: "Sprint finish", uphill_sprint: "Uphill sprint", punchy: "Punchy finish",
};
export const WX: Record<string, [string, string]> = {
  sun: ["w-sun", "Dry"], rain: ["w-rain", "Rain"], cloud: ["w-cloud", "Cloudy"], wind: ["w-wind", "Windy"],
};
export const PLAN_KINDS: PlanKind[] = ["gc", "stage", "sprint", "break", "save"];
export const STAGES = [1, 2, 3, 4, 5, 6, 7];
export const ATTACK_PTS = ["At the foot", "Halfway", "3 km from the top", "At the top"];

/** Eksempeltal (private i spillet): rating og træthed nu. */
const EXV: Record<string, [number, number]> = {
  "Riku Yamada": [78, 24], "Kaito Yoshida": [71, 31], "Jakub Adamczyk": [69, 52], "Sven De Vries": [66, 38],
  "Sven Mertens": [64, 41], "Aitor Delgado": [63, 29], "Valentin Vasseur": [72, 66],
};
const FORM: Record<string, number> = {
  "Riku Yamada": 82, "Kaito Yoshida": 71, "Jakub Adamczyk": 76, "Sven De Vries": 68, "Sven Mertens": 63, "Aitor Delgado": 74, "Valentin Vasseur": 66,
};
export const ratingOf = (r: MyRider) => EXV[r.name]?.[0] ?? 60;
export const fatigueOf = (r: MyRider) => EXV[r.name]?.[1] ?? 30;
export const formOf = (r: MyRider) => FORM[r.name] ?? 60;
export const matchOf = (r: MyRider, n: number) => r.match[n - 1] ?? 50;

const ALL_R = ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"];
const LEAD_R = ["captain", "co_captain", "sprint_captain"];
const ROLES_OF: Record<TaskId, string[]> = {
  breakaway: ALL_R, stay_sheltered: ALL_R, shelter_leader: ["helper", "hunter"], tempo: ["helper", "hunter"],
  follow_moves: [...LEAD_R, "free_role"], attack: [...LEAD_R, "hunter", "free_role"], ride_for_result: [...LEAD_R, "hunter", "free_role"],
  sprint_train: ["helper", "hunter"], grupetto: ["sprint_captain", "helper", "hunter", "free_role"], ride_in: ALL_R,
};
export const canDo = (role: string, t: TaskId) => ROLES_OF[t].includes(role === "luxury_helper" ? "helper" : role);

export const PROFILE: Record<number, StageProfile> = Object.fromEntries(PROFILES.map((p) => [p.n, p]));
export const SCHED_AT: Record<number, Date> = Object.fromEntries(SCHED.map((s, i) => [i + 1, new Date(s)]));
/** Wireframets "nu": mellem etape 1 og 2 (lørdag 16:20 dansk tid). */
export const NOW = new Date("2026-11-07T15:20:00Z");
export const isDone = (n: number) => n === 1;
export const winnerOf = (n: number) => (n === 1 ? "Andrea Tonti" : null);
export const cph = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: "Europe/Copenhagen", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");

export interface TacState {
  stage: number;
  kinds: Record<number, PlanKind>;
  plans: Record<number, Record<string, TaskId[]>>;
  effort: Record<string, Effort>;
  custom: Record<string, boolean>;
  locks: Record<string, boolean>;
  open: Record<string, boolean>;
  extra: Record<string, boolean>;
  attack: Record<string, number>;
  details: boolean;
  chase: Chase;
  sort: { k: string; d: number } | null;
  confirmed: boolean;
  touched: boolean;
  mopen: string | null;
  std: Record<string, PlanKind>;
}

export function initialState(opts: { details?: boolean; mopen?: string | null } = {}): TacState {
  return {
    stage: 2,
    kinds: { 6: "break" },
    plans: {},
    effort: {},
    custom: {},
    locks: {},
    open: {},
    extra: {},
    attack: Object.fromEntries(MY.map((r) => [r.id, 2])),
    details: opts.details ?? false,
    chase: "neutral",
    sort: null,
    confirmed: false,
    touched: false,
    mopen: opts.mopen ?? null,
    std: { flat: "sprint", rolling: "stage", hilly: "stage", mountain: "gc", high_mountain: "gc" },
  };
}

export const captainOf = () => MY.find((r) => r.role === "captain") ?? MY[0];
export const sprinterOf = () => MY.find((r) => r.role === "sprint_captain") ?? MY[0];
export const stageLeader = (n: number) => [...MY].filter((r) => r.role !== "sprint_captain").sort((a, b) => matchOf(b, n) - matchOf(a, n))[0];
export const leaderFor = (kind: PlanKind, n: number) => (kind === "sprint" ? sprinterOf() : kind === "stage" ? stageLeader(n) : captainOf());
export const shortName = (r: MyRider) => r.name.split(" ").slice(-1)[0];

export function planLabel(kind: PlanKind, n: number) {
  const L = shortName(leaderFor(kind, n));
  return { gc: `Ride for GC with ${L}`, stage: `Stage win for ${L}`, sprint: `Sprint for ${L}`, break: "Go for the break", save: "Save the legs" }[kind];
}
export const PLAN_TEXT: Record<PlanKind, string> = {
  gc: "Everyone rides for your GC leader and keeps him out of trouble.",
  stage: "The team works for the rider who suits today's route best.",
  sprint: "The team saves him for the finish, with a train in the last 10 km.",
  break: "Two riders try the break. The rest ride easy.",
  save: "Everyone rides in. Lowest fatigue tonight.",
};

export const kindOf = (s: TacState, n: number): PlanKind => s.kinds[n] ?? s.std[PROFILE[n].type] ?? "gc";
export function roleOf(s: TacState, r: MyRider, n: number) {
  if (kindOf(s, n) === "stage") {
    const L = stageLeader(n);
    if (L.id === r.id) return "captain";
    if (r.role === "captain") return "helper";
  }
  return r.role;
}
export function decisive(n: number) {
  const c = PROFILE[n].climbs.filter((x) => x.cat !== "4");
  return c.length ? c[c.length - 1].name : "the last km";
}
export function legNames(n: number) {
  const p = PROFILE[n];
  const c = p.climbs;
  if (c.length >= 2) return [`To ${c[0].name}`, `To ${c[c.length - 1].name}`, "Last 10 km"];
  if (c.length === 1) return [`To ${c[0].name}`, "To the last 10 km", "Last 10 km"];
  const s = p.sprints[0];
  return [s ? `To the sprint at km ${s}` : "To the last 10 km", "To the last 10 km", "Last 10 km"];
}
export const attackPoints = (n: number) => (PROFILE[n].climbs.length ? ATTACK_PTS : ["Last 5 km", "Last 3 km", "Last km"]);

export function planFor(s: TacState, r: MyRider, kind: PlanKind, n: number): TaskId[] {
  const lead = leaderFor(kind, n).id === r.id;
  if (kind === "save") return ["stay_sheltered", "stay_sheltered", "ride_in"];
  if (kind === "break") return r.breaker ? ["breakaway", "stay_sheltered", "ride_in"] : ["stay_sheltered", "stay_sheltered", "ride_in"];
  if (kind === "sprint")
    return lead ? ["stay_sheltered", "stay_sheltered", "ride_for_result"]
      : roleOf(s, r, n) === "captain" ? ["stay_sheltered", "stay_sheltered", "ride_in"] : ["shelter_leader", "tempo", "sprint_train"];
  if (lead) return ["stay_sheltered", "stay_sheltered", PROFILE[n].climbs.length ? "attack" : "ride_for_result"];
  return r.role === "sprint_captain" ? ["grupetto", "grupetto", "grupetto"] : ["shelter_leader", "tempo", "tempo"];
}
export function buildPlans(s: TacState, n: number, keep?: Record<string, TaskId[]>) {
  const k = kindOf(s, n);
  return Object.fromEntries(MY.map((r) => [r.id, keep && s.locks[`${n}|${r.id}`] ? keep[r.id] : planFor(s, r, k, n)]));
}
export const plansOf = (s: TacState, n: number) => s.plans[n] ?? buildPlans(s, n);

export function effortPlan(s: TacState, r: MyRider, k: Effort, n: number): TaskId[] {
  const role = roleOf(s, r, n);
  if (k === "easy") return ["stay_sheltered", "stay_sheltered", "ride_in"];
  if (k === "hard")
    return canDo(role, "attack")
      ? (["follow_moves", "follow_moves", PROFILE[n].climbs.length ? "attack" : "ride_for_result"] as TaskId[]).map((t) => (canDo(role, t) ? t : "stay_sheltered"))
      : ["tempo", "tempo", "tempo"];
  return planFor(s, r, kindOf(s, n), n);
}

export function say(s: TacState, r: MyRider, n: number) {
  const p = plansOf(s, n)[r.id];
  const L = leaderFor(kindOf(s, n), n);
  if (p[0] === "breakaway") return "Tries the break, then rides in easy";
  return {
    attack: `Attacks on ${decisive(n)}`, ride_for_result: "Rides for a result", follow_moves: "Follows the best", tempo: "Sets the tempo",
    shelter_leader: `Keeps ${shortName(L)} up front`, stay_sheltered: "Stays sheltered", grupetto: "Grupetto, saves himself",
    sprint_train: "Leads out the sprint", ride_in: "Rides in easy", breakaway: "Tries the break",
  }[p[2]];
}

export function tonightLevel(s: TacState, r: MyRider, n: number) {
  const add = plansOf(s, n)[r.id].reduce((acc, t) => acc + TASK[t][1] * 3, 0);
  const v = fatigueOf(r) + add;
  return v < 40 ? 1 : v < 58 ? 2 : v < 72 ? 3 : 4;
}

export function sortedMy(s: TacState, n: number) {
  if (!s.sort) return MY;
  const { k, d } = s.sort;
  const v = (r: MyRider): string | number =>
    k === "rider" ? r.name : k === "role" ? ROLE_L[r.role] ?? "" : k === "rating" ? ratingOf(r) : k === "form" ? formOf(r)
      : k === "match" ? matchOf(r, n) : k === "fatigue" ? fatigueOf(r) : 0;
  return [...MY].sort((a, b) => {
    const x = v(a);
    const y = v(b);
    return (typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : Number(x) - Number(y)) * d;
  });
}

/** Etapestribens ord under hvert kort: vinder, "Changed" eller "Standard". */
export function stripWord(s: TacState, n: number) {
  if (isDone(n)) return winnerOf(n) ?? "Finished";
  const q = PROFILE[n];
  return s.kinds[n] && s.kinds[n] !== s.std[q.type] ? "Changed" : "Standard";
}

export const stepOptions = (i: number): TaskId[] =>
  i === 0 ? ["stay_sheltered", "shelter_leader", "tempo", "breakaway", "grupetto"]
    : i === 1 ? ["stay_sheltered", "shelter_leader", "tempo", "follow_moves", "grupetto"]
      : ["follow_moves", "ride_for_result", "attack", "shelter_leader", "tempo", "sprint_train", "grupetto", "ride_in"];
