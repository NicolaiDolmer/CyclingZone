// todayR5Model — den rene model bag I dag-fanen i R5-udgaven (#7947, ejer 20/11).
//
// Skitsen (design/7947-r5-idag, R5.tsx + r5model.ts) er specifikationen; her er
// dens afledte felter bundet til spillets AEGTE data: rytterens effektive dag i
// dag (programmets felt foer den gemte dag, samme regel som den gamle fane),
// tilstanden (condition), programmet/gruppen og truppens maerker.
//
// Ingen React, ingen i18n, ingen I/O: node --test koerer filen direkte. Ordene
// kommer fra i18n i komponenten; modellen returnerer kun noegler og tal.

import { pruneSelection } from "../trainingOverview.ts";

// --- Indsatsen: fire knapper (ejer 17/11 punkt 5) ---------------------------

export type Effort = "rest" | "easy" | "medium" | "hard";
export const EFFORTS: readonly Effort[] = Object.freeze(["rest", "easy", "medium", "hard"]);

// Spillets sessioner pr. niveau (spejl af lib/trainingDayTypes.js, ogsaa katalog v3).
// Faerdighedsdage ligger paa det lette niveau; aktiv restitution bor under Hvile (ejer 16/11).
const EASY_SESSIONS = new Set(["endurance", "technique", "aero", "loebslaere"]);
const MEDIUM_SESSIONS = new Set(["tempo"]);
const HARD_SESSIONS = new Set([
  "vo2max", "vo2max_climb", "vo2max_punch", "threshold", "sprint",
  "cobbled_sectors", "echelon_drills", "attack_repeats",
  "long_climbs", "lead_out", "itt_short", "itt_long", "cobbled_classic",
]);
const REST_SESSIONS = new Set(["rest", "recovery", "restitution"]);

/** Et felts indsats som et af de fire ord. null = ukendt felt (ingen dag, en etape). */
export function effortOf(session: string | null | undefined): Effort | null {
  if (!session) return null;
  if (REST_SESSIONS.has(session)) return "rest";
  if (EASY_SESSIONS.has(session)) return "easy";
  if (MEDIUM_SESSIONS.has(session)) return "medium";
  if (HARD_SESSIONS.has(session)) return "hard";
  return null;
}

const EFFORT_RANK: Readonly<Record<Effort, number>> = Object.freeze({ rest: 0, easy: 1, medium: 2, hard: 3 });

/**
 * Dagens indsats som eet ord: den hoejeste blandt dagens traeningsfelter. null = ingen dag.
 * `efforts` (indsatsvaelgeren, #7947) er den indsats hvert felt koerer paa; uden den
 * er det sessionens eget niveau, som i dag.
 */
export function dayEffort(fields: readonly Field[], efforts?: readonly (Effort | null)[]): Effort | null {
  let best: Effort | null = null;
  fields.forEach((f, i) => {
    if (f === STAGE) return;
    const e = efforts ? efforts[i] ?? null : effortOf(f);
    if (e && (best === null || EFFORT_RANK[e] > EFFORT_RANK[best])) best = e;
  });
  return best;
}

/**
 * Hvad et tryk paa en indsats skriver, med spillets eksisterende gemme-kald
 * (dayType + session, samme som dagsvaelgeren). Haard kraever en session for
 * typen: rytterens egen haarde session, ellers assistentens; kendes ingen,
 * aabnes sessionsvaelgeren i stedet for at gaette (samme regel som den gamle fane).
 */
export type QuickWrite =
  | { kind: "write"; dayType: "rest" | "recovery" | "training" | "skill"; session: string | null }
  | { kind: "pick" };

/**
 * chosenFocus er traeningen spilleren har valgt i raekkens/holdlinjens vaelger
 * (#7947, ejer 20/11): den vinder over rytterens gemte og assistentens session,
 * naar den findes paa netop den indsats.
 */
export function writeForEffort(
  effort: Effort,
  { storedFocus, assistantFocus, chosenFocus = null }: {
    storedFocus: string | null | undefined;
    assistantFocus: string | null | undefined;
    chosenFocus?: string | null;
  },
): QuickWrite {
  if (effort === "rest") return { kind: "write", dayType: "rest", session: null };
  const keep = (s: string | null | undefined) => (s && effortOf(s) === effort ? s : null);
  const own = keep(chosenFocus) ?? keep(storedFocus) ?? keep(assistantFocus);
  if (effort === "easy") {
    const session = own ?? "endurance";
    return { kind: "write", dayType: SKILL.has(session) ? "skill" : "training", session };
  }
  if (effort === "medium") return { kind: "write", dayType: "training", session: own ?? "tempo" };
  return own ? { kind: "write", dayType: "training", session: own } : { kind: "pick" };
}
const SKILL = new Set(["technique", "aero", "loebslaere"]);

