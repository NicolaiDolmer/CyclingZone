import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Section from "../../ui/Section.jsx";
import Segmented from "../../ui/Segmented.jsx";
import HeroStats from "../../ui/HeroStats.jsx";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, InfoIcon } from "../../ui/icons/index.jsx";
import RiderLink from "../../RiderLink.jsx";
import { Flag, RiderNameCell, formatDay, statPlateStyle } from "./ui.ts";
import { formatNumber } from "../../../lib/intl.js";
import { riderShortName } from "../../../lib/riderName.ts";
import { useMediaQuery } from "../../../hooks/useMediaQuery.ts";
import { filterTodayRiders, xpOfPrice, type TodayFilter, type XpAbilityRow, type XpRiderType, type XpTodayRider, type XpTodayView } from "../../../lib/trainingReportXp.ts";
import { Swatch, XpBar, XpLegend } from "./XpBar.tsx";
import type { RatingChange } from "../../../lib/xpRatingChange.ts";

// #7627 · "Today" in XP. Computer: the riders as a table on the left and the
// picked rider in a panel on the right. Phone: one column, the rider folds out
// under his own row (TASTE P10, the training page's own mobile rule).
//
// Two kinds of new point, always apart (Fable verdict on PR #8276, point 5):
//   earned today           the date's own XP bought it: a dark mark.
//   paid out from the bar  XP saved on earlier days already covered it at the
//                          date's start: an outlined mark, named in words. It can
//                          land on a rest day or after a change of focus.

const META = "font-data text-2xs uppercase tracking-[.08em] text-cz-3";
const NUM = "font-data tabular-nums";
// One line per rider. Phone: name + three numbers (D-047) + the fold-out button.
// #7947 (owner 20/11): Rating is its own column after Form and Fatigue on the computer;
// on the phone it stands with them in the fold-out.
const ROW_GRID = "grid-cols-[minmax(0,1fr)_2.5rem_2.75rem_2.75rem_2.75rem] lg:grid-cols-[minmax(0,1.8fr)_minmax(0,0.9fr)_2.75rem_2.75rem_3.25rem_minmax(4.5rem,auto)_minmax(4.5rem,auto)_2.5rem_3.25rem_3.25rem_2.75rem]";
const xp = (n: number) => formatNumber(Math.round(n));

/** The owner's phone name form (18/9): "A. Brandvig". The receipt carries one full name. */
export function shortName(name: string): string {
  return riderShortName(nameParts(name));
}
/** First and last name for the name cell's full accessible name when the short form shows (#5383). */
export function nameParts(name: string): { firstname: string; lastname: string } {
  const [first = "", ...rest] = name.trim().split(/\s+/);
  return { firstname: first, lastname: rest.join(" ") };
}
/** Below the table breakpoint the name cell uses the short form. */
export const usePhoneNames = () => !useMediaQuery("(min-width: 1024px)");

/** A dark mark for whole points earned today: the date's headline, never gold. */
export function PointsMark({ children, testId }: { children: ReactNode; testId?: string }) {
  return <span className={`inline-flex max-w-full items-center truncate rounded-cz border border-cz-1 bg-cz-1 px-1.5 py-px text-xs font-semibold text-cz-card ${NUM}`} data-testid={testId}>{children}</span>;
}

/** An outlined mark for whole points paid out from the bar: same size, no fill, so it never reads as today's. */
export function PaidMark({ children, testId }: { children: ReactNode; testId?: string }) {
  return <span className={`inline-flex max-w-full items-center truncate rounded-cz border border-dashed border-cz-1 px-1.5 py-px text-xs font-semibold text-cz-1 ${NUM}`} data-testid={testId}>{children}</span>;
}

/** Rider type, its own column: the natural (primary) type; both types in the title. */
export function TypeCell({ type }: { type: XpRiderType | null }) {
  const { t } = useTranslation("riderTypes");
  if (!type?.primary) return null;
  const full = type.secondary && type.secondary !== type.primary
    ? `${t(`types.${type.primary}`)}/${t(`types.${type.secondary}`)}`
    : t(`types.${type.primary}`);
  // One line per rider: the primary type in the cell, both types on hover.
  return <span className="block truncate text-xs text-cz-2" title={full} data-testid="xp-type">{t(`types.${type.primary}`)}</span>;
}

