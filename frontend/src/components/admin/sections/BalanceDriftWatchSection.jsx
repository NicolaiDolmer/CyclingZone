import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL;

// #2414 — Balance-drift-vagt: 14-dages trend af race v3's dominans/varians-
// metrikker mod ÆGTE prod-resultater (natlig cron persisterer, denne fladen
// læser kun). Grøn = i bånd, gul = nær bånd-grænse, rød = brud, grå = report-
// only (kendt/afventer kalibrering — deltager aldrig i 3-dages-alarmen).

const METRIC_LABELS = {
  favoriteWinRate: "Favorit-win-rate",
  favoritePodiumRate: "Favorit-podium-rate",
  share4PlusSameTeamTop10: "Hold ≥4 i top 10 (andel løb)",
  avgDistinctTeamsTop10: "⌀ distinkte hold i top 10",
  dnfRatePct: "DNF-rate/etape",
  maxRiderWinRate: "Max rytter-win-rate (14d)",
  jourSansSharePct: "Jour-sans-andel (report-only)",
  breakawayWinSharePct: "Udbruds-sejrsandel (report-only)",
};

function formatValue(key, value) {
  if (value == null || Number.isNaN(value)) return "—";
  const pctKeys = ["favoriteWinRate", "favoritePodiumRate", "share4PlusSameTeamTop10", "maxRiderWinRate"];
  if (pctKeys.includes(key)) return `${(value * 100).toFixed(1)}%`;
  if (key === "dnfRatePct" || key === "jourSansSharePct" || key === "breakawayWinSharePct") return `${value.toFixed(2)}%`;
  return value.toFixed(1);
}

function formatBand(band) {
  if (band.reportOnly) return "rapport-only";
  if (band.min != null && band.max != null) return `${band.min}–${band.max}`;
  if (band.max != null) return `≤${band.max}`;
  if (band.min != null) return `≥${band.min}`;
  return "—";
}

const STATUS_DOT = {
  green: "bg-cz-success",
  yellow: "bg-cz-warning",
  red: "bg-cz-danger",
  info: "bg-cz-3",
  "n/a": "bg-cz-border",
};

export default function BalanceDriftWatchSection({ getAuth }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/admin/balance-drift`, { headers: await getAuth() });
        const json = await res.json();
        if (!res.ok) { setError(json.error || "Kunne ikke hente data"); return; }
        setData(json);
      } catch (e) {
        setError(e.message || "Forbindelsen fejlede");
      } finally {
        setLoading(false);
      }
    })();
  }, [getAuth]);

  if (loading) return <p className="text-cz-3 text-sm">Indlæser...</p>;
  if (error) return <p className="text-cz-danger text-sm">❌ {error}</p>;
  if (!data || data.days.length === 0) {
    return <p className="text-cz-3 text-sm">Ingen målinger endnu — jobbet kører natligt (24h-cron, #2414).</p>;
  }

  const metricKeys = Object.keys(METRIC_LABELS);
  const latest = data.days[data.days.length - 1];

  return (
    <div>
      {data.breaches.length > 0 && (
        <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-cz-danger-bg text-cz-danger border border-cz-danger/30">
          ⚠️ {data.breaches.length} bånd har været rødt i 3+ dage i træk:{" "}
          {data.breaches.map(b => `${METRIC_LABELS[b.metric] || b.metric} (${b.days}d siden ${b.since})`).join(" · ")}
        </div>
      )}
      <p className="text-cz-3 text-xs mb-3">
        Seneste måling: {latest.date}. Bånd kopieret fra simulateSeasonDryRun.js DOMINANCE_TARGETS.
        Rapport-only metrikker (grå) alarmerer aldrig.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-sort-exempt="fast metrik-rækkefølge + kronologiske dato-kolonner, ingen sortering giver mening">
          <thead>
            <tr className="text-cz-3 text-left">
              <th className="py-1 pr-3 font-medium">Metrik</th>
              <th className="py-1 pr-3 font-medium">Bånd</th>
              {data.days.map(d => (
                <th key={d.date} className="py-1 px-2 font-medium whitespace-nowrap">{d.date.slice(5)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricKeys.map(key => (
              <tr key={key} className="border-t border-cz-border">
                <td className="py-1.5 pr-3 text-cz-1 whitespace-nowrap">{METRIC_LABELS[key]}</td>
                <td className="py-1.5 pr-3 text-cz-3 whitespace-nowrap">{formatBand(data.bands[key])}</td>
                {data.days.map(d => {
                  const cell = d.statuses?.[key];
                  return (
                    <td key={d.date} className="py-1.5 px-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${STATUS_DOT[cell?.status] || STATUS_DOT["n/a"]}`} />
                        <span className="text-cz-2">{formatValue(key, cell?.value)}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
