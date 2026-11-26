// programWeekV2Model — rene funktioner bag Program W1 v2 (#7947, ejerens design 26/11).
//
// Program-fanen viser ugen for den valgte gruppe eller rytter, valgt i "Plan for". Valget
// "Alle ryttere" viser en tabel med en linje pr. rytter. Indsatsen (Let/Mellem/Haard) staar
// under hvert pas og gemmes med de eksisterende felt-skrivninger (`effort` paa PUT .../cell),
// kun med kontakten training_effort_levels on. Uden kontakten sendes intet `effort`, og
// skrivningerne er praecis som i dag (Program R5).
//
// Kladden bor paa siden ligesom R5's: noeglen er "ugedag:felt", vaerdien er sessionen
// (en streng, som R5) eller { session, effort } naar indsatsen er rettet.
import { PROGRAM_SLOTS, cellSession, isWholeDaySession, type ProgramWeekDays } from "../../../lib/trainingPrograms.ts";
import { effortOf, levelOfEffort } from "./todayR5Model.ts";
import { draftKey, riderPlan, riderWeekDays, type R5Group, type R5Rider, type Subject } from "./programR5Model.ts";

export type ProgramEffort = "easy" | "normal" | "hard";
export const PROGRAM_EFFORTS: readonly ProgramEffort[] = ["easy", "normal", "hard"];

export type PassEdit = { session: string; effort?: ProgramEffort | null };
export type DraftV2 = Readonly<Record<string, string | PassEdit>>;

function isEffort(value: unknown): value is ProgramEffort {
  return value === "easy" || value === "normal" || value === "hard";
}

type DayEntry = { effort?: unknown; slotEfforts?: ReadonlyArray<unknown> | null };
function dayEntry(days: ProgramWeekDays | null | undefined, weekday: string): DayEntry | undefined {
  return days?.[weekday] as DayEntry | undefined;
}

function editOf(draft: DraftV2, weekday: string, slot: number): PassEdit | null {
  const change = draft[draftKey(weekday, slot)];
  if (change == null) return null;
  return typeof change === "string" ? { session: change } : change;
}

/** Sessionen i feltet, som kladden viser den. */
export function passSession(days: ProgramWeekDays | null | undefined, draft: DraftV2, weekday: string, slot: number): string | null {
  return editOf(draft, weekday, slot)?.session ?? cellSession(days, weekday, slot);
}

/** Den gemte indsats for feltet: feltets egen, ellers dagens, ellers null (= sessionens standard). */
export function savedEffort(days: ProgramWeekDays | null | undefined, weekday: string, slot: number): ProgramEffort | null {
  const entry = dayEntry(days, weekday);
  const own = Array.isArray(entry?.slotEfforts) ? entry!.slotEfforts![slot] : null;
  if (isEffort(own)) return own;
  return isEffort(entry?.effort) ? entry!.effort as ProgramEffort : null;
}

/** Sessionens eget niveau (det motoren koerer, naar ingen indsats er valgt). */
export function defaultEffort(session: string | null | undefined): ProgramEffort | null {
  return levelOfEffort(effortOf(session)) as ProgramEffort | null;
}

/**
 * Indsatsen der vises under passet. null = "Ingen indsats" (hvile, aktiv restitution, tomt felt).
 * En rettet indsats i kladden vinder; null i kladden betyder "foelg sessionens standard".
 */
export function shownEffort(days: ProgramWeekDays | null | undefined, draft: DraftV2, weekday: string, slot: number): ProgramEffort | null {
  const session = passSession(days, draft, weekday, slot);
  if (!session || isWholeDaySession(session)) return null;
  const edit = editOf(draft, weekday, slot);
  const effort = edit && edit.effort !== undefined ? edit.effort : savedEffort(days, weekday, slot);
  return effort ?? defaultEffort(session);
}

/** Har feltet sin indsats rettet i kladden? */
export function effortChanged(draft: DraftV2, weekday: string, slot: number): boolean {
  const edit = editOf(draft, weekday, slot);
  return !!edit && edit.effort !== undefined;
}

/**
 * Ret et felt i kladden: sessionen, indsatsen eller begge. En rettelse der svarer til det gemte
 * forsvinder igen. En ren sessionsrettelse rører ikke indsatsen (som R5's kladde).
 */
export function setDraftPass(
  draft: DraftV2,
  days: ProgramWeekDays | null | undefined,
  weekday: string,
  slot: number,
  change: { session?: string; effort?: ProgramEffort | null },
): DraftV2 {
  const key = draftKey(weekday, slot);
  const before = editOf(draft, weekday, slot);
  const session = change.session ?? before?.session ?? cellSession(days, weekday, slot);
  if (!session) return draft;
  const effortEdit = change.effort !== undefined ? change.effort : before?.effort;
  const next: Record<string, string | PassEdit> = { ...draft };
  const sameSession = cellSession(days, weekday, slot) === session;
  // En hel dag kender ingen indsats; en indsats der er den gemte, er ingen rettelse.
  const keepEffort = effortEdit !== undefined && !isWholeDaySession(session)
    && (effortEdit ?? defaultEffort(session)) !== (savedEffort(days, weekday, slot) ?? defaultEffort(session));
  if (sameSession && !keepEffort) delete next[key];
  else next[key] = keepEffort ? { session, effort: effortEdit } : session;
  return next;
}

