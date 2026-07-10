// TrainingHistory — træningsrapport-historik på TrainingPage (#1533).
//
// Viser de seneste 30 dages daglige trænings-kørsler (training_day_runs) som en
// liste af dag-kort. Hvert kort har dato + hvem der kørte + dags-opsummering
// (trænede / gennembrud / topform) og kan foldes ud til den fulde rytter-tabel
// for dagen. Genbruger trainingReport-helpers (daySummary/breakthroughJumps/
// isBreakthrough) + TrainingPage'ens kort/tabel-styling. Ren visning — data
// kommer fra useTrainingHistory (RLS-begrænset SELECT, ingen ny datamodel).

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../lib/intl.js";
import RiderLink from "../RiderLink.jsx";
import { daySummary, breakthroughJumps, isBreakthrough } from "../../lib/trainingReport.js";

function executedByLabel(executedBy, t) {
  // cron-sweep og assistent vises ens (begge = ikke manuelt af dig).
  return executedBy === "manager" ? t("historyByYou") : t("historyByAssistant");
}

// Én udfoldet dags rytter-tabel — samme kolonner/styling som dagens rapport på
// TrainingPage, men uden "Næste +1" (kræver live progress-state, ikke historik).
function DayRiderTable({ rows, t, tRider }) {
  return (
    <div className="overflow-x-auto border-t border-cz-border">
      <table data-sort-exempt="Per-dag traeningsrapport i rapport-orden" className="w-full text-sm">
        <thead>
          <tr className="border-b border-cz-border">
            <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colRider")}</th>
            <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{tRider("training.focus")}</th>
            <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{tRider("training.intensity")}</th>
            <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colGains")}</th>
            <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colResult")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const jumps = breakthroughJumps(row);
            const breakthrough = isBreakthrough(row);
            const fatigueDelta = row.fatigue_delta ?? 0;
            const fatigueSign = fatigueDelta > 0 ? "+" : "";
            return (
              <tr
                key={row.rider_id}
                className={`border-b border-cz-border last:border-0 hover:bg-cz-subtle ${breakthrough ? "bg-cz-success-bg border-l-2 border-l-cz-success" : ""}`}
              >
                <td className="px-4 py-2.5">
                  <RiderLink id={row.rider_id} className="text-cz-1 font-medium hover:text-cz-accent transition-colors">
                    {row.name}
                  </RiderLink>
                  {row.injured && (
                    <span className="ms-2 text-[10px] px-1.5 py-0.5 rounded bg-cz-danger-bg text-cz-danger">
                      {row.injury_days === 1
                        ? t("injured", { days: row.injury_days })
                        : t("injured_plural", { days: row.injury_days })}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-cz-2">
                  {row.focus ? tRider(`training.focus_${row.focus}`) : "—"}
                </td>
                <td className="px-4 py-2.5 text-cz-2">
                  {row.intensity ? tRider(`training.intensity_${row.intensity}`) : "—"}
                </td>
                <td className="px-4 py-2.5">
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
                <td className="px-4 py-2.5">
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
  );
}

function DayCard({ run, t, tRider }) {
  const [open, setOpen] = useState(false);
  const rows = run.report?.riders ?? [];
  const summary = daySummary(rows);
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-left hover:bg-cz-subtle transition-colors"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold text-cz-1">{formatDate(run.tick_date)}</span>
          <span className="text-[11px] px-2 py-0.5 rounded-cz bg-cz-subtle text-cz-3 border border-cz-border">
            {executedByLabel(run.executed_by, t)}
          </span>
          {run.bonus_applied && (
            <span className="text-[11px] px-2 py-0.5 rounded-cz bg-cz-accent/10 text-cz-accent border border-cz-accent/30">
              {t("bonusApplied")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-cz-2">
            {t("historyDaySummary", { trained: summary.trained, breakthroughs: summary.breakthroughs, peakForm: summary.peakForm })}
          </span>
          <span className="text-xs text-cz-3">{open ? t("historyToggleClose") : t("historyToggleOpen")}</span>
        </div>
      </button>
      {open && rows.length > 0 && <DayRiderTable rows={rows} t={t} tRider={tRider} />}
    </div>
  );
}

export default function TrainingHistory({ history }) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;
  const { runs, loading } = history;

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-1">
        <h2 className="text-lg font-bold text-cz-1">{t("historyTitle")}</h2>
        <p className="text-xs text-cz-3">{t("historySubtitle")}</p>
      </div>

      {loading ? (
        <div className="bg-cz-card border border-cz-border rounded-cz flex items-center justify-center py-10">
          <div className="w-6 h-6 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        <div className="bg-cz-card border border-cz-border rounded-cz text-center py-8 text-cz-3 text-sm">
          {t("historyEmpty")}
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <DayCard key={run.tick_date} run={run} t={t} tRider={tRider} />
          ))}
        </div>
      )}
    </div>
  );
}
