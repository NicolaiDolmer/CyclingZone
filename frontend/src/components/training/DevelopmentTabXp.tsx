import { Fragment, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronDownIcon as ChevronDownJs, ChevronRightIcon as ChevronRightJs, LockIcon as LockJs, SortIcon as SortJs } from "../ui/icons/index.jsx";
import { SkeletonLines as SkeletonLinesJs } from "../ui/Skeleton.jsx";
import BestRoleTagJs from "../rider/BestRoleTag.jsx";
import RiderTypeBadgeJs from "../rider/RiderTypeBadge.jsx";
import TableTitleBar from "../ui/TableTitleBar.tsx";
import PotentialEstimate from "../rider/PotentialEstimate.tsx";
import AcademyPrognosisCell, { type AcademyPrognosis } from "../rider/AcademyPrognosisCell.tsx";
import { fetchPlayerFeatureFlags } from "../../lib/playerFeatureFlags.js";
import { hasXpFields, type XpReceipt, type XpRiderType } from "../../lib/trainingReportXp.ts";
import { riderBestRole as riderBestRoleJs } from "../../lib/riderRating.js";
import { copenhagenDayKey as copenhagenDayKeyJs } from "../../lib/raceCentre.js";
import { formatDate as formatDateJs, formatNumber as formatNumberJs } from "../../lib/intl.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.ts";
import { riderShortName } from "../../lib/riderName.ts";
import { Flag, RiderNameCell } from "./reportXp/ui.ts";
import { XpBar } from "./reportXp/XpBar.tsx";
import {
  bandText, buildDevelopmentFixture, buildDevelopmentRows, devSummary, nextSort, previewXpDevelopment, signedText, sortDevRows, topOf,
  xpDevelopmentMode, DEFAULT_SORT, DEV_FIXTURE_TODAY, XP_DEV_FLAG_KEY,
  DEV_COLUMNS, DEV_COLUMNS_STORAGE_KEY, defaultDevColumns, parseDevColumns, serializeDevColumns, sortAfterColumns, toggleDevColumn,
  type DevColumnKey, type DevRiderInput, type DevRow, type DayXpWhen, type XpLineView, type SortKey, type SortState, type TopValue, type XpTodayCell,
} from "./DevelopmentTabXpModel.ts";

// #7947 · The Development tab in XP (direction 5, ejer 19/11): one line per rider with
// XP today and over 30 days as the one development number, the expected top (the
// shared potential estimate from #7686, no new display), the rating's change this season and the
// way to the next point; the abilities open as a sub-row. Only behind the XP switch
// (development_xp_model) with XP in the receipts, or on the preview build with ?xp=1.
// Otherwise the tab is exactly today's (the children).

type Icon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" }>;
const ChevronDownIcon = ChevronDownJs as unknown as Icon;
const ChevronRightIcon = ChevronRightJs as unknown as Icon;
const LockIcon = LockJs as unknown as Icon;
const SortIcon = SortJs as unknown as Icon;
const SkeletonLines = SkeletonLinesJs as unknown as ComponentType<{ lines?: number }>;
// Ejer 20/11: typen vises i begge former, hver i sin kolonne, og manageren vaelger selv via
// kolonne-knappen. "Naturlig type" er det guldfarvede RiderTypeBadge (som i spillets andre
// tabeller, "Natural role" i tooltip og aria); "Rolle nu" er det neutrale BestRoleTag (rollen
// han har hoejest rating i nu, samme rolle som ratingen ved siden af).
const BestRoleTag = BestRoleTagJs as unknown as ComponentType<{ role: string; variant?: "short" | "full" }>;
const RiderTypeBadge = RiderTypeBadgeJs as unknown as ComponentType<{ primaryType: string | null; secondaryType?: string | null; stacked?: boolean }>;
const riderBestRole = riderBestRoleJs as unknown as (rider: unknown) => { rating: number | null; role: string | null };
const copenhagenDayKey = copenhagenDayKeyJs as unknown as (ms: number) => string;
const formatNumber = formatNumberJs as unknown as (n: number) => string;
const formatDate = formatDateJs as unknown as (value: string, style: string | null, options?: Intl.DateTimeFormatOptions) => string;

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
  /** Alder i sæsonen pr. rytter (samme som den gamle Udvikling-fane, ageForSeason). */
  ageFor?: (riderId: string) => number | null;
  children: ReactNode;
};

