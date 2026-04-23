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

const FILTERS = [
  { key: "all",              label: "Alt" },
  { key: "active_bids",      label: "Aktive bud" },
  { key: "auction_history",  label: "Auktionshistorik" },
  { key: "transfers",        label: "Transfers" },
];

export default function ActivityPage() {
  const navigate = useNavigate();
  const [myTeamId, setMyTeamId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [showOnlyMine, setShowOnlyMine] = useState(true);

  // Data
  const [activeAuctions, setActiveAuctions] = useState([]);
  const [auctionHistory, setAuctionHistory] = useState([]);
  const [transferOffers, setTransferOffers] = useState([]);
  const [transferListings, setTransferListings] = useState([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: team } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (!team) { setLoading(false); return; }
    setMyTeamId(team.id);

    const [activeRes, historyRes, offersRes, listingsRes] = await Promise.all([
      // Active auctions I'm involved in (bidding or selling)
      supabase.from("auctions")
        .select(`id, current_price, calculated_end, status, seller_team_id, current_bidder_id,
          rider:rider_id(id, firstname, lastname, uci_points),
          seller:seller_team_id(name),
          current_bidder:current_bidder_id(name)`)
        .in("status", ["active", "extended"])
        .or(`seller_team_id.eq.${team.id},current_bidder_id.eq.${team.id}`)
        .order("calculated_end"),

      // Completed auctions I was involved in
      supabase.from("auctions")
        .select(`id, current_price, actual_end, status, seller_team_id, current_bidder_id,
          rider:rider_id(id, firstname, lastname, uci_points),
          seller:seller_team_id(name),
          winner:current_bidder_id(name)`)
        .eq("status", "completed")
        .or(`seller_team_id.eq.${team.id},current_bidder_id.eq.${team.id}`)
        .order("actual_end", { ascending: false })
        .limit(50),

      // Transfer offers sent or received
      supabase.from("transfer_offers")
        .select(`id, offer_amount, counter_amount, status, created_at,
          listing:listing_id(id, asking_price, seller_team_id,
            rider:rider_id(id, firstname, lastname, uci_points),
            seller:seller_team_id(name)),
          buyer:buyer_team_id(id, name)`)
        .or(`buyer_team_id.eq.${team.id},listing_id.in.(select id from transfer_listings where seller_team_id = '${team.id}')`)
        .order("created_at", { ascending: false })
        .limit(50),

      // My active transfer listings
      supabase.from("transfer_listings")
        .select(`id, asking_price, status, created_at,
          rider:rider_id(id, firstname, lastname, uci_points)`)
        .eq("seller_team_id", team.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    setActiveAuctions(activeRes.data || []);
    setAuctionHistory(historyRes.data || []);
    setTransferOffers(offersRes.data || []);
    setTransferListings(listingsRes.data || []);
    setLoading(false);
  }

  // Summary counts
  const winningCount = activeAuctions.filter(a => a.current_bidder_id === myTeamId).length;
  const pendingOffersCount = transferOffers.filter(o =>
    o.status === "pending" && o.listing?.seller_team_id === myTeamId
  ).length;
  const myActiveSaleCount = activeAuctions.filter(a => a.seller_team_id === myTeamId).length;

  const offerStatusColor = {
    pending: "text-amber-700", accepted: "text-green-700",
    rejected: "text-red-700", countered: "text-orange-700",
  };
  const offerStatusLabel = {
    pending: "Afventer", accepted: "Accepteret",
    rejected: "Afvist", countered: "Modbud",
  };

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Min Aktivitet</h1>
        <p className="text-slate-400 text-sm">Overblik over bud, auktioner og transfers</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Auktioner jeg vinder", value: winningCount, color: "text-amber-700", filter: "active_bids" },
          { label: "Mine aktive salg", value: myActiveSaleCount, color: "text-blue-700", filter: "active_bids" },
          { label: "Afventende tilbud", value: pendingOffersCount, color: "text-orange-700", filter: "transfers" },
          { label: "Mine transferlister", value: transferListings.filter(l => l.status === "open").length, color: "text-slate-900", filter: "transfers" },
        ].map(s => (
          <button key={s.label} onClick={() => setFilter(s.filter)}
            className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-slate-300 transition-all">
            <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">{s.label}</p>
            <p className={`font-mono font-bold text-xl ${s.color}`}>{s.value}</p>
          </button>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${filter === f.key
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "text-slate-500 hover:text-slate-900 bg-white border-slate-200"}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Active auctions */}
      {(filter === "all" || filter === "active_bids") && activeAuctions.length > 0 && (
        <div className="mb-6">
          <h2 className="text-slate-900 font-semibold text-sm mb-3 flex items-center gap-2">
            <span className="text-amber-700">⚡</span> Aktive Auktioner
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase">Rytter</th>
                <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase hidden sm:table-cell">Din rolle</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs uppercase">Bud</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs uppercase">Slutter</th>
              </tr></thead>
              <tbody>
                {activeAuctions.map(a => {
                  const isSelling = a.seller_team_id === myTeamId;
                  const isWinning = a.current_bidder_id === myTeamId;
                  return (
                    <tr key={a.id}
                      className={`border-b border-slate-100 hover:bg-slate-100 cursor-pointer
                        ${isWinning ? "bg-green-500/3" : ""}`}
                      onClick={() => navigate("/auctions")}>
                      <td className="px-4 py-3">
                        <p className="text-slate-900 font-medium">{a.rider?.firstname} {a.rider?.lastname}</p>
                        <p className="text-slate-400 text-xs">UCI: {a.rider?.uci_points?.toLocaleString("da-DK")} CZ$</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {isSelling && <span className="text-xs bg-blue-500/10 text-blue-700 px-2 py-0.5 rounded">Sælger</span>}
                        {isWinning && <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">🏆 Vinder</span>}
                        {!isSelling && !isWinning && <span className="text-xs text-slate-400">Byder</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-amber-700 font-mono font-bold text-sm">
                          {a.current_price?.toLocaleString("da-DK")} CZ$
                        </span>
                        {a.current_bidder && !isWinning && (
                          <p className="text-slate-400 text-xs">{a.current_bidder.name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Countdown end={a.calculated_end} status={a.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Auction history */}
      {(filter === "all" || filter === "auction_history") && auctionHistory.length > 0 && (
        <div className="mb-6">
          <h2 className="text-slate-900 font-semibold text-sm mb-3 flex items-center gap-2">
            <span className="text-slate-500">◎</span> Auktionshistorik
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase">Rytter</th>
                <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase hidden sm:table-cell">Resultat</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs uppercase">Pris</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs uppercase hidden md:table-cell">Tidspunkt</th>
              </tr></thead>
              <tbody>
                {auctionHistory.map(a => {
                  const iWon = a.current_bidder_id === myTeamId;
                  const iSold = a.seller_team_id === myTeamId;
                  const noSale = !a.current_bidder_id;
                  return (
                    <tr key={a.id}
                      className={`border-b border-slate-100 hover:bg-slate-100 cursor-pointer`}
                      onClick={() => a.rider?.id && navigate(`/riders/${a.rider.id}`)}>
                      <td className="px-4 py-3">
                        <p className="text-slate-900 font-medium">{a.rider?.firstname} {a.rider?.lastname}</p>
                        <p className="text-slate-400 text-xs">UCI: {a.rider?.uci_points?.toLocaleString("da-DK")} CZ$</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {iWon && <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">🏆 Købt</span>}
                        {iSold && !noSale && <span className="text-xs bg-blue-500/10 text-blue-700 px-2 py-0.5 rounded">Solgt</span>}
                        {iSold && noSale && <span className="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded">Ingen bud</span>}
                        {!iWon && !iSold && <span className="text-xs text-slate-400">Tabt</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {noSale ? (
                          <span className="text-slate-300 text-xs">—</span>
                        ) : (
                          <span className={`font-mono font-bold text-sm
                            ${iWon ? "text-red-700" : iSold ? "text-green-700" : "text-slate-500"}`}>
                            {iWon ? "-" : iSold ? "+" : ""}{a.current_price?.toLocaleString("da-DK")} CZ$
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-400 text-xs hidden md:table-cell">
                        {timeAgo(a.actual_end)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transfer offers */}
      {(filter === "all" || filter === "transfers") && transferOffers.length > 0 && (
        <div className="mb-6">
          <h2 className="text-slate-900 font-semibold text-sm mb-3 flex items-center gap-2">
            <span className="text-blue-700">↔</span> Transfertilbud
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase">Rytter</th>
                <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase">Retning</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs uppercase">Tilbud</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs uppercase">Status</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs uppercase hidden md:table-cell">Tidspunkt</th>
              </tr></thead>
              <tbody>
                {transferOffers.map(o => {
                  const isBuyer = o.buyer?.id === myTeamId;
                  return (
                    <tr key={o.id}
                      className="border-b border-slate-100 hover:bg-slate-100 cursor-pointer"
                      onClick={() => navigate("/transfers")}>
                      <td className="px-4 py-3">
                        <p className="text-slate-900 font-medium">
                          {o.listing?.rider?.firstname} {o.listing?.rider?.lastname}
                        </p>
                        <p className="text-slate-400 text-xs">
                          {isBuyer ? `Fra: ${o.listing?.seller?.name}` : `Fra: ${o.buyer?.name}`}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded
                          ${isBuyer ? "bg-blue-500/10 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
                          {isBuyer ? "Sendt" : "Modtaget"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="text-slate-900 font-mono text-sm">{o.offer_amount?.toLocaleString("da-DK")} CZ$</p>
                        {o.counter_amount && (
                          <p className="text-orange-700 text-xs font-mono">Modbud: {o.counter_amount?.toLocaleString("da-DK")} CZ$</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-medium ${offerStatusColor[o.status] || "text-slate-500"}`}>
                          {offerStatusLabel[o.status] || o.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-400 text-xs hidden md:table-cell">
                        {timeAgo(o.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* My transfer listings */}
      {(filter === "all" || filter === "transfers") && transferListings.length > 0 && (
        <div className="mb-6">
          <h2 className="text-slate-900 font-semibold text-sm mb-3 flex items-center gap-2">
            <span className="text-slate-500">📋</span> Mine Transferlister
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs uppercase">Rytter</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs uppercase">Udbudspris</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs uppercase">Status</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs uppercase hidden md:table-cell">Oprettet</th>
              </tr></thead>
              <tbody>
                {transferListings.map(l => (
                  <tr key={l.id}
                    className="border-b border-slate-100 hover:bg-slate-100 cursor-pointer"
                    onClick={() => navigate("/transfers")}>
                    <td className="px-4 py-3">
                      <p className="text-slate-900 font-medium">{l.rider?.firstname} {l.rider?.lastname}</p>
                      <p className="text-slate-400 text-xs">UCI: {l.rider?.uci_points?.toLocaleString("da-DK")} CZ$</p>
                    </td>
                    <td className="px-4 py-3 text-right text-amber-700 font-mono font-bold text-sm">
                      {l.asking_price?.toLocaleString("da-DK")} CZ$
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs px-2 py-0.5 rounded
                        ${l.status === "open" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-400"}`}>
                        {l.status === "open" ? "Aktiv" : l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 text-xs hidden md:table-cell">
                      {timeAgo(l.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading &&
        activeAuctions.length === 0 &&
        auctionHistory.length === 0 &&
        transferOffers.length === 0 &&
        transferListings.length === 0 && (
        <div className="text-center py-16 text-slate-300">
          <p className="text-4xl mb-3">◎</p>
          <p>Ingen aktivitet endnu</p>
          <p className="text-sm mt-2">Start en auktion eller send et transfertilbud</p>
        </div>
      )}
    </div>
  );
}

function Countdown({ end, status }) {
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    function update() {
      const diff = new Date(end) - new Date();
      if (diff <= 0) { setText("Afsluttet"); return; }
      setUrgent(diff < 600000);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (h > 0) setText(`${h}t ${m}m`);
      else if (m > 0) setText(`${m}m ${s}s`);
      else setText(`${s}s`);
    }
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [end]);
  return (
    <span className={`font-mono text-sm font-bold ${urgent ? "text-red-700" : "text-slate-500"} ${status === "extended" ? "text-orange-700" : ""}`}>
      {text}
    </span>
  );
}
