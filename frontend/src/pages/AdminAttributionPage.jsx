import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAdminAuth, readAdminJson, adminErrorMessage } from "../components/admin/shared/useAdminAuth";
import Card from "../components/ui/Card";
import { Table, Tr, Th, Td } from "../components/ui/Table";

// Signup-attribution dashboard (#679). The signup_attribution table is
// service_role-only (RLS, no policies), so this page can't read Supabase
// directly like the older admin pages — it goes through GET /api/admin/attribution
// which joins the team name and returns channel aggregates over all signups.
const API = import.meta.env.VITE_API_URL;

const LIMIT_OPTIONS = [50, 100, 250, 500];

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("da-DK")} ${d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}`;
}

function pct(num, denom) {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function csvCell(value) {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(rows) {
  const headers = [
    "signed_up_at", "team_name", "manager_name", "division",
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "referrer", "landing_path", "first_seen_at", "user_id",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map(h => csvCell(r[h])).join(","));
  return lines.join("\n");
}

function KpiCard({ label, value, sub }) {
  return (
    <Card className="p-4">
      <p className="text-cz-3 text-xs uppercase tracking-wide">{label}</p>
      <p className="text-cz-1 text-2xl font-bold mt-1 truncate" title={typeof value === "string" ? value : undefined}>
        {value}
      </p>
      {sub && <p className="text-cz-3 text-xs mt-1">{sub}</p>}
    </Card>
  );
}

function BreakdownCard({ title, items, total, max = 12 }) {
  const shown = items.slice(0, max);
  const hidden = items.length - shown.length;
  return (
    <Card className="p-4">
      <p className="text-cz-3 text-xs uppercase tracking-wide mb-3">{title}</p>
      {items.length === 0 ? (
        <p className="text-cz-3 text-sm">Ingen data endnu.</p>
      ) : (
        <>
          <Table>
            <thead>
              <Tr>
                <Th>Kanal</Th>
                <Th numeric>Signups</Th>
                <Th numeric>Andel</Th>
              </Tr>
            </thead>
            <tbody>
              {shown.map(it => (
                <Tr key={it.key}>
                  <Td className="max-w-[220px] truncate" title={it.key}>{it.key}</Td>
                  <Td numeric>{it.count}</Td>
                  <Td numeric>{pct(it.count, total)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {hidden > 0 && (
            <p className="text-cz-3 text-xs mt-2">+{hidden} flere kanaler (med i CSV)</p>
          )}
        </>
      )}
    </Card>
  );
}

export default function AdminAttributionPage() {
  const { getAuth } = useAdminAuth();
  const [adminStatus, setAdminStatus] = useState("checking"); // checking | admin | not_admin
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState(100);

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
      const res = await fetch(`${API}/api/admin/attribution?limit=${limit}`, {
        headers: await getAuth(),
      });
      const json = await readAdminJson(res);
      if (res.ok) setData(json);
      else setError(adminErrorMessage(json, res));
    } catch (e) {
      setError(e.message || "Forbindelsen fejlede");
    } finally {
      setLoading(false);
    }
  }, [getAuth, limit]);

  useEffect(() => {
    if (adminStatus === "admin") loadData();
  }, [adminStatus, loadData]);

  const rows = data?.rows ?? [];
  const aggregates = data?.aggregates ?? { total: 0, by_source: [], by_medium: [], by_referrer: [] };
  const total = data?.total ?? 0;
  const topSource = aggregates.by_source[0];
  const topMedium = aggregates.by_medium[0];
  const topReferrer = aggregates.by_referrer[0];

  function handleExportCsv() {
    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `signup-attribution-${stamp}.csv`;
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
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/admin" className="text-cz-3 text-xs hover:text-cz-1">← Admin</Link>
          <h1 className="text-cz-1 text-xl font-bold mt-1">Signup-attribution</h1>
          <p className="text-cz-3 text-sm">
            First-touch acquisition pr. ny bruger — hvilken kanal de kom fra. Refs #679.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent"
          >
            {LIMIT_OPTIONS.map(n => <option key={n} value={n}>Seneste {n}</option>)}
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
            disabled={!rows.length}
            className="px-3 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50"
          >
            Eksportér CSV ({rows.length})
          </button>
        </div>
      </div>

      {error && (
        <Card className="p-3 border-cz-danger/30">
          <p className="text-cz-danger text-sm">{error === "Admin only" ? "403 — du er ikke admin." : error}</p>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Signups i alt" value={total} />
        <KpiCard
          label="Top kilde"
          value={topSource ? topSource.key : "—"}
          sub={topSource ? `${topSource.count} (${pct(topSource.count, total)})` : undefined}
        />
        <KpiCard
          label="Top medium"
          value={topMedium ? topMedium.key : "—"}
          sub={topMedium ? `${topMedium.count} (${pct(topMedium.count, total)})` : undefined}
        />
        <KpiCard
          label="Top referrer"
          value={topReferrer ? topReferrer.key : "—"}
          sub={topReferrer ? `${topReferrer.count} (${pct(topReferrer.count, total)})` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <BreakdownCard title="Pr. kilde (utm_source)" items={aggregates.by_source} total={total} />
        <BreakdownCard title="Pr. medium (utm_medium)" items={aggregates.by_medium} total={total} />
        <BreakdownCard title="Pr. referrer (host)" items={aggregates.by_referrer} total={total} />
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-cz-border flex items-baseline justify-between gap-2">
          <p className="text-cz-3 text-xs uppercase tracking-wide">Seneste signups</p>
          <p className="text-cz-3 text-xs">Viser {rows.length} af {total}</p>
        </div>
        <Table>
          <thead>
            <Tr>
              <Th>Tilmeldt</Th>
              <Th>Hold</Th>
              <Th>Kilde</Th>
              <Th>Medium</Th>
              <Th>Kampagne</Th>
              <Th>Referrer</Th>
              <Th>Landing</Th>
            </Tr>
          </thead>
          <tbody>
            {loading && (
              <Tr><Td colSpan={7} className="text-center text-cz-3 py-8">Henter...</Td></Tr>
            )}
            {!loading && rows.length === 0 && (
              <Tr><Td colSpan={7} className="text-center text-cz-3 py-8">Ingen signups registreret endnu.</Td></Tr>
            )}
            {!loading && rows.map(r => (
              <Tr key={r.user_id}>
                <Td className="whitespace-nowrap text-cz-3 text-xs">{formatDate(r.signed_up_at)}</Td>
                <Td className="max-w-[180px] truncate" title={r.team_name || ""}>{r.team_name || "—"}</Td>
                <Td>{r.utm_source || "(direct)"}</Td>
                <Td>{r.utm_medium || "(none)"}</Td>
                <Td className="max-w-[140px] truncate" title={r.utm_campaign || ""}>{r.utm_campaign || "—"}</Td>
                <Td className="max-w-[200px] truncate" title={r.referrer || ""}>{r.referrer || "—"}</Td>
                <Td className="max-w-[160px] truncate" title={r.landing_path || ""}>{r.landing_path || "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