// --- Indsatsvaelgeren Let/Mellem/Haard (#7947 PR 3, ejer 20/11) ------------------
//
// Bag kontakterne training_effort_levels OG training_page_r5 kan hver session koeres
// paa Let, Mellem eller Haard. Niveauerne er spillets egne tre (samme ord som en
// sessions niveau i dag); backend kalder det midterste "normal", R5-fladen "medium".
// Hvile er et eget valg: ingen session, intet niveau. Kontakten off = ingen af
// funktionerne herunder bruges, og fladen er praecis som foer.

/** Spillets niveau-ord i API'et (som backend EFFORT_LEVELS). */
export type EffortLevel = "easy" | "normal" | "hard";

/** De tre niveauer i fladens raekkefoelge (Hvile er ikke et niveau). */
export const LEVEL_EFFORTS: readonly Effort[] = Object.freeze(["easy", "medium", "hard"]);

/** Fladens indsats som API'ets niveau-ord; Hvile (og ukendt) er intet niveau. */
export function levelOfEffort(effort: Effort | null | undefined): EffortLevel | null {
  if (effort === "easy") return "easy";
  if (effort === "medium") return "normal";
  if (effort === "hard") return "hard";
  return null;
}

/** API'ets niveau-ord som fladens indsats; alt andet end easy/normal/hard er intet niveau. */
export function effortOfLevel(level: unknown): Effort | null {
  if (level === "easy") return "easy";
  if (level === "normal") return "medium";
  if (level === "hard") return "hard";
  return null;
}

/** En dags intensitet (rest, recovery eller et niveau) som indsats. */
export function effortOfIntensity(intensity: unknown): Effort | null {
  if (intensity === "rest" || intensity === "recovery") return "rest";
  return effortOfLevel(intensity);
}

/** Er sessionen en hel dag uden fokus (hvile, aktiv restitution)? De kender ikke et niveau. */
export function isRestSession(session: string | null | undefined): boolean {
  return !!session && REST_SESSIONS.has(session);
}

/**
 * Det niveau en programcelle bærer for et felt: feltets eget, ellers dagens, ellers
 * intet (= sessionens eget niveau). Laeser tolerant: en celle uden de to noegler
 * (backend sender dem ikke endnu) giver null og aendrer intet.
 */
export function levelForDayEntry(entry: unknown, slot = 0): Effort | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { effort?: unknown; slotEfforts?: unknown };
  const idx = Number.isInteger(slot) && slot >= 0 ? slot : 0;
  const own = Array.isArray(e.slotEfforts) ? effortOfLevel(e.slotEfforts[idx]) : null;
  return own ?? effortOfLevel(e.effort);
}

/** Rytterens egen dag som indsats: planens intensitet, ellers sessionens eget niveau. null = ingen egen dag. */
export function planEffort(plan: { focus?: string | null; intensity?: string | null } | null | undefined): Effort | null {
  if (!plan?.focus) return null;
  if (plan.focus === "restitution") return "rest";
  return effortOfIntensity(plan.intensity) ?? effortOf(plan.focus);
}

/**
 * Den indsats hvert af dagens felter koerer paa. `levelFor` giver et felts valgte
 * niveau (null = sessionens eget); hvile- og restitutionsfelter ignorerer det, et
 * loebsfelt og et tomt felt har ingen indsats.
 */
export function fieldEfforts(
  fields: readonly Field[],
  levelFor: (slot: number, session: string) => Effort | null,
): (Effort | null)[] {
  return fields.map((f, slot) => {
    if (f === STAGE || f === null) return null;
    if (isRestSession(f)) return "rest";
    return levelFor(slot, f) ?? effortOf(f);
  });
}

/** Hvad et tryk i indsatsvaelgeren skriver: sessionen, og det niveau den koerer paa. */
export type LevelWrite =
  | { kind: "write"; dayType: "rest" | "recovery" | "training" | "skill"; session: string | null; effort: EffortLevel | null }
  | { kind: "pick" };

