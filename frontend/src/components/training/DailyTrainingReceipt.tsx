import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DailyTrainingReceipt as DateReceipt, DailyRiderReceipt, TrainingActivity } from "../../lib/trainingDailyReceipt.ts";
import { averagePassScore, sortReceiptRiders, formatSlotRange, waitingForRace, type ReceiptSort } from "../../lib/trainingDailyReceipt.ts";
import { progressOnlyEntries, wholePointEntries } from "../../lib/trainingReceiptView.ts";
import Segmented from "../ui/Segmented.jsx";
import { formatDate, formatNumber } from "../../lib/intl.js";
import { todayGainTotal } from "../../lib/trainingReport.js";
import { injuryTimeLeft, injuryBadgeMessage } from "../../lib/training.js";
import Section, { SectionHeader } from "../ui/Section.jsx";
import { ChevronDownIcon, ChevronRightIcon } from "../ui/icons/index.jsx";
import RiderLink from "../RiderLink.jsx";
import { receiptPassScore, latestReceiptPassScore, type ReceiptScoreView } from "../../lib/trainingScoreView.ts";
import { formColor, fatigueColor } from "../rider/ConditionChips.jsx";

const isKnown = (row: DailyRiderReceipt) => row.receipt_status === "complete" || row.receipt_status === "recorded";
// #6027: a pending date still shows what its stored race days already trained.
const showsDevelopment = (row: DailyRiderReceipt) => isKnown(row) || row.trained_now != null;
const development = (row: DailyRiderReceipt) => row.trained_now ?? row;
// #7745: the meta line and the micro headings share one recipe.
const META = "font-data text-2xs uppercase tracking-[.08em] text-cz-3";

