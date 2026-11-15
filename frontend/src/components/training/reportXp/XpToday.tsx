import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Section from "../../ui/Section.jsx";
import Segmented from "../../ui/Segmented.jsx";
import HeroStats from "../../ui/HeroStats.jsx";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "../../ui/icons/index.jsx";
import RiderLink from "../../RiderLink.jsx";
import { Flag, formatDay } from "./ui.ts";
import { formatNumber } from "../../../lib/intl.js";
import { filterTodayRiders, xpOfPrice, type TodayFilter, type XpTodayRider, type XpTodayView } from "../../../lib/trainingReportXp.ts";
import { Swatch, XpBar, XpLegend } from "./XpBar.tsx";

// #7627 · "Today" in XP. Computer: the riders as a table on the left and the
// picked rider in a panel on the right. Phone: one column, the rider folds out
// under his own row (TASTE P10, the training page's own mobile rule).

const META = "font-data text-2xs uppercase tracking-[.08em] text-cz-3";
const NUM = "font-data tabular-nums";
const ROW_GRID = "grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1.6fr)_7rem_3.5rem_3.5rem_minmax(5rem,1fr)_4.75rem_4.75rem]";
const xp = (n: number) => formatNumber(Math.round(n));

/** A dark mark for whole points: the date's headline, never gold. */
export function PointsMark({ children, testId }: { children: ReactNode; testId?: string }) {
  return <span className={`inline-flex items-center rounded-cz bg-cz-1 px-1.5 py-0.5 text-xs font-semibold text-cz-card ${NUM}`} data-testid={testId}>{children}</span>;
}

/** The word mark for a rider who raced on the date. */
export function RacedTag() {
  const { t } = useTranslation("training");
  return <span className="shrink-0 rounded-cz border border-cz-border px-1 font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-2" data-testid="xp-raced">{t("xpReport.raced")}</span>;
}