export default function DevelopmentXpSwitch({ runs, roster, estimateFor, seasonGains, racingToday, ageFor, children }: Props) {
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
  return <DevelopmentTabXp fixture={mode === "fixture"} runs={runs} roster={roster} estimateFor={estimateFor} seasonGains={seasonGains} racingToday={racingToday} ageFor={ageFor} />;
}

const NUM = "font-data tabular-nums";
// Ejer 19/11: summen over 30 dage er uoverskuelig; kolonnen viser gennemsnittet pr. dag (hele tal).
// Rækken og linjen over tabellen deler samme nævner: dagene med kvittering (højst 30).
const xpAvgPerDay = (row: { xp30: number; spark: readonly number[] }) => Math.round(row.xp30 / Math.max(1, row.spark.length));
const HEAD = "font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";
const LABEL = "mb-1 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3";
const RATING_PLATE = `inline-flex min-w-[2.125rem] items-center justify-center rounded-cz border border-cz-border bg-cz-subtle px-1 py-0.5 text-[13px] font-semibold leading-none text-cz-1 ${NUM}`;
const PHONE_GRID = "grid-cols-[minmax(0,1fr)_2.75rem_3.75rem_5.5rem]";

function DevelopmentTabXp({ fixture, runs, roster, estimateFor, seasonGains, racingToday, ageFor }: Omit<Props, "children"> & { fixture: boolean }) {
  const { t } = useTranslation("training");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [columns, setColumns] = useState<Set<DevColumnKey>>(readStoredColumns);

  const rows = useMemo((): DevRow[] | null => {
    if (fixture) {
      const fx = buildDevelopmentFixture();
      return buildDevelopmentRows({ runs: fx.runs, riders: fx.riders, todayKey: DEV_FIXTURE_TODAY, seasonGains: fx.seasonGains, forceUnsettled: true });
    }
    if (!roster) return null;
    const riders = roster.map((r): DevRiderInput => {
      const estimate = estimateFor(r.id);
      // Role now: the role he rates highest in now, the same role as the rating beside it. Not the
      // estimate's role (highest potential), and never the natural role as a stand-in.
      const best = riderBestRole(r);
      return {
        id: r.id,
        name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim() || r.id,
        firstname: r.firstname ?? null, lastname: r.lastname ?? null,
        nation: r.nationality_code ?? null,
        natural: r.primary_type ? { primary: r.primary_type, secondary: r.secondary_type ?? null } as XpRiderType : null,
        bestRole: best.role,
        rating: best.rating,
        age: ageFor?.(r.id) ?? null,
        abilities: r as Record<string, number | null | undefined>,
        top: topOf(estimate),
        racingToday: racingToday?.[r.id] != null,
      };
    });
    return buildDevelopmentRows({ runs: runs as XpReceipt[], riders, todayKey: copenhagenDayKey(Date.now()), seasonGains });
  }, [fixture, runs, roster, estimateFor, seasonGains, racingToday, ageFor]);

  if (!rows) return <div className="rounded-cz border border-cz-border bg-cz-card p-5"><SkeletonLines lines={10} /></div>;
  const sorted = sortDevRows(rows, sort);
  const summary = devSummary(rows);
  const toggle = (id: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const onSort = (key: SortKey) => setSort((prev) => nextSort(prev, key));
  const onToggleColumn = (key: string) => {
    const next = toggleDevColumn(columns, key as DevColumnKey);
    setColumns(next);
    setSort((prev) => sortAfterColumns(prev, next));
    writeStoredColumns(next);
  };
  const columnLabel: Record<DevColumnKey, string> = { natural: t("developmentXp.colNatural"), role: t("developmentXp.colRoleNow"), rating30: t("developmentXp.colRating30") };
  const columnsControl = {
    hint: t("developmentXp.columnsHint"),
    count: columns.size,
    total: DEV_COLUMNS.length,
    items: DEV_COLUMNS.map(({ key }) => ({ key, label: columnLabel[key], checked: columns.has(key) })),
    onToggle: onToggleColumn,
  };

  return (
    <div data-testid="training-development-xp" data-source={fixture ? "fixture" : "live"}>
      <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        {/* P21: one title line. The squad in numbers on the left, the table's own column button
            (TableTitleBar, #8280) on the right; both carry the line's hairline, so it runs unbroken. */}
        <div className="flex items-stretch">
          <TitleLine summary={summary} />
          <TableTitleBar page="training-development" columns={columnsControl} className="flex-none" />
        </div>
        {desktop
          // Below the content width the table needs, it scrolls sideways instead of clipping columns.
          ? <div className="overflow-x-auto"><DesktopTable rows={sorted} open={open} toggle={toggle} sort={sort} onSort={onSort} columns={columns} /></div>
          : <PhoneList rows={sorted} open={open} toggle={toggle} columns={columns} />}
      </div>
      <p className="mt-3 text-2xs text-cz-3">
        {t("developmentXp.footnote")}{" "}
        <Link to="/help?section=dailytraining" className="font-medium text-cz-accent-t hover:underline">{t("developmentXp.howItWorks")}</Link>
      </p>
      {fixture && <p className="mt-1 text-2xs text-cz-3" data-testid="training-development-xp-fixture-note">{t("developmentXp.fixtureNote")}</p>}
    </div>
  );
}

/** The column choice is remembered in this browser, like the other tables' columns (useStatsToggle). */
function readStoredColumns(): Set<DevColumnKey> {
  if (typeof window === "undefined") return defaultDevColumns();
  try {
    return parseDevColumns(window.localStorage.getItem(DEV_COLUMNS_STORAGE_KEY));
  } catch {
    // localStorage can be blocked (private mode): the default columns, nothing remembered.
    return defaultDevColumns();
  }
}

function writeStoredColumns(visible: ReadonlySet<DevColumnKey>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEV_COLUMNS_STORAGE_KEY, serializeDevColumns(visible));
  } catch {
    // localStorage can be blocked (private mode): the choice holds until the page is left.
  }
}

