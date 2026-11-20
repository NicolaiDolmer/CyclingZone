// #7947 retning 5: den rene model bag skitsen (ejerens punkt 1-9, 17/11).
// Ingen React, saa node --test kan koere den. Intet her er produktkode, og
// intet her er motorens regel: ordene og trinene er SKITSE-eksempler, som
// dirigenten skal afstemme mod motoren foer byg (#8354, #8364).

import { levelOf, type Session } from "./model.ts";

// --- Hurtigvalget: fire knapper (ejer punkt 5) -------------------------------

export type Effort = "rest" | "easy" | "medium" | "hard";
export const EFFORTS: Effort[] = ["rest", "easy", "medium", "hard"];
export const EFFORT_WORD: Record<Effort, string> = { rest: "Rest", easy: "Easy", medium: "Medium", hard: "Hard" };

/** Et pas' indsats som et af de fire ord. Aktiv restitution bor under Hvile (ejer 16/11). */
export function effortOf(session: Session): Effort {
  return (["rest", "easy", "medium", "hard"] as const)[levelOf(session)];
}

// Spillets egen ordfarve for belastning (SquadTable LoadCell, #8298): Hard i
// advarselsfarven, Medium i tekstfarven, Easy daempet, Rest mest daempet.
export const EFFORT_TONE: Record<Effort, string> = {
  rest: "text-cz-3",
  easy: "text-cz-2",
  medium: "text-cz-1",
  hard: "font-semibold text-cz-warning",
};

/** Dagens indsats som eet ord: den hoejeste indsats blandt datoens traeningsfelter. */
export function dayEffort(sessions: readonly Session[]): Effort {
  let max = 0;
  for (const s of sessions) max = Math.max(max, levelOf(s));
  return (["rest", "easy", "medium", "hard"] as const)[max];
}

// --- Day load: ord + pil (ejer 17/11 paa #8354, valg B) ------------------------

export type DayLoad = "easy" | "light" | "normal" | "hard" | "veryHard";
export type Arrow = "up" | "flat" | "down" | "downMuch";

export const DAY_LOAD_WORD: Record<DayLoad, string> = {
  easy: "Easy day", light: "Light day", normal: "Normal day", hard: "Hard day", veryHard: "Very hard day",
};

// Fem ord, fire pile (ejerens ord: energi op, uaendret, ned, meget ned). Hvilken
// pil Normal day faar, er ikke besluttet; skitsen giver den "ned" (spm. til ejeren).
export const DAY_LOAD_ARROW: Record<DayLoad, Arrow> = {
  easy: "up", light: "flat", normal: "down", hard: "down", veryHard: "downMuch",
};

// Farven foelger traethedens varme skala (#8364): neutral, rav, roed.
export const DAY_LOAD_TONE: Record<DayLoad, string> = {
  easy: "text-cz-2", light: "text-cz-2", normal: "text-cz-1", hard: "text-cz-warning", veryHard: "font-semibold text-cz-danger",
};

/**
 * SKITSE-regel: datoens fem felter laegges sammen (hvile 0, let 1, mellem 2,
 * haard 3, etape 3) og deles i fem baand. Den rigtige regel afledes af motorens
 * pris for dagen (#8354) og kontrolleres af dirigenten foer merge.
 */
export function dayLoad(fields: ReadonlyArray<Session | "stage">): DayLoad {
  const sum = fields.reduce((acc, f) => acc + (f === "stage" ? 3 : levelOf(f)), 0);
  if (sum <= 2) return "easy";
  if (sum <= 5) return "light";
  if (sum <= 8) return "normal";
  if (sum <= 11) return "hard";
  return "veryHard";
}

// --- Fatigue now: tal paa plade med varm skala (#8364) ------------------------

export type FatigueStep = 0 | 1 | 2 | 3;
// SKITSE-trin. #8364: "de praecise trin fastlaegges i byggeriet og vises ejeren
// som billede foer merge". Her kun for at vise skalaens form.
export function fatigueStep(value: number): FatigueStep {
  if (value < 40) return 0;
  if (value < 55) return 1;
  if (value < 70) return 2;
  return 3;
}

// --- Rotation (#7456, ejerens wireframe "Training plan · Rotation") ----------

export type WeekCell =
  | { kind: "race"; label: string }
  | { kind: "restDay" }
  | { kind: "session"; session: Session; n: number };

/**
 * Laeg rotationen ud over en uge (7 dage x 5 felter). Et loeb eller en hviledag
 * springer aldrig et pas over: rotationen venter og fortsaetter i naeste ledige
 * felt. `start` er rytterens egen plads (1-baseret).
 */
export function fillRotation(
  rotation: readonly Session[],
  start: number,
  blocked: ReadonlyArray<ReadonlyArray<"race" | "restDay" | null>>,
  raceLabel: (day: number) => string,
): { week: WeekCell[][]; ridden: number; carried: number; nextStart: number } {
  const len = rotation.length;
  let pos = start - 1;
  let ridden = 0;
  const week = blocked.map((day, d) =>
    day.map((b): WeekCell => {
      if (b === "race") return { kind: "race", label: raceLabel(d) };
      if (b === "restDay") return { kind: "restDay" };
      const n = (pos % len) + 1;
      const cell: WeekCell = { kind: "session", session: rotation[pos % len], n };
      pos += 1;
      ridden += 1;
      return cell;
    }),
  );
  const fields = blocked.reduce((acc, day) => acc + day.length, 0);
  return { week, ridden, carried: Math.max(0, fields - ridden), nextStart: (pos % len) + 1 };
}