/** Form as a number on the rating plate (owner call C, #8364). */
export function FormPlate({ value }: { value: number | null }) {
  const { t } = useTranslation("trainingXp");
  if (value == null) return <span className="text-2xs text-cz-3">{t("xpReport.unknown")}</span>;
  return <span className={`inline-flex min-w-[1.75rem] items-center justify-center rounded-cz px-1 py-px text-xs font-semibold ${NUM}`} style={statPlateStyle(value)} data-testid="xp-form-plate">{formatNumber(value)}</span>;
}

/** From and to with the game's stroke chevron between the numbers, never a typed arrow. */
function Change({ from, to, plate = false }: { from: number | null; to: number | null; plate?: boolean }) {
  const { t } = useTranslation("trainingXp");
  if (from == null || to == null) return <span className="text-cz-3">{t("xpReport.unknown")}</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${NUM}`} aria-label={t("training:dailyReceipt.change", { from: formatNumber(from), to: formatNumber(to) })}>
      <span className={plate ? "text-cz-3" : undefined}>{formatNumber(from)}</span><ChevronRightIcon size={11} className="text-cz-3" aria-hidden="true" />
      {plate ? <FormPlate value={to} /> : <span>{formatNumber(to)}</span>}
    </span>
  );
}

/** #7947 · The rating change "34 > 35", the same Change as form and fatigue. Nothing when it did not move. */
function RatingCell({ change }: { change?: RatingChange | null }) {
  if (!change) return null;
  return <span className="text-xs text-cz-1" data-testid="xp-rating"><Change from={change.from} to={change.to} /></span>;
}

/** Fatigue now with its change. Neutral until #8364's shared warm scale exists. */
function FatigueNow({ rider }: { rider: XpTodayRider }) {
  const { t } = useTranslation("trainingXp");
  if (rider.fatigue == null) return <span className="text-2xs text-cz-3">{t("xpReport.unknown")}</span>;
  const delta = rider.fatigueBefore != null ? rider.fatigue - rider.fatigueBefore : 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs text-cz-1 ${NUM}`}>
      {formatNumber(rider.fatigue)}
      {delta !== 0 && <span className="inline-flex items-center text-2xs text-cz-3" aria-label={t("xpReport.fatigueDelta", { delta: formatNumber(delta) })}>
        {delta > 0 ? <ArrowUpIcon size={10} aria-hidden="true" /> : <ArrowDownIcon size={10} aria-hidden="true" />}{formatNumber(Math.abs(delta))}
      </span>}
    </span>
  );
}

/** A row's points of one kind: "+1 Climbing" (one point), "+2", or a quiet 0. */
function PointsCell({ count, ability, kind, compact = false }: { count: number; ability: string | null; kind: "earned" | "paid"; compact?: boolean }) {
  const { t } = useTranslation("trainingXp");
  const { t: tRider } = useTranslation("rider");
  if (count <= 0) return <span className={`text-xs text-cz-3 ${NUM}`}>0</span>;
  const label = ability && !compact
    ? t("xpReport.pointAbility", { ability: tRider(`racePreview.derived.${ability}`) })
    : t("xpReport.pointsShort", { count });
  return kind === "earned"
    ? <PointsMark testId="xp-points-mark">{label}</PointsMark>
    : <span title={t("xpReport.paidNote")} className="max-w-full"><PaidMark testId="xp-paid-mark">{label}</PaidMark></span>;
}

/** One ability's new points in the detail: earned (dark) and paid out (outlined, named in words). */
function AbilityPoints({ a }: { a: XpAbilityRow }) {
  const { t } = useTranslation("trainingXp");
  if (a.points <= 0) return null;
  const jump = a.from != null && a.to != null
    ? <span className="inline-flex items-center gap-0.5">{formatNumber(a.from)}<ChevronRightIcon size={10} aria-hidden="true" />{formatNumber(a.to)}</span>
    : t("xpReport.points", { count: a.points });
  if (a.paid <= 0) return <PointsMark>{jump}</PointsMark>;
  if (a.earned <= 0) {
    return <span className="inline-flex items-center gap-1.5"><PaidMark testId="xp-ability-paid">{jump}</PaidMark><span className="text-2xs text-cz-2">{t("xpReport.fromTheBar")}</span></span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <PointsMark>{t("xpReport.earnedPoints", { count: a.earned })}</PointsMark>
      <PaidMark testId="xp-ability-paid">{t("xpReport.paidPoints", { count: a.paid })}</PaidMark>
    </span>
  );
}