/** P21: the left part of the table's one title line inside its frame, the squad in numbers. */
function TitleLine({ summary }: { summary: ReturnType<typeof devSummary> }) {
  const { t } = useTranslation("training");
  const strong = `font-semibold text-cz-1 ${NUM}`;
  const dot = <span className="px-1 text-cz-3 max-sm:hidden" aria-hidden="true">·</span>;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1 border-b border-cz-border px-3 py-2.5 text-xs text-cz-2 max-sm:gap-x-3" data-testid="development-xp-summary">
      <span className="me-1 font-semibold text-cz-1">{t("developmentXp.riders", { count: summary.riders })}</span>
      {dot}
      <span>{t("developmentXp.xpToday")} <span className={strong}>{formatNumber(summary.xpToday)}</span>
        {summary.unsettled > 0 && <span className="text-cz-3"> {t("developmentXp.unsettled", { count: summary.unsettled })}</span>}</span>
      {dot}
      <span>{t("developmentXp.xp30")} <span className={strong}>{formatNumber(Math.round(summary.xp30 / Math.max(1, summary.days) / Math.max(1, summary.riders)))}</span></span>
      {dot}
      <span><span className={strong}>{summary.seasonPoints != null ? formatNumber(summary.seasonPoints) : "—"}</span> {t("developmentXp.seasonPoints")}</span>
      {dot}
      <span><span className={strong}>{formatNumber(summary.close)}</span> {t("developmentXp.close")}</span>
    </div>
  );
}

