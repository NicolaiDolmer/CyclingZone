// #7947 samlet design: syntetiske data til skitsen. Navne, hold og tal er
// opdigtede eksempler (repoet er offentligt), ikke maalinger fra spillet.
// Datoen er en tirsdag midt i et etapeloeb: tre ryttere koerer en etape paa
// felt 3, en rytter koerer et endagsloeb paa felt 5.

import type { Field, Session } from "./model.ts";

export type Tone = "ok" | "warn" | "risk";
export type Source =
  | { kind: "team" }
  | { kind: "own"; name: string }
  | { kind: "none" };

export type SketchRider = {
  id: string;
  name: string;
  nation: string;
  type: string;
  fatigueNow: number;
  fatigueTonight: number;
  tone: Tone;
  // Holdets traethedsregel har sat en lettere dag (#7801: vurderes paa traetheden lige nu).
  ruleNote: string | null;
  source: Source;
  hasPlan: boolean;
  fields: Field[];
  // XP er "klar til" (#6110, kontakten er slukket): eksempeltal, ingen formel.
  xpToday: number;
  xpFromRace: number;
  nextPoint: string;
  nextShare: number; // 0..1 af vejen til naeste evnepoint
  // Ugen frem (i dag + 6 dage), fem felter pr. dag. "S" = etape.
  week: Array<Array<Session | "S">>;
};

const t = (session: Session): Field => ({ kind: "train", session, changed: false });
const stage = (label: string): Field => ({ kind: "stage", label });
const five = (session: Session): Field[] => [t(session), t(session), t(session), t(session), t(session)];

// En uge er i dag + seks dage. Felt-moenster pr. dag.
const W = (...days: Array<Session | Array<Session | "S">>): Array<Array<Session | "S">> =>
  days.map((d) => (Array.isArray(d) ? d : [d, d, d, d, d]));

export const DATE_LABEL = "Tirsdag 17. november";
export const RACE_LABEL = "Ronde van Preview";
export const WEEKDAYS = ["Tir", "Ons", "Tor", "Fre", "Lør", "Søn", "Man"] as const;

