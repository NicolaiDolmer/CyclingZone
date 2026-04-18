import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { ConfettiModal } from "../components/ConfettiModal";

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
    <span className={`font-mono text-sm ${urgent ? "text-red-400 animate-pulse" : "text-white/50"}`}>
      {text}
    </span>
  );
}

// ── Bid feedback inline ───────────────────────────────────────────────────────
function BidFeedback({ status, amount }) {
  if (!status) return null;
  return (
    <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg mt-2
      ${status === "loading" ? "bg-white/5 text-white/50" :
        status === "success" ? "bg-green-500/10 text-green-400" :
        "bg-red-500/10 text-red-400"}`}>
      {status === "loading" && (
        <div className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      )}
      {status === "success" && <span>✅</span>}
      {status === "error" && <span>❌</span>}
      <span>{amount}</span>
    </div>
  );
}

// ── Auction card ──────────────────────────────────────────────────────────────
function AuctionCard({ auction, myTeamId, myBalance, onBid, onNavigate }) {
  const [bidAmount, setBidAmount] = useState(
    (auction.current_price || 1) + (auction.min_increment || 1)
  );
  const [bidStatus, setBidStatus] = useState(null);
  const [bidMsg, setBidMsg] = useState("");

  const isMyRider = auction.rider?.team_id === myTeamId;
  const isSeller = auction.seller_team_id === myTeamId;
  const imWinning = auction.current_bidder_id === myTeamId;
  const imBidding = !imWinning && (auction.myHighestBid > 0);
  const canBid = !isMyRider;

  useEffect(() => {
    setBidAmount((auction.current_price || 1) + (auction.min_increment || 1));
  }, [auction.current_price]);

  async function handleBid() {
    if (bidAmount > myBalance) {
      setBidStatus("error");
      setBidMsg(`Ikke nok balance — du har ${myBalance?.toLocaleString("da-DK")} CZ$`);
      setTimeout(() => { setBidStatus(null); setBidMsg(""); }, 4000);
      return;
    }
    setBidStatus("loading");
    setBidMsg("Afgiver bud...");
    await onBid(auction.id, bidAmount);
    setBidStatus("success");
    setBidMsg(`Bud på ${bidAmount.toLocaleString("da-DK")} CZ$ afgivet`);
    setTimeout(() => { setBidStatus(null); setBidMsg(""); }, 3000);
  }

  const minBid = (auction.current_price || 1) + (auction.min_increment || 1);

  return (
    <div className={`bg-[#0f0f18] border rounded-xl p-4 transition-all
      ${imWinning ? "border-[#e8c547]/30 shadow-[0_0_20px_rgba(232,197,71,0.06)]" :
        imBidding ? "border-orange-500/25" :
        isMyRider ? "border-blue-500/20" :
        "border-white/5 hover:border-white/10"}`}>

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="cursor-pointer flex-1 min-w-0" onClick={() => onNavigate(auction.rider?.id)}>
          <p className="text-white font-semibold truncate hover:text-[#e8c547] transition-colors">
            {auction.rider?.firstname} {auction.rider?.lastname}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {imWinning && (
              <span className="text-[9px] uppercase tracking-wider bg-[#e8c547]/15 text-[#e8c547] px-2 py-0.5 rounded-full">
                🏆 Vinder
              </span>
            )}
            {imBidding && (
              <span className="text-[9px] uppercase tracking-wider bg-orange-500/15 text-orange-400 px-2 py-0.5 rounded-full">
                ⚡ Du har budt
              </span>
            )}
            {isMyRider && (
              <span className="text-[9px] uppercase tracking-wider bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded-full">
                Din rytter
              </span>
            )}
            {!auction.rider?.team_id && (
              <span className="text-[9px] uppercase tracking-wider bg-white/8 text-white/30 px-2 py-0.5 rounded-full">
                Fri rytter
              </span>
            )}
            {auction.status === "extended" && (
              <span className="text-[9px] uppercase tracking-wider bg-orange-500/15 text-orange-400 px-2 py-0.5 rounded-full">
                ⚡ Forlænget
              </span>
            )}
          </div>
        </div>
        <div className="text-right ml-3 flex-shrink-0">
          <p className="text-[#e8c547] font-mono font-bold text-lg">
            {auction.current_price?.toLocaleString("da-DK")} CZ$
          </p>
          <Countdown end={auction.calculated_end} status={auction.status} />
        </div>
      </div>

      {/* Quick stats */}
      <div className="flex gap-3 mb-3">
        {[["BJ", "stat_bj"], ["SP", "stat_sp"], ["TT", "stat_tt"], ["FL", "stat_fl"]].map(([label, key]) => (
          <div key={key} className="text-center">
            <p className="text-white/25 text-[9px] uppercase">{label}</p>
            <p className={`font-mono text-xs font-bold ${(auction.rider?.[key] || 0) >= 80 ? "text-[#e8c547]" : "text-white/50"}`}>
              {auction.rider?.[key] || "—"}
            </p>
          </div>
        ))}
        <div className="text-center ml-auto">
          <p className="text-white/25 text-[9px] uppercase">UCI</p>
          <p className="font-mono text-xs font-bold text-white/50">
            {auction.rider?.uci_points?.toLocaleString("da-DK") || "—"}
          </p>
        </div>
      </div>

      {/* Current bidder / my bid info */}
      <div className="mb-3 min-h-[18px]">
        {auction.current_bidder && !imWinning && (
          <p className="text-white/30 text-xs">Højeste bud: {auction.current_bidder.name}</p>
        )}
        {imBidding && auction.myHighestBid && (
          <p className="text-orange-400/70 text-xs">
            Dit bud: {auction.myHighestBid.toLocaleString("da-DK")} CZ$
          </p>
        )}
      </div>

      {/* Bid input */}
      {canBid && auction.status !== "completed" && (
        <div>
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                type="number"
                value={bidAmount}
                min={minBid}
                onChange={e => setBidAmount(parseInt(e.target.value) || minBid)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2
                  text-white font-mono text-sm focus:outline-none focus:border-[#e8c547]/50"
              />
              <p className="text-white/20 text-[10px] mt-1 ml-1">Min: {minBid.toLocaleString("da-DK")} CZ$</p>
            </div>
            <button
              onClick={handleBid}
              disabled={bidStatus === "loading" || bidAmount < minBid}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all self-start
                ${imWinning
                  ? "bg-[#e8c547]/20 text-[#e8c547] border border-[#e8c547]/30 hover:bg-[#e8c547]/30"
                  : "bg-[#e8c547] text-[#0a0a0f] hover:bg-[#f0d060]"}
                disabled:opacity-50`}>
              {bidStatus === "loading" ? "..." : imWinning ? "Hæv" : "Byd"}
            </button>
          </div>
          <BidFeedback status={bidStatus} amount={bidMsg} />
        </div>
      )}

      {isSeller && auction.status !== "completed" && (
        <p className="text-white/20 text-xs text-center mt-2">Du sælger denne rytter</p>
      )}
    </div>
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
            // Check if auction just completed and I won
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
              // Remove completed auctions from the list after a delay
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
          rider:rider_id(id, firstname, lastname, uci_points, is_u25, team_id,
            stat_fl, stat_bj, stat_tt, stat_sp, stat_kb, stat_bk,
            stat_prl, stat_bro, stat_acc, stat_ned, stat_udh, stat_mod, stat_res, stat_ftr),
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
      setMyBalance(b => b - 0); // balance updated via next loadAll
      loadAll();
    }
  }

  // Rider filters
  const riderFilters = useClientRiderFilters(auctions.map(a => a.rider).filter(Boolean));
  const filteredRiderIds = new Set(riderFilters.filtered.map(r => r.id));

  const winningCount = auctions.filter(a => a.current_bidder_id === myTeamId).length;
  const myListedCount = auctions.filter(a => a.seller_team_id === myTeamId).length;
  const otherManagerCount = auctions.filter(a => a.rider?.team_id && a.rider.team_id !== myTeamId).length;

  const filtered = auctions.filter(a => {
    if (a.rider && !filteredRiderIds.has(a.rider.id)) return false;
    if (filter === "mine") return a.seller_team_id === myTeamId;
    if (filter === "winning") return a.current_bidder_id === myTeamId;
    if (filter === "other") return a.rider?.team_id && a.rider.team_id !== myTeamId;
    return true;
  });

  const FILTER_TABS = [
    { key: "all",     label: `Alle (${auctions.length})` },
    { key: "winning", label: `Vinder (${winningCount})` },
    { key: "mine",    label: `Mine (${myListedCount})` },
    { key: "other",   label: `Andre managers (${otherManagerCount})` },
  ];

  return (
    <div className="max-w-5xl mx-auto">
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

      {/* Rider filters */}
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(a => (
            <AuctionCard
              key={a.id}
              auction={a}
              myTeamId={myTeamId}
              myBalance={myBalance}
              onBid={handleBid}
              onNavigate={(riderId) => navigate(`/riders/${riderId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