/** "Kopier en dag": kildens felter (og rettede indsatser) til maaldagene. */
export function copyDayIntoDraftV2(
  draft: DraftV2,
  days: ProgramWeekDays | null | undefined,
  from: string,
  targets: readonly string[],
  effortLevels: boolean,
): DraftV2 {
  let next = draft;
  for (const target of targets) {
    for (let slot = 0; slot < PROGRAM_SLOTS; slot += 1) {
      const session = passSession(days, draft, from, slot);
      if (!session) continue;
      const effort = effortLevels && !isWholeDaySession(session)
        ? (() => {
          const edit = editOf(draft, from, slot);
          return edit && edit.effort !== undefined ? edit.effort : savedEffort(days, from, slot);
        })()
        : undefined;
      next = setDraftPass(next, days, target, slot, { session, ...(effort === undefined ? {} : { effort }) });
    }
  }
  return next;
}

export type DraftStepV2 = { weekday: string; slotIndex: number; session: string; effort?: ProgramEffort | null };

/** Kladden som felt-skrivninger i ugens raekkefoelge. `effort` er kun med, naar den er rettet. */
export function draftStepsV2(draft: DraftV2, weekdays: readonly string[], effortLevels: boolean): DraftStepV2[] {
  const steps: DraftStepV2[] = [];
  for (const weekday of weekdays) {
    for (let slot = 0; slot < PROGRAM_SLOTS; slot += 1) {
      const edit = editOf(draft, weekday, slot);
      if (!edit) continue;
      const withEffort = effortLevels && edit.effort !== undefined && !isWholeDaySession(edit.session);
      steps.push({ weekday, slotIndex: slot, session: edit.session, ...(withEffort ? { effort: edit.effort } : {}) });
    }
  }
  return steps;
}

// --- "Plan for" ---------------------------------------------------------------------

export const PLAN_FOR_ALL = "all";
export const PLAN_FOR_STORE = "cz-training-plan-for-v2";

/** Valget i "Plan for": en gruppe, en rytter eller "all". Ukendte valg falder tilbage. */
export function resolvePlanFor(
  stored: string | null | undefined,
  { groups, riders }: { groups: readonly { id: string }[]; riders: readonly { id: string }[] },
): string {
  const match = /^(group|rider):(.+)$/.exec(String(stored ?? ""));
  if (match) {
    const known = match[1] === "group" ? groups.some((g) => g.id === match[2]) : riders.some((r) => r.id === match[2]);
    if (known) return stored as string;
  }
  if (stored === PLAN_FOR_ALL) return PLAN_FOR_ALL;
  return groups[0] ? `group:${groups[0].id}` : PLAN_FOR_ALL;
}

/** Dagene fra i dag og frem (i dag, i morgen, de naeste dage), ugen rundt. */
export function daysFromToday(weekdays: readonly string[], todayWeekday: string): string[] {
  const start = Math.max(0, weekdays.indexOf(todayWeekday));
  return weekdays.map((_, i) => weekdays[(start + i) % weekdays.length]);
}

export type AllRidersRow = {
  id: string;
  name: string;
  group: { id: string; name: string } | null;
  // Hvor planen kommer fra: gruppen, rytterens egen (med program) eller intet.
  plan: { via: "group"; programKey: string | null } | { via: "own"; programKey: string | null } | { via: "none" };
  // Sessionerne pr. ugedag i feltraekkefoelge (tomme felter udeladt, gentagelser slaaet sammen).
  sessions: Record<string, string[]>;
};

/** Tabellen "Alle ryttere": en linje pr. rytter med gruppe, program og ugens sessioner. */
export function allRidersRows({
  riders, groups, riderWeekPlans, seeds, assigned, weekdays,
}: {
  riders: readonly R5Rider[];
  groups: readonly R5Group[];
  riderWeekPlans: Readonly<Record<string, ProgramWeekDays | null | undefined>>;
  seeds: Readonly<Record<string, ProgramWeekDays>>;
  assigned: Readonly<Record<string, string>>;
  weekdays: readonly string[];
}): AllRidersRow[] {
  const ownPlanIds = new Set(Object.keys(riderWeekPlans).filter((id) => riderWeekPlans[id] != null));
  return riders.map((rider) => {
    const group = groups.find((g) => g.members.some((m) => m.riderId === rider.id)) ?? null;
    const via = riderPlan(rider.id, { groups: groups as R5Group[], ownPlanIds, assigned });
    const groupDays = via.via === "group" ? (group?.days as ProgramWeekDays | null | undefined) ?? null : null;
    const days = groupDays ?? riderWeekDays(rider.id, riderWeekPlans, seeds, weekdays).days;
    const sessions: Record<string, string[]> = {};
    for (const weekday of weekdays) {
      const list: string[] = [];
      for (let slot = 0; slot < PROGRAM_SLOTS; slot += 1) {
        const session = cellSession(days, weekday, slot);
        if (session && !list.includes(session)) list.push(session);
      }
      sessions[weekday] = list;
    }
    const plan: AllRidersRow["plan"] = via.via === "group"
      ? { via: "group", programKey: group?.programKey ?? null }
      : via.via === "own" ? { via: "own", programKey: via.programKey } : { via: "none" };
    return { id: rider.id, name: rider.name, group: group ? { id: group.id, name: group.name } : null, plan, sessions };
  });
}

/** Emnet bag et "Plan for"-valg (null for "Alle ryttere"). */
export function planForSubject(value: string): Subject | null {
  const match = /^(group|rider):(.+)$/.exec(value);
  return match ? { kind: match[1] as Subject["kind"], id: match[2] } : null;
}
