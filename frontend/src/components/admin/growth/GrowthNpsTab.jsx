import { useCallback, useEffect, useState } from "react";
import { useAdminAuth, readAdminJson, adminErrorMessage } from "../shared/useAdminAuth";
import Card from "../../ui/Card";
import Button from "../../ui/Button";
import { Table, Tr, Th, Td } from "../../ui/Table";
import PageLoader from "../../ui/PageLoader";
import EmptyState from "../../ui/EmptyState";
import ErrorState from "../../ui/ErrorState";
import { RefreshIcon } from "../../ui/icons";
import { CHART_PALETTE } from "../../../lib/chartPalette";
import TrendLineChart from "./TrendLineChart";

// NPS-fanen (#3196, subsumerer #2089): "Vores NPS skal også ind i det område,
// hvor man skal kunne se udviklingen også. Og de enkelte [svar] når der
// kommer nyt ind." Aggregat + score-trend via GET /api/admin/growth/nps
// (nps_responses, service_role — kun sådan kan admin se ALLE svar på tværs af
// brugere, se database/2026-06-25-nps-responses.sql). Trend-kurven henter fra
// GET /api/admin/growth/snapshots (samme datakilde som Overview-fanen).
const API = import.meta.env.VITE_API_URL;

function scoreTone(score) {
  if (score >= 9) return "text-cz-success";
  if (score >= 7) return "text-cz-1";
  return "text-cz-danger";
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("da-DK")} ${d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}`;
}

function KpiCard({ label, value, sub }) {
  return (
    <Card className="p-4">
      <p className="text-cz-3 text-xs uppercase tracking-wide">{label}</p>
      <p className="text-cz-1 text-2xl font-bold font-data tabular-nums mt-1">{value}</p>
      {sub && <p className="text-cz-3 text-xs mt-1">{sub}</p>}
    </Card>
  );
}

export default function GrowthNpsTab() {
  const { getAuth } = useAdminAuth();
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await getAuth();
      const [npsRes, trendRes] = await Promise.all([
        fetch(`${API}/api/admin/growth/nps?limit=200`, { headers: auth }),
        fetch(`${API}/api/admin/growth/snapshots?days=90`, { headers: auth }),
      ]);
      const npsJson = await readAdminJson(npsRes);
      if (npsRes.ok) setData(npsJson);
      else setError(adminErrorMessage(npsJson, npsRes));
      if (trendRes.ok) setTrend(await readAdminJson(trendRes));
    } catch (e) {
      setError(e.message || "Forbindelsen fejlede");
    } finally {
      setLoading(false);
    }
  }, [getAuth]);

  useEffect(() => { loadData(); }, [loadData]);

  const summary = data?.summary ?? { n: 0, score: null, average: null, promoters: 0, passives: 0, detractors: 0 };
  const responses = data?.responses ?? [];
  const snapshots = (trend?.snapshots ?? []).filter(s => s.nps_response_count > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-cz-3 text-sm">
          Net Promoter Score: udvikling + enkelte nye svar. Subsumerer #2089. Refs #940.
        </p>
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

      {error && (
        <ErrorState
          title="Kunne ikke hente NPS-data"
          description={error === "Admin only" ? "403 — du er ikke admin." : error}
          action={<Button variant="secondary" size="sm" onClick={loadData}>Prøv igen</Button>}
        />
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          label="NPS-score"
          value={summary.score ?? "—"}
          sub={summary.n < 30 ? "n < 30 — for tidligt at konkludere" : `n = ${summary.n}`}
        />
        <KpiCard label="Promoters (9-10)" value={summary.promoters} />
        <KpiCard label="Passives (7-8)" value={summary.passives} />
        <KpiCard label="Detractors (0-6)" value={summary.detractors} />
        <KpiCard label="Gennemsnit" value={summary.average ?? "—"} sub={`${summary.n} svar`} />
      </div>

      {snapshots.length >= 2 && (
        <Card className="p-4">
          <p className="text-cz-3 text-xs uppercase tracking-wide mb-3">NPS-score over tid</p>
          <TrendLineChart
            data={snapshots}
            lines={[{ key: "nps_score", label: "NPS", color: CHART_PALETTE[7] }]}
          />
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-cz-border">
          <p className="text-cz-3 text-xs uppercase tracking-wide">Seneste svar, nyeste først</p>
        </div>
        <Table data-sort-exempt="NPS-svar-log, server-ordnet tid desc">
          <thead>
            <Tr>
              <Th>Modtaget</Th>
              <Th>Hold</Th>
              <Th numeric>Score</Th>
              <Th>Begrundelse</Th>
            </Tr>
          </thead>
          <tbody>
            {loading && (
              <Tr>
                <Td colSpan={4} className="py-8">
                  <PageLoader label="Henter svar" minHeight="80px" />
                </Td>
              </Tr>
            )}
            {!loading && responses.length === 0 && (
              <Tr>
                <Td colSpan={4} className="py-4">
                  <EmptyState title="Ingen NPS-svar endnu" description="Svar vises her, når spillere besvarer NPS-prompten." />
                </Td>
              </Tr>
            )}
            {!loading && responses.map(r => (
              <Tr key={r.id}>
                <Td className="text-cz-3 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</Td>
                <Td className="max-w-[160px] truncate" title={r.team_name || ""}>{r.team_name || "—"}</Td>
                <Td numeric className={`font-data tabular-nums font-bold ${scoreTone(r.score)}`}>{r.score}</Td>
                <Td className="max-w-[360px] truncate" title={r.reason || ""}>{r.reason || "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