/** `wrap`: a two-word label may break onto a second line instead of widening a narrow number column. */
function SortHead({ k, label, title, wrap = false, className = "", sort, onSort }: { k: SortKey; label: string; title?: string; wrap?: boolean; className?: string; sort: SortState; onSort: (k: SortKey) => void }) {
  const active = sort.key === k;
  return (
    <th className={`px-3 py-2 text-start ${HEAD} ${className}`} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => onSort(k)} title={title} className={`inline-flex items-center gap-1 text-start uppercase hover:text-cz-1 ${wrap ? "" : "whitespace-nowrap"} ${active ? "text-cz-1" : ""}`}>
        {label}<SortIcon size={11} aria-hidden="true" />
      </button>
    </th>
  );
}

/** Flag + the canonical name cell; only the name, never broken inside a word. The phone shows the short form (#5383). */
function Name({ row, short = false }: { row: DevRow; short?: boolean }) {
  const [first = "", ...rest] = row.name.trim().split(/\s+/);
  const parts = { firstname: row.firstname ?? first, lastname: row.lastname ?? rest.join(" ") };
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-testid="development-xp-name">
      {row.nation && <Flag code={row.nation} className="shrink-0" />}
      <span className="min-w-0"><RiderNameCell id={row.id} {...parts} name={short ? riderShortName(parts) : row.name} wrap className="text-[13px] font-medium text-cz-1 hover:text-cz-accent-t" /></span>
    </span>
  );
}

/** Natural type: the gold badge, primary and secondary stacked, as in the squad table. */
function NaturalType({ natural }: { natural: XpRiderType | null }) {
  if (!natural?.primary) return <span className="text-cz-3">—</span>;
  return <span data-testid="development-xp-natural"><RiderTypeBadge primaryType={natural.primary} secondaryType={natural.secondary} stacked /></span>;
}

/** Role now: the grey tag, the role he rates highest in now. */
function RoleNow({ role }: { role: string | null }) {
  if (!role) return <span className="text-cz-3">—</span>;
  return <span data-testid="development-xp-role-now"><BestRoleTag role={role} variant="short" /></span>;
}

function Rating({ value }: { value: number | null }) {
  return value != null ? <span className={RATING_PLATE}>{value}</span> : <span className="text-cz-3">—</span>;
}

/** Expected top: the shared component, or today's band (one number when it has no width). */
function Top({ top }: { top: TopValue }) {
  if (top.kind === "view") return <PotentialEstimate view={top.view} />;
  if (top.kind === "band") return <span className={`text-[13px] text-cz-1 ${NUM}`}>{bandText(top)}</span>;
  if (top.kind === "academy") return <AcademyPrognosisCell prognosis={top.prognosis as AcademyPrognosis} />;
  return <span className="text-cz-3">—</span>;
}

/** Ejer 19/11 aften: the rating's change this season ('+3'), not the ability points. */
function RatingSeason({ value, testId = "development-xp-rating-season" }: { value: number | null; testId?: string }) {
  if (value == null) return <span className="text-cz-3" data-testid={testId}>—</span>;
  return <span className={`text-[13px] text-cz-1 ${NUM}`} data-testid={testId}>{signedText(value)}</span>;
}

function XpToday({ cell }: { cell: XpTodayCell }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  if (cell.state === "locked") {
    return <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-cz-3" data-testid="development-xp-locked"><LockIcon size={11} aria-hidden="true" />{t("developmentXp.afterStage")}</span>;
  }
  if (cell.state === "none") return <span className="text-cz-3" title={t("developmentXp.notYet")}>—</span>;
  return (
    <span className="inline-flex max-w-[150px] flex-wrap items-baseline gap-x-1.5">
      <span className={`text-[13px] font-semibold text-cz-1 ${NUM}`}>{formatNumber(cell.xp)}</span>
      {cell.soFar && <span className="text-2xs text-cz-3" data-testid="development-xp-so-far">{t("developmentXp.soFar")}</span>}
      {cell.point && <span className="truncate text-2xs text-cz-2">{t("developmentXp.pointToday", { ability: tRider(`racePreview.derived.${cell.point}`) })}</span>}
    </span>
  );
}

