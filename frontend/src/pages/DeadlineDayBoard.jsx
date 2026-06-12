import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

// labelKey resolves i transfers-namespacet (deadlineDay.*) — Refs #1170.
const STATUS = {
  critical: { labelKey: "deadlineDay.statusCritical", cls: "text-cz-danger",  dot: "bg-cz-danger"  },
  warning:  { labelKey: "deadlineDay.statusWarning",  cls: "text-cz-warning", dot: "bg-cz-warning" },
  ok:       { labelKey: "deadlineDay.statusOk",       cls: "text-cz-success", dot: "bg-cz-success" },
};

function SquadTable({ rows, dimmed, captionId }) {
  const { t } = useTranslation("transfers");
  return (
    <div className={`rounded-xl border border-cz-border overflow-x-auto${dimmed ? " opacity-60" : ""}`}>
      <table className="w-full text-sm" aria-labelledby={captionId}>
        <thead>
          <tr className="border-b border-cz-border text-[10px] text-cz-3 uppercase tracking-wider">
            <th scope="col" className="px-4 py-2 text-left font-medium">{t("deadlineDay.thTeam")}</th>
            <th scope="col" className="px-4 py-2 text-center font-medium">{t("deadlineDay.thDivision")}</th>
            <th scope="col" className="px-4 py-2 text-center font-medium">{t("common:nav.item.riders")}</th>
            <th scope="col" className="px-4 py-2 text-center font-medium">{t("deadlineDay.thMin")}</th>
            <th scope="col" className="px-4 py-2 text-center font-medium">{t("deadlineDay.thStatus")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const { labelKey, cls, dot } = STATUS[row.status] || STATUS.ok;
            return (
              <tr key={row.id} className={`border-b border-cz-border last:border-0${i % 2 === 0 ? " bg-cz-subtle" : ""}`}>
                <td className="px-4 py-3 font-medium text-cz-1">
                  <Link to={`/teams/${row.id}`} className="hover:text-cz-accent transition-colors">
                    {row.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-center text-cz-3">D{row.division}</td>
                <td className="px-4 py-3 text-center font-mono font-bold text-cz-1">{row.riders}</td>
                <td className="px-4 py-3 text-center text-cz-3">{row.min}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                    {t(labelKey)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DeadlineDayBoard() {
  const { t } = useTranslation("transfers");
  const [squads, setSquads] = useState(null);
  const [ddActive, setDdActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) { if (!cancelled) setLoading(false); return; }

        const headers = { Authorization: `Bearer ${token}` };
        const [statusRes, squadsRes] = await Promise.all([
          fetch(`${API}/api/deadline-day/status`, { headers }),
          fetch(`${API}/api/deadline-day/squads`, { headers }),
        ]);
        if (cancelled) return;
        if (!statusRes.ok || !squadsRes.ok) {
          setFetchError(true);
          setLoading(false);
          return;
        }
        setFetchError(false);
        setDdActive((await statusRes.json()).active);
        setSquads(await squadsRes.json());
        setLoading(false);
      } catch {
        if (!cancelled) { setFetchError(true); setLoading(false); }
      }
    }

    load();
    const iv = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="max-w-xl mx-auto text-center py-20 space-y-3" role="alert">
        <p className="text-4xl">⚠️</p>
        <p className="font-semibold text-cz-danger">{t("deadlineDay.fetchErrorTitle")}</p>
        <p className="text-sm text-cz-3">{t("deadlineDay.fetchErrorRetry")}</p>
      </div>
    );
  }

  if (!ddActive) {
    return (
      <div className="max-w-xl mx-auto text-center py-20 space-y-3">
        <p className="text-4xl">🕐</p>
        <p className="font-semibold text-cz-2">{t("deadlineDay.inactiveTitle")}</p>
        <p className="text-sm text-cz-3">{t("deadlineDay.inactiveSubtitle")}</p>
      </div>
    );
  }

  const critical = squads?.filter(s => s.status === "critical") ?? [];
  const warning  = squads?.filter(s => s.status === "warning")  ?? [];
  const ok       = squads?.filter(s => s.status === "ok")       ?? [];
  const totalShown = critical.length + warning.length + ok.length;

  return (
    <div className="max-w-3xl mx-auto space-y-6" aria-live="polite" aria-busy={loading}>
      <div>
        <h1 className="text-xl font-bold text-cz-1 tracking-tight">{t("deadlineDay.title")}</h1>
        <p className="text-sm text-cz-3 mt-0.5">
          {t("deadlineDay.subtitle")}
        </p>
      </div>

      {totalShown === 0 && (
        <div className="rounded-xl border border-cz-border p-6 text-center">
          <p className="text-2xl mb-2">✅</p>
          <p className="font-semibold text-cz-2">{t("deadlineDay.allOkTitle")}</p>
          <p className="text-sm text-cz-3 mt-1">{t("deadlineDay.allOkSubtitle")}</p>
        </div>
      )}

      {critical.length > 0 && (
        <section className="space-y-2">
          <h2 id="dd-critical-heading" className="text-[10px] font-bold tracking-[0.15em] uppercase text-cz-danger">
            {t("deadlineDay.sectionCritical", { count: critical.length })}
          </h2>
          <SquadTable rows={critical} captionId="dd-critical-heading" />
        </section>
      )}

      {warning.length > 0 && (
        <section className="space-y-2">
          <h2 id="dd-warning-heading" className="text-[10px] font-bold tracking-[0.15em] uppercase text-cz-warning">
            {t("deadlineDay.sectionWarning", { count: warning.length })}
          </h2>
          <SquadTable rows={warning} captionId="dd-warning-heading" />
        </section>
      )}

      {ok.length > 0 && (
        <section className="space-y-2">
          <h2 id="dd-ok-heading" className="text-[10px] font-bold tracking-[0.15em] uppercase text-cz-3">
            {t("deadlineDay.sectionOk", { count: ok.length })}
          </h2>
          <SquadTable rows={ok} dimmed captionId="dd-ok-heading" />
        </section>
      )}
    </div>
  );
}
