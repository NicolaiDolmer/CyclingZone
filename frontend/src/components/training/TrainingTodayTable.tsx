// TrainingTodayTable — truppens dag paa desktop (#5485, fanen Today).
//
// Ejer-go 23/9 (A1 + A3), mockup docs/design/mockups/5485/after.html:
//   * EEN raekke pr. rytter: markering (Select), navn, form, traethed, dagens
//     dag (een vaelger, TrainingDaySelect), en celle pr. loebsdag og
//     saesonens point. Knaprækken Rest/Active recovery/session er vaek.
//   * Loebsdags-cellen viser DAGTYPEN (Race/Thresh/Recov/...), ikke en konkret
//     session med detaljer (A1).
//   * Rytternavnet folder rytterens kort ud LIGE UNDER raekken, ogsaa her paa
//     desktop (A3, samme moenster som mobilens laaste variant, #5458). Clarity:
//     rytternavnet var det mest klikkede element med flest doede klik, og 163
//     quickbacks paa en uge tyder paa klik ud paa profilen og straks tilbage.
//     Profil-linket bor nu inde i kortet.
//   * Markeringskolonnen hedder "Select", og handlingen for de valgte staar i
//     vaerktoejslinjen lige over raekkerne (aendring 5), ikke i et kort over
//     tabellen.
//
// Komponenten er ren praesentation. Mutationer, sortering og filtrering ejes af
// TrainingPage; det der kraever sidens JS-komponenter (dagsvaelger, kort,
// status-badges, vaerktoejslinje) kommer ind som faerdige noder.

import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { RaceDayColumn } from "../../lib/trainingMobileModel.ts";
import type { RosterCell } from "./mobile/TrainingMobileRoster.tsx";
import TrainingScoreSparkline, { type TrainingScorePoint } from "./TrainingScoreSparkline.tsx";
// Den ENE kanoniske sorterbare header (samme pil, aria-sort og klik-maal som
// resten af spillet), ikke en lokal kopi.
import SortableTh from "../ui/SortableTh.jsx";
import { ChevronDownIcon, FlagIcon, InfoIcon } from "../ui/icons/index.jsx";

export type TodayRow = {
  id: string;
  name: string;
  sub: string;
  form: number | null;
  fatigue: number | null;
  tired: boolean;
  seasonPoints: number | null;
  noDay: boolean;
  score?: { state: "score" | "race" | "none"; value?: number | null; spark?: TrainingScorePoint[] | null } | null;
};

export type TodayGroup = { key: string; label: string; count: string; rows: TodayRow[] };

type SortDir = "asc" | "desc";

