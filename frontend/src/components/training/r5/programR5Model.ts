// programR5Model — den rene model bag Program-fanen i den nye traeningsside R5
// (#7456/#7947, ejer 20/11). Ingen React, ingen fetch, ingen i18n: node --test.
//
// Specifikationen er R5-skitsen (design/7947-r5-program, R5Program.tsx), ejerens
// wireframe 17/11 og beslutningerne paa #7456. Denne model binder KUN til de data
// serveren har i dag:
//   - programmerne er serverens katalog (GET /api/training/programs), og et program
//     saettes paa en gruppe (POST /groups/:id/program) eller en rytter
//     (POST /programs/apply) som en KOPI (ejer-valg 1, 26/9);
//   - rytterens egen plan vinder over gruppens (#6000: follows_group=false);
//   - felterne rettes pr. rytter eller pr. gruppe (PUT .../cell).
// Rotation, prioritet og laas pr. dag findes ikke i backend endnu (PR-body'ens
// designnote), saa de staar ikke i modellen som data, kun som valgbar visning
// naar de findes (AVAILABLE_KINDS).

import { PROGRAM_SLOTS, cellSession, isProgramPlan, type CatalogProgram, type ProgramWeekDays } from "../../../lib/trainingPrograms.ts";

export type Kind = "week" | "rotation";

// Ejer 19/11: et nyt program starter i Week blocks, og visningen husker sidste valg.
export const PROGRAM_VIEW_STORE = "cz-training-program-view";
// Rotation kraever en plads pr. rytter i backend; indtil den findes er Week blocks
// den eneste visning, og vaelgeren tegnes ikke.
export const AVAILABLE_KINDS: readonly Kind[] = ["week"];

export function rememberedKind(stored: string | null | undefined, available: readonly Kind[] = AVAILABLE_KINDS): Kind {
  return available.includes(stored as Kind) ? (stored as Kind) : "week";
}

export type R5Rider = { id: string; name: string; type: string | null };
export type R5GroupMember = { riderId: string; followsGroup: boolean };
export type R5Group = {
  id: string;
  name: string;
  programKey: string | null;
  days?: Record<string, unknown> | null;
  members: R5GroupMember[];
};

export type Subject = { kind: "group" | "rider"; id: string };

export function subjectKey(subject: Subject | null | undefined): string {
  return subject ? `${subject.kind}:${subject.id}` : "";
}

export function parseSubjectKey(value: string | null | undefined): Subject | null {
  const match = /^(group|rider):(.+)$/.exec(String(value ?? ""));
  return match ? { kind: match[1] as Subject["kind"], id: match[2] } : null;
}

// --- Biblioteket -----------------------------------------------------------------

export type RiderPlan =
  | { via: "group"; groupId: string }
  | { via: "own"; programKey: string | null }
  | { via: "none" };

type LibraryInput = {
  catalog: readonly CatalogProgram[];
  groups: readonly R5Group[];
  riders: readonly R5Rider[];
  // Ryttere med deres egen ugeplan-raekke (35 felter).
  ownPlanIds: ReadonlySet<string>;
  // rider_id -> program_key (proveniens for rytterens egen kopi).
  assigned: Readonly<Record<string, string>>;
};

// Hvor faar rytteren sin plan fra? Foelger han en gruppe, er det gruppens; ellers
// hans egen raekke; ellers intet ("No program", ingen advarsel, ejer 20/11).
export function riderPlan(riderId: string, input: Pick<LibraryInput, "groups" | "ownPlanIds" | "assigned">): RiderPlan {
  for (const group of input.groups) {
    const member = group.members.find((m) => m.riderId === riderId);
    if (member?.followsGroup) return { via: "group", groupId: group.id };
    if (member) return { via: "own", programKey: input.assigned[riderId] ?? null };
  }
  if (input.ownPlanIds.has(riderId)) return { via: "own", programKey: input.assigned[riderId] ?? null };
  return { via: "none" };
}

export type LibraryProgram = {
  key: string;
  groups: { id: string; name: string; following: number }[];
  riders: string[];
  inUse: boolean;
};
export type LibraryGroup = {
  id: string;
  name: string;
  programKey: string | null;
  members: { riderId: string; own: boolean; ownProgramKey: string | null }[];
};
export type Library = {
  programs: LibraryProgram[];
  groups: LibraryGroup[];
  ownOnly: { riderId: string; programKey: string | null }[];
  noProgram: string[];
};