type ScoreView = Record<string, ReceiptScoreView> | null;
type ConditionView = Record<string, { injured_until?: string | null; injury_race_days_left?: number | null }>;
type RosterRider = { id: string; firstname?: string | null; lastname?: string | null };
export default function DailyTrainingReceipt({ run, trainingScore = null, defaultExpanded = true, condition, today, roster }: { run: DateReceipt; trainingScore?: ScoreView; defaultExpanded?: boolean; condition?: ConditionView; today?: Date; roster?: RosterRider[] }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const change = (from: number | null | undefined, to: number | null | undefined, tone?: (value: number) => string) =>
    typeof from === "number" && typeof to === "number"
      ? <span className="inline-flex items-center gap-1" aria-label={t("dailyReceipt.change",{from:formatNumber(from),to:formatNumber(to)})}><span className={tone?.(from)}>{formatNumber(from)}</span><ChevronRightIcon size={12} className="text-cz-3" aria-hidden="true" /><span className={tone?.(to)}>{formatNumber(to)}</span></span>
      : <span title={t("dailyReceipt.conditionLater")} aria-label={t("dailyReceipt.conditionLater")} data-testid="daily-receipt-condition-later">—</span>;
  const [openRiders, setOpenRiders] = useState<Set<string>>(() => new Set());
  const toggleRider = (id: string) => setOpenRiders(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [sortBy, setSortBy] = useState<ReceiptSort>("name");
  const avgScore = (row: DailyRiderReceipt) => showsDevelopment(row)
    ? averagePassScore(trainingScore?.[row.rider_id], run.tick_date, run.season_id, row.activities) : null;
  const rows = sortReceiptRiders(run.report.riders, sortBy, avgScore);
  const gameDays = Array.isArray(run.game_days) ? run.game_days : [];
  const trainedNowSlots = run.trained_now_slots ?? [];
  const trainedNow = run.receipt_status === "pending" && trainedNowSlots.length > 0;
  const trainedRows = rows.filter(row => row.trained_now != null);
  const waiting = sortReceiptRiders(waitingForRace(run, roster).map(rider => ({
    rider_id: rider.id, name: `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim(),
  })), "name");
  const trainedNowLabel = t("dailyReceipt.trainedNow", { count: trainedNowSlots.length, range: formatSlotRange(trainedNowSlots) });
  const showScore = trainingScore != null;
  const rowGrid = showScore
    ? "sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_5rem_6rem]"
    : "sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_6rem]";
  const allOpen = rows.length > 0 && rows.every(row => openRiders.has(row.rider_id));
  const known = rows.filter(isKnown);
  const points = (trainedNow ? trainedRows : known).reduce((sum, row) => sum + todayGainTotal(development(row)), 0);
  const wholeDateKnown = run.receipt_status === "complete" || run.receipt_status === "recorded";
  const pointsKnown = wholeDateKnown || trainedNow;
  const abilityName = (key: string) => tRider(`racePreview.derived.${key}`);
  const activityName = (activity: TrainingActivity) => activity.status === "unknown_pending"
    ? t("dailyReceipt.status.reconciliation")
    : activity.injured ? t("dailyReceipt.injured")
    : activity.race_day ? t("dailyReceipt.race")
    : activity.intensity === "rest" ? t("restDay")
    : activity.focus ? tRider(`training.focus_${activity.focus}`) : t("dailyReceipt.training");
  // #7745: a whole point is a bold "+1" in front of the ability; progress toward
  // the next point never shares the line, so "+1" and "+1%" cannot be confused.
  const developmentCell = (row: DailyRiderReceipt): ReactNode => {
    if (!showsDevelopment(row)) return <span className="text-cz-2">{t(`dailyReceipt.status.${row.receipt_status}`)}</span>;
    const whole = wholePointEntries(development(row));
    if (!whole.length) return <span className="text-cz-3">{t("dailyReceipt.noWholePoint")}</span>;
    return <span className="flex flex-wrap gap-x-3 gap-y-1" data-testid="daily-receipt-whole-points">{whole.map(({key,points:n})=>
      <span key={key} className="inline-flex min-w-0 max-w-full items-baseline gap-1"><span className="shrink-0 font-data font-semibold tabular-nums text-cz-success">+{formatNumber(n)}</span><span className="min-w-0 wrap-break-word text-cz-1">{abilityName(key)}</span></span>)}</span>;
  };
  const renderRow = (row: DailyRiderReceipt) => {
    const open = openRiders.has(row.rider_id);
    const visible = showsDevelopment(row);
    const dev = development(row);
    const latestScore = visible ? latestReceiptPassScore(trainingScore?.[row.rider_id],run.tick_date,run.season_id,row.activities) : null;
    const reportInjury = condition && today ? injuryTimeLeft(condition[row.rider_id], today) : null;
    const injuryMessage = reportInjury && reportInjury.count > 0 ? injuryBadgeMessage(reportInjury, { compact: true }) : null;
    const detailId = `receipt-${run.tick_date}-${run.season_id ?? "legacy"}-${row.rider_id}`;
    const whole = visible ? wholePointEntries(dev) : [];
    const progress = visible ? progressOnlyEntries(dev) : [];
    return (
      <div key={row.rider_id} className="border-t border-cz-border">
        <button type="button" className={`grid min-h-[44px] w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem] items-center gap-2 py-3 text-left hover:bg-cz-subtle ${rowGrid}`}
          aria-expanded={open} aria-controls={detailId} onClick={()=>toggleRider(row.rider_id)}>
          <span className="flex min-w-0 items-start gap-1.5"><ChevronDownIcon size={13} className={`mt-1 shrink-0 text-cz-3 ${open ? "rotate-180" : ""}`} aria-hidden="true" /><span className="min-w-0"><span className="wrap-break-word text-[13px] font-semibold text-cz-1">{row.name || row.rider_id}</span>{showScore && <span className="mt-1 block text-2xs text-cz-2 sm:hidden" data-testid="daily-receipt-mobile-score">{t("dailyReceipt.latestPassScore")}: <span className="font-data tabular-nums">{latestScore ?? "—"}</span></span>}</span></span>
          <span className="wrap-break-word text-xs">{developmentCell(row)}</span>
          {showScore && <span className="hidden text-right font-data text-xs tabular-nums text-cz-1 sm:block" data-testid="daily-receipt-latest-score">{latestScore ?? "—"}</span>}
          <span className="text-right font-data text-xs tabular-nums text-cz-1">{change(row.fatigue_before,row.fatigue,fatigueColor)}</span>
        </button>
        {open && <div id={detailId} className="border-t border-cz-border py-4 sm:pl-[19px]" data-testid="daily-receipt-rider-details">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <RiderLink id={row.rider_id} className="text-[13px] font-semibold text-cz-accent-t">{row.name || row.rider_id}</RiderLink>
            <span className="font-data text-xs tabular-nums text-cz-2">{t("dailyReceipt.form")}: {change(row.form_before,row.form,formColor)}</span>
          </div>
          {injuryMessage && <p className="mb-3 text-xs text-cz-danger" title={reportInjury?.unit === "race_day" && reportInjury.approxDate ? t("injuredApprox", {date:formatDate(reportInjury.approxDate)}) : undefined}>{t(injuryMessage.key,{days:injuryMessage.days})}</p>}
          <ol className="mb-4 grid grid-cols-3 gap-x-3 gap-y-3 sm:grid-cols-5">
            {row.activities.map((activity,index)=><li key={index}>
              <p className="font-data text-2xs tabular-nums text-cz-3">{activity.game_day != null && activity.game_day >= 0 ? t("dailyReceipt.raceDay",{day:activity.game_day+1}) : t("dailyReceipt.activity",{n:index+1})}</p>
              <p className="mt-1 wrap-break-word text-xs font-medium text-cz-1">{activityName(activity)}</p>
              {activity.intensity && activity.intensity !== "rest" && !activity.race_day && <p className="text-2xs text-cz-3">{tRider(`training.intensity_${activity.intensity}`)}</p>}
              {showScore && !activity.race_day && !activity.injured && activity.intensity !== "rest" && <p className="mt-1 font-data text-xs tabular-nums text-cz-1" data-testid="daily-receipt-pass-score">{t("colScore")}: {visible ? receiptPassScore(trainingScore?.[row.rider_id],run.tick_date,run.season_id,activity) ?? "—" : "—"}</p>}
            </li>)}
          </ol>
          {visible && <div className="mb-3" data-testid="daily-receipt-whole-point-detail">
            <p className={`${META} mb-1`}>{t("dailyReceipt.wholePoints")}</p>
            {whole.length ? whole.map(({key,points:n})=><div key={key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-cz-border py-2 text-xs">
              <span className="font-semibold text-cz-1">{abilityName(key)}</span>
              <span className="flex items-baseline gap-3 font-data tabular-nums">
                <span className="text-cz-3">{dev.gain_percent[key] != null ? t("dailyReceipt.pointContribution",{percent:formatNumber(dev.gain_percent[key])}) : t("dailyReceipt.progressUnavailable")}</span>
                <span className="font-semibold text-cz-1">{dev.gains_detail[key] ? change(dev.gains_detail[key].from,dev.gains_detail[key].to) : `+${formatNumber(n)}`}</span>
              </span>
            </div>) : <p className="border-t border-cz-border py-2 text-xs text-cz-2" data-testid="daily-receipt-no-whole-point">{t("dailyReceipt.noWholePoint")}</p>}
          </div>}
          {visible && progress.length > 0 && <div data-testid="daily-receipt-progress-detail">
            <p className={`${META} mb-1`}>{t("dailyReceipt.progressHeading")}</p>
            {/* #7746: columns read top to bottom, so the list keeps the profile's order. */}
            <div className="gap-x-6 sm:columns-2">
              {progress.map(({key,percent})=><div key={key} className="flex break-inside-avoid items-baseline justify-between gap-3 border-t border-cz-border py-1.5 text-xs">
                <span className="text-cz-2">{abilityName(key)}</span>
                <span className="font-data tabular-nums text-cz-2">{t("dailyReceipt.pointContribution",{percent:formatNumber(percent)})}</span>
              </div>)}
            </div>
          </div>}
          {showScore && <p className="mt-3 font-data text-xs tabular-nums text-cz-2" data-testid="training-history-score-cell">{t("dailyReceipt.latestPassScore")}: {latestScore ?? "—"}</p>}
          {showScore && <p className="mt-1 font-data text-xs tabular-nums text-cz-2" data-testid="daily-receipt-avg-score">{t("dailyReceipt.averagePassScore")}: {avgScore(row) ?? "—"}</p>}
          <p className="mt-3 text-xs text-cz-3">{row.trained_now ? t("dailyReceipt.note.trainedNow") : t(`dailyReceipt.note.${row.receipt_status}`)}</p>
        </div>}
      </div>
    );
  };
  return (
    <Section data-testid="daily-training-receipt" data-date={run.tick_date} data-status={run.receipt_status}>
      <button type="button" className={`flex min-h-[44px] w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 text-left ${expanded ? "mb-4" : ""}`} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)} data-testid="training-history-day-toggle">
        <SectionHeader title={`${formatDate(run.tick_date)}${run.previous_season ? ` · ${t("dailyReceipt.previousSeason")}` : ""}`} className="mb-0" />
        <span className={`flex items-center gap-2 ${META}`}>
          {/* #7745: a folded date still says what it landed. */}
          {!expanded && pointsKnown && <><span className="tabular-nums text-cz-1" data-testid="daily-receipt-points-meta">{t("dailyReceipt.pointsMeta",{count:points})}</span><span aria-hidden="true">·</span></>}
          <span data-testid="daily-receipt-status">{trainedNow ? trainedNowLabel : t(`dailyReceipt.status.${run.receipt_status}`)}</span>
          <ChevronDownIcon size={14} className={expanded ? "rotate-180" : ""} aria-hidden="true" />
        </span>
      </button>
      {expanded && <>
      <p className="mb-4 text-xs text-cz-2" role={wholeDateKnown ? undefined : "status"}>
        {trainedNow ? <span data-testid="daily-receipt-trained-now-note">{t("dailyReceipt.note.trainedNow")}</span> : t(`dailyReceipt.note.${run.receipt_status}`)}
      </p>
      <div className="mb-3 grid grid-cols-3 gap-3 border-b border-cz-border pb-4">
        <div data-testid="daily-receipt-whole-points-total"><p className="font-data text-xl font-bold tabular-nums text-cz-1">{pointsKnown ? points : "—"}</p><p className="text-2xs text-cz-3">{t(trainedNow ? "dailyReceipt.wholePointsSoFar" : "dailyReceipt.wholePoints")}</p></div>
        {trainedNow
          ? <div data-testid="daily-receipt-trained-now-count"><p className="font-data text-lg font-semibold tabular-nums text-cz-1">{trainedRows.length}</p><p className="text-2xs text-cz-3">{t("dailyReceipt.trainedNowCount")}</p></div>
          : <div><p className="font-data text-lg font-semibold tabular-nums text-cz-1">{known.length} / {rows.length}</p><p className="text-2xs text-cz-3">{t("dailyReceipt.riderReceipts")}</p></div>}
        <div><p className="font-data text-lg font-semibold tabular-nums text-cz-1">{gameDays.length || "—"}{run.expected_game_days ? ` / ${run.expected_game_days.length}` : ""}</p><p className="text-2xs text-cz-3">{t("dailyReceipt.activitiesRecorded")}</p></div>
      </div>
      {rows.length > 1 && <div className="mb-1 flex flex-wrap items-center justify-between gap-2" data-testid="daily-receipt-toolbar">
        <Segmented label={t("dailyReceipt.sortLabel")} value={sortBy} onChange={(value: ReceiptSort)=>setSortBy(value)}
          options={[{value:"name",label:t("dailyReceipt.sortFirstName")},{value:"lastname",label:t("dailyReceipt.sortLastName")},
            ...(showScore ? [{value:"score",label:t("colScore")}] : [])]} />
        <button type="button" className="min-h-[44px] px-1 text-xs font-medium text-cz-accent-t hover:text-cz-1" data-testid="daily-receipt-expand-all"
          onClick={()=>setOpenRiders(allOpen ? new Set() : new Set(rows.map(row=>row.rider_id)))}>
          {t(allOpen ? "dailyReceipt.collapseAll" : "dailyReceipt.expandAll")}
        </button>
      </div>}
      <div className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem] gap-2 py-2 font-data text-2xs uppercase tracking-[.06em] text-cz-3 ${rowGrid}`}>
        <span>{t("colRider")}</span><span>{t("dailyReceipt.development")}</span>{showScore && <span className="hidden text-right sm:block">{t("dailyReceipt.latestPassScore")}</span>}<span className="text-right">{t("dailyReceipt.fatigue")}</span>
      </div>
      {rows.map(renderRow)}
      {waiting.map(rider => <div key={rider.rider_id} className={`grid min-h-[44px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem] items-center gap-2 border-t border-cz-border py-3 ${rowGrid}`} data-testid="daily-receipt-waiting">
        <span className="flex min-w-0 items-start gap-1.5 pl-[19px]"><RiderLink id={rider.rider_id} className="wrap-break-word text-[13px] font-semibold text-cz-1">{rider.name || rider.rider_id}</RiderLink></span>
        <span className="wrap-break-word text-xs text-cz-3">{t("dailyReceipt.waitingForRace")}</span>
        {showScore && <span className="hidden text-right font-data text-xs tabular-nums text-cz-3 sm:block">—</span>}
        <span className="text-right font-data text-xs tabular-nums text-cz-3">—</span>
      </div>)}
      </>}
    </Section>
  );
}
