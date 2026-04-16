import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

// ── Auction modal ─────────────────────────────────────────────────────────────
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
                <input type="number" value={auctionPrice} min={1}
                  onChange={e => setAuctionPrice(parseInt(e.target.value))}
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
                <input type="number" value={transferPrice} min={1}
                  onChange={e => setTransferPrice(parseInt(e.target.value))}
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

// ── Economy tab ───────────────────────────────────────────────────────────────
function EconomyTab({ team, riders, transactions }) {
  const totalSalary = riders.reduce((s, r) => s + (r.salary || 0), 0);
  const totalValue  = riders.reduce((s, r) => s + (r.uci_points || 0), 0);

  // Season forecast
  const sponsorIncome = team?.sponsor_income || 100;
  const netPerSeason  = sponsorIncome - totalSalary;
  const weeksOfDebt   = team?.balance < 0
    ? Math.ceil(Math.abs(team.balance) * 0.10)
    : 0;

  // Transaction breakdown
  const breakdown = transactions.reduce((acc, t) => {
    const key = t.type;
    acc[key] = (acc[key] || 0) + (t.amount || 0);
    return acc;
  }, {});

  const typeLabel = {
    prize: "Præmiepenge", sponsor: "Sponsorindtægt",
    transfer_in: "Salg af ryttere", transfer_out: "Køb af ryttere",
    salary: "Lønninger", interest: "Renter", bonus: "Bonus",
  };
  const typeColor = {
    prize: "text-green-400", sponsor: "text-blue-400",
    transfer_in: "text-[#e8c547]", transfer_out: "text-red-400",
    salary: "text-orange-400", interest: "text-red-400", bonus: "text-green-400",
  };

  return (
    <div className="space-y-4">
      {/* Balance overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Balance", value: `${team?.balance?.toLocaleString("da-DK")} CZ$`,
            color: team?.balance >= 0 ? "text-[#e8c547]" : "text-red-400" },
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

      {/* Season forecast */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-4">Sæsonprognose</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-white/5">
            <span className="text-white/50 text-sm">Sponsorindtægt</span>
            <span className="text-blue-400 font-mono font-bold">+{sponsorIncome.toLocaleString("da-DK")} CZ$</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-white/5">
            <span className="text-white/50 text-sm">Lønninger ({riders.length} ryttere)</span>
            <span className="text-orange-400 font-mono font-bold">-{totalSalary.toLocaleString("da-DK")} CZ$</span>
          </div>
          {team?.balance < 0 && (
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-white/50 text-sm">Renter på gæld (10%)</span>
              <span className="text-red-400 font-mono font-bold">-{weeksOfDebt.toLocaleString("da-DK")} CZ$</span>
            </div>
          )}
          <div className="flex justify-between items-center py-2 bg-white/3 rounded-lg px-3">
            <span className={`text-sm font-semibold ${netPerSeason >= 0 ? "text-white" : "text-red-400"}`}>
              Netto (uden præmiepenge)
            </span>
            <span className={`font-mono font-bold ${netPerSeason >= 0 ? "text-green-400" : "text-red-400"}`}>
              {netPerSeason >= 0 ? "+" : ""}{netPerSeason.toLocaleString("da-DK")} CZ$
            </span>
          </div>
        </div>
        {netPerSeason < 0 && (
          <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5">
            <p className="text-red-400 text-xs">
              ⚠️ Dine lønninger overstiger sponsorindtægten. Du er afhængig af præmiepenge for at undgå gæld.
            </p>
          </div>
        )}
      </div>

      {/* Breakdown by category */}
      {Object.keys(breakdown).length > 0 && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
          <h3 className="text-white font-semibold text-sm mb-4">Sæsonfordeling</h3>
          <div className="space-y-2">
            {Object.entries(breakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([type, amount]) => (
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

      {/* Transaction history */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h3 className="text-white font-semibold text-sm">Transaktionshistorik</h3>
        </div>
        {transactions.length === 0 ? (
          <div className="text-center py-10 text-white/20 text-sm">Ingen transaktioner endnu</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase">Dato</th>
                <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase">Type</th>
                <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase hidden sm:table-cell">Beskrivelse</th>
                <th className="px-4 py-3 text-right text-white/30 font-medium text-xs uppercase">Beløb</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id} className="border-b border-white/4 hover:bg-white/3">
                  <td className="px-4 py-2.5 text-white/30 text-xs whitespace-nowrap">
                    {new Date(t.created_at).toLocaleDateString("da-DK")}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded uppercase tracking-wider
                      ${t.type === "prize"        ? "bg-green-500/10 text-green-400" :
                        t.type === "sponsor"       ? "bg-blue-500/10 text-blue-400" :
                        t.type === "transfer_in"   ? "bg-[#e8c547]/10 text-[#e8c547]" :
                        t.type === "transfer_out"  ? "bg-red-500/10 text-red-400" :
                        t.type === "salary"        ? "bg-orange-500/10 text-orange-400" :
                        t.type === "interest"      ? "bg-red-500/10 text-red-400" :
                        "bg-white/5 text-white/40"}`}>
                      {typeLabel[t.type] || t.type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-white/40 text-sm hidden sm:table-cell">{t.description}</td>
                  <td className={`px-4 py-2.5 text-right font-mono font-bold
                    ${t.amount > 0 ? "text-green-400" : "text-red-400"}`}>
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

// ── Main TeamPage ─────────────────────────────────────────────────────────────
export function TeamPage() {
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [tab, setTab] = useState("squad");
  const [selectedRider, setSelectedRider] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadTeam(); }, []);

  async function loadTeam() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("*").eq("user_id", user.id).single();
    if (!t) { setLoading(false); return; }
    setTeam(t);

    const [ridersRes, finRes] = await Promise.all([
      supabase.from("riders")
        .select(`id, firstname, lastname, uci_points, salary, is_u25, ${STATS.join(", ")}`)
        .eq("team_id", t.id)
        .order("uci_points", { ascending: false }),
      supabase.from("finance_transactions")
        .select("*").eq("team_id", t.id)
        .order("created_at", { ascending: false }).limit(100),
    ]);
    setRiders(ridersRes.data || []);
    setTransactions(finRes.data || []);
    setLoading(false);
  }

  const totalSalary = riders.reduce((s, r) => s + (r.salary || 0), 0);
  const totalValue  = riders.reduce((s, r) => s + (r.uci_points || 0), 0);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const TABS = [
    { key: "squad",    label: `Trup (${riders.length})` },
    { key: "economy",  label: "Økonomi" },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">{team?.name || "Mit Hold"}</h1>
        <div className="flex gap-4 mt-1 flex-wrap text-sm">
          <span className="text-[#e8c547] font-mono font-bold">{team?.balance?.toLocaleString("da-DK")} CZ$</span>
          <span className="text-white/30">Division {team?.division}</span>
          <span className="text-white/30">{riders.length} ryttere</span>
          <span className="text-white/30">Løn/sæson: {totalSalary.toLocaleString("da-DK")} CZ$</span>
          <span className="text-white/30">Holdværdi: {totalValue.toLocaleString("da-DK")} CZ$</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${tab === t.key
                ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20"
                : "text-white/40 hover:text-white bg-[#0f0f18] border-white/5"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Squad tab */}
      {tab === "squad" && (
        riders.length === 0 ? (
          <div className="text-center py-16 text-white/20">
            <p className="text-4xl mb-3">🚴</p>
            <p>Ingen ryttere på holdet endnu</p>
            <p className="text-sm mt-2">Gå til Ryttere og start en auktion</p>
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
                  {riders.map(r => (
                    <tr key={r.id} className="border-b border-white/4 hover:bg-white/3">
                      <td className="px-3 py-2.5">
                        <span className="text-white text-sm font-medium">{r.firstname} {r.lastname}</span>
                        {r.is_u25 && (
                          <span className="ml-2 text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[#e8c547] font-mono text-sm font-bold">
                        {r.uci_points?.toLocaleString("da-DK")}
                      </td>
                      <td className="px-3 py-2.5 text-right text-white/40 font-mono text-xs">
                        {r.salary || 0}
                      </td>
                      {STATS.map(key => (
                        <td key={key} className="px-1.5 py-2.5 text-center">
                          <span className={`font-mono ${r[key] >= 80 ? "text-[#e8c547] font-bold" : "text-white/40"}`}>
                            {r[key] || "—"}
                          </span>
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={() => setSelectedRider(r)}
                          className="px-2 py-1 bg-white/5 hover:bg-white/10 text-white/50
                            hover:text-white rounded text-xs transition-all border border-white/5">
                          Sælg / Auktion
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Economy tab */}
      {tab === "economy" && (
        <EconomyTab team={team} riders={riders} transactions={transactions} />
      )}

      {selectedRider && (
        <RiderActionModal
          rider={selectedRider}
          onClose={() => setSelectedRider(null)}
          onAction={loadTeam}
        />
      )}
    </div>
  );
}

export default TeamPage;
