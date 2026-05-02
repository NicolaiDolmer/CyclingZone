import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { statBg } from "../lib/statBg";
import { ConfettiModal } from "../components/ConfettiModal";
import { getFlagEmoji } from "../lib/countryUtils";
import { formatCz, getMinimumAuctionBid, getRiderMarketValue } from "../lib/marketValues";
import PotentialeStars from "../components/PotentialeStars";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

function isManagerSeller(auction, teamId) {
  return auction?.seller_team_id === teamId && auction?.rider?.team_id === teamId;
}

function getAuctionLeaderId(auction) {
  if (auction?.current_bidder_id) return auction.current_bidder_id;
  if (!auction?.is_guaranteed_sale && auction?.seller_team_id && auction?.rider?.team_id !== auction.seller_team_id) {
    return auction.seller_team_id;
  }
  return null;
}

function getAuctionLeaderName(auction) {
  if (auction?.current_bidder?.name) return auction.current_bidder.name;
  if (getAuctionLeaderId(auction) === auction?.seller_team_id) return auction?.seller?.name;
  return null;
}

function getAuctionSellerLabel(auction) {
  if (auction?.seller_team_id && auction?.rider?.team_id === auction.seller_team_id) {
    return auction?.seller?.name || "Manager";
  }
  return "AI";
}

