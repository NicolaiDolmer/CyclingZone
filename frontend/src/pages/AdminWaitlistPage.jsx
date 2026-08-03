import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Select from "../components/ui/Select";
import { Table, Tr, Td } from "../components/ui/Table";
import SortableTh from "../components/ui/SortableTh";
import PageLoader from "../components/ui/PageLoader";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import { DownloadIcon, InfoIcon, CheckIcon } from "../components/ui/icons";

// #3196: udtrukket fra en tidligere standalone /admin/waitlist-side til en ren
// indholds-komponent, genbrugt som "Waitlist"-fanen i det samlede vækst-
// dashboard (AdminGrowthPage.jsx). Admin-gating + sideheader ejes nu af
// forælderen; ingen andre importerer denne komponent.

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

// Kanonisk table-header-typografi (tableStyles.js HEADER, minus farve — SortableTh
// styrer selv --text-3/--accent-t-farven ud fra aktiv sort-kolonne).
const TH_CLASS = "px-3 py-2 font-data text-2xs font-semibold uppercase tracking-[.1em]";

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
    <Card className="p-4">
      <p className="text-cz-3 text-xs uppercase tracking-wide">{label}</p>
      <p className="text-cz-1 text-2xl font-bold font-data tabular-nums mt-1">{value}</p>
      {sub && <p className="text-cz-3 text-xs mt-1">{sub}</p>}
    </Card>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-cz-3 text-xs mb-1">{label}</label>
      <Select size="sm" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </div>
  );
}

export function WaitlistContent() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filterInterest, setFilterInterest] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterScore, setFilterScore] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [sort, setSort] = useState({ key: "intent_score", dir: "desc" });

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

  useEffect(() => { loadRows(); }, []);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-cz-3 text-sm">Intent-scoring + lead-prioritering. Refs sprint-validation #363.</p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={loadRows} loading={loading}>
            Genindlæs
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExportCsv}
            disabled={!sortedRows.length}
            iconLeft={<DownloadIcon size={14} aria-hidden="true" />}
          >
            CSV ({sortedRows.length})
          </Button>
        </div>
      </div>

      {error && (
        <ErrorState
          title="Kunne ikke hente waitlist"
          description={error}
          action={<Button variant="secondary" size="sm" onClick={loadRows}>Prøv igen</Button>}
        />
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
        <Card className="p-4 col-span-2 md:col-span-1">
          <p className="text-cz-3 text-xs uppercase tracking-wide">Top 3 kilder</p>
          {kpis.topSources.length === 0 ? (
            <p className="text-cz-3 text-sm mt-2">Ingen data endnu</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {kpis.topSources.map(([src, count]) => (
                <li key={src} className="text-cz-1 text-sm flex justify-between">
                  <span className="truncate me-2">{src}</span>
                  <span className="text-cz-accent-t font-bold font-data tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
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
      </Card>

      <Card className="overflow-hidden">
        <Table data-sortable>
          <thead className="bg-cz-subtle border-b border-cz-border">
            <tr>
              <SortableTh sortKey="email" sort={sort.key} sortDir={sort.dir} onSort={handleSort} className={`${TH_CLASS} text-left`}>
                Kontakt
              </SortableTh>
              <SortableTh sortKey="interest_level" sort={sort.key} sortDir={sort.dir} onSort={handleSort} className={`${TH_CLASS} text-left`}>
                Interesse
              </SortableTh>
              <SortableTh sortKey="preferred_tier" sort={sort.key} sortDir={sort.dir} onSort={handleSort} className={`${TH_CLASS} text-left`}>
                Tier
              </SortableTh>
              <SortableTh
                sortKey="intent_score"
                sort={sort.key}
                sortDir={sort.dir}
                onSort={handleSort}
                title={INTENT_SCORE_TOOLTIP}
                className={`${TH_CLASS} text-right`}
              >
                Score
                <span className="ms-1 inline-flex align-middle text-cz-3" title={INTENT_SCORE_TOOLTIP}>
                  <InfoIcon size={11} aria-hidden="true" />
                </span>
              </SortableTh>
              <SortableTh sortKey="follow_up_consent" sort={sort.key} sortDir={sort.dir} onSort={handleSort} className={`${TH_CLASS} text-left`}>
                Follow-up
              </SortableTh>
              <SortableTh sortKey="source" sort={sort.key} sortDir={sort.dir} onSort={handleSort} className={`${TH_CLASS} text-left`}>
                Kilde
              </SortableTh>
              <SortableTh sortKey="status" sort={sort.key} sortDir={sort.dir} onSort={handleSort} className={`${TH_CLASS} text-left`}>
                Status
              </SortableTh>
              <SortableTh sortKey="created_at" sort={sort.key} sortDir={sort.dir} onSort={handleSort} className={`${TH_CLASS} text-left`}>
                Oprettet
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <Tr>
                <Td colSpan={8} className="py-8">
                  <PageLoader label="Henter signups" minHeight="80px" />
                </Td>
              </Tr>
            )}
            {!loading && sortedRows.length === 0 && (
              <Tr>
                <Td colSpan={8} className="py-4">
                  <EmptyState
                    title="Ingen signups matcher filtrene"
                    description="Justér filtrene ovenfor for at se flere resultater."
                  />
                </Td>
              </Tr>
            )}
            {!loading && sortedRows.map(r => (
              <Tr key={r.id}>
                <Td>
                  {r.email && <p className="truncate max-w-[200px]" title={r.email}>{r.email}</p>}
                  {r.discord_handle && <p className="text-cz-3 text-xs truncate max-w-[200px]" title={r.discord_handle}>@{r.discord_handle}</p>}
                </Td>
                <Td>{INTEREST_LABELS[r.interest_level] || r.interest_level}</Td>
                <Td className="whitespace-nowrap">{TIER_LABELS[r.preferred_tier] || r.preferred_tier}</Td>
                <Td numeric title={INTENT_SCORE_TOOLTIP}>
                  <span className={
                    (r.intent_score || 0) >= 4 ? "text-cz-success font-bold" :
                    (r.intent_score || 0) >= 2 ? "text-cz-1 font-bold" : "text-cz-3 font-bold"
                  }>{r.intent_score ?? "—"}</span>
                </Td>
                <Td>
                  {r.follow_up_consent
                    ? <CheckIcon size={14} className="text-cz-success" title="Ja" />
                    : <span className="text-cz-3">—</span>}
                </Td>
                <Td className="truncate max-w-[140px]" title={r.source || ""}>{r.source || "—"}</Td>
                <Td>{STATUS_LABELS[r.status] || r.status}</Td>
                <Td className="text-cz-3 text-xs whitespace-nowrap">{formatDate(r.created_at)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
