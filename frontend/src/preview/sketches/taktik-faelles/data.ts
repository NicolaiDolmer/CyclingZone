// #7535 skitse: syntetiske eksempeldata. Ingen rigtige hold, managere eller
// motor-tal; ratings, form og traethed er opdigtede eksempler, saa billederne kan
// staa alene. Opgaverne og prisordene er spillets egne (StagePlanModel /
// tacticsReady7864), saa skitsen ikke kan love en opgave der ikke findes.

import type { StagePlanTask } from "../../../components/race/StagePlanModel.ts";

export type Lang = "da" | "en";
export type RoleKey = "captain" | "co_captain" | "sprint_captain" | "helper" | "hunter" | "free_role";
export type Effort = "hard" | "normal" | "easy";
export type Tonight = "fresh" | "ok" | "tired" | "very_tired";
export type TeamPlanKey = "gc" | "stage" | "sprint" | "break" | "save";
export type Stance = "chase" | "neutral" | "let_go";

/** Hvornaar et led begynder. Kun stigning og "sidste 10 km" har en fast km. */
export type Trigger = { at: "kom"; climb: number } | { at: "final_km" } | { at: "dropped" } | { at: "caught" };
export type Leg = { task: StagePlanTask; from?: Trigger };

export type SketchRider = {
  id: string;
  name: string;
  nat: string;
  role: RoleKey;
  rating: number;
  form: number;
  fatigue: number;
  match: number;
  effort: Effort;
  plan: Leg[];
  /** Assistentens forslag, ikke et valg (#7369). */
  suggestion?: boolean;
  tonight: Tonight;
};

export type Climb = { name: string; km: number; cat: string };

export const ROUTE = {
  distance: 175,
  climbs: [
    { name: "Salita di Croce", km: 87, cat: "1" },
    { name: "Colle Alto", km: 123, cat: "1" },
    { name: "Monte Ferro", km: 175, cat: "HC" },
  ] as Climb[],
  finalKm: 10,
};

/** Hoejdeprofil til de smaa profiler: (km, m). Opdigtet form, kun til billedet. */
export const PROFILE: Array<[number, number]> = [
  [0, 420], [12, 460], [25, 430], [38, 520], [52, 480], [64, 560], [72, 610], [87, 1922],
  [96, 1300], [104, 880], [112, 760], [123, 2065], [134, 1500], [146, 980], [158, 900],
  [165, 1250], [175, 2037],
];

export const RIDERS: SketchRider[] = [
  {
    id: "r1", name: "Matteo Brenna", nat: "it", role: "captain", rating: 78, form: 82, fatigue: 24, match: 88, effort: "hard",
    plan: [{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "kom", climb: 1 } }, { task: "attack", from: { at: "final_km" } }],
    tonight: "ok",
  },
  {
    id: "r2", name: "Jonas Vestergaard", nat: "dk", role: "helper", rating: 71, form: 71, fatigue: 31, match: 32, effort: "normal",
    plan: [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "dropped" } }],
    tonight: "ok",
  },
  {
    id: "r3", name: "Lucas Moreau", nat: "fr", role: "sprint_captain", rating: 72, form: 66, fatigue: 66, match: 19, effort: "easy",
    plan: [{ task: "grupetto" }],
    tonight: "very_tired",
  },
  {
    id: "r4", name: "Daan Visser", nat: "nl", role: "helper", rating: 66, form: 68, fatigue: 38, match: 23, effort: "normal",
    plan: [{ task: "tempo" }, { task: "shelter_leader", from: { at: "kom", climb: 0 } }, { task: "ride_in", from: { at: "dropped" } }],
    tonight: "tired",
  },
  {
    id: "r5", name: "Pawel Nowicki", nat: "pl", role: "hunter", rating: 69, form: 76, fatigue: 52, match: 88, effort: "normal",
    plan: [{ task: "breakaway" }, { task: "ride_in", from: { at: "caught" } }],
    suggestion: true,
    tonight: "very_tired",
  },
  {
    id: "r6", name: "Iker Etxeberria", nat: "es", role: "helper", rating: 63, form: 74, fatigue: 29, match: 25, effort: "normal",
    plan: [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "kom", climb: 1 } }],
    tonight: "ok",
  },
  {
    id: "r7", name: "Bram Peeters", nat: "be", role: "free_role", rating: 64, form: 63, fatigue: 41, match: 85, effort: "normal",
    plan: [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }],
    tonight: "tired",
  },
];

/** Etapestriben paa loebssiden: nummer, tid og planens tilstand som ord (valg 21). */
export const STAGES = [
  { n: 1, day: "sat" as const, time: "11:00", state: "ridden" as const },
  { n: 2, day: "sat" as const, time: "17:00", state: "unsaved" as const },
  { n: 3, day: "sun" as const, time: "11:00", state: "default" as const },
  { n: 4, day: "sun" as const, time: "17:00", state: "saved" as const },
  { n: 5, day: "mon" as const, time: "13:00", state: "default" as const },
  { n: 6, day: "mon" as const, time: "19:00", state: "saved" as const },
  { n: 7, day: "tue" as const, time: "13:00", state: "default" as const },
];

/** Planlaegningssidens loebsliste: status pr. loeb (punkt 3, valg B). */
export const PLAN_RACES = [
  { id: "a", name: "Giro delle Valli", day: "tue" as const, date: "3/11", stages: 7, squad: "ok" as const, tactics: "unsaved" as const, active: true },
  { id: "b", name: "Omloop van de Polder", day: "wed" as const, date: "4/11", stages: 1, squad: "missing" as const, tactics: "default" as const },
  { id: "c", name: "Tour du Bocage", day: "sat" as const, date: "7/11", stages: 5, squad: "ok" as const, tactics: "saved" as const },
  { id: "d", name: "Gran Premio di Lago", day: "sun" as const, date: "8/11", stages: 1, squad: "missing" as const, tactics: "default" as const },
];