function Meter({ value, warn, tone }: { value: number | null; warn: boolean; tone: "form" | "fatigue" }) {
  const pct = Math.max(0, Math.min(100, Number(value ?? 0)));
  const fill = warn ? "bg-cz-warning" : tone === "form" ? "bg-cz-info" : "bg-cz-1";
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-6 text-right font-data text-[12.5px] tabular-nums ${warn ? "font-bold text-cz-warning" : "text-cz-1"}`}
      >
        {value ?? "—"}
      </span>
      <span className="relative h-1.5 w-11 overflow-hidden rounded-cz-pill bg-cz-subtle" aria-hidden="true">
        <span className={`absolute inset-y-0 start-0 rounded-cz-pill ${fill}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function DayCell({ cell }: { cell: RosterCell }) {
  return (
    <span
      title={cell.title ?? cell.label}
      className={`inline-flex min-w-[62px] items-center justify-center gap-1 rounded-cz px-1.5 py-0.5 font-data text-xs font-semibold ${
        cell.tone === "race" ? "bg-cz-1 text-cz-card" : cell.tone === "off" ? "font-medium text-cz-3" : "text-cz-1"
      }`}
    >
      {cell.tone === "race" && <FlagIcon size={12} aria-hidden="true" />}
      {cell.label}
    </span>
  );
}

export default function TrainingTodayTable({
  rows,
  groups = null,
  columns,
  cellFor,
  showScore,
  sort,
  sortDir,
  onSort,
  selected,
  allSelected,
  onToggleSelect,
  onToggleAll,
  openId,
  onToggleOpen,
  renderDay,
  renderDetail,
  renderStatus,
  renderNoDay,
  toolbar,
  empty = null,
}: {
  rows: TodayRow[];
  groups?: TodayGroup[] | null;
  columns: RaceDayColumn[];
  cellFor: (riderId: string, column: RaceDayColumn) => RosterCell;
  showScore: boolean;
  sort: string | null;
  sortDir: SortDir;
  onSort: (key: string) => void;
  selected: ReadonlySet<string>;
  allSelected: boolean;
  onToggleSelect: (riderId: string) => void;
  onToggleAll: () => void;
  openId: string | null;
  onToggleOpen: (riderId: string) => void;
  renderDay: (riderId: string, isFirst: boolean) => ReactNode;
  renderDetail: (riderId: string, detailId: string) => ReactNode;
  renderStatus: (riderId: string) => ReactNode;
  // Raekker uden en dag: loebsdags-cellerne slaas sammen til een celle med
  // "No day set yet" og assistentens bud (mockup-raekken for Ferrán).
  renderNoDay: (riderId: string) => ReactNode;
  toolbar: ReactNode;
  empty?: ReactNode;
}) {
  const { t } = useTranslation("training");
  const single = columns.length === 1;
  const colCount = 5 + (showScore ? 1 : 0) + columns.length + 1;
  // Justeringen saettes pr. kolonne, saa text-left aldrig kaemper med
  // text-center/text-right i samme klasseliste.
  const headClass =
    "whitespace-nowrap border-b border-cz-border px-3 py-2 font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";
  // SortableTh's knap arver ikke text-transform (preflight nulstiller den paa
  // <button>) og centrerer sin tekst (browserens standard), saa de sorterbare
  // overskrifter faar samme versaler og venstrestilling som resten af raekken.
  const sortHeadClass = `${headClass} text-left [&_button]:uppercase [&_button]:text-start`;

  let firstRendered = false;
  const renderRow = (row: TodayRow) => {
    const isOpen = openId === row.id;
    const isSelected = selected.has(row.id);
    const isFirst = !firstRendered;
    firstRendered = true;
    const detailId = `training-rider-card-${row.id}`;
    const cellBase = `border-t border-cz-border px-3 py-1.5 align-middle ${isOpen || isSelected ? "bg-cz-subtle" : ""}`;
    return (
      <Fragment key={row.id}>
        <tr data-testid="training-today-row" data-rider-id={row.id} className="group transition-colors hover:bg-cz-subtle">
          <td className={`${cellBase} w-11 ps-4`}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(row.id)}
              aria-label={t("today.selectRider", { name: row.name })}
              className="h-4 w-4 rounded-[3px] accent-cz-accent"
            />
          </td>
          <td className={`${cellBase} min-w-[200px]`}>
            <button
              type="button"
              onClick={() => onToggleOpen(row.id)}
              aria-expanded={isOpen}
              aria-controls={isOpen ? detailId : undefined}
              className="flex w-full min-w-0 flex-col items-start py-1 text-start"
            >
              <span className="flex items-center gap-1.5 text-[13.5px] font-medium text-cz-1">
                {row.name}
                <ChevronDownIcon
                  size={12}
                  aria-hidden="true"
                  className={`flex-none text-cz-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </span>
              <span className="mt-px font-data text-3xs uppercase tracking-[.05em] text-cz-3">{row.sub}</span>
            </button>
            {renderStatus(row.id)}
          </td>
          <td className={`${cellBase} w-[104px]`}>
            <Meter value={row.form} warn={false} tone="form" />
          </td>
          <td className={`${cellBase} w-[104px]`}>
            <Meter value={row.fatigue} warn={row.tired} tone="fatigue" />
          </td>
          {showScore && (
            <td className={`${cellBase} w-[84px] text-right font-data tabular-nums`}>
              {row.score?.state === "score" ? (
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-bold leading-none text-cz-1">{row.score.value}</span>
                  {(row.score.spark?.length ?? 0) > 1 && (
                    <TrainingScoreSparkline
                      points={row.score.spark ?? null}
                      label={t("score.sparkAria", { name: row.name })}
                      width={64}
                      height={18}
                    />
                  )}
                </div>
              ) : row.score?.state === "race" ? (
                <span className="text-3xs uppercase tracking-[.06em] text-cz-3">{t("score.raceDay")}</span>
              ) : (
                <span className="text-xs text-cz-3">—</span>
              )}
            </td>
          )}
          <td className={`${cellBase} w-[220px]`}>{renderDay(row.id, isFirst)}</td>
          {row.noDay ? (
            <td className={`${cellBase} px-1`} colSpan={columns.length}>
              {renderNoDay(row.id)}
            </td>
          ) : (
            columns.map((column) => (
              <td key={column.key} className={`${cellBase} px-1 text-center`}>
                <DayCell cell={cellFor(row.id, column)} />
              </td>
            ))
          )}
          <td className={`${cellBase} w-[84px] pe-4 text-right font-data text-[13px] tabular-nums text-cz-1`}>
            {row.seasonPoints != null ? `+${row.seasonPoints}` : <span className="text-cz-3">—</span>}
          </td>
        </tr>
        {isOpen && (
          <tr data-testid="training-rider-detail">
            <td colSpan={colCount} className="border-t-0 bg-cz-subtle px-4 pb-3.5 pt-1 sm:ps-14">
              {renderDetail(row.id, detailId)}
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" data-testid="training-today-table">
      <div className="flex min-h-[46px] flex-wrap items-center justify-between gap-3 border-b border-cz-border px-3 py-2">
        {toolbar}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" data-sortable>
          <thead>
            <tr>
              <th className={`${headClass} w-11 ps-4 text-left`}>
                <span className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleAll}
                    aria-label={t("selectAll")}
                    className="h-4 w-4 rounded-[3px] accent-cz-accent"
                  />
                  {t("today.colSelect")}
                </span>
              </th>
              <SortableTh sortKey="name" sort={sort} sortDir={sortDir} onSort={onSort} className={sortHeadClass}>
                {t("colRider")}
              </SortableTh>
              <SortableTh sortKey="form" sort={sort} sortDir={sortDir} onSort={onSort} className={sortHeadClass}>
                {t("form")}
              </SortableTh>
              <SortableTh sortKey="fatigue" sort={sort} sortDir={sortDir} onSort={onSort} className={sortHeadClass}>
                {t("fatigue")}
              </SortableTh>
              {/* #4851: "Score" forklarer ikke sig selv. Kort tekst paa fladen
                  (title) og et stille link til Hjaelpens prosa (#4025), samme
                  moenster som den gamle roster-header. */}
              {showScore && (
                <SortableTh
                  sortKey="score"
                  sort={sort}
                  sortDir={sortDir}
                  onSort={onSort}
                  title={t("score.columnHint")}
                  className={`${headClass} text-right [&_button]:uppercase`}
                  help={
                    <Link
                      to="/help?section=dailytraining"
                      aria-label={t("score.columnHelpAria")}
                      title={t("score.columnHelpAria")}
                      className="inline-flex items-center text-cz-3 hover:text-cz-accent"
                    >
                      <InfoIcon size={12} aria-hidden="true" />
                    </Link>
                  }
                >
                  {t("score.column")}
                </SortableTh>
              )}
              <th className={`${headClass} text-left`}>{t("today.colDay")}</th>
              {columns.map((column) => (
                <th key={column.key} className={`${headClass} px-1 text-center`}>
                  {single ? t("mobile.today") : t("mobile.raceDayShort", { n: column.index })}
                </th>
              ))}
              <th className={`${headClass} pe-4 text-right`}>{t("today.colSeasonPoints")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && empty ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6">
                  {empty}
                </td>
              </tr>
            ) : groups ? (
              groups.map((group) => (
                <Fragment key={group.key}>
                  <tr className="bg-cz-subtle/60">
                    <td colSpan={colCount} className="border-t border-cz-border px-4 py-2">
                      <span className="font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-2">{group.label}</span>
                      <span className="ms-2 font-data text-2xs text-cz-3">{group.count}</span>
                    </td>
                  </tr>
                  {group.rows.map(renderRow)}
                </Fragment>
              ))
            ) : (
              rows.map(renderRow)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
