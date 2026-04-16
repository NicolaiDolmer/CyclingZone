import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

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
            <p className="text-[#e8c547] font-mono text-sm mt-0.5">{rider.uci_points?.toLocaleString("da-DK")} UCI CZ$</p>
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
              <p className="text-white/40 text-xs mb-3">Start auktion — andre managers kan byde. Slutter automatisk inden for vinduet.</p>
              <div className="flex gap-2">
                <input type="number" value={auctionPrice} min={1}
                  onChange={e => setAuctionPrice(parseInt(e.target.value))}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#e8c547]/50" />
                <button onClick={startAuction} disabled={loading}
                  className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] transition-all disabled:opacity-50">
                  {loading ? "..." : "Start"}
                </button>
              </div>
            </div>
          )}
          {tab === "transfer" && (
            <div>
              <p className="text-white/40 text-xs mb-3">Sæt rytter til salg med fast pris på transfermarkedet.</p>
              <div className="flex gap-2">
                <input type="number" value={transferPrice} min={1}
                  onChange={e => setTransferPrice(parseInt(e.target.value))}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#e8c547]/50" />
                <button onClick={listTransfer} disabled={loading}
                  className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] transition-all disabled:opacity-50">
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
      supabase.from("riders").select(`id, firstname, lastname, uci_points, salary, is_u25, ${STATS.join(", ")}`).eq("team_id", t.id).order("uci_points", { ascending: false }),
      supabase.from("finance_transactions").select("*").eq("team_id", t.id).order("created_at", { ascending: false }).limit(50),
    ]);
    setRiders(ridersRes.data || []);
    setTransactions(finRes.data || []);
    setLoading(false);
  }

  const totalSalary = riders.reduce((s, r) => s + (r.salary || 0), 0);
  const totalValue = riders.reduce((s, r) => s + (r.uci_points || 0), 0);

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">{team?.name || "Mit Hold"}</h1>
        <div className="flex gap-4 mt-1 flex-wrap">
          <span className="text-[#e8c547] font-mono text-sm font-bold">{team?.balance?.toLocaleString("da-DK")} CZ$</span>
          <span className="text-white/30 text-sm">Division {team?.division}</span>
          <span className="text-white/30 text-sm">{riders.length} ryttere</span>
          <span className="text-white/30 text-sm">Løn/sæson: {totalSalary.toLocaleString("da-DK")} CZ$</span>
          <span className="text-white/30 text-sm">Holdværdi: {totalValue.toLocaleString("da-DK")} CZ$</span>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        {[{ key: "squad", label: `Trup (${riders.length})` }, { key: "finances", label: "Økonomi" }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${tab === t.key ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20" : "text-white/40 hover:text-white bg-[#0f0f18] border-white/5"}`}>
            {t.label}
          </button>
        ))}
      </div>

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
                    {STAT_LABELS.map(l => <th key={l} className="px-1.5 py-3 text-center text-white/20 font-medium w-10">{l}</th>)}
                    <th className="px-3 py-3 text-center text-white/20 font-medium">Handling</th>
                  </tr>
                </thead>
                <tbody>
                  {riders.map(r => (
                    <tr key={r.id} className="border-b border-white/4 hover:bg-white/3">
                      <td className="px-3 py-2.5">
                        <span className="text-white text-sm font-medium">{r.firstname} {r.lastname}</span>
                        {r.is_u25 && <span className="ml-2 text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[#e8c547] font-mono text-sm font-bold">{r.uci_points?.toLocaleString("da-DK")}</td>
                      <td className="px-3 py-2.5 text-right text-white/40 font-mono text-xs">{r.salary || 0}</td>
                      {STATS.map(key => (
                        <td key={key} className="px-1.5 py-2.5 text-center">
                          <span className={`font-mono ${r[key] >= 80 ? "text-[#e8c547] font-bold" : "text-white/40"}`}>{r[key] || "—"}</span>
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={() => setSelectedRider(r)}
                          className="px-2 py-1 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded text-xs transition-all border border-white/5">
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

      {tab === "finances" && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
          {transactions.length === 0 ? (
            <div className="text-center py-16 text-white/20"><p>Ingen transaktioner endnu</p></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-4 py-3 text-left text-white/30 font-medium uppercase tracking-wider text-xs">Dato</th>
                  <th className="px-4 py-3 text-left text-white/30 font-medium uppercase tracking-wider text-xs">Type</th>
                  <th className="px-4 py-3 text-left text-white/30 font-medium uppercase tracking-wider text-xs">Beskrivelse</th>
                  <th className="px-4 py-3 text-right text-white/30 font-medium uppercase tracking-wider text-xs">Beløb</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(t => (
                  <tr key={t.id} className="border-b border-white/4 hover:bg-white/3">
                    <td className="px-4 py-2.5 text-white/30 text-xs">{new Date(t.created_at).toLocaleDateString("da-DK")}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded uppercase tracking-wider
                        ${t.type === "prize" ? "bg-green-500/10 text-green-400" :
                          t.type === "sponsor" ? "bg-blue-500/10 text-blue-400" :
                          t.type === "transfer_in" ? "bg-[#e8c547]/10 text-[#e8c547]" :
                          t.type === "transfer_out" ? "bg-red-500/10 text-red-400" :
                          t.type === "salary" ? "bg-orange-500/10 text-orange-400" :
                          "bg-white/5 text-white/40"}`}>
                        {t.type === "prize" ? "Præmie" : t.type === "sponsor" ? "Sponsor" :
                         t.type === "transfer_in" ? "Salg" : t.type === "transfer_out" ? "Køb" :
                         t.type === "salary" ? "Løn" : t.type === "interest" ? "Renter" : t.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-white/50 text-sm">{t.description}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-bold ${t.amount > 0 ? "text-green-400" : "text-red-400"}`}>
                      {t.amount > 0 ? "+" : ""}{t.amount?.toLocaleString("da-DK")} CZ$
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selectedRider && (
        <RiderActionModal rider={selectedRider} onClose={() => setSelectedRider(null)} onAction={loadTeam} />
      )}
    </div>
  );
}

export default TeamPage;
