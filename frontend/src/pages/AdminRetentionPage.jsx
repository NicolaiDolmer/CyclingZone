import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAdminAuth, readAdminJson, adminErrorMessage } from "../components/admin/shared/useAdminAuth";
import Card from "../components/ui/Card";
import { Table, Tr, Th, Td } from "../components/ui/Table";

// Retention-scorecard v2 (#2360, afløser lukket meta-issue #135). D1/D7/D30 pr.
// signup-uge-kohorte for RIGTIGE managere (AI/bank/frosne/test-hold ekskluderet —
// se backend/lib/retentionScorecard.js). Gater #1279's GO/NO-GO for betalt
// marketing under Touren — tallene skal være korrekte, ikke flotte.
const API = import.meta.env.VITE_API_URL;

const WEEKS_OPTIONS = [4, 8, 12, 26];

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Farveskala: rolling retention < 25% = svag (rød-tint), 25-50% = midt (gul-tint),
// >= 50% = stærk (grøn-tint). Ren data-tæt admin-signal, ingen glow/gradient.
function cellTint(pct) {
  if (pct == null) return "";
  if (pct >= 50) return "bg-cz-success-bg text-cz-success";
  if (pct >= 25) return "bg-cz-warning-bg text-cz-warning";
  return "bg-cz-danger-bg text-cz-danger";
}

function RetentionCell({ pct, returned, eligible }) {
  if (pct == null) {
    return (
      <span className="text-cz-3" title="Endnu ikke målbart — kohorten er yngre end N dage.">—</span>
    );
  }
  return (
    <span className={`inline-block min-w-[64px] rounded-cz px-2 py-1 text-right font-mono text-xs font-bold ${cellTint(pct)}`}>
      {pct}%
      <span className="ms-1 font-normal opacity-70">({returned}/{eligible})</span>
    </span>
  );
}

function csvCell(value) {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(cohorts) {
  const headers = [
    "cohort_week", "cohort_size",
    "d1_pct", "d1_returned", "d1_eligible",
    "d7_pct", "d7_returned", "d7_eligible",
    "d30_pct", "d30_returned", "d30_eligible",
  ];
  const lines = [headers.join(",")];
  for (const c of cohorts) lines.push(headers.map(h => csvCell(c[h])).join(","));
  return lines.join("\n");
}

export default function AdminRetentionPage() {
  const { getAuth } = useAdminAuth();
  const [adminStatus, setAdminStatus] = useState("checking"); // checking | admin | not_admin
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [weeks, setWeeks] = useState(8);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setAdminStatus("not_admin"); return; }
      const { data: userData } = await supabase
        .from("users").select("role").eq("id", session.user.id).single();
      setAdminStatus(userData?.role === "admin" ? "admin" : "not_admin");
    })();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await getAuth();
      const res = await fetch(`${API}/api/admin/retention?weeks=${weeks}`, { headers: auth });
      const json = await readAdminJson(res);
      if (res.ok) setData(json);
      else setError(adminErrorMessage(json, res));
    } catch (e) {
      setError(e.message || "Forbindelsen fejlede");
    } finally {
      setLoading(false);
    }
  }, [getAuth, weeks]);

  useEffect(() => {
    if (adminStatus === "admin") loadData();
  }, [adminStatus, loadData]);

  const cohorts = data?.cohorts ?? [];

  function handleExportCsv() {
    const csv = buildCsv(cohorts);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `retention-scorecard-${stamp}.csv`;
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
  if (adminStatus === "not_admin") return <Navigate to="/dashboard" replace />;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/admin" className="text-cz-3 text-xs hover:text-cz-1">← Admin</Link>
          <h1 className="text-cz-1 text-xl font-bold mt-1">Retention</h1>
          <p className="text-cz-3 text-sm">
            D1/D7/D30 pr. signup-uge-kohorte for rigtige managere (AI/bank/frosne/test-hold ekskluderet).
            Data-fundament til #1279 GO/NO-GO for betalt marketing. Refs #2360, afløser #135.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={weeks}
            onChange={e => setWeeks(Number(e.target.value))}
            className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent"
          >
            {WEEKS_OPTIONS.map(n => <option key={n} value={n}>Seneste {n} uger</option>)}
          </select>
          <button
            onClick={loadData}
            disabled={loading}
            className="px-3 py-2 bg-cz-subtle border border-cz-border rounded-lg text-cz-1 text-sm hover:bg-cz-card disabled:opacity-50"
          >
            {loading ? "Henter..." : "Genindlæs"}
          </button>
          <button
            onClick={handleExportCsv}
            disabled={!cohorts.length}
            className="px-3 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50"
          >
            Eksportér CSV
          </button>
        </div>
      </div>

      {error && (
        <Card className="p-3 border-cz-danger/30">
          <p className="text-cz-danger text-sm">{error === "forbidden" || error === "Admin only" ? "403 — du er ikke admin." : error}</p>
        </Card>
      )}

      <Card className="p-3">
        <p className="text-cz-3 text-xs">
          <span className="font-bold text-cz-2">Aktivitets-definition (rolling):</span> en manager tæller
          &quot;returnerede på +Nd&quot; hvis seneste aktivitet (last_seen eller player_event) ligger mindst N dage efter
          signup — ikke &quot;aktiv præcis på dag N&quot;. Kohorter yngre end N dage vises &quot;—&quot; (endnu ikke målbart, ikke 0%).
          Farve: <span className={`px-1.5 py-0.5 rounded-cz ${cellTint(60)}`}>≥50%</span>{" "}
          <span className={`px-1.5 py-0.5 rounded-cz ${cellTint(30)}`}>25–49%</span>{" "}
          <span className={`px-1.5 py-0.5 rounded-cz ${cellTint(10)}`}>&lt;25%</span>.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-cz-border flex items-baseline justify-between gap-2">
          <p className="text-cz-3 text-xs uppercase tracking-wide">Signup-uge-kohorter</p>
          {data?.generated_at && (
            <p className="text-cz-3 text-xs">Genereret {formatDate(data.generated_at)}</p>
          )}
        </div>
        <Table data-sort-exempt="Kohorte-retention, kronologisk lille tabel">
          <thead>
            <Tr>
              <Th>Signup-uge</Th>
              <Th numeric>Kohorte</Th>
              <Th numeric>D1</Th>
              <Th numeric>D7</Th>
              <Th numeric>D30</Th>
            </Tr>
          </thead>
          <tbody>
            {loading && (
              <Tr><Td colSpan={5} className="text-center text-cz-3 py-8">Henter...</Td></Tr>
            )}
            {!loading && cohorts.length === 0 && (
              <Tr><Td colSpan={5} className="text-center text-cz-3 py-8">Ingen signups i de valgte uger.</Td></Tr>
            )}
            {!loading && cohorts.map(c => (
              <Tr key={c.cohort_week}>
                <Td className="whitespace-nowrap font-mono text-xs">{c.cohort_week}</Td>
                <Td numeric>{c.cohort_size}</Td>
                <Td numeric><RetentionCell pct={c.d1_pct} returned={c.d1_returned} eligible={c.d1_eligible} /></Td>
                <Td numeric><RetentionCell pct={c.d7_pct} returned={c.d7_returned} eligible={c.d7_eligible} /></Td>
                <Td numeric><RetentionCell pct={c.d30_pct} returned={c.d30_returned} eligible={c.d30_eligible} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
