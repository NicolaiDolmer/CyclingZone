import { Fragment, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronDownIcon as ChevronDownJs, ChevronRightIcon as ChevronRightJs, LockIcon as LockJs, SortIcon as SortJs } from "../ui/icons/index.jsx";
import { SkeletonLines as SkeletonLinesJs } from "../ui/Skeleton.jsx";
import PotentialEstimate from "../rider/PotentialEstimate.tsx";
import { fetchPlayerFeatureFlags } from "../../lib/playerFeatureFlags.js";
import { hasXpFields, type XpReceipt, type XpRiderType } from "../../lib/trainingReportXp.ts";
import { riderOverallRating as riderOverallRatingJs } from "../../lib/riderRating.js";
import { copenhagenDayKey as copenhagenDayKeyJs } from "../../lib/raceCentre.js";
import { formatNumber as formatNumberJs } from "../../lib/intl.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.ts";
import { Flag, RiderNameCell } from "./reportXp/ui.ts";
import { XpSpark } from "./reportXp/XpBar.tsx";
import {
  bandText, buildDevelopmentFixture, buildDevelopmentRows, devSummary, nextSort, previewXpDevelopment, sortDevRows, topOf,
  xpDevelopmentMode, DEFAULT_SORT, DEV_FIXTURE_TODAY, XP_DEV_FLAG_KEY,
  type DevRiderInput, type DevRow, type SortKey, type SortState, type TopValue, type XpTodayCell,
} from "./DevelopmentTabXpModel.ts";

// #7947 · The Development tab in XP (direction 5, ejer 19/11): one line per rider with
// XP today and over 30 days as the one development number, the expected top (the
// shared potential estimate from #7686, no new display), points this season and the
// way to the next point; the abilities open as a sub-row. Only behind the XP switch
// (development_xp_model) with XP in the receipts, or on the preview build with ?xp=1.
// Otherwise the tab is exactly today's (the children).

type Icon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" }>;
const ChevronDownIcon = ChevronDownJs as unknown as Icon;
const ChevronRightIcon = ChevronRightJs as unknown as Icon;
const LockIcon = LockJs as unknown as Icon;
const SortIcon = SortJs as unknown as Icon;
const SkeletonLines = SkeletonLinesJs as unknown as ComponentType<{ lines?: number }>;
const riderOverallRating = riderOverallRatingJs as unknown as (rider: unknown) => number | null;
const copenhagenDayKey = copenhagenDayKeyJs as unknown as (ms: number) => string;
const formatNumber = formatNumberJs as unknown as (n: number) => string;

type RosterRider = {
  id: string; firstname?: string | null; lastname?: string | null; nationality_code?: string | null;
  primary_type?: string | null; secondary_type?: string | null; [ability: string]: unknown;
};

type Props = {
  runs: readonly unknown[];
  roster: readonly RosterRider[] | null;
  estimateFor: (riderId: string) => unknown;
  seasonGains: Record<string, Record<string, number> | null | undefined>;
  racingToday: Record<string, unknown> | null | undefined;
  children: ReactNode;
};

export default function DevelopmentXpSwitch({ runs, roster, estimateFor, seasonGains, racingToday, children }: Props) {
  const isPreview = Boolean(import.meta.env.VITE_PREVIEW_MOCK);
  const preview = previewXpDevelopment(isPreview, typeof window === "undefined" ? "" : window.location.search);
  const [flagOn, setFlagOn] = useState(false);
  useEffect(() => {
    if (isPreview) return undefined;
    let alive = true;
    fetchPlayerFeatureFlags().then((flags: Record<string, boolean>) => { if (alive) setFlagOn(flags[XP_DEV_FLAG_KEY] === true); });
    return () => { alive = false; };
  }, [isPreview]);
  const mode = xpDevelopmentMode({ preview, flagOn, hasXp: hasXpFields(runs as never) });
  if (mode === "off") return <>{children}</>;
  return <DevelopmentTabXp fixture={mode === "fixture"} runs={runs} roster={roster} estimateFor={estimateFor} seasonGains={seasonGains} racingToday={racingToday} />;
}

