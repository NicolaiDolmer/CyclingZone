import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const INTEREST_LABELS = {
  very: "Meget interesseret",
  maybe: "Måske",
  unsure: "Usikker",
};
const INTEREST_OPTIONS = [
  { value: "", label: "Alle interesseniveauer" },
  { value: "very", label: "Meget interesseret" },
  { value: "maybe", label: "Måske" },
  { value: "unsure", label: "Usikker" },
];

const TIER_LABELS = {
  supporter_monthly: "Supporter (49 DKK/md)",
  supporter_annual: "Supporter (490 DKK/år)",
  pro_analyst_monthly: "Pro Analyst (89 DKK/md)",
  free_only: "Kun gratis",
};
const TIER_OPTIONS = [
  { value: "", label: "Alle tiers" },
  { value: "supporter_monthly", label: "Supporter Månedlig" },
  { value: "supporter_annual", label: "Supporter Årlig" },
  { value: "pro_analyst_monthly", label: "Pro Analyst" },
  { value: "free_only", label: "Kun gratis" },
];
const PAID_TIERS = ["supporter_monthly", "supporter_annual", "pro_analyst_monthly"];

const STATUS_LABELS = {
  new: "Ny",
  contacted: "Kontaktet",
  interviewed: "Interviewet",
  converted: "Konverteret",
  declined: "Afslået",
};
const STATUS_OPTIONS = [
  { value: "", label: "Alle statusser" },
  { value: "new", label: "Ny" },
  { value: "contacted", label: "Kontaktet" },
  { value: "interviewed", label: "Interviewet" },
  { value: "converted", label: "Konverteret" },
  { value: "declined", label: "Afslået" },
];

const SCORE_BUCKET_OPTIONS = [
  { value: "", label: "Alle scores" },
  { value: "high", label: "High (≥4)" },
  { value: "med", label: "Med (2-3)" },
  { value: "low", label: "Low (≤1)" },
];

const INTENT_SCORE_TOOLTIP =
  "Auto-beregnet 1-5 efter Manus-formel: " +
  "interest_level × preferred_tier-vægt + follow_up_consent-bonus. " +
  "very + pro_analyst=4 base, very + supporter=3 base, maybe + paid=2, " +
  "maybe + free_only=1, unsure=1. +1 hvis follow-up-consent.";

function scoreBucket(score) {
  if (score == null) return "low";
  if (score >= 4) return "high";
  if (score >= 2) return "med";
  return "low";
}

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
  const str = Array.isArray(value) ? value.join("|") : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(rows) {
  const headers = [
    "id", "email", "discord_handle", "contact_type",
    "interest_level", "preferred_tier", "main_reason",
    "valued_benefits", "fairness_red_line", "follow_up_consent",
    "country", "source", "utm_campaign", "utm_medium",
    "consent_given_at", "status", "notes",
    "intent_score", "created_at",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map(h => csvCell(r[h])).join(","));
  }
  return lines.join("\n");
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4">
      <p className="text-cz-3 text-xs uppercase tracking-wide">{label}</p>
      <p className="text-cz-1 text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-cz-3 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function SortableHeader({ label, sortKey, currentSort, onSort }) {
  const active = currentSort.key === sortKey;
  const arrow = active ? (currentSort.dir === "asc" ? "▲" : "▼") : "";
  return (
    <th
      className="text-left text-cz-3 text-xs font-medium px-3 py-2 cursor-pointer select-none hover:text-cz-1"
      onClick={() => onSort(sortKey)}
    >
      {label} <span className="text-cz-accent">{arrow}</span>
    </th>
  );
}

