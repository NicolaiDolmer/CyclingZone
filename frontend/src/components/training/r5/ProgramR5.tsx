// ProgramR5 — fanen Program paa den nye traeningsside R5 (#7456/#7947, ejer 20/11),
// bag kontakten training_page_r5. Specifikationen er R5-skitsen
// (design/7947-r5-program, R5Program.tsx), ejerens wireframe 17/11 og
// beslutningerne paa #7456:
//   - biblioteket til venstre: programmer oeverst, grupper og ryttere med egen plan
//     under, "No program" uden advarsel;
//   - et program saettes KUN paa en gruppe eller en rytter, og egen plan vinder;
//   - "Copy to riders" og sidens ene guldknap "Save plan" staar i sidehovedet
//     (TrainingPage giver en plads dertil, `actionsEl`);
//   - loebsfelter er graa + flag (ingen skravering, TASTE); felterne hedder RD/LD
//     via de eksisterende tekster;
//   - kopier en dag; traethed i aften; note om at dagens felter laases efter Train now.
//
// Kun eksisterende API'er (useTrainingPrograms, useTrainingGroups, forecast,
// traethedsgraensen). Rotation, prioritet og laas pr. dag findes ikke i backend
// endnu; se designnoten i PR'en. Telefonen (#8547, ejer 21/11) er ProgramR5Phone: en skifter
// Dag/Uge, Gem fast i bunden; data, kladder og gemme-kald er de samme som her.
import { useEffect, useMemo, useRef, useState, type ComponentType, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Button from "../../ui/Button.jsx";
import Checkbox from "../../ui/Checkbox.jsx";
import EmptyState from "../../ui/EmptyState.jsx";
import ErrorStateJs from "../../ui/ErrorState.jsx";
import Select from "../../ui/Select.jsx";
import { controlClass } from "../../ui/fieldStyles.js";
import Skeleton, { SkeletonLines } from "../../ui/Skeleton.jsx";
import Modal from "../../ui/Modal.jsx";
import Segmented from "../../ui/Segmented.jsx";
import { Menu, MenuItem } from "../../ui/Menu.jsx";
import { useDismiss } from "../../ui/useDismiss.js";
import {
  CalendarIcon, ChevronDownIcon, ClipboardIcon, FlagIcon, LockIcon, MoreIcon, PlusIcon, TeamIcon, UserIcon, XIcon,
} from "../../ui/icons/index.jsx";
import FatigueForecast from "../FatigueForecast.tsx";
import FatigueRuleSummary from "../FatigueRuleSummary.tsx";
import FatigueRulePanel from "../FatigueRulePanel.tsx";
import { FATIGUE_FALLBACKS } from "../FatigueRuleModel.ts";
import { SESSION_ORDER, SESSION_ORDER_V3 } from "../TrainingPlanCard.tsx";
import GroupFatigueExceptions from "../groups/GroupFatigueExceptions.tsx";
import TrainingGroupDialog from "../groups/TrainingGroupDialog.tsx";
import { groupForecastEntry, type TrainingGroup } from "../groups/trainingGroupsModel.ts";
import { todayLockedSlots } from "../settleAfterStage7982/settleAfterStageModel.ts";
import { raceSlotsFor, type ForecastEntry, type ForecastResponse } from "../FatigueForecastModel.ts";
import type { FatigueRulesClient } from "../useFatigueRules.ts";
import type { TrainingGroupsClient } from "../groups/useTrainingGroups.ts";
import type { ProgramsResult } from "../useTrainingPrograms.ts";
import { sessionI18nKey } from "../../../lib/trainingDayTypes.js";
import { PROGRAM_SLOTS, programName, programTagline, type CatalogProgram, type ProgramWeekDays } from "../../../lib/trainingPrograms.ts";
import {
  availableKinds, PROGRAM_VIEW_STORE, buildLibrary, catalogWeekDays, copyCandidates, copyDayIntoDraft, copyDayTargets,
  draftSteps, draftTotal, parseSubjectKey, programKeyOf, rememberedKind, riderWeekDays, setDraftCell, shortRiderName,
  subjectKey, subjectsFor, weekCells, weekPlacement, weekPlacementFromForecast, type Draft, type Kind, type Library, type R5Group, type R5Rider, type Subject,
  type WeekCell, type RotationPlan, type RotationWrite, type RotationDrafts, type WeekBlock, type WeekBlockDrafts, type WeekCellWrite,
  GROUP_LIMIT_MODES, createdGroupId, dropDrafts, followAgainTarget, groupLimitDraft, groupLimitValid, groupLimitWrite,
  groupAfterPatch, groupMenuActions, groupMovePatch, groupPatch, type GroupLimitDraft, type GroupMenuAction,
} from "./programR5Model.ts";
import ProgramR5Phone, { type PhoneChip } from "./ProgramR5Phone.tsx";
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
  // #8561: foerste hentning; mangler feltet (aeldre kalder), regnes kataloget som hentet.
  status?: "loading" | "ready" | "error";
  retry?: () => Promise<unknown> | void;
  reload?: () => Promise<unknown> | void;
  applyProgram: (programKey: string, target: string, planKind?: "week") => Promise<ProgramsResult>;
  setCell: (riderId: string, weekday: string, slotIndex: number | null, session: string, write?: WeekCellWrite) => Promise<ProgramsResult>;
};

// ErrorState er JS med `action = null` som standard; TS udleder ellers typen null (som AcademyLedgerTab).
const ErrorState = ErrorStateJs as unknown as ComponentType<{ title: ReactNode; description?: ReactNode; action?: ReactNode }>;

// Kortets meta-label efter PAGE_TEMPLATES (data-font text-2xs, uppercase, tracking .08em, --text-3).
const LABEL = "font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-3";
// #8560: "Egen" starter som graense-kortets gruppe-undtagelse (GroupFatigueExceptions).
const GROUP_LIMIT_DEFAULTS = { threshold: 70, fallback: "light" };

function loadKind(): Kind {
  try { return rememberedKind(localStorage.getItem(PROGRAM_VIEW_STORE), availableKinds(true)); } catch { return "week"; }
}
function saveKind(kind: Kind) {
  try { localStorage.setItem(PROGRAM_VIEW_STORE, kind); } catch { /* privat vindue: valget huskes bare ikke */ }
}