export const RIDERS: SketchRider[] = [
  {
    id: "r1", name: "Anton Lindqvist", nation: "SE", type: "Klatrer",
    fatigueNow: 48, fatigueTonight: 63, tone: "warn", ruleNote: null,
    source: { kind: "team" }, hasPlan: true,
    fields: [t("endurance"), t("endurance"), stage("Etape 3"), t("recovery"), t("recovery")],
    xpToday: 41, xpFromRace: 24, nextPoint: "Klatring", nextShare: 0.78,
    week: W(["endurance", "endurance", "S", "recovery", "recovery"], ["endurance", "endurance", "S", "recovery", "recovery"], ["rest", "rest", "S", "rest", "rest"], "vo2max_climb", "tempo", "rest", "endurance"),
  },
  {
    id: "r2", name: "Mathis Durand", nation: "FR", type: "Sprinter",
    fatigueNow: 52, fatigueTonight: 66, tone: "warn", ruleNote: null,
    source: { kind: "team" }, hasPlan: true,
    fields: [t("endurance"), t("endurance"), stage("Etape 3"), t("recovery"), t("recovery")],
    xpToday: 33, xpFromRace: 18, nextPoint: "Topfart", nextShare: 0.41,
    week: W(["endurance", "endurance", "S", "recovery", "recovery"], ["endurance", "endurance", "S", "recovery", "recovery"], ["rest", "rest", "S", "rest", "rest"], "sprint", "tempo", "rest", "endurance"),
  },
  {
    id: "r3", name: "Pieter Claes", nation: "BE", type: "Brostensrytter",
    fatigueNow: 71, fatigueTonight: 79, tone: "risk", ruleNote: "Træthedsreglen: let dag",
    source: { kind: "team" }, hasPlan: true,
    fields: [t("recovery"), t("recovery"), stage("Etape 3"), t("rest"), t("rest")],
    xpToday: 19, xpFromRace: 15, nextPoint: "Brosten", nextShare: 0.92,
    week: W(["recovery", "recovery", "S", "rest", "rest"], ["rest", "rest", "S", "rest", "rest"], ["rest", "rest", "S", "rest", "rest"], "recovery", "endurance", "rest", "cobbled_sectors"),
  },
  {
    id: "r4", name: "Jonas Vestergaard", nation: "DK", type: "Puncheur",
    fatigueNow: 34, fatigueTonight: 47, tone: "ok", ruleNote: null,
    source: { kind: "own", name: "Ardennerne" }, hasPlan: true,
    fields: [t("vo2max_punch"), t("vo2max_punch"), t("tempo"), t("tempo"), stage("Endagsløb")],
    xpToday: 52, xpFromRace: 20, nextPoint: "Punch", nextShare: 0.63,
    week: W(["vo2max_punch", "vo2max_punch", "tempo", "tempo", "S"], "endurance", "vo2max_punch", "rest", "attack_repeats", "tempo", "rest"),
  },
  {
    id: "r5", name: "Lucas Moreau", nation: "FR", type: "Enkeltstartsrytter",
    fatigueNow: 29, fatigueTonight: 41, tone: "ok", ruleNote: null,
    source: { kind: "own", name: "Enkeltstart-uge" }, hasPlan: true,
    fields: [t("threshold"), t("threshold"), t("threshold"), { kind: "train", session: "aero", changed: true }, t("threshold")],
    xpToday: 58, xpFromRace: 0, nextPoint: "Enkeltstart", nextShare: 0.35,
    week: W(["threshold", "threshold", "threshold", "aero", "threshold"], "endurance", "threshold", "aero", "rest", "threshold", "endurance"),
  },
  {
    id: "r6", name: "Emil Hansen", nation: "DK", type: "Rouleur",
    fatigueNow: 41, fatigueTonight: 50, tone: "ok", ruleNote: null,
    source: { kind: "team" }, hasPlan: true,
    fields: five("tempo"),
    xpToday: 44, xpFromRace: 0, nextPoint: "Fladt", nextShare: 0.52,
    week: W("tempo", "endurance", "tempo", "rest", "echelon_drills", "tempo", "rest"),
  },
  {
    id: "r7", name: "Sander Bakker", nation: "NL", type: "Allround",
    fatigueNow: 63, fatigueTonight: 70, tone: "warn", ruleNote: "Træthedsreglen: let dag",
    source: { kind: "team" }, hasPlan: true,
    fields: five("endurance"),
    xpToday: 27, xpFromRace: 0, nextPoint: "Udholdenhed", nextShare: 0.18,
    week: W("endurance", "tempo", "endurance", "rest", "vo2max", "tempo", "rest"),
  },
  {
    id: "r8", name: "Tobias Keller", nation: "CH", type: "Klatrer",
    fatigueNow: 22, fatigueTonight: 37, tone: "ok", ruleNote: null,
    source: { kind: "none" }, hasPlan: false,
    fields: five("endurance"),
    xpToday: 0, xpFromRace: 0, nextPoint: "Klatring", nextShare: 0.66,
    week: W("endurance", "endurance", "endurance", "endurance", "endurance", "endurance", "endurance"),
  },
  {
    id: "r9", name: "Nils Halvorsen", nation: "NO", type: "Sprinter",
    fatigueNow: 37, fatigueTonight: 45, tone: "ok", ruleNote: null,
    source: { kind: "team" }, hasPlan: true,
    fields: [t("sprint"), t("sprint"), t("sprint"), t("technique"), t("technique")],
    xpToday: 47, xpFromRace: 0, nextPoint: "Acceleration", nextShare: 0.88,
    week: W(["sprint", "sprint", "sprint", "technique", "technique"], "endurance", "sprint", "rest", "tempo", "sprint", "rest"),
  },
];

// Danske navne paa passene (samme ord som spillets training.json, da).
export const SESSION_NAME: Record<Session, string> = {
  rest: "Hvile", recovery: "Aktiv restitution",
  technique: "Teknik", aero: "Aero", loebslaere: "Løbslære",
  endurance: "Lang tur", tempo: "Tempo",
  vo2max: "Blandede intervaller", vo2max_climb: "Klatreintervaller", vo2max_punch: "Punch-intervaller",
  threshold: "Tærskel", sprint: "Sprint",
  cobbled_sectors: "Brostenssektorer", echelon_drills: "Vifteøvelser", attack_repeats: "Angrebsintervaller",
};

// Korte navne til felterne (spillets mobile.sessionShort, da).
export const SESSION_SHORT: Record<Session, string> = {
  rest: "Hvile", recovery: "Restit.",
  technique: "Teknik", aero: "Aero", loebslaere: "Løbslære",
  endurance: "Lang", tempo: "Tempo",
  vo2max: "VO2", vo2max_climb: "Bjerg", vo2max_punch: "Punch",
  threshold: "Tærskel", sprint: "Sprint",
  cobbled_sectors: "Brosten", echelon_drills: "Vifte", attack_repeats: "Angreb",
};

// Vaelgerens grupper. Aktiv restitution bor under Hvile (ejer 16/11).
export const SESSION_GROUPS: Array<{ label: string; sessions: Session[] }> = [
  { label: "Hvile", sessions: ["rest", "recovery"] },
  { label: "Let", sessions: ["endurance", "technique", "aero", "loebslaere"] },
  { label: "Mellem", sessions: ["tempo"] },
  { label: "Hård", sessions: ["vo2max", "vo2max_climb", "vo2max_punch", "threshold", "sprint", "cobbled_sectors", "echelon_drills", "attack_repeats"] },
];
