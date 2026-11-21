// #7947 retning 5, fanerne Udvikling og Rapport: data til skitsen.
// Samme ni ryttere som resten af R5 (navn og nation fra ejerens hold). Alt
// andet er EKSEMPLER: rating, forventet top, XP, evner og traethed er opdigtede
// tal, ikke maalinger og ikke motorens tal (hard rule 17). XP er ikke taendt
// (#6110), saa fanerne er "klar til": de viser formen, ikke spillets tal.

import type { Session } from "./model.ts";

// --- Udvikling ----------------------------------------------------------------

export type AbilityLine = { name: string; now: number; season: number; pct: number };

export type DevRow = {
  id: string;
  rating: number; // nuvaerende rating (eksempel)
  top: number; // forventet topniveau (eksempel), "sidst i 20'erne"
  season: number; // evnepoint i denne saeson
  xpToday: number | null; // null = loebet afregnes efter etapen
  pointToday: string | null; // evne der steg i dag
  spark: number[]; // XP pr. dag, de sidste 30 dage (aeldst foerst, sidste = i dag)
  next: { ability: string; pct: number }; // vejen til naeste evnepoint, i procent af bjaelken
  abilities: AbilityLine[];
};

// En fast, laesbar raekke: stoerre tal paa traeningsdage, lavere paa hvile og
// loebsdage. Ingen tilfaeldighed, saa billedet er det samme hver gang.
function series(level: number, shape: number, today: number | null): number[] {
  const out: number[] = [];
  for (let i = 0; i < 30; i += 1) {
    const rest = i % 7 === 5 || i % 7 === 6;
    const wave = 0.78 + (((i * 5 + shape * 3) % 9) / 9) * 0.44;
    out.push(Math.round((rest ? level * 0.28 : level * wave) / 5) * 5);
  }
  out[29] = today ?? 0;
  return out;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

const DEV_BASE: Array<Omit<DevRow, "spark"> & { level: number; shape: number }> = [
  { id: "r1", level: 470, shape: 1, rating: 71, top: 78, season: 6, xpToday: null, pointToday: null, next: { ability: "Climbing", pct: 64 },
    abilities: [{ name: "Climbing", now: 74, season: 3, pct: 64 }, { name: "Endurance", now: 70, season: 2, pct: 38 }, { name: "Recovery", now: 66, season: 1, pct: 21 }, { name: "Flat", now: 58, season: 0, pct: 12 }] },
  { id: "r2", level: 410, shape: 2, rating: 66, top: 72, season: 3, xpToday: null, pointToday: null, next: { ability: "Flat", pct: 41 },
    abilities: [{ name: "Flat", now: 69, season: 2, pct: 41 }, { name: "Time trial", now: 64, season: 1, pct: 52 }, { name: "Endurance", now: 65, season: 0, pct: 70 }, { name: "Climbing", now: 55, season: 0, pct: 9 }] },
  { id: "r3", level: 360, shape: 3, rating: 64, top: 70, season: 2, xpToday: null, pointToday: null, next: { ability: "Cobbles", pct: 77 },
    abilities: [{ name: "Cobbles", now: 68, season: 2, pct: 77 }, { name: "Flat", now: 66, season: 0, pct: 30 }, { name: "Endurance", now: 63, season: 0, pct: 44 }, { name: "Sprint", now: 52, season: 0, pct: 5 }] },
  { id: "r4", level: 520, shape: 4, rating: 69, top: 76, season: 5, xpToday: 520, pointToday: "Punch", next: { ability: "Punch", pct: 12 },
    abilities: [{ name: "Punch", now: 62, season: 3, pct: 12 }, { name: "Climbing", now: 67, season: 1, pct: 58 }, { name: "Acceleration", now: 66, season: 1, pct: 33 }, { name: "Endurance", now: 64, season: 0, pct: 82 }] },
  { id: "r5", level: 560, shape: 5, rating: 68, top: 77, season: 5, xpToday: 580, pointToday: "Time trial", next: { ability: "Time trial", pct: 9 },
    abilities: [{ name: "Time trial", now: 59, season: 4, pct: 9 }, { name: "Flat", now: 67, season: 1, pct: 61 }, { name: "Endurance", now: 66, season: 0, pct: 47 }, { name: "Recovery", now: 60, season: 0, pct: 26 }] },
  { id: "r6", level: 430, shape: 6, rating: 65, top: 71, season: 3, xpToday: 440, pointToday: null, next: { ability: "Flat", pct: 82 },
    abilities: [{ name: "Flat", now: 68, season: 2, pct: 82 }, { name: "Endurance", now: 64, season: 1, pct: 36 }, { name: "Punch", now: 57, season: 0, pct: 18 }, { name: "Recovery", now: 61, season: 0, pct: 40 }] },
  { id: "r7", level: 300, shape: 7, rating: 70, top: 75, season: 2, xpToday: 270, pointToday: null, next: { ability: "Endurance", pct: 59 },
    abilities: [{ name: "Endurance", now: 71, season: 1, pct: 59 }, { name: "Climbing", now: 72, season: 1, pct: 28 }, { name: "Time trial", now: 66, season: 0, pct: 43 }, { name: "Recovery", now: 68, season: 0, pct: 15 }] },
  { id: "r8", level: 330, shape: 8, rating: 63, top: 68, season: 1, xpToday: 310, pointToday: null, next: { ability: "Flat", pct: 73 },
    abilities: [{ name: "Flat", now: 65, season: 1, pct: 73 }, { name: "Endurance", now: 62, season: 0, pct: 51 }, { name: "Recovery", now: 59, season: 0, pct: 22 }, { name: "Climbing", now: 50, season: 0, pct: 7 }] },
  { id: "r9", level: 500, shape: 9, rating: 67, top: 74, season: 4, xpToday: 470, pointToday: "Acceleration", next: { ability: "Acceleration", pct: 17 },
    abilities: [{ name: "Acceleration", now: 67, season: 3, pct: 17 }, { name: "Sprint", now: 70, season: 1, pct: 66 }, { name: "Flat", now: 64, season: 0, pct: 35 }, { name: "Endurance", now: 61, season: 0, pct: 48 }] },
];

export const DEV: DevRow[] = DEV_BASE.map(({ level, shape, ...row }) => ({ ...row, spark: series(level, shape, row.xpToday) }));
export const devXp30 = (row: DevRow): number => sum(row.spark);

// --- Rapport (en afregnet dag: mandag 16. november) ---------------------------

export type ReportPoint = { ability: string; fromBar: boolean };
export type ReportAbility = { name: string; xp: number; pct: number; point: boolean };

export type ReportRow = {
  id: string;
  training: number; // XP fra traeningsfelter
  race: number; // XP fra loebet
  points: ReportPoint[]; // evnepoint landet i dag
  fatigue: number; // traethed efter dagen
  delta: number; // aendring i dag
  sessions: Array<Session | "stage">; // dagens fem felter
  abilities: ReportAbility[];
};

export const REPORT: ReportRow[] = [
  { id: "r1", training: 210, race: 180, points: [{ ability: "Climbing", fromBar: false }], fatigue: 61, delta: 9, sessions: ["endurance", "tempo", "stage", "endurance", "recovery"],
    abilities: [{ name: "Climbing", xp: 150, pct: 64, point: true }, { name: "Endurance", xp: 140, pct: 38, point: false }, { name: "Recovery", xp: 100, pct: 21, point: false }] },
  { id: "r2", training: 205, race: 150, points: [], fatigue: 55, delta: 7, sessions: ["endurance", "tempo", "stage", "technique", "recovery"],
    abilities: [{ name: "Flat", xp: 160, pct: 41, point: false }, { name: "Endurance", xp: 120, pct: 70, point: false }, { name: "Recovery", xp: 75, pct: 12, point: false }] },
  { id: "r3", training: 190, race: 170, points: [{ ability: "Cobbles", fromBar: true }], fatigue: 74, delta: 8, sessions: ["endurance", "tempo", "stage", "endurance", "recovery"],
    abilities: [{ name: "Cobbles", xp: 140, pct: 77, point: true }, { name: "Flat", xp: 130, pct: 30, point: false }, { name: "Endurance", xp: 90, pct: 44, point: false }] },
  { id: "r4", training: 470, race: 0, points: [{ ability: "Punch", fromBar: false }], fatigue: 50, delta: 6, sessions: ["vo2max_punch", "attack_repeats", "tempo", "endurance", "recovery"],
    abilities: [{ name: "Punch", xp: 220, pct: 12, point: true }, { name: "Acceleration", xp: 130, pct: 33, point: false }, { name: "Climbing", xp: 90, pct: 58, point: false }, { name: "Endurance", xp: 30, pct: 82, point: false }] },
  { id: "r5", training: 540, race: 0, points: [], fatigue: 45, delta: 7, sessions: ["threshold", "tempo", "aero", "endurance", "recovery"],
    abilities: [{ name: "Time trial", xp: 280, pct: 91, point: false }, { name: "Flat", xp: 150, pct: 61, point: false }, { name: "Endurance", xp: 110, pct: 47, point: false }] },
  { id: "r6", training: 430, race: 0, points: [{ ability: "Flat", fromBar: true }], fatigue: 43, delta: 5, sessions: ["vo2max_punch", "attack_repeats", "tempo", "endurance", "recovery"],
    abilities: [{ name: "Flat", xp: 170, pct: 82, point: true }, { name: "Endurance", xp: 160, pct: 36, point: false }, { name: "Punch", xp: 100, pct: 18, point: false }] },
  { id: "r7", training: 300, race: 0, points: [], fatigue: 56, delta: -3, sessions: ["endurance", "endurance", "technique", "recovery", "recovery"],
    abilities: [{ name: "Endurance", xp: 180, pct: 59, point: false }, { name: "Climbing", xp: 80, pct: 28, point: false }, { name: "Recovery", xp: 40, pct: 15, point: false }] },
  { id: "r8", training: 0, race: 0, points: [{ ability: "Flat", fromBar: true }], fatigue: 33, delta: -8, sessions: ["rest", "rest", "rest", "rest", "rest"],
    abilities: [] },
  { id: "r9", training: 460, race: 0, points: [{ ability: "Acceleration", fromBar: false }], fatigue: 57, delta: 7, sessions: ["sprint", "tempo", "endurance", "endurance", "recovery"],
    abilities: [{ name: "Acceleration", xp: 210, pct: 17, point: true }, { name: "Sprint", xp: 160, pct: 66, point: false }, { name: "Flat", xp: 90, pct: 35, point: false }] },
];

export const reportXp = (row: ReportRow): number => row.training + row.race;

// Punkter pr. dag, de seneste syv dage (onsdag 11. til mandag 16.); i dag er aaben.
export const REPORT_DAYS: ReadonlyArray<{ short: string; day: number; points: number | null }> = [
  { short: "Wed", day: 11, points: 4 },
  { short: "Thu", day: 12, points: 5 },
  { short: "Fri", day: 13, points: 3 },
  { short: "Sat", day: 14, points: 4 },
  { short: "Sun", day: 15, points: 2 },
  { short: "Mon", day: 16, points: 6 },
  { short: "Tue", day: 17, points: null },
];

// 30-dages-visningen: evnepoint de sidste 30 dage og hvor mange af dem der kom fra bjaelken (eksempel).
export const POINTS_30: Record<string, { points: number; fromBar: number }> = {
  r1: { points: 4, fromBar: 1 }, r2: { points: 2, fromBar: 0 }, r3: { points: 2, fromBar: 1 },
  r4: { points: 4, fromBar: 1 }, r5: { points: 4, fromBar: 1 }, r6: { points: 3, fromBar: 1 },
  r7: { points: 2, fromBar: 1 }, r8: { points: 1, fromBar: 1 }, r9: { points: 3, fromBar: 0 },
};

// 30-dages-visningen: andel af XP fra loeb pr. rytter (eksempel, procent).
export const RACE_SHARE: Record<string, number> = { r1: 38, r2: 31, r3: 36, r4: 6, r5: 0, r6: 5, r7: 3, r8: 0, r9: 4 };