function SortTh({ children, sortKey, sort, sortDir, onSort, className = "" }) {
  const active = sort === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none transition-colors ${active ? "text-amber-700/80" : "text-slate-400 hover:text-slate-500"} ${className}`}>
      {children}{active && <span className="ml-0.5 text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

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
    <span className={`font-mono text-xs ${urgent ? "text-red-700 animate-pulse" : "text-slate-500"}`}>
      {text}
    </span>
  );
}

// ── Auction table row ─────────────────────────────────────────────────────────
function AuctionRow({ auction, myTeamId, myBalance, onBid, onNavigate }) {
  const minBid = getMinimumAuctionBid(auction.current_price || 0);
  const [bidAmount, setBidAmount] = useState(minBid);
  const [bidStatus, setBidStatus] = useState(null);
  const [errorText, setErrorText] = useState("");

  const isMyRider = auction.rider?.team_id === myTeamId;
  const isSeller  = isManagerSeller(auction, myTeamId);
  const imWinning = getAuctionLeaderId(auction) === myTeamId;
  const canBid    = !isMyRider && auction.status !== "completed";

  useEffect(() => {
    setBidAmount(minBid);
    setErrorText("");
  }, [minBid]);

  async function handleBid() {
    if (bidAmount > myBalance) {
      setBidStatus("error");
      setErrorText("Buddet overstiger din balance");
      setTimeout(() => setBidStatus(null), 3000);
      return;
    }
    setBidStatus("loading");
    const result = await onBid(auction.id, bidAmount);
    if (result.ok) {
      setBidStatus("success");
      setTimeout(() => setBidStatus(null), 2500);
    } else {
      setBidStatus("error");
      setErrorText(result.error || "Buddet kunne ikke placeres");
      setTimeout(() => setBidStatus(null), 3000);
    }
  }

  const r = auction.rider;
  const age = r?.birthdate ? new Date().getFullYear() - new Date(r.birthdate).getFullYear() : null;

  return (
    <tr className={`group border-b border-slate-100 hover:bg-slate-100 transition-colors
      ${imWinning ? "bg-[#e8c547]/3" : ""}`}>

      {/* Rytter */}
      <td className="px-3 py-1.5 min-w-[140px]">
        <div className="flex flex-col gap-0.5">
          {r?.nationality_code && <span className="text-xs flex-shrink-0">{getFlagEmoji(r.nationality_code)}</span>}
          <button
            onClick={() => onNavigate(r?.id)}
            className="text-slate-900 text-sm font-medium hover:text-amber-700 transition-colors text-left truncate max-w-[160px]">
            {r?.firstname} {r?.lastname}
          </button>
          <div className="flex items-center gap-1 flex-wrap">
            {imWinning && (
              <span className="text-[9px] uppercase bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                Vinder
              </span>
            )}
            {isSeller && (
              <span className="text-[9px] uppercase bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                Sælger
              </span>
            )}
            {isMyRider && !isSeller && (
              <span className="text-[9px] uppercase bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                Din
              </span>
            )}
            {auction.status === "extended" && (
              <span className="text-[9px] uppercase bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">
                ⚡ Ext
              </span>
            )}
            {auction.is_flash && (
              <span className="text-[9px] uppercase bg-red-50 text-red-700 px-1.5 py-0.5 rounded">
                ⚡ Flash
              </span>
            )}
            {r?.is_u25 && (
              <span className="text-[9px] uppercase bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded">U25</span>
            )}
          </div>
        </div>
      </td>

      {/* Alder */}
      <td className="px-2 py-1.5 text-center text-slate-500 font-mono text-xs hidden xl:table-cell">
        {age ?? "—"}
      </td>

      {/* UCI */}
      <td className="px-2 py-1.5 text-right text-amber-700 font-mono font-bold text-xs whitespace-nowrap">
        {formatCz(getRiderMarketValue(r)).replace(" CZ$", "")}
      </td>

      {/* Sælger */}
      <td className="px-3 py-1.5 text-left text-slate-500 text-xs whitespace-nowrap hidden xl:table-cell">
        <span className="truncate max-w-[120px] inline-block">{getAuctionSellerLabel(auction)}</span>
      </td>

      {/* Potentiale */}
      <td className="px-3 py-1.5">
        <PotentialeStars value={r?.potentiale} birthdate={r?.birthdate} />
      </td>

      {/* Stats */}
      {STATS.map(key => (
        <td key={key} className="px-1 py-1.5 text-center">
          <span className={`inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded ${statBg(r?.[key] || 0)}`}>
            {r?.[key] || "—"}
          </span>
        </td>
      ))}

      {/* Højeste bud */}
      <td className="px-3 py-1.5 text-right whitespace-nowrap">
        <span className="text-slate-900 font-mono font-bold text-sm">
          {auction.current_price?.toLocaleString("da-DK")}
        </span>
        <span className="text-slate-400 text-xs ml-1">CZ$</span>
        {getAuctionLeaderName(auction) && !imWinning && (
          <p className="text-slate-400 text-[10px] truncate max-w-[100px]">
            {getAuctionLeaderName(auction)}
          </p>
        )}
      </td>

      {/* Tid tilbage */}
      <td className="px-3 py-1.5 text-center whitespace-nowrap">
        <Countdown end={auction.calculated_end} status={auction.status} />
      </td>

      {/* Byd */}
      <td className={`px-3 py-1.5 sticky right-0 z-10 border-l border-slate-100 transition-colors group-hover:bg-slate-100 ${imWinning ? "bg-[#e8c547]/3" : "bg-white"}`}>
        {canBid ? (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={bidAmount}
              min={minBid}
              onChange={e => setBidAmount(parseInt(e.target.value) || minBid)}
              className="w-24 bg-slate-100 border border-slate-300 rounded px-2 py-1.5
                text-slate-900 font-mono text-xs focus:outline-none focus:border-amber-400"
            />
            <button
              onClick={handleBid}
              disabled={bidStatus === "loading" || bidAmount < minBid}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-all whitespace-nowrap
                ${bidStatus === "error"   ? "bg-red-100 text-red-700 border border-red-500/30" :
                  bidStatus === "success" ? "bg-green-100 text-green-700 border border-green-500/30" :
                  imWinning
                    ? "bg-amber-50 text-amber-700 border border-amber-300 hover:bg-[#e8c547]/25"
                    : "bg-[#e8c547] text-[#0a0a0f] hover:bg-[#f0d060]"}
                disabled:opacity-50`}>
              {bidStatus === "loading" ? "..." :
               bidStatus === "error"   ? "Fejl" :
               bidStatus === "success" ? "✓" :
               imWinning ? "Hæv" : "Byd"}
            </button>
            {bidStatus === "error" && errorText && (
              <p className="text-[10px] text-red-700 max-w-[90px] leading-tight">{errorText}</p>
            )}
          </div>
        ) : isSeller ? (
          <span className="text-slate-300 text-xs">Du sælger</span>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
    </tr>
  );
}

