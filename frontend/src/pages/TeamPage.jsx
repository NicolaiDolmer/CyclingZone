import { useState, useEffect } from "react";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { supabase } from "../lib/supabase";

const SQUAD_LIMITS = {
  1: { min: 20, max: 30 },
  2: { min: 14, max: 20 },
  3: { min: 8,  max: 10 },
};

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

function RiderActionModal({ rider, onClose, onAction }) {
  const [auctionPrice, setAuctionPrice] = useState(Math.max(rider.uci_points || 1, 1));
  const [transferPrice, setTransferPrice] = useState(Math.max(rider.uci_points || 1, 1));
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState("auction");

  async function startAuction() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: rider.id, starting_price: auctionPrice }),
    });
    const data = await res.json();
    if (res.ok) { setMsg("✅ Auktion startet!"); setTimeout(() => { onAction(); onClose(); }, 1500); }
    else setMsg(`❌ ${data.error}`);
    setLoading(false);
  }

  async function listTransfer() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: rider.id, asking_price: transferPrice }),
    });
    const data = await res.json();
    if (res.ok) { setMsg("✅ Sat på transferlisten!"); setTimeout(() => { onAction(); onClose(); }, 1500); }
    else setMsg(`❌ ${data.error}`);
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#0f0f18] border border-white/10 rounded-2xl w-full max-w-md">
        <div className="flex items-start justify-between p-5 border-b border-white/5">
          <div>
            <h2 className="text-white font-bold text-lg">{rider.firstname} {rider.lastname}</h2>
            <p className="text-[#e8c547] font-mono text-sm mt-0.5">{rider.uci_points?.toLocaleString("da-DK")} CZ$</p>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 border-b border-white/5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {STATS.map((key, i) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-white/30 text-xs">{STAT_LABELS[i]}</span>
                <span className={`font-mono text-xs font-bold ${rider[key] >= 80 ? "text-[#e8c547]" : "text-white/60"}`}>
                  {rider[key] || "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-5">
          <div className="flex gap-2 mb-4">
            {["auction","transfer"].map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                  ${tab === t ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20" : "text-white/40 border-white/5 hover:text-white"}`}>
                {t === "auction" ? "⚡ Auktion" : "↔ Transferliste"}
              </button>
            ))}
          </div>
          {tab === "auction" && (
            <div>
              <p className="text-white/40 text-xs mb-3">Start auktion — andre managers kan byde.</p>
              <div className="flex gap-2">
                <input type="number" value={auctionPrice} min={1} onChange={e => setAuctionPrice(parseInt(e.target.value))}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#e8c547]/50" />
                <button onClick={startAuction} disabled={loading}
                  className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
                  {loading ? "..." : "Start"}
                </button>
              </div>
            </div>
          )}
          {tab === "transfer" && (
            <div>
              <p className="text-white/40 text-xs mb-3">Sæt til salg med fast pris.</p>
              <div className="flex gap-2">
                <input type="number" value={transferPrice} min={1} onChange={e => setTransferPrice(parseInt(e.target.value))}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#e8c547]/50" />
                <button onClick={listTransfer} disabled={loading}
                  className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
                  {loading ? "..." : "Sæt til salg"}
                </button>
              </div>
            </div>
          )}
          {msg && <p className={`text-sm mt-3 ${msg.startsWith("✅") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function SquadTab({ riders, onSelectRider, windowOpen }) {
  const [showIncoming, setShowIncoming] = useState(true);
  const [showOutgoing, setShowOutgoing] = useState(true);

  // Current squad = riders with team_id = myTeam (regardless of pending)
  // Incoming = riders with pending_team_id = myTeam but team_id != myTeam
  // Outgoing = riders with team_id = myTeam but pending different team
  const currentRiders = riders.filter(r => !r.pending_team_id || r._isOutgoing);
  const incomingRiders = riders.filter(r => r._isIncoming);
  const outgoingRiders = riders.filter(r => r._isOutgoing);

  const displayRidersBase = [
    ...riders.filter(r => !r._isIncoming && !r._isOutgoing),
    ...(showIncoming ? incomingRiders : []),
    ...(showOutgoing ? outgoingRiders : []),
  ];
  const riderFilters = useClientRiderFilters(displayRidersBase);
  const displayRiders = riderFilters.filtered;

  const loanedInRiders  = riders.filter(r => r._isLoanedIn);
  const loanedOutRiders = riders.filter(r => r._isLoanedOut);
  const hasTransfers = incomingRiders.length > 0 || outgoingRiders.length > 0 || loanedInRiders.length > 0 || loanedOutRiders.length > 0;

  return (
    <div>
      {/* FM-style toggle */}
      {hasTransfers && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {incomingRiders.length > 0 && (
            <button onClick={() => setShowIncoming(!showIncoming)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${showIncoming
                  ? "bg-green-500/10 text-green-400 border-green-500/20"
                  : "bg-white/5 text-white/30 border-white/5"}`}>
              <span className="w-2 h-2 rounded-full bg-green-400" />
              Indgående transfers ({incomingRiders.length})
            </button>
          )}
          {outgoingRiders.length > 0 && (
            <button onClick={() => setShowOutgoing(!showOutgoing)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${showOutgoing
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : "bg-white/5 text-white/30 border-white/5"}`}>
              <span className="w-2 h-2 rounded-full bg-red-400" />
              Udgående transfers ({outgoingRiders.length})
            </button>
          )}
          {loanedInRiders.length > 0 && (
            <span className="flex items-center gap-2 px-3 py-1.5 text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-lg">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              Lejede ryttere ({loanedInRiders.length})
            </span>
          )}
          {loanedOutRiders.length > 0 && (
            <span className="flex items-center gap-2 px-3 py-1.5 text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-lg">
              <span className="w-2 h-2 rounded-full bg-yellow-400" />
              Udlejede ryttere ({loanedOutRiders.length})
            </span>
          )}
          {!windowOpen && (
            <span className="px-3 py-1.5 text-xs text-white/30 bg-white/3 border border-white/5 rounded-lg">
              🔒 Transfervindue lukket — skift træder i kraft ved næste åbning
            </span>
          )}
        </div>
      )}

      {displayRiders.length === 0 ? (
        <div className="text-center py-16 text-white/20">
          <p className="text-4xl mb-3">🚴</p>
          <p>Ingen ryttere på holdet endnu</p>
        </div>
      ) : (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-3 py-3 text-left text-white/30 font-medium uppercase tracking-wider">Rytter</th>
                  <th className="px-3 py-3 text-right text-white/30 font-medium">UCI</th>
                  <th className="px-3 py-3 text-right text-white/30 font-medium">Løn</th>
                  {STAT_LABELS.map(l => (
                    <th key={l} className="px-1.5 py-3 text-center text-white/20 font-medium w-10">{l}</th>
                  ))}
                  <th className="px-3 py-3 text-center text-white/20 font-medium">Handling</th>
                </tr>
              </thead>
              <tbody>
                {displayRiders.map(r => (
                  <tr key={r.id}
                    className={`border-b border-white/4 hover:bg-white/3
                      ${r._isIncoming  ? "bg-green-500/3"  :
                        r._isOutgoing  ? "bg-red-500/3"    :
                        r._isLoanedIn  ? "bg-purple-500/3" :
                        r._isLoanedOut ? "bg-yellow-500/3" : ""}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {r._isIncoming  && <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />}
                        {r._isOutgoing  && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                        {r._isLoanedIn  && <span className="w-2 h-2 rounded-full bg-purple-400 flex-shrink-0" />}
                        {r._isLoanedOut && <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />}
                        <span className="text-white text-sm font-medium">{r.firstname} {r.lastname}</span>
                        {r.is_u25       && <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>}
                        {r._isIncoming  && <span className="text-[9px] uppercase bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">Indgående</span>}
                        {r._isOutgoing  && <span className="text-[9px] uppercase bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Udgående</span>}
                        {r._isLoanedIn  && (
                          <span className="text-[9px] uppercase bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded"
                            title={`Lejet fra ${r._loanInInfo?.from_team?.name} · sæson ${r._loanInInfo?.start_season}–${r._loanInInfo?.end_season}`}>
                            På leje
                          </span>
                        )}
                        {r._isLoanedOut && (
                          <span className="text-[9px] uppercase bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded"
                            title={`Udlejet til ${r._loanOutInfo?.to_team?.name} · sæson ${r._loanOutInfo?.start_season}–${r._loanOutInfo?.end_season}`}>
                            Udlejet
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-[#e8c547] font-mono text-sm font-bold">
                      {r.uci_points?.toLocaleString("da-DK")}
                    </td>
                    <td className="px-3 py-2.5 text-right text-white/40 font-mono text-xs">{r.salary || 0}</td>
                    {STATS.map(key => (
                      <td key={key} className="px-1.5 py-2.5 text-center">
                        <span className={`font-mono ${r[key] >= 80 ? "text-[#e8c547] font-bold" : "text-white/40"}`}>
                          {r[key] || "—"}
                        </span>
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-center">
                      {!r._isIncoming && (
                        <button onClick={() => onSelectRider(r)}
                          className="px-2 py-1 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded text-xs transition-all border border-white/5">
                          Sælg / Auktion
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EconomyTab({ team, riders, transactions }) {
  const totalSalary = riders.filter(r => !r._isIncoming).reduce((s, r) => s + (r.salary || 0), 0);
  const totalValue  = riders.filter(r => !r._isIncoming).reduce((s, r) => s + (r.uci_points || 0), 0);
  const sponsorIncome = team?.sponsor_income || 100;
  const netPerSeason  = sponsorIncome - totalSalary;
  const typeLabel = {
    prize:"Præmiepenge", sponsor:"Sponsorindtægt", transfer_in:"Salg",
    transfer_out:"Køb", salary:"Lønninger", interest:"Renter",
  };
  const typeColor = {
    prize:"text-green-400", sponsor:"text-blue-400", transfer_in:"text-[#e8c547]",
    transfer_out:"text-red-400", salary:"text-orange-400", interest:"text-red-400",
  };
  const breakdown = transactions.reduce((acc, t) => {
    acc[t.type] = (acc[t.type] || 0) + (t.amount || 0);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Balance", value: `${team?.balance?.toLocaleString("da-DK")} CZ$`, color: team?.balance >= 0 ? "text-[#e8c547]" : "text-red-400" },
          { label: "Holdværdi", value: `${totalValue.toLocaleString("da-DK")} CZ$`, color: "text-white" },
          { label: "Løn/sæson", value: `${totalSalary.toLocaleString("da-DK")} CZ$`, color: "text-orange-400" },
          { label: "Sponsor/sæson", value: `${sponsorIncome.toLocaleString("da-DK")} CZ$`, color: "text-blue-400" },
        ].map(s => (
          <div key={s.label} className="bg-[#0f0f18] border border-white/5 rounded-xl p-4">
            <p className="text-white/30 text-xs uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`font-mono font-bold text-sm ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-4">Sæsonprognose</h3>
        <div className="space-y-2">
          {[
            { label: `Sponsorindtægt`, value: `+${sponsorIncome.toLocaleString("da-DK")} CZ$`, color: "text-blue-400" },
            { label: `Lønninger (${riders.filter(r=>!r._isIncoming).length} ryttere)`, value: `-${totalSalary.toLocaleString("da-DK")} CZ$`, color: "text-orange-400" },
          ].map(s => (
            <div key={s.label} className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-white/50 text-sm">{s.label}</span>
              <span className={`font-mono font-bold ${s.color}`}>{s.value}</span>
            </div>
          ))}
          <div className="flex justify-between items-center py-2 bg-white/3 rounded-lg px-3 mt-1">
            <span className={`text-sm font-semibold ${netPerSeason >= 0 ? "text-white" : "text-red-400"}`}>
              Netto (ekskl. præmiepenge)
            </span>
            <span className={`font-mono font-bold ${netPerSeason >= 0 ? "text-green-400" : "text-red-400"}`}>
              {netPerSeason >= 0 ? "+" : ""}{netPerSeason.toLocaleString("da-DK")} CZ$
            </span>
          </div>
        </div>
        {netPerSeason < 0 && (
          <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5">
            <p className="text-red-400 text-xs">⚠️ Lønninger overstiger sponsorindtægten. Du er afhængig af præmiepenge.</p>
          </div>
        )}
      </div>

      {Object.keys(breakdown).length > 0 && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
          <h3 className="text-white font-semibold text-sm mb-4">Fordeling denne sæson</h3>
          <div className="space-y-2">
            {Object.entries(breakdown).sort((a,b) => b[1]-a[1]).map(([type, amount]) => (
              <div key={type} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0">
                <span className="text-white/50 text-sm">{typeLabel[type] || type}</span>
                <span className={`font-mono font-bold text-sm ${typeColor[type] || (amount >= 0 ? "text-green-400" : "text-red-400")}`}>
                  {amount >= 0 ? "+" : ""}{amount.toLocaleString("da-DK")} CZ$
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h3 className="text-white font-semibold text-sm">Transaktionshistorik</h3>
        </div>
        {transactions.length === 0 ? (
          <div className="text-center py-10 text-white/20 text-sm">Ingen transaktioner endnu</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/5">
              <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase">Dato</th>
              <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase">Type</th>
              <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase hidden sm:table-cell">Beskrivelse</th>
              <th className="px-4 py-3 text-right text-white/30 font-medium text-xs uppercase">Beløb</th>
            </tr></thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id} className="border-b border-white/4 hover:bg-white/3">
                  <td className="px-4 py-2.5 text-white/30 text-xs">{new Date(t.created_at).toLocaleDateString("da-DK")}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded uppercase
                      ${typeColor[t.type] ? typeColor[t.type].replace("text-","bg-").replace("400","500/10") + " " + typeColor[t.type] : "bg-white/5 text-white/40"}`}>
                      {typeLabel[t.type] || t.type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-white/40 text-sm hidden sm:table-cell">{t.description}</td>
                  <td className={`px-4 py-2.5 text-right font-mono font-bold ${t.amount > 0 ? "text-green-400" : "text-red-400"}`}>
                    {t.amount > 0 ? "+" : ""}{t.amount?.toLocaleString("da-DK")} CZ$
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function TeamPage() {
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [windowOpen, setWindowOpen] = useState(false);
  const [tab, setTab] = useState("squad");
  const [selectedRider, setSelectedRider] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("*").eq("user_id", user.id).single();
    if (!t) { setLoading(false); return; }
    setTeam(t);

    const [ridersRes, pendingRes, finRes, windowRes, loansOutRes, loansInRes] = await Promise.all([
      supabase.from("riders")
        .select(`id, firstname, lastname, uci_points, salary, is_u25, pending_team_id, ${STATS.join(", ")}`)
        .eq("team_id", t.id)
        .order("uci_points", { ascending: false }),
      supabase.from("riders")
        .select(`id, firstname, lastname, uci_points, salary, is_u25, pending_team_id, ${STATS.join(", ")}`)
        .eq("pending_team_id", t.id)
        .order("uci_points", { ascending: false }),
      supabase.from("finance_transactions")
        .select("*").eq("team_id", t.id)
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("transfer_windows")
        .select("status").order("created_at", { ascending: false }).limit(1).single(),
      // Riders we're lending out
      supabase.from("loan_agreements")
        .select("rider_id, to_team:to_team_id(name), start_season, end_season")
        .eq("from_team_id", t.id).eq("status", "active"),
      // Riders we're borrowing
      supabase.from("loan_agreements")
        .select(`rider:rider_id(id, firstname, lastname, uci_points, salary, is_u25, ${STATS.join(", ")}), from_team:from_team_id(name), start_season, end_season, buy_option_price`)
        .eq("to_team_id", t.id).eq("status", "active"),
    ]);

    const loanedOutIds = new Set((loansOutRes.data || []).map(l => l.rider_id));
    const loanedOutMap = Object.fromEntries((loansOutRes.data || []).map(l => [l.rider_id, l]));

    const currentRiders = (ridersRes.data || []).map(r => ({
      ...r,
      _isOutgoing:  r.pending_team_id && r.pending_team_id !== t.id,
      _isLoanedOut: loanedOutIds.has(r.id),
      _loanOutInfo: loanedOutMap[r.id] || null,
    }));
    const incomingRiders = (pendingRes.data || []).map(r => ({ ...r, _isIncoming: true }));
    const loanedInRiders = (loansInRes.data || []).map(l => ({
      ...l.rider,
      _isLoanedIn:  true,
      _loanInInfo:  { from_team: l.from_team, start_season: l.start_season, end_season: l.end_season, buy_option_price: l.buy_option_price },
    }));

    setRiders([...currentRiders, ...incomingRiders, ...loanedInRiders]);
    setTransactions(finRes.data || []);
    setWindowOpen(windowRes.data?.status === "open");
    setLoading(false);
  }

  const currentRiders = riders.filter(r => !r._isIncoming);
  const totalSalary = currentRiders.reduce((s, r) => s + (r.salary || 0), 0);
  const totalValue  = currentRiders.reduce((s, r) => s + (r.uci_points || 0), 0);
  const incomingCount = riders.filter(r => r._isIncoming).length;
  const outgoingCount = riders.filter(r => r._isOutgoing).length;

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-white">{team?.name || "Mit Hold"}</h1>
          <span className={`text-xs px-2 py-1 rounded-full border ${
            windowOpen
              ? "bg-green-500/10 text-green-400 border-green-500/20"
              : "bg-white/5 text-white/30 border-white/8"}`}>
            {windowOpen ? "🟢 Transfervindue åbent" : "🔒 Transfervindue lukket"}
          </span>
        </div>
        <div className="flex gap-4 mt-1 flex-wrap text-sm">
          <span className="text-[#e8c547] font-mono font-bold">{team?.balance?.toLocaleString("da-DK")} CZ$</span>
          <span className="text-white/30">Division {team?.division}</span>
          <span className="text-white/30">{currentRiders.length} ryttere</span>
          {incomingCount > 0 && <span className="text-green-400 text-xs">+{incomingCount} indgående</span>}
          {outgoingCount > 0 && <span className="text-red-400 text-xs">-{outgoingCount} udgående</span>}
          <span className="text-white/30">Løn/sæson: {totalSalary.toLocaleString("da-DK")} CZ$</span>
          <span className="text-white/30">Holdværdi: {totalValue.toLocaleString("da-DK")} CZ$</span>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        {[
          { key: "squad", label: `Trup (${currentRiders.length})` },
          { key: "economy", label: "Økonomi" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${tab === t.key ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20" : "text-white/40 hover:text-white bg-[#0f0f18] border-white/5"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "squad" && (
        <SquadTab riders={riders} onSelectRider={setSelectedRider} windowOpen={windowOpen} />
      )}
      {tab === "economy" && (
        <EconomyTab team={team} riders={riders} transactions={transactions} />
      )}

      {selectedRider && (
        <RiderActionModal rider={selectedRider} onClose={() => setSelectedRider(null)} onAction={loadAll} />
      )}
    </div>
  );
}

export default TeamPage;
