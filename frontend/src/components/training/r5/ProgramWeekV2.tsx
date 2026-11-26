// ProgramWeekV2 — Program-fanen efter ejerens W1-design 26/11 (#7947), bag kontakten
// training_w1_v2 (sammen med training_page_r5). Ejerens fem punkter:
//   1. ugeplanen (7 dage, man-soen) for den valgte gruppe eller rytter fylder fanen. Oeverst
//      "Plan for" (grupper, ryttere og "Alle ryttere"), "Skift program" og Plantype. "Alle
//      ryttere" er en tabel med en linje pr. rytter; et klik aabner rytterens uge;
//   2. grupperne har deres egen fane (GroupsTabV2), saa den lange rytterliste er vaek herfra;
//   3. indsatsen Let/Mellem/Haard staar paa egen linje under passet som tre smaa knapper.
//      Aktiv restitution og hvile viser "Ingen indsats". Kun med training_effort_levels on;
//      slukket vises og sendes ingen indsats, praecis som i dag;
//   4. "Gem plan" er den eneste guldknap og staar fast i bunden, mens man ruller.
//      "Kopiér til ryttere" er neutral;
//   5. TASTE: ingen smaa versaler, hairlines, 5 px radius, fulde navne, ingen forkortelser.
//
// Data, kladder og gemme-kald er de samme som Program R5 (ProgramR5.tsx, som er uroert):
// felt-skrivningerne PUT .../cell, rotation, ugeblokke, gruppens program og kopiér til ryttere.
import { useEffect, useMemo, useRef, useState, type ComponentType, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../ui/Button.jsx";
import Checkbox from "../../ui/Checkbox.jsx";
import EmptyState from "../../ui/EmptyState.jsx";
import ErrorStateJs from "../../ui/ErrorState.jsx";
import Select from "../../ui/Select.jsx";
import { controlClass } from "../../ui/fieldStyles.js";
import Skeleton from "../../ui/Skeleton.jsx";
import Modal from "../../ui/Modal.jsx";
import Segmented from "../../ui/Segmented.jsx";
import { Menu, MenuItem } from "../../ui/Menu.jsx";
import { useDismiss } from "../../ui/useDismiss.js";
import { CalendarIcon, CheckIcon, ChevronDownIcon, ClipboardIcon, FlagIcon, LockIcon } from "../../ui/icons/index.jsx";
import FatigueForecast from "../FatigueForecast.tsx";
import FatigueRuleSummary from "../FatigueRuleSummary.tsx";
import FatigueRulePanel from "../FatigueRulePanel.tsx";
import { SESSION_ORDER, SESSION_ORDER_V3 } from "../TrainingPlanCard.tsx";
import GroupFatigueExceptions from "../groups/GroupFatigueExceptions.tsx";
import { groupForecastEntry } from "../groups/trainingGroupsModel.ts";
import { todayLockedSlots } from "../settleAfterStage7982/settleAfterStageModel.ts";
import { raceSlotsFor, type ForecastEntry, type ForecastResponse } from "../FatigueForecastModel.ts";
import type { FatigueRulesClient } from "../useFatigueRules.ts";
import type { TrainingGroupsClient } from "../groups/useTrainingGroups.ts";
import type { ProgramsResult } from "../useTrainingPrograms.ts";
import { sessionI18nKey } from "../../../lib/trainingDayTypes.js";
import { PROGRAM_SLOTS, programName, programTagline, type CatalogProgram, type ProgramWeekDays } from "../../../lib/trainingPrograms.ts";
import {
  availableKinds, PROGRAM_VIEW_STORE, buildLibrary, catalogWeekDays, copyCandidates, copyDayTargets,
  parseSubjectKey, programKeyOf, rememberedKind, riderPlan, riderWeekDays, subjectKey, weekCells, weekdayLong,
  weekPlacement, weekPlacementFromForecast, followAgainTarget, dropDrafts,
  type Kind, type Library, type R5Group, type R5Rider, type Subject, type WeekCell,
  type RotationPlan, type RotationWrite, type RotationDrafts, type WeekBlock, type WeekBlockDrafts, type WeekCellWrite,
} from "./programR5Model.ts";
import {
  PLAN_FOR_ALL, PLAN_FOR_STORE, PROGRAM_EFFORTS, allRidersRows, copyDayIntoDraftV2, daysFromToday, draftStepsV2,
  effortChanged, planForSubject, resolvePlanFor, setDraftPass, shownEffort, type DraftV2, type ProgramEffort,
} from "./programWeekV2Model.ts";
import { ProgramAssignmentConfirmation } from "./ProgramR5.tsx";
import RotationEditor, { type RotationPreviewDay } from "./RotationEditor.tsx";
import { useTrainingWeek } from "./useTrainingWeek.ts";
import WeekBlockEditor from "./WeekBlockEditor.tsx";

type RawRider = { id: string; firstname?: string | null; lastname?: string | null; primary_type?: string | null };
type ProgramsClient = {
  catalog: CatalogProgram[];
  assigned: Record<string, string>;
  seeds: Record<string, ProgramWeekDays>;
  busy: boolean;
  rotationEnabled?: boolean;
  weekPriorityEnabled?: boolean;
  weekPriorityPlans?: string[];
  rotations?: Record<string, RotationPlan>;
  setRotation: (id: string, write: RotationWrite) => Promise<ProgramsResult>;
  status?: "loading" | "ready" | "error";
  retry?: () => Promise<unknown> | void;
  reload?: () => Promise<unknown> | void;
  applyProgram: (programKey: string, target: string, planKind?: "week") => Promise<ProgramsResult>;
  setCell: (riderId: string, weekday: string, slotIndex: number | null, session: string, write?: WeekCellWrite) => Promise<ProgramsResult>;
};
export type ProgramRequest = { kind: "rider" | "group" | "limit" | "weekday"; id?: string; weekday?: string; n: number };

const ErrorState = ErrorStateJs as unknown as ComponentType<{ title: ReactNode; description?: ReactNode; action?: ReactNode }>;

// Sentence case-etiket (TASTE: ingen smaa versaler).
const LABEL = "text-xs font-medium text-cz-2";

function loadKind(): Kind {
  try { return rememberedKind(localStorage.getItem(PROGRAM_VIEW_STORE), availableKinds(true)); } catch { return "week"; }
}
function saveKind(kind: Kind) {
  try { localStorage.setItem(PROGRAM_VIEW_STORE, kind); } catch { /* privat vindue: valget huskes bare ikke */ }
}
function loadPlanFor(): string | null {
  try { return localStorage.getItem(PLAN_FOR_STORE); } catch { return null; }
}
function savePlanFor(value: string) {
  try { localStorage.setItem(PLAN_FOR_STORE, value); } catch { /* privat vindue: valget huskes bare ikke */ }
}

export default function ProgramWeekV2({
  riders: rawRiders, weekdays, todayWeekday, todayLocked, riderWeekPlans, programs, groups, forecast, fatigueRules,
  catalogV3, mobile, onClearRider, drafts, onDrafts: setDrafts, request = null, onRequestHandled,
  effortLevels = false, rotationDrafts, setRotationDrafts, weekDrafts, setWeekDrafts, onOpenGroups,
}: {
  riders: RawRider[];
  weekdays: readonly string[];
  todayWeekday: string;
  todayLocked: boolean;
  riderWeekPlans: Record<string, ProgramWeekDays | null | undefined>;
  programs: ProgramsClient;
  groups: TrainingGroupsClient;
  forecast: ForecastResponse | null;
  fatigueRules: FatigueRulesClient;
  catalogV3: boolean;
  // Sidehovedets plads (R5) bruges ikke: Gem plan staar fast i bunden af fanen.
  actionsEl?: HTMLElement | null;
  mobile: boolean;
  effortLevels?: boolean;
  rotationDrafts: RotationDrafts;
  setRotationDrafts: Dispatch<SetStateAction<RotationDrafts>>;
  weekDrafts: WeekBlockDrafts;
  setWeekDrafts: Dispatch<SetStateAction<WeekBlockDrafts>>;
  onClearRider: (riderId: string) => Promise<{ ok: boolean }>;
  drafts: Record<string, DraftV2>;
  onDrafts: Dispatch<SetStateAction<Record<string, DraftV2>>>;
  request?: ProgramRequest | null;
  onRequestHandled?: () => void;
  // Grupper-fanen (oprettelse og medlemmer bor dér).
  onOpenGroups?: () => void;
}) {
  const { t, i18n } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5");
  const tTypes = useTranslation("riderTypes").t;
  const lang = i18n.language;

  const riders: R5Rider[] = useMemo(() => [...rawRiders]
    .sort((a, b) => `${a.lastname ?? ""} ${a.firstname ?? ""}`.localeCompare(`${b.lastname ?? ""} ${b.firstname ?? ""}`))
    .map((r) => ({ id: r.id, name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(), type: r.primary_type ?? null })), [rawRiders]);
  const riderById = useMemo(() => new Map(riders.map((r) => [r.id, r])), [riders]);
  const groupList: R5Group[] = useMemo(() => (groups.enabled ? groups.groups : []), [groups.enabled, groups.groups]);
  const ownPlanIds = useMemo(
    () => new Set(Object.keys(riderWeekPlans).filter((id) => riderWeekPlans[id] != null)),
    [riderWeekPlans],
  );
  const library: Library = useMemo(() => buildLibrary({
    catalog: programs.catalog, groups: groupList, riders, ownPlanIds, assigned: programs.assigned,
  }), [programs.catalog, groupList, riders, ownPlanIds, programs.assigned]);

  const [storedKind, setKindRaw] = useState<Kind>(loadKind);
  const kinds = availableKinds(programs.rotationEnabled === true);
  const kind = rememberedKind(storedKind, kinds);
  const isRotation = kind === "rotation";
  const weekPriority = programs.weekPriorityEnabled === true;
  const { week: trainingWeek, reload: reloadTrainingWeek } = useTrainingWeek({ enabled: isRotation || weekPriority });
  const setKind = (next: Kind) => { setKindRaw(next); saveKind(next); };

  const [rawPlanFor, setRawPlanFor] = useState<string | null>(loadPlanFor);
  const planFor = resolvePlanFor(rawPlanFor, { groups: groupList, riders });
  const setPlanFor = (value: string) => { setRawPlanFor(value); savePlanFor(value); setNote(null); };
  const subject: Subject | null = planForSubject(planFor);
  const showAll = planFor === PLAN_FOR_ALL;

  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [putTarget, setPutTarget] = useState<string | null>(null); // programnoeglen der bekraeftes
  const [dialogError, setDialogError] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const dayRefs = useRef<Record<string, HTMLElement | null>>({});
  const [focusDay, setFocusDay] = useState<{ weekday: string; n: number } | null>(null);

  // Anmodninger fra I dag (og Grupper-fanen): aabn en rytters/gruppes uge, en ugedag eller graensen.
  const handledRequest = useRef(0);
  useEffect(() => {
    if (!request || request.n === handledRequest.current) return;
    handledRequest.current = request.n;
    onRequestHandled?.();
    if (request.kind === "limit") { setLimitOpen(true); return; }
    if (request.kind === "weekday") { if (request.weekday) setFocusDay({ weekday: request.weekday, n: request.n }); return; }
    if (!request.id) return;
    setRawPlanFor(`${request.kind}:${request.id}`);
    savePlanFor(`${request.kind}:${request.id}`);
  }, [request, onRequestHandled]);
  useEffect(() => {
    if (!focusDay) return;
    dayRefs.current[focusDay.weekday]?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [focusDay]);

  const sKey = subjectKey(subject);
  const programKey = subject ? programKeyOf(subject, library) : null;
  const program = programs.catalog.find((p) => p.key === programKey) ?? null;
  const busy = programs.busy || groups.busy || saving;
  const draft: DraftV2 = drafts[sKey] ?? {};
  const total = Object.values(drafts).reduce((sum, d) => sum + Object.keys(d).length, 0);

  // Ugen der vises: gruppens felter, rytterens egne (eller saaede).
  const group = subject?.kind === "group" ? groupList.find((g) => g.id === subject.id) ?? null : null;
  const riderDays = subject?.kind === "rider" ? riderWeekDays(subject.id, riderWeekPlans, programs.seeds, weekdays) : null;
  const days: ProgramWeekDays | null = group
    ? (group.days as ProgramWeekDays | null) ?? null
    : riderDays ? riderDays.days : catalogWeekDays(program);
  const editable = !!subject && !!days;
  const memberIds = group ? group.members.filter((m) => m.followsGroup).map((m) => m.riderId) : [];
  // En gruppes felt i dag er kun loeb/laast naar ALLE dens ryttere har det (regel A, som R5).
  const slotSet = (fn: (id: string) => ReadonlySet<number>) => {
    if (subject?.kind === "rider") return fn(subject.id);
    if (!memberIds.length) return new Set<number>();
    const sets = memberIds.map(fn);
    return new Set([...sets[0]].filter((slot) => sets.every((s) => s.has(slot))));
  };
  const raceToday = slotSet((id) => raceSlotsFor(forecast, id));
  const pendingToday = slotSet((id) => new Set(forecast?.riders?.[id]?.pendingSlots ?? []));
  const lockedToday = slotSet((id) => todayLockedSlots(forecast, id));
  const weekDayDrafts = weekDrafts[sKey] ?? {};
  const gridDays = days && weekPriority ? {
    ...days,
    ...Object.fromEntries(Object.entries(weekDayDrafts).map(([day, block]) => [day, { ...days[day], ...block }])),
  } : days;
  const settledToday = subject?.kind === "rider" ? forecast?.weekPrioritySettled?.[subject.id] : undefined;
  const riderForecast = subject?.kind === "rider" ? forecast?.riders?.[subject.id] : undefined;
  const savedPlacement = weekPriority ? weekPlacementFromForecast(riderForecast) : null;
  const racesFor = (weekday: string) => {
    if (weekday === todayWeekday) {
      const settledRaces = Object.entries(settledToday ?? {}).flatMap(([slot, source]) => source === null ? [Number(slot)] : []);
      return [...new Set([...raceToday, ...settledRaces, ...(savedPlacement ? riderForecast?.raceSlots ?? [] : [])])];
    }
    if (subject?.kind !== "rider") return [];
    const future = trainingWeek?.days.find((entry) => entry.weekday === weekday);
    return future?.riders?.[subject.id]?.raceSlots ?? [];
  };
  const priorityActive = weekPriority && (subject?.kind === "group" ? groups.groups.find((g) => g.id === subject.id)?.planKind === "week"
    : subject?.kind === "rider" && programs.weekPriorityPlans?.includes(subject.id));
  const placements = weekPriority ? Object.fromEntries(weekdays.flatMap((weekday) => {
    if (weekday === todayWeekday && savedPlacement && (!weekDayDrafts[weekday] || savedPlacement.restSlots?.length === PROGRAM_SLOTS)) {
      return [[weekday, savedPlacement]];
    }
    if (!priorityActive && !weekDayDrafts[weekday]) return [];
    const placement = weekPlacement(gridDays?.[weekday]?.lockSlot ?? null, racesFor(weekday), weekday === todayWeekday ? settledToday : undefined);
    const restSlots = weekday === todayWeekday ? savedPlacement?.restSlots : undefined;
    return [[weekday, restSlots?.length
      ? { ...placement, restSlots, fieldSource: placement.fieldSource.map((source, slot) => restSlots.includes(slot) ? null : source) }
      : placement]];
  })) : {};
  // R5's celle-model kender kun sessionen; indsatsen laeses ved siden af (programWeekV2Model).
  const sessionDraft = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, typeof value === "string" ? value : value.session]));
  const cells = weekCells({ days: gridDays, draft: sessionDraft, weekdays, todayWeekday, raceToday, pendingToday, lockedToday, placements });
  const tonight = (subject?.kind === "rider"
    ? forecast?.riders?.[subject.id] ?? null
    : groupForecastEntry(forecast?.riders, memberIds)) as ForecastEntry | null;

  const sessionLabel = (session: string) => (session === "rest" || session === "recovery"
    ? t(`dayPanel.dayType_${session}`)
    : t(sessionI18nKey("dayPanel.session", session)));
  const sessionOrder: readonly string[] = catalogV3 ? SESSION_ORDER_V3 : SESSION_ORDER;
  const dayName = (weekday: string) => weekdayLong(weekday, lang) || t(`weekday_${weekday}`);
  const subjectName = (s: Subject) => (s.kind === "group"
    ? groupList.find((g) => g.id === s.id)?.name ?? ""
    : riderById.get(s.id)?.name ?? "");
  const programLabel = (key: string | null) => {
    const p = programs.catalog.find((c) => c.key === key);
    return p ? programName(p, lang) : tR5("programR5.ownWeek");
  };

  // --- Rotation (uaendret fra R5) -----------------------------------------------------
  const storedRotation = subject?.kind === "rider" ? programs.rotations?.[subject.id]
    : subject?.kind === "group" ? groups.groups.find((item) => item.id === subject.id) : null;
  const rotationDraft = rotationDrafts[sKey];
  const rotationPasses = rotationDraft?.passes ?? storedRotation?.rotation?.passes
    ?? [{ session: sessionOrder[0] ?? "rest" }, { session: sessionOrder[0] ?? "rest" }];
  const rotationDirty = Boolean(subject && (rotationDraft || storedRotation?.planKind !== "rotation"));
  const blockTotal = weekPriority ? Object.values(weekDrafts).reduce((count, blocks) => count + Object.keys(blocks).length, 0) : 0;
  const switchToWeek = programs.rotationEnabled === true && storedRotation?.planKind === "rotation";
  const activeTotal = isRotation ? Number(rotationDirty) : total + blockTotal + Number(switchToWeek && total + blockTotal === 0);
  const canCopy = isRotation ? Boolean(subject && rotationPasses.length >= 2) : Boolean(program);
  const writeRotation = (target: Subject, change: RotationWrite) => target.kind === "group"
    ? groups.setRotation(target.id, change) : programs.setRotation(target.id, change);
  const clearRotationDraft = () => setRotationDrafts((prev) => {
    const next = { ...prev };
    delete next[sKey];
    return next;
  });
  const saveRotation = async () => {
    if (!subject) return;
    setSaving(true);
    try {
      const result = await writeRotation(subject, {
        planKind: "rotation",
        ...(rotationDraft?.passes || !storedRotation?.rotation ? { passes: rotationPasses } : {}),
        ...(rotationDraft?.startIndex == null ? {} : { startIndex: rotationDraft.startIndex }),
      });
      if (result.ok) {
        clearRotationDraft();
        await Promise.all([groups.reload(), reloadTrainingWeek(), subject.kind === "group" ? programs.reload?.() : undefined]);
      }
      setNote(result.ok ? { tone: "ok", text: tR5("programR5.saved") } : { tone: "error", text: tR5("programR5.saveError") });
    } finally {
      setSaving(false);
    }
  };
  const rotationPreview: RotationPreviewDay[] = subject?.kind === "rider"
    ? (trainingWeek?.days ?? []).slice(0, 7).map((day) => ({
      date: day.date, label: dayName(day.weekday), ...(day.today?.riders ?? day.riders)?.[subject.id],
    }))
    : [];
  const rotationNext = subject?.kind === "rider" ? trainingWeek?.days[6]?.riders?.[subject.id]?.nextRotationIndex : undefined;
  const rotationEditor = subject ? (
    <RotationEditor
      passes={rotationPasses}
      sessionLabel={sessionLabel}
      sessionOrder={sessionOrder}
      effortLevels={effortLevels}
      disabled={busy}
      mobile={mobile}
      startIndex={rotationDraft?.startIndex ?? null}
      preview={rotationPreview}
      nextIndex={rotationNext}
      canJump={subject.kind === "rider"}
      onPasses={(passes) => setRotationDrafts((prev) => ({
        ...prev, [sKey]: { passes, startIndex: prev[sKey]?.startIndex != null && prev[sKey].startIndex < passes.length ? prev[sKey].startIndex : undefined },
      }))}
      onJump={(index) => {
        if (index === null && !rotationDraft?.passes) { clearRotationDraft(); return; }
        setRotationDrafts((prev) => ({ ...prev, [sKey]: { ...prev[sKey], startIndex: index ?? undefined } }));
      }}
    />
  ) : null;
  const weekBlockEditor = weekPriority && editable && days ? (
    <WeekBlockEditor
      key={sKey}
      dayKeys={weekdays} today={todayWeekday} closed={todayLocked} days={days}
      draft={sessionDraft} changes={weekDayDrafts} disabled={busy}
      dayLabel={dayName} sessionLabel={sessionLabel}
      racesFor={racesFor} placements={placements}
      onChange={(day, block) => {
        setWeekDrafts((prev) => ({ ...prev, [sKey]: { ...prev[sKey], [day]: block } }));
        setDrafts((prev) => ({
          ...prev,
          [sKey]: Object.fromEntries(Object.entries(prev[sKey] ?? {}).filter(([key]) => !key.startsWith(`${day}:`))),
        }));
      }}
    />
  ) : null;

  // --- Kladden --------------------------------------------------------------------------
  const editPass = (weekday: string, slot: number, change: { session?: string; effort?: ProgramEffort | null }) => {
    const sourceSlot = placements[weekday]?.fieldSource[slot] ?? slot;
    setDrafts((prev) => ({ ...prev, [sKey]: setDraftPass(prev[sKey] ?? {}, gridDays, weekday, sourceSlot, change) }));
  };
  const copyDay = (from: string, choice: string) => {
    const targets = copyDayTargets(from, choice, weekdays, { todayWeekday, todayLocked });
    setDrafts((prev) => ({ ...prev, [sKey]: copyDayIntoDraftV2(prev[sKey] ?? {}, gridDays, from, targets, effortLevels) }));
  };

  // Gem plan: hver rettelse er en felt-skrivning til den eksisterende API (rytter eller gruppe).
  // Indsatsen sendes kun, naar den er rettet og training_effort_levels er on.
  const savePlan = async () => {
    setSaving(true);
    let failed = false;
    let groupChanged = false;
    const saveCell = async (target: Subject, weekday: string, slotIndex: number, session: string, write?: WeekCellWrite) => {
      if (target.kind !== "group") return programs.setCell(target.id, weekday, slotIndex, session, write);
      const result = await groups.setCell(target.id, weekday, slotIndex, session, write);
      if (result.ok) groupChanged = true;
      return result;
    };
    const markWeek = weekPriority || programs.rotationEnabled ? { planKind: "week" as const } : undefined;
    const unsavedDays: Record<string, Record<string, WeekBlock>> = {};
    if (weekPriority) for (const [key, blocks] of Object.entries(weekDrafts)) {
      const target = parseSubjectKey(key);
      if (!target) continue;
      for (const [weekday, block] of Object.entries(blocks)) {
        const result = await saveCell(target, weekday, 0, block.slots[0], { planKind: "week", weekBlock: block });
        if (!result.ok) {
          failed = true;
          (unsavedDays[key] ??= {})[weekday] = block;
        }
      }
    }
    const left: Record<string, DraftV2> = {};
    for (const [key, d] of Object.entries(drafts)) {
      const target = parseSubjectKey(key);
      if (!target) continue;
      const rest: Record<string, DraftV2[string]> = { ...d };
      for (const step of draftStepsV2(d, weekdays, effortLevels)) {
        if (unsavedDays[key]?.[step.weekday]) continue;
        const write = step.effort === undefined ? markWeek : ({ ...markWeek, effort: step.effort } as WeekCellWrite);
        const result = await saveCell(target, step.weekday, step.slotIndex, step.session, write);
        if (!result.ok) { failed = true; break; }
        delete rest[`${step.weekday}:${step.slotIndex}`];
      }
      if (Object.keys(rest).length) left[key] = rest;
    }
    const savedSubjectFields = Object.keys(drafts[sKey] ?? {}).length > 0
      || (weekPriority && Object.keys(weekDrafts[sKey] ?? {}).length > 0);
    if (switchToWeek && subject && !failed && !savedSubjectFields) {
      failed = !(await writeRotation(subject, { planKind: "week" })).ok;
      if (!failed && subject.kind === "group") groupChanged = true;
    }
    if ([...Object.keys(drafts), ...Object.keys(weekDrafts)].some((key) => parseSubjectKey(key)?.kind === "rider")) await groups.reload();
    setDrafts(left);
    setWeekDrafts(unsavedDays);
    await Promise.all([groupChanged ? programs.reload?.() : undefined, weekPriority ? reloadTrainingWeek() : undefined]);
    setSaving(false);
    setNote(failed ? { tone: "error", text: tR5("programR5.saveError") } : { tone: "ok", text: tR5("programR5.saved") });
  };

  const discardDrafts = () => {
    if (isRotation) clearRotationDraft();
    else { setDrafts({}); setWeekDrafts({}); }
    setDiscardOpen(false);
    setNote(null);
  };

  // --- Skift program: programmet paa den valgte gruppe eller rytter -----------------------
  const putProgram = async () => {
    if (!subject || !putTarget || busy) return;
    setSaving(true);
    setDialogError(false);
    try {
      const planKind = programs.rotationEnabled || weekPriority ? "week" : undefined;
      const result = subject.kind === "group"
        ? await groups.putProgram(subject.id, putTarget, planKind)
        : await programs.applyProgram(putTarget, subject.id, planKind);
      if (subject.kind === "rider") await groups.reload();
      if (!result.ok) { setDialogError(true); return; }
      // Den nye uge erstatter den gamle; kladder til den gamle uge gaelder ikke laengere.
      setDrafts((prev) => dropDrafts(prev, [sKey]));
      setWeekDrafts((prev) => dropDrafts(prev, [sKey]));
      setPutTarget(null);
      setChangeOpen(false);
      setNote({ tone: "ok", text: tR5("programR5.saved") });
    } catch {
      setDialogError(true);
    } finally {
      setSaving(false);
    }
  };

  const riderSource = subject?.kind === "rider"
    ? riderPlan(subject.id, { groups: groupList, ownPlanIds, assigned: programs.assigned })
    : null;
  const canRemoveOwn = subject?.kind === "rider" && riderSource?.via === "own" && ownPlanIds.has(subject.id);
  const removeOwnPlan = async () => {
    if (subject?.kind !== "rider") return;
    setSaving(true);
    try {
      const result = await onClearRider(subject.id);
      await groups.reload();
      setDrafts((prev) => dropDrafts(prev, [sKey]));
      setNote(result.ok ? null : { tone: "error", text: tR5("programR5.saveError") });
    } finally {
      setSaving(false);
    }
  };

  const follow = groups.enabled ? followAgainTarget(subject, groupList) : null;
  const followAgain = async () => {
    if (!follow) return;
    const result = await groups.follow(follow.groupId, follow.riderIds);
    if (!result.ok) { setNote({ tone: "error", text: tR5("programR5.saveError") }); return; }
    const keys = follow.riderIds.map((id) => subjectKey({ kind: "rider", id }));
    setDrafts((prev) => dropDrafts(prev, keys));
    setRotationDrafts((prev) => dropDrafts(prev, keys));
    setWeekDrafts((prev) => dropDrafts(prev, keys));
    await Promise.all([programs.reload?.(), reloadTrainingWeek()]);
    setNote(null);
  };

  // --- Tilstande: henter / fejl ---------------------------------------------------------
  const status = programs.status ?? "ready";
  if (status !== "ready") {
    return (
      <div data-testid="program-w1" data-state={status}>
        {status === "loading" ? <ProgramWeekSkeleton /> : (
          <ErrorState
            title={tR5("programR5.loadErrorTitle")}
            description={tR5("programR5.loadErrorBody")}
            action={(
              <Button variant="secondary" size="sm" className="min-h-11" onClick={() => { void programs.retry?.(); }} data-testid="program-w1-retry">
                {tR5("programR5.retry")}
              </Button>
            )}
          />
        )}
      </div>
    );
  }

  const nothingYet = library.groups.length === 0 && library.ownOnly.length === 0 && !library.programs.some((p) => p.inUse);
  const rows = allRidersRows({
    riders, groups: groupList, riderWeekPlans, seeds: programs.seeds, assigned: programs.assigned, weekdays,
  });

  // --- Oeverst: Plan for · Skift program · Plantype ---------------------------------------
  const toolbar = (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2" data-testid="program-w1-toolbar">
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>{t("weekPlan.planFor")}</span>
        <Select
          size="sm"
          value={planFor}
          onChange={(e: { target: { value: string } }) => setPlanFor(e.target.value)}
          className="min-h-11 w-auto min-w-56 max-w-full font-semibold"
          data-testid="program-w1-plan-for"
        >
          <option value={PLAN_FOR_ALL}>{tR5("programW1.allRiders")}</option>
          {groupList.length > 0 && (
            <optgroup label={tR5("programR5.groups")}>
              {groupList.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}
            </optgroup>
          )}
          <optgroup label={tR5("programR5.riders")}>
            {riders.map((r) => <option key={r.id} value={`rider:${r.id}`}>{r.name}</option>)}
          </optgroup>
        </Select>
      </label>
      {subject && (
        <Button variant="secondary" size="md" className="min-h-11" disabled={busy || programs.catalog.length === 0}
          onClick={() => { setDialogError(false); setPutTarget(null); setChangeOpen(true); }} data-testid="program-w1-change-program">
          {tR5("programR5.phone.changeProgram")}
        </Button>
      )}
      {subject && kinds.length > 1 && (
        <span className="flex flex-col gap-1">
          <span className={LABEL}>{tR5("programR5.kindLabel")}</span>
          <Segmented label={tR5("programR5.kindLabel")} value={kind} onChange={setKind}
            options={kinds.map((k) => ({ value: k, label: tR5(`programR5.kind_${k}`) }))} />
        </span>
      )}
    </div>
  );

  // Een linje kontekst under vaerktoejslinjen: program, type, egen plan, foelg igen.
  const riderType = subject?.kind === "rider" ? riderById.get(subject.id)?.type : null;
  const context = subject ? (
    <div className="flex flex-col gap-1" data-testid="program-w1-context">
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-cz-2">
        <span className="font-semibold text-cz-1">{programLabel(programKey)}</span>
        {program && <span>{programTagline(program, lang)}</span>}
        {riderType && <span>{tTypes(`types.${riderType}`)}</span>}
      </p>
      {riderDays?.isSeed && <p className="text-2xs text-cz-3">{t("programs.seededHint")}</p>}
      {(follow || canRemoveOwn) && (
        <p className="flex flex-wrap items-center gap-x-3 text-2xs text-cz-2">
          {follow && subject.kind === "rider" && <span>{tR5("programR5.manage.ownPlanOf", { name: follow.groupName })}</span>}
          {follow && (
            <button type="button" disabled={busy} onClick={followAgain} data-testid="program-w1-follow-again"
              className="inline-flex min-h-11 items-center text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50 sm:min-h-0">
              {subject.kind === "group"
                ? tR5("programR5.manage.followAgainAll", { n: follow.riderIds.length })
                : tR5("programR5.manage.followAgain")}
            </button>
          )}
          {canRemoveOwn && !follow && (
            <button type="button" disabled={busy} onClick={removeOwnPlan} data-testid="program-w1-remove-own"
              className="inline-flex min-h-11 items-center text-xs font-medium text-cz-1 underline underline-offset-2 disabled:opacity-50 sm:min-h-0">
              {tR5("programW1.removeOwnPlan")}
            </button>
          )}
        </p>
      )}
    </div>
  ) : null;

  const emptyEl = nothingYet && showAll ? (
    <EmptyState
      icon={<CalendarIcon size={26} aria-hidden="true" />}
      title={tR5("programR5.emptyTitle")}
      description={tR5(groups.enabled ? "programR5.emptyBody" : "programR5.emptyBodyNoGroups")}
      action={groups.enabled && onOpenGroups ? (
        <Button variant="secondary" size="sm" className="min-h-11" onClick={onOpenGroups} data-testid="program-w1-empty-groups">
          {tR5("programR5.manage.newGroup")}
        </Button>
      ) : null}
    />
  ) : null;

  const tonightEl = tonight ? <FatigueForecast entry={tonight} settled={forecast?.settled === true} label="" /> : null;
  const limitEl = fatigueRules.enabled ? (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card [&>div]:border-t-0">
      <FatigueRuleSummary data={fatigueRules.data} onEdit={() => setLimitOpen((v) => !v)} />
      {limitOpen && (
        <div className="border-t border-cz-border p-4">
          <FatigueRulePanel rules={fatigueRules} groupExceptions={groups.enabled && groups.groups.length > 0
            ? <GroupFatigueExceptions groups={groups.groups} busy={groups.busy} onSave={groups.setFatigue} />
            : null} />
        </div>
      )}
    </div>
  ) : null;

  const noteEl = note ? (
    <p role="status" className={`text-xs ${note.tone === "ok" ? "text-cz-success" : "text-cz-danger"}`}>{note.text}</p>
  ) : null;

  // --- Gem-linjen: fast i bunden, sidens eneste guldknap -----------------------------------
  const saveBar = (
    <div className={`sticky bottom-(--cz-mobile-nav-offset,0px) z-sticky mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-cz-border bg-cz-card py-3 ${mobile ? "-mx-4 px-4" : "px-3"}`}
      data-testid="program-w1-savebar">
      {activeTotal > 0 && (
        <span className="me-auto font-data text-xs tabular-nums text-cz-2" data-testid="program-w1-unsaved">{t("weekPlan.unsaved", { n: activeTotal })}</span>
      )}
      {activeTotal > 0 && (
        <Button variant="secondary" size="md" className="min-h-11" disabled={busy} onClick={() => setDiscardOpen(true)} data-testid="program-w1-discard">
          {tR5("programR5.discard")}
        </Button>
      )}
      <Button variant="secondary" size="md" className="min-h-11" disabled={!canCopy || busy} onClick={() => setCopyOpen(true)}
        title={canCopy ? undefined : tR5("programW1.copyNeedsProgram")} data-testid="program-w1-copy">
        {tR5("programR5.copyToRiders")}
      </Button>
      <Button variant="primary" size="md" className={`min-h-11 ${mobile ? "flex-1" : ""}`} disabled={activeTotal === 0 || busy}
        onClick={isRotation ? saveRotation : savePlan} data-testid="program-w1-save">
        {saving ? t("loading") : tR5("programR5.savePlan")}
      </Button>
    </div>
  );

  const week = subject && !isRotation ? (
    <WeekV2
      cells={cells}
      weekdays={weekdays}
      todayWeekday={todayWeekday}
      todayLocked={todayLocked}
      raceCount={raceToday.size}
      editable={editable && !busy}
      mobile={mobile}
      sessionOrder={sessionOrder}
      sessionLabel={sessionLabel}
      dayName={dayName}
      effortLevels={effortLevels}
      effortFor={(weekday, slot) => shownEffort(gridDays, draft, weekday, placements[weekday]?.fieldSource[slot] ?? slot)}
      effortDirty={(weekday, slot) => effortChanged(draft, weekday, placements[weekday]?.fieldSource[slot] ?? slot)}
      tonight={tonightEl}
      dayRef={(weekday, el) => { dayRefs.current[weekday] = el; }}
      onEdit={editPass}
      onCopyDay={copyDay}
    />
  ) : null;

  const copyRotationCandidates = riders.filter((rider) => rider.id !== subject?.id);
  const copyModal = copyOpen && canCopy ? (
    <CopyToRidersV2
      name={isRotation ? tR5("programR5.kind_rotation") : programName(program!, lang)}
      rotation={isRotation}
      candidates={isRotation ? copyRotationCandidates : copyCandidates(program!.key, library, riders)}
      busy={busy}
      saving={saving}
      onClose={() => { if (!saving) setCopyOpen(false); }}
      onCopy={async (ids, keepPlace) => {
        if (busy) return;
        setSaving(true);
        let done = 0;
        try {
          for (const id of ids) {
            const result = isRotation
              ? await programs.setRotation(id, { planKind: "rotation", passes: rotationPasses, keepPlace })
              : await programs.applyProgram(program!.key, id, programs.rotationEnabled || weekPriority ? "week" : undefined);
            if (result.ok) done += 1;
          }
          await groups.reload();
          setNote(done === ids.length
            ? { tone: "ok", text: tR5("programR5.copyDone", { n: done }) }
            : { tone: "error", text: tR5("programR5.saveError") });
        } catch {
          setNote({ tone: "error", text: tR5("programR5.saveError") });
        } finally {
          setCopyOpen(false);
          setSaving(false);
        }
      }}
    />
  ) : null;

  const changeModal = changeOpen && subject ? (
    putTarget ? (
      <ProgramAssignmentConfirmation
        name={programLabel(putTarget)}
        target={subject.kind === "group" ? { group: subjectName(subject) } : { riders: [{ id: subject.id, name: subjectName(subject) }] }}
        busy={busy}
        saving={saving}
        error={dialogError}
        actionId="program-w1-change-confirm"
        onClose={() => { if (!saving) setPutTarget(null); }}
        onConfirm={putProgram}
      />
    ) : (
      <ChangeProgramDialog
        name={subjectName(subject)}
        library={library}
        catalog={programs.catalog}
        current={programKey}
        lang={lang}
        riderName={(id) => riderById.get(id)?.name ?? ""}
        onClose={() => setChangeOpen(false)}
        onPick={(key) => { setDialogError(false); setPutTarget(key); }}
      />
    )
  ) : null;

  const discardModal = discardOpen ? (
    <Modal
      open
      onClose={() => setDiscardOpen(false)}
      size="sm"
      title={tR5("programR5.discardTitle", { n: activeTotal })}
      titleId="program-w1-discard-title"
      ariaLabelledby={undefined}
      description={null}
      closeLabel={tR5("programR5.cancel")}
      footer={(
        <>
          <Button variant="secondary" className="min-h-11" onClick={() => setDiscardOpen(false)}>{tR5("programR5.cancel")}</Button>
          <Button variant="danger" className="min-h-11" onClick={discardDrafts} data-testid="program-w1-discard-go">{tR5("programR5.discardGo")}</Button>
        </>
      )}
    >
      <p className="text-xs text-cz-2">{tR5("programR5.discardBody")}</p>
    </Modal>
  ) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="program-w1">
      {toolbar}
      {emptyEl}
      {showAll ? (
        <AllRidersTable
          rows={rows}
          weekdays={weekdays}
          todayWeekday={todayWeekday}
          mobile={mobile}
          forecast={forecast}
          sessionLabel={sessionLabel}
          dayName={dayName}
          programLabel={programLabel}
          onOpen={(id) => setPlanFor(`rider:${id}`)}
        />
      ) : (
        <section className="flex flex-col gap-3" aria-label={subject ? tR5("programW1.weekFor", { name: subjectName(subject) }) : undefined}>
          {context}
          {isRotation ? rotationEditor : week}
          {!isRotation && weekBlockEditor}
          {subject && (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-cz-3">
              <span className="inline-flex items-center gap-1"><FlagIcon size={10} aria-hidden="true" />{tR5("programR5.legendRace")}</span>
              {!isRotation && <span>{tR5("programR5.legendTaken")}</span>}
              <span className="inline-flex items-center gap-1" data-testid="program-w1-today-lock">
                <LockIcon size={10} aria-hidden="true" />{tR5("programR5.todayLock")}
              </span>
            </p>
          )}
        </section>
      )}
      {limitEl}
      {noteEl}
      {saveBar}
      {copyModal}
      {changeModal}
      {discardModal}
    </div>
  );
}