function AuctionCard({ auction, myTeamId, myBalance, onBid, onNavigate }) {
  const minBid = getMinimumAuctionBid(auction.current_price || 0);
  const [bidAmount, setBidAmount] = useState(minBid);
  const [bidStatus, setBidStatus] = useState(null);
  const [errorText, setErrorText] = useState("");

  const r = auction.rider;
  const isMyRider = r?.team_id === myTeamId;
  const isSeller = isManagerSeller(auction, myTeamId);
  const imWinning = getAuctionLeaderId(auction) === myTeamId;
  const canBid = !isMyRider && auction.status !== "completed";
  const age = r?.birthdate ? new Date().getFullYear() - new Date(r.birthdate).getFullYear() : null;

  useEffect(() => {
    setBidAmount(minBid);
  }, [minBid]);

  async function handleBid() {
    if (bidAmount > myBalance) {
      setBidStatus("error");
      setErrorText("Buddet overstiger din balance");
      setTimeout(() => setBidStatus(null), 3000);
      return;
    }
    setBidStatus("loading");
    const result = await onBid(auction.id, bidAmount);
    setBidStatus(result.ok ? "success" : "error");
    setErrorText(result.error || "");
    setTimeout(() => setBidStatus(null), result.ok ? 2500 : 3000);
  }

  return (
    <div className={`bg-white border rounded-xl p-4 transition-all ${imWinning ? "border-amber-300 bg-amber-50/40" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            onClick={() => onNavigate(r?.id)}
            className="text-left text-slate-900 font-semibold text-sm hover:text-amber-700 transition-colors">
            {r?.nationality_code && <span className="mr-1">{getFlagEmoji(r.nationality_code)}</span>}
            {r?.firstname} {r?.lastname}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {imWinning && <span className="text-[9px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Vinder</span>}
            {isSeller && <span className="text-[9px] uppercase bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">Sælger</span>}
            {auction.status === "extended" && <span className="text-[9px] uppercase bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">Ext</span>}
            {auction.is_flash && <span className="text-[9px] uppercase bg-red-50 text-red-700 px-1.5 py-0.5 rounded">⚡ Flash</span>}
            {r?.is_u25 && <span className="text-[9px] uppercase bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">U25</span>}
            {age && <span className="text-slate-400 text-xs">{age} år</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-slate-400 text-[10px] uppercase tracking-wider">Tid</p>
          <Countdown end={auction.calculated_end} status={auction.status} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="bg-slate-50 rounded-lg px-3 py-2">
          <p className="text-slate-400 text-[10px] uppercase tracking-wider">Værdi</p>
          <p className="text-amber-700 font-mono font-bold text-sm">
            {formatCz(getRiderMarketValue(r))}
          </p>
        </div>
        <div className="bg-slate-50 rounded-lg px-3 py-2">
          <p className="text-slate-400 text-[10px] uppercase tracking-wider">Sælger</p>
          <p className="text-slate-700 text-sm font-medium truncate">{getAuctionSellerLabel(auction)}</p>
        </div>
        <div className="bg-slate-50 rounded-lg px-3 py-2">
          <p className="text-slate-400 text-[10px] uppercase tracking-wider">Højeste bud</p>
          <p className="text-slate-900 font-mono font-bold text-sm">
            {auction.current_price?.toLocaleString("da-DK")} CZ$
          </p>
          {getAuctionLeaderName(auction) && !imWinning && (
            <p className="text-slate-400 text-[10px] truncate">{getAuctionLeaderName(auction)}</p>
          )}
        </div>
      </div>

      {r?.potentiale != null && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-slate-300 text-[9px] uppercase tracking-wider">Potentiale</span>
          <PotentialeStars value={r.potentiale} birthdate={r.birthdate} showValue />
        </div>
      )}
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {[["BJ", "stat_bj"], ["SP", "stat_sp"], ["TT", "stat_tt"], ["FL", "stat_fl"], ["UDH", "stat_udh"]].map(([label, key]) => (
          <div key={key} className="text-center">
            <p className="text-slate-300 text-[9px] uppercase mb-0.5">{label}</p>
            <span className={`inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded ${statBg(r?.[key] || 0)}`}>
              {r?.[key] || "—"}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4">
        {canBid ? (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              type="number"
              value={bidAmount}
              min={minBid}
              onChange={e => setBidAmount(parseInt(e.target.value) || minBid)}
              className="min-w-0 bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono text-sm focus:outline-none focus:border-amber-400"
            />
            <p className="col-span-2 text-[10px] text-slate-400">Min. bud: {minBid.toLocaleString("da-DK")} CZ$</p>
            {bidStatus === "error" && errorText && <p className="col-span-2 text-[11px] text-red-700">{errorText}</p>}
            <button
              onClick={handleBid}
              disabled={bidStatus === "loading" || bidAmount < minBid}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap
                ${bidStatus === "error" ? "bg-red-100 text-red-700 border border-red-500/30" :
                  bidStatus === "success" ? "bg-green-100 text-green-700 border border-green-500/30" :
                  imWinning ? "bg-amber-50 text-amber-700 border border-amber-300" : "bg-[#e8c547] text-[#0a0a0f]"}
                disabled:opacity-50`}>
              {bidStatus === "loading" ? "..." : bidStatus === "error" ? "Fejl" : bidStatus === "success" ? "✓" : imWinning ? "Hæv" : "Byd"}
            </button>
          </div>
        ) : (
          <p className="text-slate-300 text-xs text-center py-1">{isSeller ? "Du sælger" : "—"}</p>
        )}
      </div>
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
  const [auctionSort, setAuctionSort] = useState({ key: null, dir: "desc" });

  function handleSort(key) {
    if (key === "current_price" || key === "calculated_end") {
      setAuctionSort(s => ({ key, dir: s.key === key ? (s.dir === "desc" ? "asc" : "desc") : "desc" }));
    } else {
      const cur = riderFilters.filters.sort;
      const dir = riderFilters.filters.sort_dir;
      if (cur === key) riderFilters.onChange("sort_dir", dir === "desc" ? "asc" : "desc");
      else { riderFilters.onChange("sort", key); riderFilters.onChange("sort_dir", "desc"); }
      setAuctionSort({ key: null, dir: "desc" });
    }
  }

  function activeSort(key) {
    if (key === "current_price" || key === "calculated_end") return auctionSort.key === key;
    return !auctionSort.key && riderFilters.filters.sort === key;
  }
  function activeSortDir(key) {
    if (key === "current_price" || key === "calculated_end") return auctionSort.dir;
    return riderFilters.filters.sort_dir;
  }

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
                if (getAuctionLeaderId({ ...prevAuction, ...updated }) === tid) {
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
        .select(`id, current_price, min_increment, calculated_end, status, is_guaranteed_sale, is_flash,
          seller_team_id, current_bidder_id,
          rider:rider_id(id, firstname, lastname, uci_points, is_u25, team_id, birthdate, nationality_code,
            prize_earnings_bonus, potentiale, ${STATS.join(", ")}),
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
      return { ok: true };
    }
    let data = {};
    try { data = await res.json(); } catch {}
    return { ok: false, error: data.error || "Buddet kunne ikke placeres" };
  }

  const riderFilters = useClientRiderFilters(auctions.map(a => a.rider).filter(Boolean));
  const filteredRiderOrder = new Map(riderFilters.filtered.map((r, i) => [r.id, i]));

  const winningCount   = auctions.filter(a => getAuctionLeaderId(a) === myTeamId).length;
  const myListedCount  = auctions.filter(a => isManagerSeller(a, myTeamId)).length;
  const otherManagerCount = auctions.filter(a => a.rider?.team_id && a.rider.team_id !== myTeamId).length;

  const filtered = auctions
    .filter(a => {
      if (a.rider && !filteredRiderOrder.has(a.rider.id)) return false;
      if (filter === "mine")    return isManagerSeller(a, myTeamId);
      if (filter === "winning") return getAuctionLeaderId(a) === myTeamId;
      if (filter === "other")   return a.rider?.team_id && a.rider.team_id !== myTeamId;
      return true;
    })
    .sort((a, b) => {
      const ai = a.rider ? (filteredRiderOrder.get(a.rider.id) ?? Infinity) : Infinity;
      const bi = b.rider ? (filteredRiderOrder.get(b.rider.id) ?? Infinity) : Infinity;
      return ai - bi;
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
          <h1 className="text-xl font-bold text-slate-900">Auktioner</h1>
          <p className="text-slate-400 text-sm">{auctions.length} aktive auktioner</p>
        </div>
        <Link to="/auctions/history" className="text-xs text-amber-700 hover:underline">
          Se historik →
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTER_TABS.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${filter === t.key
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "text-slate-500 hover:text-slate-900 bg-white border-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <RiderFilters
        filters={riderFilters.filters}
        onChange={riderFilters.onChange}
        onReset={riderFilters.onReset}
        showTeamFilter={false}
        nationalities={riderFilters.nationalities}
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-300">
          <p className="text-4xl mb-3">⚡</p>
          <p>Ingen auktioner i denne kategori</p>
          <p className="text-sm mt-2">Gå til Ryttere og start en auktion</p>
        </div>
      ) : (
        <>
        <div className="md:hidden flex flex-col gap-3">
          {[...filtered].sort((a, b) => {
            if (!auctionSort.key) return 0;
            const av = auctionSort.key === "calculated_end"
              ? new Date(a.calculated_end).getTime()
              : (a.current_price || 0);
            const bv = auctionSort.key === "calculated_end"
              ? new Date(b.calculated_end).getTime()
              : (b.current_price || 0);
            return auctionSort.dir === "desc" ? bv - av : av - bv;
          }).map(a => (
            <AuctionCard
              key={a.id}
              auction={a}
              myTeamId={myTeamId}
              myBalance={myBalance}
              onBid={handleBid}
              onNavigate={riderId => navigate(`/riders/${riderId}`)}
            />
          ))}
        </div>
        <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-20 bg-white shadow-sm">
                <tr className="border-b border-slate-200">
                  <SortTh sortKey="firstname" sort={activeSort("firstname") ? "firstname" : riderFilters.filters.sort}
                    sortDir={activeSortDir("firstname")} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider">Rytter</SortTh>
                  <th className="px-2 py-3 text-center text-slate-300 font-medium hidden xl:table-cell">Alder</th>
                  <SortTh sortKey="uci_points" sort={activeSort("uci_points") ? "uci_points" : riderFilters.filters.sort}
                    sortDir={activeSortDir("uci_points")} onSort={handleSort}
                    className="px-2 py-3 text-right font-medium">Værdi</SortTh>
                  <th className="px-3 py-3 text-left text-slate-400 font-medium uppercase tracking-wider hidden xl:table-cell">Sælger</th>
                  <SortTh sortKey="potentiale"
                    sort={activeSort("potentiale") ? "potentiale" : riderFilters.filters.sort}
                    sortDir={activeSortDir("potentiale")} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider whitespace-nowrap">Potentiale</SortTh>
                  {STATS.map((key, i) => (
                    <SortTh key={key} sortKey={key}
                      sort={activeSort(key) ? key : riderFilters.filters.sort}
                      sortDir={activeSortDir(key)} onSort={handleSort}
                      className="px-1 py-3 text-center font-medium w-9">{STAT_LABELS[i]}</SortTh>
                  ))}
                  <SortTh sortKey="current_price"
                    sort={auctionSort.key} sortDir={auctionSort.dir} onSort={handleSort}
                    className="px-3 py-3 text-right font-medium uppercase tracking-wider whitespace-nowrap">
                    Højeste bud
                  </SortTh>
                  <SortTh sortKey="calculated_end"
                    sort={auctionSort.key} sortDir={auctionSort.dir} onSort={handleSort}
                    className="px-3 py-3 text-center font-medium uppercase tracking-wider whitespace-nowrap">
                    Tid tilbage
                  </SortTh>
                  <th className="px-3 py-3 text-left text-slate-400 font-medium uppercase tracking-wider sticky right-0 bg-white z-10 border-l border-slate-100">Byd</th>
                </tr>
              </thead>
              <tbody>
                {[...filtered].sort((a, b) => {
                  if (!auctionSort.key) return 0;
                  const av = auctionSort.key === "calculated_end"
                    ? new Date(a.calculated_end).getTime()
                    : (a.current_price || 0);
                  const bv = auctionSort.key === "calculated_end"
                    ? new Date(b.calculated_end).getTime()
                    : (b.current_price || 0);
                  return auctionSort.dir === "desc" ? bv - av : av - bv;
                }).map(a => (
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
        </>
      )}
    </div>
  );
}
