import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const WINDOW_OPTIONS = [
  { value: "24h",    label: "24 timer" },
  { value: "7d",     label: "7 dage" },
  { value: "30d",    label: "30 dage" },
  { value: "sprint", label: "Sprint (18 maj →)" },
];

const REFRESH_MS = 5 * 60 * 1000; // AC: refresh max hver 5 min

const TOOLTIPS = {
  total:    "Antal registrerede users i auth.users (alle tider).",
  dau:      "Daily Active Users: distinct users med last_seen ELLER player_event-aktivitet i sidste 24t. Trend = sammenligning med 7 dage tilbage (24t-vindue 7-8 dage siden).",
  wau:      "Weekly Active Users: distinct users aktive i sidste 7 dage. Trend = aktive 7-14 dage siden.",
  mau:      "Monthly Active Users: distinct users aktive i sidste 30 dage. Trend = aktive 30-60 dage siden.",
  d7:       "D7 retention: % af users registreret for 7+ dage siden som har aktivitet i sidste 7 dage. Trend = samme kohorte forskudt 7 dage tilbage.",
  cohort:   "Signup-kohorte-retention (#1168): kohorte = signup-uge. D1/D3/D7 = % af kohorten hvis seneste aktivitet (last_seen eller event) ligger mindst 1/3/7 dage efter signup (rolling retention). Kohorter yngre end N dage vises '—' (endnu ikke målbart). Kerne-metrik til go/no-go i Tourens 1. uge.",
  session:  "Gennemsnitlig session-længde (sekunder) over sidste 7 dage. Per user-day, defineret som max(event_time) − min(event_time) når brugeren har 2+ events samme UTC-dag. Trend = forrige 7-dages-periode.",
  active:   "Distinct users aktive (last_seen eller player_event) inden for valgt tidsvindue. Reagerer på tids-vælgeren.",
  features: "Top 5 frontend-features målt via player_events (event_name LIKE 'feature_%') inden for valgt tidsvindue. Konvention dokumenteret i frontend/src/lib/logEvent.js KNOWN_EVENTS.",
};

function fmtNumber(n) {
  if (n == null) return "—";
  return new Intl.NumberFormat("da-DK").format(n);
}

function fmtPct(n) {
  if (n == null) return "—";
  return `${n}%`;
}

