import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

const STATUS = {
  critical: { label: "Under min",  cls: "text-red-400",    dot: "bg-red-400" },
  warning:  { label: "Tæt på min", cls: "text-cz-warning", dot: "bg-yellow-400" },
  ok:       { label: "OK",         cls: "text-green-400",  dot: "bg-green-400" },
};

function SquadTable({ rows, dimmed }) {
  return (
    <div className={`rounded-xl border border-white/8 overflow-hidden${dimmed ? " opacity-50" : ""}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/8 text-[10px] text-white/30 uppercase tracking-wider">
            <th className="px-4 py-2 text-left font-medium">Hold</th>
            <th className="px-4 py-2 text-center font-medium">Div</th>
            <th className="px-4 py-2 text-center font-medium">Ryttere</th>
            <th className="px-4 py-2 text-center font-medium">Min</th>
            <th className="px-4 py-2 text-center font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const { label, cls, dot } = STATUS[t.status] || STATUS.ok;
            return (
              <tr key={t.id} className={`border-b border-white/5 last:border-0${i % 2 === 0 ? " bg-cz-card/[0.02]" : ""}`}>
                <td className="px-4 py-3 font-medium text-white">
                  <Link to={`/teams/${t.id}`} className="hover:text-cz-accent transition-colors">
                    {t.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-center text-white/40">D{t.division}</td>
                <td className="px-4 py-3 text-center font-mono font-bold text-white">{t.riders}</td>
                <td className="px-4 py-3 text-center text-white/40">{t.min}</td>
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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { if (!cancelled) setLoading(false); return; }

      const headers = { Authorization: `Bearer ${token}` };
      const [statusRes, squadsRes] = await Promise.all([
        fetch(`${API}/api/deadline-day/status`, { headers }),
        fetch(`${API}/api/deadline-day/squads`, { headers }),
      ]);
      if (cancelled) return;
      if (statusRes.ok) setDdActive((await statusRes.json()).active);
      if (squadsRes.ok) setSquads(await squadsRes.json());
      setLoading(false);
    }

    load();
    const iv = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!ddActive) {
    return (
      <div className="max-w-xl mx-auto text-center py-20 space-y-3">
        <p className="text-4xl">🕐</p>
        <p className="font-semibold text-white/60">Panic Board er kun aktivt under Deadline Day</p>
        <p className="text-sm text-white/30">Vender tilbage når transfervinduet nærmer sig lukketid</p>
      </div>
    );
  }

  const critical = squads?.filter(t => t.status === "critical") ?? [];
  const warning  = squads?.filter(t => t.status === "warning")  ?? [];
  const ok       = squads?.filter(t => t.status === "ok")       ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-black text-white tracking-tight">Panic Board</h1>
        <p className="text-sm text-white/40 mt-0.5">
          Alle holds truppestørrelse vs. divisions-minimum — opdateres hvert 30s
        </p>
      </div>

      {critical.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[10px] font-bold tracking-[0.15em] uppercase text-red-400">
            Under minimum — {critical.length} hold
          </h2>
          <SquadTable rows={critical} />
        </section>
      )}

      {warning.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[10px] font-bold tracking-[0.15em] uppercase text-cz-warning">
            Tæt på minimum — {warning.length} hold
          </h2>
          <SquadTable rows={warning} />
        </section>
      )}

      {ok.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/25">
            OK — {ok.length} hold
          </h2>
          <SquadTable rows={ok} dimmed />
        </section>
      )}
    </div>
  );
}
