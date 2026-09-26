// trainingPrograms — den rene model bag Program-fanen (#4629, beta 26/9).
//
// Et program er en navngivet 7-dages skabelon med EEN session pr. ugedag.
// Formen er laast 15/9 (TRAINING_RULES §13.3 beslutning 8): 7 ugedage x 5
// loebsdage = 35 celler. Ugedagens session fylder de 5 slots som default;
// spilleren overstyrer enkelte celler.
//
// Kataloget kommer fra serveren (backend/lib/trainingPrograms.js,
// GET /api/training/programs) — det er konfiguration, ikke UI-tekst, saa
// fladen haardkoder ingen programmer. Planen selv (cellerne) kommer fra
// /api/training/me's riderWeekPlans, samme kilde som ugeplanen.
//
// Tildeling er en KOPI (ejer-valg 1, 26/9): `program_key` er kun proveniens,
// og denne model sammenligner derfor planen med kataloget for at kunne sige
// "Sprinter · 2 aendret" — den laeser aldrig planen FRA kataloget.
//
// Ingen React, ingen DOM, ingen i18n: testes isoleret med `node --test`.

export const PROGRAM_SLOTS = 5;
export const WHOLE_DAY_SESSIONS = ["rest", "recovery"] as const;

export type ProgramDayEntry = {
  session?: string;
  intensity?: string;
  slots?: ReadonlyArray<string | null> | null;
};
export type ProgramWeekDays = Record<string, ProgramDayEntry | undefined>;

export type CatalogProgram = {
  key: string;
  name: { en: string; da: string };
  tagline: { en: string; da: string };
  targetTypes: string[];
  audience: string | null;
  days: Record<string, string>;
};

// Er raekken en programplan (alle ugedage baerer en session)? En gammel
// ugerytme (#1895, kun intensitet) er det ikke og vises som i dag.
export function isProgramPlan(days: ProgramWeekDays | null | undefined, weekdays: readonly string[]): boolean {
  if (!days || typeof days !== "object") return false;
  return weekdays.every((w) => typeof days[w]?.session === "string" && days[w]!.session!.length > 0);
}

// Sessionen i EEN celle: slottets egen, ellers ugedagens. slotIndex er 0-baseret.
export function cellSession(
  days: ProgramWeekDays | null | undefined,
  weekday: string,
  slotIndex: number | null = null,
): string | null {
  const entry = days?.[weekday];
  if (!entry) return null;
  if (slotIndex != null) {
    const slot = entry.slots?.[slotIndex];
    if (typeof slot === "string" && slot) return slot;
  }
  return typeof entry.session === "string" && entry.session ? entry.session : null;
}

// Er cellen overstyret (slot med egen session)?
export function isCellOverridden(days: ProgramWeekDays | null | undefined, weekday: string, slotIndex: number): boolean {
  const slot = days?.[weekday]?.slots?.[slotIndex];
  return typeof slot === "string" && slot.length > 0;
}

// Loebsdags-kolonnen (1-baseret index fra buildRaceDayColumns) → slot (0-4).
export function slotForColumnIndex(index: number | null | undefined): number {
  const n = Number(index);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(PROGRAM_SLOTS - 1, Math.floor(n) - 1);
}

// Hvor mange celler afviger fra programmet de blev kopieret fra? En ugedag
// med en anden session taeller som een; hvert overstyret slot taeller som een.
export function changedCellCount(
  days: ProgramWeekDays | null | undefined,
  program: CatalogProgram | null | undefined,
  weekdays: readonly string[],
): number {
  if (!days || !program) return 0;
  let n = 0;
  for (const weekday of weekdays) {
    if (days[weekday]?.session !== program.days[weekday]) n += 1;
    for (const slot of days[weekday]?.slots ?? []) if (typeof slot === "string" && slot) n += 1;
  }
  return n;
}

// Kataloget sorteret til EEN rytter: programmer for hans type foerst, saa de
// generelle, i katalogets egen raekkefoelge. Uden type: katalogets raekkefoelge.
export function catalogForRiderType(catalog: readonly CatalogProgram[], riderType: string | null | undefined): CatalogProgram[] {
  const list = [...(catalog ?? [])];
  if (!riderType) return list;
  const matches = list.filter((p) => p.targetTypes.includes(riderType));
  return [...matches, ...list.filter((p) => !p.targetTypes.includes(riderType))];
}

export function programName(program: CatalogProgram | null | undefined, lang: string | null | undefined): string {
  if (!program) return "";
  return String(lang ?? "").toLowerCase().startsWith("da") ? program.name.da : program.name.en;
}

export function programTagline(program: CatalogProgram | null | undefined, lang: string | null | undefined): string {
  if (!program) return "";
  return String(lang ?? "").toLowerCase().startsWith("da") ? program.tagline.da : program.tagline.en;
}

// Hvile og restitution er hele-dags-tilstande; resten er sessioner.
export function isWholeDaySession(session: string | null | undefined): boolean {
  return session === "rest" || session === "recovery";
}

// Rytterens session for "i dag" i en given loebsdags-kolonne, naar han staar
// paa et program. null = ingen programplan (fladen viser saa den gamle plan).
export function programSessionToday(
  days: ProgramWeekDays | null | undefined,
  weekdays: readonly string[],
  weekday: string,
  columnIndex: number | null = null,
): string | null {
  if (!isProgramPlan(days, weekdays)) return null;
  return cellSession(days, weekday, columnIndex == null ? 0 : slotForColumnIndex(columnIndex));
}
