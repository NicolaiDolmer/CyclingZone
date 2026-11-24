// ProgramR5Phone — telefonudgaven af Program-fanen R5 (#8547/#7456, ejer 21/11), bag
// training_page_r5. Ejerens valg paa billederne i PR #8506: en SKIFTER mellem to visninger,
//   Dag   en dag ad gangen, dagene i EN linje med en pil i hver side (og swipe),
//   Uge   hele ugen som liste med de fulde sessionsnavne; en dag foldes ud og rettes.
// Hovedet: programnavnet som overskrift oeverst, rytterne (og grupperne) som chips under, saa
// program- og rytter-valg ikke ligner samme valg to gange. Gem (sidens ene guldknap) staar
// fast i bunden over appens bundmenu; "Copy to riders" bliver i sidehovedet (TrainingPage).
//
// Komponenten er ren visning: data, kladder og gemme-kald ejes af ProgramR5 (samme som
// desktop: programR5Drafts og PUT .../cell). Valget Dag/Uge huskes pr. enhed.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Button from "../../ui/Button.jsx";
import Modal from "../../ui/Modal.jsx";
import Segmented from "../../ui/Segmented.jsx";
import {
  ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ClipboardIcon, FlagIcon, LockIcon, TeamIcon,
} from "../../ui/icons/index.jsx";
import { PROGRAM_SLOTS } from "../../../lib/trainingPrograms.ts";
import {
  PHONE_VIEWS, PROGRAM_PHONE_VIEW_STORE, clampDay, dayMarks, rememberedPhoneView, startDayIndex, weekdayLong,
  type PhoneView, type WeekCell,
} from "./programR5Model.ts";

export type PhoneChip = { key: string; label: string; active: boolean; group: boolean };

function loadView(): PhoneView {
  try { return rememberedPhoneView(localStorage.getItem(PROGRAM_PHONE_VIEW_STORE)); } catch { return "day"; }
}
function saveView(view: PhoneView) {
  try { localStorage.setItem(PROGRAM_PHONE_VIEW_STORE, view); } catch { /* privat vindue: valget huskes bare ikke */ }
}

const LABEL = "font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";
const SWIPE_PX = 60;

type Shared = {
  cells: WeekCell[][];
  weekdays: readonly string[];
  todayWeekday: string;
  todayLocked: boolean;
  editable: boolean;
  sessionOrder: readonly string[];
  sessionLabel: (session: string) => string;
  dayLabel: (weekday: string) => string;
  lang: string;
  tonight: ReactNode;
  onEdit: (weekday: string, slot: number, session: string) => void;
  onCopyDay: (from: string, choice: string) => void;
};