const trainable = (s: string | null | undefined): string | null => (s && !REST_SESSIONS.has(s) ? s : null);

/**
 * Et tryk paa Let, Mellem eller Haard: den valgte traening vinder, ellers rytterens
 * gemte, ellers assistentens, og niveauet er det trykkede (hver session maa koere
 * paa hvert niveau). Kendes ingen session, faar Let og Mellem de sessioner de har i
 * dag; Haard gaetter aldrig og aabner sessionsvaelgeren. Hvile skriver en hviledag
 * uden fokus og uden niveau.
 */
export function writeForLevel(
  effort: Effort,
  { storedFocus, assistantFocus, chosenFocus = null }: {
    storedFocus: string | null | undefined;
    assistantFocus: string | null | undefined;
    chosenFocus?: string | null;
  },
): LevelWrite {
  if (effort === "rest") return { kind: "write", dayType: "rest", session: null, effort: null };
  const session = trainable(chosenFocus) ?? trainable(storedFocus) ?? trainable(assistantFocus)
    ?? (effort === "easy" ? "endurance" : effort === "medium" ? "tempo" : null);
  if (!session) return { kind: "pick" };
  return { kind: "write", dayType: SKILL.has(session) ? "skill" : "training", session, effort: levelOfEffort(effort) };
}

/**
 * Et valg i traeningsvaelgeren naar niveauer er taendt: traeningen gemmes paa det
 * niveau dagen allerede staar paa (et valg aendrer ikke niveauet); staar rytteren paa
 * hvile eller uden egen dag, faar traeningen sit eget niveau.
 */
export function writeForTrainingAtLevel(choice: string, current: Effort | null): LevelWrite | { kind: "clear" } {
  const base = writeForTraining(choice);
  if (base.kind !== "write") return base.kind === "clear" ? base : { kind: "pick" };
  const keep = base.session && current && current !== "rest" ? levelOfEffort(current) : null;
  return { kind: "write", dayType: base.dayType, session: base.session, effort: keep };
}

/**
 * Holdlinjen og "Set for group" med niveauer: een skrivning pr. session (med den
 * valgte traening paa alle, ellers pr. rytters egen session). Haard uden en kendt
 * session springes over, aldrig et gaet.
 */
export function bulkPlanLevels(
  effort: Effort,
  ids: readonly string[],
  focusOf: (id: string) => { storedFocus: string | null | undefined; assistantFocus: string | null | undefined },
  training: string = PROGRAM_CHOICE,
): { calls: Array<{ choice: string; effort: EffortLevel | null; ids: string[] }>; skipped: string[] } {
  if (ids.length === 0) return { calls: [], skipped: [] };
  if (effort === "rest") return { calls: [{ choice: "rest", effort: null, ids: [...ids] }], skipped: [] };
  if (training !== PROGRAM_CHOICE && training !== RECOVERY_CHOICE) {
    return { calls: [{ choice: training, effort: levelOfEffort(effort), ids: [...ids] }], skipped: [] };
  }
  const bySession = new Map<string, string[]>();
  const skipped: string[] = [];
  for (const id of ids) {
    const w = writeForLevel(effort, focusOf(id));
    if (w.kind === "pick" || !w.session) { skipped.push(id); continue; }
    bySession.set(w.session, [...(bySession.get(w.session) ?? []), id]);
  }
  return { calls: [...bySession.entries()].map(([choice, list]) => ({ choice, effort: levelOfEffort(effort), ids: list })), skipped };
}

/** Skaderisikoen vises kun paa Haard (ejer 20/11). */
export function showsInjuryRisk(effort: Effort | null | undefined): boolean {
  return effort === "hard";
}

/** Skaderisikoen (0-1 fra spillets tilstand) som hele procent, eller null naar den ikke kendes. */
export function injuryRiskPercent(risk: unknown): number | null {
  if (typeof risk !== "number" || !Number.isFinite(risk) || risk < 0) return null;
  return Math.min(100, Math.round(risk * 100));
}

// --- Traeningsvaelgeren (#7947, ejer 20/11) -------------------------------------
//
// "Training: <fokus>" foer Rest | Easy | Medium | Hard, paa holdlinjen og i hver
// raekke. Foerste valg "Program" er som i dag (rytteren foelger gruppe/eget program
// eller holdets). Kataloget er sidens eget (samme sessioner som den gamle fanes
// "Set day"); i spillet hoerer indsatsen til sessionen, saa et valg skriver altid
// et par der findes (ingen ny backend-logik).