/** One plain sentence on what "paid out from the bar" means. Shown only when it happened. */
export function PaidNote({ className = "" }: { className?: string }) {
  const { t } = useTranslation("trainingXp");
  return (
    <p className={`flex items-start gap-1.5 text-xs text-cz-2 ${className}`} data-testid="xp-paid-note">
      <InfoIcon size={13} className="mt-px shrink-0 text-cz-3" aria-hidden="true" />
      <span>{t("xpReport.paidNote")}</span>
    </p>
  );
}

/** The picked rider: earned and paid out, sessions, XP per ability, form, fatigue and rating. */
export function RiderDetail({ rider, panel = false }: { rider: XpTodayRider; panel?: boolean }) {
  const { t } = useTranslation("trainingXp");
  const { t: tRider } = useTranslation("rider");
  const sessionLabel = (kind: string) => t(`xpReport.session.${kind}`);
  return (
    <div data-testid={panel ? "xp-rider-panel" : "xp-rider-detail"}>
      {panel && <div className="mb-3 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          {rider.nation && <Flag code={rider.nation} className="shrink-0" />}
          <span className="min-w-0"><RiderNameCell id={rider.id} name={rider.name} className="text-[15px] font-semibold text-cz-1 hover:text-cz-accent-t" /></span>
        </span>
        <span className={`shrink-0 text-xs font-semibold text-cz-1 ${NUM}`}>{rider.xp > 0 ? t("xpReport.xpValue", { xp: xp(rider.xp) }) : t("xpReport.noXp")}</span>
      </div>}
      {!panel && <RiderLink id={rider.id} hoverCard={false} className="mb-3 inline-flex min-h-11 items-center text-xs font-medium text-cz-1 underline decoration-cz-border underline-offset-2">{t("xpReport.openProfile")}</RiderLink>}
      <dl className={`mb-3 grid gap-y-1 border-y border-cz-border py-2 text-xs ${NUM}`} data-testid="xp-rider-split">
        <div className="flex items-baseline justify-between gap-2"><dt className="text-cz-2">{t("xpReport.earnedToday")}</dt><dd className="font-semibold text-cz-1">{t("xpReport.pointsShort", { count: rider.earned })}</dd></div>
        <div className="flex items-baseline justify-between gap-2"><dt className="text-cz-2">{t("xpReport.paidOut")}</dt><dd className="font-semibold text-cz-1">{t("xpReport.pointsShort", { count: rider.paid })}</dd></div>
      </dl>
      {rider.paid > 0 && <PaidNote className="mb-3" />}
      <ol className="mb-3 grid grid-cols-5 gap-1.5" aria-label={t("xpReport.sessions")}>
        {rider.sessions.map((s, i) => (
          <li key={i} className={`min-w-0 rounded-cz border px-1.5 py-1.5 ${s.kind === "race" ? "border-cz-border-strong" : "border-cz-border"}`} data-kind={s.kind}>
            <p className="flex items-center gap-1 truncate text-xs font-medium text-cz-1">{s.kind === "race" && <Swatch part="race" />}{sessionLabel(s.kind)}</p>
            {/* #7947 (owner 20/11): no training score in the XP report; the session's focus, when it has one. */}
            <p className="truncate text-3xs text-cz-3">{s.focus ? tRider(`training.focus_${s.focus}`) : " "}</p>
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
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-semibold text-cz-1">{tRider(`racePreview.derived.${a.key}`)}</span>
                  <AbilityPoints a={a} />
                </span>
                <span className={`flex items-baseline gap-2 text-xs ${NUM}`}>
                  <span className="font-semibold text-cz-1">{a.xp > 0 ? t("xpReport.xpValue", { xp: xp(a.xp) }) : t("xpReport.noXp")}</span>
                  {of && <span className="text-cz-3">{t("xpReport.xpOf", { xp: formatNumber(of.xp), price: formatNumber(of.price) })}</span>}
                </span>
              </div>
              {a.segments && <XpBar {...a.segments} label={t("xpReport.barLabel", { training: xp(a.training), race: xp(a.race) })} />}
            </li>
          );
        })}
      </ul>
      <HeroStats className="mt-3" items={[
        { label: t("training:dailyReceipt.form"), value: <Change from={rider.formBefore} to={rider.form} plate /> },
        { label: t("training:dailyReceipt.fatigue"), value: <Change from={rider.fatigueBefore} to={rider.fatigue} /> },
        ...(rider.rating ? [{ label: tRider("header.overall"), value: <span data-testid="xp-rating-detail"><Change from={rider.rating.from} to={rider.rating.to} /></span> }] : []),
      ]} />
    </div>
  );
}

