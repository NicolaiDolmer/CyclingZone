import { useEffect, useMemo, useState } from "react";
import { formatCz } from "../../lib/marketValues";

const API = import.meta.env.VITE_API_URL;

const SUB_TABS = [
  { key: "health", label: "Sundhed" },
  { key: "overview", label: "Overblik" },
  { key: "transactions", label: "Transaktioner" },
  { key: "admin_log", label: "Admin-handlinger" },
  { key: "correlation", label: "Korrelering" },
];

const ACTOR_TYPES = ["", "cron", "api", "admin", "system", "migration"];
const TX_TYPES = ["", "income", "expense"];

// Spejl af FINANCE_REASON i backend/lib/economyConstants.js — bruges som dropdown-options.
const REASON_CODES = [
  "",
  "season_start_sponsor",
  "season_end_salary",
  "season_end_division_bonus",
  "season_end_negative_interest",
  "season_end_loan_interest",
  "starting_budget",
  "race_prize_payout",
  "auction_winner_payment",
  "auction_seller_payout",
  "auction_guaranteed_bank_sale",
  "transfer_purchase",
  "transfer_sale",
  "swap_cash_delta",
  "loan_fee_paid",
  "loan_fee_received",
  "loan_fee_refunded",
  "loan_principal_received",
  "loan_repayment",
  "loan_buyout",
  "loan_origination_fee",
  "emergency_loan_received",
  "squad_auto_purchase",
  "squad_auto_sale",
  "squad_violation_fine",
  "board_bonus_accepted",
  "admin_balance_adjustment",
  "admin_force_prize",
  "admin_beta_reset",
];

// Spejl af ADMIN_ACTION_TYPE i backend/lib/economyConstants.js (24 godkendte action_types).
const ADMIN_ACTION_TYPES = [
  "",
  "auction_cancel",
  "transfer_offer_admin_cancel",
  "swap_offer_admin_cancel",
  "loan_agreement_admin_cancel",
  "auction_config_update",
  "market_pause",
  "market_resume",
  "balance_adjustment",
  "user_deleted",
  "role_changed",
  "race_deleted",
  "race_results_imported",
  "race_results_approved",
  "beta_reset",
  "prize_force_paid",
  "season_repaired",
  "season_started",
  "season_ended",
  "discord_webhook_added",
  "discord_webhook_removed",
  "manual_override",
  "economy_export",
  "team_data_edited",
  "rider_data_edited",
];

const SUSTAINABILITY_LABEL = {
  green: { label: "🟢 Sund", className: "text-cz-success" },
  yellow: { label: "🟡 Pres", className: "text-cz-warning" },
  red: { label: "🔴 Risiko", className: "text-cz-danger" },
};

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
}

function fmtDateTimeSec(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "medium" });
}

function HealthBadge({ ok, children }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border
      ${ok ? "bg-cz-success-bg text-cz-success border-cz-success/30"
            : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
      {ok ? "✅" : "⚠️"} {children}
    </span>
  );
}