export const PROGRAM_CHOICE = "program" as const;
export const RECOVERY_CHOICE = "recovery" as const;

/** Vaelgerens vaerdi for en rytter: "program" uden egen dag, ellers traeningen dagen bygger paa. */
export function trainingChoiceOf(plan: { focus?: string | null; intensity?: string | null } | null | undefined): string {
  if (!plan?.focus) return PROGRAM_CHOICE;
  if (plan.intensity === "recovery" || plan.focus === "restitution") return RECOVERY_CHOICE;
  return plan.focus;
}

/**
 * Hvad et valg i raekkens vaelger skriver med sidens gemme-kald: "Program" fjerner
 * rytterens egen dag (kun dagen, aldrig hans ugeplan); en traening gemmes straks
 * paa sin egen indsats (eet tryk = eet valg, som den gamle "Set day").
 */
export function writeForTraining(choice: string): QuickWrite | { kind: "clear" } {
  if (choice === PROGRAM_CHOICE) return { kind: "clear" };
  if (choice === RECOVERY_CHOICE) return { kind: "write", dayType: "recovery", session: null };
  return { kind: "write", dayType: SKILL.has(choice) ? "skill" : "training", session: choice };
}

/**
 * Linjen under raekken naar dagen er rytterens egen: hvilken traening og paa hvor
 * mange af dagens ledige sessioner (et loebsfelt er aldrig ledigt). null naar
 * dagen ikke er hans egen, eller hans program fylder alle felterne.
 */
export type YourDay = { session: string; count: number; free: number };

export function yourDay(fields: readonly Field[], daySession: string | null | undefined): YourDay | null {
  if (!daySession) return null;
  const free = fields.filter((f) => f !== STAGE).length;
  const count = fields.filter((f) => f === daySession).length;
  return count > 0 ? { session: daySession, count, free } : null;
}

// --- Dagens fem felter --------------------------------------------------------

export const STAGE = "stage" as const;
export type Field = string | null | typeof STAGE;
export const SLOTS = 5;

/**
 * Dagens fem felter, som det effektivt traenes: et loebsfelt er laast til etapen,
 * ellers programmets felt (slot foer ugedag), ellers den gemte dag, ellers ingen dag.
 */
export function dayFields({
  programSlot,
  planSession,
  raceSlots,
}: {
  programSlot: (slot: number) => string | null;
  planSession: string | null;
  raceSlots: ReadonlySet<number>;
}): Field[] {
  return Array.from({ length: SLOTS }, (_, slot) => {
    if (raceSlots.has(slot)) return STAGE;
    return programSlot(slot) ?? planSession ?? null;
  });
}

/**
 * En afregnet kvitterings-raekke (dagens todayRun.report.riders, samlet pr. rytter):
 * hvad rytteren FAKTISK koerte, pr. loebsdag i `activities`.
 */
export type SettledActivity = {
  focus?: string | null;
  intensity?: string | null;
  race_day?: boolean | null;
  game_day?: number | null;
};
export type SettledRow = SettledActivity & { activities?: readonly SettledActivity[] | null };

// Kvitteringens aktiviteter i loebsdags-orden (felt 1 er den foerste).
function settledActivities(receipt: SettledRow): SettledActivity[] {
  return (receipt.activities ?? [])
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.game_day ?? Infinity) - (y.a.game_day ?? Infinity) || x.i - y.i)
    .map((x) => x.a);
}

/**
 * #8533 Codex P2: aktiviteterne paa deres egne felter. Kvitteringen har kun de afregnede
 * felter, saa et senere loebsfelt maa ikke rykke op paa felt 1. Med datoens forventede
 * loebsdage (receipt.expected_game_days) laegges hver aktivitet paa sin loebsdags plads;
 * mangler de, eller mangler en aktivitet sin loebsdag, gaelder den gamle raekkefoelge.
 */
function activitiesBySlot(
  acts: readonly SettledActivity[],
  slots: number,
  gameDays?: readonly number[] | null,
): (SettledActivity | undefined)[] {
  const known = Array.isArray(gameDays) && gameDays.length > 0
    && acts.every((a) => Number.isInteger(a.game_day) && gameDays.includes(a.game_day as number));
  if (!known) return [...acts];
  const out: (SettledActivity | undefined)[] = Array.from({ length: slots }, () => undefined);
  for (const a of acts) {
    const slot = (gameDays as readonly number[]).indexOf(a.game_day as number);
    if (slot >= 0 && slot < slots) out[slot] = a;
  }
  return out;
}

