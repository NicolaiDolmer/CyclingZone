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

import { PROGRAM_SLOTS, cellSession, isProgramPlan, type CatalogProgram, type ProgramWeekDays } from "../../../lib/trainingPrograms.ts";
import { assignDayFields } from "../../../../../backend/lib/trainingWeekBlocks.js";

export type Kind = "week" | "rotation";

// Ejer 19/11: et nyt program starter i Week blocks, og visningen husker sidste valg.
export const PROGRAM_VIEW_STORE = "cz-training-program-view";
// Rotation is only available when the program API enables it for the viewer.
export const AVAILABLE_KINDS: readonly Kind[] = ["week"];

export function availableKinds(rotationEnabled: boolean): readonly Kind[] {
  return rotationEnabled ? ["week", "rotation"] : AVAILABLE_KINDS;
}

export type RotationPass = { session: string; effort?: "easy" | "normal" | "hard" };
export type RotationPreviewSlot = { index: number; length: number; session?: string; intensity?: string } | null;
export type RotationPlan = {
  planKind: Kind | null;
  rotation: { v: 1; passes: RotationPass[]; rev: number; anchor?: { index: number } } | null;
};
export type RotationWrite = { planKind?: Kind; passes?: RotationPass[]; keepPlace?: boolean; startIndex?: number };
export type WeekBlock = {
  slots: string[];
  lockSlot: number | null;
  slotEfforts?: Array<NonNullable<RotationPass["effort"]> | null>;
};
export type WeekCellWrite = { planKind: "week"; weekBlock?: WeekBlock };
export type RotationDrafts = Record<string, { passes?: RotationPass[]; startIndex?: number }>;
export type WeekBlockDrafts = Record<string, Record<string, WeekBlock>>;

export function moveWeekBlock(block: WeekBlock, from: number, to: number): WeekBlock {
  const indices = block.slots.map((_, index) => index);
  const [moved] = indices.splice(from, 1);
  indices.splice(to, 0, moved);
  return {
    slots: indices.map((index) => block.slots[index]),
    lockSlot: block.lockSlot == null ? null : indices.indexOf(block.lockSlot),
    ...(block.slotEfforts ? { slotEfforts: indices.map((index) => block.slotEfforts?.[index] ?? null) } : {}),
  };
}
export const ROTATION_MIN_PASSES = 2;
export const ROTATION_MAX_PASSES = 35;

export function moveRotationPass(passes: readonly RotationPass[], from: number, to: number): readonly RotationPass[] {
  if (from === to || from < 0 || from >= passes.length || to < 0 || to >= passes.length) return passes;
  const reordered = [...passes];
  const [pass] = reordered.splice(from, 1);
  reordered.splice(to, 0, pass);
  return reordered;
}

export function rememberedKind(stored: string | null | undefined, available: readonly Kind[] = AVAILABLE_KINDS): Kind {
  return available.includes(stored as Kind) ? (stored as Kind) : "week";
}

// #8547 (ejer 21/11): telefonen skifter mellem Dag (en dag ad gangen) og Uge (hele ugen som
// liste). Valget huskes pr. enhed; Dag er standard. Egen noegle, saa den ikke roerer programtypen.
export type PhoneView = "day" | "week";
export const PROGRAM_PHONE_VIEW_STORE = "cz-training-program-phone-view";
export const PHONE_VIEWS: readonly PhoneView[] = ["day", "week"];

export function rememberedPhoneView(stored: string | null | undefined): PhoneView {
  return PHONE_VIEWS.includes(stored as PhoneView) ? (stored as PhoneView) : "day";
}

// "Tomas Varga" -> "T. Varga" (rytter-chips paa 390 px). Et enkelt ord staar uaendret.
export function shortRiderName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  if (!first || rest.length === 0) return first ?? "";
  return `${[...first][0]}. ${rest.join(" ")}`;
}

// Ugedagens fulde navn paa sproget (mon..sun). En kendt mandag som anker; ukendt noegle giver "".
const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export function weekdayLong(weekday: string, lang: string): string {
  const index = WEEKDAY_ORDER.indexOf(weekday as (typeof WEEKDAY_ORDER)[number]);
  if (index < 0) return "";
  try {
    return new Intl.DateTimeFormat(lang, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + index)));
  } catch {
    return weekday;
  }
}

// Dagen telefonen aabner paa: i dag, ellers foerste dag.
export function startDayIndex(weekdays: readonly string[], todayWeekday: string | null | undefined): number {
  const index = weekdays.indexOf(todayWeekday ?? "");
  return index >= 0 ? index : 0;
}

