import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { statBg } from "../lib/statBg";
import { ConfettiModal } from "../components/ConfettiModal";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

// ── Countdown timer ───────────────────────────────────────────────────────────
function Countdown({ end, status }) {
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    if (status === "completed") { setText("Afsluttet"); return; }
    function update() {
      const diff = new Date(end) - new Date();
      if (diff <= 0) { setText("Udløbet"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setUrgent(diff < 600000);
      setText(h > 0 ? `${h}t ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    }
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [end, status]);

  return (
    <span className={`font-mono text-xs ${urgent ? "text-red-400 animate-pulse" : "text-white/50"}`}>
      {text}
    </span>
  );
}

// ── Auction table row ─────────────────────────────────────────────────────────
function AuctionRow({ auction, myTeamId, myBalance, onBid, onNavigate }) {
  const minBid = (auction.current_price || 1) + (auction.min_increment || 1);
  const [bidAmount, setBidAmount] = useState(minBid);
  const [bidStatus, setBidStatus] = useState(null);

  const isMyRider = auction.rider?.team_id === myTeamId;
  const isSeller  = auction.seller_team_id === myTeamId;
  const imWinning = auction.current_bidder_id === myTeamId;
  const canBid    = !isMyRider && auction.status !== "completed";

  useEffect(() => {
    setBidAmount((auction.current_price || 1) + (auction.min_increment || 1));
  }, [auction.current_price, auction.min_increment]);

  async function handleBid() {
    if (bidAmount > myBalance) {
      setBidStatus("error");
      setTimeout(() => setBidStatus(null), 3000);
      return;
    }
    setBidStatus("loading");
    await onBid(auction.id, bidAmount);
    setBidStatus("success");
    setTimeout(() => setBidStatus(null), 2500);
  }

  const r = auction.rider;
  const age = r?.birthdate ? new Date().getFullYear() - new Date(r.birthdate).getFullYear() : null;

  return (
    <tr className={`border-b border-white/4 hover:bg-white/2 transition-colors
      ${imWinning ? "bg-[#e8c547]/3" : ""}`}>

      {/* Rytter */}
      <td className="px-3 py-2.5 min-w-[140px]">
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => onNavigate(r?.id)}
            className="text-white text-sm font-medium hover:text-[#e8c547] transition-colors text-left truncate max-w-[160px]">
            {r?.firstname} {r?.lastname}
          </button>
          <div className="flex items-center gap-1 flex-wrap">
            {imWinning && (
              <span className="text-[9px] uppercase bg-[#e8c547]/15 text-[#e8c547] px-1.5 py-0.5 rounded">
                Vinder
              </span>
            )}
            {isSeller && (
              <span className="text-[9px] uppercase bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded">
                Sælger
              </span>
            )}
            {isMyRider && !isSeller && (
              <span className="text-[9px] uppercase bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded">
                Din
              </span>
            )}
            {auction.status === "extended" && (
              <span className="text-[9px] uppercase bg-orange-500/15 text-orange-400 px-1.5 py-0.5 rounded">
                ⚡ Ext
              </span>
            )}
            {r?.is_u25 && (
              <span className="text-[9px] uppercase bg-white/8 text-white/30 px-1.5 py-0.5 rounded">U25</span>
            )}
          </div>
        </div>
      </td>

      {/* Alder */}
      <td className="px-2 py-2.5 text-center text-white/40 font-mono text-xs hidden lg:table-cell">
        {age ?? "—"}
      </td>

      {/* UCI */}
      <td className="px-2 py-2.5 text-right text-[#e8c547] font-mono font-bold text-xs whitespace-nowrap">
        {r?.uci_points?.toLocaleString("da-DK") || "—"}
      </td>

      {/* Stats */}
      {STATS.map(key => (
        <td key={key} className="px-1 py-2.5 text-center">
          <span className={`font-mono text-xs ${statBg(r?.[key] || 0)}`}>
            {r?.[key] || "—"}
          </span>
        </td>
      ))}

      {/* Højeste bud */}
      <td className="px-3 py-2.5 text-right whitespace-nowrap">
        <span className="text-white font-mono font-bold text-sm">
          {auction.current_price?.toLocaleString("da-DK")}
        </span>
        <span className="text-white/30 text-xs ml-1">CZ$</span>
        {auction.current_bidder && !imWinning && (
          <p className="text-white/25 text-[10px] truncate max-w-[100px]">
            {auction.current_bidder.name}
          </p>
        )}
      </td>

      {/* Tid tilbage */}
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        <Countdown end={auction.calculated_end} status={auction.status} />
      </td>

      {/* Byd */}
      <td className="px-3 py-2.5">
        {canBid ? (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={bidAmount}
              min={minBid}
              onChange={e => setBidAmount(parseInt(e.target.value) || minBid)}
              className="w-24 bg-white/5 border border-white/10 rounded px-2 py-1.5
                text-white font-mono text-xs focus:outline-none focus:border-[#e8c547]/50"
            />
            <button
              onClick={handleBid}
              disabled={bidStatus === "loading" || bidAmount < minBid}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-all whitespace-nowrap
                ${bidStatus === "error"   ? "bg-red-500/20 text-red-400 border border-red-500/30" :
                  bidStatus === "success" ? "bg-green-500/20 text-green-400 border border-green-500/30" :
                  imWinning
                    ? "bg-[#e8c547]/15 text-[#e8c547] border border-[#e8c547]/30 hover:bg-[#e8c547]/25"
                    : "bg-[#e8c547] text-[#0a0a0f] hover:bg-[#f0d060]"}
                disabled:opacity-50`}>
              {bidStatus === "loading" ? "..." :
               bidStatus === "error"   ? "Fejl" :
               bidStatus === "success" ? "✓" :
               imWinning ? "Hæv" : "Byd"}
            </button>
          </div>
        ) : isSeller ? (
          <span className="text-white/20 text-xs">Du sælger</span>
        ) : (
          <span className="text-white/20 text-xs">—</span>
        )}
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AuctionsPage() {
  const navigate = useNavigate();
  const [auctions, setAuctions] = useState([]);
  const [myTeamId, setMyTeamId] = useState(null);
  const [myBalance, setMyBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [celebration, setCelebration] = useState(null);

  useEffect(() => {
    loadAll();
    const channel = supabase.channel("auctions-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auctions" },
        payload => {
          const updated = payload.new;
          setAuctions(prev => {
            const prevAuction = prev.find(a => a.id === updated.id);
            if (updated.status === "completed" && prevAuction?.status !== "completed") {
              setMyTeamId(tid => {
                if (updated.current_bidder_id === tid) {
                  setCelebration({
                    title: "Du vandt auktionen! 🏆",
                    subtitle: `Rytteren er nu på dit hold`,
                    amount: updated.current_price,
                  });
                }
                return tid;
              });
              return prev.filter(a => a.id !== updated.id);
            }
            return prev.map(a => a.id === updated.id ? { ...a, ...updated } : a);
          });
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: team } = await supabase.from("teams").select("id, balance").eq("user_id", user.id).single();
    if (team) { setMyTeamId(team.id); setMyBalance(team.balance); }

    const [auctionsRes, myBidsRes] = await Promise.all([
      supabase.from("auctions")
        .select(`id, current_price, min_increment, calculated_end, status,
          seller_team_id, current_bidder_id,
          rider:rider_id(id, firstname, lastname, uci_points, is_u25, team_id, birthdate,
            ${STATS.join(", ")}),
          seller:seller_team_id(id, name),
          current_bidder:current_bidder_id(id, name)`)
        .in("status", ["active", "extended"])
        .order("calculated_end", { ascending: true }),
      team ? supabase.from("auction_bids").select("auction_id, amount").eq("team_id", team.id)
           : Promise.resolve({ data: [] }),
    ]);

    if (auctionsRes.data) {
      const myBidMap = {};
      (myBidsRes.data || []).forEach(b => {
        if (!myBidMap[b.auction_id] || b.amount > myBidMap[b.auction_id]) {
          myBidMap[b.auction_id] = b.amount;
        }
      });
      setAuctions(auctionsRes.data.map(a => ({ ...a, myHighestBid: myBidMap[a.id] || null })));
    }
    setLoading(false);
  }

  async function handleBid(auctionId, amount) {
    const { data: { session } } = await supabase.auth.getSession();
    const API = import.meta.env.VITE_API_URL;
    const res = await fetch(`${API}/api/auctions/${auctionId}/bid`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ amount }),
    });
    if (res.ok) {
      fetch(`${API}/api/achievements/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ context: "auction_bid", data: { amount } }),
      }).catch(() => {});
      loadAll();
    }
  }

  const riderFilters = useClientRiderFilters(auctions.map(a => a.rider).filter(Boolean));
  const filteredRiderIds = new Set(riderFilters.filtered.map(r => r.id));

  const winningCount   = auctions.filter(a => a.current_bidder_id === myTeamId).length;
  const myListedCount  = auctions.filter(a => a.seller_team_id === myTeamId).length;
  const otherManagerCount = auctions.filter(a => a.rider?.team_id && a.rider.team_id !== myTeamId).length;

  const filtered = auctions.filter(a => {
    if (a.rider && !filteredRiderIds.has(a.rider.id)) return false;
    if (filter === "mine")    return a.seller_team_id === myTeamId;
    if (filter === "winning") return a.current_bidder_id === myTeamId;
    if (filter === "other")   return a.rider?.team_id && a.rider.team_id !== myTeamId;
    return true;
  });

  const FILTER_TABS = [
    { key: "all",     label: `Alle (${auctions.length})` },
    { key: "winning", label: `Vinder (${winningCount})` },
    { key: "mine",    label: `Mine (${myListedCount})` },
    { key: "other",   label: `Andre managers (${otherManagerCount})` },
  ];

  return (
    <div className="max-w-[1400px] mx-auto">
      <ConfettiModal
        show={!!celebration}
        onClose={() => setCelebration(null)}
        title={celebration?.title || ""}
        subtitle={celebration?.subtitle}
        amount={celebration?.amount}
        icon="🏆"
      />

      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Auktioner</h1>
          <p className="text-white/30 text-sm">{auctions.length} aktive auktioner</p>
        </div>
        <Link to="/auctions/history" className="text-xs text-[#e8c547] hover:underline">
          Se historik →
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTER_TABS.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${filter === t.key
                ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20"
                : "text-white/40 hover:text-white bg-[#0f0f18] border-white/5"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <RiderFilters
        filters={riderFilters.filters}
        onChange={riderFilters.onChange}
        onReset={riderFilters.onReset}
        showTeamFilter={false}
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-white/20">
          <p className="text-4xl mb-3">⚡</p>
          <p>Ingen auktioner i denne kategori</p>
          <p className="text-sm mt-2">Gå til Ryttere og start en auktion</p>
        </div>
      ) : (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-3 py-3 text-left text-white/30 font-medium uppercase tracking-wider">Rytter</th>
                  <th className="px-2 py-3 text-center text-white/20 font-medium hidden lg:table-cell">Alder</th>
                  <th className="px-2 py-3 text-right text-white/30 font-medium">UCI</th>
                  {STAT_LABELS.map(l => (
                    <th key={l} className="px-1 py-3 text-center text-white/20 font-medium w-9">{l}</th>
                  ))}
                  <th className="px-3 py-3 text-right text-white/30 font-medium uppercase tracking-wider whitespace-nowrap">
                    Højeste bud
                  </th>
                  <th className="px-3 py-3 text-center text-white/30 font-medium uppercase tracking-wider whitespace-nowrap">
                    Tid tilbage
                  </th>
                  <th className="px-3 py-3 text-left text-white/30 font-medium uppercase tracking-wider">
                    Byd
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <AuctionRow
                    key={a.id}
                    auction={a}
                    myTeamId={myTeamId}
                    myBalance={myBalance}
                    onBid={handleBid}
                    onNavigate={riderId => navigate(`/riders/${riderId}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