/**
 * Den indsats et afregnet felt faktisk koerte paa (kvitteringens intensitet), pr. felt;
 * null hvor kvitteringen ikke har felten eller ikke siger det (saa gaelder planen).
 */
export function settledFieldEfforts(
  receipt: SettledRow | null | undefined,
  slots = SLOTS,
  gameDays?: readonly number[] | null,
): (Effort | null)[] {
  if (!receipt) return Array.from({ length: slots }, () => null);
  const acts = settledActivities(receipt);
  const bySlot = activitiesBySlot(acts, slots, gameDays);
  return Array.from({ length: slots }, (_, slot) => {
    const a = acts.length === 0 ? receipt : bySlot[slot];
    return a && a.race_day !== true ? effortOfIntensity(a.intensity) : null;
  });
}

/**
 * Dagens fem felter naar dagen (helt eller delvist) er afregnet. Et afregnet felt
 * laeses fra kvitteringen, aldrig fra planen: planen kan redigeres efter dagens
 * koersel og gaelder saa fra i morgen (samme regel som TrainingPage.sessionFor).
 * Et felt kvitteringen endnu ikke har, er stadig planens. En kvittering uden
 * aktiviteter (aeldre form) gaelder for alle felter undtagen et laast loebsfelt.
 */
export function settledDayFields(
  planned: readonly Field[],
  receipt: SettledRow | null | undefined,
  sessionOf: (activity: SettledActivity) => string | null,
  gameDays?: readonly number[] | null,
): Field[] {
  if (!receipt) return [...planned];
  const acts = settledActivities(receipt);
  if (acts.length === 0) {
    const session = sessionOf(receipt);
    return planned.map((f) => (f === STAGE ? STAGE : session));
  }
  const bySlot = activitiesBySlot(acts, planned.length, gameDays);
  return planned.map((f, slot) => {
    const a = bySlot[slot];
    if (!a) return f;
    return a.race_day === true ? STAGE : sessionOf(a);
  });
}

// --- Day load: ord + pil (ejer 17/11 paa #8354) --------------------------------

export type DayLoad = "easy" | "light" | "normal" | "hard" | "veryHard";
export const DAY_LOADS: readonly DayLoad[] = Object.freeze(["easy", "light", "normal", "hard", "veryHard"]);

// Skitsens regel (r5model.ts): felterne laegges sammen efter indsats (en etape
// tæller som haard) og deles i fem baand. Ord, ikke et tal for aftenen.
const LOAD_BANDS: readonly number[] = [2, 5, 8, 11];

/** Dagens belastning, eller null naar rytteren ingen dag har (aldrig et opdigtet ord). */
export function dayLoad(fields: readonly Field[], efforts?: readonly (Effort | null)[]): DayLoad | null {
  if (fields.every((f) => f === null)) return null;
  let sum = 0;
  fields.forEach((f, i) => { sum += f === STAGE ? EFFORT_RANK.hard : EFFORT_RANK[(efforts ? efforts[i] : null) ?? effortOf(f) ?? "rest"]; });
  const band = LOAD_BANDS.findIndex((max) => sum <= max);
  return DAY_LOADS[band === -1 ? DAY_LOADS.length - 1 : band];
}

// --- Status i raekken (hul 5 + afvigelse 3) ------------------------------------

export type StatusKey = "injured" | "injuryRisk" | "days70" | "u23" | "junior" | "academy" | "contractExpiring" | "retirementRisk";

export type StatusInput = {
  injuredCount: number;
  injuryRisk: number | null | undefined;
  daysOver70: number | null | undefined;
  squad: string | null | undefined;
  isAcademy: boolean;
  contractExpiring: boolean;
  retirementRisk: boolean;
};

// Skaderisiko taeller som "hoej" fra samme graense som den gamle raekke.
export const HIGH_INJURY_RISK_FROM = 0.05;

/**
 * Status der staar i raekken, i den orden de laeses: det der betyder noget for
 * DAGEN foerst (skade, skaderisiko, dage over graensen), saa truppens maerker.
 * Skaderisiko vises ikke oveni en skade; akademi skjuler kontrakt og pension
 * (samme regel som rytterkortet).
 */