export function buildLibrary(input: LibraryInput): Library {
  const known = new Set(input.riders.map((r) => r.id));
  const grouped = new Set<string>();
  const groups: LibraryGroup[] = input.groups.map((group) => ({
    id: group.id,
    name: group.name,
    programKey: group.programKey ?? null,
    members: group.members.filter((m) => known.has(m.riderId)).map((m) => {
      grouped.add(m.riderId);
      return { riderId: m.riderId, own: !m.followsGroup, ownProgramKey: m.followsGroup ? null : input.assigned[m.riderId] ?? null };
    }),
  }));
  const ownOnly: Library["ownOnly"] = [];
  const noProgram: string[] = [];
  for (const rider of input.riders) {
    if (grouped.has(rider.id)) continue;
    if (input.ownPlanIds.has(rider.id)) ownOnly.push({ riderId: rider.id, programKey: input.assigned[rider.id] ?? null });
    else noProgram.push(rider.id);
  }
  const ownRiders = [
    ...groups.flatMap((g) => g.members.filter((m) => m.own).map((m) => ({ riderId: m.riderId, programKey: m.ownProgramKey }))),
    ...ownOnly,
  ];
  const programs = input.catalog.map((program) => {
    const onGroups = groups
      .filter((g) => g.programKey === program.key)
      .map((g) => ({ id: g.id, name: g.name, following: g.members.filter((m) => !m.own).length }));
    const onRiders = ownRiders.filter((r) => r.programKey === program.key).map((r) => r.riderId);
    return { key: program.key, groups: onGroups, riders: onRiders, inUse: onGroups.length + onRiders.length > 0 };
  });
  // Programmer i brug oeverst, resten i katalogets raekkefoelge (stabil sortering).
  programs.sort((a, b) => Number(b.inUse) - Number(a.inUse));
  return { programs, groups, ownOnly, noProgram };
}

// Hvem programmet sidder paa: grupperne foerst, saa rytterne med egen kopi.
export function subjectsFor(programKey: string | null, library: Library): Subject[] {
  const entry = library.programs.find((p) => p.key === programKey);
  if (!entry) return [];
  return [
    ...entry.groups.map((g) => ({ kind: "group" as const, id: g.id })),
    ...entry.riders.map((id) => ({ kind: "rider" as const, id })),
  ];
}

// Programmet bag et valgt emne (gruppens program eller rytterens egen kopi).
export function programKeyOf(subject: Subject | null, library: Library): string | null {
  if (!subject) return null;
  if (subject.kind === "group") return library.groups.find((g) => g.id === subject.id)?.programKey ?? null;
  const own = library.ownOnly.find((r) => r.riderId === subject.id);
  if (own) return own.programKey;
  for (const group of library.groups) {
    const member = group.members.find((m) => m.riderId === subject.id);
    if (member) return member.own ? member.ownProgramKey : group.programKey;
  }
  return null;
}

// Kataloget som en uge i feltform (programmet som skrevet, read-only).
export function catalogWeekDays(program: CatalogProgram | null | undefined): ProgramWeekDays | null {
  if (!program?.days) return null;
  const out: ProgramWeekDays = {};
  for (const [weekday, session] of Object.entries(program.days)) out[weekday] = { session };
  return out;
}

// Rytterens felter: hans egen raekke, ellers serverens saaede uge (#5932).
export function riderWeekDays(
  riderId: string,
  plans: Readonly<Record<string, ProgramWeekDays | null | undefined>>,
  seeds: Readonly<Record<string, ProgramWeekDays>>,
  weekdays: readonly string[],
): { days: ProgramWeekDays | null; isSeed: boolean } {
  const own = plans[riderId];
  if (isProgramPlan(own, weekdays)) return { days: own ?? null, isSeed: false };
  const seed = seeds[riderId];
  return isProgramPlan(seed, weekdays) ? { days: seed, isSeed: true } : { days: null, isSeed: false };
}

// --- Kladden (Save plan) -------------------------------------------------------------

export type Draft = Readonly<Record<string, string>>;

