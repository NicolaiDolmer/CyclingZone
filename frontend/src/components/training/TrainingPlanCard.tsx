// TrainingPlanCard — under-fanen "Plan" paa Program-fanen (#5932, ejer-godkendt
// mockup 1/10, pin 1-3 og 7).
//
// EET kort i stedet for tre (Plan, Week plan, Individual weekly plans):
//   - top-raekken: "Plan for" (holdet eller een rytter) + "Fatigue tonight".
//   - gitteret: 7 ugedage x (Whole day + loebsdagene). For holdet ER kolonnen
//     "Whole day" den gamle ugeplan (intensitet pr. ugedag, kladde + gem som
//     foer). For en rytter er det hans 35 felter (#5932, rettes med det samme)
//     naar felterne er aabne, ellers hans egen intensitets-uge som foer.
//   - ryttere med egen plan vises som chips; et tryk aabner hans plan.
//
// Ingen ny datamodel og ingen nye kald: holdets/rytterens intensitets-uge kommer
// fra useTraining, felterne fra riderWeekPlans + seeds (useTrainingPrograms).
// Telefonen (375 px): dag 34 px + hele dagen 48 px + 5 x ca. 47 px, ingen
// sidelaens scroll; native vaelger ligger usynligt over hver celle.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LockIcon } from "../ui/icons/index.jsx";
import type { ReactNode } from "react";
import { applyCopyDay, MAX_COPY_DAYS } from "./copyDayPlan.ts";
import type { RaceDayColumn } from "../../lib/trainingMobileModel.ts";
import {
  PROGRAM_SLOTS, cellSession, isCellOverridden, isProgramPlan, changedCellCount,
  programName, slotForColumnIndex, type CatalogProgram, type ProgramWeekDays,
} from "../../lib/trainingPrograms.ts";

export type ProgramRider = { id: string; name: string; type: string | null };
// #6000: `section` grupperer vaelgeren (Hold · Groups · Riders, mockup pin 1).
export type PlanForOption = { value: string; label: string; section?: "groups" | "riders" };
export type OwnPlanChip = { id: string; name: string };

// Raekkefoelgen i session-vaelgeren: hele dage, faerdighed, traening.
export const SESSION_ORDER = [
  "rest", "recovery",
  "technique", "aero", "loebslaere",
  "endurance", "tempo",
  "vo2max", "vo2max_climb", "vo2max_punch", "threshold", "sprint",
  "cobbled_sectors", "echelon_drills", "attack_repeats",
] as const;

// Holdets (eller en rytters) intensitets-uge: den gamle Week plan.
export type IntensityEditor = {
  intensities: readonly string[];
  intensityFor: (weekday: string) => string;
  onSetDay: (weekday: string, intensity: string) => void;
  changedCount: number;
  saving: boolean;
  onSave: () => void;
  onUndo: () => void;
  resetLabel: string | null;
  onReset: () => void;
  message: { type: string; text: string } | null;
};

// En rytters 35 felter.
export type CellEditor = {
  days: ProgramWeekDays | null | undefined;
  isSeed: boolean;
  program: CatalogProgram | null;
  lockedToday: ReadonlySet<number>;
  busy: boolean;
  onSetCell: (weekday: string, slotIndex: number | null, session: string) => void;
  message: string | null;
};