// --- Ugen: 7 dage, hvert pas med sin indsats paa linjen under ------------------------------

function WeekV2({
  cells, weekdays, todayWeekday, todayLocked, raceCount, editable, mobile, sessionOrder, sessionLabel, dayName,
  effortLevels, effortFor, effortDirty, tonight, dayRef, onEdit, onCopyDay,
}: {
  cells: WeekCell[][];
  weekdays: readonly string[];
  todayWeekday: string;
  todayLocked: boolean;
  raceCount: number;
  editable: boolean;
  mobile: boolean;
  sessionOrder: readonly string[];
  sessionLabel: (s: string) => string;
  dayName: (w: string) => string;
  effortLevels: boolean;
  effortFor: (weekday: string, slot: number) => ProgramEffort | null;
  effortDirty: (weekday: string, slot: number) => boolean;
  tonight: ReactNode;
  dayRef: (weekday: string, el: HTMLElement | null) => void;
  onEdit: (weekday: string, slot: number, change: { session?: string; effort?: ProgramEffort | null }) => void;
  onCopyDay: (from: string, choice: string) => void;
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5");
  return (
    <div
      className={mobile
        ? "flex flex-col gap-3"
        : "grid grid-cols-7 overflow-hidden rounded-cz border border-cz-border bg-cz-card"}
      data-testid="program-w1-week"
    >
      {weekdays.map((weekday, dayIndex) => {
        const isToday = weekday === todayWeekday;
        const locked = todayLocked && isToday;
        return (
          <section
            key={weekday}
            ref={(el) => dayRef(weekday, el)}
            aria-label={dayName(weekday)}
            data-testid="program-w1-day"
            data-weekday={weekday}
            className={mobile
              ? "overflow-hidden rounded-cz border border-cz-border bg-cz-card"
              : `flex min-w-0 flex-col ${dayIndex > 0 ? "border-s border-cz-border" : ""}`}
          >
            <header className="flex min-h-11 items-center gap-1 border-b border-cz-border bg-cz-subtle px-2.5 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-cz-1">{dayName(weekday)}</span>
                {isToday && (
                  <span className="flex items-center gap-1 text-2xs text-cz-2">
                    {locked && <LockIcon size={10} aria-hidden="true" />}
                    {t("weekPlan.today")}
                    {raceCount > 0 && <span className="font-data tabular-nums">· {tR5("programR5.races", { n: raceCount })}</span>}
                  </span>
                )}
              </span>
              {editable && (
                <CopyDayMenuV2
                  align={mobile || dayIndex < Math.ceil(weekdays.length / 2) ? "start" : "end"}
                  label={tR5("programR5.copyDay", { day: dayName(weekday) })}
                  options={[
                    { value: "all", label: tR5("programR5.copyAll") },
                    ...weekdays.filter((w) => w !== weekday && !(todayLocked && w === todayWeekday)).map((w) => ({ value: w, label: dayName(w) })),
                  ]}
                  onPick={(choice) => onCopyDay(weekday, choice)}
                />
              )}
            </header>
            <ol className="flex flex-1 flex-col">
              {Array.from({ length: PROGRAM_SLOTS }, (_, slot) => (
                <PassV2
                  key={slot}
                  cell={cells[dayIndex][slot]}
                  slot={slot}
                  dayName={dayName(weekday)}
                  editable={editable && !locked}
                  mobile={mobile}
                  sessionOrder={sessionOrder}
                  sessionLabel={sessionLabel}
                  effortLevels={effortLevels}
                  effort={effortFor(weekday, slot)}
                  effortDirty={effortDirty(weekday, slot)}
                  onSession={(session) => onEdit(weekday, slot, { session })}
                  onEffort={(effort) => onEdit(weekday, slot, { effort })}
                />
              ))}
            </ol>
            {isToday && tonight && (
              <div className="flex flex-col gap-0.5 border-t border-cz-border px-2.5 py-2">
                <span className="text-2xs text-cz-3">{t("forecast.label")}</span>
                {tonight}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PassV2({
  cell, slot, dayName, editable, mobile, sessionOrder, sessionLabel, effortLevels, effort, effortDirty, onSession, onEffort,
}: {
  cell: WeekCell;
  slot: number;
  dayName: string;
  editable: boolean;
  mobile: boolean;
  sessionOrder: readonly string[];
  sessionLabel: (s: string) => string;
  effortLevels: boolean;
  effort: ProgramEffort | null;
  effortDirty: boolean;
  onSession: (session: string) => void;
  onEffort: (effort: ProgramEffort) => void;
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5");
  const raceDay = tR5("programW1.raceDay", { n: slot + 1 });
  const label = `${dayName} · ${raceDay}`;
  const row = `flex flex-col gap-1 px-2.5 py-2 ${slot > 0 ? "border-t border-cz-border" : ""}`;
  const head = <span className="text-2xs text-cz-3">{raceDay}</span>;

  if (cell.kind === "race") {
    return (
      <li className={`${row} bg-cz-subtle`} data-testid={cell.pending ? "program-w1-pending" : "program-w1-race"}>
        {head}
        <span className="inline-flex min-h-11 items-center gap-1 text-xs text-cz-2 sm:min-h-9">
          <FlagIcon size={11} aria-hidden="true" className="shrink-0" />
          {cell.pending ? t("dailyReceipt.status.pending") : tR5("programR5.race")}
        </span>
      </li>
    );
  }
  if (cell.kind === "rest") {
    return (
      <li className={row} data-testid="program-w1-rest">
        {head}
        <span className="inline-flex min-h-11 items-center text-xs text-cz-2 sm:min-h-9">{sessionLabel("rest")}</span>
      </li>
    );
  }
  if (cell.kind === "ran") {
    return (
      <li className={row} title={t("settleAfterStage.ranTitle")}>
        {head}
        <span className="inline-flex min-h-11 items-center gap-1 text-xs text-cz-3 sm:min-h-9">
          <LockIcon size={10} aria-hidden="true" className="shrink-0" />{t("settleAfterStage.ran")}
        </span>
      </li>
    );
  }
  const session = cell.session;
  const dot = cell.changed || effortDirty
    ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cz-2" role="img" aria-label={tR5("programR5.notSaved")} />
    : null;
  return (
    <li className={row} data-testid="program-w1-pass">
      <span className="flex items-center gap-1.5">{head}{dot}</span>
      {editable ? (
        <div className="relative min-w-0">
          <select value={session ?? ""} onChange={(e) => onSession(e.target.value)}
            aria-label={label} title={session ? sessionLabel(session) : undefined} data-testid="program-w1-session"
            className={`${controlClass({ size: "sm" })} min-h-11 cursor-pointer appearance-none truncate pe-6 ps-2 sm:min-h-9 ${session ? "text-cz-1" : "text-cz-3"}`}>
            {!session && <option value="" disabled>{tR5("programW1.noSession")}</option>}
            {sessionOrder.map((s) => <option key={s} value={s}>{sessionLabel(s)}</option>)}
          </select>
          <ChevronDownIcon size={12} aria-hidden="true" className="pointer-events-none absolute end-1.5 top-1/2 -translate-y-1/2 text-cz-3" />
        </div>
      ) : (
        <span className={`inline-flex min-h-11 items-center truncate text-xs sm:min-h-9 ${session ? "text-cz-1" : "text-cz-3"}`}>
          {session ? sessionLabel(session) : tR5("programW1.noSession")}
        </span>
      )}
      {effortLevels && (
        <EffortButtons
          effort={effort}
          label={tR5("programW1.effortFor", { pass: label })}
          editable={editable}
          mobile={mobile}
          onPick={onEffort}
        />
      )}
    </li>
  );
}

// Let / Mellem / Haard som tre smaa knapper. Valgt = --text-1-kant (TASTE: en valgt chip,
// aldrig guld; Gem plan er sidens eneste guld). null = "Ingen indsats" (hvile, restitution).
function EffortButtons({
  effort, label, editable, mobile, onPick,
}: {
  effort: ProgramEffort | null;
  label: string;
  editable: boolean;
  mobile: boolean;
  onPick: (effort: ProgramEffort) => void;
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5");
  if (!effort) {
    return <span className="text-2xs text-cz-3" data-testid="program-w1-no-effort">{tR5("programW1.noEffort")}</span>;
  }
  return (
    <div role="group" aria-label={label} className="flex gap-1" data-testid="program-w1-effort">
      {PROGRAM_EFFORTS.map((level) => {
        const active = level === effort;
        return (
          <button
            key={level}
            type="button"
            aria-pressed={active}
            disabled={!editable}
            onClick={() => { if (!active) onPick(level); }}
            data-testid={`program-w1-effort-${level}`}
            className={`${mobile ? "min-h-11 flex-1" : "h-7 min-w-0 flex-1"} inline-flex items-center justify-center gap-0.5 truncate rounded-cz border px-1 text-2xs ${
              active ? "border-cz-1 font-semibold text-cz-1" : "border-cz-border text-cz-2 hover:text-cz-1"
            } disabled:cursor-default disabled:opacity-60`}
          >
            {active && <CheckIcon size={10} aria-hidden="true" className="shrink-0" />}
            {t(`dayPanel.level_${level}`)}
          </button>
        );
      })}
    </div>
  );
}

function CopyDayMenuV2({
  label, options, onPick, align = "end",
}: {
  align?: "start" | "end";
  label: string;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(ref, () => setOpen(false), open);
  return (
    <div ref={ref} className="relative -my-1.5 -me-1.5 shrink-0">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}
        onClick={() => setOpen((v) => !v)} data-testid="program-w1-copy-day"
        className="inline-flex h-11 w-9 items-center justify-center rounded-cz text-cz-3 hover:bg-cz-card hover:text-cz-1">
        <ClipboardIcon size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className={`absolute ${align === "start" ? "start-0" : "end-0"} z-dropdown mt-1 min-w-[168px]`}>
          <Menu aria-label={label}>
            {options.map((o) => (
              <MenuItem key={o.value} className="min-h-11" onClick={() => { setOpen(false); onPick(o.value); }}>
                {o.label}
              </MenuItem>
            ))}
          </Menu>
        </div>
      )}
    </div>
  );
}

// --- Alle ryttere: en linje pr. rytter --------------------------------------------------

function AllRidersTable({
  rows, weekdays, todayWeekday, mobile, forecast, sessionLabel, dayName, programLabel, onOpen,
}: {
  rows: ReturnType<typeof allRidersRows>;
  weekdays: readonly string[];
  todayWeekday: string;
  mobile: boolean;
  forecast: ForecastResponse | null;
  sessionLabel: (s: string) => string;
  dayName: (w: string) => string;
  programLabel: (key: string | null) => string;
  onOpen: (riderId: string) => void;
}) {
  const { t: tR5 } = useTranslation("trainingR5");
  const order = daysFromToday(weekdays, todayWeekday);
  const [today, tomorrow, ...later] = order;
  const th = "border-b border-cz-border bg-cz-subtle px-3 py-2 text-start text-xs font-medium text-cz-2";
  const td = "border-t border-cz-border px-3 py-2 align-top text-xs";
  const dayText = (row: (typeof rows)[number], weekday: string) => {
    const list = row.sessions[weekday] ?? [];
    const races = weekday === todayWeekday ? raceSlotsFor(forecast, row.id).size : 0;
    const parts = [...(races > 0 ? [tR5("programR5.race")] : []), ...list.map(sessionLabel)];
    return parts.length ? parts.join(" · ") : "–";
  };
  const planText = (row: (typeof rows)[number]) => (row.plan.via === "none"
    ? tR5("programR5.noProgram")
    : row.plan.via === "own" ? tR5("programR5.ownPlan", { name: programLabel(row.plan.programKey) }) : programLabel(row.plan.programKey));
  return (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" data-testid="program-w1-all">
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            <th scope="col" className={`${th} ${mobile ? "w-[44%]" : "w-[18%]"}`}>{tR5("programW1.col.rider")}</th>
            {!mobile && <th scope="col" className={`${th} w-[12%]`}>{tR5("programW1.col.group")}</th>}
            {!mobile && <th scope="col" className={`${th} w-[16%]`}>{tR5("programW1.col.program")}</th>}
            <th scope="col" className={th}>{tR5("programW1.col.today")}</th>
            <th scope="col" className={th}>{tR5("programW1.col.tomorrow")}</th>
            {!mobile && <th scope="col" className={`${th} w-[26%]`}>{tR5("programW1.col.next")}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="cursor-pointer hover:bg-cz-subtle" onClick={() => onOpen(row.id)} data-testid="program-w1-all-row">
              <th scope="row" className={`${td} text-start font-normal`}>
                <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(row.id); }}
                  className="min-h-11 text-start font-semibold text-cz-1 hover:underline sm:min-h-0"
                  aria-label={tR5("programW1.openWeek", { name: row.name })}>
                  {row.name}
                </button>
                {mobile && (
                  <span className="block text-2xs text-cz-2">
                    {[row.group?.name ?? tR5("programW1.noGroup"), planText(row)].join(" · ")}
                  </span>
                )}
              </th>
              {!mobile && <td className={`${td} text-cz-2`}>{row.group?.name ?? tR5("programW1.noGroup")}</td>}
              {!mobile && <td className={`${td} text-cz-2`}>{planText(row)}</td>}
              <td className={`${td} text-cz-1`}>{dayText(row, today)}</td>
              <td className={`${td} text-cz-1`}>{dayText(row, tomorrow)}</td>
              {!mobile && (
                <td className={`${td} text-cz-2`}>
                  <ul className="flex flex-col gap-0.5">
                    {later.map((weekday) => (
                      <li key={weekday} className="truncate">
                        <span className="text-cz-3">{dayName(weekday)}</span> {dayText(row, weekday)}
                      </li>
                    ))}
                  </ul>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Skift program ----------------------------------------------------------------------

function ChangeProgramDialog({
  name, library, catalog, current, lang, riderName, onClose, onPick,
}: {
  name: string;
  library: Library;
  catalog: CatalogProgram[];
  current: string | null;
  lang: string;
  riderName: (id: string) => string;
  onClose: () => void;
  onPick: (key: string) => void;
}) {
  const { t: tR5 } = useTranslation("trainingR5");
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={tR5("programW1.changeTitle", { name })}
      titleId="program-w1-change-title"
      ariaLabelledby={undefined}
      description={null}
      closeLabel={tR5("programR5.cancel")}
      footer={<Button variant="secondary" className="min-h-11" onClick={onClose}>{tR5("programR5.cancel")}</Button>}
    >
      <ul className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto" data-testid="program-w1-catalog">
        {library.programs.map((entry) => {
          const program = catalog.find((c) => c.key === entry.key);
          const on = [...entry.groups.map((g) => g.name), ...entry.riders.map(riderName)];
          const isCurrent = entry.key === current;
          return (
            <li key={entry.key}>
              <button type="button" disabled={isCurrent} onClick={() => onPick(entry.key)} aria-current={isCurrent || undefined}
                className={`min-h-11 w-full rounded-cz border px-3 py-2 text-start ${isCurrent ? "border-cz-1" : "border-cz-border hover:bg-cz-subtle"} disabled:cursor-default`}
                data-testid="program-w1-catalog-item">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-cz-1">
                  {programName(program, lang)}
                  {isCurrent && <span className="text-2xs font-normal text-cz-2">{tR5("programW1.current")}</span>}
                </span>
                <span className="mt-0.5 block text-2xs text-cz-2">{programTagline(program, lang)}</span>
                <span className="mt-0.5 block truncate text-2xs text-cz-3">
                  {on.length ? tR5("programR5.on", { names: on.join(", ") }) : tR5("programR5.notInUse")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

// --- Kopiér til ryttere (samme to trin som R5: vaelg ryttere, bekraeft) -------------------

function CopyToRidersV2({
  name, rotation, candidates, busy, saving, onClose, onCopy,
}: {
  name: string;
  rotation: boolean;
  candidates: R5Rider[];
  busy: boolean;
  saving: boolean;
  onClose: () => void;
  onCopy: (riderIds: string[], keepPlace: boolean) => void;
}) {
  const { t: tR5 } = useTranslation("trainingR5");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [recipients, setRecipients] = useState<R5Rider[] | null>(null);
  const [keepPlace, setKeepPlace] = useState(true);
  const selected = candidates.filter((r) => picked.has(r.id));
  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  if (recipients) return (
    <ProgramAssignmentConfirmation
      name={name}
      target={{ riders: recipients }}
      busy={busy}
      saving={saving}
      actionId="program-w1-copy-confirm"
      onClose={onClose}
      onConfirm={() => onCopy(recipients.map((r) => r.id), keepPlace)}
    />
  );
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={tR5("programR5.copyTitle", { name })}
      titleId="program-w1-copy-title"
      ariaLabelledby={undefined}
      description={null}
      closeLabel={tR5("programR5.cancel")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{tR5("programR5.cancel")}</Button>
          <Button variant="primary" disabled={selected.length === 0 || busy} onClick={() => setRecipients(selected)} data-testid="program-w1-copy-go">
            {tR5("programR5.continue")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-cz-2">{tR5(rotation ? "programR5.rotation.copyBody" : "programR5.copyBody")}</p>
      {rotation && (
        <Checkbox id="program-w1-copy-restart" label={tR5("programR5.rotation.restart")}
          checked={!keepPlace} onChange={() => setKeepPlace((value) => !value)} />
      )}
      <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
        {candidates.map((r) => (
          <li key={r.id}>
            <Checkbox id={`program-w1-copy-${r.id}`} label={r.name} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// Henter-tilstanden: statiske graa linjer i ugens geometri, saa intet hopper (PAGE_TEMPLATES).
function ProgramWeekSkeleton() {
  return (
    <div className="flex flex-col gap-3" data-testid="program-w1-loading" aria-hidden="true">
      <Skeleton className="h-11 w-72" />
      <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card p-3">
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 * (PROGRAM_SLOTS + 1) }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      </div>
    </div>
  );
}
