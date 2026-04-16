import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diff = new Date() - new Date(dateStr);
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "Lige nu";
  if (m < 60) return `${m}m siden`;
  if (h < 24) return `${h}t siden`;
  if (d < 7) return `${d}d siden`;
  return new Date(dateStr).toLocaleDateString("da-DK");
}

export default function AuctionHistoryPage() {
  const navigate = useNavigate();
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);
  const [filter, setFilter] = useState("all"); // all | won | sold | lost
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const PER_PAGE = 30;

  useEffect(() => { loadMyTeam(); }, []);
  useEffect(() => { loadAuctions(); }, [filter, page]);

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (t) setMyTeamId(t.id);
  }

  async function loadAuctions() {
    setLoading(true);
    let query = supabase
      .from("auctions")
      .select(`id, current_price, actual_end, status, seller_team_id, current_bidder_id,
        rider:rider_id(id, firstname, lastname, uci_points, is_u25),
        seller:seller_team_id(id, name),
        winner:current_bidder_id(id, name)`,
        { count: "exact" })
      .eq("status", "completed")
      .order("actual_end", { ascending: false })
      .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);

    const { data, count } = await query;
    setAuctions(data || []);
    setTotal(count || 0);
    setLoading(false);
  }

  const filtered = auctions.filter(a => {
    if (filter === "won") return a.current_bidder_id === myTeamId;
    if (filter === "sold") return a.seller_team_id === myTeamId;
    if (filter === "lost") return a.current_bidder_id !== myTeamId && a.seller_team_id !== myTeamId;
    return true;
  });

  const myWins = auctions.filter(a => a.current_bidder_id === myTeamId).length;
  const mySales = auctions.filter(a => a.seller_team_id === myTeamId).length;
  const totalSpent = auctions
    .filter(a => a.current_bidder_id === myTeamId)
    .reduce((s, a) => s + (a.current_price || 0), 0);
  const totalEarned = auctions
    .filter(a => a.seller_team_id === myTeamId && a.current_bidder_id)
    .reduce((s, a) => s + (a.current_price || 0), 0);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Auktionshistorik</h1>
          <p className="text-white/30 text-sm">{total} afsluttede auktioner</p>
        </div>
      </div>

      {/* My stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Købt", value: myWins, color: "text-[#e8c547]" },
          { label: "Solgt", value: mySales, color: "text-blue-400" },
          { label: "Brugt", value: `${totalSpent.toLocaleString("da-DK")} CZ$`, color: "text-red-400" },
          { label: "Tjent", value: `${totalEarned.toLocaleString("da-DK")} CZ$`, color: "text-green-400" },
        ].map(s => (
          <div key={s.label} className="bg-[#0f0f18] border border-white/5 rounded-xl p-3 text-center">
            <p className="text-white/30 text-xs uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`font-mono font-bold text-sm ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {[
          { key: "all", label: "Alle" },
          { key: "won", label: `Købt (${myWins})` },
          { key: "sold", label: `Solgt (${mySales})` },
        ].map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${filter === t.key
                ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20"
                : "text-white/40 hover:text-white bg-[#0f0f18] border-white/5"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-white/20">
          <p className="text-4xl mb-3">◈</p>
          <p>Ingen afsluttede auktioner endnu</p>
        </div>
      ) : (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase">Rytter</th>
                <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase hidden sm:table-cell">Sælger</th>
                <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase hidden sm:table-cell">Vinder</th>
                <th className="px-4 py-3 text-right text-white/30 font-medium text-xs uppercase">Pris</th>
                <th className="px-4 py-3 text-right text-white/30 font-medium text-xs uppercase hidden md:table-cell">Tidspunkt</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const iWon = a.current_bidder_id === myTeamId;
                const iSold = a.seller_team_id === myTeamId;
                const noSale = !a.current_bidder_id;
                return (
                  <tr key={a.id}
                    className={`border-b border-white/4 hover:bg-white/3 cursor-pointer
                      ${iWon ? "bg-green-500/3" : iSold && !noSale ? "bg-blue-500/3" : ""}`}
                    onClick={() => a.rider?.id && navigate(`/riders/${a.rider.id}`)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">
                          {a.rider?.firstname} {a.rider?.lastname}
                        </span>
                        {a.rider?.is_u25 && (
                          <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>
                        )}
                        {iWon && <span className="text-[9px] uppercase bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">Købt</span>}
                        {iSold && !noSale && <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">Solgt</span>}
                      </div>
                      <p className="text-white/30 text-xs mt-0.5">UCI: {a.rider?.uci_points?.toLocaleString("da-DK")} CZ$</p>
                    </td>
                    <td className="px-4 py-3 text-white/50 hidden sm:table-cell">
                      {a.seller?.name || "—"}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {noSale ? (
                        <span className="text-white/20 text-xs">Ingen bud</span>
                      ) : (
                        <span className="text-white/70">{a.winner?.name || "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {noSale ? (
                        <span className="text-white/20 text-xs">—</span>
                      ) : (
                        <span className={`font-mono font-bold
                          ${iWon ? "text-red-400" : iSold ? "text-green-400" : "text-[#e8c547]"}`}>
                          {iWon ? "-" : iSold ? "+" : ""}{a.current_price?.toLocaleString("da-DK")} CZ$
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-white/30 text-xs hidden md:table-cell">
                      {timeAgo(a.actual_end)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {total > PER_PAGE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
              <span className="text-white/30 text-xs">
                Side {page} af {Math.ceil(total / PER_PAGE)}
              </span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1.5 bg-white/5 rounded text-white/50 text-xs
                    hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed">
                  ← Forrige
                </button>
                <button disabled={page * PER_PAGE >= total} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 bg-white/5 rounded text-white/50 text-xs
                    hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed">
                  Næste →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
