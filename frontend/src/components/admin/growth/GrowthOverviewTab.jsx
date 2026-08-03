import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useAdminAuth, readAdminJson, adminErrorMessage } from "../shared/useAdminAuth";
import Card from "../../ui/Card";
import Button from "../../ui/Button";
import Select from "../../ui/Select";
import EmptyState from "../../ui/EmptyState";
import ErrorState from "../../ui/ErrorState";
import { SkeletonLines } from "../../ui/Skeleton";
import { RefreshIcon, InfoIcon } from "../../ui/icons";
import { CHART_PALETTE } from "../../../lib/chartPalette";
import TrendLineChart from "./TrendLineChart";

// Overview-fanen i det samlede vækst-dashboard (#3196, ejer-direktiv 31/7):
// "Jeg vil gerne have grafer over antallet af daglige brugere, ugentlige
// brugere og månedlige brugere ... Det er langt mere brugbart for mig at se
// hvad vores d1, d7 og d30 er, hvis jeg kan se de tal bevæge sig ... og hvis
// jeg kan se det i større perioder, end kun henover en uge."
//
// Datakilde: GET /api/admin/growth/snapshots (growth_metric_snapshots,
// skrevet dagligt af backend/cron.js runGrowthSnapshotCron). Tabellen er TOM
// indtil migrationen er kørt + cron'en/backfill-scriptet har kørt mindst én
// gang — falder da YNDEFULDT tilbage til get_sprint_metrics (samme RPC som
// den tidligere sprint-metrics-fane, kaldt direkte som authenticated — den er
// admin-selv-gatet, se database/2026-08-03-growth-snapshots-3196.sql §2) for
// at vise DAGENS tal, med en tydelig "ingen historik endnu"-note.
const API = import.meta.env.VITE_API_URL;

const PERIOD_OPTIONS = [
  { value: 7, label: "7 dage" },
  { value: 30, label: "30 dage" },
  { value: 90, label: "90 dage" },
];

function fmtNumber(n) {
  if (n == null) return "—";
  return new Intl.NumberFormat("da-DK").format(n);
}

function fmtPct(n) {
  if (n == null) return "—";
  return `${n}%`;
}

function fmtCents(cents) {
  if (cents == null) return "—";
  return `${new Intl.NumberFormat("da-DK").format(Math.round(cents / 100))} kr`;
}

function KpiCard({ label, value, sub, tooltip }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-cz-3 text-xs uppercase tracking-wide">{label}</p>
        {tooltip && (
          <span title={tooltip} className="cursor-help text-cz-3">
            <InfoIcon size={14} aria-hidden="true" />
          </span>
        )}
      </div>
      <p className="text-cz-1 text-2xl font-bold font-data tabular-nums mt-1">{value}</p>
      {sub && <p className="text-cz-3 text-xs mt-1">{sub}</p>}
    </Card>
  );
}

