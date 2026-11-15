import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Section from "../../ui/Section.jsx";
import Segmented from "../../ui/Segmented.jsx";
import HeroStats from "../../ui/HeroStats.jsx";
import { Flag } from "../../Flag.jsx";
import RiderLink from "../../RiderLink.jsx";
import { formatDate, formatNumber } from "../../../lib/intl.js";
import { filterMonthRiders, xpOfPrice, TIRED_FATIGUE, type MonthFilter, type XpMonthView } from "../../../lib/trainingReportXp.ts";
import { XpBar, XpColumn, XpLegend, XpSpark } from "./XpBar.tsx";
import { PointsMark } from "./XpToday.tsx";

// #7627 · "30 days" in XP. The squad's XP per day (training and race) on top, a
// tap on a day opens Today for that day; below, each rider's 30 days, his XP and
// new points, form and fatigue now, and the ability closest to its next point.
// Never a days-to-go estimate: that would read talent off the bar (spec §5.2, H6b).

const META = "font-data text-2xs uppercase tracking-[.08em] text-cz-3";
const NUM = "font-data tabular-nums";
const ROW_GRID = "lg:grid-cols-[minmax(0,1.4fr)_minmax(6rem,0.9fr)_4.5rem_5rem_3.5rem_3.5rem_minmax(12rem,1.4fr)]";
const CHART_HEIGHT = 112;
const xp = (n: number) => formatNumber(Math.round(n));

export default function XpMonth({ view, onOpenDay, switcher }: { view: XpMonthView; onOpenDay: (date: string) => void; switcher: ReactNode }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const [filter, setFilter] = useState<MonthFilter>("all");
  const riders = filterMonthRiders(view.riders, filter);
  const max = Math.max(1, ...view.days.map(d => d.training + d.race));
  const first = view.days[0], middle = view.days[Math.floor(view.days.length / 2)];
  const short = (date: string) => formatDate(date, null, { day: "numeric", month: "short" });
  return (
    <>
      <Section data-testid="xp-month">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-cz-1">{t("xpReport.monthTitle")}</h2>
          {switcher}
        </div>
        <HeroStats items={[
          { label: t("xpReport.xp30"), value: xp(view.xp), sub: t("xpReport.newPointsSub", { count: view.points }) },
          { label: t("xpReport.fromRaces"), value: view.racePercent != null ? `${formatNumber(view.racePercent)} %` : t("xpReport.noRace"),
            sub: view.racePercent != null ? <span className="mt-1 block w-24"><XpBar training={(100 - view.racePercent) / 100} race={view.racePercent / 100} label={t("xpReport.shareLabel", { race: formatNumber(view.racePercent) })} /></span> : undefined },
          { label: t("xpReport.tired"), value: formatNumber(view.tired), sub: t("xpReport.tiredSub", { value: formatNumber(TIRED_FATIGUE) }) },
        ]} />
        <div className="mt-4 border-t border-cz-border pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <XpLegend />
            <span className={META}>{t("xpReport.chartLabel")}</span>
          </div>
          <ol className="flex items-end gap-px" aria-label={t("xpReport.chartLabel")} data-testid="xp-chart">
            {view.days.map(day => (
              <li key={day.date} className="min-w-0 flex-1">
                {/* Phones read the chart; the day itself is one tap away in Today's strip and arrows. */}
                <button type="button" onClick={() => onOpenDay(day.date)} className="block w-full hover:bg-cz-subtle max-sm:pointer-events-none"
                  aria-label={t("xpReport.openDay", { date: formatDate(day.date, null, { weekday: "long", day: "numeric", month: "long" }), training: xp(day.training), race: xp(day.race) })}>
                  <XpColumn training={day.training} race={day.race} max={max} height={CHART_HEIGHT} />
                </button>
              </li>
            ))}
          </ol>
          <div className={`mt-1 flex justify-between text-3xs text-cz-3 ${NUM}`}>
            <span>{first && short(first.date)}</span><span>{middle && short(middle.date)}</span><span className="font-semibold text-cz-1">{t("xpReport.today")}</span>
          </div>
        </div>
      </Section>
      <Section data-testid="xp-month-list">
        <div className="-mx-1 mb-1 overflow-x-auto px-1 pb-1">
          <Segmented label={t("xpReport.filterLabel")} value={filter} onChange={(v: MonthFilter) => setFilter(v)} className="whitespace-nowrap"
            options={[
              { value: "all", label: t("xpReport.filter.all", { count: view.riders.length }) },
              { value: "closest", label: t("xpReport.filter.closest") },
              { value: "tired", label: t("xpReport.filter.tired", { count: view.tired }) },
            ]} />
        </div>
        <div className={`hidden gap-x-4 py-2 lg:grid ${ROW_GRID} ${META}`} aria-hidden="true">
          <span>{t("colRider")}</span><span>{t("xpReport.days30")}</span><span className="text-right">{t("xpReport.colXp")}</span>
          <span>{t("xpReport.colPoints")}</span><span className="text-right">{t("dailyReceipt.form")}</span><span className="text-right">{t("dailyReceipt.fatigue")}</span><span>{t("xpReport.nextPoint")}</span>
        </div>
        {riders.map(r => {
          const of = r.next ? xpOfPrice(r.next) : null;
          return (
            <div key={r.id} className={`grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-x-4 gap-y-1.5 border-t border-cz-border py-2.5 ${ROW_GRID}`} data-testid="xp-month-row">
              <span className="flex min-h-11 min-w-0 items-center gap-2 lg:min-h-0">
                {r.nation && <Flag code={r.nation} className="shrink-0" />}
                <RiderLink id={r.id} className="min-w-0 truncate text-[13px] font-semibold text-cz-1 hover:underline">{r.name}</RiderLink>
              </span>
              <span className="block min-w-0"><XpSpark values={r.spark} /></span>
              <span className={`col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-cz-2 lg:contents ${NUM}`}>
                <span className="lg:text-right"><span className="lg:hidden">{t("xpReport.days30")} </span><span className="font-semibold text-cz-1">{t("xpReport.xpValue", { xp: xp(r.xp) })}</span></span>
                <span><PointsMark>{t("xpReport.points", { count: r.points })}</PointsMark></span>
                <span className="lg:text-right"><span className="lg:hidden">{t("dailyReceipt.form")} </span><span className="text-cz-1">{r.form != null ? formatNumber(r.form) : t("xpReport.unknown")}</span></span>
                <span className="lg:text-right"><span className="lg:hidden">{t("dailyReceipt.fatigue")} </span><span className="text-cz-1">{r.fatigue != null ? formatNumber(r.fatigue) : t("xpReport.unknown")}</span></span>
              </span>
              <span className="col-span-2 grid grid-cols-[auto_minmax(3rem,1fr)_auto] items-center gap-2 text-xs lg:col-span-1" data-testid="xp-next-point">
                {r.next && of ? <>
                  <span className="text-cz-2"><span className="lg:hidden">{t("xpReport.nextPoint")}: </span><span className="font-semibold text-cz-1">{tRider(`racePreview.derived.${r.next.key}`)}</span></span>
                  <XpBar training={r.next.xp / r.next.price} race={0} label={t("xpReport.xpOf", { xp: formatNumber(of.xp), price: formatNumber(of.price) })} />
                  <span className={`text-cz-3 ${NUM}`}>{t("xpReport.xpOf", { xp: formatNumber(of.xp), price: formatNumber(of.price) })}</span>
                </> : <span className="col-span-3 text-cz-3">{t("xpReport.unknown")}</span>}
              </span>
            </div>
          );
        })}
      </Section>
    </>
  );
}
