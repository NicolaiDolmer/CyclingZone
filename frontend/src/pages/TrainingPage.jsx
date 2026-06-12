// TrainingPage — daglig træning (#1305).
//
// Viser holdets træningsprogrammer (fokus + intensitet per rytter) + dagens
// kørsel-knap (med konsistens-bonus) + rapport fra seneste kørsel.
// Rytterliste hentes fra Supabase (samme kilde som TeamPage) da det er holdets
// egne ryttere vi træner. Condition/progress/todayRun serveres fra useTraining.

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import RiderLink from "../components/RiderLink.jsx";
import { useTraining } from "../lib/useTraining.js";
import { TRAINING_FOCUS_KEYS, TRAINING_INTENSITIES, injuryDaysLeft } from "../lib/training.js";

// Bred side — samme mønster som TeamPage / RidersPage.
// (Layout WIDE_CONTENT_ROUTES håndterer kun specific paths — vi bruger inline max-w)

function MiniBar({ value, color, label }) {
  // value = 0..100
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]" title={`${label}: ${pct}`}>
      <div className="flex-1 h-1.5 bg-cz-subtle rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-cz-3 w-6 text-right">{pct}</span>
    </div>
  );
}

export default function TrainingPage() {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;

  const training = useTraining();
  const {
    plans, enabled, todayRun, condition, loading,
    savingId, running, setPlan, clearPlan, planFor, runToday,
  } = training;

  const [riders, setRiders] = useState([]);
  const [ridersLoading, setRidersLoading] = useState(true);
  const [runError, setRunError] = useState(null);

  // Hent egne ryttere fra Supabase — samme mønster som TeamPage.
  useEffect(() => {
    async function loadRiders() {
      setRidersLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: myTeam } = await supabase
          .from("teams")
          .select("id")
          .eq("user_id", user.id)
          .single();
        if (!myTeam) return;
        const { data } = await supabase
          .from("riders")
          .select("id, firstname, lastname")
          .eq("team_id", myTeam.id)
          .order("lastname");
        setRiders(data || []);
      } finally {
        setRidersLoading(false);
      }
    }
    loadRiders();
  }, []);

  async function handleRunToday() {
    setRunError(null);
    const result = await runToday();
    if (result && !result.ok) {
      setRunError(result.error || "failed");
    }
  }

  // Bestem hvilken trained-today label der vises.
  function trainedTodayLabel() {
    const by = todayRun?.executed_by;
    if (by === "assistant" || by === "cron") return t("trainedToday_assistant");
    return t("trainedToday_you");
  }

  const today = new Date();

  const isLoading = loading || ridersLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
        <div className="flex items-center gap-3">
          {todayRun ? (
            <span className="text-sm text-cz-success font-medium">{trainedTodayLabel()}</span>
          ) : !enabled ? (
            <span className="text-sm text-cz-3 italic">{t("disabledNote")}</span>
          ) : null}
          <button
            type="button"
            onClick={handleRunToday}
            disabled={!enabled || !!todayRun || running}
            className="px-4 py-2 rounded-lg bg-cz-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {running ? t("loading") : t("trainToday")}
          </button>
        </div>
      </div>

      {runError && (
        <p className="text-cz-danger text-sm">{runError}</p>
      )}

      {/* Rosterbord */}
      <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : riders.length === 0 ? (
          <div className="text-center py-10 text-cz-3 text-sm">{t("noRiders")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">
                    {t("colRider")}
                  </th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">
                    {tRider("training.focus")}
                  </th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">
                    {tRider("training.intensity")}
                  </th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">
                    {t("form")}
                  </th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">
                    {t("fatigue")}
                  </th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">
                    {t("colStatus")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {riders.map((rider) => {
                  const plan = planFor(rider.id);
                  const cond = condition[rider.id] ?? {};
                  const daysLeft = injuryDaysLeft(cond.injured_until, today);
                  const injured = daysLeft > 0;
                  const highRisk = !injured && (cond.risk ?? 0) >= 0.05;
                  const busy = savingId === rider.id;

                  return (
                    <tr key={rider.id} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle">
                      {/* Navn */}
                      <td className="px-4 py-3">
                        <RiderLink id={rider.id} className="text-cz-1 font-medium hover:text-cz-accent transition-colors">
                          {rider.firstname} {rider.lastname}
                        </RiderLink>
                      </td>

                      {/* Fokus */}
                      <td className="px-4 py-3">
                        <select
                          value={plan?.focus ?? ""}
                          disabled={busy}
                          onChange={(e) => {
                            const newFocus = e.target.value;
                            if (!newFocus) return;
                            setPlan(rider.id, newFocus, plan?.intensity ?? "normal");
                          }}
                          className="bg-cz-subtle border border-cz-border rounded px-2 py-1 text-xs text-cz-1 disabled:opacity-50 max-w-[130px]"
                        >
                          <option value="">—</option>
                          {TRAINING_FOCUS_KEYS.map((k) => (
                            <option key={k} value={k}>{tRider(`training.focus_${k}`)}</option>
                          ))}
                        </select>
                        {plan?.focus && (
                          <button
                            type="button"
                            onClick={() => clearPlan(rider.id)}
                            disabled={busy}
                            className="ms-1 text-[10px] text-cz-3 hover:text-cz-danger disabled:opacity-40"
                            title="Remove"
                          >
                            ×
                          </button>
                        )}
                      </td>

                      {/* Intensitet */}
                      <td className="px-4 py-3">
                        {plan?.focus ? (
                          <div className="inline-flex rounded border border-cz-border overflow-hidden">
                            {TRAINING_INTENSITIES.map((k) => (
                              <button
                                key={k}
                                type="button"
                                disabled={busy}
                                onClick={() => setPlan(rider.id, plan.focus, k)}
                                aria-pressed={plan.intensity === k}
                                className={`text-xs px-2 py-1 transition-colors disabled:opacity-50 ${
                                  plan.intensity === k
                                    ? "bg-cz-accent text-white"
                                    : "text-cz-2 hover:bg-cz-subtle"
                                }`}
                              >
                                {tRider(`training.intensity_${k}`)}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-cz-3 text-xs">—</span>
                        )}
                      </td>

                      {/* Form */}
                      <td className="px-4 py-3">
                        <MiniBar value={cond.form} color="bg-blue-400" label={t("form")} />
                      </td>

                      {/* Træthed */}
                      <td className="px-4 py-3">
                        <MiniBar value={cond.fatigue} color="bg-orange-400" label={t("fatigue")} />
                      </td>

                      {/* Status: skadet / høj risiko */}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {injured && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                              {daysLeft === 1
                                ? t("injured", { days: daysLeft })
                                : t("injured_plural", { days: daysLeft })}
                            </span>
                          )}
                          {highRisk && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cz-warning/10 text-cz-warning border border-cz-warning/20">
                              {t("injuryRisk")}
                            </span>
                          )}
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

      {/* Rapport fra seneste kørsel */}
      {todayRun?.report && (
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-cz-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-cz-1">{t("report")}</h2>
            {todayRun.bonus_applied && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-cz-accent/10 text-cz-accent border border-cz-accent/30">
                {t("bonusApplied")}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colRider")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{tRider("training.focus")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{tRider("training.intensity")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colScore")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colGains")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("fatigue")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {(todayRun.report.riders ?? []).map((row) => {
                  const gainEntries = row.gains
                    ? Object.entries(row.gains).filter(([, n]) => n > 0)
                    : [];
                  const fatigueDelta = row.fatigue_delta ?? 0;
                  return (
                    <tr key={row.rider_id} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle">
                      <td className="px-4 py-2.5">
                        <RiderLink id={row.rider_id} className="text-cz-1 font-medium hover:text-cz-accent transition-colors">
                          {row.name}
                        </RiderLink>
                        {row.injured && (
                          <span className="ms-2 text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
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
                      <td className="px-4 py-2.5 font-mono text-cz-2">{row.score ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        {gainEntries.length > 0 ? (
                          <span className="text-cz-success text-xs">
                            {gainEntries.map(([ability, n]) => t("gains", { n, ability })).join(", ")}
                          </span>
                        ) : (
                          <span className="text-cz-3 text-xs">{t("noGains")}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono">
                        <span className={fatigueDelta > 0 ? "text-orange-400" : fatigueDelta < 0 ? "text-cz-success" : "text-cz-3"}>
                          {fatigueDelta > 0 ? "+" : ""}{fatigueDelta}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {row.status === "over" && (
                          <span className="text-cz-success text-xs">{t("overperformed")}</span>
                        )}
                        {row.status === "under" && (
                          <span className="text-cz-danger text-xs">{t("underperformed")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