export default function AdminWaitlistPage() {
  const [adminStatus, setAdminStatus] = useState("checking"); // checking | admin | not_admin
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filterInterest, setFilterInterest] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterScore, setFilterScore] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [sort, setSort] = useState({ key: "intent_score", dir: "desc" });

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setAdminStatus("not_admin"); return; }
      const { data: userData } = await supabase
        .from("users").select("role").eq("id", session.user.id).single();
      setAdminStatus(userData?.role === "admin" ? "admin" : "not_admin");
    })();
  }, []);

  async function loadRows() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("founder_supporter_waitlist")
      .select("*")
      .order("created_at", { ascending: false });
    if (err) setError(err.message);
    else setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (adminStatus === "admin") loadRows();
  }, [adminStatus]);

  const sourceOptions = useMemo(() => {
    const unique = new Set(rows.map(r => r.source).filter(Boolean));
    return [{ value: "", label: "Alle kilder" }, ...Array.from(unique).sort().map(s => ({ value: s, label: s }))];
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (filterInterest && r.interest_level !== filterInterest) return false;
      if (filterTier && r.preferred_tier !== filterTier) return false;
      if (filterSource && r.source !== filterSource) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (filterScore && scoreBucket(r.intent_score) !== filterScore) return false;
      return true;
    });
  }, [rows, filterInterest, filterTier, filterSource, filterStatus, filterScore]);

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sort.dir === "asc" ? va - vb : vb - va;
      }
      const sa = String(va).toLowerCase();
      const sb = String(vb).toLowerCase();
      return sort.dir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return copy;
  }, [filteredRows, sort]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const highIntent = rows.filter(r => (r.intent_score || 0) >= 4).length;
    const willPay = rows.filter(r => PAID_TIERS.includes(r.preferred_tier)).length;
    const proAnalyst = rows.filter(r => r.preferred_tier === "pro_analyst_monthly").length;
    const sourceCounts = {};
    for (const r of rows) {
      const s = r.source || "(ingen)";
      sourceCounts[s] = (sourceCounts[s] || 0) + 1;
    }
    const topSources = Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { total, highIntent, willPay, proAnalyst, topSources };
  }, [rows]);

  function handleSort(key) {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key, dir: "desc" });
  }

  function handleExportCsv() {
    const csv = buildCsv(sortedRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `founder-waitlist-${stamp}.csv`;
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
          <h1 className="text-cz-1 text-xl font-bold mt-1">Founder waitlist</h1>
          <p className="text-cz-3 text-sm">Intent-scoring + lead-prioritering. Refs sprint-validation #363.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadRows}
            disabled={loading}
            className="px-3 py-2 bg-cz-subtle border border-cz-border rounded-lg text-cz-1 text-sm hover:bg-cz-card disabled:opacity-50"
          >
            {loading ? "Henter..." : "↻ Genindlæs"}
          </button>
          <button
            onClick={handleExportCsv}
            disabled={!sortedRows.length}
            className="px-3 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50"
          >
            ⬇ CSV ({sortedRows.length})
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-cz-danger-bg0/20 border border-cz-danger/30 text-cz-danger rounded-lg p-3 text-sm">
          ❌ {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total signups" value={kpis.total} />
        <KpiCard
          label="High-intent (≥4)"
          value={kpis.highIntent}
          sub={pct(kpis.highIntent, kpis.total)}
        />
        <KpiCard
          label="Vil betale"
          value={pct(kpis.willPay, kpis.total)}
          sub={`${kpis.willPay} af ${kpis.total} valgte betalt tier`}
        />
        <KpiCard
          label="Pro Analyst (89+ DKK)"
          value={pct(kpis.proAnalyst, kpis.total)}
          sub={`${kpis.proAnalyst} af ${kpis.total}`}
        />
        <div className="bg-cz-card border border-cz-border rounded-cz p-4 col-span-2 md:col-span-1">
          <p className="text-cz-3 text-xs uppercase tracking-wide">Top 3 kilder</p>
          {kpis.topSources.length === 0 ? (
            <p className="text-cz-3 text-sm mt-2">Ingen data endnu</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {kpis.topSources.map(([src, count]) => (
                <li key={src} className="text-cz-1 text-sm flex justify-between">
                  <span className="truncate me-2">{src}</span>
                  <span className="text-cz-accent font-bold">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-cz p-4">
        <p className="text-cz-3 text-xs uppercase tracking-wide mb-3">Filtre</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <FilterSelect label="Interesseniveau" value={filterInterest} onChange={setFilterInterest} options={INTEREST_OPTIONS} />
          <FilterSelect label="Tier" value={filterTier} onChange={setFilterTier} options={TIER_OPTIONS} />
          <FilterSelect label="Kilde" value={filterSource} onChange={setFilterSource} options={sourceOptions} />
          <FilterSelect label="Score-bucket" value={filterScore} onChange={setFilterScore} options={SCORE_BUCKET_OPTIONS} />
          <FilterSelect label="Status" value={filterStatus} onChange={setFilterStatus} options={STATUS_OPTIONS} />
        </div>
        <p className="text-cz-3 text-xs mt-3">
          Viser {sortedRows.length} af {rows.length} signups. KPI-kort viser totalen — filtre gælder kun tabellen og CSV.
        </p>
        <p className="text-cz-3 text-xs mt-1 italic">
          Conversion-rate fra survey-respondenter kommer med #364 (kræver krydsreference mellem tabeller).
        </p>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
        <div className="overflow-x-auto">
          <table data-sortable className="w-full text-sm">
            <thead className="bg-cz-subtle border-b border-cz-border">
              <tr>
                <SortableHeader label="Kontakt" sortKey="email" currentSort={sort} onSort={handleSort} />
                <SortableHeader label="Interesse" sortKey="interest_level" currentSort={sort} onSort={handleSort} />
                <SortableHeader label="Tier" sortKey="preferred_tier" currentSort={sort} onSort={handleSort} />
                <th
                  className="text-left text-cz-3 text-xs font-medium px-3 py-2 cursor-pointer select-none hover:text-cz-1"
                  onClick={() => handleSort("intent_score")}
                  title={INTENT_SCORE_TOOLTIP}
                >
                  Score <span className="text-cz-accent">{sort.key === "intent_score" ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                  <span className="text-cz-3 ms-1 cursor-help" title={INTENT_SCORE_TOOLTIP}>ⓘ</span>
                </th>
                <SortableHeader label="Follow-up" sortKey="follow_up_consent" currentSort={sort} onSort={handleSort} />
                <SortableHeader label="Kilde" sortKey="source" currentSort={sort} onSort={handleSort} />
                <SortableHeader label="Status" sortKey="status" currentSort={sort} onSort={handleSort} />
                <SortableHeader label="Oprettet" sortKey="created_at" currentSort={sort} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="text-cz-3 text-sm text-center py-8">Henter...</td></tr>
              )}
              {!loading && sortedRows.length === 0 && (
                <tr><td colSpan={8} className="text-cz-3 text-sm text-center py-8">Ingen signups matcher filtrene.</td></tr>
              )}
              {!loading && sortedRows.map(r => (
                <tr key={r.id} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle/40">
                  <td className="px-3 py-2 text-cz-1">
                    {r.email && <p className="truncate max-w-[200px]" title={r.email}>{r.email}</p>}
                    {r.discord_handle && <p className="text-cz-3 text-xs truncate max-w-[200px]" title={r.discord_handle}>@{r.discord_handle}</p>}
                  </td>
                  <td className="px-3 py-2 text-cz-1">{INTEREST_LABELS[r.interest_level] || r.interest_level}</td>
                  <td className="px-3 py-2 text-cz-1 whitespace-nowrap">{TIER_LABELS[r.preferred_tier] || r.preferred_tier}</td>
                  <td className="px-3 py-2 text-cz-1 font-bold" title={INTENT_SCORE_TOOLTIP}>
                    <span className={
                      (r.intent_score || 0) >= 4 ? "text-cz-success" :
                      (r.intent_score || 0) >= 2 ? "text-cz-1" : "text-cz-3"
                    }>{r.intent_score ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2 text-cz-1">{r.follow_up_consent ? "✓" : "—"}</td>
                  <td className="px-3 py-2 text-cz-1 truncate max-w-[140px]" title={r.source || ""}>{r.source || "—"}</td>
                  <td className="px-3 py-2 text-cz-1">{STATUS_LABELS[r.status] || r.status}</td>
                  <td className="px-3 py-2 text-cz-3 text-xs whitespace-nowrap">{formatDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-cz-3 text-xs mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm focus:outline-none focus:border-cz-accent"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
