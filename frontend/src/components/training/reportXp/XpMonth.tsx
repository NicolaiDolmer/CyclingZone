import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Section from "../../ui/Section.jsx";
import Segmented from "../../ui/Segmented.jsx";
import HeroStats from "../../ui/HeroStats.jsx";
import { Flag, RiderNameCell, formatDay } from "./ui.ts";
import { formatNumber } from "../../../lib/intl.js";
import { filterMonthRiders, xpOfPrice, TIRED_FATIGUE, type MonthFilter, type XpMonthView } from "../../../lib/trainingReportXp.ts";
import { XpBar, XpColumn, XpLegend, XpSpark } from "./XpBar.tsx";
import { FormPlate, PaidNote, PointsMark, PaidMark, TypeCell, shortName, usePhoneNames } from "./XpToday.tsx";

// #7627 · "30 days" in XP. The squad's XP per day (training and race) on top, a
// tap on a day opens Today for that day; below, each rider's 30 days, his XP and
// new points, form and fatigue now, and the ability closest to its next point.
// Never a days-to-go estimate: that would read talent off the bar (spec §5.2, H6b).
// Points earned by the day's own XP and points paid out from the bar stay apart
// here too (Fable verdict on PR #8276, point 5).

const META = "font-data text-2xs uppercase tracking-[.08em] text-cz-3";
const NUM = "font-data tabular-nums";
// One line per rider. Phone: name + three numbers (D-047).
const ROW_GRID = "grid-cols-[minmax(0,1fr)_3.25rem_2.75rem_2.75rem] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(5rem,0.8fr)_4rem_3.5rem_3.5rem_2.5rem_2.75rem_minmax(13rem,1.5fr)]";
const CHART_HEIGHT = 112;
const xp = (n: number) => formatNumber(Math.round(n));

export default function XpMonth({ view, onOpenDay, switcher }: { view: XpMonthView; onOpenDay: (date: string) => void; switcher: ReactNode }) {
  const { t } = useTranslation("trainingXp");
  const { t: tRider } = useTranslation("rider");
  const [filter, setFilter] = useState<MonthFilter>("all");
  const riders = filterMonthRiders(view.riders, filter);
  const phone = usePhoneNames();
  const max = Math.max(1, ...view.days.map(d => d.training + d.race));
  const first = view.days[0], middle = view.days[Math.floor(view.days.length / 2)];
  const short = (date: string) => formatDay(date, { day: "numeric", month: "short" });
  return (
    <>
      <Section data-testid="xp-month">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-cz-1">{t("xpReport.monthTitle")}</h2>
          {switcher}
        </div>
        <HeroStats items={[
          { label: t("xpReport.xp30"), value: xp(view.xp), sub: t("xpReport.newPointsSub", { count: view.points }) },
          { label: t("xpReport.earnedToday30"), value: `+${formatNumber(view.earned)}` },
          { label: t("xpReport.paidOut"), value: `+${formatNumber(view.paid)}` },
          { label: t("xpReport.fromRaces"), value: view.racePercent != null ? `${formatNumber(view.racePercent)} %` : t("xpReport.noRace"),
            sub: view.racePercent != null ? <span className="mt-1 block w-24"><XpBar training={(100 - view.racePercent) / 100} race={view.racePercent / 100} label={t("xpReport.shareLabel", { race: formatNumber(view.racePercent) })} /></span> : undefined },
          { label: t("xpReport.tired"), value: formatNumber(view.tired), sub: t("xpReport.tiredSub", { value: formatNumber(TIRED_FATIGUE) }) },
        ]} />
        {view.paid > 0 && <PaidNote className="mt-3" />}
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
                  aria-label={t("xpReport.openDay", { date: formatDay(day.date, { weekday: "long", day: "numeric", month: "long" }), training: xp(day.training), race: xp(day.race) })}>
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
        <div className={`grid items-end gap-x-2 py-2 lg:gap-x-3 ${ROW_GRID} ${META}`} aria-hidden="true" data-testid="xp-month-head">
          <span>{t("training:colRider")}</span>
          <span className="hidden lg:block">{t("training:colType")}</span>
          <span className="hidden lg:block">{t("xpReport.days30")}</span>
          <span className="text-right">{t("xpReport.colXp")}</span>
          <span className="text-right">{t("xpReport.colEarned")}</span>
          <span className="text-right">{t("xpReport.colPaid")}</span>
          <span className="hidden text-right lg:block">{t("training:dailyReceipt.form")}</span>
          <span className="hidden text-right lg:block">{t("training:dailyReceipt.fatigue")}</span>
          <span className="hidden lg:block">{t("xpReport.nextPoint")}</span>
        </div>
        {riders.map(r => {
          const of = r.next ? xpOfPrice(r.next) : null;
          return (
            <div key={r.id} className={`grid min-h-11 items-center gap-x-2 border-t border-cz-border py-1.5 lg:gap-x-3 ${ROW_GRID}`} data-testid="xp-month-row">
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap" data-testid="xp-name-cell">
                {r.nation && <Flag code={r.nation} className="shrink-0" />}
                <span className="min-w-0"><RiderNameCell id={r.id} name={phone ? shortName(r.name) : r.name} className="text-[13px] font-semibold text-cz-1 hover:text-cz-accent-t" /></span>
              </span>
              <span className="hidden min-w-0 lg:block"><TypeCell type={r.type} /></span>
              <span className="hidden min-w-0 lg:block"><XpSpark values={r.spark} /></span>
              <span className={`text-right text-xs font-semibold text-cz-1 ${NUM}`}>{xp(r.xp)}</span>
              <span className="flex justify-end">{r.earned > 0 ? <PointsMark>{t("xpReport.pointsShort", { count: r.earned })}</PointsMark> : <span className={`text-xs text-cz-3 ${NUM}`}>0</span>}</span>
              <span className="flex justify-end">{r.paid > 0 ? <PaidMark>{t("xpReport.pointsShort", { count: r.paid })}</PaidMark> : <span className={`text-xs text-cz-3 ${NUM}`}>0</span>}</span>
              <span className="hidden justify-self-end lg:block"><FormPlate value={r.form} /></span>
              <span className={`hidden text-right text-xs text-cz-1 lg:block ${NUM}`}>{r.fatigue != null ? formatNumber(r.fatigue) : t("xpReport.unknown")}</span>
              <span className="hidden min-w-0 grid-cols-[minmax(0,auto)_minmax(3rem,1fr)_auto] items-center gap-2 text-xs lg:grid" data-testid="xp-next-point">
                {r.next && of ? <>
                  <span className="truncate font-semibold text-cz-1">{tRider(`racePreview.derived.${r.next.key}`)}</span>
                  <XpBar training={r.next.xp / r.next.price} race={0} label={t("xpReport.xpOf", { xp: formatNumber(of.xp), price: formatNumber(of.price) })} />
                  <span className={`whitespace-nowrap text-cz-3 ${NUM}`}>{t("xpReport.xpOf", { xp: formatNumber(of.xp), price: formatNumber(of.price) })}</span>
                </> : <span className="col-span-3 text-cz-3">{t("xpReport.unknown")}</span>}
              </span>
            </div>
          );
        })}
      </Section>
    </>
  );
}
