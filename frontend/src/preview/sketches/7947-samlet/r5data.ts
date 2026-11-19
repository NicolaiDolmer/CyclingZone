// #7947 retning 5: data til skitsen. Samme ni ryttere som R4's "Dit hold"
// (navn og nation fra ejerens hold, R4.tsx REAL). Typen er rettet efter
// "Foer"-billedet fra prod (r4-1): Oscar Bermudez er Etapeloebsrytter (GC
// contender), ikke "Allround". Traethed, programmer, felter og XP er
// EKSEMPLER, ikke maalinger og ikke motorens tal (hard rule 17).

import type { Session } from "./model.ts";
import { RIDERS } from "./data.ts";
import { fillRotation } from "./r5model.ts";
import type { RiderType } from "./r4model.ts";

export type R5Rider = {
  id: string;
  name: string;
  nation: string; // ISO-kode til flaget; vises aldrig som tekst
  country: string; // landets navn til flagets title
  type: string; // engelsk ryttertype (spillets riderTypes.json, en)
  typeKey: RiderType; // til hurtigvalgets moenster (r4model)
  fatigue: number;
  overLimit: boolean;
  program: string | null; // det faste program rytteren foelger
  racing: boolean; // koerer etape i dag (felt 3)
};

const OWNER: Record<string, Omit<R5Rider, "id" | "fatigue" | "overLimit" | "program" | "racing">> = {
  r1: { name: "Henok Nguse", nation: "er", country: "Eritrea", type: "Climber", typeKey: "Klatrer" },
  r2: { name: "Zhi Deng", nation: "cn", country: "China", type: "Rouleur", typeKey: "Rouleur" },
  r3: { name: "Zhen Qian", nation: "cn", country: "China", type: "Cobbles specialist", typeKey: "Brostensrytter" },
  r4: { name: "Gabriele Moretti", nation: "it", country: "Italy", type: "Puncheur", typeKey: "Puncheur" },
  r5: { name: "Sota Morita", nation: "jp", country: "Japan", type: "Time-trialist", typeKey: "Enkeltstartsrytter" },
  r6: { name: "Lachlan Sutton", nation: "gb", country: "United Kingdom", type: "Rouleur", typeKey: "Rouleur" },
  r7: { name: "Óscar Bermúdez", nation: "co", country: "Colombia", type: "GC contender", typeKey: "Allround" },
  r8: { name: "Rigoberto Guerrero", nation: "co", country: "Colombia", type: "Rouleur", typeKey: "Rouleur" },
  r9: { name: "Jiwoo Hong", nation: "kr", country: "South Korea", type: "Sprinter", typeKey: "Sprinter" },
};

const PROGRAM: Record<string, string | null> = {
  r1: "Team week", r2: "Team week", r3: "Team week",
  r4: "Ardennes", r5: "Time trial block", r6: "Ardennes",
  r7: "Ardennes", r8: null, r9: "Team week",
};

export const TEAM: R5Rider[] = RIDERS.map((r) => ({
  id: r.id,
  ...OWNER[r.id],
  fatigue: r.fatigueNow,
  overLimit: r.tone === "risk",
  program: PROGRAM[r.id],
  racing: ["r1", "r2", "r3"].includes(r.id),
}));

export const RACE = "Ronde van Preview";

// I dag + syv dage frem (ejer 16/11 og punkt 8). Indeks 0 = i dag.
export const DATES: ReadonlyArray<{ short: string; day: number; long: string; race: string | null; event: string | null }> = [
  { short: "Tue", day: 17, long: "Tuesday 17 November", race: "Stage 3", event: RACE },
  { short: "Wed", day: 18, long: "Wednesday 18 November", race: "Stage 4", event: RACE },
  { short: "Thu", day: 19, long: "Thursday 19 November", race: "Stage 5", event: RACE },
  { short: "Fri", day: 20, long: "Friday 20 November", race: null, event: null },
  { short: "Sat", day: 21, long: "Saturday 21 November", race: "One-day race", event: "Trofeo Preview" },
  { short: "Sun", day: 22, long: "Sunday 22 November", race: "One-day race", event: "GP Preview" },
  { short: "Mon", day: 23, long: "Monday 23 November", race: null, event: null },
  { short: "Tue", day: 24, long: "Tuesday 24 November", race: null, event: null },
];

