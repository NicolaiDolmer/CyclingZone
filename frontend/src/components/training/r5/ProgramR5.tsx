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
import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Button from "../../ui/Button.jsx";
import Checkbox from "../../ui/Checkbox.jsx";
import Modal from "../../ui/Modal.jsx";
import Segmented from "../../ui/Segmented.jsx";
import {
  ClipboardIcon, FlagIcon, LockIcon, PlusIcon, TeamIcon, UserIcon, XIcon,
} from "../../ui/icons/index.jsx";
import FatigueForecast from "../FatigueForecast.tsx";
import FatigueRuleSummary from "../FatigueRuleSummary.tsx";
import FatigueRulePanel from "../FatigueRulePanel.tsx";
import { SESSION_ORDER, SESSION_ORDER_V3 } from "../TrainingPlanCard.tsx";
import { groupForecastEntry } from "../groups/trainingGroupsModel.ts";
import { todayLockedSlots } from "../settleAfterStage7982/settleAfterStageModel.ts";
import { raceSlotsFor, type ForecastEntry, type ForecastResponse } from "../FatigueForecastModel.ts";
import type { FatigueRulesClient } from "../useFatigueRules.ts";
import type { TrainingGroupsClient } from "../groups/useTrainingGroups.ts";
import type { ProgramsResult } from "../useTrainingPrograms.ts";
import { sessionI18nKey } from "../../../lib/trainingDayTypes.js";
import { PROGRAM_SLOTS, programName, programTagline, type CatalogProgram, type ProgramWeekDays } from "../../../lib/trainingPrograms.ts";
import {
  AVAILABLE_KINDS, PROGRAM_VIEW_STORE, buildLibrary, catalogWeekDays, copyCandidates, copyDayIntoDraft, copyDayTargets,
  draftSteps, draftTotal, parseSubjectKey, programKeyOf, rememberedKind, riderWeekDays, setDraftCell, shortRiderName,
  subjectKey, subjectsFor, weekCells, type Draft, type Kind, type Library, type R5Group, type R5Rider, type Subject,
  type WeekCell,
} from "./programR5Model.ts";
import ProgramR5Phone, { type PhoneChip } from "./ProgramR5Phone.tsx";

type RawRider = { id: string; firstname?: string | null; lastname?: string | null; primary_type?: string | null };
type ProgramsClient = {
  catalog: CatalogProgram[];
  assigned: Record<string, string>;
  seeds: Record<string, ProgramWeekDays>;
  busy: boolean;
  applyProgram: (programKey: string, target: string) => Promise<ProgramsResult>;
  setCell: (riderId: string, weekday: string, slotIndex: number | null, session: string) => Promise<ProgramsResult>;
};

const FIRST_PROGRAMS = 5;
const LABEL = "font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";

function loadKind(): Kind {
  try { return rememberedKind(localStorage.getItem(PROGRAM_VIEW_STORE)); } catch { return "week"; }
}
function saveKind(kind: Kind) {
  try { localStorage.setItem(PROGRAM_VIEW_STORE, kind); } catch { /* privat vindue: valget huskes bare ikke */ }
}

