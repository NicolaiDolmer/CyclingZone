import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

const LOAN_TYPE_LABELS = { short: "Kort lån", long: "Langt lån", emergency: "Nødlån" };

const TX_CONFIG = {
  sponsor:          { label: "Sponsorindtægt",    color: "text-green-700" },
  salary:           { label: "Løn",                color: "text-red-700" },
  transfer_out:     { label: "Transfer (købt)",   color: "text-red-700" },
  transfer_in:      { label: "Transfer (solgt)",  color: "text-green-700" },
  loan_received:    { label: "Lån modtaget",       color: "text-blue-700" },
  loan_repayment:   { label: "Lånrate",            color: "text-orange-700" },
  loan_interest:    { label: "Lånerenter",         color: "text-red-700" },
  emergency_loan:   { label: "Nødlån",             color: "text-red-700" },
  prize:            { label: "Præmiepenge",        color: "text-green-700" },
  bonus:            { label: "Divisionsbonus",     color: "text-green-700" },
  admin_adjustment: { label: "Admin justering",   color: "text-slate-500" },
  interest:         { label: "Renter",             color: "text-red-700" },
};

function timeAgo(d) {
  if (!d) return "—";
  const diff = new Date() - new Date(d);
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (m < 1) return "Lige nu";
  if (m < 60) return `${m}m siden`;
  if (h < 24) return `${h}t siden`;
  return `${day}d siden`;
}

