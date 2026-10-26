// TrainingTeamTableB - holdtabellen "retning B" paa Today-fanen (desktop), #6110 S26.
//
// Ejer 24/10: kortet "Dagens beslutning" staar oeverst og UNDER det kommer B's
// tabel. Mockup: retning-B-holdoverblik-tabel (kun fanen Today). Alt om dagen
// staar i raekken: form, traethed nu og i aften, dage paa 70+, dagens dag,
// assistentens bud med "Use" og traeningsscoren. Rytterens status-badges
// (skade, hoej skaderisiko) staar som foer under navnet, loebsdagen som et
// lille loebs-maerke ved dagsvaelgeren.
//
// Sygdomsrisiko er IKKE med: sygdom er ikke live (#7178).
//
// Komponenten er ren praesentation, som TrainingTodayTable. Mutationer, sortering
// og filtrering ejes af TrainingPage; dagsvaelger, rytterkort, status og
// vaerktoejslinje kommer ind som faerdige noder. Mobilen bruger sin egen raekke
// (den godkendte trainings-mobilstandard) og ser ikke denne komponent.

import { Fragment, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import RiderBadges from "../rider/RiderBadges.jsx";
import Button from "../ui/Button.jsx";
import SortableTh from "../ui/SortableTh.jsx";
import { squadBadgeKey } from "../../lib/squadBadge.ts";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, FlagIcon, InfoIcon } from "../ui/icons/index.jsx";
import TrainingScoreSparkline from "./TrainingScoreSparkline.tsx";
import { Meter, TONIGHT_TEXT, type TodayRow } from "./TrainingTodayTable.tsx";
import type { AssistantKind } from "./TrainingTeamTableBModel.ts";

export type TeamRowB = TodayRow & {
  // Afregnede dage i traek paa/over graensen. null = ukendt (vis streg).
  daysOver: number | null;
  // Loebsnavnet hvis rytteren koerer loeb i dag, ellers null.
  race: string | null;
  assistant: AssistantKind;
};

export type TeamGroupB = { key: string; label: string; count: string; rows: TeamRowB[] };

type SortDir = "asc" | "desc";