export default function ProgramR5({
  riders: rawRiders, weekdays, todayWeekday, todayLocked, riderWeekPlans, programs, groups, forecast, fatigueRules,
  catalogV3, actionsEl, mobile, onClearRider, drafts, onDrafts: setDrafts, request = null, onRequestHandled,
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
  onClearRider: (riderId: string) => Promise<{ ok: boolean }>;
  // Kladderne bor paa siden (som ugeplan-kladderne), saa et fanebyt ikke kasserer dem.
  drafts: Record<string, Draft>;
  onDrafts: Dispatch<SetStateAction<Record<string, Draft>>>;
  // #8533 Codex P2: "Rediger plan" paa en rytter / "Rediger" paa traethedsgraensen fra I dag.
  // `n` skifter ved hver anmodning, saa samme rytter kan vaelges igen.
  request?: { kind: "rider" | "limit"; id?: string; n: number } | null;
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

  const [kind, setKindRaw] = useState<Kind>(loadKind);
  const setKind = (next: Kind) => { setKindRaw(next); saveKind(next); };
  const [programKey, setProgramKey] = useState<string | null>(() => library.programs[0]?.key ?? null);
  const [subject, setSubject] = useState<Subject | null>(() => subjectsFor(library.programs[0]?.key ?? null, library)[0] ?? null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);

  // Kataloget kan lande efter fanen: vaelg da det foerste program, saa fanen aldrig staar tom.
  const firstKey = library.programs[0]?.key ?? null;
  useEffect(() => {
    if (programKey || subject || !firstKey) return;
    setProgramKey(firstKey);
    setSubject(subjectsFor(firstKey, library)[0] ?? null);
  }, [firstKey, programKey, subject, library]);

  // #8533 Codex P2: en anmodning udefra vaelger rytteren (i det program, han hoerer til) eller aabner graensen.
  const handledRequest = useRef(0);
  useEffect(() => {
    if (!request || request.n === handledRequest.current) return;
    handledRequest.current = request.n;
    onRequestHandled?.();
    if (request.kind === "limit") { setLimitOpen(true); return; }
    if (!request.id) return;
    const riderId = request.id;
    const key = library.programs.find((p) => subjectsFor(p.key, library).some((s) => s.kind === "rider" && s.id === riderId))?.key;
    if (key) setProgramKey(key);
    setSubject({ kind: "rider", id: riderId });
  }, [request, library, onRequestHandled]);

  const program = programs.catalog.find((p) => p.key === programKey) ?? null;
  const subjects = subjectsFor(programKey, library);
  const busy = programs.busy || groups.busy || saving;
  const sKey = subjectKey(subject);
  const draft = drafts[sKey] ?? {};
  const total = draftTotal(drafts);

  const pickProgram = (key: string) => {
    setProgramKey(key);
    setSubject(subjectsFor(key, library)[0] ?? null);
    setNote(null);
  };
  const pickSubject = (next: Subject) => {
    setProgramKey(programKeyOf(next, library));
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
  const cells = weekCells({ days, draft, weekdays, todayWeekday, raceToday, lockedToday });
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

  const editCell = (weekday: string, slot: number, session: string) => {
    setDrafts((prev) => ({ ...prev, [sKey]: setDraftCell(prev[sKey] ?? {}, days, weekday, slot, session) }));
  };
  const copyDay = (from: string, choice: string) => {
    const targets = copyDayTargets(from, choice, weekdays, { todayWeekday, todayLocked });
    setDrafts((prev) => ({ ...prev, [sKey]: copyDayIntoDraft(prev[sKey] ?? {}, days, from, targets) }));
  };

  // Save plan: hver rettelse er en felt-skrivning til den eksisterende API (rytter eller gruppe).
  const savePlan = async () => {
    setSaving(true);
    let failed = false;
    const left: Record<string, Draft> = {};
    for (const [key, d] of Object.entries(drafts)) {
      const target = parseSubjectKey(key);
      if (!target) continue;
      const rest: Record<string, string> = { ...d };
      for (const step of draftSteps(d, weekdays)) {
        const result = target.kind === "group"
          ? await groups.setCell(target.id, step.weekday, step.slotIndex, step.session)
          : await programs.setCell(target.id, step.weekday, step.slotIndex, step.session);
        if (!result.ok) { failed = true; break; }
        delete rest[`${step.weekday}:${step.slotIndex}`];
      }
      if (Object.keys(rest).length) left[key] = rest;
    }
    // En rytters felt-gem goer planen til hans egen; gruppeklienten skal se det.
    if (Object.keys(drafts).some((key) => parseSubjectKey(key)?.kind === "rider")) await groups.reload();
    setDrafts(left);
    setSaving(false);
    setNote(failed ? { tone: "error", text: tR5("programR5.saveError") } : { tone: "ok", text: tR5("programR5.saved") });
  };

  const putOn = async (value: string) => {
    const target = parseSubjectKey(value);
    if (!target || !programKey) return;
    const result = target.kind === "group"
      ? await groups.putProgram(target.id, programKey)
      : await programs.applyProgram(programKey, target.id);
    // Et program paa en rytter tager ham ud af gruppen; genindlaes saa biblioteket ser det.
    if (target.kind === "rider") await groups.reload();
    if (result.ok) setSubject(target);
    setNote(result.ok ? null : { tone: "error", text: tR5("programR5.saveError") });
  };
  const removeRider = async (riderId: string) => {
    const result = await onClearRider(riderId);
    await groups.reload();
    if (!result.ok) setNote({ tone: "error", text: tR5("programR5.saveError") });
  };

  const actions = (
    <span className="flex items-center gap-2">
      <Button variant="secondary" size="sm" disabled={!programKey || busy} onClick={() => setCopyOpen(true)}
        title={programKey ? undefined : tR5("programR5.copyNeedsProgram")} data-testid="program-r5-copy">
        {tR5("programR5.copyToRiders")}
      </Button>
      <Button variant="primary" size="sm" disabled={total === 0 || busy} onClick={savePlan} data-testid="program-r5-save">
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
      {limitOpen && <div className="border-t border-cz-border p-4"><FatigueRulePanel rules={fatigueRules} /></div>}
    </div>
  ) : null;
  const noteEl = note ? (
    <p role="status" className={`text-xs ${note.tone === "ok" ? "text-cz-success" : "text-cz-danger"}`}>{note.text}</p>
  ) : null;
  const copyModal = copyOpen && program ? (
    <CopyToRiders
      program={program}
      lang={lang}
      candidates={copyCandidates(program.key, library, riders)}
      busy={busy}
      onClose={() => setCopyOpen(false)}
      onCopy={async (ids) => {
        let done = 0;
        for (const id of ids) {
          const result = await programs.applyProgram(program.key, id);
          if (result.ok) done += 1;
        }
        if (ids.length) await groups.reload();
        setCopyOpen(false);
        setNote(done === ids.length
          ? { tone: "ok", text: tR5("programR5.copyDone", { n: done }) }
          : { tone: "error", text: tR5("programR5.saveError") });
      }}
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
      <Button variant="secondary" size="md" className="min-h-11" disabled={!programKey || busy} onClick={() => setCopyOpen(true)}
        title={programKey ? undefined : tR5("programR5.copyNeedsProgram")} data-testid="program-r5-copy">
        {tR5("programR5.copyToRiders")}
      </Button>
    );
    const riderType = subject?.kind === "rider" ? riderById.get(subject.id)?.type : null;
    const hasHints = !subject || !!riderDays?.isSeed;
    return (
      <div className="flex flex-col" data-testid="program-r5">
        {actionsEl ? createPortal(copyButton, actionsEl) : <div className="mb-3 flex justify-end">{copyButton}</div>}
        <ProgramR5Phone
          name={title}
          subtitle={program
            ? `${tR5("programR5.kind_week")} · ${onNames.length ? tR5("programR5.on", { names: onNames.join(", ") }) : tR5("programR5.notInUse")}`
            : ""}
          typeLabel={riderType ? tTypes(`types.${riderType}`) : null}
          chips={chips}
          onChip={(key) => setSubject(parseSubjectKey(key))}
          renderLibrary={(close) => (
            <>
              {program && (
                <AppliedTo library={library} programKey={program.key} riders={riders} groups={groupList} busy={busy}
                  touch onAdd={putOn} onRemoveRider={removeRider} />
              )}
              <LibraryPanel
                library={library}
                catalog={programs.catalog}
                lang={lang}
                selectedProgram={programKey}
                selectedSubject={sKey}
                touch
                riderName={(id) => riderById.get(id)?.name ?? ""}
                onProgram={(key) => { pickProgram(key); close(); }}
                onSubject={(next) => { pickSubject(next); close(); }}
              />
            </>
          )}
          limitEl={limitEl}
          summary={total > 0
            ? <span className="font-data tabular-nums" data-testid="program-r5-unsaved">{t("weekPlan.unsaved", { n: total })}</span>
            : (program ? programTagline(program, lang) : intro)}
          hints={hasHints ? (
            <div className="flex flex-col gap-1">
              {!subject && <p className="text-2xs text-cz-3">{tR5("programR5.asWrittenNote")}</p>}
              {riderDays?.isSeed && <p className="text-2xs text-cz-3">{t("programs.seededHint")}</p>}
            </div>
          ) : null}
          footer={(
            <>
              {noteEl}
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-cz-3">
                <span className="inline-flex items-center gap-1"><FlagIcon size={10} aria-hidden="true" />{tR5("programR5.legendRace")}</span>
                <span>{tR5("programR5.legendTaken")}</span>
              </p>
            </>
          )}
          saveLabel={saving ? t("loading") : tR5("programR5.savePlan")}
          saveDisabled={total === 0 || busy}
          onSave={savePlan}
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
        selectedProgram={programKey}
        selectedSubject={sKey}
        riderName={(id) => riderById.get(id)?.name ?? ""}
        onProgram={pickProgram}
        onSubject={pickSubject}
      />

      <section className="flex min-w-0 flex-col gap-4" aria-label={title}>
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-cz-1">{tR5("programR5.title", { name: title })}</h2>
            <p className="mt-0.5 text-xs text-cz-2">{program ? programTagline(program, lang) : intro}</p>
          </div>
          {AVAILABLE_KINDS.length > 1 && (
            <Segmented label={tR5("programR5.kindLabel")} value={kind} onChange={setKind}
              options={AVAILABLE_KINDS.map((k) => ({ value: k, label: tR5(`programR5.kind_${k}`) }))} />
          )}
        </header>

        {program && (
          <AppliedTo
            library={library}
            programKey={program.key}
            riders={riders}
            groups={groupList}
            busy={busy}
            onAdd={putOn}
            onRemoveRider={removeRider}
          />
        )}

        {limitEl}

        <section>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <h3 className={LABEL}>{tR5("programR5.weekFor")}</h3>
              <select
                value={sKey}
                onChange={(e) => { const next = parseSubjectKey(e.target.value); setSubject(next); }}
                aria-label={tR5("programR5.weekFor")}
                className="rounded-cz border border-cz-border bg-cz-card py-1 pe-2 ps-2 text-xs font-semibold text-cz-1"
              >
                {subjects.length === 0 && !subject && <option value="">{tR5("programR5.asWritten")}</option>}
                {subject && !subjects.some((s) => subjectKey(s) === sKey) && <option value={sKey}>{subjectName(subject)}</option>}
                {subjects.map((s) => <option key={subjectKey(s)} value={subjectKey(s)}>{subjectName(s)}</option>)}
              </select>
              {subject?.kind === "rider" && riderById.get(subject.id)?.type && (
                <span className="text-2xs text-cz-2">{tTypes(`types.${riderById.get(subject.id)!.type}`)}</span>
              )}
            </span>
            {total > 0 && (
              <span className="font-data text-xs tabular-nums text-cz-2" data-testid="program-r5-unsaved">{t("weekPlan.unsaved", { n: total })}</span>
            )}
          </div>
          {!subject && <p className="mb-1.5 text-2xs text-cz-3">{tR5("programR5.asWrittenNote")}</p>}
          {riderDays?.isSeed && <p className="mb-1.5 text-2xs text-cz-3">{t("programs.seededHint")}</p>}
          <WeekGrid
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
          />
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-cz-3">
            <span className="inline-flex items-center gap-1"><FlagIcon size={10} aria-hidden="true" />{tR5("programR5.legendRace")}</span>
            <span>{tR5("programR5.legendTaken")}</span>
          </p>
        </section>

        {noteEl}
        <p className="inline-flex items-center gap-1 text-2xs text-cz-3" data-testid="program-r5-today-lock">
          <LockIcon size={10} aria-hidden="true" />{tR5("programR5.todayLock")}
        </p>
      </section>

      {copyModal}
    </div>
  );
}

// --- Biblioteket ----------------------------------------------------------------------

function LibraryPanel({
  library, catalog, lang, selectedProgram, selectedSubject, riderName, onProgram, onSubject, touch = false,
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
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7456: lazy namespace (I18nReadyGate i TrainingPage)
  const [showAll, setShowAll] = useState(false);
  const inUse = library.programs.filter((p) => p.inUse);
  // Programmer i brug; er intet i brug endnu, de foerste fra kataloget. Resten bag "All programs".
  const short = inUse.length ? inUse : library.programs.slice(0, FIRST_PROGRAMS);
  const visible = showAll ? library.programs : short;
  const nameOf = (key: string | null) => {
    const p = catalog.find((c) => c.key === key);
    return p ? programName(p, lang) : tR5("programR5.ownWeek");
  };
  const row = "border-t border-cz-border px-3 py-2 first:border-t-0";
  const tap = touch ? "min-h-11 " : "";
  const pick = (active: boolean) => (
    `${tap}w-full text-start ${active ? "text-cz-accent-t" : "text-cz-1 hover:text-cz-accent-t"}`
  );

  return (
    <aside className="flex flex-col gap-4" aria-label={tR5("programR5.library")} data-testid="program-r5-library">
      <section>
        <h3 className={`mb-1.5 ${LABEL}`}>{tR5("programR5.programs")}</h3>
        <ul className="flex flex-col gap-1">
          {visible.map((p) => {
            const program = catalog.find((c) => c.key === p.key);
            const active = p.key === selectedProgram;
            const on = [...p.groups.map((g) => g.name), ...p.riders.map(riderName)];
            return (
              <li key={p.key}>
                <button type="button" aria-pressed={active} onClick={() => onProgram(p.key)}
                  className={`w-full rounded-cz border px-3 py-2 text-start ${active ? "border-cz-accent/50 bg-cz-accent/10" : "border-cz-border bg-cz-card hover:bg-cz-subtle"}`}>
                  <span className={`block text-[13px] font-semibold ${active ? "text-cz-accent-t" : "text-cz-1"}`}>{programName(program, lang)}</span>
                  <span className="mt-0.5 block text-2xs text-cz-2">{tR5("programR5.kind_week")}</span>
                  <span className="mt-0.5 block truncate text-2xs text-cz-3">
                    {on.length ? tR5("programR5.on", { names: on.join(", ") }) : tR5("programR5.notInUse")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {short.length < library.programs.length && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className={`${tap}mt-1.5 text-xs font-medium text-cz-2 hover:text-cz-1`}
            aria-expanded={showAll}>
            {showAll ? tR5("programR5.fewerPrograms") : tR5("programR5.allPrograms", { n: library.programs.length })}
          </button>
        )}
      </section>

      <section>
        <h3 className={`mb-1.5 ${LABEL}`}>{tR5("programR5.groupsAndRiders")}</h3>
        <ul className="rounded-cz border border-cz-border bg-cz-card text-xs">
          {library.groups.map((g) => {
            const gKey = `group:${g.id}`;
            return (
              <li key={g.id} className={row}>
                <button type="button" onClick={() => onSubject({ kind: "group", id: g.id })} className={`flex items-center gap-1.5 ${pick(selectedSubject === gKey)}`}>
                  <TeamIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
                  <span className="truncate font-semibold">{g.name}</span>
                  <span className="ms-auto shrink-0 text-cz-2">{g.programKey ? nameOf(g.programKey) : tR5("programR5.ownWeek")}</span>
                </button>
                <ul className="mt-1 flex flex-col gap-0.5 ps-5">
                  {g.members.map((m) => (
                    <li key={m.riderId} className="flex items-center justify-between gap-2 text-2xs">
                      <button type="button" onClick={() => onSubject({ kind: "rider", id: m.riderId })}
                        className={`${tap}min-w-0 truncate text-start ${selectedSubject === `rider:${m.riderId}` ? "text-cz-accent-t" : "text-cz-2 hover:text-cz-1"}`}>
                        {riderName(m.riderId)}
                      </button>
                      {m.own && <span className="shrink-0 text-cz-1">{tR5("programR5.ownPlan", { name: nameOf(m.ownProgramKey) })}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
          {library.ownOnly.map((r) => (
            <li key={r.riderId} className={row}>
              <button type="button" onClick={() => onSubject({ kind: "rider", id: r.riderId })}
                className={`flex items-center gap-1.5 ${pick(selectedSubject === `rider:${r.riderId}`)}`}>
                <UserIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
                <span className="truncate">{riderName(r.riderId)}</span>
                <span className="ms-auto shrink-0 text-cz-2">{tR5("programR5.ownPlan", { name: nameOf(r.programKey) })}</span>
              </button>
            </li>
          ))}
          {library.noProgram.map((id) => (
            <li key={id} className={row}>
              <button type="button" onClick={() => onSubject({ kind: "rider", id })}
                className={`flex items-center gap-1.5 ${pick(selectedSubject === `rider:${id}`)}`}>
                <UserIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
                <span className="truncate text-cz-2">{riderName(id)}</span>
                <span className="ms-auto shrink-0 text-cz-3">{tR5("programR5.noProgram")}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-2xs text-cz-3">{tR5("programR5.ownWins")}</p>
      </section>
    </aside>
  );
}

// --- Hvem programmet sidder paa ---------------------------------------------------------

function AppliedTo({
  library, programKey, riders, groups, busy, onAdd, onRemoveRider, touch = false,
}: {
  library: Library;
  programKey: string;
  riders: R5Rider[];
  groups: R5Group[];
  busy: boolean;
  touch?: boolean; // telefonens ark: mindst 44 px trykflader
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
      <span className={`relative inline-flex ${h} items-center gap-1 rounded-cz border border-dashed border-cz-border px-2 text-xs text-cz-2 hover:text-cz-1`}>
        <PlusIcon size={12} aria-hidden="true" />{tR5("programR5.addTarget")}
        <select value="" disabled={busy} onChange={(e) => onAdd(e.target.value)} aria-label={tR5("programR5.addTarget")}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default">
          <option value="" disabled>{tR5("programR5.addTarget")}</option>
          {freeGroups.length > 0 && (
            <optgroup label={tR5("programR5.groups")}>
              {freeGroups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}
            </optgroup>
          )}
          <optgroup label={tR5("programR5.riders")}>
            {freeRiders.map((r) => <option key={r.id} value={`rider:${r.id}`}>{r.name}</option>)}
          </optgroup>
        </select>
      </span>
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
        {weekdays.map((weekday) => {
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
                  <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-cz text-cz-3 hover:bg-cz-card hover:text-cz-1" title={tR5("programR5.copyDay", { day: dayLabel(weekday) })}>
                    <ClipboardIcon size={12} aria-hidden="true" />
                    <select value="" onChange={(e) => onCopyDay(weekday, e.target.value)} aria-label={tR5("programR5.copyDay", { day: dayLabel(weekday) })}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
                      <option value="" disabled>{tR5("programR5.copyDay", { day: dayLabel(weekday) })}</option>
                      <option value="all">{tR5("programR5.copyAll")}</option>
                      {weekdays.filter((w) => w !== weekday && !(todayLocked && w === todayWeekday)).map((w) => (
                        <option key={w} value={w}>{dayLabel(w)}</option>
                      ))}
                    </select>
                  </span>
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
        if (cell.kind === "ran") {
          return (
            <div key={weekday} className={`${base} gap-1 text-cz-3`} title={t("settleAfterStage.ranTitle")}>
              <LockIcon size={10} aria-hidden="true" className="shrink-0" />{t("settleAfterStage.ran")}
            </div>
          );
        }
        const locked = todayLocked && weekday === todayWeekday;
        const label = `${dayLabel(weekday)} · ${t("mobile.raceDayShort", { n: slot + 1 })}`;
        return (
          <div key={weekday} className={`${base} ${editable && !locked ? "hover:bg-cz-subtle" : ""}`}>
            <span className={`min-w-0 flex-1 truncate ${cell.session ? "text-cz-1" : "text-cz-3"}`}>
              {cell.session ? sessionLabel(cell.session) : "–"}
            </span>
            {cell.changed && (
              <span className="ms-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cz-2" aria-label={tR5("programR5.notSaved")} />
            )}
            {editable && !locked && (
              <select value={cell.session ?? ""} onChange={(e) => onEdit(weekday, slot, e.target.value)} aria-label={label}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
                {!cell.session && <option value="" disabled>–</option>}
                {sessionOrder.map((s) => <option key={s} value={s}>{sessionLabel(s)}</option>)}
              </select>
            )}
          </div>
        );
      })}
    </>
  );
}

// --- Copy to riders ---------------------------------------------------------------------

function CopyToRiders({
  program, lang, candidates, busy, onClose, onCopy,
}: {
  program: CatalogProgram;
  lang: string;
  candidates: R5Rider[];
  busy: boolean;
  onClose: () => void;
  onCopy: (riderIds: string[]) => void;
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5"); // #7456: lazy namespace (I18nReadyGate i TrainingPage)
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={tR5("programR5.copyTitle", { name: programName(program, lang) })}
      titleId="program-r5-copy-title"
      ariaLabelledby={undefined}
      description={null}
      closeLabel={tR5("programR5.cancel")}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{tR5("programR5.cancel")}</Button>
          <Button variant="primary" disabled={picked.size === 0 || busy} onClick={() => onCopy([...picked])} data-testid="program-r5-copy-go">
            {tR5("programR5.copyGo", { n: picked.size })}
          </Button>
        </>
      )}
    >
      <p className="mb-3 text-xs text-cz-2">{tR5("programR5.copyBody")}</p>
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