function HealthView({ getAuth, onMsg }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/economy-health`, { headers: await getAuth() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Kunne ikke hente health-data");
      setData(body);
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  if (!data) return <p className="text-cz-3 text-sm">{loading ? "Indlæser..." : "Ingen data."}</p>;

  const nullPostOk = data.finance_null_actor_type.post_phase_b === 0;
  const driftOk = data.balance_drift.teams_with_drift === 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-cz-subtle rounded-xl p-4 border border-cz-border">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-cz-1 font-semibold text-sm">Audit-population</h3>
            <HealthBadge ok={nullPostOk}>{nullPostOk ? "Ingen leak" : "Leak detekteret"}</HealthBadge>
          </div>
          <dl className="text-xs space-y-1 text-cz-2">
            <div className="flex justify-between">
              <dt className="text-cz-3">Pre-deploy NULL (legacy)</dt>
              <dd className="font-mono text-cz-2">{data.finance_null_actor_type.pre_phase_b}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-cz-3">Post-deploy NULL</dt>
              <dd className={`font-mono ${nullPostOk ? "text-cz-success" : "text-cz-danger"}`}>
                {data.finance_null_actor_type.post_phase_b}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-cz-3">Post-deploy populeret</dt>
              <dd className="font-mono text-cz-success">{data.finance_null_actor_type.post_phase_b_populated}</dd>
            </div>
            <div className="flex justify-between border-t border-cz-border pt-1 mt-1">
              <dt className="text-cz-3">Total finance_transactions</dt>
              <dd className="font-mono text-cz-2">{data.finance_null_actor_type.total}</dd>
            </div>
          </dl>
          <p className="text-cz-3 text-[11px] mt-2">
            Cutoff: {fmtDate(data.deploy_cutoff)} (07d Fase B deploy)
          </p>
        </div>

        <div className="bg-cz-subtle rounded-xl p-4 border border-cz-border">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-cz-1 font-semibold text-sm">Balance-drift watchdog</h3>
            <HealthBadge ok={driftOk}>{driftOk ? "Ingen drift" : "Drift detekteret"}</HealthBadge>
          </div>
          <dl className="text-xs space-y-1 text-cz-2">
            <div className="flex justify-between">
              <dt className="text-cz-3">Hold med drift</dt>
              <dd className={`font-mono ${driftOk ? "text-cz-success" : "text-cz-danger"}`}>
                {data.balance_drift.teams_with_drift}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-cz-3">Max drift (CZ$)</dt>
              <dd className={`font-mono ${data.balance_drift.max_drift === 0 ? "text-cz-success" : "text-cz-danger"}`}>
                {data.balance_drift.max_drift.toLocaleString("da-DK")}
              </dd>
            </div>
            <div className="flex justify-between border-t border-cz-border pt-1 mt-1">
              <dt className="text-cz-3">Hold tjekket</dt>
              <dd className="font-mono text-cz-2">{data.balance_drift.teams_checked}</dd>
            </div>
          </dl>
          <p className="text-cz-3 text-[11px] mt-2">
            Invariant: teams.balance = {formatCz(data.balance_drift.starting_balance)} + Σ finance_transactions.amount
          </p>
        </div>
      </div>

      <button onClick={refresh} disabled={loading}
        className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-xs font-medium hover:bg-cz-card disabled:opacity-50">
        {loading ? "Opdaterer..." : "↻ Genberegn"}
      </button>
    </div>
  );
}

function OverviewView({ getAuth, onMsg }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ division: "", q: "", include_ai: false, include_frozen: false });

  async function refresh() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.division) params.set("division", filters.division);
      if (filters.q) params.set("q", filters.q);
      if (filters.include_ai) params.set("include_ai", "true");
      if (filters.include_frozen) params.set("include_frozen", "true");
      const res = await fetch(`${API}/api/admin/economy-overview?${params}`, { headers: await getAuth() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Kunne ikke hente overblik");
      setRows(body.teams || []);
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const totals = useMemo(() => {
    let bal = 0, debt = 0;
    for (const r of rows) { bal += r.balance || 0; debt += r.total_debt || 0; }
    return { bal, debt, count: rows.length };
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
        <div>
          <label className="block text-cz-3 text-xs mb-1">Division</label>
          <select value={filters.division} onChange={(e) => setFilters((f) => ({ ...f, division: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm">
            <option value="">Alle</option>
            <option value="1">D1</option>
            <option value="2">D2</option>
            <option value="3">D3</option>
          </select>
        </div>
        <div className="col-span-2 sm:col-span-2">
          <label className="block text-cz-3 text-xs mb-1">Søg holdnavn</label>
          <input type="text" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") refresh(); }}
            placeholder="Filter..."
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm" />
        </div>
        <div className="flex items-end">
          <button onClick={refresh} disabled={loading}
            className="w-full px-3 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
            {loading ? "..." : "Anvend"}
          </button>
        </div>
      </div>
      <div className="flex gap-3 flex-wrap text-xs text-cz-3">
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={filters.include_ai}
            onChange={(e) => setFilters((f) => ({ ...f, include_ai: e.target.checked }))} />
          Inkludér AI-hold
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={filters.include_frozen}
            onChange={(e) => setFilters((f) => ({ ...f, include_frozen: e.target.checked }))} />
          Inkludér frosne hold
        </label>
        <span className="ml-auto text-cz-2">
          {totals.count} hold · Σ balance {formatCz(totals.bal)} · Σ gæld {formatCz(totals.debt)}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-cz-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-cz-border bg-cz-subtle">
              <th className="px-3 py-2 text-left text-cz-3 font-medium">Hold</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium">Div</th>
              <th className="px-3 py-2 text-right text-cz-3 font-medium">Balance</th>
              <th className="px-3 py-2 text-right text-cz-3 font-medium hidden sm:table-cell">Sponsor</th>
              <th className="px-3 py-2 text-right text-cz-3 font-medium">Gæld</th>
              <th className="px-3 py-2 text-right text-cz-3 font-medium hidden md:table-cell">Loft</th>
              <th className="px-3 py-2 text-right text-cz-3 font-medium hidden md:table-cell">Ratio</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-cz-3">{loading ? "Indlæser..." : "Ingen hold matcher filteret."}</td></tr>
            )}
            {rows.map((r) => {
              const sus = SUSTAINABILITY_LABEL[r.sustainability] || SUSTAINABILITY_LABEL.green;
              return (
                <tr key={r.id} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle/50">
                  <td className="px-3 py-2 text-cz-1 font-medium">
                    {r.name}
                    {r.is_ai && <span className="ml-2 text-[10px] text-cz-3 uppercase">AI</span>}
                    {r.is_frozen && <span className="ml-2 text-[10px] text-cz-warning uppercase">frosset</span>}
                  </td>
                  <td className="px-3 py-2 text-cz-2">D{r.division}</td>
                  <td className="px-3 py-2 text-right font-mono text-cz-1">{formatCz(r.balance)}</td>
                  <td className="px-3 py-2 text-right font-mono text-cz-2 hidden sm:table-cell">{formatCz(r.sponsor_income)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${r.total_debt > 0 ? "text-cz-warning" : "text-cz-2"}`}>{formatCz(r.total_debt)}</td>
                  <td className="px-3 py-2 text-right font-mono text-cz-3 hidden md:table-cell">{formatCz(r.debt_ceiling)}</td>
                  <td className="px-3 py-2 text-right font-mono text-cz-3 hidden md:table-cell">{(r.debt_ratio * 100).toFixed(1)}%</td>
                  <td className={`px-3 py-2 text-xs ${sus.className}`}>{sus.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransactionDetailModal({ tx, onClose }) {
  if (!tx) return null;
  const fields = [
    ["ID", tx.id],
    ["Type", tx.type],
    ["Beløb", formatCz(tx.amount)],
    ["Hold", tx.team?.name ? `${tx.team.name} (D${tx.team.division})` : tx.team_id],
    ["Sæson", tx.season?.number ?? "—"],
    ["Tidspunkt", fmtDate(tx.created_at)],
    ["Beskrivelse", tx.description || "—"],
    ["—", "—"],
    ["Actor type", tx.actor_type || "(NULL — legacy)"],
    ["Actor ID", tx.actor_id || "—"],
    ["Source path", tx.source_path || "—"],
    ["Reason code", tx.reason_code || "—"],
    ["Idempotency key", tx.idempotency_key || "—"],
    ["—", "—"],
    ["Before balance", tx.before_balance != null ? formatCz(tx.before_balance) : "—"],
    ["After balance", tx.after_balance != null ? formatCz(tx.after_balance) : "—"],
    [
      "Audit-invariant",
      tx.before_balance != null && tx.after_balance != null
        ? (tx.after_balance - tx.before_balance === tx.amount
            ? "✅ after − before = amount"
            : `⚠️ after − before = ${(tx.after_balance - tx.before_balance).toLocaleString("da-DK")} ≠ ${tx.amount.toLocaleString("da-DK")}`)
        : "—",
    ],
    ["—", "—"],
    ["Related entity type", tx.related_entity_type || "—"],
    ["Related entity ID", tx.related_entity_id || "—"],
    ["Related loan ID", tx.related_loan_id || "—"],
    ["Race ID", tx.race_id || "—"],
  ];
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 py-6 overflow-y-auto"
      onClick={onClose}>
      <div className="bg-cz-card border border-cz-border rounded-xl max-w-2xl w-full p-5"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-cz-1 font-semibold text-base">Transaktions-detaljer</h3>
          <button onClick={onClose} aria-label="Luk"
            className="text-cz-3 hover:text-cz-1 text-xl leading-none">✕</button>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-x-3 gap-y-1 text-xs font-mono">
          {fields.map(([label, value], i) => (
            label === "—" ? (
              <div key={`sep-${i}`} className="col-span-full border-t border-cz-border my-1" />
            ) : (
              <div key={i} className="contents">
                <dt className="text-cz-3 sm:text-right">{label}</dt>
                <dd className="text-cz-1 break-all">{value}</dd>
              </div>
            )
          ))}
        </dl>
      </div>
    </div>
  );
}