const NUM = "font-data tabular-nums";
const HEAD = "font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";
const LABEL = "mb-1 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3";
const RATING_PLATE = `inline-flex min-w-[2.125rem] items-center justify-center rounded-cz border border-cz-border bg-cz-subtle px-1 py-0.5 text-[13px] font-semibold leading-none text-cz-1 ${NUM}`;
const PHONE_GRID = "grid-cols-[minmax(0,1fr)_2.75rem_3.75rem_5.5rem]";

function DevelopmentTabXp({ fixture, runs, roster, estimateFor, seasonGains, racingToday }: Omit<Props, "children"> & { fixture: boolean }) {
  const { t } = useTranslation("training");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const rows = useMemo((): DevRow[] | null => {
    if (fixture) {
      const fx = buildDevelopmentFixture();
      return buildDevelopmentRows({ runs: fx.runs, riders: fx.riders, todayKey: DEV_FIXTURE_TODAY, seasonGains: fx.seasonGains, forceUnsettled: true });
    }
    if (!roster) return null;
    const riders = roster.map((r): DevRiderInput => ({
      id: r.id,
      name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim() || r.id,
      nation: r.nationality_code ?? null,
      type: r.primary_type ? { primary: r.primary_type, secondary: r.secondary_type ?? null } as XpRiderType : null,
      rating: riderOverallRating(r),
      abilities: r as Record<string, number | null | undefined>,
      top: topOf(estimateFor(r.id)),
      racingToday: racingToday?.[r.id] != null,
    }));
    return buildDevelopmentRows({ runs: runs as XpReceipt[], riders, todayKey: copenhagenDayKey(Date.now()), seasonGains });
  }, [fixture, runs, roster, estimateFor, seasonGains, racingToday]);

  if (!rows) return <div className="rounded-cz border border-cz-border bg-cz-card p-5"><SkeletonLines lines={10} /></div>;
  const sorted = sortDevRows(rows, sort);
  const summary = devSummary(rows);
  const toggle = (id: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const onSort = (key: SortKey) => setSort((prev) => nextSort(prev, key));

  return (
    <div data-testid="training-development-xp" data-source={fixture ? "fixture" : "live"}>
      <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        <TitleLine summary={summary} />
        {desktop
          ? <DesktopTable rows={sorted} open={open} toggle={toggle} sort={sort} onSort={onSort} />
          : <PhoneList rows={sorted} open={open} toggle={toggle} />}
      </div>
      <p className="mt-3 text-2xs text-cz-3">
        {t("developmentXp.footnote")}{" "}
        <Link to="/help?section=dailytraining" className="font-medium text-cz-accent-t hover:underline">{t("developmentXp.howItWorks")}</Link>
      </p>
      {fixture && <p className="mt-1 text-2xs text-cz-3" data-testid="training-development-xp-fixture-note">{t("developmentXp.fixtureNote")}</p>}
    </div>
  );
}

/** P21: the table's one title line inside its frame, the squad in numbers. */
function TitleLine({ summary }: { summary: ReturnType<typeof devSummary> }) {
  const { t } = useTranslation("training");
  const strong = `font-semibold text-cz-1 ${NUM}`;
  const dot = <span className="px-1 text-cz-3 max-sm:hidden" aria-hidden="true">·</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-cz-border px-3 py-2.5 text-xs text-cz-2 max-sm:gap-x-3" data-testid="development-xp-summary">
      <span className="me-1 font-semibold text-cz-1">{t("developmentXp.riders", { count: summary.riders })}</span>
      {dot}
      <span>{t("developmentXp.xpToday")} <span className={strong}>{formatNumber(summary.xpToday)}</span>
        {summary.unsettled > 0 && <span className="text-cz-3"> {t("developmentXp.unsettled", { count: summary.unsettled })}</span>}</span>
      {dot}
      <span>{t("developmentXp.xp30")} <span className={strong}>{formatNumber(summary.xp30)}</span></span>
      {dot}
      <span><span className={strong}>{summary.seasonPoints != null ? formatNumber(summary.seasonPoints) : "—"}</span> {t("developmentXp.seasonPoints")}</span>
      {dot}
      <span><span className={strong}>{formatNumber(summary.close)}</span> {t("developmentXp.close")}</span>
    </div>
  );
}