export function statusKeys(input: StatusInput): StatusKey[] {
  const out: StatusKey[] = [];
  const injured = input.injuredCount > 0;
  if (injured) out.push("injured");
  if (!injured && (input.injuryRisk ?? 0) >= HIGH_INJURY_RISK_FROM) out.push("injuryRisk");
  if ((input.daysOver70 ?? 0) > 0) out.push("days70");
  if (input.squad === "u23") out.push("u23");
  if (input.squad === "junior") out.push("junior");
  if (input.isAcademy) out.push("academy");
  if (!input.isAcademy && input.contractExpiring) out.push("contractExpiring");
  if (!input.isAcademy && input.retirementRisk) out.push("retirementRisk");
  return out;
}

// --- Raekken og listen ------------------------------------------------------------

export type ProgramKind = "program" | "group" | "own" | "none";

export type R5Row = {
  id: string;
  name: string;
  lastname: string;
  primaryType: string | null;
  age: number | null;
  form: number | null;
  fatigue: number | null;
  racing: boolean;
  program: { kind: ProgramKind; name: string | null };
  groupId: string | null;
  fields: Field[];
  /** Indsatsen hvert felt koerer paa (indsatsvaelgeren); uden den gaelder sessionens eget niveau. */
  efforts?: (Effort | null)[];
  /** Har rytteren en gemt dag (noget "Back to team program" kan fjerne)? */
  ownDay: boolean;
};

export type OverviewKey = "training" | "racing" | "tired" | "noProgram";

/** Er rytteren i gang med at traene i dag (ikke i loeb, ikke paa hvile)? */
export function isTraining(row: Pick<R5Row, "racing" | "fields">): boolean {
  if (row.racing) return false;
  return row.fields.some((f) => f !== STAGE && f !== null && effortOf(f) !== null && effortOf(f) !== "rest");
}

export function matchesOverview(row: R5Row, key: OverviewKey, tiredFrom: number): boolean {
  if (key === "training") return isTraining(row);
  if (key === "racing") return row.racing;
  if (key === "tired") return (row.fatigue ?? 0) >= tiredFrom;
  return row.program.kind === "none";
}

export function overviewCounts(rows: readonly R5Row[], tiredFrom: number): Record<OverviewKey, number> {
  const keys: OverviewKey[] = ["training", "racing", "tired", "noProgram"];
  return Object.fromEntries(keys.map((k) => [k, rows.filter((r) => matchesOverview(r, k, tiredFrom)).length])) as Record<OverviewKey, number>;
}

// Filtrene i holdlinjen (ejer 19/11): alder, grupper, ryttertype.
export type AgeFilter = "all" | "u23" | "u25" | "25plus";
export const AGE_FILTERS: readonly AgeFilter[] = Object.freeze(["all", "u23", "u25", "25plus"]);
export const NO_GROUP = "__none__";
export type Filters = { age: AgeFilter; group: string; type: string };
export const NO_FILTERS: Filters = Object.freeze({ age: "all", group: "all", type: "all" });

export function matchesFilters(row: R5Row, f: Filters): boolean {
  if (f.age !== "all") {
    if (row.age == null) return false;
    if (f.age === "u23" && row.age >= 23) return false;
    if (f.age === "u25" && row.age >= 25) return false;
    if (f.age === "25plus" && row.age < 25) return false;
  }
  if (f.group !== "all") {
    if (f.group === NO_GROUP ? row.groupId !== null : row.groupId !== f.group) return false;
  }
  if (f.type !== "all" && row.primaryType !== f.type) return false;
  return true;
}

export function filtersActive(f: Filters): boolean {
  return f.age !== "all" || f.group !== "all" || f.type !== "all";
}

// Sortering (TASTE 7a): hver kolonne kan sorteres; tal faar de stoerste foerst.
export type SortKey = "rider" | "type" | "age" | "program" | "form" | "fatigue" | "load";
export type Sort = { key: SortKey; dir: 1 | -1 } | null;
const DESC_FIRST: ReadonlySet<SortKey> = new Set(["age", "form", "fatigue", "load"]);

export function nextSort(current: Sort, key: SortKey): Sort {
  if (current?.key === key) return { key, dir: (current.dir * -1) as 1 | -1 };
  return { key, dir: DESC_FIRST.has(key) ? -1 : 1 };
}

