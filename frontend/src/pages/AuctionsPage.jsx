import { useState, useEffect, useRef } from "react";
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
      ${status === "extended" ? "text-orange-400" : ""}`}>
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

function AuctionCard({ auction, myTeamId, onBid, onNavigate }) {
  const [bidAmount, setBidAmount] = useState(
    (auction.current_price || 1) + (auction.min_increment || 1)
  );
  const isMine = auction.seller_team_id === myTeamId;
  const imWinning = auction.current_bidder_id === myTeamId;
  const isOutbid = auction._wasWinning && !imWinning;

  // Update bid amount when current price changes
  useEffect(() => {
    setBidAmount((auction.current_price || 1) + (auction.min_increment || 1));
  }, [auction.current_price]);

  return (
    <div className={`bg-[#0f0f18] border rounded-xl p-4 transition-all
      ${imWinning ? "border-[#e8c547]/30 shadow-[0_0_20px_rgba(232,197,71,0.08)]" :
        isMine ? "border-blue-500/20" :
        isOutbid ? "border-red-500/20" :
        "border-white/5 hover:border-white/10"}`}>

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-white font-semibold text-sm cursor-pointer hover:text-[#e8c547] transition-colors"
            onClick={() => onNavigate(auction.rider?.id)}>
            {auction.rider?.firstname} {auction.rider?.lastname}
          </p>
          <p className="text-white/30 text-xs mt-0.5">
            Sælger: {auction.seller?.name}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {imWinning && <span className="text-[9px] uppercase tracking-wider bg-[#e8c547]/15 text-[#e8c547] px-2 py-0.5 rounded-full">Vinder</span>}
          {isMine && <span className="text-[9px] uppercase tracking-wider bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded-full">Dit udbud</span>}
          {auction.status === "extended" && <span className="text-[9px] uppercase tracking-wider bg-orange-500/15 text-orange-400 px-2 py-0.5 rounded-full">Forlænget</span>}
          {isOutbid && <span className="text-[9px] uppercase tracking-wider bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full">Overbudt!</span>}
        </div>
      </div>

      {/* Quick stats */}
      <div className="flex gap-3 mb-3">
        {STATS_BRIEF.map(({ key, label }) => (
          <div key={key} className="text-center">
            <p className="text-white/30 text-[9px] uppercase">{label}</p>
            <p className={`text-xs font-mono font-bold
              ${auction.rider?.[key] >= 80 ? "text-[#e8c547]" : "text-white/60"}`}>
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

      {/* Current bid */}
      <div className="flex items-center justify-between bg-white/3 rounded-lg px-3 py-2 mb-3">
        <div>
          <p className="text-white/30 text-[10px] uppercase tracking-wider">Nuværende bud</p>
          <p className="text-white font-bold font-mono text-lg">
            {auction.current_price?.toLocaleString("da-DK")}
            <span className="text-white/30 text-xs ml-1 font-normal">CZ$</span>
          </p>
          {auction.current_bidder && (
            <p className="text-white/30 text-xs">{auction.current_bidder.name}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-white/30 text-[10px] uppercase tracking-wider">Slutter</p>
          <Countdown end={auction.calculated_end} status={auction.status} />
        </div>
      </div>

      {/* Bid input */}
      {!isMine && (
        <div className="flex gap-2">
          <input
            type="number"
            value={bidAmount}
            min={(auction.current_price || 1) + (auction.min_increment || 1)}
            onChange={e => setBidAmount(parseInt(e.target.value))}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2
              text-white text-sm font-mono focus:outline-none focus:border-[#e8c547]/50 min-w-0"
          />
          <button
            onClick={() => onBid(auction.id, bidAmount)}
            className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
              text-sm hover:bg-[#f0d060] transition-all whitespace-nowrap flex-shrink-0">
            Byd
          </button>
        </div>
      )}
    </div>
  );
}

export default function AuctionsPage() {
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);
  const [myBalance, setMyBalance] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [filter, setFilter] = useState("all");
  const prevAuctionsRef = useRef({});
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
        rider:rider_id(id, firstname, lastname, uci_points, is_u25,
          stat_fl, stat_bj, stat_tt, stat_sp, stat_kb, stat_bk,
          stat_prl, stat_bro, stat_acc, stat_ned, stat_udh, stat_mod, stat_res, stat_ftr),
        seller:seller_team_id(id, name),
        current_bidder:current_bidder_id(id, name)`)
      .in("status", ["active", "extended"])
      .order("calculated_end", { ascending: true });

    if (data) {
      // Track which auctions I was winning before update
      const enriched = data.map(a => ({
        ...a,
        _wasWinning: prevAuctionsRef.current[a.id]?.winning || false,
      }));
      prevAuctionsRef.current = Object.fromEntries(
        data.map(a => [a.id, { winning: a.current_bidder_id === myTeamId }])
      );
      setAuctions(enriched);
    }
    setLoading(false);
  }

  function subscribeToAuctions() {
    const channel = supabase
      .channel("auctions-live")
      .on("postgres_changes", {
        event: "*", schema: "public", table: "auctions"
      }, () => {
        loadAuctions();
        loadMyTeam(); // Refresh balance too
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }

  async function handleBid(auctionId, amount) {
    if (myBalance !== null && amount > myBalance) {
      setMsg({ text: `Ikke nok balance — du har ${myBalance.toLocaleString("da-DK")} CZ$`, type: "error" });
      setTimeout(() => setMsg({ text: "", type: "" }), 4000);
      return;
    }

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
    setMsg({
      text: res.ok
        ? `✅ Bud på ${amount.toLocaleString("da-DK")} CZ$ afgivet!${data.extended ? " ⚡ Auktion forlænget" : ""}`
        : data.error,
      type: res.ok ? "success" : "error",
    });
    setTimeout(() => setMsg({ text: "", type: "" }), 4000);
  }

  const filtered = auctions.filter(a => {
    if (filter === "mine") return a.seller_team_id === myTeamId;
    if (filter === "winning") return a.current_bidder_id === myTeamId;
    return true;
  });

  const winningCount = auctions.filter(a => a.current_bidder_id === myTeamId).length;
  const myListedCount = auctions.filter(a => a.seller_team_id === myTeamId).length;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Auktioner</h1>
          <p className="text-white/30 text-sm">{auctions.length} aktive</p>
        </div>
        <div className="flex gap-2">
          <Link to="/compare" className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white/50 text-xs hover:text-white hover:bg-white/10 transition-all">⚖ Sammenlign</Link>
          <Link to="/auctions/history" className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white/50 text-xs hover:text-white hover:bg-white/10 transition-all">◎ Historik</Link>
        </div>
        {myBalance !== null && (
          <div className="bg-[#0f0f18] border border-white/5 rounded-lg px-4 py-2">
            <p className="text-white/30 text-xs">Din balance</p>
            <p className="text-[#e8c547] font-mono font-bold text-sm">{myBalance.toLocaleString("da-DK")} CZ$</p>
          </div>
        )}
      </div>

      {msg.text && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border
          ${msg.type === "success"
            ? "bg-green-500/10 text-green-400 border-green-500/20"
            : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
          {msg.text}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {[
          { key: "all", label: `Alle (${auctions.length})` },
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

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-white/20">
          <p className="text-4xl mb-3">⚡</p>
          <p>Ingen aktive auktioner</p>
          <p className="text-sm mt-2">Gå til Ryttere og start en auktion</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(a => (
            <AuctionCard
              key={a.id}
              auction={a}
              myTeamId={myTeamId}
              onBid={handleBid}
              onNavigate={(riderId) => navigate(`/riders/${riderId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