export default function XpToday({ view, onPickDate, switcher }: { view: XpTodayView; onPickDate: (date: string) => void; switcher: ReactNode }) {
  const { t } = useTranslation("trainingXp");
  const { t: tRider } = useTranslation("rider");
  const [filter, setFilter] = useState<TodayFilter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const riders = filterTodayRiders(view.riders, filter);
  const selected = riders.find(r => r.id === picked) ?? riders[0] ?? null;
  const dayLabel = (date: string, style: Intl.DateTimeFormatOptions) => formatDay(date, style);
  const navButton = "inline-flex size-11 shrink-0 items-center justify-center rounded-cz border border-cz-border text-cz-2 hover:text-cz-1 disabled:opacity-40";
  const toggle = (id: string) => { setPicked(id); setOpen(open === id ? null : id); };
  const phone = usePhoneNames();
  return (
    <>
      <Section data-testid="xp-today">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" className={navButton} disabled={!view.previous} onClick={() => view.previous && onPickDate(view.previous)} aria-label={t("xpReport.previousDay")}><ChevronLeftIcon size={16} aria-hidden="true" /></button>
            <div className="min-w-0 px-1">
              <h2 className="truncate text-[15px] font-semibold text-cz-1" data-testid="xp-date">{dayLabel(view.date, { weekday: "short", day: "numeric", month: "short" })}</h2>
              <p className={META}>{t(`training:dailyReceipt.status.${view.status}`)}</p>
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
          { label: t("xpReport.earnedToday"), value: `+${formatNumber(view.earned)}`, sub: t("xpReport.riders", { count: view.earnedRiders }) },
          { label: t("xpReport.paidOut"), value: `+${formatNumber(view.paid)}`, sub: t("xpReport.riders", { count: view.paidRiders }) },
          { label: t("xpReport.fromRaces"), value: view.racePercent != null ? `${formatNumber(view.racePercent)} %` : t("xpReport.noRace"),
            sub: view.racePercent != null ? <span className="mt-1 block w-24"><XpBar training={(100 - view.racePercent) / 100} race={view.racePercent / 100} label={t("xpReport.shareLabel", { race: formatNumber(view.racePercent) })} /></span> : undefined },
        ]} />
        {view.paid > 0 && <PaidNote className="mt-3" />}
      </Section>
      <div className="grid items-start gap-[14px] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Section className="min-w-0" data-testid="xp-today-list">
          <div className="-mx-1 mb-1 overflow-x-auto px-1 pb-1">
            <Segmented label={t("xpReport.filterLabel")} value={filter} onChange={(v: TodayFilter) => setFilter(v)} className="whitespace-nowrap"
              options={(["all", "gained", "raced", "notRaced"] as TodayFilter[]).map(key => ({ value: key, label: t(`xpReport.filter.${key}`, { count: view.counts[key] }) }))} />
          </div>
          <div className={`grid items-end gap-x-2 py-2 lg:gap-x-2.5 ${ROW_GRID} ${META}`} aria-hidden="true" data-testid="xp-head">
            <span>{t("training:colRider")}</span>
            <span className="hidden lg:block">{t("training:colType")}</span>
            <span className="hidden text-right lg:block">{t("xpReport.legend.training")}</span>
            <span className="hidden text-right lg:block">{t("xpReport.legend.race")}</span>
            <span className="text-right">{t("xpReport.colXpToday")}</span>
            <span className="text-right lg:text-left">{t("xpReport.colEarned")}</span>
            <span className="text-right lg:text-left">{t("xpReport.colPaid")}</span>
            <span className="hidden text-right lg:block">{t("training:dailyReceipt.form")}</span>
            <span className="hidden text-right lg:block">{t("training:dailyReceipt.fatigue")}</span>
            <span className="hidden text-right lg:block">{tRider("header.overall")}</span>
            <span />
          </div>
          {riders.map(rider => {
            const isOpen = open === rider.id;
            const isPicked = selected?.id === rider.id;
            return (
              <div key={rider.id} className="border-t border-cz-border" data-testid="xp-row">
                {/* The row picks the rider (panel) or folds him out (phone); the name is its own link. */}
                <div onClick={() => toggle(rider.id)}
                  className={`grid min-h-11 w-full cursor-pointer items-center gap-x-2 hover:bg-cz-subtle lg:gap-x-2.5 ${ROW_GRID} ${isPicked ? "xl:bg-cz-subtle" : ""}`}>
                  <span className="flex min-w-0 flex-col justify-center">
                    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap" data-testid="xp-name-cell">
                      {rider.nation && <Flag code={rider.nation} className="shrink-0" />}
                      <span className="min-w-0"><RiderNameCell id={rider.id} {...nameParts(rider.name)} name={phone ? shortName(rider.name) : rider.name} stopPropagation className="text-[13px] font-semibold text-cz-1 hover:text-cz-accent-t" /></span>
                    </span>
                  </span>
                  <span className="hidden min-w-0 lg:block"><TypeCell type={rider.type} /></span>
                  <span className={`hidden text-right text-xs text-cz-2 lg:block ${NUM}`}>{rider.training > 0 ? `+${xp(rider.training)}` : "0"}</span>
                  <span className={`hidden text-right text-xs text-cz-2 lg:block ${NUM}`}>{rider.race > 0 ? `+${xp(rider.race)}` : "0"}</span>
                  <span className={`text-right text-xs font-semibold text-cz-1 ${NUM}`} data-testid="xp-row-xp">{rider.xp > 0 ? `+${xp(rider.xp)}` : "0"}</span>
                  <span className="flex min-w-0 justify-end lg:justify-start">
                    <span className="lg:hidden"><PointsCell count={rider.earned} ability={rider.pointAbility} kind="earned" compact /></span>
                    <span className="hidden min-w-0 lg:inline-flex"><PointsCell count={rider.earned} ability={rider.pointAbility} kind="earned" /></span>
                  </span>
                  <span className="flex min-w-0 justify-end lg:justify-start">
                    <span className="lg:hidden"><PointsCell count={rider.paid} ability={rider.paidAbility} kind="paid" compact /></span>
                    <span className="hidden min-w-0 lg:inline-flex"><PointsCell count={rider.paid} ability={rider.paidAbility} kind="paid" /></span>
                  </span>
                  <span className="hidden justify-self-end lg:block"><FormPlate value={rider.form} /></span>
                  <span className="hidden justify-self-end lg:block"><FatigueNow rider={rider} /></span>
                  <span className="hidden justify-self-end lg:block"><RatingCell change={rider.rating} /></span>
                  <button type="button" aria-expanded={isOpen} aria-label={t("xpReport.details", { name: rider.name })}
                    onClick={(e) => { e.stopPropagation(); toggle(rider.id); }}
                    className="inline-flex size-11 items-center justify-center justify-self-end text-cz-3 hover:text-cz-1">
                    <ChevronDownIcon size={14} className={`xl:-rotate-90 ${isOpen ? "max-xl:rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                </div>
                {isOpen && <div className="border-t border-cz-border py-3 xl:hidden"><RiderDetail rider={rider} /></div>}
              </div>
            );
          })}
        </Section>
        {selected && <Section className="hidden min-w-0 xl:sticky xl:top-4 xl:block"><RiderDetail rider={selected} panel /></Section>}
      </div>
    </>
  );
}