export default function TrainingTeamTableB({
  rows,
  groups = null,
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
  renderReset = undefined,
  renderDetail,
  renderStatus,
  renderNoDay,
  onUse,
  toolbar,
  empty = null,
  forecastSettled = false,
  bulkBar = null,
  onSetGroup = undefined,
  setForGroupLabel = "",
  limit,
}: {
  rows: TeamRowB[];
  groups?: TeamGroupB[] | null;
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
  renderReset?: (riderId: string) => ReactNode;
  renderDetail: (riderId: string, detailId: string) => ReactNode;
  renderStatus: (riderId: string) => ReactNode;
  renderNoDay: (riderId: string) => ReactNode;
  // Skriver rytterens dag via den eksisterende plan-sti. Returnerer false ved fejl.
  onUse: (riderId: string) => Promise<unknown> | unknown;
  toolbar: ReactNode;
  empty?: ReactNode;
  forecastSettled?: boolean;
  bulkBar?: ReactNode;
  onSetGroup?: (riderIds: string[]) => void;
  setForGroupLabel?: string;
  // Traethedsgraensen "Dage 70+" taeller fra (samme tal som overblikkets filter).
  limit: number;
}) {
  const { t } = useTranslation("training");
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const colCount = 7 + (showScore ? 1 : 0);
  const headClass =
    "whitespace-nowrap border-b border-cz-border px-3 py-2 font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";
  const sortHeadClass = `${headClass} text-left [&_button]:uppercase [&_button]:text-start`;

  async function use(riderId: string) {
    setBusy((prev) => new Set(prev).add(riderId));
    try {
      await onUse(riderId);
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(riderId);
        return next;
      });
    }
  }

  let firstRendered = false;
  const renderRow = (row: TeamRowB) => {
    const isOpen = openId === row.id;
    const isSelected = selected.has(row.id);
    const isFirst = !firstRendered;
    firstRendered = true;
    const detailId = `training-rider-card-${row.id}`;
    const cellBase = `border-t border-cz-border px-3 py-1.5 align-middle ${isOpen || isSelected ? "bg-cz-subtle" : ""}`;
    return (
      <Fragment key={row.id}>
        <tr data-testid="training-team-row" data-rider-id={row.id} className="group transition-colors hover:bg-cz-subtle">
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
                <RiderBadges badges={[squadBadgeKey(row.squad)]} />
                <ChevronDownIcon
                  size={12}
                  aria-hidden="true"
                  className={`flex-none text-cz-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </span>
              <span className="mt-px font-data text-3xs uppercase tracking-wider text-cz-3">{row.sub}</span>
            </button>
            {renderStatus(row.id)}
          </td>
          <td className={`${cellBase} w-[104px]`}>
            <Meter value={row.form} warn={false} tone="form" />
          </td>
          <td className={`${cellBase} ${row.fatigueTonight ? "w-[150px]" : "w-[104px]"}`}>
            {row.fatigueTonight ? (
              <div
                className="flex items-center gap-1.5 whitespace-nowrap"
                data-testid="fatigue-now-tonight"
                data-band={row.fatigueTonight.tone}
                role="img"
                aria-label={t("today.fatigueTonightAria", {
                  now: row.fatigue ?? "—",
                  value: row.fatigueTonight.value,
                  band: t(`forecast.band_${row.fatigueTonight.tone}`),
                })}
              >
                <Meter value={row.fatigue} warn={row.tired} tone="fatigue" />
                <ChevronRightIcon size={11} aria-hidden="true" className="flex-none text-cz-3" />
                <span
                  className={`font-data text-[12.5px] font-semibold tabular-nums ${TONIGHT_TEXT[row.fatigueTonight.tone]}`}
                  aria-hidden="true"
                >
                  {forecastSettled ? row.fatigueTonight.value : `~${row.fatigueTonight.value}`}
                </span>
              </div>
            ) : (
              <Meter value={row.fatigue} warn={row.tired} tone="fatigue" />
            )}
          </td>
          <td
            className={`${cellBase} w-[84px] text-right font-data text-[12.5px] tabular-nums ${
              (row.daysOver ?? 0) > 0 ? "font-bold text-cz-warning" : "text-cz-3"
            }`}
            data-testid="training-days-over"
          >
            {row.daysOver == null ? "—" : row.daysOver}
          </td>
          <td className={`${cellBase} w-[240px]`}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                {renderDay(row.id, isFirst)}
                {renderReset?.(row.id)}
              </div>
              {row.race != null && (
                <span
                  title={row.race || undefined}
                  data-testid="training-race-chip"
                  className="inline-flex flex-none items-center gap-1 rounded-cz bg-cz-1 px-1.5 py-0.5 font-data text-2xs font-semibold text-cz-card"
                >
                  <FlagIcon size={11} aria-hidden="true" />
                  {t("decision.raceChip")}
                </span>
              )}
            </div>
          </td>
          <td className={`${cellBase} min-w-[170px]`} data-testid="training-assistant-cell" data-assistant={row.assistant}>
            {row.assistant === "use" ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-cz-warning">{t("decision.assistantRecovery")}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="training-team-use"
                  aria-label={t("decision.useAria", { name: row.name })}
                  loading={busy.has(row.id)}
                  disabled={busy.has(row.id)}
                  onClick={() => use(row.id)}
                  className="min-h-8 flex-none"
                >
                  {t("decision.use")}
                </Button>
              </div>
            ) : row.assistant === "agrees" ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-cz-3">
                <CheckIcon size={13} aria-hidden="true" />
                {t("decision.agrees")}
              </span>
            ) : row.assistant === "noDay" ? (
              renderNoDay(row.id)
            ) : (
              <span className="text-xs text-cz-3">—</span>
            )}
          </td>
          {showScore && (
            <td
              className={`${cellBase} w-[84px] text-right font-data tabular-nums`}
              data-testid="training-score-cell"
              data-score-state={row.score?.state ?? "none"}
            >
              <div className="flex flex-col items-end gap-1">
                {row.score?.state === "score" ? (
                  <span className="text-sm font-bold leading-none text-cz-1">{row.score.value}</span>
                ) : row.score?.state === "latest" ? (
                  <span className="inline-flex items-baseline gap-1" title={t("score.latestHint")}>
                    <span className="text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">{t("score.latest")}</span>
                    <span className="text-sm font-bold leading-none text-cz-3">{row.score.value}</span>
                  </span>
                ) : row.score?.state === "race" ? (
                  <span className="text-3xs uppercase tracking-[.06em] text-cz-3">{t("score.raceDay")}</span>
                ) : (
                  <span className="text-xs text-cz-3">—</span>
                )}
                {(row.score?.spark?.length ?? 0) > 0 && (
                  <TrainingScoreSparkline
                    points={row.score?.spark ?? null}
                    label={t("score.sparkAria", { name: row.name })}
                    width={64}
                    height={18}
                  />
                )}
              </div>
            </td>
          )}
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
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" data-testid="training-team-table">
      <div className="flex min-h-[46px] flex-wrap items-center justify-between gap-3 border-b border-cz-border px-3 py-2">
        {toolbar}
      </div>
      {bulkBar}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" data-sortable>
          <thead>
            <tr>
              <th className={`${headClass} w-11 ps-4 text-left`}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  aria-label={t("selectAll")}
                  className="h-4 w-4 rounded-[3px] accent-cz-accent"
                />
              </th>
              <SortableTh sortKey="name" sort={sort} sortDir={sortDir} onSort={onSort} className={sortHeadClass}>
                {t("colRider")}
              </SortableTh>
              <SortableTh sortKey="form" sort={sort} sortDir={sortDir} onSort={onSort} className={sortHeadClass}>
                {t("form")}
              </SortableTh>
              <SortableTh sortKey="fatigue" sort={sort} sortDir={sortDir} onSort={onSort} className={sortHeadClass}>
                {t("today.colFatigueTonight")}
              </SortableTh>
              <th className={`${headClass} text-right`} title={t("decision.days70Hint", { from: limit })}>
                {t("decision.colDays70", { from: limit })}
              </th>
              <th className={`${headClass} text-left`}>{t("today.colDay")}</th>
              <th className={`${headClass} text-left`}>{t("decision.colAssistant")}</th>
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
                      <div className="flex items-center justify-between gap-3">
                        <span>
                          <span className="font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-2">{group.label}</span>
                          <span className="ms-2 font-data text-2xs text-cz-3">{group.count}</span>
                        </span>
                        {onSetGroup && (
                          <button
                            type="button"
                            onClick={() => onSetGroup(group.rows.map((r) => r.id))}
                            data-testid="training-set-for-group"
                            className="text-xs font-medium text-cz-accent-t hover:underline"
                          >
                            {setForGroupLabel}
                          </button>
                        )}
                      </div>
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