function sortValue(row: R5Row, key: SortKey): string | number | null {
  switch (key) {
    case "rider": return `${row.lastname} ${row.name}`.toLowerCase();
    case "type": return row.primaryType ?? null;
    case "age": return row.age;
    case "program": return row.program.name?.toLowerCase() ?? null;
    case "form": return row.form;
    case "fatigue": return row.fatigue;
    case "load": { const l = dayLoad(row.fields, row.efforts); return l ? DAY_LOADS.indexOf(l) : null; }
  }
}

/** Sorterer stabilt; manglende vaerdier staar altid sidst, uanset retning. */
export function sortR5Rows<T extends R5Row>(rows: readonly T[], sort: Sort): T[] {
  if (!sort) return [...rows];
  return rows
    .map((row, i) => ({ row, i, v: sortValue(row, sort.key) }))
    .sort((a, b) => {
      if (a.v == null && b.v == null) return a.i - b.i;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      const c = a.v > b.v ? 1 : a.v < b.v ? -1 : 0;
      return c === 0 ? a.i - b.i : c * sort.dir;
    })
    .map((x) => x.row);
}

// --- Markering og holdlinjen (hul 3 + 4, afvigelse 4) ------------------------

/**
 * Holdlinjen ER massehandlingen: intet markeret = hele holdet i visningen
 * ("Whole team today"), ellers kun de markerede ("N selected today"). Ryttere
 * i loeb kan ikke faa en traeningsdag og er aldrig med.
 */
export function teamLine(
  selected: ReadonlySet<string>,
  shown: readonly Pick<R5Row, "id" | "racing">[],
): { kind: "selected" | "team"; ids: string[] } {
  const selectable = shown.filter((r) => !r.racing).map((r) => r.id);
  const picked = [...pruneSelection(selected, new Set(selectable))];
  if (picked.length > 0) return { kind: "selected", ids: picked };
  // En markering af kun loebende ryttere er stadig en markering: den bliver
  // aldrig til hele holdet (ingen skrivning paa ryttere spilleren ikke valgte).
  const anyShownSelected = shown.some((r) => selected.has(r.id));
  return anyShownSelected ? { kind: "selected", ids: [] } : { kind: "team", ids: selectable };
}

/**
 * Holdlinjens indsats paa flere ryttere via spillets masse-kald (eet valg pr.
 * kald). Med en valgt traening (holdlinjens vaelger) bruges den paa den indsats
 * den findes paa; ellers er Hvile, Let og Mellem eet kald, og Haard samles pr.
 * rytterens haarde session, og en rytter uden kendt haard session springes over
 * (aldrig et gaet).
 */
export function bulkPlan(
  effort: Effort,
  ids: readonly string[],
  focusOf: (id: string) => { storedFocus: string | null | undefined; assistantFocus: string | null | undefined },
  training: string = PROGRAM_CHOICE,
): { calls: Array<{ choice: string; ids: string[] }>; skipped: string[] } {
  const all = (choice: string) => ({ calls: ids.length ? [{ choice, ids: [...ids] }] : [], skipped: [] as string[] });
  if (effort === "rest") return all("rest");
  if (training !== PROGRAM_CHOICE && effortOf(training) === effort) return all(training);
  if (effort === "easy") return all("endurance");
  if (effort === "medium") return all("tempo");
  const bySession = new Map<string, string[]>();
  const skipped: string[] = [];
  for (const id of ids) {
    const w = writeForEffort("hard", focusOf(id));
    if (w.kind === "pick" || !w.session) { skipped.push(id); continue; }
    bySession.set(w.session, [...(bySession.get(w.session) ?? []), id]);
  }
  return { calls: [...bySession.entries()].map(([choice, list]) => ({ choice, ids: list })), skipped };
}

/** "Markér alle": er alle viste markeret, fjernes markeringen; ellers markeres alle viste. */
export function toggleAllSelection(selected: ReadonlySet<string>, shownIds: readonly string[]): Set<string> {
  const all = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  return all ? new Set() : new Set(shownIds);
}

export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// --- Visningsvalg der huskes pr. spiller -------------------------------------------

export const ALL_SESSIONS_STORAGE_KEY = "cz_training_r5_all_sessions";

export function readStoredFlag(storage: Pick<Storage, "getItem"> | null | undefined, key: string): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeStoredFlag(storage: Pick<Storage, "setItem"> | null | undefined, key: string, on: boolean): void {
  try {
    storage?.setItem(key, on ? "1" : "0");
  } catch {
    // catch-ok: privat vindue eller blokeret lager; valget gaelder saa kun dette besoeg.
  }
}