export default function ProgramR5({
  riders: rawRiders, weekdays, todayWeekday, todayLocked, riderWeekPlans, programs, groups, forecast, fatigueRules,
  catalogV3, actionsEl, mobile, onClearRider, drafts, onDrafts: setDrafts, request = null, onRequestHandled,
  effortLevels = false, rotationDrafts, setRotationDrafts, weekDrafts, setWeekDrafts,
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
  actionsEl: HTMLElement | null;
  mobile: boolean;
  effortLevels?: boolean;
  rotationDrafts: RotationDrafts;
  setRotationDrafts: Dispatch<SetStateAction<RotationDrafts>>;
  weekDrafts: WeekBlockDrafts;
  setWeekDrafts: Dispatch<SetStateAction<WeekBlockDrafts>>;
  onClearRider: (riderId: string) => Promise<{ ok: boolean }>;
  // Kladderne bor paa siden (som ugeplan-kladderne), saa et fanebyt ikke kasserer dem.
  drafts: Record<string, Draft>;
  onDrafts: Dispatch<SetStateAction<Record<string, Draft>>>;
  // #8533 Codex P2: "Rediger plan" paa en rytter / "Rediger" paa traethedsgraensen fra I dag.
  // `n` skifter ved hver anmodning, saa samme rytter kan vaelges igen.
  request?: { kind: "rider" | "limit" | "weekday"; id?: string; weekday?: string; n: number } | null;
  // Kaldes naar anmodningen er behandlet, saa siden kan nulstille den (fanen afmonteres og
  // ville ellers afspille den igen ved naeste besoeg, Fable-fund 1 paa #8533).
  onRequestHandled?: () => void;
}) {
  const { t, i18n } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7456: lazy namespace (I18nReadyGate i TrainingPage)
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
  const [chosenProgramKey, setChosenProgramKey] = useState<string | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<Subject | null>(null);
  const [moveRider, setMoveRider] = useState<{ id: string; add: boolean } | null>(null);
  const [dialogError, setDialogError] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  // #8560: null = lukket, { group: null } = ny gruppe.
  const [groupDialog, setGroupDialog] = useState<{ group: TrainingGroup | null } | null>(null);
  const [limitDraft, setLimitDraft] = useState<GroupLimitDraft>(() => groupLimitDraft(null, GROUP_LIMIT_DEFAULTS));
  const [deleting, setDeleting] = useState<TrainingGroup | null>(null);
  const [focusWeekday, setFocusWeekday] = useState<{ weekday: string; n: number } | null>(null); // #8580
  // #8561: "Kassér ændringer" spoerger foer kladderne smides ud.
  const [discardOpen, setDiscardOpen] = useState(false);

  // #8533 Codex P2: en anmodning udefra vaelger rytteren (i det program, han hoerer til) eller aabner graensen.
  const handledRequest = useRef(0);
  useEffect(() => {
    if (!request || request.n === handledRequest.current) return;
    handledRequest.current = request.n;
    onRequestHandled?.();
    if (request.kind === "limit") { setLimitOpen(true); return; }
    // #8580: dagsvaelgerens "Ret <ugedag> i Program" -> telefonen viser netop den ugedag.
    if (request.kind === "weekday") { if (request.weekday) setFocusWeekday({ weekday: request.weekday, n: request.n }); return; }
    if (!request.id) return;
    setChosenProgramKey(null);
    setSubject({ kind: "rider", id: request.id });
  }, [request, onRequestHandled]);

  const chosenProgram = programs.catalog.find((p) => p.key === chosenProgramKey) ?? null;
  const programKey = chosenProgram?.key ?? (subject ? programKeyOf(subject, library) : null);
  const program = programs.catalog.find((p) => p.key === programKey) ?? null;
  const subjects = subjectsFor(programKey, library);
  const busy = programs.busy || groups.busy || saving;
  const sKey = subjectKey(subject);
  const draft = drafts[sKey] ?? {};
  const total = draftTotal(drafts);

  const pickProgram = (key: string) => {
    setChosenProgramKey(key);
    setSubject(subjectsFor(key, library)[0] ?? null);
    setNote(null);
  };
  const pickSubject = (next: Subject) => {
    setChosenProgramKey(null);
    setSubject(next);
    setNote(null);
  };

  // Ugen der vises: gruppens felter, rytterens egne (eller saaede), ellers programmet som skrevet.
  const group = subject?.kind === "group" ? groupList.find((g) => g.id === subject.id) ?? null : null;
  const riderDays = subject?.kind === "rider" ? riderWeekDays(subject.id, riderWeekPlans, programs.seeds, weekdays) : null;
  const days: ProgramWeekDays | null = group
    ? (group.days as ProgramWeekDays | null) ?? null
    : riderDays ? riderDays.days : catalogWeekDays(program);
  const editable = !!subject && !!days;
  const memberIds = group ? group.members.filter((m) => m.followsGroup).map((m) => m.riderId) : [];
  // En gruppes felt i dag er kun loeb/laast naar ALLE dens ryttere har det (regel A, som Plan i dag).
  const slotSet = (fn: (id: string) => ReadonlySet<number>) => {
    if (subject?.kind === "rider") return fn(subject.id);
    if (!memberIds.length) return new Set<number>();
    const sets = memberIds.map(fn);
    return new Set([...sets[0]].filter((slot) => sets.every((s) => s.has(slot))));
  };
  const raceToday = slotSet((id) => raceSlotsFor(forecast, id));
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
  const cells = weekCells({ days: gridDays, draft, weekdays, todayWeekday, raceToday, lockedToday, placements });
  const tonight = (subject?.kind === "rider"
    ? forecast?.riders?.[subject.id] ?? null
    : groupForecastEntry(forecast?.riders, memberIds)) as ForecastEntry | null;

  const sessionLabel = (session: string) => (session === "rest" || session === "recovery"
    ? t(`dayPanel.dayType_${session}`)
    : t(sessionI18nKey("dayPanel.session", session)));
  const sessionOrder: readonly string[] = catalogV3 ? SESSION_ORDER_V3 : SESSION_ORDER;
  const dayLabel = (weekday: string) => t(`weekday_${weekday}`);
  const subjectName = (s: Subject) => (s.kind === "group"
    ? groupList.find((g) => g.id === s.id)?.name ?? ""
    : riderById.get(s.id)?.name ?? "");

  const storedRotation = subject?.kind === "rider" ? programs.rotations?.[subject.id]
    : subject?.kind === "group" ? groups.groups.find((item) => item.id === subject.id) : null;
  const rotationDraft = rotationDrafts[sKey];
  const rotationPasses = rotationDraft?.passes ?? storedRotation?.rotation?.passes
    ?? [{ session: sessionOrder[0] ?? "rest" }, { session: sessionOrder[0] ?? "rest" }];
  const rotationDirty = Boolean(subject && (rotationDraft || storedRotation?.planKind !== "rotation"));
  const blockTotal = weekPriority ? Object.values(weekDrafts).reduce((count, blocks) => count + Object.keys(blocks).length, 0) : 0;
  const switchToWeek = programs.rotationEnabled === true && storedRotation?.planKind === "rotation";
  const activeTotal = isRotation ? Number(rotationDirty) : total + blockTotal + Number(switchToWeek && total + blockTotal === 0);
  const canCopy = isRotation ? Boolean(subject && rotationPasses.length >= 2) : Boolean(chosenProgram);
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
      date: day.date, label: dayLabel(day.weekday), ...(day.today?.riders ?? day.riders)?.[subject.id],
    }))
    : [];
  const rotationNext = subject?.kind === "rider"
    ? trainingWeek?.days[6]?.riders?.[subject.id]?.nextRotationIndex
    : undefined;
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
  ) : <p className="text-sm text-cz-2">{tR5("programR5.rotation.pickRider")}</p>;
  const kindSelector = kinds.length > 1 ? (
    <Segmented label={tR5("programR5.kindLabel")} value={kind} onChange={setKind}
      options={kinds.map((k) => ({ value: k, label: tR5(`programR5.kind_${k}`) }))} />
  ) : null;
  const weekBlockEditor = weekPriority && editable && days ? (
    <WeekBlockEditor
      key={sKey}
      dayKeys={weekdays} today={todayWeekday} closed={todayLocked} days={days}
      draft={draft} changes={weekDayDrafts} disabled={busy}
      dayLabel={dayLabel} sessionLabel={sessionLabel}
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

  const editCell = (weekday: string, slot: number, session: string) => {
    const sourceSlot = placements[weekday]?.fieldSource[slot] ?? slot;
    setDrafts((prev) => ({ ...prev, [sKey]: setDraftCell(prev[sKey] ?? {}, gridDays, weekday, sourceSlot, session) }));
  };
  const copyDay = (from: string, choice: string) => {
    const targets = copyDayTargets(from, choice, weekdays, { todayWeekday, todayLocked });
    setDrafts((prev) => ({ ...prev, [sKey]: copyDayIntoDraft(prev[sKey] ?? {}, gridDays, from, targets) }));
  };

  // Save plan: hver rettelse er en felt-skrivning til den eksisterende API (rytter eller gruppe).
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
    const left: Record<string, Draft> = {};
    for (const [key, d] of Object.entries(drafts)) {
      const target = parseSubjectKey(key);
      if (!target) continue;
      const rest: Record<string, string> = { ...d };
      for (const step of draftSteps(d, weekdays)) {
        if (unsavedDays[key]?.[step.weekday]) continue;
        const result = await saveCell(target, step.weekday, step.slotIndex, step.session, markWeek);
        if (!result.ok) { failed = true; break; }
        delete rest[`${step.weekday}:${step.slotIndex}`];
      }
      if (Object.keys(rest).length) left[key] = rest;
    }
    // En rytters felt-gem goer planen til hans egen; gruppeklienten skal se det.
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

  // #8561: Kassér ændringer = ugen tilbage til det gemte (alle kladder, ogsaa andre gruppers/rytteres).
  const discardDrafts = () => {
    if (isRotation) clearRotationDraft();
    else { setDrafts({}); setWeekDrafts({}); }
    setDiscardOpen(false);
    setNote(null);
  };

  const askToAdd = (value: string) => {
    if (!chosenProgram || busy) return;
    setDialogError(false);
    setAddTarget(parseSubjectKey(value));
  };
  const closeAdd = () => { if (!saving) setAddTarget(null); };
  const putOn = async () => {
    if (!addTarget || !chosenProgram || busy) return;
    setSaving(true);
    setDialogError(false);
    try {
      const planKind = programs.rotationEnabled || weekPriority ? "week" : undefined;
      const result = addTarget.kind === "group"
        ? await groups.putProgram(addTarget.id, chosenProgram.key, planKind)
        : await programs.applyProgram(chosenProgram.key, addTarget.id, planKind);
      if (addTarget.kind === "rider") await groups.reload();
      if (!result.ok) { setDialogError(true); return; }
      setSubject(addTarget);
      setAddTarget(null);
      setNote(null);
    } catch {
      setDialogError(true);
    } finally {
      setSaving(false);
    }
  };
  const removeRider = async (riderId: string) => {
    const result = await onClearRider(riderId);
    await groups.reload();
    if (!result.ok) setNote({ tone: "error", text: tR5("programR5.saveError") });
  };

  // --- #8560 gruppestyring: opret, omdoeb, medlemmer, graense, slet, foelg igen ---------
  const groupsOn = groups.enabled;
  const menuActions = groupMenuActions({ limitEnabled: fatigueRules.enabled }).filter((action) => action !== "members");
  const openMove = (id: string, add: boolean) => {
    setDialogError(false);
    setMoveRider({ id, add });
  };
  const closeMove = () => { if (!saving) setMoveRider(null); };
  const moveToGroup = async (groupId: string) => {
    if (!moveRider || busy) return;
    const target = groupList.find((g) => g.id === groupId);
    const patch = target && groupMovePatch(target, moveRider.id);
    if (!patch) return;
    setSaving(true);
    setDialogError(false);
    try {
      const result = await groups.update(groupId, patch);
      if (!result.ok) { setDialogError(true); return; }
      if (programs.rotationEnabled || weekPriority) {
        dropPlanDrafts([subjectKey({ kind: "rider", id: moveRider.id })]);
        await Promise.all([programs.reload?.(), reloadTrainingWeek()]);
      }
      pickSubject({ kind: "group", id: groupId });
      setMoveRider(null);
    } catch {
      setDialogError(true);
    } finally {
      setSaving(false);
    }
  };
  const openGroupDialog = (target: TrainingGroup | null) => {
    setLimitDraft(groupLimitDraft(target?.fatigue, GROUP_LIMIT_DEFAULTS));
    setGroupDialog({ group: target });
  };
  const groupAction = (id: string, action: GroupMenuAction) => {
    const target = groups.groups.find((g) => g.id === id);
    if (!target) return;
    if (action === "delete") setDeleting(target);
    else openGroupDialog(target);
  };
  const dropPlanDrafts = (keys: string[]) => {
    setDrafts((prev) => dropDrafts(prev, keys));
    setRotationDrafts((prev) => dropDrafts(prev, keys));
    setWeekDrafts((prev) => dropDrafts(prev, keys));
  };
  const saveGroup = async (name: string, riderIds: string[]): Promise<boolean> => {
    const editing = groupDialog?.group ?? null;
    let id = editing?.id ?? null;
    if (editing) {
      const patch = groupPatch(editing, name, riderIds);
      if (patch) {
        const updated = await groups.update(editing.id, patch);
        if (!updated.ok) return false;
        if (patch.riderIds) {
          const existing = new Set(editing.members.map((member) => member.riderId));
          dropPlanDrafts(patch.riderIds.filter((riderId) => !existing.has(riderId)).map((riderId) => subjectKey({ kind: "rider", id: riderId })));
          await Promise.all([programs.reload?.(), reloadTrainingWeek()]);
        }
        // Fejler graensen bagefter, skal et nyt Gem sammenligne med det gemte (Codex P2).
        setGroupDialog({ group: groupAfterPatch(editing, patch, updated.groups) });
      }
    } else {
      const before = groups.groups.map((g) => g.id);
      const created = await groups.create(name, riderIds);
      if (!created.ok) return false;
      id = createdGroupId(before, created.groups);
      // Gruppen findes nu: et nyt tryk paa Gem maa ikke oprette den igen, hvis graensen fejler.
      const made = created.groups?.find((g) => g.id === id) ?? null;
      if (made) setGroupDialog({ group: made });
    }
    if (fatigueRules.enabled && id) {
      const write = groupLimitWrite(limitDraft, editing?.fatigue);
      if (!write.ok) return false;
      if (write.change && !(await groups.setFatigue(id, write.change.mode, write.change.own)).ok) return false;
    }
    setGroupDialog(null);
    setNote(null);
    if (!editing && id) pickSubject({ kind: "group", id });
    return true;
  };
  const deleteGroup = async () => {
    if (!deleting) return;
    const key = subjectKey({ kind: "group", id: deleting.id });
    const result = await groups.remove(deleting.id);
    setDeleting(null);
    if (!result.ok) { setNote({ tone: "error", text: tR5("programR5.saveError") }); return; }
    dropPlanDrafts([key]);
    if (sKey === key) setSubject(null);
    setNote(null);
  };
  const follow = groupsOn ? followAgainTarget(subject, groupList) : null;
  const followAgain = async () => {
    if (!follow) return;
    const result = await groups.follow(follow.groupId, follow.riderIds);
    if (!result.ok) { setNote({ tone: "error", text: tR5("programR5.saveError") }); return; }
    // Rytterens egne rettelser gaelder ikke laengere: han koerer gruppens uge igen.
    dropPlanDrafts(follow.riderIds.map((id) => subjectKey({ kind: "rider", id })));
    await Promise.all([programs.reload?.(), reloadTrainingWeek()]);
    setNote(null);
  };
  const followLabel = follow
    ? (subject?.kind === "group"
      ? tR5("programR5.manage.followAgainAll", { n: follow.riderIds.length })
      : tR5("programR5.manage.followAgain"))
    : "";
  const ownOfGroup = follow && subject?.kind === "rider" ? tR5("programR5.manage.ownPlanOf", { name: follow.groupName }) : null;

  // #8561: gem-linjen i sidehovedets handlingsklynge (PAGE_TEMPLATES): "N ændringer ikke gemt" +
  // Kassér ændringer ved siden af sidens ene guldknap. Knapperne er skabelonens md (44 px).
  const actions = (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {activeTotal > 0 && (
        <span className="font-data text-xs tabular-nums text-cz-2" data-testid="program-r5-unsaved">{t("weekPlan.unsaved", { n: activeTotal })}</span>
      )}
      {activeTotal > 0 && (
        <Button variant="secondary" size="md" className="min-h-11" disabled={busy} onClick={() => setDiscardOpen(true)} data-testid="program-r5-discard">
          {tR5("programR5.discard")}
        </Button>
      )}
      <Button variant="secondary" size="md" className="min-h-11" disabled={!canCopy || busy} onClick={() => setCopyOpen(true)}
        title={canCopy ? undefined : tR5("programR5.copyNeedsProgram")} data-testid="program-r5-copy">
        {tR5("programR5.copyToRiders")}
      </Button>
      <Button variant="primary" size="md" className="min-h-11" disabled={activeTotal === 0 || busy}
        onClick={isRotation ? saveRotation : savePlan} data-testid="program-r5-save">
        {saving ? t("loading") : tR5("programR5.savePlan")}
      </Button>
    </span>
  );

  const title = program ? programName(program, lang) : subject ? tR5("programR5.ownWeek") : tR5("programR5.noneSelected");
  const intro = kind === "week" ? tR5("programR5.introWeek") : "";

  const tonightEl = tonight ? <FatigueForecast entry={tonight} settled={forecast?.settled === true} label="" /> : null;
  const limitEl = fatigueRules.enabled ? (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card [&>div]:border-t-0">
      <FatigueRuleSummary data={fatigueRules.data} onEdit={() => setLimitOpen((v) => !v)} />
      {limitOpen && (
        <div className="border-t border-cz-border p-4">
          <FatigueRulePanel rules={fatigueRules} groupExceptions={groupsOn && groups.groups.length > 0
            ? <GroupFatigueExceptions groups={groups.groups} busy={groups.busy} onSave={groups.setFatigue} />
            : null} />
        </div>
      )}
    </div>
  ) : null;
  const discardModal = discardOpen ? (
    <Modal
      open
      onClose={() => setDiscardOpen(false)}
      size="sm"
      title={tR5("programR5.discardTitle", { n: total })}
      titleId="program-r5-discard-title"
      ariaLabelledby={undefined}
      description={null}
      closeLabel={tR5("programR5.cancel")}
      footer={(
        <>
          <Button variant="secondary" className="min-h-11" onClick={() => setDiscardOpen(false)}>{tR5("programR5.cancel")}</Button>
          <Button variant="danger" className="min-h-11" onClick={discardDrafts} data-testid="program-r5-discard-go">{tR5("programR5.discardGo")}</Button>
        </>
      )}
    >
      <p className="text-xs text-cz-2">{tR5("programR5.discardBody")}</p>
    </Modal>
  ) : null;
  const groupModals = (
    <>
      {discardModal}
      {groupDialog && (
        <TrainingGroupDialog
          open
          group={groupDialog.group}
          riders={riders}
          groups={groups.groups}
          busy={groups.busy}
          onClose={() => setGroupDialog(null)}
          onSave={saveGroup}
          canSave={!fatigueRules.enabled || groupLimitValid(limitDraft)}
          extra={fatigueRules.enabled ? <GroupLimitFields draft={limitDraft} busy={groups.busy} onChange={setLimitDraft} /> : null}
        />
      )}
      {deleting && (
        <Modal
          open
          onClose={() => setDeleting(null)}
          size="sm"
          title={tR5("programR5.manage.deleteTitle", { name: deleting.name })}
          titleId="program-r5-group-delete-title"
          ariaLabelledby={undefined}
          description={null}
          closeLabel={tR5("programR5.cancel")}
          footer={(
            <>
              <Button variant="secondary" className={mobile ? "min-h-11" : ""} onClick={() => setDeleting(null)}>{tR5("programR5.cancel")}</Button>
              <Button variant="danger" className={mobile ? "min-h-11" : ""} disabled={busy} onClick={deleteGroup} data-testid="program-r5-group-delete-go">
                {tR5("programR5.manage.deleteGo")}
              </Button>
            </>
          )}
        >
          <p className="text-xs text-cz-2" data-testid="program-r5-group-delete-body">{tR5("programR5.manage.deleteBody")}</p>
        </Modal>
      )}
    </>
  );
  const followButton = follow ? (
    <button type="button" disabled={busy} onClick={followAgain} data-testid="program-r5-follow-again"
      className={`${mobile ? "min-h-11 " : ""}inline-flex items-center text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50`}>
      {followLabel}
    </button>
  ) : null;
  const noteEl = note ? (
    <p role="status" className={`text-xs ${note.tone === "ok" ? "text-cz-success" : "text-cz-danger"}`}>{note.text}</p>
  ) : null;
  const copyModal = copyOpen && canCopy ? (
    <CopyToRiders
      name={isRotation ? tR5("programR5.kind_rotation") : programName(chosenProgram!, lang)}
      rotation={isRotation}
      candidates={isRotation ? riders.filter((rider) => rider.id !== subject?.id) : copyCandidates(chosenProgram!.key, library, riders)}
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
              : await programs.applyProgram(chosenProgram!.key, id, programs.rotationEnabled || weekPriority ? "week" : undefined);
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
  const targetDialogs = (
    <>
      {chosenProgram && addTarget && (
        <ProgramAssignmentConfirmation
          name={programName(chosenProgram, lang)}
          target={addTarget.kind === "group" ? { group: subjectName(addTarget) } : { riders: [{ id: addTarget.id, name: subjectName(addTarget) }] }}
          busy={busy}
          saving={saving}
          error={dialogError}
          actionId="program-r5-add-confirm"
          onClose={closeAdd}
          onConfirm={putOn}
        />
      )}
      {moveRider && (
        <MoveRiderDialog
          name={riderById.get(moveRider.id)?.name ?? ""}
          add={moveRider.add}
          targets={groupList.filter((g) => !g.members.some((m) => m.riderId === moveRider.id))}
          busy={busy}
          saving={saving}
          error={dialogError}
          onClose={closeMove}
          onMove={moveToGroup}
        />
      )}
    </>
  );

  // --- #8561 tilstande: henter / fejl (foer kataloget er der) og intet program endnu ---------
  const status = programs.status ?? "ready";
  if (status !== "ready") {
    return (
      <div data-testid="program-r5" data-state={status}>
        {status === "loading"
          ? <ProgramR5Skeleton mobile={mobile} />
          : (
            <ErrorState
              title={tR5("programR5.loadErrorTitle")}
              description={tR5("programR5.loadErrorBody")}
              action={(
                <Button variant="secondary" size="sm" className="min-h-11" onClick={() => { void programs.retry?.(); }} data-testid="program-r5-retry">
                  {tR5("programR5.retry")}
                </Button>
              )}
            />
          )}
      </div>
    );
  }
  const nothingYet = library.groups.length === 0 && library.ownOnly.length === 0 && !library.programs.some((p) => p.inUse);
  const emptyEl = nothingYet ? (
    <EmptyState
      icon={<CalendarIcon size={26} aria-hidden="true" />}
      title={tR5("programR5.emptyTitle")}
      description={tR5(groupsOn ? "programR5.emptyBody" : "programR5.emptyBodyNoGroups")}
      action={groupsOn ? (
        <Button variant="secondary" size="sm" className="min-h-11" disabled={busy} onClick={() => openGroupDialog(null)} data-testid="program-r5-empty-new-group">
          <PlusIcon size={13} aria-hidden="true" />{tR5("programR5.manage.newGroup")}
        </Button>
      ) : (
        <Button variant="secondary" size="sm" className="min-h-11" disabled={!chosenProgram || busy} onClick={() => setCopyOpen(true)} data-testid="program-r5-empty-copy">
          {tR5("programR5.copyToRiders")}
        </Button>
      )}
    />
  ) : null;

  // #8547 telefon: Skifter Dag/Uge. "Copy to riders" bliver i sidehovedet, Gem staar fast i bunden.
  if (mobile) {
    const entry = library.programs.find((p) => p.key === programKey);
    const onNames = entry ? [...entry.groups.map((g) => g.name), ...entry.riders.map((id) => riderById.get(id)?.name ?? "")] : [];
    const chipSubjects = subject && !subjects.some((s) => subjectKey(s) === sKey) ? [subject, ...subjects] : subjects;
    const chips: PhoneChip[] = chipSubjects.map((s) => ({
      key: subjectKey(s),
      label: s.kind === "rider" ? shortRiderName(subjectName(s)) : subjectName(s),
      active: subjectKey(s) === sKey,
      group: s.kind === "group",
    }));
    const copyButton = (
      <Button variant="secondary" size="md" className="min-h-11" disabled={!canCopy || busy} onClick={() => setCopyOpen(true)}
        title={canCopy ? undefined : tR5("programR5.copyNeedsProgram")} data-testid="program-r5-copy">
        {tR5("programR5.copyToRiders")}
      </Button>
    );
    const riderType = subject?.kind === "rider" ? riderById.get(subject.id)?.type : null;
    const hasHints = (!!program && !subject) || !!riderDays?.isSeed || !!follow;
    return (
      <div className="flex flex-col" data-testid="program-r5">
        {actionsEl ? createPortal(copyButton, actionsEl) : <div className="mb-3 flex justify-end">{copyButton}</div>}
        {emptyEl && <div className="mb-3">{emptyEl}</div>}
        <ProgramR5Phone
          kindSelector={kindSelector}
          rotationEditor={isRotation ? rotationEditor : null}
          weekBlockEditor={weekBlockEditor}
          focusWeekday={focusWeekday}
          showPlan={!!(program || subject)}
          name={title}
          subtitle={program
            ? `${tR5(`programR5.kind_${kind}`)} · ${onNames.length ? tR5("programR5.on", { names: onNames.join(", ") }) : tR5("programR5.notInUse")}`
            : ""}
          typeLabel={riderType ? tTypes(`types.${riderType}`) : null}
          chips={chips}
          onChip={(key) => setSubject(parseSubjectKey(key))}
          renderLibrary={(close) => (
            <>
              {program && (
                <AppliedTo library={library} programKey={program.key} riders={riders} groups={groupList} busy={busy}
                  touch canAdd={!!chosenProgram} onAdd={(value) => { close(); askToAdd(value); }} onRemoveRider={removeRider} />
              )}
              <LibraryPanel
                library={library}
                catalog={programs.catalog}
                lang={lang}
                selectedProgram={chosenProgram?.key ?? null}
                selectedSubject={sKey}
                touch
                riderName={(id) => riderById.get(id)?.name ?? ""}
                onProgram={(key) => { pickProgram(key); close(); }}
                onSubject={(next) => { pickSubject(next); close(); }}
                // Arket lukkes foer dialogen aabnes, saa der aldrig staar to vinduer oven i hinanden.
                groupActions={menuActions}
                groupBusy={busy}
                onNewGroup={groupsOn ? () => { close(); openGroupDialog(null); } : undefined}
                onGroupAction={groupsOn ? (id, action) => { close(); groupAction(id, action); } : undefined}
                onMoveRider={groupsOn ? (id, add) => { close(); openMove(id, add); } : undefined}
              />
            </>
          )}
          limitEl={limitEl}
          summary={activeTotal > 0
            ? (
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="font-data tabular-nums" data-testid="program-r5-unsaved">{t("weekPlan.unsaved", { n: activeTotal })}</span>
                <button type="button" disabled={busy} onClick={() => setDiscardOpen(true)} data-testid="program-r5-discard"
                  className="inline-flex min-h-11 items-center text-xs font-medium text-cz-1 underline underline-offset-2 disabled:opacity-50">
                  {tR5("programR5.discard")}
                </button>
              </span>
            )
            : (isRotation ? null : program ? programTagline(program, lang) : intro)}
          hints={hasHints ? (
            <div className="flex flex-col gap-1">
              {!subject && <p className="text-2xs text-cz-3">{tR5("programR5.asWrittenNote")}</p>}
              {riderDays?.isSeed && <p className="text-2xs text-cz-3">{t("programs.seededHint")}</p>}
              {follow && (
                <p className="flex flex-wrap items-center gap-x-3 text-2xs text-cz-2">
                  {ownOfGroup && <span>{ownOfGroup}</span>}{followButton}
                </p>
              )}
            </div>
          ) : null}
          footer={(
            <>
              {noteEl}
              {(program || subject) && <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-cz-3">
                <span className="inline-flex items-center gap-1"><FlagIcon size={10} aria-hidden="true" />{tR5("programR5.legendRace")}</span>
                {!isRotation && <span>{tR5("programR5.legendTaken")}</span>}
              </p>}
            </>
          )}
          saveLabel={saving ? t("loading") : tR5("programR5.savePlan")}
          saveDisabled={activeTotal === 0 || busy}
          onSave={isRotation ? saveRotation : savePlan}
          cells={cells}
          weekdays={weekdays}
          todayWeekday={todayWeekday}
          todayLocked={todayLocked}
          editable={editable && !busy}
          sessionOrder={sessionOrder}
          sessionLabel={sessionLabel}
          dayLabel={dayLabel}
          lang={lang}
          tonight={tonightEl}
          onEdit={editCell}
          onCopyDay={copyDay}
        />
        {copyModal}
        {groupModals}
        {targetDialogs}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[256px_minmax(0,1fr)] gap-5" data-testid="program-r5">
      {actionsEl ? createPortal(actions, actionsEl) : <div className="flex justify-end">{actions}</div>}

      <LibraryPanel
        library={library}
        catalog={programs.catalog}
        lang={lang}
        selectedProgram={chosenProgram?.key ?? null}
        selectedSubject={sKey}
        riderName={(id) => riderById.get(id)?.name ?? ""}
        onProgram={pickProgram}
        onSubject={pickSubject}
        groupActions={menuActions}
        groupBusy={busy}
        onNewGroup={groupsOn ? () => openGroupDialog(null) : undefined}
        onGroupAction={groupsOn ? groupAction : undefined}
        onMoveRider={groupsOn ? openMove : undefined}
      />

      <section className="flex min-w-0 flex-col gap-4" aria-label={title}>
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-cz-1">{tR5("programR5.title", { name: title })}</h2>
            <p className="mt-0.5 text-xs text-cz-2">{program ? programTagline(program, lang) : intro}</p>
          </div>
          {kindSelector}
        </header>

        {emptyEl}

        {program && (
          <AppliedTo
            library={library}
            programKey={program.key}
            riders={riders}
            groups={groupList}
            busy={busy}
            canAdd={!!chosenProgram}
            onAdd={askToAdd}
            onRemoveRider={removeRider}
          />
        )}

        {limitEl}

        {(program || subject) && <section>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <h3 className={LABEL}>{tR5("programR5.weekFor")}</h3>
              <Select
                size="sm"
                value={sKey}
                onChange={(e: { target: { value: string } }) => { const next = parseSubjectKey(e.target.value); setSubject(next); }}
                aria-label={tR5("programR5.weekFor")}
                className="min-h-11 w-auto min-w-44 font-semibold"
                data-testid="program-r5-week-for"
              >
                {subjects.length === 0 && !subject && <option value="">{tR5("programR5.asWritten")}</option>}
                {subject && !subjects.some((s) => subjectKey(s) === sKey) && <option value={sKey}>{subjectName(subject)}</option>}
                {subjects.map((s) => <option key={subjectKey(s)} value={subjectKey(s)}>{subjectName(s)}</option>)}
              </Select>
              {subject?.kind === "rider" && riderById.get(subject.id)?.type && (
                <span className="text-2xs text-cz-2">{tTypes(`types.${riderById.get(subject.id)!.type}`)}</span>
              )}
              {followButton}
            </span>
          </div>
          {!subject && <p className="mb-1.5 text-2xs text-cz-3">{tR5("programR5.asWrittenNote")}</p>}
          {riderDays?.isSeed && <p className="mb-1.5 text-2xs text-cz-3">{t("programs.seededHint")}</p>}
          {ownOfGroup && <p className="mb-1.5 text-2xs text-cz-3">{ownOfGroup}</p>}
          {isRotation ? rotationEditor : <WeekGrid
            cells={cells}
            weekdays={weekdays}
            todayWeekday={todayWeekday}
            todayLocked={todayLocked}
            raceCount={raceToday.size}
            editable={editable && !busy}
            sessionOrder={sessionOrder}
            sessionLabel={sessionLabel}
            dayLabel={dayLabel}
            tonight={tonightEl}
            onEdit={editCell}
            onCopyDay={copyDay}
          />}
          {!isRotation && weekBlockEditor}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-cz-3">
            <span className="inline-flex items-center gap-1"><FlagIcon size={10} aria-hidden="true" />{tR5("programR5.legendRace")}</span>
            {!isRotation && <span>{tR5("programR5.legendTaken")}</span>}
          </p>
        </section>}

        {noteEl}
        <p className="inline-flex items-center gap-1 text-2xs text-cz-3" data-testid="program-r5-today-lock">
          <LockIcon size={10} aria-hidden="true" />{tR5("programR5.todayLock")}
        </p>
      </section>

      {copyModal}
      {groupModals}
      {targetDialogs}
    </div>
  );
}

// --- Biblioteket ----------------------------------------------------------------------

function LibraryPanel({
  library, catalog, lang, selectedProgram, selectedSubject, riderName, onProgram, onSubject, touch = false,
  groupActions = [], groupBusy = false, onNewGroup, onGroupAction, onMoveRider,
}: {
  library: Library;
  catalog: CatalogProgram[];
  lang: string;
  selectedProgram: string | null;
  selectedSubject: string;
  touch?: boolean; // telefonens ark: mindst 44 px trykflader
  riderName: (id: string) => string;
  onProgram: (key: string) => void;
  onSubject: (s: Subject) => void;
  // #8560: gruppestyring. Uden handlerne (grupper slukket) vises hverken "+ New group" eller menuen.
  groupActions?: readonly GroupMenuAction[];
  groupBusy?: boolean;
  onNewGroup?: () => void;
  onGroupAction?: (groupId: string, action: GroupMenuAction) => void;
  onMoveRider?: (riderId: string, add: boolean) => void;
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7456: lazy namespace (I18nReadyGate i TrainingPage)
  const nameOf = (key: string | null) => {
    const p = catalog.find((c) => c.key === key);
    return p ? programName(p, lang) : tR5("programR5.ownWeek");
  };
  const row = "border-t border-cz-border px-3 py-2 first:border-t-0";
  const tap = touch ? "min-h-11 " : "";
  const pick = (active: boolean) => (
    `${tap}w-full text-start ${active ? "text-cz-accent-t" : "text-cz-1 hover:text-cz-accent-t"}`
  );
  const moveAction = (id: string, add = false) => onMoveRider && (
    <Button variant="secondary" size="sm" className="shrink-0"
      disabled={groupBusy || !library.groups.some((g) => !g.members.some((m) => m.riderId === id))}
      onClick={() => onMoveRider(id, add)} data-testid="program-r5-move-rider">
      {tR5(add ? "programR5.manage.addToGroup" : "programR5.manage.moveToGroup")}
    </Button>
  );

  return (
    <aside className="flex flex-col gap-4" aria-label={tR5("programR5.library")} data-testid="program-r5-library">
      <section>
        <h3 className={`mb-1.5 ${LABEL}`}>{tR5("programR5.programs")}</h3>
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto" data-testid="program-r5-catalog">
          {library.programs.map((p) => {
            const program = catalog.find((c) => c.key === p.key);
            const active = p.key === selectedProgram;
            const on = [...p.groups.map((g) => g.name), ...p.riders.map(riderName)];
            return (
              <li key={p.key}>
                <button type="button" aria-pressed={active} onClick={() => onProgram(p.key)}
                  className={`${tap}w-full rounded-cz border px-3 py-2 text-start ${active ? "border-cz-1 bg-cz-card" : "border-cz-border bg-cz-card hover:bg-cz-subtle"}`}>
                  {/* #8561: valgt kort = --text-1-kant som en valgt chip (TASTE), aldrig guld-tone. */}
                  <span className="block text-[13px] font-semibold text-cz-1">{programName(program, lang)}</span>
                  <span className="mt-0.5 block text-2xs text-cz-2">{tR5("programR5.kind_week")}</span>
                  <span className="mt-0.5 block truncate text-2xs text-cz-3">
                    {on.length ? tR5("programR5.on", { names: on.join(", ") }) : tR5("programR5.notInUse")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h3 className={`mb-1.5 ${LABEL}`}>{tR5("programR5.groupsAndRiders")}</h3>
        <ul className="rounded-cz border border-cz-border bg-cz-card text-xs">
          {library.groups.map((g) => {
            const gKey = `group:${g.id}`;
            return (
              <li key={g.id} className={row} data-testid="program-r5-group">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => onSubject({ kind: "group", id: g.id })} className={`flex min-w-0 flex-1 items-center gap-1.5 ${pick(selectedSubject === gKey)}`}>
                    <TeamIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{g.name}</span>
                      <span className="block truncate text-2xs text-cz-2">{g.programKey ? nameOf(g.programKey) : tR5("programR5.ownWeek")}</span>
                    </span>
                  </button>
                  {onGroupAction && (
                    <>
                      <Button variant="secondary" size="sm" className="shrink-0" disabled={groupBusy}
                        onClick={() => onGroupAction(g.id, "members")} data-testid="program-r5-group-members">
                        {tR5("programR5.manage.members")}
                      </Button>
                      <GroupMenu name={g.name} actions={groupActions} touch={touch} disabled={groupBusy} onPick={(action) => onGroupAction(g.id, action)} />
                    </>
                  )}
                </div>
                <ul className="mt-1 flex flex-col gap-0.5 ps-5">
                  {g.members.map((m) => (
                    <li key={m.riderId} className="flex items-center gap-x-2 text-2xs" data-testid="program-r5-rider">
                      <button type="button" onClick={() => onSubject({ kind: "rider", id: m.riderId })}
                        className={`${tap}min-w-0 flex-1 break-words text-start ${selectedSubject === `rider:${m.riderId}` ? "text-cz-accent-t" : "text-cz-2 hover:text-cz-1"}`}>
                        {riderName(m.riderId)}
                        {m.own && <span className="block text-cz-2">{tR5("programR5.ownPlan", { name: nameOf(m.ownProgramKey) })}</span>}
                      </button>
                      {moveAction(m.riderId)}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
          {onNewGroup && (
            <li className={row}>
              <button type="button" disabled={groupBusy} onClick={onNewGroup} data-testid="program-r5-new-group"
                className={`${tap}flex w-full items-center gap-1.5 text-start font-medium text-cz-2 hover:text-cz-1 disabled:opacity-50`}>
                <PlusIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />{tR5("programR5.manage.newGroup")}
              </button>
            </li>
          )}
          {library.ownOnly.map((r) => (
            <li key={r.riderId} className={`${row} flex items-center gap-x-2`} data-testid="program-r5-rider">
              <button type="button" onClick={() => onSubject({ kind: "rider", id: r.riderId })}
                className={`flex min-w-0 flex-1 items-center gap-1.5 ${pick(selectedSubject === `rider:${r.riderId}`)}`}>
                <UserIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
                <span className="min-w-0 break-words">
                  {riderName(r.riderId)}
                  <span className="block text-2xs text-cz-2">{tR5("programR5.ownPlan", { name: nameOf(r.programKey) })}</span>
                </span>
              </button>
              {moveAction(r.riderId)}
            </li>
          ))}
          {library.noProgram.map((id) => (
            <li key={id} className={`${row} flex items-center gap-x-2`} data-testid="program-r5-rider">
              <button type="button" onClick={() => onSubject({ kind: "rider", id })}
                className={`flex min-w-0 flex-1 items-center gap-1.5 ${pick(selectedSubject === `rider:${id}`)}`}>
                <UserIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
                <span className="min-w-0 break-words">
                  {riderName(id)}
                  <span className="block text-2xs text-cz-3">{tR5("programR5.noProgram")}</span>
                </span>
              </button>
              {moveAction(id, true)}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-2xs text-cz-3">{tR5("programR5.ownWins")}</p>
      </section>
    </aside>
  );
}

// --- #8560: menuen pr. gruppe og gruppens traethedsgraense ------------------------------

function GroupMenu({
  name, actions, touch, disabled, onPick,
}: {
  name: string;
  actions: readonly GroupMenuAction[];
  touch: boolean;
  disabled: boolean;
  onPick: (action: GroupMenuAction) => void;
}) {
  const { t: tR5 } = useTranslation("trainingR5"); // #7456: lazy namespace (I18nReadyGate i TrainingPage)
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(ref, () => setOpen(false), open);
  const label = tR5("programR5.manage.menu", { name });
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} disabled={disabled}
        onClick={() => setOpen((v) => !v)} data-testid="program-r5-group-menu"
        className={`inline-flex ${touch ? "h-11 w-11" : "h-6 w-6"} items-center justify-center rounded-cz text-cz-3 hover:bg-cz-subtle hover:text-cz-1 disabled:opacity-50`}>
        <MoreIcon size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute end-0 z-dropdown mt-1 min-w-[168px]">
          <Menu aria-label={label}>
            {actions.map((action) => (
              <MenuItem key={action} danger={action === "delete"} className={touch ? "min-h-11" : ""}
                onClick={() => { setOpen(false); onPick(action); }} data-testid={`program-r5-group-${action}`}>
                {tR5(`programR5.manage.${action}`)}
              </MenuItem>
            ))}
          </Menu>
        </div>
      )}
    </div>
  );
}

// Holdets / Egen: N / Fra. Gemmes sammen med dialogens navn og medlemmer.
function GroupLimitFields({
  draft, busy, onChange,
}: {
  draft: GroupLimitDraft;
  busy: boolean;
  onChange: (next: GroupLimitDraft) => void;
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7456: lazy namespace (I18nReadyGate i TrainingPage)
  const valid = groupLimitValid(draft);
  const control = "min-h-11 rounded-cz border border-cz-border bg-cz-card px-2 text-[13px] text-cz-1 disabled:opacity-50 sm:min-h-9";
  const label = tR5("programR5.manage.limitLabel");
  return (
    <div className="flex flex-col gap-2 border-t border-cz-border pt-3" data-testid="program-r5-group-limit-fields">
      <span className="font-data text-2xs font-semibold uppercase tracking-[.04em] text-cz-3">{label}</span>
      <Segmented label={label} value={draft.mode} onChange={(mode: GroupLimitDraft["mode"]) => onChange({ ...draft, mode })}
        options={GROUP_LIMIT_MODES.map((m) => ({ value: m, label: tR5(`programR5.manage.limit_${m}`), disabled: busy }))} />
      {draft.mode === "own" ? (
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-cz-1">
          <span>{tR5("programR5.manage.limitAbove")}</span>
          <input type="number" inputMode="numeric" min={0} max={100} step={1} value={draft.threshold} disabled={busy}
            onChange={(e) => onChange({ ...draft, threshold: e.target.value })}
            aria-label={t("fatigueRule.aboveLabel")} aria-invalid={!valid}
            className={`${control} w-16 font-data tabular-nums`} data-testid="program-r5-group-limit-threshold" />
          <span>{tR5("programR5.manage.limitRun")}</span>
          <select value={draft.fallback} disabled={busy} onChange={(e) => onChange({ ...draft, fallback: e.target.value })}
            aria-label={t("fatigueRule.insteadLabel")} className={control}>
            {FATIGUE_FALLBACKS.map((f) => <option key={f} value={f}>{t(`fatigueRule.fallback_${f}`)}</option>)}
          </select>
          <span>{tR5("programR5.manage.limitInstead")}</span>
        </span>
      ) : (
        <p className="text-xs text-cz-2">{tR5(draft.mode === "team" ? "programR5.manage.limitTeamNote" : "programR5.manage.limitOffNote")}</p>
      )}
      <p className="text-2xs text-cz-3">{t("groups.fatigueLadder")}</p>
    </div>
  );
}

// --- Hvem programmet sidder paa ---------------------------------------------------------

function AppliedTo({
  library, programKey, riders, groups, busy, canAdd, onAdd, onRemoveRider, touch = false,
}: {
  library: Library;
  programKey: string;
  riders: R5Rider[];
  groups: R5Group[];
  busy: boolean;
  touch?: boolean; // telefonens ark: mindst 44 px trykflader
  canAdd: boolean;
  onAdd: (value: string) => void;
  onRemoveRider: (riderId: string) => void;
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7456: lazy namespace (I18nReadyGate i TrainingPage)
  const entry = library.programs.find((p) => p.key === programKey);
  const h = touch ? "h-11" : "h-7";
  const chip = `inline-flex ${h} items-center gap-1 rounded-cz border border-cz-border bg-cz-card ps-2 pe-1 text-xs text-cz-1`;
  const name = (id: string) => riders.find((r) => r.id === id)?.name ?? "";
  const freeGroups = groups.filter((g) => !entry?.groups.some((x) => x.id === g.id));
  const freeRiders = riders.filter((r) => !entry?.riders.includes(r.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="program-r5-applied">
      <span className="text-xs text-cz-2">{tR5("programR5.appliedOn")}</span>
      {entry?.groups.map((g) => (
        <span key={g.id} className={`${chip} pe-2`}>
          <TeamIcon size={12} aria-hidden="true" className="text-cz-3" />{g.name}
          <span className="font-data tabular-nums text-cz-3">{g.following}</span>
        </span>
      ))}
      {entry?.riders.map((id) => (
        <span key={id} className={chip}>
          <UserIcon size={12} aria-hidden="true" className="text-cz-3" />{name(id)}
          <button type="button" disabled={busy} onClick={() => onRemoveRider(id)} aria-label={tR5("programR5.remove", { name: name(id) })}
            className={`inline-flex ${touch ? "h-11 w-11" : "h-6 w-6"} items-center justify-center rounded-cz text-cz-3 hover:text-cz-1 disabled:opacity-50`}>
            <XIcon size={11} />
          </button>
        </span>
      ))}
      {/* #8561: kittets synlige Select (44 px) i stedet for en usynlig native select over en chip. */}
      <Select size="sm" value="" disabled={!canAdd || busy} onChange={(e: { target: { value: string } }) => onAdd(e.target.value)} aria-label={tR5("programR5.addTarget")}
        className="min-h-11 w-auto min-w-44" data-testid="program-r5-add-target">
          <option value="" disabled>{"+ " + tR5("programR5.addTarget")}</option>
          {freeGroups.length > 0 && (
            <optgroup label={tR5("programR5.groups")}>
              {freeGroups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}
            </optgroup>
          )}
          <optgroup label={tR5("programR5.riders")}>
            {freeRiders.map((r) => <option key={r.id} value={`rider:${r.id}`}>{r.name}</option>)}
          </optgroup>
      </Select>
    </div>
  );
}

// --- Ugen ---------------------------------------------------------------------------------

function WeekGrid({
  cells, weekdays, todayWeekday, todayLocked, raceCount, editable, sessionOrder, sessionLabel, dayLabel, tonight,
  onEdit, onCopyDay,
}: {
  cells: WeekCell[][];
  weekdays: readonly string[];
  todayWeekday: string;
  todayLocked: boolean;
  raceCount: number;
  editable: boolean;
  sessionOrder: readonly string[];
  sessionLabel: (s: string) => string;
  dayLabel: (w: string) => string;
  tonight: ReactNode;
  onEdit: (weekday: string, slot: number, session: string) => void;
  onCopyDay: (from: string, choice: string) => void;
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7456: lazy namespace (I18nReadyGate i TrainingPage)
  const head = "border-b border-s border-cz-border bg-cz-subtle px-2.5 py-1.5";
  const sideLabel = "flex items-center border-t border-cz-border px-2 font-data text-3xs uppercase leading-tight tracking-[.06em] text-cz-3";
  return (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" data-testid="program-r5-week">
      <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))]">
        <span className="border-b border-cz-border bg-cz-subtle" />
        {weekdays.map((weekday, dayIndex) => {
          const isToday = weekday === todayWeekday;
          return (
            <div key={weekday} className={head}>
              <span className="flex items-center gap-1 text-xs font-semibold text-cz-1">
                <span className="min-w-0 flex-1 truncate">{dayLabel(weekday)}</span>
                {isToday && (
                  <span className="inline-flex items-center gap-0.5 font-normal text-cz-2" title={tR5("programR5.todayLock")}>
                    {todayLocked && <LockIcon size={10} aria-hidden="true" />}{t("weekPlan.today")}
                  </span>
                )}
                {editable && (
                  <CopyDayMenu
                    // Codex P2 #8589: ugens foerste halvdel aabner mod hoejre, saa menuen bliver
                    // inden for gitterets overflow-hidden-ramme (en end-0-menu paa mandag blev klippet).
                    align={dayIndex < Math.ceil(weekdays.length / 2) ? "start" : "end"}
                    label={tR5("programR5.copyDay", { day: dayLabel(weekday) })}
                    options={[
                      { value: "all", label: tR5("programR5.copyAll") },
                      ...weekdays.filter((w) => w !== weekday && !(todayLocked && w === todayWeekday)).map((w) => ({ value: w, label: dayLabel(w) })),
                    ]}
                    onPick={(choice) => onCopyDay(weekday, choice)}
                  />
                )}
              </span>
              {isToday && raceCount > 0 && (
                <span className="block font-data text-3xs tabular-nums text-cz-2">{tR5("programR5.races", { n: raceCount })}</span>
              )}
            </div>
          );
        })}
        {Array.from({ length: PROGRAM_SLOTS }, (_, slot) => (
          <Row key={slot} slot={slot} cells={cells} weekdays={weekdays} todayWeekday={todayWeekday} todayLocked={todayLocked}
            editable={editable} sessionOrder={sessionOrder} sessionLabel={sessionLabel} dayLabel={dayLabel} onEdit={onEdit} />
        ))}
        <span className={sideLabel}>{t("forecast.label")}</span>
        {weekdays.map((weekday) => (
          <div key={weekday} className="flex min-h-9 items-center border-s border-t border-cz-border px-2.5 py-1.5">
            {weekday === todayWeekday ? tonight : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({
  slot, cells, weekdays, todayWeekday, todayLocked, editable, sessionOrder, sessionLabel, dayLabel, onEdit,
}: {
  slot: number;
  cells: WeekCell[][];
  weekdays: readonly string[];
  todayWeekday: string;
  todayLocked: boolean;
  editable: boolean;
  sessionOrder: readonly string[];
  sessionLabel: (s: string) => string;
  dayLabel: (w: string) => string;
  onEdit: (weekday: string, slot: number, session: string) => void;
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7456: lazy namespace (I18nReadyGate i TrainingPage)
  return (
    <>
      <span className="flex items-center border-t border-cz-border px-2 font-data text-3xs font-semibold tabular-nums text-cz-2">
        {t("mobile.raceDayShort", { n: slot + 1 })}
      </span>
      {weekdays.map((weekday, d) => {
        const cell = cells[d][slot];
        const base = "relative flex min-h-[44px] items-center border-s border-t border-cz-border px-2.5 py-1.5 text-xs";
        if (cell.kind === "race") {
          return (
            <div key={weekday} className={`${base} gap-1 bg-cz-subtle text-cz-2`} data-testid="program-r5-race">
              <FlagIcon size={11} aria-hidden="true" className="shrink-0" />{tR5("programR5.race")}
            </div>
          );
        }
        if (cell.kind === "rest") {
          return <div key={weekday} className={`${base} text-cz-2`} data-testid="program-r5-week-rest">{sessionLabel("rest")}</div>;
        }
        if (cell.kind === "ran") {
          return (
            <div key={weekday} className={`${base} gap-1 text-cz-3`} title={t("settleAfterStage.ranTitle")}>
              <LockIcon size={10} aria-hidden="true" className="shrink-0" />{t("settleAfterStage.ran")}
            </div>
          );
        }
        const locked = todayLocked && weekday === todayWeekday;
        const label = `${dayLabel(weekday)} · ${t("mobile.raceDayShort", { n: slot + 1 })}`;
        const dot = cell.changed
          ? <span className="ms-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cz-2" aria-label={tR5("programR5.notSaved")} />
          : null;
        if (editable && !locked) {
          // #8561: kittets Select, synlig (tekst + chevron) og 44 px; kanten vises ved hover/fokus.
          return (
            <div key={weekday} className={`${base} px-1`}>
              <div className="relative min-w-0 flex-1">
                {/* Kittets felt-stil (controlClass, som Select) med en smal chevron, saa sessionsnavnet
                    kan laeses i en syvendedel af ugen; Select's faste pr-9 afkortede det. */}
                <select value={cell.session ?? ""} onChange={(e) => onEdit(weekday, slot, e.target.value)}
                  aria-label={label} title={cell.session ? sessionLabel(cell.session) : undefined} data-testid="program-r5-cell"
                  className={`${controlClass({ size: "sm" })} min-h-11 cursor-pointer appearance-none truncate border-transparent bg-transparent pe-5 ps-1.5 hover:border-cz-border ${cell.session ? "text-cz-1" : "text-cz-3"}`}>
                  {!cell.session && <option value="" disabled>–</option>}
                  {sessionOrder.map((s) => <option key={s} value={s}>{sessionLabel(s)}</option>)}
                </select>
                <ChevronDownIcon size={12} aria-hidden="true" className="pointer-events-none absolute end-1 top-1/2 -translate-y-1/2 text-cz-3" />
              </div>
              {dot}
            </div>
          );
        }
        return (
          <div key={weekday} className={base}>
            <span className={`min-w-0 flex-1 truncate ${cell.session ? "text-cz-1" : "text-cz-3"}`}>
              {cell.session ? sessionLabel(cell.session) : "–"}
            </span>
            {dot}
          </div>
        );
      })}
    </>
  );
}

// #8561: kopier dagen via en synlig menu-knap (44 px trykflade) i stedet for en usynlig select.
function CopyDayMenu({
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
    <div ref={ref} className="relative -my-2 -me-2 shrink-0">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}
        onClick={() => setOpen((v) => !v)} data-testid="program-r5-copy-day"
        className="inline-flex h-11 w-7 items-center justify-center rounded-cz text-cz-3 hover:bg-cz-card hover:text-cz-1">
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

// #8561: henter-tilstanden. Statiske graa linjer (ingen puls), samme geometri som biblioteket +
// ugen, saa intet hopper, naar kataloget lander (PAGE_TEMPLATES, Canonical states).
function ProgramR5Skeleton({ mobile }: { mobile: boolean }) {
  const week = (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card p-3" aria-hidden="true">
      <Skeleton className="mb-3 h-4 w-40" />
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 * (PROGRAM_SLOTS + 1) }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    </div>
  );
  if (mobile) {
    return (
      <div className="flex flex-col gap-3" data-testid="program-r5-loading">
        <Skeleton className="h-5 w-48" />
        <SkeletonLines lines={2} />
        {week}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[256px_minmax(0,1fr)] gap-5" data-testid="program-r5-loading">
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-64" />
        {week}
      </div>
    </div>
  );
}

export function ProgramAssignmentConfirmation({
  name, target, busy, saving, error, actionId, onClose, onConfirm,
}: {
  name: string;
  target: { group: string } | { riders: Pick<R5Rider, "id" | "name">[] };
  busy: boolean;
  saving: boolean;
  error?: boolean;
  actionId: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t: tR5 } = useTranslation("trainingR5");
  const title = "group" in target
    ? tR5("programR5.confirmGroup", { name, group: target.group })
    : tR5("programR5.confirmRiders", { name, n: target.riders.length });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={title}
      titleId="program-r5-confirm-title"
      ariaLabelledby={undefined}
      description={null}
      closeLabel={tR5("programR5.cancel")}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={onClose}>{tR5("programR5.cancel")}</Button>
          <Button variant="primary" disabled={busy} onClick={onConfirm} data-testid={actionId}>{tR5("programR5.confirm")}</Button>
        </>
      }
    >
      {"riders" in target && (
        <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto text-xs text-cz-2">
          {target.riders.map((rider) => <li key={rider.id}>{rider.name}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-cz-danger">{tR5("programR5.saveError")}</p>}
    </Modal>
  );
}

export function MoveRiderDialog({
  name, add, targets, busy, saving, error, onClose, onMove,
}: {
  name: string;
  add: boolean;
  targets: R5Group[];
  busy: boolean;
  saving: boolean;
  error: boolean;
  onClose: () => void;
  onMove: (id: string) => void;
}) {
  const { t: tR5 } = useTranslation("trainingR5");
  const [groupId, setGroupId] = useState("");
  const action = tR5(add ? "programR5.manage.addToGroup" : "programR5.manage.moveToGroup");
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={action}
      titleId="program-r5-move-title"
      ariaLabelledby={undefined}
      description={null}
      closeLabel={tR5("programR5.cancel")}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={onClose}>{tR5("programR5.cancel")}</Button>
          <Button variant="primary" disabled={busy || !targets.some((g) => g.id === groupId)}
            onClick={() => onMove(groupId)} data-testid="program-r5-move-confirm">{action}</Button>
        </>
      }
    >
      <p className="mb-2 text-xs text-cz-2">{name}</p>
      <Select size="sm" value={groupId} disabled={busy} onChange={(e: { target: { value: string } }) => setGroupId(e.target.value)}
        aria-label={tR5("programR5.manage.chooseGroup")} className="min-h-11" data-testid="program-r5-move-target">
        <option value="" disabled>{tR5("programR5.manage.chooseGroup")}</option>
        {targets.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </Select>
      {error && <p role="alert" className="mt-2 text-xs text-cz-danger">{tR5("programR5.saveError")}</p>}
    </Modal>
  );
}

// --- Copy to riders ---------------------------------------------------------------------

function CopyToRiders({
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
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7456: lazy namespace (I18nReadyGate i TrainingPage)
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [recipients, setRecipients] = useState<R5Rider[] | null>(null);
  const selectedRiders = candidates.filter((r) => picked.has(r.id));
  const [keepPlace, setKeepPlace] = useState(true);
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
      actionId="program-r5-copy-confirm"
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
      titleId="program-r5-copy-title"
      ariaLabelledby={undefined}
      description={null}
      closeLabel={tR5("programR5.cancel")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{tR5("programR5.cancel")}</Button>
          <Button variant="primary" disabled={selectedRiders.length === 0 || busy} onClick={() => setRecipients(selectedRiders)} data-testid="program-r5-copy-go">
            {tR5("programR5.continue")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-cz-2">{tR5(rotation ? "programR5.rotation.copyBody" : "programR5.copyBody")}</p>
      {rotation && (
        <Checkbox id="program-r5-copy-restart" label={tR5("programR5.rotation.restart")}
          checked={!keepPlace} onChange={() => setKeepPlace((value) => !value)} />
      )}
      <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
        {candidates.map((r) => (
          <li key={r.id}>
            <Checkbox id={`program-r5-copy-${r.id}`} label={r.name} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
          </li>
        ))}
      </ul>
    </Modal>
  );
}