export default function ProgramR5Phone({
  name, subtitle, typeLabel, chips, onChip, renderLibrary, limitEl, summary, hints, footer, showPlan,
  saveLabel, saveDisabled, onSave, kindSelector = null, rotationEditor = null, weekBlockEditor = null, focusWeekday = null, ...shared
}: Shared & {
  // #8580: en ugedag, der skal vælges og foldes ud (fra dagsvælgerens "Ret <ugedag> i Program").
  focusWeekday?: { weekday: string; n: number } | null;
  kindSelector?: ReactNode;
  rotationEditor?: ReactNode;
  weekBlockEditor?: ReactNode;
  name: string;
  subtitle: string;
  showPlan: boolean;
  typeLabel: string | null;
  chips: PhoneChip[];
  onChip: (key: string) => void;
  // Biblioteket (programmer, grupper, ryttere) og "hvem programmet sidder paa" i arket "Change program".
  renderLibrary: (close: () => void) => ReactNode;
  limitEl: ReactNode;
  summary: ReactNode;
  hints: ReactNode;
  footer: ReactNode;
  saveLabel: string;
  saveDisabled: boolean;
  onSave: () => void;
}) {
  const { t: tR5 } = useTranslation("trainingR5");
  const { weekdays, todayWeekday } = shared;
  const [view, setViewRaw] = useState<PhoneView>(loadView);
  const setView = (next: PhoneView) => { setViewRaw(next); saveView(next); };
  const [day, setDay] = useState(() => startDayIndex(weekdays, focusWeekday?.weekday ?? todayWeekday));
  const [openDay, setOpenDay] = useState<number>(() => startDayIndex(weekdays, focusWeekday?.weekday ?? todayWeekday));
  // Hver ny anmodning (n) vælger ugedagen igen, også når fanen allerede er åben.
  const [sheet, setSheet] = useState(false);
  const focusN = focusWeekday?.n ?? null;
  const focusDay = focusWeekday?.weekday ?? null;
  useEffect(() => {
    if (focusN == null || !focusDay) return;
    const idx = startDayIndex(weekdays, focusDay);
    setDay(idx);
    setOpenDay(idx);
    setSheet(true);
  }, [focusN, focusDay, weekdays]);


  const closeSheet = () => setSheet(false);
  const saveBar = (
    <div className="fixed inset-x-0 bottom-(--cz-mobile-nav-offset,0px) z-sticky border-t border-cz-border bg-cz-card px-4 pb-3 pt-3"
      data-testid="program-r5-savebar">
      <Button variant="primary" className="min-h-11 w-full" disabled={saveDisabled} onClick={onSave} data-testid="program-r5-save">
        {saveLabel}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 pb-20" data-testid="program-r5-phone">
      <div className="flex items-start gap-2" data-testid="program-r5-phone-head">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-cz-1">{name}</h2>
          <p className="mt-0.5 truncate text-xs text-cz-2">{subtitle}</p>
        </div>
        <button type="button" onClick={() => setSheet(true)} data-testid="program-r5-change"
          className="-me-1 inline-flex min-h-11 shrink-0 items-center px-1 text-xs font-medium text-cz-accent-t">
          {tR5(showPlan ? "programR5.phone.changeProgram" : "programR5.programs")}
        </button>
      </div>

      {showPlan && <>
      {chips.length > 0 && <div>
        <span className="flex items-baseline justify-between gap-2">
          <span className={LABEL}>{tR5("programR5.weekFor")}</span>
          {typeLabel && <span className="text-2xs text-cz-2">{typeLabel}</span>}
        </span>
        <div role="group" aria-label={tR5("programR5.weekFor")}
          className="-mx-4 mt-1 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" data-testid="program-r5-chips">
          {chips.map((chip) => (
            <button key={chip.key} type="button" aria-pressed={chip.active} onClick={() => onChip(chip.key)}
              className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-cz border px-3 text-xs ${chip.active ? "border-cz-1 bg-cz-card font-semibold text-cz-1" : "border-cz-border text-cz-2"}`}>
              {chip.group && <TeamIcon size={12} aria-hidden="true" className="text-cz-3" />}
              {chip.label}
            </button>
          ))}
        </div>
      </div>}

      {hints}
      {kindSelector}
      {(summary || !rotationEditor) && <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-3xs leading-snug text-cz-2">{summary}</div>
        {!rotationEditor && <Segmented label={tR5("programR5.phone.viewLabel")} value={view} onChange={setView}
          options={PHONE_VIEWS.map((v) => ({ value: v, label: tR5(v === "day" ? "programR5.phone.viewDay" : "programR5.phone.viewWeek") }))} />}
      </div>}

      {rotationEditor ?? <>
      {view === "day"
        ? <DayView {...shared} day={day} onDay={setDay} />
        : <WeekList {...shared} open={openDay} onOpen={setOpenDay} />}
      {weekBlockEditor}
      </>}
      </>}

      {/* Graensen under ugen, saa felterne faar pladsen oeverst paa en smal skaerm. */}
      {limitEl}
      {footer}
      <p className="inline-flex items-center gap-1 text-3xs text-cz-3" data-testid="program-r5-today-lock">
        <LockIcon size={10} aria-hidden="true" />{tR5("programR5.todayLock")}
      </p>

      {typeof document === "undefined" ? saveBar : createPortal(saveBar, document.body)}

      {sheet && (
        <Modal
          open
          onClose={closeSheet}
          size="md"
          title={tR5("programR5.phone.changeProgram")}
          titleId="program-r5-phone-sheet-title"
          ariaLabelledby={undefined}
          description={null}
          closeLabel={tR5("programR5.phone.close")}
          footer={<Button variant="secondary" className="min-h-11" onClick={closeSheet}>{tR5("programR5.phone.close")}</Button>}
        >
          <div className="flex flex-col gap-4" data-testid="program-r5-sheet">{renderLibrary(closeSheet)}</div>
        </Modal>
      )}
    </div>
  );
}

// --- Dag: en dag ad gangen ----------------------------------------------------------------

function DayView(props: Shared & { day: number; onDay: (d: number) => void }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5");
  const { cells, weekdays, todayWeekday, todayLocked, dayLabel, lang, day, onDay } = props;
  const x0 = useRef<number | null>(null);
  const go = (to: number) => onDay(clampDay(to, weekdays));
  const arrow = "flex min-h-[54px] w-10 shrink-0 items-center justify-center rounded-cz text-cz-2 disabled:opacity-40";
  const weekday = weekdays[day];
  const isToday = weekday === todayWeekday;
  return (
    <div data-testid="program-r5-dayview">
      <div className="flex items-stretch gap-0.5" data-testid="program-r5-daystrip">
        <button type="button" aria-label={tR5("programR5.phone.prevDay")} disabled={day === 0} onClick={() => go(day - 1)} className={arrow}>
          <ChevronLeftIcon size={18} aria-hidden="true" />
        </button>
        <div className="grid min-w-0 flex-1 grid-cols-7 gap-0.5" role="tablist" aria-label={tR5("programR5.phone.dayTabs")}>
          {weekdays.map((w, d) => {
            const active = d === day;
            const marks = dayMarks(cells[d]);
            return (
              <button key={w} type="button" role="tab" aria-selected={active} onClick={() => go(d)}
                className={`flex min-h-[54px] min-w-0 flex-col items-center justify-center rounded-cz border text-center ${active ? "border-cz-1 bg-cz-card font-semibold text-cz-1" : "border-cz-border text-cz-2"}`}>
                <span className="max-w-full truncate text-2xs">{dayLabel(w)}</span>
                <span className="flex h-3.5 items-center gap-0.5">
                  {w === todayWeekday && todayLocked
                    ? <LockIcon size={10} aria-label={t("weekPlan.today")} />
                    : marks.races > 0
                      ? <FlagIcon size={10} aria-label={tR5("programR5.races", { n: marks.races })} />
                      : w === todayWeekday
                        ? <span className="h-1.5 w-1.5 rounded-full bg-cz-accent" aria-label={t("weekPlan.today")} />
                        : null}
                  {marks.changed > 0 && <span className="h-1.5 w-1.5 rounded-full bg-cz-2" aria-label={tR5("programR5.notSaved")} />}
                </span>
              </button>
            );
          })}
        </div>
        <button type="button" aria-label={tR5("programR5.phone.nextDay")} disabled={day === weekdays.length - 1} onClick={() => go(day + 1)} className={arrow}>
          <ChevronRightIcon size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3"
        onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (x0.current === null) return;
          const dx = e.changedTouches[0].clientX - x0.current;
          x0.current = null;
          if (Math.abs(dx) > SWIPE_PX) go(day + (dx < 0 ? 1 : -1));
        }}>
        <h3 className="mb-1.5 flex items-center justify-between gap-2 text-sm font-semibold text-cz-1">
          <span className="min-w-0 truncate">{weekdayLong(weekday, lang)}{isToday ? ` · ${t("weekPlan.today")}` : ""}</span>
        </h3>
        <DayBody {...props} d={day} />
      </div>
    </div>
  );
}

// Dagens fem felter, "kopier dagen" og (i dag) aftenens traethed. Faelles for Dag og Uge.
function DayBody({
  cells, weekdays, todayWeekday, todayLocked, editable, sessionOrder, sessionLabel, dayLabel, lang, tonight, onEdit, onCopyDay, d,
}: Shared & { d: number }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5");
  const weekday = weekdays[d];
  const locked = todayLocked && weekday === todayWeekday;
  return (
    <div>
      <ol className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" aria-label={tR5("programR5.phone.fieldsOf", { day: weekdayLong(weekday, lang) })}>
        {Array.from({ length: PROGRAM_SLOTS }, (_, slot) => {
          const cell = cells[d][slot];
          const base = "relative flex min-h-11 items-center gap-3 border-t border-cz-border px-3 text-sm first:border-t-0";
          const num = <span className="w-9 shrink-0 font-data text-2xs font-semibold tabular-nums text-cz-3">{t("mobile.raceDayShort", { n: slot + 1 })}</span>;
          if (cell.kind === "race") {
            return (
              <li key={slot} className={`${base} bg-cz-subtle text-cz-2`} data-testid={cell.pending ? "program-r5-pending" : "program-r5-race"}>
                {num}<FlagIcon size={12} aria-hidden="true" className="shrink-0" />
              {cell.pending ? t("dailyReceipt.status.pending") : tR5("programR5.race")}
              </li>
            );
          }
          if (cell.kind === "rest") {
            return <li key={slot} className={`${base} text-cz-2`} data-testid="program-r5-week-rest">{num}{sessionLabel("rest")}</li>;
          }
          if (cell.kind === "ran") {
            return (
              <li key={slot} className={`${base} text-cz-3`} title={t("settleAfterStage.ranTitle")}>
                {num}<LockIcon size={11} aria-hidden="true" className="shrink-0" />{t("settleAfterStage.ran")}
              </li>
            );
          }
          const label = `${dayLabel(weekday)} · ${t("mobile.raceDayShort", { n: slot + 1 })}`;
          const canEdit = editable && !locked;
          return (
            <li key={slot} className={base}>
              {num}
              <span className={`min-w-0 flex-1 truncate ${cell.session ? "text-cz-1" : "text-cz-3"}`}>
                {cell.session ? sessionLabel(cell.session) : "–"}
              </span>
              {cell.changed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cz-2" aria-label={tR5("programR5.notSaved")} />}
              {canEdit && (
                <>
                  <ChevronDownIcon size={14} aria-hidden="true" className="shrink-0 text-cz-3" />
                  <select value={cell.session ?? ""} onChange={(e) => onEdit(weekday, slot, e.target.value)} aria-label={label}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
                    {!cell.session && <option value="" disabled>–</option>}
                    {sessionOrder.map((s) => <option key={s} value={s}>{sessionLabel(s)}</option>)}
                  </select>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {editable ? (
          <span className="relative inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-cz-accent-t">
            <ClipboardIcon size={13} aria-hidden="true" />{tR5("programR5.copyDay", { day: dayLabel(weekday) })}
            <select value="" onChange={(e) => onCopyDay(weekday, e.target.value)} aria-label={tR5("programR5.copyDay", { day: dayLabel(weekday) })}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0" data-testid="program-r5-copy-day">
              <option value="" disabled>{tR5("programR5.copyDay", { day: dayLabel(weekday) })}</option>
              <option value="all">{tR5("programR5.copyAll")}</option>
              {weekdays.filter((w) => w !== weekday && !(todayLocked && w === todayWeekday)).map((w) => (
                <option key={w} value={w}>{dayLabel(w)}</option>
              ))}
            </select>
          </span>
        ) : <span />}
        {weekday === todayWeekday && tonight && (
          <span className="inline-flex items-center gap-2 text-xs text-cz-2">
            <span className={LABEL}>{t("forecast.label")}</span>{tonight}
          </span>
        )}
      </div>
    </div>
  );
}

// --- Uge: hele ugen som liste ---------------------------------------------------------------

function WeekList(props: Shared & { open: number; onOpen: (d: number) => void }) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5");
  const { cells, weekdays, todayWeekday, todayLocked, sessionLabel, dayLabel, open, onOpen } = props;
  return (
    <div className="flex flex-col gap-1.5" data-testid="program-r5-weeklist">
      {weekdays.map((w, d) => {
        const marks = dayMarks(cells[d]);
        const isOpen = d === open;
        const isToday = w === todayWeekday;
        const sub = isToday ? t("weekPlan.today") : marks.races > 0 ? tR5("programR5.races", { n: marks.races }) : tR5("programR5.phone.noRaces");
        return (
          <div key={w} className="rounded-cz border border-cz-border bg-cz-card">
            <button type="button" aria-expanded={isOpen} onClick={() => onOpen(isOpen ? -1 : d)}
              className="grid min-h-11 w-full grid-cols-[54px_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-1.5 text-start">
              <span>
                <span className="flex items-center gap-1 text-sm font-semibold text-cz-1">
                  {dayLabel(w)}
                  {isToday && todayLocked && <LockIcon size={10} aria-hidden="true" className="text-cz-3" />}
                </span>
                <span className="block text-3xs text-cz-2">{sub}</span>
              </span>
              <ol className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
                {cells[d].map((c, slot) => (
                  <li key={slot} className="inline-flex items-baseline gap-1 whitespace-nowrap text-xs">
                    <span className="font-data text-3xs tabular-nums text-cz-3">{slot + 1}</span>
                    {c.kind === "race" && (
                      <span className="inline-flex items-center gap-1 font-semibold text-cz-1"><FlagIcon size={11} aria-hidden="true" />{tR5("programR5.race")}</span>
                    )}
                    {c.kind === "ran" && <span className="text-cz-3">{t("settleAfterStage.ran")}</span>}
                    {c.kind === "rest" && <span className="text-cz-2">{sessionLabel("rest")}</span>}
                    {c.kind === "session" && (
                      <span className={c.session ? "text-cz-1" : "text-cz-3"}>{c.session ? sessionLabel(c.session) : "–"}</span>
                    )}
                    {c.kind === "session" && c.changed && <span className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-cz-2" aria-label={tR5("programR5.notSaved")} />}
                  </li>
                ))}
              </ol>
              <ChevronDownIcon size={14} aria-hidden="true" className={`mt-1 shrink-0 text-cz-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && <div className="px-3 pb-3"><DayBody {...props} d={d} /></div>}
          </div>
        );
      })}
    </div>
  );
}