const EMPTY_TX_FILTERS = {
  type: "", actor_type: "", reason_code: "", source_path: "",
  team_id: "", season_id: "",
  date_from: "", date_to: "", amount_min: "", amount_max: "",
};

function TransactionsView({ getAuth, onMsg, initialFilters }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState(() => ({ ...EMPTY_TX_FILTERS, ...(initialFilters || {}) }));

  async function refresh(nextOffset = 0, overrideFilters = null) {
    const effective = overrideFilters || filters;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(nextOffset));
      for (const [k, v] of Object.entries(effective)) if (v) params.set(k, v);
      const res = await fetch(`${API}/api/admin/finance-transactions?${params}`, { headers: await getAuth() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Kunne ikke hente transaktioner");
      setRows(body.transactions || []);
      setTotal(body.total || 0);
      setOffset(nextOffset);
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // initialFilters er kun "live" ved første render — drill-down genmounter via key prop.
    refresh(0);
    /* eslint-disable-line react-hooks/exhaustive-deps */
  }, []);

  function applyFilters() { refresh(0); }
  function resetFilters() {
    setFilters(EMPTY_TX_FILTERS);
    setTimeout(() => refresh(0, EMPTY_TX_FILTERS), 0);
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + rows.length, total);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="block text-cz-3 text-xs mb-1">Actor type</label>
          <select value={filters.actor_type} onChange={(e) => setFilters((f) => ({ ...f, actor_type: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm">
            {ACTOR_TYPES.map((a) => <option key={a} value={a}>{a || "Alle"}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Reason code</label>
          <select value={filters.reason_code} onChange={(e) => setFilters((f) => ({ ...f, reason_code: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm">
            {REASON_CODES.map((r) => <option key={r} value={r}>{r || "Alle"}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Type</label>
          <select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm">
            {TX_TYPES.map((t) => <option key={t} value={t}>{t || "Alle"}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Source path (substring)</label>
          <input type="text" value={filters.source_path}
            onChange={(e) => setFilters((f) => ({ ...f, source_path: e.target.value }))}
            placeholder="fx auctionFinalization"
            onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Hold-ID</label>
          <input type="text" value={filters.team_id}
            onChange={(e) => setFilters((f) => ({ ...f, team_id: e.target.value }))}
            placeholder="UUID"
            onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm font-mono" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Sæson-ID</label>
          <input type="text" value={filters.season_id}
            onChange={(e) => setFilters((f) => ({ ...f, season_id: e.target.value }))}
            placeholder="UUID"
            onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm font-mono" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Fra dato</label>
          <input type="date" value={filters.date_from}
            onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Til dato</label>
          <input type="date" value={filters.date_to}
            onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Min beløb</label>
          <input type="number" value={filters.amount_min}
            onChange={(e) => setFilters((f) => ({ ...f, amount_min: e.target.value }))}
            placeholder="-100000"
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Max beløb</label>
          <input type="number" value={filters.amount_max}
            onChange={(e) => setFilters((f) => ({ ...f, amount_max: e.target.value }))}
            placeholder="100000"
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <button onClick={applyFilters} disabled={loading}
          className="px-3 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
          {loading ? "..." : "Anvend filtre"}
        </button>
        <button onClick={resetFilters} disabled={loading}
          className="px-3 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-card disabled:opacity-50">
          Nulstil
        </button>
        <span className="ml-auto text-xs text-cz-3">
          {total === 0 ? "Ingen rows" : `Viser ${pageStart}–${pageEnd} af ${total.toLocaleString("da-DK")}`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-cz-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-cz-border bg-cz-subtle">
              <th className="px-3 py-2 text-left text-cz-3 font-medium">Tid</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium">Hold</th>
              <th className="px-3 py-2 text-right text-cz-3 font-medium">Beløb</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium hidden sm:table-cell">Reason</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium hidden md:table-cell">Actor</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium hidden lg:table-cell">Source path</th>
              <th className="px-3 py-2 text-right text-cz-3 font-medium hidden xl:table-cell">After bal</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-cz-3">{loading ? "Indlæser..." : "Ingen transaktioner matcher filteret."}</td></tr>
            )}
            {rows.map((tx) => (
              <tr key={tx.id} onClick={() => setSelected(tx)}
                className="border-b border-cz-border last:border-0 hover:bg-cz-subtle/50 cursor-pointer">
                <td className="px-3 py-2 text-cz-2 whitespace-nowrap">{fmtDate(tx.created_at)}</td>
                <td className="px-3 py-2 text-cz-1">{tx.team?.name || tx.team_id?.slice(0, 8)}</td>
                <td className={`px-3 py-2 text-right font-mono ${tx.amount >= 0 ? "text-cz-success" : "text-cz-danger"}`}>
                  {tx.amount >= 0 ? "+" : ""}{tx.amount.toLocaleString("da-DK")}
                </td>
                <td className="px-3 py-2 text-cz-2 hidden sm:table-cell font-mono text-[11px]">{tx.reason_code || "—"}</td>
                <td className="px-3 py-2 text-cz-3 hidden md:table-cell">{tx.actor_type || "—"}</td>
                <td className="px-3 py-2 text-cz-3 hidden lg:table-cell font-mono text-[11px] truncate max-w-[260px]">{tx.source_path || "—"}</td>
                <td className="px-3 py-2 text-right text-cz-3 hidden xl:table-cell font-mono">{tx.after_balance != null ? tx.after_balance.toLocaleString("da-DK") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <label className="text-cz-3 text-xs">Pr. side</label>
          <select value={limit}
            onChange={(e) => { const n = parseInt(e.target.value, 10); setLimit(n); setTimeout(() => refresh(0), 0); }}
            className="bg-cz-subtle border border-cz-border rounded-lg px-2 py-1.5 text-cz-1 text-xs">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refresh(Math.max(0, offset - limit))} disabled={loading || offset === 0}
            className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-xs disabled:opacity-50">‹ Forrige</button>
          <button onClick={() => refresh(offset + limit)} disabled={loading || offset + limit >= total}
            className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-xs disabled:opacity-50">Næste ›</button>
        </div>
      </div>

      <TransactionDetailModal tx={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function AdminLogDetailModal({ entry, onClose }) {
  if (!entry) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 py-6 overflow-y-auto"
      onClick={onClose}>
      <div className="bg-cz-card border border-cz-border rounded-xl max-w-2xl w-full p-5"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-cz-1 font-semibold text-base">Admin-handling</h3>
          <button onClick={onClose} aria-label="Luk"
            className="text-cz-3 hover:text-cz-1 text-xl leading-none">✕</button>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-3 gap-y-1 text-xs font-mono mb-3">
          <dt className="text-cz-3 sm:text-right">ID</dt>
          <dd className="text-cz-1 break-all">{entry.id}</dd>
          <dt className="text-cz-3 sm:text-right">Tidspunkt</dt>
          <dd className="text-cz-1">{fmtDateTimeSec(entry.created_at)}</dd>
          <dt className="text-cz-3 sm:text-right">Action type</dt>
          <dd className="text-cz-1">{entry.action_type}</dd>
          <dt className="text-cz-3 sm:text-right">Admin user ID</dt>
          <dd className="text-cz-1 break-all">{entry.admin_user_id}</dd>
          <dt className="text-cz-3 sm:text-right">Target team ID</dt>
          <dd className="text-cz-1 break-all">{entry.target_team_id || "—"}</dd>
          <dt className="text-cz-3 sm:text-right">Target rider ID</dt>
          <dd className="text-cz-1 break-all">{entry.target_rider_id || "—"}</dd>
          <dt className="text-cz-3 sm:text-right">Beskrivelse</dt>
          <dd className="text-cz-1 whitespace-pre-wrap">{entry.description}</dd>
        </dl>
        <div className="border-t border-cz-border pt-3">
          <p className="text-cz-3 text-xs mb-1">meta (JSON)</p>
          <pre className="bg-cz-subtle border border-cz-border rounded-lg p-3 text-[11px] text-cz-1 font-mono overflow-x-auto">
{entry.meta ? JSON.stringify(entry.meta, null, 2) : "(tom)"}
          </pre>
        </div>
      </div>
    </div>
  );
}

function AdminLogView({ getAuth, onMsg }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({
    action_type: "", admin_user_id: "", target_team_id: "", target_rider_id: "",
    date_from: "", date_to: "",
  });

  async function refresh(nextOffset = 0) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(nextOffset));
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      const res = await fetch(`${API}/api/admin/admin-log?${params}`, { headers: await getAuth() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Kunne ikke hente admin-log");
      setEntries(body.entries || []);
      setTotal(body.total || 0);
      setOffset(nextOffset);
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(0); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  function applyFilters() { refresh(0); }
  function resetFilters() {
    setFilters({
      action_type: "", admin_user_id: "", target_team_id: "", target_rider_id: "",
      date_from: "", date_to: "",
    });
    setTimeout(() => refresh(0), 0);
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + entries.length, total);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div>
          <label className="block text-cz-3 text-xs mb-1">Action type</label>
          <select value={filters.action_type} onChange={(e) => setFilters((f) => ({ ...f, action_type: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm">
            {ADMIN_ACTION_TYPES.map((a) => <option key={a} value={a}>{a || "Alle"}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Admin user ID</label>
          <input type="text" value={filters.admin_user_id}
            onChange={(e) => setFilters((f) => ({ ...f, admin_user_id: e.target.value }))}
            placeholder="UUID"
            onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm font-mono" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Hold-ID (target)</label>
          <input type="text" value={filters.target_team_id}
            onChange={(e) => setFilters((f) => ({ ...f, target_team_id: e.target.value }))}
            placeholder="UUID"
            onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm font-mono" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Rytter-ID (target)</label>
          <input type="text" value={filters.target_rider_id}
            onChange={(e) => setFilters((f) => ({ ...f, target_rider_id: e.target.value }))}
            placeholder="UUID"
            onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm font-mono" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Fra dato</label>
          <input type="date" value={filters.date_from}
            onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Til dato</label>
          <input type="date" value={filters.date_to}
            onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <button onClick={applyFilters} disabled={loading}
          className="px-3 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
          {loading ? "..." : "Anvend filtre"}
        </button>
        <button onClick={resetFilters} disabled={loading}
          className="px-3 py-2 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-sm hover:bg-cz-card disabled:opacity-50">
          Nulstil
        </button>
        <span className="ml-auto text-xs text-cz-3">
          {total === 0 ? "Ingen rows" : `Viser ${pageStart}–${pageEnd} af ${total.toLocaleString("da-DK")}`}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-cz-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-cz-border bg-cz-subtle">
              <th className="px-3 py-2 text-left text-cz-3 font-medium">Tid</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium">Action</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium">Beskrivelse</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium hidden md:table-cell">Target hold</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium hidden lg:table-cell">Target rytter</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-cz-3">{loading ? "Indlæser..." : "Ingen admin-handlinger matcher filteret."}</td></tr>
            )}
            {entries.map((entry) => (
              <tr key={entry.id} onClick={() => setSelected(entry)}
                className="border-b border-cz-border last:border-0 hover:bg-cz-subtle/50 cursor-pointer">
                <td className="px-3 py-2 text-cz-2 whitespace-nowrap">{fmtDate(entry.created_at)}</td>
                <td className="px-3 py-2 text-cz-1 font-mono text-[11px]">{entry.action_type}</td>
                <td className="px-3 py-2 text-cz-2 truncate max-w-[460px]">{entry.description}</td>
                <td className="px-3 py-2 text-cz-3 hidden md:table-cell font-mono text-[11px]">{entry.target_team_id?.slice(0, 8) || "—"}</td>
                <td className="px-3 py-2 text-cz-3 hidden lg:table-cell font-mono text-[11px]">{entry.target_rider_id?.slice(0, 8) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <label className="text-cz-3 text-xs">Pr. side</label>
          <select value={limit}
            onChange={(e) => { const n = parseInt(e.target.value, 10); setLimit(n); setTimeout(() => refresh(0), 0); }}
            className="bg-cz-subtle border border-cz-border rounded-lg px-2 py-1.5 text-cz-1 text-xs">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refresh(Math.max(0, offset - limit))} disabled={loading || offset === 0}
            className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-xs disabled:opacity-50">‹ Forrige</button>
          <button onClick={() => refresh(offset + limit)} disabled={loading || offset + limit >= total}
            className="px-3 py-1.5 bg-cz-subtle text-cz-2 border border-cz-border rounded-lg text-xs disabled:opacity-50">Næste ›</button>
        </div>
      </div>

      <AdminLogDetailModal entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function CorrelationView({ getAuth, onMsg, onDrillDown }) {
  const [runs, setRuns] = useState([]);
  const [totalTx, setTotalTx] = useState(0);
  const [windowSeconds, setWindowSeconds] = useState(5);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    actor_type: "cron", source_path: "", date_from: "", date_to: "",
  });

  async function refresh() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("window_seconds", String(windowSeconds));
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      const res = await fetch(`${API}/api/admin/cron-runs?${params}`, { headers: await getAuth() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Kunne ikke hente cron-runs");
      setRuns(body.runs || []);
      setTotalTx(body.total_tx || 0);
    } catch (e) {
      onMsg(`❌ ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  function drillIntoRun(run) {
    // Pre-fyld Transaktioner-view med actor_id + source_path + ±vindue om started_at..ended_at.
    const start = new Date(new Date(run.started_at).getTime() - windowSeconds * 1000);
    const end = new Date(new Date(run.ended_at).getTime() + windowSeconds * 1000);
    onDrillDown({
      actor_type: filters.actor_type || "",
      source_path: run.source_path,
      date_from: start.toISOString().slice(0, 10),
      date_to: end.toISOString().slice(0, 10),
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="block text-cz-3 text-xs mb-1">Actor type</label>
          <select value={filters.actor_type}
            onChange={(e) => setFilters((f) => ({ ...f, actor_type: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm">
            {ACTOR_TYPES.map((a) => <option key={a} value={a}>{a || "Alle"}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Source path (substring)</label>
          <input type="text" value={filters.source_path}
            onChange={(e) => setFilters((f) => ({ ...f, source_path: e.target.value }))}
            placeholder="fx sponsorPayout"
            onKeyDown={(e) => { if (e.key === "Enter") refresh(); }}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Fra dato</label>
          <input type="date" value={filters.date_from}
            onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Til dato</label>
          <input type="date" value={filters.date_to}
            onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm" />
        </div>
        <div>
          <label className="block text-cz-3 text-xs mb-1">Vindue (sek)</label>
          <input type="number" value={windowSeconds} min={1} max={300}
            onChange={(e) => setWindowSeconds(parseInt(e.target.value, 10) || 5)}
            className="w-full bg-cz-subtle border border-cz-border rounded-lg px-2 py-2 text-cz-1 text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <button onClick={refresh} disabled={loading}
          className="px-3 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110 disabled:opacity-50">
          {loading ? "..." : "Anvend filtre"}
        </button>
        <span className="ml-auto text-xs text-cz-3">
          {runs.length} runs · {totalTx.toLocaleString("da-DK")} tx i vinduet
        </span>
      </div>

      <p className="text-cz-3 text-[11px]">
        Klik en row for at drille ned i Transaktioner-view med samme actor + source_path + tidsvindue.
      </p>

      <div className="overflow-x-auto rounded-lg border border-cz-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-cz-border bg-cz-subtle">
              <th className="px-3 py-2 text-left text-cz-3 font-medium">Start</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium hidden sm:table-cell">Slut</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium">Source path</th>
              <th className="px-3 py-2 text-right text-cz-3 font-medium">Tx</th>
              <th className="px-3 py-2 text-right text-cz-3 font-medium">Σ beløb</th>
              <th className="px-3 py-2 text-right text-cz-3 font-medium hidden md:table-cell">Hold</th>
              <th className="px-3 py-2 text-left text-cz-3 font-medium hidden lg:table-cell">Reasons</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-cz-3">
                {loading ? "Indlæser..." : "Ingen runs i vinduet."}
              </td></tr>
            )}
            {runs.map((run, i) => (
              <tr key={`${run.actor_id}-${run.source_path}-${run.started_at}-${i}`}
                onClick={() => drillIntoRun(run)}
                className="border-b border-cz-border last:border-0 hover:bg-cz-subtle/50 cursor-pointer">
                <td className="px-3 py-2 text-cz-2 whitespace-nowrap">{fmtDateTimeSec(run.started_at)}</td>
                <td className="px-3 py-2 text-cz-3 whitespace-nowrap hidden sm:table-cell">{fmtDateTimeSec(run.ended_at)}</td>
                <td className="px-3 py-2 text-cz-1 font-mono text-[11px] truncate max-w-[260px]">{run.source_path}</td>
                <td className="px-3 py-2 text-right font-mono text-cz-2">{run.tx_count}</td>
                <td className={`px-3 py-2 text-right font-mono ${run.total_amount >= 0 ? "text-cz-success" : "text-cz-danger"}`}>
                  {run.total_amount >= 0 ? "+" : ""}{run.total_amount.toLocaleString("da-DK")}
                </td>
                <td className="px-3 py-2 text-right font-mono text-cz-3 hidden md:table-cell">{run.affected_teams.length}</td>
                <td className="px-3 py-2 text-cz-3 hidden lg:table-cell font-mono text-[11px]">
                  {run.reason_codes.join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EconomyAdminSection({ getAuth, onMsg }) {
  const [tab, setTab] = useState("health");
  const [txInitialFilters, setTxInitialFilters] = useState(null);
  // Bumpes når drill-down anmoder om en frisk TransactionsView med nye initialFilters.
  const [txMountKey, setTxMountKey] = useState(0);

  function drillIntoTransactions(initialFilters) {
    setTxInitialFilters(initialFilters);
    setTxMountKey((k) => k + 1);
    setTab("transactions");
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-4 border-b border-cz-border pb-2">
        {SUB_TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all
              ${tab === t.key
                ? "bg-cz-accent text-cz-on-accent"
                : "bg-cz-subtle text-cz-2 hover:bg-cz-card"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "health" && <HealthView getAuth={getAuth} onMsg={onMsg} />}
      {tab === "overview" && <OverviewView getAuth={getAuth} onMsg={onMsg} />}
      {tab === "transactions" && (
        <TransactionsView
          key={`tx-${txMountKey}`}
          getAuth={getAuth}
          onMsg={onMsg}
          initialFilters={txInitialFilters}
        />
      )}
      {tab === "admin_log" && <AdminLogView getAuth={getAuth} onMsg={onMsg} />}
      {tab === "correlation" && (
        <CorrelationView getAuth={getAuth} onMsg={onMsg} onDrillDown={drillIntoTransactions} />
      )}
    </div>
  );
}