function SortHead({ k, label, className = "", sort, onSort }: { k: SortKey; label: string; className?: string; sort: SortState; onSort: (k: SortKey) => void }) {
  const active = sort.key === k;
  return (
    <th className={`px-3 py-2 text-start ${HEAD} ${className}`} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 whitespace-nowrap uppercase hover:text-cz-1 ${active ? "text-cz-1" : ""}`}>
        {label}<SortIcon size={11} aria-hidden="true" />
      </button>
    </th>
  );
}

function Name({ row, wrap = false }: { row: DevRow; wrap?: boolean }) {
  return (
    <span className={`flex min-w-0 gap-1.5 ${wrap ? "items-start" : "items-center"}`} data-testid="development-xp-name">
      {row.nation && <Flag code={row.nation} className={`shrink-0 ${wrap ? "mt-0.5" : ""}`} />}
      <span className="min-w-0"><RiderNameCell id={row.id} name={row.name} wrap className="text-[13px] font-medium text-cz-1 hover:text-cz-accent-t" /></span>
    </span>
  );
}

function TypeText({ type }: { type: XpRiderType | null }) {
  const { t } = useTranslation("riderTypes");
  if (!type?.primary) return <span className="text-cz-3">—</span>;
  const full = type.secondary && type.secondary !== type.primary ? `${t(`types.${type.primary}`)}/${t(`types.${type.secondary}`)}` : t(`types.${type.primary}`);
  return <span className="block truncate text-[13px] text-cz-2" title={full}>{t(`types.${type.primary}`)}</span>;
}

function Rating({ value }: { value: number | null }) {
  return value != null ? <span className={RATING_PLATE}>{value}</span> : <span className="text-cz-3">—</span>;
}

/** Expected top: the shared component, or today's band (one number when it has no width). */
function Top({ top }: { top: TopValue }) {
  if (top.kind === "view") return <PotentialEstimate view={top.view} />;
  if (top.kind === "band") return <span className={`text-[13px] text-cz-1 ${NUM}`}>{bandText(top)}</span>;
  return <span className="text-cz-3">—</span>;
}

function Season({ value, unit = false }: { value: number | null; unit?: boolean }) {
  const { t } = useTranslation("training");
  if (value == null) return <span className="text-cz-3">—</span>;
  const text = value > 0 ? `+${formatNumber(value)}` : "0";
  return <span className={`text-[13px] text-cz-1 ${NUM}`}>{unit ? t("developmentXp.seasonValue", { value: text }) : text}</span>;
}

function XpToday({ cell }: { cell: XpTodayCell }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  if (cell.state === "locked") {
    return <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-cz-3" data-testid="development-xp-locked"><LockIcon size={11} aria-hidden="true" />{t("developmentXp.afterStage")}</span>;
  }
  if (cell.state === "none") return <span className="text-cz-3" title={t("developmentXp.notYet")}>—</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={`text-[13px] font-semibold text-cz-1 ${NUM}`}>{formatNumber(cell.xp)}</span>
      {cell.point && <span className="truncate text-2xs text-cz-2">{t("developmentXp.pointToday", { ability: tRider(`racePreview.derived.${cell.point}`) })}</span>}
    </span>
  );
}

/** The way to the next point as a share of the bar (no price shown). */
function PctBar({ pct }: { pct: number }) {
  const { t } = useTranslation("training");
  return (
    <span className="inline-flex items-center gap-1.5" role="img" aria-label={t("developmentXp.pctLabel", { pct })}>
      <span className="relative block h-1.5 w-14 overflow-hidden rounded-cz bg-cz-border" aria-hidden="true">
        <span className="absolute inset-y-0 start-0 bg-cz-1" style={{ width: `${pct}%` }} />
      </span>
      <span className={`text-2xs text-cz-2 ${NUM}`} aria-hidden="true">{pct} %</span>
    </span>
  );
}

function Spark({ row }: { row: DevRow }) {
  const { t } = useTranslation("training");
  return (
    <span className="block w-[120px]" role="img" aria-label={t("developmentXp.sparkLabel", { name: row.name })}>
      <XpSpark values={row.spark} />
    </span>
  );
}

function Abilities({ row, phone }: { row: DevRow; phone: boolean }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const grid = phone ? "grid-cols-[minmax(0,1fr)_2rem_3rem_6.5rem]" : "grid-cols-[180px_60px_80px_160px]";
  if (row.abilities.length === 0) return <p className="text-xs text-cz-3">{t("developmentXp.noAbilities")}</p>;
  return (
    <div data-testid="development-xp-abilities">
      <div className={`grid items-center gap-x-3 border-b border-cz-border pb-1 ${grid} ${LABEL} mb-0`}>
        <span>{t("developmentXp.ability")}</span><span className="text-end">{t("developmentXp.now")}</span>
        <span className="text-end">{t("developmentXp.colSeason")}</span><span>{t("developmentXp.colNext")}</span>
      </div>
      <ul>
        {row.abilities.map((a) => (
          <li key={a.key} className={`grid items-center gap-x-3 border-b border-cz-border py-1.5 text-xs last:border-b-0 ${grid}`}>
            <span className="truncate text-cz-1">{tRider(`racePreview.derived.${a.key}`)}</span>
            <span className={`text-end text-cz-1 ${NUM}`}>{a.now ?? "—"}</span>
            <span className={`text-end text-cz-2 ${NUM}`}>{a.season == null ? "—" : a.season > 0 ? `+${a.season}` : "0"}</span>
            {a.pct != null ? <PctBar pct={a.pct} /> : <span className="text-cz-3">—</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DesktopTable({ rows, open, toggle, sort, onSort }: { rows: DevRow[]; open: Set<string>; toggle: (id: string) => void; sort: SortState; onSort: (k: SortKey) => void }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  return (
    <table className="w-full table-fixed text-xs" data-testid="development-xp-table">
      <thead>
        <tr className="border-b border-cz-border">
          <th className="w-[44px]"><span className="sr-only">{t("developmentXp.abilitiesCol")}</span></th>
          <SortHead k="rider" label={t("colRider")} className="w-[220px]" sort={sort} onSort={onSort} />
          <SortHead k="type" label={t("colType")} className="w-[130px]" sort={sort} onSort={onSort} />
          <SortHead k="rating" label={t("developmentXp.colRating")} className="w-[86px]" sort={sort} onSort={onSort} />
          <SortHead k="top" label={t("developmentXp.colTop")} className="w-[150px]" sort={sort} onSort={onSort} />
          <SortHead k="season" label={t("developmentXp.colSeason")} className="w-[86px]" sort={sort} onSort={onSort} />
          <SortHead k="xpToday" label={t("developmentXp.colXpToday")} className="w-[150px]" sort={sort} onSort={onSort} />
          <SortHead k="xp30" label={t("developmentXp.colXp30")} className="w-[200px]" sort={sort} onSort={onSort} />
          <SortHead k="next" label={t("developmentXp.colNext")} sort={sort} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const o = open.has(row.id);
          return (
            <Fragment key={row.id}>
              <tr className={`border-t border-cz-border first:border-t-0 ${o ? "bg-cz-subtle/40" : ""}`} data-testid="development-xp-row">
                <td className="ps-3">
                  <button type="button" onClick={() => toggle(row.id)} aria-expanded={o} aria-label={t("developmentXp.openAbilities", { name: row.name })}
                    className="flex h-7 w-7 items-center justify-center rounded-cz text-cz-2 hover:bg-cz-subtle hover:text-cz-1">
                    {o ? <ChevronDownIcon size={14} aria-hidden="true" /> : <ChevronRightIcon size={14} aria-hidden="true" />}
                  </button>
                </td>
                <td className="px-3 py-[7px]"><Name row={row} wrap /></td>
                <td className="px-3 py-[7px]"><TypeText type={row.type} /></td>
                <td className="px-3 py-[7px]"><Rating value={row.rating} /></td>
                <td className="px-3 py-[7px]"><Top top={row.top} /></td>
                <td className="px-3 py-[7px]"><Season value={row.season} /></td>
                <td className="px-3 py-[7px]"><XpToday cell={row.today} /></td>
                <td className="px-3 py-[7px]">
                  <span className="inline-flex items-center gap-2">
                    <span className={`w-14 text-[13px] font-semibold text-cz-1 ${NUM}`}>{formatNumber(row.xp30)}</span>
                    <Spark row={row} />
                  </span>
                </td>
                <td className="px-3 py-[7px]">
                  {row.next ? (
                    <span className="inline-flex min-w-0 items-center gap-3">
                      <span className="w-[92px] truncate text-[13px] text-cz-1">{tRider(`racePreview.derived.${row.next.key}`)}</span>
                      <PctBar pct={row.next.pct} />
                    </span>
                  ) : <span className="text-cz-3">—</span>}
                </td>
              </tr>
              {o && (
                <tr className="bg-cz-subtle/40">
                  <td />
                  <td colSpan={8} className="px-3 pb-3 pt-1"><div className="max-w-[560px]"><Abilities row={row} phone={false} /></div></td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function PhoneList({ rows, open, toggle }: { rows: DevRow[]; open: Set<string>; toggle: (id: string) => void }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  return (
    <div data-testid="development-xp-list">
      <div className={`grid gap-2 border-b border-cz-border px-3 py-2 ${PHONE_GRID} ${HEAD} text-3xs`}>
        <span>{t("colRider")}</span><span>{t("developmentXp.colRating")}</span><span>{t("developmentXp.colXp30Short")}</span><span>{t("developmentXp.colNext")}</span>
      </div>
      <ul>
        {rows.map((row) => {
          const o = open.has(row.id);
          return (
            <li key={row.id} className="border-t border-cz-border first:border-t-0" data-testid="development-xp-row">
              <div className={`grid min-h-11 w-full items-center gap-2 px-3 py-2 ${PHONE_GRID} ${o ? "bg-cz-subtle/60" : ""}`}>
                <Name row={row} wrap />
                <span><Rating value={row.rating} /></span>
                <span className={`text-[13px] font-semibold text-cz-1 ${NUM}`}>{formatNumber(row.xp30)}</span>
                <button type="button" onClick={() => toggle(row.id)} aria-expanded={o} aria-label={t("developmentXp.openAbilities", { name: row.name })}
                  className="flex min-h-11 items-start justify-between gap-1 text-start text-xs">
                  {row.next
                    ? <span className="min-w-0 leading-tight text-cz-1"><span className="block truncate">{tRider(`racePreview.derived.${row.next.key}`)}</span><span className={`block text-3xs text-cz-2 ${NUM}`}>{row.next.pct} %</span></span>
                    : <span className="text-cz-3">—</span>}
                  {o ? <ChevronDownIcon size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" /> : <ChevronRightIcon size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" />}
                </button>
              </div>
              {o && (
                <div className="flex flex-col gap-3 border-t border-cz-border bg-cz-subtle/60 px-3 pb-4 pt-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><div className={LABEL}>{t("colType")}</div><TypeText type={row.type} /></div>
                    <div><div className={LABEL}>{t("developmentXp.colTop")}</div><Top top={row.top} /></div>
                    <div><div className={LABEL}>{t("developmentXp.colXpToday")}</div><XpToday cell={row.today} /></div>
                    <div><div className={LABEL}>{t("developmentXp.colSeason")}</div><Season value={row.season} unit /></div>
                  </div>
                  <div>
                    <div className={LABEL}>{t("developmentXp.sparkTitle")}</div>
                    <Spark row={row} />
                  </div>
                  <Abilities row={row} phone />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
