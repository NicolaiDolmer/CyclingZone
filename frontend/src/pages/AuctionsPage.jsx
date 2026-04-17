import { useState, useEffect, useRef } from "react";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";

function Countdown({ end, status }) {
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    function update() {
      const diff = new Date(end) - new Date();
      if (diff <= 0) { setText("Afsluttet"); setUrgent(false); return; }
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
    <span className={`font-mono text-sm font-bold transition-colors
      ${urgent ? "text-red-400 animate-pulse" : "text-white/60"}
      ${status === "extended" ? "!text-orange-400" : ""}`}>
      {text}{status === "extended" ? " ⚡" : ""}
    </span>
  );
}

const STATS_BRIEF = [
  { key: "stat_bj", label: "BJ" },
  { key: "stat_sp", label: "SP" },
  { key: "stat_tt", label: "TT" },
  { key: "stat_fl", label: "FL" },
];

function BidFeedback({ status, amount }) {
  if (!status) return null;
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border mt-2 transition-all
      ${status === "success" ? "bg-green-500/10 text-green-400 border-green-500/20" :
        status === "error" ? "bg-red-500/10 text-red-400 border-red-500/20" :
        status === "loading" ? "bg-white/5 text-white/40 border-white/10" : ""}`}>
      {status === "loading" && (
        <div className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      )}
      {status === "success" && <span>✅</span>}
      {status === "error" && <span>❌</span>}
      <span>{amount}</span>
    </div>
  );
}

function AuctionCard({ auction, myTeamId, myBalance, onBid, onNavigate }) {
  const [bidAmount, setBidAmount] = useState(
    (auction.current_price || 1) + (auction.min_increment || 1)
  );
  const [bidStatus, setBidStatus] = useState(null); // null | loading | success | error
  const [bidMsg, setBidMsg] = useState("");

  const isMyRider = auction.rider?.team_id === myTeamId;
  const isAIAuction = !auction.rider?.team_id;
  const isSeller = auction.seller_team_id === myTeamId;
  const imWinning = auction.current_bidder_id === myTeamId;
  const canBid = !isMyRider; // can bid as long as it's not your own team's rider

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
    if (bidAmount < auction.current_price + auction.min_increment) {
      setBidStatus("error");
      setBidMsg(`Minimum bud er ${(auction.current_price + auction.min_increment).toLocaleString("da-DK")} CZ$`);
      setTimeout(() => { setBidStatus(null); setBidMsg(""); }, 4000);
      return;
    }
    setBidStatus("loading");
    setBidMsg("Afgiver bud...");
    const result = await onBid(auction.id, bidAmount);
    if (result.ok) {
      setBidStatus("success");
      setBidMsg(`Bud på ${bidAmount.toLocaleString("da-DK")} CZ$ afgivet!${result.extended ? " ⚡ Forlænget" : ""}`);
      setTimeout(() => { setBidStatus(null); setBidMsg(""); }, 5000);
    } else {
      setBidStatus("error");
      setBidMsg(result.error || "Noget gik galt");
      setTimeout(() => { setBidStatus(null); setBidMsg(""); }, 5000);
    }
  }

  return (
    <div className={`bg-[#0f0f18] border rounded-xl p-4 transition-all
      ${imWinning ? "border-[#e8c547]/30 shadow-[0_0_20px_rgba(232,197,71,0.06)]" :
        isMyRider ? "border-blue-500/20" :
        isSeller && isAIAuction ? "border-white/8" :
        "border-white/5 hover:border-white/10"}`}>

      {/* Badges */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-white font-semibold text-sm cursor-pointer hover:text-[#e8c547] transition-colors"
            onClick={() => onNavigate(auction.rider?.id)}>
            {auction.rider?.firstname} {auction.rider?.lastname}
          </p>
          <p className="text-white/30 text-xs mt-0.5">
            {isSeller && isAIAuction ? "Du sætter denne rytter til auktion" :
             isSeller ? "Dit udbud" :
             `Sælger: ${auction.seller?.name}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {imWinning && <span className="text-[9px] uppercase tracking-wider bg-[#e8c547]/15 text-[#e8c547] px-2 py-0.5 rounded-full">🏆 Vinder</span>}
          {isMyRider && <span className="text-[9px] uppercase tracking-wider bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded-full">Din rytter</span>}
          {isAIAuction && <span className="text-[9px] uppercase tracking-wider bg-white/8 text-white/30 px-2 py-0.5 rounded-full">Fri rytter</span>}
          {auction.status === "extended" && <span className="text-[9px] uppercase tracking-wider bg-orange-500/15 text-orange-400 px-2 py-0.5 rounded-full">⚡ Forlænget</span>}
        </div>
      </div>

      {/* Quick stats */}
      <div className="flex gap-3 mb-3">
        {STATS_BRIEF.map(({ key, label }) => (
          <div key={key} className="text-center">
            <p className="text-white/30 text-[9px] uppercase">{label}</p>
            <p className={`text-xs font-mono font-bold ${auction.rider?.[key] >= 80 ? "text-[#e8c547]" : "text-white/60"}`}>
              {auction.rider?.[key] || "—"}
            </p>
          </div>
        ))}
        <div className="text-center ml-auto">
          <p className="text-white/30 text-[9px] uppercase">UCI</p>
          <p className="text-xs font-mono font-bold text-[#e8c547]">
            {auction.rider?.uci_points?.toLocaleString("da-DK")}
          </p>
        </div>
      </div>

      {/* Current price + timer */}
      <div className="flex items-center justify-between bg-white/3 rounded-lg px-3 py-2 mb-3">
        <div>
          <p className="text-white/30 text-[10px] uppercase tracking-wider">Nuværende bud</p>
          <p className="text-white font-bold font-mono text-lg">
            {auction.current_price?.toLocaleString("da-DK")}
            <span className="text-white/30 text-xs ml-1 font-normal">CZ$</span>
          </p>
          {auction.current_bidder && !imWinning && (
            <p className="text-white/30 text-xs">{auction.current_bidder.name}</p>
          )}
          {imWinning && (
            <p className="text-green-400 text-xs font-medium">Du vinder lige nu</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-white/30 text-[10px] uppercase tracking-wider">Slutter</p>
          <Countdown end={auction.calculated_end} status={auction.status} />
        </div>
      </div>

      {/* Bid section */}
      {canBid && (
        <div>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="number"
                value={bidAmount}
                min={(auction.current_price || 1) + (auction.min_increment || 1)}
                onChange={e => setBidAmount(parseInt(e.target.value) || 0)}
                className={`w-full bg-white/5 border rounded-lg px-3 py-2 text-white
                  text-sm font-mono focus:outline-none transition-colors
                  ${bidStatus === "error" ? "border-red-500/50 focus:border-red-500/70" :
                    bidStatus === "success" ? "border-green-500/50" :
                    "border-white/10 focus:border-[#e8c547]/50"}`}
              />
              {bidAmount > myBalance && (
                <p className="text-red-400 text-[10px] mt-0.5">
                  Overstiger din balance ({myBalance?.toLocaleString("da-DK")} CZ$)
                </p>
              )}
            </div>
            <button
              onClick={handleBid}
              disabled={bidStatus === "loading" || bidAmount > myBalance}
              className={`px-4 py-2 font-bold rounded-lg text-sm transition-all flex-shrink-0
                ${bidStatus === "loading" ? "bg-white/10 text-white/40 cursor-wait" :
                  bidStatus === "success" ? "bg-green-500/20 text-green-400 border border-green-500/30" :
                  bidAmount > myBalance ? "bg-white/5 text-white/20 cursor-not-allowed" :
                  "bg-[#e8c547] text-[#0a0a0f] hover:bg-[#f0d060]"}`}>
              {bidStatus === "loading" ? "..." : bidStatus === "success" ? "✓ Budt" : "Byd"}
            </button>
          </div>
          <BidFeedback status={bidStatus} amount={bidMsg} />
          <p className="text-white/20 text-[10px] mt-1.5">
            Min. bud: {((auction.current_price || 0) + (auction.min_increment || 1)).toLocaleString("da-DK")} CZ$
          </p>
        </div>
      )}

      {isMyRider && (
        <p className="text-white/20 text-xs text-center py-2">
          Du ejer denne rytter — den er sat til auktion af dig
        </p>
      )}
    </div>
  );
}

export default function AuctionsPage() {
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);
  const [myBalance, setMyBalance] = useState(null);
  const [filter, setFilter] = useState("all");
  const navigate = useNavigate();

  useEffect(() => {
    loadMyTeam();
    loadAuctions();
    const unsub = subscribeToAuctions();
    return unsub;
  }, []);

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: team } = await supabase
      .from("teams").select("id, balance").eq("user_id", user.id).single();
    if (team) { setMyTeamId(team.id); setMyBalance(team.balance); }
  }

  async function loadAuctions() {
    const { data } = await supabase
      .from("auctions")
      .select(`id, current_price, min_increment, calculated_end, status,
        seller_team_id, current_bidder_id,
        rider:rider_id(id, firstname, lastname, uci_points, is_u25, team_id,
          stat_fl, stat_bj, stat_tt, stat_sp, stat_kb, stat_bk,
          stat_prl, stat_bro, stat_acc, stat_ned, stat_udh, stat_mod, stat_res, stat_ftr),
        seller:seller_team_id(id, name),
        current_bidder:current_bidder_id(id, name)`)
      .in("status", ["active", "extended"])
      .order("calculated_end", { ascending: true });
    if (data) setAuctions(data);
    setLoading(false);
  }

  function subscribeToAuctions() {
    const channel = supabase.channel("auctions-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions" }, () => {
        loadAuctions();
        loadMyTeam();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }

  async function handleBid(auctionId, amount) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_API_URL}/api/auctions/${auctionId}/bid`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ amount }),
      }
    );
    const data = await res.json();
    if (res.ok) {
      // Update auction card immediately — don't wait for Realtime
      setAuctions(prev => prev.map(a => {
        if (a.id !== auctionId) return a;
        return {
          ...a,
          current_price: amount,
          current_bidder_id: myTeamId,
          current_bidder: { id: myTeamId, name: "Dig" },
          status: data.extended ? "extended" : a.status,
          calculated_end: data.new_end || a.calculated_end,
        };
      }));
      loadMyTeam(); // refresh balance
      return { ok: true, extended: data.extended };
    }
    return { ok: false, error: data.error };
  }

  const winningCount = auctions.filter(a => a.current_bidder_id === myTeamId).length;
  const myListedCount = auctions.filter(a => a.seller_team_id === myTeamId).length;

  const filtered = auctions.filter(a => {
    if (!filteredRiderIds.has(a.rider?.id)) return false;
    if (filter === "mine") return a.seller_team_id === myTeamId;
    if (filter === "winning") return a.current_bidder_id === myTeamId;
    if (filter === "other") return a.rider?.team_id && a.rider.team_id !== myTeamId;
    return true;
  });

  const otherManagerCount = auctions.filter(a => a.rider?.team_id && a.rider.team_id !== myTeamId).length;
  const riderFilters = useClientRiderFilters(auctions.map(a => a.rider).filter(Boolean));
  const filteredRiderIds = new Set(riderFilters.filtered.map(r => r.id));

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Auktioner</h1>
          <p className="text-white/30 text-sm">{auctions.length} aktive</p>
        </div>
        <div className="flex items-center gap-3">
          {myBalance !== null && (
            <div className="bg-[#0f0f18] border border-white/5 rounded-lg px-4 py-2">
              <p className="text-white/30 text-xs">Din balance</p>
              <p className="text-[#e8c547] font-mono font-bold text-sm">{myBalance.toLocaleString("da-DK")} CZ$</p>
            </div>
          )}
          <div className="flex gap-2">
            <Link to="/compare" className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white/50 text-xs hover:text-white hover:bg-white/10 transition-all">⚖ Sammenlign</Link>
            <Link to="/auctions/history" className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white/50 text-xs hover:text-white hover:bg-white/10 transition-all">◎ Historik</Link>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { key: "all", label: `Alle (${auctions.length})` },
          { key: "other", label: `Andre managers (${otherManagerCount})` },
          { key: "mine", label: `Mine udbud (${myListedCount})` },
          { key: "winning", label: `Jeg vinder (${winningCount})` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all
              ${filter === key
                ? "bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20"
                : "text-white/40 hover:text-white bg-[#0f0f18] border border-white/5"}`}>
            {label}
          </button>
        ))}
      </div>
      <RiderFilters filters={riderFilters.filters} onChange={riderFilters.onChange} onReset={riderFilters.onReset} showTeamFilter={false} />

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