export function clampDay(index: number, weekdays: readonly string[]): number {
  return Math.max(0, Math.min(weekdays.length - 1, index));
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
  | { kind: "race"; pending?: true }
  | { kind: "rest" }
  | { kind: "ran"; session: string | null; sourceSlot?: number }
  | { kind: "session"; session: string | null; changed: boolean; sourceSlot?: number };

export type WeekPlacement = { fieldSource: (number | null)[]; taken: number[]; lockMovedFrom: number | null; restSlots?: number[] };

export function weekPlacement(lockSlot: number | null, races: readonly number[], settled?: Record<number, number | null>): WeekPlacement {
  const { fieldSource, taken, lockMovedFrom } = assignDayFields({ entry: { lockSlot }, raceFields: races, settled });
  return { fieldSource: fieldSource.map((source) => source ?? null), taken, lockMovedFrom };
}

export function weekPlacementFromForecast(forecast: Partial<WeekPlacement> | null | undefined): WeekPlacement | null {
  if (forecast?.fieldSource?.length !== PROGRAM_SLOTS || !Array.isArray(forecast.taken)) return null;
  return { fieldSource: forecast.fieldSource, taken: forecast.taken, lockMovedFrom: forecast.lockMovedFrom ?? null, restSlots: forecast.restSlots ?? [] };
}

// 7 x 5 felter. Loebets felter i dag er graa + flag (regel A); felter med kvittering i
// dag er koert. Serveren kender kun dagens loebsfelter, saa de andre dage viser planen.
export function weekCells({
  days, draft, weekdays, todayWeekday, raceToday, pendingToday, lockedToday, placements = {},
}: {
  days: ProgramWeekDays | null | undefined;
  draft: Draft;
  weekdays: readonly string[];
  todayWeekday: string | null;
  raceToday: ReadonlySet<number>;
  pendingToday?: ReadonlySet<number>;
  lockedToday: ReadonlySet<number>;
  placements?: Record<string, WeekPlacement>;
}): WeekCell[][] {
  return weekdays.map((weekday) => Array.from({ length: PROGRAM_SLOTS }, (_, slot): WeekCell => {
    const placement = placements[weekday];
    if (weekday === todayWeekday && pendingToday?.has(slot)) return { kind: "race", pending: true };
    if (placement?.restSlots?.includes(slot)) return { kind: "rest" };
    if ((weekday === todayWeekday && raceToday.has(slot)) || placement?.fieldSource[slot] === null) return { kind: "race" };
    const source = placement?.fieldSource[slot] ?? slot;
    const metadata = source === slot ? {} : { sourceSlot: source };
    if (weekday === todayWeekday && lockedToday.has(slot)) return { kind: "ran", session: cellSession(days, weekday, source), ...metadata };
    return { kind: "session", session: draftCellSession(days, draft, weekday, source), changed: draftKey(weekday, source) in draft, ...metadata };
  }));
}

// Dagens tegn paa telefonen: loeb (flag), og om dagen har rettelser der ikke er gemt.
export function dayMarks(dayCells: readonly WeekCell[]): { races: number; changed: number } {
  return {
    races: dayCells.filter((c) => c.kind === "race").length,
    changed: dayCells.filter((c) => c.kind === "session" && c.changed).length,
  };
}

// "Copy to riders": alle andre ryttere end dem der allerede har programmet som egen kopi.
export function copyCandidates(programKey: string | null, library: Library, riders: readonly R5Rider[]): R5Rider[] {
  if (!programKey) return [];
  const already = new Set(library.programs.find((p) => p.key === programKey)?.riders ?? []);
  return riders.filter((r) => !already.has(r.id));
}

// --- Gruppestyring (#8560, ejer 21/11) -----------------------------------------------
// Biblioteket faar "+ New group" og en menu pr. gruppe (Rename, Members, Fatigue limit,
// Delete). Alt gaar gennem de eksisterende gruppe-kald (POST/PATCH/DELETE /groups,
// /:id/follow, /:id/fatigue); her bor kun de rene valg, saa de kan testes uden browser.

export const GROUP_MENU_ACTIONS = ["rename", "members", "limit", "delete"] as const;
export type GroupMenuAction = (typeof GROUP_MENU_ACTIONS)[number];

// Menuens punkter. Traethedsgraensen findes kun, naar traethedsreglerne er slaaet til.
export function groupMenuActions({ limitEnabled }: { limitEnabled: boolean }): GroupMenuAction[] {
  return GROUP_MENU_ACTIONS.filter((a) => a !== "limit" || limitEnabled);
}

type GroupLike = { id: string; name: string; members: readonly R5GroupMember[] };

export function groupMovePatch(group: GroupLike, riderId: string): { riderIds: string[] } | null {
  const memberIds = group.members.map((member) => member.riderId);
  return memberIds.includes(riderId) ? null : { riderIds: [...memberIds, riderId] };
}

// PATCH kun med det der faktisk er aendret. Medlemmer sendes kun ved en aendring, fordi
// serveren tjekker "Train now"-laasen, naar en gruppe med felter faar medlemmer; en ren
// omdoebning skal ikke kunne afvises af laasen. null = intet at gemme.
export function groupPatch(
  group: GroupLike,
  name: string,
  riderIds: readonly string[],
): { name?: string; riderIds?: string[] } | null {
  const patch: { name?: string; riderIds?: string[] } = {};
  const trimmed = name.trim();
  if (trimmed && trimmed !== group.name) patch.name = trimmed;
  const before = new Set(group.members.map((m) => m.riderId));
  const after = new Set(riderIds);
  const same = before.size === after.size && [...after].every((id) => before.has(id));
  if (!same) patch.riderIds = [...after];
  return Object.keys(patch).length ? patch : null;
}

// Codex P2 paa #8565: lykkes PATCH, men graensen fejler bagefter, bliver dialogen staaende.
// Det naeste Gem skal sammenligne med det der nu ER gemt, ellers udelader groupPatch en
// tilbagerulning af navn/medlemmer og lukker dialogen med en anden gruppe paa serveren.
// Serverens svar vinder; uden svar bygges snapshottet af patchen.
export function groupAfterPatch<G extends GroupLike>(
  editing: G,
  patch: { name?: string; riderIds?: string[] },
  saved: readonly G[] | undefined,
): G {
  const fromServer = saved?.find((g) => g.id === editing.id);
  if (fromServer) return fromServer;
  return {
    ...editing,
    name: patch.name ?? editing.name,
    members: patch.riderIds
      ? patch.riderIds.map((riderId) => editing.members.find((m) => m.riderId === riderId) ?? { riderId, followsGroup: true })
      : editing.members,
  };
}

// Den nye gruppe efter "Create": den id der ikke fandtes foer.
export function createdGroupId(before: readonly string[], after: ReadonlyArray<{ id: string }> | null | undefined): string | null {
  const known = new Set(before);
  return (after ?? []).find((g) => !known.has(g.id))?.id ?? null;
}

// "Follow the group again": rytteren med egen plan (eller alle i gruppen med egen plan)
// foelger gruppen igen. null = intet at foelge (rytteren er ikke i en gruppe, eller alle foelger).
export function followAgainTarget(
  subject: Subject | null,
  groups: readonly GroupLike[],
): { groupId: string; groupName: string; riderIds: string[] } | null {
  if (!subject) return null;
  if (subject.kind === "group") {
    const group = groups.find((g) => g.id === subject.id);
    const own = group?.members.filter((m) => !m.followsGroup).map((m) => m.riderId) ?? [];
    return group && own.length ? { groupId: group.id, groupName: group.name, riderIds: own } : null;
  }
  for (const group of groups) {
    const member = group.members.find((m) => m.riderId === subject.id);
    if (member) return member.followsGroup ? null : { groupId: group.id, groupName: group.name, riderIds: [subject.id] };
  }
  return null;
}

// Kladder der ikke laengere har et emne (slettet gruppe, rytter der foelger gruppen igen).
export function dropDrafts<T>(drafts: Readonly<Record<string, T>>, keys: readonly string[]): Record<string, T> {
  const out: Record<string, T> = { ...drafts };
  for (const key of keys) delete out[key];
  return out;
}

// Gruppens traethedsgraense i dialogen: Holdets / Egen: N / Fra (ejer 21/11).
export type GroupLimitMode = "team" | "own" | "off";
export type GroupLimitDraft = { mode: GroupLimitMode; threshold: string; fallback: string };
export type GroupFatigue = { threshold: number | null; fallback: string } | null | undefined;
export const GROUP_LIMIT_MODES: readonly GroupLimitMode[] = ["team", "own", "off"];

// Startvaerdierne for "Egen" er de samme som i graense-kortets gruppe-undtagelse.
export function groupLimitDraft(fatigue: GroupFatigue, defaults: { threshold: number; fallback: string }): GroupLimitDraft {
  if (!fatigue) return { mode: "team", threshold: String(defaults.threshold), fallback: defaults.fallback };
  if (fatigue.fallback === "off") return { mode: "off", threshold: String(defaults.threshold), fallback: defaults.fallback };
  return {
    mode: "own",
    threshold: String(fatigue.threshold ?? defaults.threshold),
    fallback: fatigue.fallback || defaults.fallback,
  };
}

function limitThreshold(text: string): number | null {
  const n = text.trim() === "" ? NaN : Number(text);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}

export function groupLimitValid(draft: GroupLimitDraft): boolean {
  return draft.mode !== "own" || limitThreshold(draft.threshold) != null;
}

// Hvad der skal skrives til PUT /:id/fatigue. change null = graensen er uaendret.
export function groupLimitWrite(
  draft: GroupLimitDraft,
  current: GroupFatigue,
): { ok: false } | { ok: true; change: null | { mode: GroupLimitMode; own?: { threshold: number; fallback: string } } } {
  if (!groupLimitValid(draft)) return { ok: false };
  const was: GroupLimitMode = !current ? "team" : current.fallback === "off" ? "off" : "own";
  if (draft.mode !== "own") return { ok: true, change: draft.mode === was ? null : { mode: draft.mode } };
  const own = { threshold: limitThreshold(draft.threshold) as number, fallback: draft.fallback };
  const same = was === "own" && current?.threshold === own.threshold && current?.fallback === own.fallback;
  return { ok: true, change: same ? null : { mode: "own", own } };
}