/** Ejer 19/11: the way to the next point in XP ("312 / 540 XP"), not a percent. */
function XpOf({ xp, price, size = "text-2xs", className = "" }: { xp: number; price: number; size?: string; className?: string }) {
  const { t } = useTranslation("training");
  return (
    <span className={`whitespace-nowrap ${size} text-cz-2 ${NUM} ${className}`} title={t("developmentXp.xpTitle", { xp: formatNumber(xp), price: formatNumber(price) })} data-testid="development-xp-of">
      {t("developmentXp.xpLine", { xp: formatNumber(xp), price: formatNumber(price) })}
    </span>
  );
}

/** The day's XP on one ability, worded like the Training tab: "today +54 XP", "yesterday +54 XP" or a date. */
function DayXp({ xp, when }: { xp: number | null; when: DayXpWhen | null }) {
  const { t } = useTranslation("training");
  if (xp == null || !when) return null;
  const vars = { xp: formatNumber(xp), date: when.kind === "dated" ? formatDate(when.date, null, { day: "numeric", month: "numeric" }) : "" };
  const key = when.kind === "today" ? "developmentXp.dayXpToday" : when.kind === "yesterday" ? "developmentXp.dayXpYesterday" : "developmentXp.dayXpDated";
  return <span className={`whitespace-nowrap text-2xs text-cz-2 ${NUM}`} data-testid="development-xp-day">{t(key, vars)}</span>;
}

/** One ability's way to the next point: the neutral XP bar and "x / y XP". */
function XpLineCell({ line }: { line: XpLineView }) {
  const { t } = useTranslation("training");
  return (
    <span className="flex items-center gap-1.5" data-testid="development-xp-line">
      <span className="block min-w-[16px] flex-1"><XpBar training={line.pct / 100} race={0} height={4} label={t("developmentXp.xpTitle", { xp: formatNumber(line.xp), price: formatNumber(line.price) })} /></span>
      <XpOf xp={line.xp} price={line.price} className="flex-none" />
    </span>
  );
}

/**
 * Ejer 20/11: the opened row reads like the rider's Training tab (#8488): now, season,
 * "x / y XP" on the game's neutral XP bar (never gold, TASTE P3) and the day's "+N XP".
 * No bar for an ability = an empty cell, never a dash (TASTE P13).
 */