// Programmets fem felter pr. dato (efter programmet, foer dagens valg).
// "stage" = etape i felt 3 for de tre ryttere i etapeloebet.
// Rotationen "Ardennes": 35 pas i fast raekkefoelge (wireframets eksempel har 35).
export const ROTATION: Session[] = [
  "vo2max_punch", "attack_repeats", "tempo", "endurance", "recovery",
  "endurance", "technique", "endurance", "endurance", "recovery",
  "vo2max_punch", "vo2max_punch", "tempo", "tempo", "recovery",
  "recovery", "endurance", "technique", "endurance", "rest",
  "threshold", "attack_repeats", "tempo", "endurance", "recovery",
  "endurance", "endurance", "endurance", "loebslaere", "recovery",
  "rest", "rest", "rest", "rest", "rest",
];

export type Block = "race" | "restDay" | null;
const free = (): Block[] => [null, null, null, null, null];

// Rytternes uger (eksempler). Loeb i faste felter; en hviledag fylder alle fem.
export const FOLLOWERS: Array<{ id: string; start: number; blocked: Block[][]; races: string[] }> = [
  {
    id: "r4", start: 1, races: ["Sat"],
    blocked: [free(), free(), free(), free(), free(), [null, null, null, null, "race"], free()],
  },
  {
    id: "r6", start: 8, races: [],
    blocked: [free(), free(), free(), ["restDay", "restDay", "restDay", "restDay", "restDay"], free(), free(), free()],
  },
  {
    id: "r7", start: 15, races: ["Sun", "Sun"],
    blocked: [free(), free(), free(), free(), free(), free(), [null, "race", "race", null, null]],
  },
];


// Week blocks: hver dag har sin egen raekkefoelge, eet pas pr. dag kan laases.
export const BLOCKS: Array<{ sessions: Session[]; locked: number }> = [
  { sessions: ["tempo", "endurance", "technique", "endurance", "recovery"], locked: 1 },
  { sessions: ["threshold", "sprint", "tempo", "endurance", "recovery"], locked: 0 },
  { sessions: ["endurance", "endurance", "aero", "technique", "recovery"], locked: 0 },
  { sessions: ["vo2max", "sprint", "tempo", "endurance", "recovery"], locked: 0 },
  { sessions: ["recovery", "recovery", "rest", "rest", "rest"], locked: 0 },
  { sessions: ["sprint", "tempo", "endurance", "endurance", "recovery"], locked: 2 },
  { sessions: ["endurance", "endurance", "endurance", "technique", "recovery"], locked: 0 },
];

// Ugens dag (mandag = 0) for en dato i dagsvaelgeren (i dag = tirsdag).
const weekday = (date: number) => (date + 1) % 7;

export function programFields(rider: R5Rider, date: number): Array<Session | "stage"> {
  const base = RIDERS.find((r) => r.id === rider.id)!;
  if (rider.program === "Team week") {
    // Week blocks (#7456): et loeb tager laveste prioritet foerst (aldrig det
    // laaste pas); resten fylder de ledige felter i prioritetsraekkefoelge.
    const block = BLOCKS[weekday(date)];
    if (!(rider.racing && date <= 2)) return [...block.sessions];
    const drop = block.locked === 4 ? 3 : 4;
    const keep = block.sessions.filter((_, i) => i !== drop);
    let k = 0;
    return [0, 1, 2, 3, 4].map((i) => (i === 2 ? "stage" : keep[k++]));
  }
  if (rider.racing && date <= 2) {
    const today = base.fields.map((f) => (f.kind === "stage" ? "stage" : f.kind === "train" || f.kind === "done" ? f.session : "endurance"));
    return today.map((f, i) => (i === 2 ? "stage" : f === "stage" ? "endurance" : f));
  }
  const follower = FOLLOWERS.find((f) => f.id === rider.id);
  if (follower) {
    // Samme rotation som fanen Program, saa de to faner viser det samme.
    // Rotationen fortsaetter uge efter uge: hver uge starter, hvor den forrige slap.
    let start = follower.start;
    let blocked = follower.blocked;
    for (let w = 0; w < Math.floor((date + 1) / 7); w += 1) {
      start = fillRotation(ROTATION, start, blocked, () => "Race").nextStart;
      blocked = Array.from({ length: 7 }, free);
    }
    const { week } = fillRotation(ROTATION, start, blocked, () => "Race");
    return week[weekday(date)].map((c) => (c.kind === "race" ? "stage" : c.kind === "restDay" ? "rest" : c.session));
  }
  if (date === 0) {
    return base.fields.map((f) => (f.kind === "stage" ? "endurance" : f.kind === "train" || f.kind === "done" ? f.session : "endurance"));
  }
  return base.week[date % 7].map((s) => (s === "S" ? "endurance" : s));
}