export default function FinancePage() {
  const [loanData, setLoanData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [team, setTeam] = useState(null);
  const [prizeTotal, setPrizeTotal] = useState(0);
  const [prizeRows, setPrizeRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({ text: "", type: "" });

  // Optag lån
  const [loanType, setLoanType] = useState("short");
  const [loanAmount, setLoanAmount] = useState("");
  const [takingLoan, setTakingLoan] = useState(false);

  // Betal lån
  const [repayId, setRepayId] = useState(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [repaying, setRepaying] = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: teamData } = await supabase.from("teams")
      .select("id, name, balance, division").eq("user_id", user.id).single();
    if (!teamData) { setLoading(false); return; }
    setTeam(teamData);

    const { data: { session } } = await supabase.auth.getSession();
    const [loanRes, txRes, prizeTxRes] = await Promise.all([
      fetch(`${API}/api/finance/loans`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
      supabase.from("finance_transactions").select("*")
        .eq("team_id", teamData.id).order("created_at", { ascending: false }).limit(30),
      supabase.from("finance_transactions")
        .select("id, amount, race_id, description, created_at")
        .eq("team_id", teamData.id)
        .in("type", ["prize", "bonus"])
        .order("amount", { ascending: false }),
    ]);

    if (loanRes.ok) setLoanData(await loanRes.json());
    setTransactions(txRes.data || []);

    const allPrizeTxs = prizeTxRes.data || [];
    setPrizeTotal(allPrizeTxs.reduce((s, r) => s + (r.amount || 0), 0));

    const raceIds = [...new Set(allPrizeTxs.map(r => r.race_id).filter(Boolean))];
    if (raceIds.length > 0) {
      const { data: raceNames } = await supabase.from("races").select("id, name").in("id", raceIds);
      const raceMap = Object.fromEntries((raceNames || []).map(r => [r.id, r.name]));
      setPrizeRows(allPrizeTxs.map(tx => ({ ...tx, raceName: raceMap[tx.race_id] || null })));
    } else {
      setPrizeRows(allPrizeTxs);
    }

    setLoading(false);
  }

  function showMsg(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "" }), 5000);
  }

  async function handleTakeLoan(e) {
    e.preventDefault();
    if (!loanAmount || parseInt(loanAmount) < 1) return;
    setTakingLoan(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}/api/finance/loans`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ loan_type: loanType, amount: parseInt(loanAmount) }),
    });
    const result = await res.json();
    if (res.ok) {
      showMsg(`✅ Lån på ${parseInt(loanAmount).toLocaleString("da-DK")} CZ$ oprettet`);
      setLoanAmount("");
      loadAll();
    } else {
      showMsg(`❌ ${result.error}`, "error");
    }
    setTakingLoan(false);
  }

  async function handleRepay(loanId, amount) {
    if (!amount || parseInt(amount) < 1) return;
    setRepaying(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}/api/finance/loans/${loanId}/repay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ amount: parseInt(amount) }),
    });
    const result = await res.json();
    if (res.ok) {
      showMsg(result.paid_off
        ? "✅ Lån fuldt tilbagebetalt!"
        : `✅ ${result.paid?.toLocaleString("da-DK")} CZ$ betalt — resterende: ${result.remaining?.toLocaleString("da-DK")} CZ$`);
      setRepayId(null);
      setRepayAmount("");
      loadAll();
    } else {
      showMsg(`❌ ${result.error}`, "error");
    }
    setRepaying(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
    </div>
  );

  const activeLoans = (loanData?.loans || []).filter(l => l.status === "active");
  const configs = (loanData?.configs || []).filter(c => c.loan_type !== "emergency");
  const selectedConfig = configs.find(c => c.loan_type === loanType);
  const loanAmountNum = parseInt(loanAmount) || 0;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Finanser</h1>
        <p className="text-slate-400 text-sm">Balance, lån og transaktionshistorik</p>
      </div>

      {msg.text && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border
          ${msg.type === "error"
            ? "bg-red-50 text-red-700 border-red-200"
            : "bg-green-50 text-green-700 border-green-200"}`}>
          {msg.text}
        </div>
      )}

      {/* Balance + gæld + præmier */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Balance</p>
          <p className={`font-mono font-bold text-2xl ${(team?.balance || 0) >= 0 ? "text-amber-700" : "text-red-700"}`}>
            {(team?.balance || 0).toLocaleString("da-DK")} CZ$
          </p>
          <p className="text-slate-400 text-xs mt-1">Division {team?.division}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Total gæld</p>
          <p className={`font-mono font-bold text-2xl ${(loanData?.total_debt || 0) > 0 ? "text-red-700" : "text-slate-400"}`}>
            {(loanData?.total_debt || 0).toLocaleString("da-DK")} CZ$
          </p>
          {loanData?.debt_ceiling && (
            <p className="text-slate-400 text-xs mt-1">
              Loft: {loanData.debt_ceiling.toLocaleString("da-DK")} CZ$
            </p>
          )}
        </div>
        <div className="col-span-2 md:col-span-1 bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Præmiepenge</p>
          <p className={`font-mono font-bold text-2xl ${prizeTotal > 0 ? "text-green-700" : "text-slate-400"}`}>
            {prizeTotal > 0 ? "+" : ""}{prizeTotal.toLocaleString("da-DK")} CZ$
          </p>
          <p className="text-slate-400 text-xs mt-1">{prizeRows.length} løb</p>
        </div>
      </div>

      {/* Løbspræmier */}
      {prizeRows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
          <h2 className="text-slate-900 font-semibold text-sm mb-3">Løbspræmier</h2>
          <div className="flex flex-col divide-y divide-slate-100">
            {prizeRows.map(tx => (
              <div key={tx.id} className="flex items-center justify-between py-2">
                <div className="flex-1 min-w-0 pr-3">
                  <p className="text-slate-700 text-xs font-medium truncate">
                    {tx.raceName || tx.description || "Præmiepenge"}
                  </p>
                  <p className="text-slate-400 text-xs mt-0.5">{timeAgo(tx.created_at)}</p>
                </div>
                <p className="font-mono text-sm font-bold text-green-700 flex-shrink-0">
                  +{(tx.amount || 0).toLocaleString("da-DK")} CZ$
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Aktive lån */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        <h2 className="text-slate-900 font-semibold text-sm mb-4">Aktive lån</h2>
        {activeLoans.length === 0 ? (
          <p className="text-slate-400 text-sm">Ingen aktive lån</p>
        ) : (
          <div className="flex flex-col gap-3">
            {activeLoans.map(loan => {
              const maxRepay = Math.min(team?.balance || 0, loan.amount_remaining);
              return (
                <div key={loan.id} className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-slate-900 font-medium text-sm">
                        {LOAN_TYPE_LABELS[loan.loan_type] || loan.loan_type}
                      </p>
                      <p className="text-slate-400 text-xs mt-0.5">Oprettet {timeAgo(loan.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-red-700 font-mono font-bold text-sm">
                        {loan.amount_remaining?.toLocaleString("da-DK")} CZ$
                      </p>
                      <p className="text-slate-400 text-xs">resterende</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div>
                      <p className="text-slate-500 font-mono text-xs">{loan.principal?.toLocaleString("da-DK")}</p>
                      <p className="text-slate-400 text-xs">Hovedstol</p>
                    </div>
                    <div>
                      <p className="text-slate-500 font-mono text-xs">{(loan.interest_rate * 100).toFixed(0)}%</p>
                      <p className="text-slate-400 text-xs">Rente/sæson</p>
                    </div>
                    <div>
                      <p className="text-slate-500 font-mono text-xs">{loan.seasons_remaining}</p>
                      <p className="text-slate-400 text-xs">Sæsoner tilbage</p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="bg-slate-100 rounded-full h-1.5 mb-3">
                    <div className="h-1.5 rounded-full bg-red-400/50 transition-all"
                      style={{ width: `${Math.min(100, Math.round((loan.amount_remaining / ((loan.principal || 1) + (loan.origination_fee || 0))) * 100))}%` }} />
                  </div>

                  {repayId === loan.id ? (
                    <div className="flex gap-2">
                      <input type="number" value={repayAmount}
                        onChange={e => setRepayAmount(e.target.value)}
                        placeholder={maxRepay > 0 ? `Max ${maxRepay.toLocaleString("da-DK")}` : "0"}
                        className="flex-1 bg-slate-100 border border-slate-300 rounded-lg px-3 py-1.5
                          text-slate-900 text-sm focus:outline-none focus:border-amber-400" />
                      <button onClick={() => handleRepay(loan.id, repayAmount)}
                        disabled={repaying || !repayAmount || parseInt(repayAmount) < 1}
                        className="px-3 py-1.5 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-xs
                          hover:bg-[#f0d060] disabled:opacity-50">
                        {repaying ? "..." : "Betal"}
                      </button>
                      <button onClick={() => { setRepayId(null); setRepayAmount(""); }}
                        className="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-xs hover:bg-slate-100">
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setRepayId(loan.id); setRepayAmount(maxRepay > 0 ? maxRepay.toString() : ""); }}
                      disabled={maxRepay <= 0}
                      className="w-full py-1.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-lg
                        text-xs hover:bg-slate-100 hover:text-slate-900 transition-all disabled:opacity-30">
                      Betal rate →
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Optag lån */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        <h2 className="text-slate-900 font-semibold text-sm mb-4">Optag lån</h2>
        {configs.length === 0 ? (
          <p className="text-slate-400 text-sm">Ingen lånekonfiguration fundet for Division {team?.division}</p>
        ) : (
          <form onSubmit={handleTakeLoan}>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-slate-400 text-xs mb-1">Låntype</label>
                <select value={loanType} onChange={e => setLoanType(e.target.value)}
                  className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2
                    text-slate-900 text-sm focus:outline-none">
                  {configs.map(c => (
                    <option key={c.loan_type} value={c.loan_type}>{LOAN_TYPE_LABELS[c.loan_type]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1">Beløb (CZ$)</label>
                <input type="number" required min={1} value={loanAmount}
                  onChange={e => setLoanAmount(e.target.value)}
                  placeholder="f.eks. 500"
                  className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2
                    text-slate-900 text-sm focus:outline-none" />
              </div>
            </div>

            {selectedConfig && loanAmountNum > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="text-slate-400">Gebyr ({(selectedConfig.origination_fee_pct * 100).toFixed(0)}%)</p>
                    <p className="text-slate-600 font-mono mt-0.5">
                      {Math.round(loanAmountNum * selectedConfig.origination_fee_pct).toLocaleString("da-DK")} CZ$
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Rente/sæson</p>
                    <p className="text-slate-600 font-mono mt-0.5">{(selectedConfig.interest_rate_pct * 100).toFixed(0)}%</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Total tilbagebetaling</p>
                    <p className="text-amber-700 font-mono mt-0.5">
                      {Math.round(loanAmountNum * (1 + selectedConfig.origination_fee_pct)).toLocaleString("da-DK")} CZ$
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button type="submit" disabled={takingLoan || !loanAmount}
              className="w-full py-2.5 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm
                hover:bg-[#f0d060] disabled:opacity-50 transition-all">
              {takingLoan ? "Behandler..." : "Optag lån"}
            </button>
          </form>
        )}
      </div>

      {/* Lånebetingelser */}
      {loanData?.configs?.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
          <h2 className="text-slate-900 font-semibold text-sm mb-3">
            Lånebetingelser — Division {team?.division}
          </h2>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2 text-left text-slate-400">Type</th>
                  <th className="px-3 py-2 text-right text-slate-400">Gebyr</th>
                  <th className="px-3 py-2 text-right text-slate-400">Rente/sæson</th>
                  <th className="px-3 py-2 text-right text-slate-400">Sæsoner</th>
                  <th className="px-3 py-2 text-right text-slate-400">Gældsloft</th>
                </tr>
              </thead>
              <tbody>
                {loanData.configs.map(c => (
                  <tr key={`${c.division}-${c.loan_type}`} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-slate-900 font-medium">{LOAN_TYPE_LABELS[c.loan_type] || c.loan_type}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{(c.origination_fee_pct * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2 text-right text-slate-500">{(c.interest_rate_pct * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2 text-right text-slate-500">{c.seasons}</td>
                    <td className="px-3 py-2 text-right text-amber-700 font-mono">
                      {c.debt_ceiling?.toLocaleString("da-DK")} CZ$
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transaktionshistorik */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-slate-900 font-semibold text-sm mb-4">Transaktionshistorik</h2>
        {transactions.length === 0 ? (
          <p className="text-slate-400 text-sm">Ingen transaktioner endnu</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {transactions.map(tx => {
              const cfg = TX_CONFIG[tx.type] || { label: tx.type, color: "text-slate-500" };
              return (
                <div key={tx.id} className="flex items-center justify-between py-2.5">
                  <div className="flex-1 min-w-0 pr-3">
                    <p className="text-slate-600 text-xs truncate">{tx.description || cfg.label}</p>
                    <p className="text-slate-400 text-xs mt-0.5">{timeAgo(tx.created_at)}</p>
                  </div>
                  <p className={`font-mono text-sm font-bold flex-shrink-0 ${tx.amount >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {tx.amount >= 0 ? "+" : ""}{tx.amount?.toLocaleString("da-DK")} CZ$
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
