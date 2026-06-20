// RiderTrainingHistory — per-rytter træningshistorik på rytterprofilen (#1533).
//
// Vises i Development-fanen for EGNE ryttere (samme gate som TrainingFocus).
// Plukker rytterens daglige trænings-linjer ud af de seneste 30 dages
// training_day_runs (via riderHistoryFromRuns) og lister dem dag-for-dag:
// dato, fokus + intensitet, fremgang (gennembrud vist som faktisk tal-spring)
// og form/træthed-delta. Ren visning — data kommer fra useTrainingHistory.

import { useTranslation } from "react-i18next";
import { formatDate } from "../../lib/intl.js";
import { riderHistoryFromRuns, breakthroughJumps, isBreakthrough } from "../../lib/trainingReport.js";

export default function RiderTrainingHistory({ riderId, history }) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;
  const { runs, loading } = history;

  const entries = riderHistoryFromRuns(runs, riderId);

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-5 mb-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-1 mb-3">
        <h3 className="text-sm font-semibold text-cz-1">{t("riderHistoryTitle")}</h3>
        <p className="text-xs text-cz-3">{t("riderHistorySubtitle")}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-cz-3 text-sm py-2">{t("riderHistoryEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cz-border">
                <th className="py-2 text-left text-cz-3 font-medium text-xs uppercase whitespace-nowrap">{tRider("development.table.date")}</th>
                <th className="py-2 px-2 text-left text-cz-3 font-medium text-xs uppercase">{tRider("training.focus")}</th>
                <th className="py-2 px-2 text-left text-cz-3 font-medium text-xs uppercase">{tRider("training.intensity")}</th>
                <th className="py-2 px-2 text-left text-cz-3 font-medium text-xs uppercase">{t("colGains")}</th>
                <th className="py-2 pl-2 text-left text-cz-3 font-medium text-xs uppercase">{t("colResult")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ tick_date, row }) => {
                const jumps = breakthroughJumps(row);
                const breakthrough = isBreakthrough(row);
                const fatigueDelta = row.fatigue_delta ?? 0;
                const fatigueSign = fatigueDelta > 0 ? "+" : "";
                const isRest = !row.intensity || row.intensity === "rest";
                return (
                  <tr
                    key={tick_date}
                    className={`border-b border-cz-border last:border-0 ${breakthrough ? "bg-cz-success-bg" : ""}`}
                  >
                    <td className="py-2 text-cz-2 whitespace-nowrap">{formatDate(tick_date)}</td>
                    <td className="py-2 px-2 text-cz-2">
                      {row.focus ? tRider(`training.focus_${row.focus}`) : "—"}
                    </td>
                    <td className="py-2 px-2 text-cz-2">
                      {isRest ? t("riderHistoryRest") : tRider(`training.intensity_${row.intensity}`)}
                      {row.injured && (
                        <span className="ms-2 text-[10px] px-1.5 py-0.5 rounded bg-cz-danger-bg text-cz-danger">
                          {row.injury_days === 1
                            ? t("injured", { days: row.injury_days })
                            : t("injured_plural", { days: row.injury_days })}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      {jumps.length > 0 ? (
                        <span className="text-cz-success text-xs font-medium">
                          {jumps.map((j) => (
                            j.from != null && j.to != null
                              ? t("gainJump", { from: j.from, to: j.to, ability: tRider(`racePreview.derived.${j.ability}`) })
                              : t("gains", { n: j.n, ability: tRider(`racePreview.derived.${j.ability}`) })
                          )).join(", ")}
                        </span>
                      ) : (
                        <span className="text-cz-3 text-xs">{t("noGains")}</span>
                      )}
                    </td>
                    <td className="py-2 pl-2">
                      <div className="flex flex-col gap-0.5">
                        {row.status === "over" && <span className="text-cz-success text-xs">{t("sharpDay")}</span>}
                        {row.status === "under" && <span className="text-cz-danger text-xs">{t("flatDay")}</span>}
                        <span className={`text-[11px] font-mono ${fatigueDelta > 0 ? "text-cz-warning" : fatigueDelta < 0 ? "text-cz-success" : "text-cz-3"}`}>
                          {t("fatigueChange", { delta: `${fatigueSign}${fatigueDelta}` })}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
