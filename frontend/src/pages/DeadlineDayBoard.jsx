import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

const STATUS = {
  critical: { label: "Under minimum",  cls: "text-cz-danger",  dot: "bg-cz-danger"  },
  warning:  { label: "Tæt på minimum", cls: "text-cz-warning", dot: "bg-cz-warning" },
  ok:       { label: "OK",             cls: "text-cz-success", dot: "bg-cz-success" },
};

function SquadTable({ rows, dimmed, captionId }) {
  return (
    <div className={`rounded-xl border border-cz-border overflow-x-auto${dimmed ? " opacity-60" : ""}`}>
      <table className="w-full text-sm" aria-labelledby={captionId}>
        <thead>
          <tr className="border-b border-cz-border text-[10px] text-cz-3 uppercase tracking-wider">
            <th scope="col" className="px-4 py-2 text-left font-medium">Hold</th>
            <th scope="col" className="px-4 py-2 text-center font-medium">Div</th>
            <th scope="col" className="px-4 py-2 text-center font-medium">Ryttere</th>
            <th scope="col" className="px-4 py-2 text-center font-medium">Min</th>
            <th scope="col" className="px-4 py-2 text-center font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const { label, cls, dot } = STATUS[t.status] || STATUS.ok;
            return (
              <tr key={t.id} className={`border-b border-cz-border last:border-0${i % 2 === 0 ? " bg-cz-subtle" : ""}`}>
                <td className="px-4 py-3 font-medium text-cz-1">
                  <Link to={`/teams/${t.id}`} className="hover:text-cz-accent transition-colors">
                    {t.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-center text-cz-3">D{t.division}</td>
                <td className="px-4 py-3 text-center font-mono font-bold text-cz-1">{t.riders}</td>
                <td className="px-4 py-3 text-center text-cz-3">{t.min}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                    {label}
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
        <p className="font-semibold text-cz-danger">Kunne ikke hente Deadline Day-status</p>
        <p className="text-sm text-cz-3">Prøver igen om 30 sekunder</p>
      </div>
    );
  }

  if (!ddActive) {
    return (
      <div className="max-w-xl mx-auto text-center py-20 space-y-3">
        <p className="text-4xl">🕐</p>
        <p className="font-semibold text-cz-2">Deadline Day er kun aktivt når transfervinduet lukker</p>
        <p className="text-sm text-cz-3">Vender tilbage når transfervinduet nærmer sig lukketid</p>
      </div>
    );
  }

  const critical = squads?.filter(t => t.status === "critical") ?? [];
  const warning  = squads?.filter(t => t.status === "warning")  ?? [];
  const ok       = squads?.filter(t => t.status === "ok")       ?? [];
  const totalShown = critical.length + warning.length + ok.length;

  return (
    <div className="max-w-3xl mx-auto space-y-6" aria-live="polite" aria-busy={loading}>
      <div>
        <h1 className="text-xl font-bold text-cz-1 tracking-tight">Deadline Day</h1>
        <p className="text-sm text-cz-3 mt-0.5">
          Alle holds truppestørrelse vs. divisions-minimum. Opdateres hvert 30. sekund.
        </p>
      </div>

      {totalShown === 0 && (
        <div className="rounded-xl border border-cz-border p-6 text-center">
          <p className="text-2xl mb-2">✅</p>
          <p className="font-semibold text-cz-2">Alle hold er over minimum</p>
          <p className="text-sm text-cz-3 mt-1">Ingen handling påkrævet</p>
        </div>
      )}

      {critical.length > 0 && (
        <section className="space-y-2">
          <h2 id="dd-critical-heading" className="text-[10px] font-bold tracking-[0.15em] uppercase text-cz-danger">
            Under minimum, {critical.length} hold
          </h2>
          <SquadTable rows={critical} captionId="dd-critical-heading" />
        </section>
      )}

      {warning.length > 0 && (
        <section className="space-y-2">
          <h2 id="dd-warning-heading" className="text-[10px] font-bold tracking-[0.15em] uppercase text-cz-warning">
            Tæt på minimum, {warning.length} hold
          </h2>
          <SquadTable rows={warning} captionId="dd-warning-heading" />
        </section>
      )}

      {ok.length > 0 && (
        <section className="space-y-2">
          <h2 id="dd-ok-heading" className="text-[10px] font-bold tracking-[0.15em] uppercase text-cz-3">
            OK, {ok.length} hold
          </h2>
          <SquadTable rows={ok} dimmed captionId="dd-ok-heading" />
        </section>
      )}
    </div>
  );
}