function Abilities({ row, phone }: { row: DevRow; phone: boolean }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const grid = phone ? "grid-cols-[minmax(0,1fr)_2rem_2.5rem_7.5rem]" : "grid-cols-[180px_60px_80px_180px_112px]";
  if (row.abilities.length === 0) return <p className="text-xs text-cz-3">{t("developmentXp.noAbilities")}</p>;
  return (
    <div data-testid="development-xp-abilities">
      <div className={`grid items-center gap-x-3 border-b border-cz-border pb-1 ${grid} ${LABEL} mb-0`}>
        <span>{t("developmentXp.ability")}</span><span className="text-end">{t("developmentXp.now")}</span>
        <span className="text-end">{t("developmentXp.colSeason")}</span><span>{t("developmentXp.colNext")}</span>
        {!phone && <span>{t("developmentXp.colLatest")}</span>}
      </div>
      <ul>
        {row.abilities.map((a) => (
          <li key={a.key} className={`grid items-center gap-x-3 border-b border-cz-border py-1.5 text-xs last:border-b-0 ${grid}`}>
            <span className="truncate text-cz-1">{tRider(`racePreview.derived.${a.key}`)}</span>
            <span className={`text-end text-cz-1 ${NUM}`}>{a.now ?? "—"}</span>
            <span className={`text-end text-cz-2 ${NUM}`}>{a.season == null ? "—" : a.season > 0 ? `+${a.season}` : "0"}</span>
            {phone ? (
              <span className="flex min-w-0 flex-col gap-0.5">
                {a.line && <XpLineCell line={a.line} />}
                <DayXp xp={a.dayXp} when={row.dayXpWhen} />
              </span>
            ) : (
              <>
                {a.line ? <XpLineCell line={a.line} /> : <span aria-hidden="true" />}
                <span><DayXp xp={a.dayXp} when={row.dayXpWhen} /></span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// The optional columns: the stacked gold badge (124 px) holds the longest two-line natural type, the
// grey tag (84 px) the short role name, "Rating, 30 d" (84 px) a signed number; the headers may wrap.
// With the default (natural only) the table fits the content width at 1440 without scrolling; the
// minimum width grows with the columns shown. Ejer 20/11: XP/day is one number now (no sparkline),
// so its column is narrow and "Natural type" plus "Rating, 30 d" still fit at 1440.
const BASE_MIN_WIDTH = 948;
const OPTIONAL_WIDTH: Record<DevColumnKey, number> = { natural: 124, role: 84, rating30: 84 };
const BASE_COLS = 9;

function DesktopTable({ rows, open, toggle, sort, onSort, columns }: { rows: DevRow[]; open: Set<string>; toggle: (id: string) => void; sort: SortState; onSort: (k: SortKey) => void; columns: ReadonlySet<DevColumnKey> }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const { t: tRiders } = useTranslation("riders");
  const showNatural = columns.has("natural");
  const showRole = columns.has("role");
  const show30 = columns.has("rating30");
  const minWidth = BASE_MIN_WIDTH + [...columns].reduce((sum, key) => sum + OPTIONAL_WIDTH[key], 0);
  const colCount = BASE_COLS + columns.size;
  return (
    <table className="w-full table-fixed text-xs" style={{ minWidth }} data-sortable data-testid="development-xp-table">
      <thead>
        <tr className="border-b border-cz-border">
          <th className="w-[44px]"><span className="sr-only">{t("developmentXp.abilitiesCol")}</span></th>
          <SortHead k="rider" label={t("colRider")} className="w-[168px]" sort={sort} onSort={onSort} />
          {showNatural && <SortHead k="natural" label={t("developmentXp.colNatural")} wrap className="w-[124px]" sort={sort} onSort={onSort} />}
          {showRole && <SortHead k="role" label={t("developmentXp.colRoleNow")} wrap className="w-[84px]" sort={sort} onSort={onSort} />}
          <SortHead k="age" label={tRiders("table.age")} className="w-[52px]" sort={sort} onSort={onSort} />
          <SortHead k="rating" label={t("developmentXp.colRating")} className="w-[70px]" sort={sort} onSort={onSort} />
          <SortHead k="top" label={t("developmentXp.colTop")} className="w-[118px]" sort={sort} onSort={onSort} />
          <SortHead k="season" label={t("developmentXp.colRatingSeason")} title={t("developmentXp.ratingSeasonTitle")} wrap className="w-[84px]" sort={sort} onSort={onSort} />
          {show30 && <SortHead k="rating30" label={t("developmentXp.colRating30")} title={t("developmentXp.rating30Title")} wrap className="w-[84px]" sort={sort} onSort={onSort} />}
          <SortHead k="xpToday" label={t("developmentXp.colXpToday")} className="w-[116px]" sort={sort} onSort={onSort} />
          <SortHead k="xp30" label={t("developmentXp.colXp30")} wrap className="w-[96px]" sort={sort} onSort={onSort} />
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
                <td className="px-3 py-[7px]"><Name row={row} /></td>
                {showNatural && <td className="px-3 py-[7px]"><NaturalType natural={row.natural} /></td>}
                {showRole && <td className="px-3 py-[7px]"><RoleNow role={row.bestRole} /></td>}
                <td className={`px-3 py-[7px] text-[13px] text-cz-1 ${NUM}`}>{row.age ?? "—"}</td>
                <td className="px-3 py-[7px]"><Rating value={row.rating} /></td>
                <td className="px-3 py-[7px]"><Top top={row.top} /></td>
                <td className="px-3 py-[7px]"><RatingSeason value={row.ratingSeason} /></td>
                {show30 && <td className="px-3 py-[7px]"><RatingSeason value={row.rating30} testId="development-xp-rating-30" /></td>}
                <td className="px-3 py-[7px]"><XpToday cell={row.today} /></td>
                <td className="px-3 py-[7px]">
                  <span className={`text-[13px] font-semibold text-cz-1 ${NUM}`} data-testid="development-xp-avg">{formatNumber(xpAvgPerDay(row))}</span>
                </td>
                <td className="px-3 py-[7px]">
                  {row.next ? (
                    <span className="inline-flex min-w-0 items-baseline gap-2" data-testid="development-xp-next">
                      <span className="w-[84px] truncate text-[13px] text-cz-1">{tRider(`racePreview.derived.${row.next.key}`)}</span>
                      <XpOf xp={row.next.xp} price={row.next.price} />
                    </span>
                  ) : <span className="text-cz-3">—</span>}
                </td>
              </tr>
              {o && (
                <tr className="bg-cz-subtle/40">
                  <td />
                  <td colSpan={colCount - 1} className="px-3 pb-3 pt-1"><div className="max-w-[680px]"><Abilities row={row} phone={false} /></div></td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function PhoneList({ rows, open, toggle, columns }: { rows: DevRow[]; open: Set<string>; toggle: (id: string) => void; columns: ReadonlySet<DevColumnKey> }) {
  const { t } = useTranslation("training");
  const { t: tRider } = useTranslation("rider");
  const { t: tRiders } = useTranslation("riders");
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
                <Name row={row} short />
                <span><Rating value={row.rating} /></span>
                <span className={`text-[13px] font-semibold text-cz-1 ${NUM}`}>{formatNumber(xpAvgPerDay(row))}</span>
                <button type="button" onClick={() => toggle(row.id)} aria-expanded={o} aria-label={t("developmentXp.openAbilities", { name: row.name })}
                  className="flex min-h-11 items-start justify-between gap-1 text-start text-xs">
                  {row.next
                    ? <span className="min-w-0 leading-tight text-cz-1"><span className="block truncate">{tRider(`racePreview.derived.${row.next.key}`)}</span><XpOf xp={row.next.xp} price={row.next.price} size="text-3xs" className="block" /></span>
                    : <span className="text-cz-3">—</span>}
                  {o ? <ChevronDownIcon size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" /> : <ChevronRightIcon size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" />}
                </button>
              </div>
              {o && (
                <div className="flex flex-col gap-3 border-t border-cz-border bg-cz-subtle/60 px-3 pb-4 pt-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {columns.has("natural") && <div><div className={LABEL}>{t("developmentXp.colNatural")}</div><NaturalType natural={row.natural} /></div>}
                    {columns.has("role") && <div><div className={LABEL}>{t("developmentXp.colRoleNow")}</div><RoleNow role={row.bestRole} /></div>}
                    <div><div className={LABEL}>{tRiders("table.age")}</div><span className={`text-[13px] text-cz-1 ${NUM}`} data-testid="development-xp-age">{row.age ?? "—"}</span></div>
                    <div><div className={LABEL}>{t("developmentXp.colTop")}</div><Top top={row.top} /></div>
                    <div><div className={LABEL}>{t("developmentXp.colXpToday")}</div><XpToday cell={row.today} /></div>
                    <div><div className={LABEL} title={t("developmentXp.ratingSeasonTitle")}>{t("developmentXp.colRatingSeason")}</div><RatingSeason value={row.ratingSeason} /></div>
                    {columns.has("rating30") && <div><div className={LABEL} title={t("developmentXp.rating30Title")}>{t("developmentXp.colRating30")}</div><RatingSeason value={row.rating30} testId="development-xp-rating-30" /></div>}
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