export default function GrowthOverviewTab() {
  const { getAuth } = useAdminAuth();
  const [days, setDays] = useState(30);
  const [snapshots, setSnapshots] = useState(null);
  const [fallback, setFallback] = useState(null); // ad hoc get_sprint_metrics når snapshots er tom
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await getAuth();
      const res = await fetch(`${API}/api/admin/growth/snapshots?days=${days}`, { headers: auth });
      const json = await readAdminJson(res);
      if (!res.ok) {
        setError(adminErrorMessage(json, res));
        return;
      }
      setSnapshots(json.snapshots || []);

      if (!json.snapshots || json.snapshots.length === 0) {
        // Ingen historik endnu — vis dagens ad hoc-tal (samme RPC som den
        // tidligere Sprint-metrics-fane bruger direkte, admin-selv-gatet).
        const { data: metricsData, error: rpcErr } = await supabase.rpc("get_sprint_metrics", { p_window: "7d" });
        if (!rpcErr) setFallback(metricsData);
      } else {
        setFallback(null);
      }
    } catch (e) {
      setError(e.message || "Forbindelsen fejlede");
    } finally {
      setLoading(false);
    }
  }, [getAuth, days]);

  useEffect(() => { loadData(); }, [loadData]);

  const hasHistory = (snapshots || []).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-cz-3 text-sm">
          DAU/WAU/MAU + D1/D7/D30-retention over tid. Refs #3196.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <Select size="sm" value={days} onChange={e => setDays(Number(e.target.value))}>
            {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadData}
            loading={loading}
            iconLeft={<RefreshIcon size={14} aria-hidden="true" />}
          >
            Genindlæs
          </Button>
        </div>
      </div>

      {error && (
        <ErrorState
          title="Kunne ikke hente vækst-historik"
          description={error === "Admin only" ? "403 — du er ikke admin." : error}
          action={<Button variant="secondary" size="sm" onClick={loadData}>Prøv igen</Button>}
        />
      )}

      {!error && loading && !snapshots && (
        <Card className="p-4"><SkeletonLines lines={6} /></Card>
      )}

      {!error && !hasHistory && !loading && (
        <Card className="p-4">
          <EmptyState
            title="Ingen historik endnu"
            description="Dagligt snapshot starter når migrationen er kørt og cron'en/backfill-scriptet har kørt mindst én gang. Nedenfor vises dagens tal beregnet ad hoc i mellemtiden."
          />
        </Card>
      )}

      {!error && !hasHistory && fallback && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Total registered" value={fmtNumber(fallback.total_registered)} />
          <KpiCard label="DAU (24t)" value={fmtNumber(fallback.dau)} />
          <KpiCard label="WAU (7d)" value={fmtNumber(fallback.wau)} />
          <KpiCard label="MAU (30d)" value={fmtNumber(fallback.mau)} />
          <KpiCard label="D7 retention" value={fmtPct(fallback.d7_retention_pct)} />
        </div>
      )}

      {!error && hasHistory && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="DAU (seneste)" value={fmtNumber(snapshots.at(-1)?.dau)} />
            <KpiCard label="WAU (seneste)" value={fmtNumber(snapshots.at(-1)?.wau)} />
            <KpiCard label="MAU (seneste)" value={fmtNumber(snapshots.at(-1)?.mau)} />
            <KpiCard label="D7 retention (seneste)" value={fmtPct(snapshots.at(-1)?.d7_retention_pct)} />
          </div>

          <Card className="p-4">
            <p className="text-cz-3 text-xs uppercase tracking-wide mb-3">Daglige/ugentlige/månedlige aktive brugere</p>
            <TrendLineChart
              data={snapshots}
              lines={[
                { key: "dau", label: "DAU", color: CHART_PALETTE[0] },
                { key: "wau", label: "WAU", color: CHART_PALETTE[1] },
                { key: "mau", label: "MAU", color: CHART_PALETTE[2] },
              ]}
            />
          </Card>

          <Card className="p-4">
            <p className="text-cz-3 text-xs uppercase tracking-wide mb-3">D1/D7/D30-retention (rullende)</p>
            <TrendLineChart
              data={snapshots}
              lines={[
                { key: "d1_retention_pct", label: "D1", color: CHART_PALETTE[3] },
                { key: "d7_retention_pct", label: "D7", color: CHART_PALETTE[4] },
                { key: "d30_retention_pct", label: "D30", color: CHART_PALETTE[5] },
              ]}
              yFormatter={v => `${v}%`}
            />
          </Card>

          <Card className="p-4">
            <p className="text-cz-3 text-xs uppercase tracking-wide mb-3">Abonnementer + LTV (estimeret) over tid</p>
            <TrendLineChart
              data={snapshots}
              lines={[
                { key: "active_subscriptions", label: "Aktive abonnementer", color: CHART_PALETTE[6] },
              ]}
            />
            <p className="text-cz-3 text-xs mt-2">
              LTV-total (seneste): {fmtCents(snapshots.at(-1)?.ltv_total_cents)} · gennemsnit pr. kunde: {fmtCents(snapshots.at(-1)?.ltv_avg_cents)}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