export function draftKey(weekday: string, slot: number): string {
  return `${weekday}:${slot}`;
}

export function draftCellSession(days: ProgramWeekDays | null | undefined, draft: Draft, weekday: string, slot: number): string | null {
  return draft[draftKey(weekday, slot)] ?? cellSession(days, weekday, slot);
}

// Et felt i kladden. Er vaerdien den gemte igen, forsvinder rettelsen.
export function setDraftCell(draft: Draft, days: ProgramWeekDays | null | undefined, weekday: string, slot: number, session: string): Draft {
  const next: Record<string, string> = { ...draft };
  const key = draftKey(weekday, slot);
  if (cellSession(days, weekday, slot) === session) delete next[key];
  else next[key] = session;
  return next;
}

// "Kopier en dag" (ejer 20/11): kildens fem felter, som kladden viser dem, til maaldagene.
// Er dagens felter laast efter Train now, springes i dag over.
export function copyDayTargets(
  from: string,
  choice: string,
  weekdays: readonly string[],
  { todayWeekday = null, todayLocked = false }: { todayWeekday?: string | null; todayLocked?: boolean } = {},
): string[] {
  const wanted = choice === "all" ? weekdays.filter((w) => w !== from) : weekdays.filter((w) => w === choice && w !== from);
  return wanted.filter((w) => !(todayLocked && w === todayWeekday));
}

export function copyDayIntoDraft(
  draft: Draft,
  days: ProgramWeekDays | null | undefined,
  from: string,
  targets: readonly string[],
): Draft {
  let next = draft;
  for (const target of targets) {
    for (let slot = 0; slot < PROGRAM_SLOTS; slot += 1) {
      const session = draftCellSession(days, draft, from, slot);
      if (session) next = setDraftCell(next, days, target, slot, session);
    }
  }
  return next;
}

export type DraftStep = { weekday: string; slotIndex: number; session: string };

// Kladden som felt-skrivninger i ugens raekkefoelge (en PUT .../cell pr. felt).
export function draftSteps(draft: Draft, weekdays: readonly string[]): DraftStep[] {
  const steps: DraftStep[] = [];
  for (const weekday of weekdays) {
    for (let slot = 0; slot < PROGRAM_SLOTS; slot += 1) {
      const session = draft[draftKey(weekday, slot)];
      if (session) steps.push({ weekday, slotIndex: slot, session });
    }
  }
  return steps;
}

export function draftTotal(drafts: Readonly<Record<string, Draft>>): number {
  return Object.values(drafts).reduce((sum, d) => sum + Object.keys(d).length, 0);
}

// --- Ugen for et emne ----------------------------------------------------------------

export type WeekCell =
  | { kind: "race" }
  | { kind: "ran"; session: string | null }
  | { kind: "session"; session: string | null; changed: boolean };

// 7 x 5 felter. Loebets felter i dag er graa + flag (regel A); felter med kvittering i
// dag er koert. Serveren kender kun dagens loebsfelter, saa de andre dage viser planen.
export function weekCells({
  days, draft, weekdays, todayWeekday, raceToday, lockedToday,
}: {
  days: ProgramWeekDays | null | undefined;
  draft: Draft;
  weekdays: readonly string[];
  todayWeekday: string | null;
  raceToday: ReadonlySet<number>;
  lockedToday: ReadonlySet<number>;
}): WeekCell[][] {
  return weekdays.map((weekday) => Array.from({ length: PROGRAM_SLOTS }, (_, slot): WeekCell => {
    if (weekday === todayWeekday && raceToday.has(slot)) return { kind: "race" };
    if (weekday === todayWeekday && lockedToday.has(slot)) return { kind: "ran", session: cellSession(days, weekday, slot) };
    const key = draftKey(weekday, slot);
    return { kind: "session", session: draftCellSession(days, draft, weekday, slot), changed: key in draft };
  }));
}

// "Copy to riders": alle andre ryttere end dem der allerede har programmet som egen kopi.
export function copyCandidates(programKey: string | null, library: Library, riders: readonly R5Rider[]): R5Rider[] {
  if (!programKey) return [];
  const already = new Set(library.programs.find((p) => p.key === programKey)?.riders ?? []);
  return riders.filter((r) => !already.has(r.id));
}