// Engelske navne (spillets rider.json/training.json, en, sentence case).
export const SESSION_EN: Record<Session, string> = {
  rest: "Rest", recovery: "Active recovery",
  technique: "Technique", aero: "Aero", loebslaere: "Race craft",
  endurance: "Endurance", tempo: "Tempo",
  vo2max: "VO2max", vo2max_climb: "VO2max (climbing)", vo2max_punch: "VO2max (punch)",
  threshold: "Threshold", sprint: "Sprint",
  cobbled_sectors: "Cobbled sectors", echelon_drills: "Echelon drills", attack_repeats: "Attack repeats",
};

// Spillets korte navne (training.json mobile.sessionShort_*, en).
export const SESSION_SHORT_EN: Record<Session, string> = {
  rest: "Rest", recovery: "Recov", technique: "Tech", aero: "Aero", loebslaere: "Craft",
  endurance: "Long", tempo: "Tempo", vo2max: "VO2", vo2max_climb: "Climb", vo2max_punch: "Punch",
  threshold: "Thresh", sprint: "Sprint", cobbled_sectors: "Pavé", echelon_drills: "Echelon", attack_repeats: "Attack",
};

export const SESSION_GROUPS_EN: Array<{ label: string; sessions: Session[] }> = [
  { label: "Rest", sessions: ["rest", "recovery"] },
  { label: "Easy", sessions: ["endurance", "technique", "aero", "loebslaere"] },
  { label: "Medium", sessions: ["tempo"] },
  { label: "Hard", sessions: ["vo2max", "vo2max_climb", "vo2max_punch", "threshold", "sprint", "cobbled_sectors", "echelon_drills", "attack_repeats"] },
];

// --- Train now-oejeblikket (#8363): EKSEMPEL-XP, XP er ikke taendt ------------

export type MomentRow =
  | { id: string; kind: "race" }
  | { id: string; kind: "train"; focus: string; xp: number; gain: { ability: string; from: number } | null; next: { ability: string; pct: number } | null };

export const MOMENT: MomentRow[] = [
  { id: "r1", kind: "race" },
  { id: "r2", kind: "race" },
  { id: "r3", kind: "race" },
  { id: "r4", kind: "train", focus: "Hard · Puncheur", xp: 520, gain: { ability: "Punch", from: 61 }, next: null },
  { id: "r5", kind: "train", focus: "Program · Time trial block", xp: 580, gain: { ability: "Time trial", from: 58 }, next: null },
  { id: "r6", kind: "train", focus: "Program · Ardennes", xp: 440, gain: null, next: { ability: "Flat", pct: 82 } },
  { id: "r7", kind: "train", focus: "Fatigue rule: light day", xp: 270, gain: null, next: { ability: "Endurance", pct: 59 } },
  { id: "r8", kind: "train", focus: "No program · default", xp: 310, gain: null, next: { ability: "Flat", pct: 73 } },
  { id: "r9", kind: "train", focus: "Program · Team week", xp: 470, gain: { ability: "Acceleration", from: 66 }, next: null },
];