export default function TrainingPlanCard({
  weekdays,
  todayWeekday,
  columns,
  planFor,
  planForOptions,
  onPlanFor,
  forecast,
  intro,
  intensity,
  cells,
  ownPlans,
  onOpenOwnPlan,
  planForExtra = null,
  todayLocked = false,
}: {
  weekdays: readonly string[];
  todayWeekday: string;
  columns: RaceDayColumn[];
  planFor: string;
  planForOptions: PlanForOption[];
  onPlanFor: (value: string) => void;
  forecast?: ReactNode;
  intro: string;
  intensity: IntensityEditor | null;
  cells: CellEditor | null;
  ownPlans: OwnPlanChip[];
  onOpenOwnPlan: (riderId: string) => void;
  planForExtra?: ReactNode;
  // #6139: "Train now" er trykket i dag, saa dagens felter er laast (i morgen er aaben).
  todayLocked?: boolean;
}) {
  const { t, i18n } = useTranslation("training");
  const tRider = useTranslation("rider").t;
  const lang = i18n?.language ?? "en";
  const multi = columns.length > 1;
  const intensityLabel = (k: string) => tRider(`training.intensity_${k}`);
  const sessionLabel = (session: string) =>
    session === "rest" || session === "recovery" ? t(`dayPanel.dayType_${session}`) : t(`dayPanel.session_${session}`);
  const shortLabel = (session: string) => t(`mobile.sessionShort_${session}`, { defaultValue: sessionLabel(session) });
  const cellDays = cells?.days ?? null;
  const showCells = !!cells && isProgramPlan(cellDays, weekdays);
  const VISIBLE_CHIPS = 4;

  // #6060: kopier en dags intensitet til de naeste dage. Kun kladden (onSetDay), aldrig rytter-planer.
  const [copySource, setCopySource] = useState<string | null>(null);
  const [copyCount, setCopyCount] = useState(1);
  const [copiedTo, setCopiedTo] = useState<number | null>(null);
  const copyFrom = copySource && weekdays.includes(copySource) ? copySource : todayWeekday;
  const runCopy = () => {
    if (!intensity) return;
    const done = applyCopyDay(copyFrom, copyCount, weekdays, intensity.intensityFor, intensity.onSetDay, { todayWeekday, todayLocked });
    setCopiedTo(done.length);
  };

  const hint = cells
    ? cells.isSeed
      ? t("programs.seededHint")
      : showCells && cells.program
        ? `${t("programs.basedOn", { name: programName(cells.program, lang) })}${
          changedCellCount(cellDays, cells.program, weekdays) > 0
            ? ` · ${t("programs.changed", { n: changedCellCount(cellDays, cells.program, weekdays) })}`
            : ""}`
        : intro
    : intro;

  const sessionSelect = (value: string, onChange: (session: string) => void, ariaLabel: string, overlay = false, locked = false) => (
    <select
      value={value}
      disabled={cells?.busy || locked}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className={overlay
        ? "absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        : "w-full rounded-cz border border-cz-border bg-cz-card px-1.5 py-1 text-xs text-cz-1 disabled:opacity-50"}
    >
      {SESSION_ORDER.map((session) => <option key={session} value={session}>{sessionLabel(session)}</option>)}
    </select>
  );

  // #6139: on desktop the lock sits in today's whole-day field (the day column is too narrow).
  const desktopLock = <LockIcon size={12} aria-hidden="true" className="shrink-0 text-cz-3" />;
  const headerCell = "bg-cz-subtle py-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3";
  const dayCell = (weekday: string, rowBg: string, isToday: boolean) => (
    <span className={`flex items-center gap-1.5 border-t border-cz-border px-2 py-1.5 text-[13px] font-semibold text-cz-1 ${rowBg}`}>
      <span className="sm:hidden">{t(`weekday_${weekday}`).slice(0, 2)}</span>
      <span className="hidden truncate sm:inline">{t(`weekday_${weekday}`)}</span>
      {isToday && (
        <span className="hidden rounded-cz bg-cz-1 px-1 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-card sm:inline">
          {t("weekPlan.today")}
        </span>
      )}
      {isToday && todayLocked && (
        <LockIcon size={12} aria-label={t("trainNow.planLocked")} className="shrink-0 text-cz-3 sm:hidden" data-testid="training-plan-today-locked" />
      )}
    </span>
  );

  return (
    <section className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" data-testid="training-plan-card">
      {/* ── Top-raekken: hvem + traethed i aften ───────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-cz-border px-4 py-2.5 sm:px-5">
        <select
          value={planFor}
          onChange={(event) => onPlanFor(event.target.value)}
          aria-label={t("weekPlan.planFor")}
          className="min-h-11 min-w-0 max-w-[240px] rounded-cz border border-cz-border bg-cz-card px-2.5 py-1.5 text-xs text-cz-1 sm:min-h-0"
          data-testid="training-plan-for"
        >
          {planForOptions.some((o) => o.section)
            ? [undefined, "groups", "riders"].map((section) => {
              const items = planForOptions.filter((o) => o.section === section);
              const rows = items.map((option) => <option key={option.value} value={option.value}>{option.label}</option>);
              return section && items.length ? <optgroup key={section} label={t(`groups.section_${section}`)}>{rows}</optgroup> : rows;
            })
            : planForOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {planForExtra}
        {forecast}
        <p className="basis-full text-[12.5px] text-cz-2">{hint}</p>
      </div>

      <div className="px-3 py-3 sm:px-5">
        {showCells && cells ? (
          <div
            className="grid overflow-hidden rounded-cz border border-cz-border"
            style={{
              gridTemplateColumns: multi
                ? `minmax(34px, 0.8fr) minmax(48px, 1.4fr) repeat(${columns.length}, minmax(0, 1fr))`
                : "minmax(34px, 96px) minmax(0, 1fr)",
            }}
            data-testid="training-program-grid"
          >
            <span className={`${headerCell} px-2`}>{t("weekPlan.colDay")}</span>
            <span className={`${headerCell} border-s border-cz-border px-2`}>{t("weekPlan.colWholeDay")}</span>
            {multi && columns.map((column) => (
              <span key={column.key} className={`${headerCell} border-s border-cz-border px-0.5 text-center`}>
                {t("mobile.raceDayShort", { n: column.index })}
              </span>
            ))}
            {weekdays.map((weekday) => {
              const isToday = weekday === todayWeekday;
              const rowBg = isToday ? "bg-cz-subtle" : "bg-cz-card";
              const daySession = cellSession(cellDays, weekday) ?? "rest";
              const wholeLabel = `${t("weekPlan.colWholeDay")} · ${t(`weekday_${weekday}`)}`;
              return (
                <div key={weekday} className="contents" data-testid="training-program-row">
                  {dayCell(weekday, rowBg, isToday)}
                  {multi ? (
                    <>
                      <span className={`relative flex min-h-11 items-center justify-center border-s border-t border-cz-border px-0.5 font-data text-3xs font-semibold text-cz-1 sm:hidden ${rowBg}`}>
                        <span className="truncate">{shortLabel(daySession)}</span>
                        {sessionSelect(daySession, (s) => cells.onSetCell(weekday, null, s), wholeLabel, true, isToday && todayLocked)}
                      </span>
                      <span className={`hidden items-center gap-1 border-s border-t border-cz-border px-1 py-1 sm:flex ${rowBg}`}>
                        {isToday && todayLocked && desktopLock}
                        {sessionSelect(daySession, (s) => cells.onSetCell(weekday, null, s), wholeLabel, false, isToday && todayLocked)}
                      </span>
                    </>
                  ) : (
                    <span className={`border-s border-t border-cz-border px-1 py-1 ${rowBg}`}>
                      {sessionSelect(daySession, (s) => cells.onSetCell(weekday, null, s), wholeLabel, false, isToday && todayLocked)}
                    </span>
                  )}
                  {multi && columns.map((column) => {
                    const slot = slotForColumnIndex(column.index);
                    if (slot >= PROGRAM_SLOTS) return null;
                    const session = cellSession(cellDays, weekday, slot) ?? daySession;
                    const overridden = isCellOverridden(cellDays, weekday, slot);
                    const cellLabel = `${t(`weekday_${weekday}`)} · ${t("mobile.raceDayShort", { n: column.index })}`;
                    // #5932 regel A: i dag er et felt med en etape laast af loebet.
                    if (isToday && cells.lockedToday.has(slot)) {
                      return (
                        <span
                          key={column.key}
                          title={t("programs.stageLockedTitle")}
                          aria-label={`${cellLabel} · ${t("programs.stageLockedTitle")}`}
                          data-testid="training-program-cell-locked"
                          className={`flex min-h-11 items-center justify-center border-s border-t border-cz-border px-0.5 sm:min-h-0 sm:py-1 ${rowBg}`}
                        >
                          <span className="truncate rounded-cz bg-cz-1 px-1 font-data text-3xs font-semibold text-cz-card sm:text-2xs">
                            {t("programs.stageLocked")}
                          </span>
                        </span>
                      );
                    }
                    return (
                      <span
                        key={column.key}
                        title={overridden ? t("programs.cellOverridden") : undefined}
                        className={`relative flex min-h-11 items-center justify-center border-s border-t border-cz-border px-0.5 font-data text-3xs sm:min-h-0 sm:py-1.5 sm:text-2xs ${
                          overridden
                            ? "font-semibold text-cz-1 underline decoration-dotted decoration-cz-1 underline-offset-2"
                            : session === "rest" ? "text-cz-3" : "text-cz-2"
                        } ${rowBg}`}
                      >
                        <span className="truncate">{shortLabel(session)}</span>
                        {sessionSelect(session, (next) => cells.onSetCell(weekday, slot, next), cellLabel, true, isToday && todayLocked)}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : intensity ? (
          <div
            className="grid overflow-hidden rounded-cz border border-cz-border"
            style={{
              gridTemplateColumns: multi
                ? `minmax(34px, 0.8fr) minmax(48px, 1.4fr) repeat(${columns.length}, minmax(0, 1fr))`
                : "minmax(34px, 110px) minmax(0, 1fr)",
            }}
            data-testid="training-week-plan-grid"
          >
            <span className={`${headerCell} px-2`}>{t("weekPlan.colDay")}</span>
            <span className={`${headerCell} border-s border-cz-border px-2`}>{t("weekPlan.colWholeDay")}</span>
            {multi && columns.map((column) => (
              <span key={column.key} className={`${headerCell} border-s border-cz-border px-0.5 text-center`}>
                {t("mobile.raceDayShort", { n: column.index })}
              </span>
            ))}
            {weekdays.map((weekday) => {
              const isToday = weekday === todayWeekday;
              const current = intensity.intensityFor(weekday);
              const rowBg = isToday ? "bg-cz-subtle" : "bg-cz-card";
              const wholeLabel = `${t("weekPlan.colWholeDay")} · ${t(`weekday_${weekday}`)}`;
              const intensitySelect = (overlay: boolean) => (
                <select
                  value={current}
                  disabled={intensity.saving || (isToday && todayLocked)}
                  aria-label={wholeLabel}
                  onChange={(event) => intensity.onSetDay(weekday, event.target.value)}
                  className={overlay
                    ? "absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
                    : "w-full rounded-cz border border-cz-border bg-cz-card px-1.5 py-1 text-xs text-cz-1 disabled:opacity-50"}
                >
                  {intensity.intensities.map((k) => <option key={k} value={k}>{intensityLabel(k)}</option>)}
                </select>
              );
              return (
                <div key={weekday} className="contents" data-testid="training-week-plan-row">
                  {dayCell(weekday, rowBg, isToday)}
                  <span className={`relative flex min-h-11 items-center justify-center border-s border-t border-cz-border px-0.5 font-data text-3xs font-semibold text-cz-1 sm:hidden ${rowBg}`}>
                    <span className="truncate">{intensityLabel(current)}</span>
                    {intensitySelect(true)}
                  </span>
                  <span className={`hidden items-center gap-1 border-s border-t border-cz-border px-1 py-1 sm:flex ${rowBg}`}>
                    {isToday && todayLocked && desktopLock}
                    {intensitySelect(false)}
                  </span>
                  {multi && columns.map((column) => (
                    <span
                      key={column.key}
                      className={`flex min-h-11 items-center justify-center border-s border-t border-cz-border px-0.5 font-data text-3xs sm:min-h-0 sm:py-1.5 sm:text-2xs ${
                        current === "rest" ? "text-cz-3" : "text-cz-2"
                      } ${rowBg}`}
                    >
                      <span className="truncate">{intensityLabel(current)}</span>
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-cz-3">{t("programs.noProgramHint")}</p>
        )}
      </div>

      {/* ── Bund: gem (kun intensitets-ugen har en kladde) + egne planer ── */}
      {(intensity && !showCells) || cells?.message || ownPlans.length > 0 || todayLocked ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-cz-border px-4 py-2.5 sm:px-5">
          {intensity && !showCells && (
            <>
              <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="training-copy-day">
                <select
                  value={copyFrom}
                  onChange={(event) => setCopySource(event.target.value)}
                  aria-label={t("weekPlan.copySource")}
                  className="min-h-11 rounded-cz border border-cz-border bg-cz-card px-2 text-xs text-cz-1 sm:min-h-[30px]"
                >
                  {weekdays.map((weekday) => <option key={weekday} value={weekday}>{t(`weekday_${weekday}`)}</option>)}
                </select>
                <select
                  value={copyCount}
                  onChange={(event) => setCopyCount(Number(event.target.value))}
                  aria-label={t("weekPlan.copyCount")}
                  className="min-h-11 rounded-cz border border-cz-border bg-cz-card px-2 text-xs text-cz-1 sm:min-h-[30px]"
                >
                  {Array.from({ length: MAX_COPY_DAYS }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{t("weekPlan.copyOption", { n })}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={runCopy}
                  disabled={intensity.saving}
                  className="inline-flex min-h-11 items-center rounded-cz border border-cz-border bg-transparent px-3 text-[13px] font-medium text-cz-2 transition-colors hover:bg-cz-subtle disabled:opacity-50 sm:min-h-[30px]"
                  data-testid="training-copy-day-button"
                >
                  {t("weekPlan.copyButton")}
                </button>
              </span>
              <button
                type="button"
                onClick={intensity.onSave}
                disabled={intensity.saving}
                className="inline-flex min-h-11 items-center rounded-cz border border-cz-border bg-cz-card px-3.5 text-[13px] font-medium text-cz-1 transition-colors hover:bg-cz-subtle disabled:opacity-50 sm:min-h-[30px]"
                data-testid="training-week-plan-save"
              >
                {intensity.saving ? t("loading") : t("weekPlan.save")}
              </button>
              {intensity.changedCount > 0 && (
                <button type="button" onClick={intensity.onUndo} className="text-xs font-medium text-cz-accent-t hover:underline">
                  {t("weekPlan.undo")}
                </button>
              )}
              {intensity.resetLabel && (
                <button type="button" onClick={intensity.onReset} disabled={intensity.saving} className="text-xs font-medium text-cz-danger hover:underline disabled:opacity-50">
                  {intensity.resetLabel}
                </button>
              )}
              {intensity.changedCount > 0 && (
                <span className="font-data text-xs tabular-nums text-cz-3">{t("weekPlan.unsaved", { n: intensity.changedCount })}</span>
              )}
              {copiedTo !== null && intensity.changedCount > 0 && (
                <span role="status" className="text-xs text-cz-2" data-testid="training-copy-day-status">
                  {copiedTo > 0 ? t("weekPlan.copyDone", { n: copiedTo }) : t("weekPlan.copyNone")}
                </span>
              )}
              {intensity.message && (
                <span role="status" className={`text-xs ${intensity.message.type === "ok" ? "text-cz-success" : "text-cz-danger"}`}>
                  {intensity.message.text}
                </span>
              )}
            </>
          )}
          {todayLocked && (
            <span className="inline-flex items-center gap-1 text-2xs text-cz-3" data-testid="training-plan-locked-note">
              <LockIcon size={11} aria-hidden="true" className="shrink-0" />
              {t("trainNow.planLocked")}
            </span>
          )}
          {showCells && <span className="text-2xs text-cz-3">{t("programs.raceNote")}</span>}
          {cells?.message && <span role="status" className="text-xs text-cz-danger">{cells.message}</span>}
          {ownPlans.length > 0 && (
            <span className="ms-auto flex min-w-0 flex-wrap items-center gap-1.5" data-testid="training-own-plan-chips">
              <span className="text-2xs text-cz-3">{t("weekPlan.ownPlansChips")}</span>
              {ownPlans.slice(0, VISIBLE_CHIPS).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  aria-pressed={planFor === row.id}
                  onClick={() => onOpenOwnPlan(row.id)}
                  className={`min-h-11 rounded-cz-pill border px-2.5 text-2xs sm:min-h-0 sm:py-0.5 ${
                    planFor === row.id ? "border-cz-1 bg-cz-subtle text-cz-1" : "border-cz-border text-cz-2 hover:bg-cz-subtle"
                  }`}
                >
                  {row.name}
                </button>
              ))}
              {ownPlans.length > VISIBLE_CHIPS && (
                <select
                  value=""
                  onChange={(event) => { if (event.target.value) onOpenOwnPlan(event.target.value); }}
                  aria-label={t("weekPlan.ownPlansMore", { n: ownPlans.length - VISIBLE_CHIPS })}
                  className="min-h-11 rounded-cz-pill border border-cz-border bg-cz-card px-2 text-2xs text-cz-2 sm:min-h-0 sm:py-0.5"
                >
                  <option value="">{t("weekPlan.ownPlansMore", { n: ownPlans.length - VISIBLE_CHIPS })}</option>
                  {ownPlans.slice(VISIBLE_CHIPS).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              )}
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
