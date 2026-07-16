import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL;

export default function DeadlineReadinessSection({ getAuth, onMsg }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [dryRunPlan, setDryRunPlan] = useState(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  async function runDryRun() {
    setDryRunLoading(true);
    setDryRunPlan(null);
    try {
      const headers = await getAuth();
      const res = await fetch(`${API}/api/admin/season-transition`, {
        method: "POST",
        headers,
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Dry-run fejlede");
      setDryRunPlan(json);
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setDryRunLoading(false);
    }
  }

  async function fetchReadiness() {
    setLoading(true);
    try {
      const headers = await getAuth();
      const res = await fetch(`${API}/api/admin/deadline-readiness`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Kunne ikke hente readiness");
      setData(json);
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReadiness();
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !data) return <p className="text-cz-3 text-sm">Indlæser…</p>;
  if (!data) return <p className="text-cz-3 text-sm">Ingen data endnu.</p>;

  const { window: win, checks, counts, squad_violations: violations, active_season, upcoming_season } = data;

  const criticalFails = Object.entries(checks).filter(([, c]) => c.critical && !c.ok);
  const softFails = Object.entries(checks).filter(([, c]) => !c.critical && !c.ok);
  const overallStatus = criticalFails.length > 0 ? "critical" : softFails.length > 0 ? "warning" : "ready";

  const closesAtMs = win?.closes_at ? new Date(win.closes_at).getTime() : null;
  const remainingSeconds = closesAtMs ? Math.max(0, Math.floor((closesAtMs - now) / 1000)) : null;
  const remainingLabel = remainingSeconds !== null ? formatRemaining(remainingSeconds) : "—";

  const statusBg =
    overallStatus === "ready" ? "bg-cz-success-bg border-cz-success/30 text-cz-success" :
    overallStatus === "warning" ? "bg-cz-warning-bg border-cz-warning/30 text-cz-warning" :
    "bg-cz-danger-bg border-cz-danger/30 text-cz-danger";

  return (
    <div className="space-y-3">
      {/* Overall status banner */}
      <div className={`rounded-cz p-4 border ${statusBg}`}>
        <div className="flex justify-between items-start">
          <div>
            <p className="font-semibold text-sm">
              {overallStatus === "ready" && "✅ Klar til deadline"}
              {overallStatus === "warning" && "⚠ Soft-fails — kig efter"}
              {overallStatus === "critical" && "🔴 Kritiske mangler"}
            </p>
            {win?.closes_at && (
              <p className="text-xs mt-1">
                Vinduet lukker: {new Date(win.closes_at).toLocaleString("da-DK")} · {remainingLabel} tilbage
              </p>
            )}
            {!win?.closes_at && (
              <p className="text-xs mt-1">
                Lukketid ikke sat — sæt det i Transfervindue-sektionen.
              </p>
            )}
          </div>
          <button onClick={fetchReadiness} disabled={loading}
            className="text-xs px-2 py-1 border border-current rounded hover:opacity-80 disabled:opacity-50">
            {loading ? "..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Checks */}
      <div className="bg-cz-subtle rounded-cz p-4">
        <p className="text-cz-2 font-medium text-sm mb-2">System-tjek</p>
        <ul className="space-y-1.5 text-sm">
          {Object.entries(checks).map(([key, check]) => (
            <li key={key} className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                check.ok ? "bg-cz-success" : check.critical ? "bg-cz-danger" : "bg-cz-warning"
              }`} />
              <span className="text-cz-2">{labelForCheck(key)}</span>
              <span className="text-cz-3 text-xs ms-auto">
                {check.ok ? "✓" : check.critical ? "kritisk fejl" : "advarsel"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Counts */}
      <div className="bg-cz-subtle rounded-cz p-4">
        <p className="text-cz-2 font-medium text-sm mb-2">Aktive markedshandler ved deadline</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          <div className="px-3 py-2 bg-cz-card rounded border border-cz-border">
            <p className="text-cz-3 text-xs">Aktive auktioner</p>
            <p className="text-cz-1 font-medium">{counts.active_auctions}</p>
          </div>
          <div className="px-3 py-2 bg-cz-card rounded border border-cz-border">
            <p className="text-cz-3 text-xs">Pending transfers</p>
            <p className="text-cz-1 font-medium">{counts.pending_transfers}</p>
          </div>
          <div className="px-3 py-2 bg-cz-card rounded border border-cz-border">
            <p className="text-cz-3 text-xs">Window-pending transfers</p>
            <p className="text-cz-1 font-medium">{counts.window_pending_transfers}</p>
          </div>
          <div className="px-3 py-2 bg-cz-card rounded border border-cz-border">
            <p className="text-cz-3 text-xs">Pending swaps</p>
            <p className="text-cz-1 font-medium">{counts.pending_swaps}</p>
          </div>
          <div className="px-3 py-2 bg-cz-card rounded border border-cz-border">
            <p className="text-cz-3 text-xs">Løb i aktiv sæson{active_season ? ` (${active_season.number})` : ""}</p>
            <p className="text-cz-1 font-medium">{counts.active_season_races}</p>
          </div>
          {upcoming_season && (
            <div className="px-3 py-2 bg-cz-card rounded border border-cz-border">
              <p className="text-cz-3 text-xs">Løb i næste sæson ({upcoming_season.number})</p>
              <p className="text-cz-1 font-medium">{counts.upcoming_season_races}</p>
            </div>
          )}
        </div>
      </div>

      {/* Dry-run preview af sæson-skifte */}
      <div className="bg-cz-subtle rounded-cz p-4">
        <div className="flex justify-between items-center mb-2">
          <p className="text-cz-2 font-medium text-sm">Sæson-skifte preview (dry-run)</p>
          <button onClick={runDryRun} disabled={dryRunLoading}
            className="text-xs px-2 py-1 bg-cz-info-bg text-cz-info border border-cz-info/30 rounded hover:brightness-110 disabled:opacity-50">
            {dryRunLoading ? "..." : "🔍 Preview"}
          </button>
        </div>
        {!dryRunPlan && (
          <p className="text-cz-3 text-xs">
            Klik for at se nøjagtigt hvad der vil ske ved næste sæson-skifte: hvilken sæson-UUID oprettes,
            hvor meget sponsor lander på hvert hold, om noget allerede er gjort. Ingen writes.
          </p>
        )}
        {dryRunPlan && dryRunPlan.plan && (
          <div className="space-y-2 text-sm mt-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="px-3 py-2 bg-cz-card rounded border border-cz-border">
                <p className="text-cz-3 text-xs">Fra sæson</p>
                <p className="text-cz-1 font-medium">{dryRunPlan.plan.from_season.number}</p>
              </div>
              <div className="px-3 py-2 bg-cz-card rounded border border-cz-border">
                <p className="text-cz-3 text-xs">Til sæson</p>
                <p className="text-cz-1 font-medium">{dryRunPlan.plan.to_season.number}</p>
              </div>
              <div className="px-3 py-2 bg-cz-card rounded border border-cz-border">
                <p className="text-cz-3 text-xs">Hold påvirket</p>
                <p className="text-cz-1 font-medium">{dryRunPlan.plan.teams_affected}</p>
              </div>
              <div className="px-3 py-2 bg-cz-card rounded border border-cz-border">
                <p className="text-cz-3 text-xs">Sponsor i alt</p>
                <p className="text-cz-1 font-medium">
                  {(dryRunPlan.plan.sponsor_base_total / 1000).toLocaleString("da-DK")}K CZ$
                </p>
              </div>
            </div>
            {dryRunPlan.plan.already_transitioned && (
              <p className="text-cz-warning text-xs">
                ⚠ Til-sæsonen findes allerede i DB. Re-run vil være no-op for det faseskift.
              </p>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-cz-3 text-xs hover:text-cz-1">
                Sponsor breakdown ({dryRunPlan.plan.sponsor_breakdown.length} hold)
              </summary>
              <div className="max-h-48 overflow-y-auto mt-2 border border-cz-border rounded divide-y divide-cz-border">
                {dryRunPlan.plan.sponsor_breakdown.map((row) => (
                  <div key={row.team_id} className="flex justify-between px-2 py-1 text-xs">
                    <span className="text-cz-2">{row.team_name} <span className="text-cz-3">D{row.division}</span></span>
                    <span className="text-cz-1">{(row.sponsor_base / 1000).toLocaleString("da-DK")}K · {row.sponsor_mode}</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>

      {/* Squad violations */}
      {violations.length > 0 && (
        <div className="bg-cz-warning-bg/30 border border-cz-warning/30 rounded-cz p-4">
          <p className="text-cz-2 font-medium text-sm mb-2">
            ⚠ {violations.length} hold udenfor min/max — squad enforcement vil ramme dem
          </p>
          <div className="space-y-1 text-sm">
            {violations.map((v) => (
              <div key={v.team_id} className="flex justify-between items-center px-2 py-1 bg-cz-card rounded">
                <span className="text-cz-1">{v.team_name}</span>
                <span className="text-cz-3 text-xs">
                  D{v.division} · {v.count} ryttere ({v.status === "under_min" ? "<" : ">"} {v.status === "under_min" ? v.min : v.max})
                </span>
              </div>
            ))}
          </div>
          <p className="text-cz-3 text-xs mt-2">
            Under min: auto-køb til 150% × market_value + bøde 100K + 200 fradragspoint pr. afvigende.<br/>
            Over max: auto-salg af senest-erhvervede rytter + samme bøder.
          </p>
        </div>
      )}
    </div>
  );
}

function labelForCheck(key) {
  const labels = {
    closes_at_set: "Lukketid sat på transfervindue",
    window_open: "Transfervindue er åbent",
    active_season_calendar_ready: "Aktiv sæson har løb i kalenderen",
    upcoming_season_calendar_ready: "Næste sæsons kalender klar",
    no_squad_violations: "Ingen hold udenfor D-min/max",
  };
  return labels[key] || key;
}

function formatRemaining(seconds) {
  if (seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}t ${minutes}m`;
  if (hours > 0) return `${hours}t ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
