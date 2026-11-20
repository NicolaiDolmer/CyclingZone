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

/** Dagens indsats som eet ord: den hoejeste blandt dagens traeningsfelter. null = ingen dag. */
export function dayEffort(fields: readonly Field[]): Effort | null {
  let best: Effort | null = null;
  for (const f of fields) {
    if (f === STAGE) continue;
    const e = effortOf(f);
    if (e && (best === null || EFFORT_RANK[e] > EFFORT_RANK[best])) best = e;
  }
  return best;
}

/**
 * Hvad et tryk paa en indsats skriver, med spillets eksisterende gemme-kald
 * (dayType + session, samme som dagsvaelgeren). Haard kraever en session for
 * typen: rytterens egen haarde session, ellers assistentens; kendes ingen,
 * aabnes sessionsvaelgeren i stedet for at gaette (samme regel som den gamle fane).
 */
export type QuickWrite =
  | { kind: "write"; dayType: "rest" | "training" | "skill"; session: string | null }
  | { kind: "pick" };

export function writeForEffort(
  effort: Effort,
  { storedFocus, assistantFocus }: { storedFocus: string | null | undefined; assistantFocus: string | null | undefined },
): QuickWrite {
  if (effort === "rest") return { kind: "write", dayType: "rest", session: null };
  const keep = (s: string | null | undefined) => (s && effortOf(s) === effort ? s : null);
  const own = keep(storedFocus) ?? keep(assistantFocus);
  if (effort === "easy") {
    const session = own ?? "endurance";
    return { kind: "write", dayType: SKILL.has(session) ? "skill" : "training", session };
  }
  if (effort === "medium") return { kind: "write", dayType: "training", session: own ?? "tempo" };
  return own ? { kind: "write", dayType: "training", session: own } : { kind: "pick" };
}
const SKILL = new Set(["technique", "aero", "loebslaere"]);

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

// --- Day load: ord + pil (ejer 17/11 paa #8354) --------------------------------

export type DayLoad = "easy" | "light" | "normal" | "hard" | "veryHard";
export const DAY_LOADS: readonly DayLoad[] = Object.freeze(["easy", "light", "normal", "hard", "veryHard"]);

// Skitsens regel (r5model.ts): felterne laegges sammen efter indsats (en etape
// tæller som haard) og deles i fem baand. Ord, ikke et tal for aftenen.
const LOAD_BANDS: readonly number[] = [2, 5, 8, 11];

/** Dagens belastning, eller null naar rytteren ingen dag har (aldrig et opdigtet ord). */
export function dayLoad(fields: readonly Field[]): DayLoad | null {
  if (fields.every((f) => f === null)) return null;
  let sum = 0;
  for (const f of fields) sum += f === STAGE ? EFFORT_RANK.hard : EFFORT_RANK[effortOf(f) ?? "rest"];
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
    case "load": { const l = dayLoad(row.fields); return l ? DAY_LOADS.indexOf(l) : null; }
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
  return picked.length > 0 ? { kind: "selected", ids: picked } : { kind: "team", ids: selectable };
}

/**
 * Holdlinjens indsats paa flere ryttere via spillets masse-kald (eet valg pr.
 * kald). Hvile, Let og Mellem er eet kald; Haard samles pr. rytterens haarde
 * session, og en rytter uden kendt haard session springes over (aldrig et gaet).
 */
export function bulkPlan(
  effort: Effort,
  ids: readonly string[],
  focusOf: (id: string) => { storedFocus: string | null | undefined; assistantFocus: string | null | undefined },
): { calls: Array<{ choice: string; ids: string[] }>; skipped: string[] } {
  if (effort === "rest") return { calls: ids.length ? [{ choice: "rest", ids: [...ids] }] : [], skipped: [] };
  if (effort === "easy") return { calls: ids.length ? [{ choice: "endurance", ids: [...ids] }] : [], skipped: [] };
  if (effort === "medium") return { calls: ids.length ? [{ choice: "tempo", ids: [...ids] }] : [], skipped: [] };
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
