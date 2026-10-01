import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DailyTrainingReceipt as DateReceipt, DailyRiderReceipt, TrainingActivity } from "../../lib/trainingDailyReceipt.ts";
import { averagePassScore, sortReceiptRiders, type ReceiptSort } from "../../lib/trainingDailyReceipt.ts";
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

type ScoreView = Record<string, ReceiptScoreView> | null;
type ConditionView = Record<string, { injured_until?: string | null; injury_race_days_left?: number | null }>;
export default function DailyTrainingReceipt({ run, trainingScore = null, defaultExpanded = true, condition, today }: { run: DateReceipt; trainingScore?: ScoreView; defaultExpanded?: boolean; condition?: ConditionView; today?: Date }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const change = (from: number | null | undefined, to: number | null | undefined, tone?: (value: number) => string) =>
    typeof from === "number" && typeof to === "number"
      ? <span className="inline-flex items-center gap-1" aria-label={t("dailyReceipt.change",{from:formatNumber(from),to:formatNumber(to)})}><span className={tone?.(from)}>{formatNumber(from)}</span><ChevronRightIcon size={12} className="text-cz-3" aria-hidden="true" /><span className={tone?.(to)}>{formatNumber(to)}</span></span> : "—";
  const [openRiders, setOpenRiders] = useState<Set<string>>(() => new Set());
  const toggleRider = (id: string) => setOpenRiders(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [sortBy, setSortBy] = useState<ReceiptSort>("name");
  const avgScore = (row: DailyRiderReceipt) => isKnown(row)
    ? averagePassScore(trainingScore?.[row.rider_id], run.tick_date, run.season_id, row.activities) : null;
  const rows = sortReceiptRiders(run.report.riders, sortBy, avgScore);
  const showScore = trainingScore != null;
  const rowGrid = showScore
    ? "sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_5rem_6rem]"
    : "sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_6rem]";
  const allOpen = rows.length > 0 && rows.every(row => openRiders.has(row.rider_id));
  const known = rows.filter(isKnown);
  const points = known.reduce((sum, row) => sum + todayGainTotal(row), 0);
  const wholeDateKnown = run.receipt_status === "complete" || run.receipt_status === "recorded";
  const abilityName = (key: string) => tRider(`racePreview.derived.${key}`);
  const activityName = (activity: TrainingActivity) => activity.status === "unknown_pending"
    ? t("dailyReceipt.status.reconciliation")
    : activity.injured ? t("dailyReceipt.injured")
    : activity.race_day ? t("dailyReceipt.race")
    : activity.intensity === "rest" ? t("restDay")
    : activity.focus ? tRider(`training.focus_${activity.focus}`) : t("dailyReceipt.training");
  const gainsLabel = (row: DailyRiderReceipt) => {
    if (!isKnown(row)) return t(`dailyReceipt.status.${row.receipt_status}`);
    const whole = Object.entries(row.gains).filter(([, n])=>n > 0);
    if (whole.length) return whole.map(([key,n])=>`${abilityName(key)} +${formatNumber(n)}`).join(", ");
    const fractional = Object.entries(row.gain_percent).filter(([,n])=>n != null && n > 0);
    if (fractional.length) return fractional.map(([key,n])=>`${abilityName(key)} ${t("dailyReceipt.pointContribution",{percent:formatNumber(n)})}`).join(", ");
    return t("dailyReceipt.noWholePoint");
  };
  return (
    <Section data-testid="daily-training-receipt" data-date={run.tick_date} data-status={run.receipt_status}>
      <button type="button" className="mb-4 flex min-h-[44px] w-full flex-wrap items-baseline justify-between gap-3 text-left" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)} data-testid="training-history-day-toggle">
        <SectionHeader title={`${formatDate(run.tick_date)}${run.previous_season ? ` · ${t("dailyReceipt.previousSeason")}` : ""}`} className="mb-0" />
        <span className="flex items-center gap-2 font-data text-2xs uppercase tracking-[.08em] text-cz-3">{t(`dailyReceipt.status.${run.receipt_status}`)}<ChevronDownIcon size={14} className={expanded ? "rotate-180" : ""} aria-hidden="true" /></span>
      </button>
      {expanded && <>
      <p className="mb-4 text-xs text-cz-2" role={wholeDateKnown ? undefined : "status"}>
        {t(`dailyReceipt.note.${run.receipt_status}`)}
      </p>
      <div className="mb-3 grid grid-cols-3 gap-3 border-b border-cz-border pb-4">
        <div><p className="font-data text-lg font-semibold tabular-nums text-cz-1">{known.length} / {rows.length}</p><p className="text-2xs text-cz-3">{t("dailyReceipt.riderReceipts")}</p></div>
        <div><p className="font-data text-lg font-semibold tabular-nums text-cz-1">{run.game_days.length || "—"}{run.expected_game_days ? ` / ${run.expected_game_days.length}` : ""}</p><p className="text-2xs text-cz-3">{t("dailyReceipt.activitiesRecorded")}</p></div>
        <div><p className="font-data text-lg font-semibold tabular-nums text-cz-1">{wholeDateKnown ? points : "—"}</p><p className="text-2xs text-cz-3">{t("dailyReceipt.wholePoints")}</p></div>
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
      {rows.map(row => {
        const open = openRiders.has(row.rider_id);
        const latestScore = isKnown(row) ? latestReceiptPassScore(trainingScore?.[row.rider_id],run.tick_date,run.season_id,row.activities) : null;
        const gainTone = isKnown(row) && (todayGainTotal(row) > 0 || Object.values(row.gain_percent).some(value => value != null && value > 0))
          ? "text-cz-success" : "text-cz-2";
        const reportInjury = condition && today ? injuryTimeLeft(condition[row.rider_id], today) : null;
        const injuryMessage = reportInjury && reportInjury.count > 0 ? injuryBadgeMessage(reportInjury, { compact: true }) : null;
        const detailId = `receipt-${run.tick_date}-${run.season_id ?? "legacy"}-${row.rider_id}`;
        const abilities = [...new Set([...Object.keys(row.gains), ...Object.keys(row.gain_percent)])]
          .filter(key => (row.gains[key] ?? 0) > 0 || (row.gain_percent[key] ?? 0) > 0);
        return (
          <div key={row.rider_id} className="border-t border-cz-border">
            <button type="button" className={`grid min-h-[44px] w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem] items-center gap-2 py-3 text-left hover:bg-cz-subtle ${rowGrid}`}
              aria-expanded={open} aria-controls={detailId} onClick={()=>toggleRider(row.rider_id)}>
              <span className="flex min-w-0 items-start gap-1.5"><ChevronDownIcon size={13} className={`mt-1 shrink-0 text-cz-3 ${open ? "rotate-180" : ""}`} aria-hidden="true" /><span className="min-w-0"><span className="break-words text-[13px] font-semibold text-cz-1">{row.name || row.rider_id}</span>{showScore && <span className="mt-1 block text-2xs text-cz-2 sm:hidden" data-testid="daily-receipt-mobile-score">{t("dailyReceipt.latestPassScore")}: <span className="font-data tabular-nums">{latestScore ?? "—"}</span></span>}</span></span>
              <span className={`break-words text-xs ${gainTone}`}>{gainsLabel(row)}</span>
              {showScore && <span className="hidden text-right font-data text-xs tabular-nums text-cz-1 sm:block" data-testid="daily-receipt-latest-score">{latestScore ?? "—"}</span>}
              <span className="text-right font-data text-xs tabular-nums text-cz-1">{change(row.fatigue_before,row.fatigue,fatigueColor)}</span>
            </button>
            {open && <div id={detailId} className="border-t border-cz-border py-4" data-testid="daily-receipt-rider-details">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <RiderLink id={row.rider_id} className="text-[13px] font-semibold text-cz-accent-t">{row.name || row.rider_id}</RiderLink>
                <span className="font-data text-xs tabular-nums text-cz-2">{t("dailyReceipt.form")}: {change(row.form_before,row.form,formColor)}</span>
              </div>
              {injuryMessage && <p className="mb-3 text-xs text-cz-danger" title={reportInjury?.unit === "race_day" && reportInjury.approxDate ? t("injuredApprox", {date:formatDate(reportInjury.approxDate)}) : undefined}>{t(injuryMessage.key,{days:injuryMessage.days})}</p>}
              <ol className="mb-4 grid grid-cols-3 gap-x-3 gap-y-3 sm:grid-cols-5">
                {row.activities.map((activity,index)=><li key={index}>
                  <p className="font-data text-2xs tabular-nums text-cz-3">{activity.game_day != null ? t("dailyReceipt.raceDay",{day:activity.game_day+1}) : t("dailyReceipt.activity",{n:index+1})}</p>
                  <p className="mt-1 break-words text-xs font-medium text-cz-1">{activityName(activity)}</p>
                  {activity.intensity && activity.intensity !== "rest" && !activity.race_day && <p className="text-2xs text-cz-3">{tRider(`training.intensity_${activity.intensity}`)}</p>}
                  {showScore && !activity.race_day && !activity.injured && activity.intensity !== "rest" && <p className="mt-1 font-data text-xs tabular-nums text-cz-1" data-testid="daily-receipt-pass-score">{t("colScore")}: {isKnown(row) ? receiptPassScore(trainingScore?.[row.rider_id],run.tick_date,run.season_id,activity) ?? "—" : "—"}</p>}
                </li>)}
              </ol>
              {isKnown(row) && abilities.map(key=><div key={key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-cz-border py-2 text-xs">
                <span className="text-cz-1">{abilityName(key)}</span>
                <span className="font-data tabular-nums text-cz-1">{row.gains_detail[key] ? change(row.gains_detail[key].from,row.gains_detail[key].to) : (row.gains[key] ?? 0) > 0 ? `+${formatNumber(row.gains[key])}` : "—"}</span>
                <span className="text-cz-2">{row.gain_percent[key] != null ? t("dailyReceipt.pointContribution",{percent:formatNumber(row.gain_percent[key])}) : t("dailyReceipt.progressUnavailable")}</span>
              </div>)}
              {showScore && <p className="mt-3 font-data text-xs tabular-nums text-cz-2" data-testid="training-history-score-cell">{t("dailyReceipt.latestPassScore")}: {latestScore ?? "—"}</p>}
              {showScore && <p className="mt-1 font-data text-xs tabular-nums text-cz-2" data-testid="daily-receipt-avg-score">{t("dailyReceipt.averagePassScore")}: {avgScore(row) ?? "—"}</p>}
              <p className="mt-3 text-xs text-cz-3">{t(`dailyReceipt.note.${row.receipt_status}`)}</p>
            </div>}
          </div>
        );
      })}
      </>}
    </Section>
  );
}