function fmtDuration(secs) {
  if (secs == null || secs === 0) return "—";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}t ${m % 60}m`;
}

function fmtCohortCell(pct, returned, eligible) {
  // pct === null → kohorten er endnu ikke gammel nok til at +Nd kan måles.
  if (pct == null) {
    return <span className="text-cz-3" title="Endnu ikke målbart — kohorten er yngre end N dage.">—</span>;
  }
  return (
    <span className="text-cz-1">
      {pct}%
      <span className="text-cz-3 text-xs ms-1">({returned}/{eligible})</span>
    </span>
  );
}

function fmtDelta(curr, prev, formatter) {
  if (curr == null || prev == null) return { text: "—", dir: "flat" };
  const delta = curr - prev;
  if (delta === 0) return { text: "→ ±0", dir: "flat" };
  const arrow = delta > 0 ? "▲" : "▼";
  const sign  = delta > 0 ? "+" : "";
  return { text: `${arrow} ${sign}${formatter(Math.abs(delta))}`, dir: delta > 0 ? "up" : "down" };
}

function csvCell(value) {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(metrics) {
  // Format matcher SPRINT_DASHBOARD.md "Game-metrics"-tabel: Metric | Nu | Trend (7d) | Note
  const rows = [
    ["Metric", "Nu", "Trend (7d)", "Note"],
    ["Total registered players", metrics.total_registered, "—", "auth.users count"],
    ["Daily active players (DAU)", metrics.dau, `${metrics.dau} vs ${metrics.dau_prev}`, "Distinct users m. last_seen/event sidste 24t"],
    ["Weekly active players (WAU)", metrics.wau, `${metrics.wau} vs ${metrics.wau_prev}`, "Distinct users sidste 7d"],
    ["Monthly active players (MAU)", metrics.mau, `${metrics.mau} vs ${metrics.mau_prev}`, "Distinct users sidste 30d"],
    ["Returning testers (D7)", metrics.d7_retention_pct == null ? "—" : `${metrics.d7_retention_pct}%`, metrics.d7_retention_prev_pct == null ? "—" : `${metrics.d7_retention_pct}% vs ${metrics.d7_retention_prev_pct}%`, `${metrics.d7_returning}/${metrics.d7_eligible} eligible`],
    ["Avg session length", `${metrics.avg_session_secs}s`, `${metrics.avg_session_secs}s vs ${metrics.avg_session_secs_prev}s`, "Per user-day, 2+ events kræves"],
    [`Aktive i vindue (${metrics.window})`, metrics.active_in_window, `${metrics.active_in_window} vs ${metrics.active_in_window_prev}`, "Distinct users i valgt tids-vindue"],
  ];
  for (const f of metrics.top_features || []) {
    rows.push([`Top feature: ${f.name}`, f.count, "—", `event_name '${f.name}' i valgt vindue`]);
  }
  return rows.map(r => r.map(csvCell).join(",")).join("\n");
}

function KpiCard({ label, value, delta, tooltip }) {
  const deltaClass = delta?.dir === "up" ? "text-cz-success" : delta?.dir === "down" ? "text-cz-danger" : "text-cz-3";
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-cz-3 text-xs uppercase tracking-wide">{label}</p>
        {tooltip && (
          <span className="text-cz-3 text-xs cursor-help" title={tooltip}>ⓘ</span>
        )}
      </div>
      <p className="text-cz-1 text-2xl font-bold mt-1">{value}</p>
      {delta && <p className={`text-xs mt-1 ${deltaClass}`}>{delta.text}<span className="text-cz-3 ms-1">vs 7d</span></p>}
    </div>
  );
}

export default function AdminSprintMetricsPage() {
  const [adminStatus, setAdminStatus] = useState("checking"); // checking | admin | not_admin
  const [windowChoice, setWindowChoice] = useState("7d");
  const [metrics, setMetrics] = useState(null);
  const [cohorts, setCohorts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setAdminStatus("not_admin"); return; }
      const { data: userData } = await supabase
        .from("users").select("role").eq("id", session.user.id).single();
      setAdminStatus(userData?.role === "admin" ? "admin" : "not_admin");
    })();
  }, []);

  async function loadMetrics() {
    setLoading(true);
    setError(null);
    const [metricsRes, cohortRes] = await Promise.all([
      supabase.rpc("get_sprint_metrics", { p_window: windowChoice }),
      supabase.rpc("get_cohort_retention", { p_weeks: 8 }),
    ]);
    if (metricsRes.error) {
      setError(metricsRes.error.message);
    } else {
      setMetrics(metricsRes.data);
      setLastFetched(new Date());
    }
    // Kohorte-retention er uafhængig af tids-vælgeren; en fejl her må ikke skjule hoved-KPI'erne.
    if (!cohortRes.error) {
      setCohorts(cohortRes.data?.cohorts ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (adminStatus !== "admin") return;
    loadMetrics();
    const id = setInterval(loadMetrics, REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminStatus, windowChoice]);

  const kpis = useMemo(() => {
    if (!metrics) return null;
    return {
      total:   { value: fmtNumber(metrics.total_registered), delta: null },
      dau:     { value: fmtNumber(metrics.dau), delta: fmtDelta(metrics.dau, metrics.dau_prev, fmtNumber) },
      wau:     { value: fmtNumber(metrics.wau), delta: fmtDelta(metrics.wau, metrics.wau_prev, fmtNumber) },
      mau:     { value: fmtNumber(metrics.mau), delta: fmtDelta(metrics.mau, metrics.mau_prev, fmtNumber) },
      d7:      {
        value: fmtPct(metrics.d7_retention_pct),
        delta: metrics.d7_retention_pct == null || metrics.d7_retention_prev_pct == null
          ? null
          : fmtDelta(metrics.d7_retention_pct, metrics.d7_retention_prev_pct, n => `${n}pp`),
      },
      session: { value: fmtDuration(metrics.avg_session_secs), delta: fmtDelta(metrics.avg_session_secs, metrics.avg_session_secs_prev, fmtDuration) },
      active:  { value: fmtNumber(metrics.active_in_window), delta: fmtDelta(metrics.active_in_window, metrics.active_in_window_prev, fmtNumber) },
    };
  }, [metrics]);

  function handleExportCsv() {
    if (!metrics) return;
    const csv = buildCsv(metrics);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 16).replace(":", "-");
    a.download = `sprint-metrics-${windowChoice}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (adminStatus === "checking") {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (adminStatus === "not_admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/admin" className="text-cz-3 text-xs hover:text-cz-1">← Admin</Link>
          <h1 className="text-cz-1 text-xl font-bold mt-1">Sprint-metrics</h1>
          <p className="text-cz-3 text-sm">
            Live DAU/WAU/MAU/D7/session-length + top-features. Refs sprint-validation #365.
            {lastFetched && <span className="ms-2">· Sidst opdateret {lastFetched.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} (auto-refresh hver 5 min)</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={windowChoice}
            onChange={e => setWindowChoice(e.target.value)}
            className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent"
          >
            {WINDOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            onClick={loadMetrics}
            disabled={loading}
            className="px-3 py-2 bg-cz-subtle border border-cz-border rounded-lg text-cz-1 text-sm hover:bg-cz-card disabled:opacity-50"
          >
            {loading ? "Henter..." : "↻ Genindlæs"}
          </button>
          <button
            onClick={handleExportCsv}
            disabled={!metrics}
            className="px-3 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50"
          >
            ⬇ CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-cz-danger-bg0/20 border border-cz-danger/30 text-cz-danger rounded-lg p-3 text-sm">
          ❌ {error === "forbidden" ? "403 — du er ikke admin." : error}
        </div>
      )}

      {!metrics && loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-7 h-7 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {kpis && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <KpiCard label="Total registered"      value={kpis.total.value}   delta={kpis.total.delta}   tooltip={TOOLTIPS.total} />
            <KpiCard label="DAU (24t)"             value={kpis.dau.value}     delta={kpis.dau.delta}     tooltip={TOOLTIPS.dau} />
            <KpiCard label="WAU (7d)"              value={kpis.wau.value}     delta={kpis.wau.delta}     tooltip={TOOLTIPS.wau} />
            <KpiCard label="MAU (30d)"             value={kpis.mau.value}     delta={kpis.mau.delta}     tooltip={TOOLTIPS.mau} />
            <KpiCard label="D7 retention"          value={kpis.d7.value}      delta={kpis.d7.delta}      tooltip={TOOLTIPS.d7} />
            <KpiCard label="Avg session (7d)"      value={kpis.session.value} delta={kpis.session.delta} tooltip={TOOLTIPS.session} />
            <KpiCard label={`Aktive i ${windowChoice}`} value={kpis.active.value}  delta={kpis.active.delta}  tooltip={TOOLTIPS.active} />
          </div>

          <div className="bg-cz-card border border-cz-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-cz-3 text-xs uppercase tracking-wide">Top 5 features ({windowChoice})</p>
              <span className="text-cz-3 text-xs cursor-help" title={TOOLTIPS.features}>ⓘ</span>
            </div>
            {(metrics.top_features || []).length === 0 ? (
              <p className="text-cz-3 text-sm">Ingen feature-events i valgt vindue endnu. Tilføj instrumentering via <code className="text-cz-1">logEvent(&quot;feature_xxx_yyy&quot;)</code>.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-cz-3 text-xs uppercase">
                  <tr>
                    <th className="text-left py-1">Event</th>
                    <th className="text-right py-1">Antal</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.top_features.map(f => (
                    <tr key={f.name} className="border-t border-cz-border">
                      <td className="py-1.5 text-cz-1 font-mono text-xs">{f.name}</td>
                      <td className="py-1.5 text-cz-1 text-right">{fmtNumber(f.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-cz-card border border-cz-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-cz-3 text-xs uppercase tracking-wide">Signup-kohorte-retention (go/no-go · #1168)</p>
              <span className="text-cz-3 text-xs cursor-help" title={TOOLTIPS.cohort}>ⓘ</span>
            </div>
            {!cohorts ? (
              <p className="text-cz-3 text-sm">Henter…</p>
            ) : cohorts.length === 0 ? (
              <p className="text-cz-3 text-sm">Ingen signups i de seneste 8 uger.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-cz-3 text-xs uppercase">
                  <tr>
                    <th className="text-left py-1">Signup-uge</th>
                    <th className="text-right py-1">Kohorte</th>
                    <th className="text-right py-1">D1</th>
                    <th className="text-right py-1">D3</th>
                    <th className="text-right py-1">D7</th>
                  </tr>
                </thead>
                <tbody>
                  {cohorts.map(c => (
                    <tr key={c.cohort_week} className="border-t border-cz-border">
                      <td className="py-1.5 text-cz-1 font-mono text-xs">{c.cohort_week}</td>
                      <td className="py-1.5 text-cz-1 text-right">{fmtNumber(c.cohort_size)}</td>
                      <td className="py-1.5 text-right">{fmtCohortCell(c.d1_pct, c.d1_returned, c.d1_eligible)}</td>
                      <td className="py-1.5 text-right">{fmtCohortCell(c.d3_pct, c.d3_returned, c.d3_eligible)}</td>
                      <td className="py-1.5 text-right">{fmtCohortCell(c.d7_pct, c.d7_returned, c.d7_eligible)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-cz-card border border-cz-border rounded-xl p-4">
            <p className="text-cz-3 text-xs uppercase tracking-wide mb-2">Hvordan opdaterer jeg SPRINT_DASHBOARD.md?</p>
            <ol className="text-cz-1 text-sm space-y-1 list-decimal list-inside">
              <li>Vælg vindue ovenfor (typisk &quot;7 dage&quot; for ugentlig sprint-update).</li>
              <li>Klik <span className="text-cz-accent font-bold">⬇ CSV</span>.</li>
              <li>Åbn <code>docs/SPRINT_DASHBOARD.md</code> &quot;Game-metrics&quot;-tabellen og overskriv &quot;Nu&quot; + &quot;Trend (7d)&quot;-kolonnerne med tal fra CSV.</li>
              <li>Commit med <code>Refs #365</code>.</li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
