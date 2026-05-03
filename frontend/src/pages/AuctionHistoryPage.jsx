import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { getFlagEmoji } from "../lib/countryUtils";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";

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

function isAuctionSeller(auction, teamId) {
  return auction?.seller_team_id === teamId && auction?.rider?.team_id === teamId;
}

function getAuctionLeaderId(auction) {
  if (auction?.current_bidder_id) return auction.current_bidder_id;
  if (!auction?.is_guaranteed_sale && auction?.seller_team_id && auction?.rider?.team_id !== auction.seller_team_id) {
    return auction.seller_team_id;
  }
  return null;
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
      .select(`id, current_price, actual_end, status, is_guaranteed_sale, seller_team_id, current_bidder_id,
        rider:rider_id(id, firstname, lastname, uci_points, market_value, prize_earnings_bonus, is_u25, nationality_code, team_id),
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
    if (filter === "won") return getAuctionLeaderId(a) === myTeamId;
    if (filter === "sold") return isAuctionSeller(a, myTeamId);
    if (filter === "lost") return getAuctionLeaderId(a) !== myTeamId && !isAuctionSeller(a, myTeamId);
    return true;
  });

  const myWins = auctions.filter(a => getAuctionLeaderId(a) === myTeamId).length;
  const mySales = auctions.filter(a => isAuctionSeller(a, myTeamId)).length;
  const totalSpent = auctions
    .filter(a => a.current_bidder_id === myTeamId)
    .reduce((s, a) => s + (a.current_price || 0), 0);
  const totalEarned = auctions
    .filter(a => isAuctionSeller(a, myTeamId) && a.current_bidder_id)
    .reduce((s, a) => s + (a.current_price || 0), 0);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">Auktionshistorik</h1>
          <p className="text-cz-3 text-sm">{total} afsluttede auktioner</p>
        </div>
      </div>

      {/* My stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Købt", value: myWins, color: "text-cz-accent-t" },
          { label: "Solgt", value: mySales, color: "text-cz-info" },
          { label: "Brugt", value: `${totalSpent.toLocaleString("da-DK")} CZ$`, color: "text-cz-danger" },
          { label: "Tjent", value: `${totalEarned.toLocaleString("da-DK")} CZ$`, color: "text-cz-success" },
        ].map(s => (
          <div key={s.label} className="bg-cz-card border border-cz-border rounded-xl p-3 text-center">
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{s.label}</p>
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
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">◈</p>
          <p>Ingen afsluttede auktioner endnu</p>
        </div>
      ) : (
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cz-border">
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">Rytter</th>
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase hidden sm:table-cell">Sælger</th>
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase hidden sm:table-cell">Vinder</th>
                <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase">Pris</th>
                <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase hidden md:table-cell">Tidspunkt</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const iWon = getAuctionLeaderId(a) === myTeamId;
                const iSold = isAuctionSeller(a, myTeamId);
                const noSale = !a.current_bidder_id;
                return (
                  <tr key={a.id}
                    className={`border-b border-cz-border hover:bg-cz-subtle cursor-pointer
                      ${iWon ? "bg-cz-success-bg0/3" : iSold && !noSale ? "bg-cz-info-bg0/3" : ""}`}
                    onClick={() => a.rider?.id && navigate(`/riders/${a.rider.id}`)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {a.rider?.nationality_code && <span className="flex-shrink-0">{getFlagEmoji(a.rider.nationality_code)}</span>}
                        <span className="text-cz-1 font-medium">
                          {a.rider?.firstname} {a.rider?.lastname}
                        </span>
                        {a.rider?.is_u25 && (
                          <span className="text-[9px] uppercase bg-cz-info-bg0/20 text-cz-info px-1.5 py-0.5 rounded">U25</span>
                        )}
                        {iWon && <span className="text-[9px] uppercase bg-cz-success-bg text-cz-success px-1.5 py-0.5 rounded">Købt</span>}
                        {iSold && !noSale && <span className="text-[9px] uppercase bg-cz-info-bg0/20 text-cz-info px-1.5 py-0.5 rounded">Solgt</span>}
                      </div>
                      <p className="text-cz-3 text-xs mt-0.5">UCI: {a.rider?.uci_points?.toLocaleString("da-DK")} pt — Værdi: {formatCz(getRiderMarketValue(a.rider))}</p>
                    </td>
                    <td className="px-4 py-3 text-cz-2 hidden sm:table-cell">
                      {a.seller?.name || "—"}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {noSale ? (
                        <span className="text-cz-3 text-xs">Ingen bud</span>
                      ) : (
                        <span className="text-cz-2">{a.winner?.name || "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {noSale ? (
                        <span className="text-cz-3 text-xs">—</span>
                      ) : (
                        <span className={`font-mono font-bold
                          ${iWon ? "text-cz-danger" : iSold ? "text-cz-success" : "text-cz-accent-t"}`}>
                          {iWon ? "-" : iSold ? "+" : ""}{a.current_price?.toLocaleString("da-DK")} CZ$
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-cz-3 text-xs hidden md:table-cell">
                      {timeAgo(a.actual_end)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {total > PER_PAGE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-cz-border">
              <span className="text-cz-3 text-xs">
                Side {page} af {Math.ceil(total / PER_PAGE)}
              </span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
                    hover:bg-cz-subtle disabled:opacity-30 disabled:cursor-not-allowed">
                  ← Forrige
                </button>
                <button disabled={page * PER_PAGE >= total} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
                    hover:bg-cz-subtle disabled:opacity-30 disabled:cursor-not-allowed">
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
