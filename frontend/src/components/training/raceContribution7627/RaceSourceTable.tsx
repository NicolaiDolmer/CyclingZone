import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import type { RaceSourceBreakdown } from "./raceContributionModel.ts";
import { RACE_FILL_CLASS, RACE_FILL_STYLE } from "./raceSourceFill.ts";

// #7627 variant B: one table per rider, ability by source. Columns follow what
// the rider did on the date: training only, races only, or both plus a total.
const GRID_BOTH = "grid-cols-[minmax(0,1fr)_3.25rem_3.25rem_3.75rem] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_4.5rem_4.5rem_5rem]";
const GRID_ONE = "grid-cols-[minmax(0,1fr)_4.5rem] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_5rem]";
const META = "font-data text-2xs uppercase tracking-[.08em] text-cz-3";

export default function RaceSourceTable({ breakdown, abilityName, wholeChange }: {
  breakdown: RaceSourceBreakdown;
  abilityName: (key: string) => string;
  /** The level change for an ability that landed a whole point, as the receipt draws it. */
  wholeChange: (key: string) => ReactNode;
}) {
  const { t } = useTranslation("training");
  const { rows, showTraining, showRace } = breakdown;
  const both = showTraining && showRace;
  const grid = both ? GRID_BOTH : GRID_ONE;
  const max = Math.max(1, ...rows.map(row => row.total));
  const pct = (value: number) => value > 0 ? t("dailyReceipt.pointContribution", { percent: formatNumber(value) }) : formatNumber(0);
  const only = showRace ? "race" : "training";
  return (
    <div className="mb-3" data-testid="daily-receipt-race-source">
      <p className={`${META} mb-2`}>{t("raceSource.heading")}</p>
      {both && <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-cz-2" data-testid="daily-receipt-race-source-key">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2.5 rounded-[2px] border border-cz-border bg-cz-border-strong" aria-hidden="true" />{t("raceSource.training")}</span>
        <span className="inline-flex items-center gap-1.5"><span className={`inline-block h-2 w-2.5 rounded-[2px] border border-cz-border ${RACE_FILL_CLASS}`} style={RACE_FILL_STYLE} aria-hidden="true" />{t("raceSource.race")}</span>
      </div>}
      {rows.length === 0
        ? <p className="border-t border-cz-border py-2 text-xs text-cz-2" data-testid="daily-receipt-no-whole-point">{t("dailyReceipt.noWholePoint")}</p>
        : <>
          <div className={`grid items-end gap-2 pb-1 ${META} ${grid}`}>
            <span>{t("raceSource.ability")}</span>
            <span className="hidden sm:block" aria-hidden="true" />
            {both ? <>
              <span className="text-right">{t("raceSource.training")}</span>
              <span className="text-right">{t("raceSource.race")}</span>
              <span className="text-right">{t("raceSource.total")}</span>
            </> : <span className="text-right">{t(`raceSource.${only}`)}</span>}
          </div>
          {rows.map(row => <div key={row.key} className={`grid items-center gap-x-2 gap-y-1.5 border-t border-cz-border py-2 text-xs ${grid}`} data-testid="daily-receipt-race-source-row" data-ability={row.key}>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-semibold text-cz-1">{abilityName(row.key)}</span>
              {row.whole > 0 && <span className="font-data text-2xs font-semibold tabular-nums text-cz-success" data-testid="daily-receipt-race-source-whole">{t("raceSource.whole", { count: row.whole })}</span>}
              {row.whole > 0 && <span className="font-data text-2xs tabular-nums text-cz-2">{wholeChange(row.key)}</span>}
            </span>
            <span className="order-last col-span-full flex h-2 overflow-hidden rounded-[2px] border border-cz-border bg-cz-subtle sm:order-none sm:col-span-1" role="img"
              aria-label={both ? t("raceSource.barLabel", { training: pct(row.training), race: pct(row.race) }) : `${t(`raceSource.${only}`)} ${pct(row.total)}`}>
              {row.training > 0 && <span className="block h-full bg-cz-border-strong" style={{ width: `${row.training / max * 100}%` }} />}
              {row.race > 0 && <span className={`block h-full ${RACE_FILL_CLASS}`} style={{ ...RACE_FILL_STYLE, width: `${row.race / max * 100}%` }} />}
            </span>
            {both ? <>
              <span className={`text-right font-data tabular-nums ${row.training > 0 ? "text-cz-2" : "text-cz-3"}`}>{pct(row.training)}</span>
              <span className={`text-right font-data tabular-nums ${row.race > 0 ? "font-medium text-cz-1" : "text-cz-3"}`}>{pct(row.race)}</span>
              <span className="text-right font-data font-semibold tabular-nums text-cz-1">{pct(row.total)}</span>
            </> : <span className="text-right font-data font-semibold tabular-nums text-cz-1">{pct(row.total)}</span>}
          </div>)}
        </>}
      {showRace && rows.length > 0 && <p className="mt-2 text-xs text-cz-3">{t("raceSource.foot")}</p>}
    </div>
  );
}