function Change({ from, to, tone }: { from: number | null; to: number | null; tone?: "fatigue" }) {
  const { t } = useTranslation("training");
  if (from == null || to == null) return <span className="text-cz-3">{t("xpReport.unknown")}</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${NUM}`} aria-label={t("dailyReceipt.change", { from: formatNumber(from), to: formatNumber(to) })} data-tone={tone}>
      <span>{formatNumber(from)}</span><ChevronRightIcon size={11} className="text-cz-3" aria-hidden="true" /><span>{formatNumber(to)}</span>
    </span>
  );
}

function FatigueNow({ rider }: { rider: XpTodayRider }) {
  const { t } = useTranslation("training");
  if (rider.fatigue == null) return <span className="text-2xs text-cz-3">{t("xpReport.unknown")}</span>;
  const delta = rider.fatigueBefore != null ? rider.fatigue - rider.fatigueBefore : 0;
  return (
    <span className={`inline-flex items-center gap-1 text-2xs text-cz-2 ${NUM}`}>
      {t("xpReport.fatigueNow", { value: formatNumber(rider.fatigue) })}
      {delta !== 0 && <span className="inline-flex items-center text-cz-3" aria-label={t("xpReport.fatigueDelta", { delta: formatNumber(delta) })}>
        {delta > 0 ? <ArrowUpIcon size={10} aria-hidden="true" /> : <ArrowDownIcon size={10} aria-hidden="true" />}{formatNumber(Math.abs(delta))}
      </span>}
    </span>
  );
}

function Gained({ rider }: { rider: XpTodayRider }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  if (rider.points > 0) {
    return <PointsMark testId="xp-points-mark">{rider.pointAbility
      ? t("xpReport.pointAbility", { ability: tRider(`racePreview.derived.${rider.pointAbility}`) })
      : t("xpReport.points", { count: rider.points })}</PointsMark>;
  }
  return <span className={`text-xs text-cz-1 ${NUM}`} data-testid="xp-row-xp">{rider.xp > 0 ? t("xpReport.xpValue", { xp: xp(rider.xp) }) : t("xpReport.noXp")}</span>;
}

/** The picked rider: sessions, XP per ability, form, fatigue and session score. */
export function RiderDetail({ rider, panel = false }: { rider: XpTodayRider; panel?: boolean }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const sessionLabel = (kind: string) => t(`xpReport.session.${kind}`);
  return (
    <div data-testid={panel ? "xp-rider-panel" : "xp-rider-detail"}>
      {panel && <div className="mb-4 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {rider.nation && <Flag code={rider.nation} />}
          <RiderLink id={rider.id} className="truncate text-[15px] font-semibold text-cz-1 hover:underline">{rider.name}</RiderLink>
        </span>
        <Gained rider={rider} />
      </div>}
      {!panel && <RiderLink id={rider.id} className="mb-3 inline-flex min-h-11 items-center text-xs font-medium text-cz-1 underline decoration-cz-border underline-offset-2">{t("xpReport.openProfile")}</RiderLink>}
      <ol className="mb-3 grid grid-cols-5 gap-1.5" aria-label={t("xpReport.sessions")}>
        {rider.sessions.map((s, i) => (
          <li key={i} className={`min-w-0 rounded-cz border px-1.5 py-1.5 ${s.kind === "race" ? "border-cz-border-strong" : "border-cz-border"}`} data-kind={s.kind}>
            <p className="flex items-center gap-1 truncate text-xs font-medium text-cz-1">{s.kind === "race" && <Swatch part="race" />}{sessionLabel(s.kind)}</p>
            <p className={`truncate text-3xs text-cz-3 ${NUM}`}>{s.score != null ? t("xpReport.score", { score: formatNumber(s.score) }) : s.focus ? tRider(`training.focus_${s.focus}`) : " "}</p>
          </li>
        ))}
      </ol>
      <XpLegend before className="mb-2" />
      <ul>
        {rider.abilities.map(a => {
          const of = a.bar ? xpOfPrice(a.bar) : null;
          return (
            <li key={a.key} className="border-t border-cz-border py-2" data-testid="xp-ability">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-cz-1">{tRider(`racePreview.derived.${a.key}`)}</span>
                  {a.points > 0 && <PointsMark>{a.from != null && a.to != null
                    ? <span className="inline-flex items-center gap-0.5">{formatNumber(a.from)}<ChevronRightIcon size={10} aria-hidden="true" />{formatNumber(a.to)}</span>
                    : t("xpReport.points", { count: a.points })}</PointsMark>}
                </span>
                <span className={`flex items-baseline gap-2 text-xs ${NUM}`}>
                  <span className="font-semibold text-cz-1">{t("xpReport.xpValue", { xp: xp(a.xp) })}</span>
                  {of && <span className="text-cz-3">{t("xpReport.xpOf", { xp: formatNumber(of.xp), price: formatNumber(of.price) })}</span>}
                </span>
              </div>
              {a.segments && <XpBar {...a.segments} label={t("xpReport.barLabel", { training: xp(a.training), race: xp(a.race) })} />}
            </li>
          );
        })}
      </ul>
      <HeroStats className="mt-3" items={[
        { label: t("dailyReceipt.form"), value: <Change from={rider.formBefore} to={rider.form} /> },
        { label: t("dailyReceipt.fatigue"), value: <Change from={rider.fatigueBefore} to={rider.fatigue} tone="fatigue" /> },
        { label: t("xpReport.sessionScore"), value: rider.sessionScore != null ? formatNumber(rider.sessionScore) : t("xpReport.noScore") },
      ]} />
    </div>
  );
}

export default function XpToday({ view, onPickDate, switcher }: { view: XpTodayView; onPickDate: (date: string) => void; switcher: ReactNode }) {
  const { t } = useTranslation("training");
  const [filter, setFilter] = useState<TodayFilter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const riders = filterTodayRiders(view.riders, filter);
  const selected = riders.find(r => r.id === picked) ?? riders[0] ?? null;
  const maxXp = Math.max(1, ...riders.map(r => r.xp));
  const dayLabel = (date: string, style: Intl.DateTimeFormatOptions) => formatDay(date, style);
  const navButton = "inline-flex size-11 shrink-0 items-center justify-center rounded-cz border border-cz-border text-cz-2 hover:text-cz-1 disabled:opacity-40";
  return (
    <>
      <Section data-testid="xp-today">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" className={navButton} disabled={!view.previous} onClick={() => view.previous && onPickDate(view.previous)} aria-label={t("xpReport.previousDay")}><ChevronLeftIcon size={16} aria-hidden="true" /></button>
            <div className="min-w-0 px-1">
              <h2 className="truncate text-[15px] font-semibold text-cz-1" data-testid="xp-date">{dayLabel(view.date, { weekday: "short", day: "numeric", month: "short" })}</h2>
              <p className={META}>{t(`dailyReceipt.status.${view.status}`)}</p>
            </div>
            <button type="button" className={navButton} disabled={!view.next} onClick={() => view.next && onPickDate(view.next)} aria-label={t("xpReport.nextDay")}><ChevronRightIcon size={16} aria-hidden="true" /></button>
          </div>
          {switcher}
        </div>
        <ol className="mt-3 grid grid-cols-7 gap-1" aria-label={t("xpReport.lastSevenDays")}>
          {view.strip.map(day => {
            const active = day.date === view.date;
            return (
              <li key={day.date}>
                <button type="button" aria-pressed={active} onClick={active ? undefined : () => onPickDate(day.date)}
                  className={`flex min-h-11 w-full flex-col items-center justify-center rounded-cz border py-1 ${active ? "cursor-default border-cz-1" : "border-transparent hover:bg-cz-subtle"}`}
                  aria-label={t("xpReport.dayPoints", { date: dayLabel(day.date, { weekday: "long", day: "numeric", month: "long" }), count: day.points })}>
                  <span className="font-data text-3xs uppercase text-cz-3">{dayLabel(day.date, { weekday: "short" })}</span>
                  <span className={`text-xs font-semibold text-cz-1 ${NUM}`}>+{formatNumber(day.points)}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <HeroStats items={[
          { label: t("xpReport.xpToday"), value: xp(view.xp), sub: t("xpReport.xp30Sub", { xp: xp(view.xp30) }) },
          { label: t("xpReport.newPoints"), value: `+${formatNumber(view.points)}`, sub: t("xpReport.riders", { count: view.pointRiders }) },
          { label: t("xpReport.fromRaces"), value: view.racePercent != null ? `${formatNumber(view.racePercent)} %` : t("xpReport.noRace"),
            sub: view.racePercent != null ? <span className="mt-1 block w-24"><XpBar training={(100 - view.racePercent) / 100} race={view.racePercent / 100} label={t("xpReport.shareLabel", { race: formatNumber(view.racePercent) })} /></span> : undefined },
        ]} />
      </Section>
      <div className="grid items-start gap-[14px] lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <Section data-testid="xp-today-list">
          <div className="-mx-1 mb-1 overflow-x-auto px-1 pb-1">
            <Segmented label={t("xpReport.filterLabel")} value={filter} onChange={(v: TodayFilter) => setFilter(v)} className="whitespace-nowrap"
              options={(["all", "gained", "raced", "notRaced"] as TodayFilter[]).map(key => ({ value: key, label: t(`xpReport.filter.${key}`, { count: view.counts[key] }) }))} />
          </div>
          <div className={`hidden gap-x-3 py-2 lg:grid ${ROW_GRID} ${META}`} aria-hidden="true">
            <span>{t("colRider")}</span><span>{t("xpReport.colGained")}</span>
            <span className="text-right">{t("xpReport.legend.training")}</span><span className="text-right">{t("xpReport.legend.race")}</span>
            <span>{t("xpReport.colSplit")}</span><span className="text-right">{t("dailyReceipt.form")}</span><span className="text-right">{t("dailyReceipt.fatigue")}</span>
          </div>
          {riders.map(rider => {
            const isOpen = open === rider.id;
            const isPicked = selected?.id === rider.id;
            return (
              <div key={rider.id} className="border-t border-cz-border" data-testid="xp-row">
                <button type="button" aria-expanded={isOpen} onClick={() => { setPicked(rider.id); setOpen(isOpen ? null : rider.id); }}
                  className={`grid min-h-11 w-full items-center gap-x-3 gap-y-1.5 py-2.5 text-left hover:bg-cz-subtle ${ROW_GRID} ${isPicked ? "lg:bg-cz-subtle" : ""}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    {rider.nation && <Flag code={rider.nation} className="shrink-0" />}
                    <span className="min-w-0 truncate text-[13px] font-semibold text-cz-1">{rider.name}</span>
                    {rider.raced && <RacedTag />}
                    <ChevronDownIcon size={13} className={`ml-auto shrink-0 text-cz-3 lg:hidden ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </span>
                  <span className="justify-self-end lg:justify-self-start"><Gained rider={rider} /></span>
                  <span className={`hidden text-right text-xs text-cz-2 lg:block ${NUM}`}>{rider.training > 0 ? `+${xp(rider.training)}` : "0"}</span>
                  <span className={`hidden text-right text-xs text-cz-2 lg:block ${NUM}`}>{rider.race > 0 ? `+${xp(rider.race)}` : "0"}</span>
                  <span className="block min-w-0"><XpBar training={rider.training / maxXp} race={rider.race / maxXp} label={t("xpReport.barLabel", { training: xp(rider.training), race: xp(rider.race) })} testId="xp-row-bar" /></span>
                  <span className="hidden justify-self-end text-xs text-cz-1 lg:block"><Change from={rider.formBefore} to={rider.form} /></span>
                  <span className="justify-self-end lg:hidden"><FatigueNow rider={rider} /></span>
                  <span className="hidden justify-self-end text-xs text-cz-1 lg:block"><Change from={rider.fatigueBefore} to={rider.fatigue} tone="fatigue" /></span>
                </button>
                {isOpen && <div className="border-t border-cz-border py-3 lg:hidden"><RiderDetail rider={rider} /></div>}
              </div>
            );
          })}
        </Section>
        {selected && <Section className="hidden lg:sticky lg:top-4 lg:block"><RiderDetail rider={selected} panel /></Section>}
      </div>
    </>
  );
}
