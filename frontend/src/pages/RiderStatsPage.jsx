import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

const STATS = [
  { key: "stat_fl",  label: "Flad",              icon: "═" },
  { key: "stat_bj",  label: "Bjerg",             icon: "▲" },
  { key: "stat_kb",  label: "Mellembjerg",        icon: "△" },
  { key: "stat_bk",  label: "Bakke",             icon: "∧" },
  { key: "stat_tt",  label: "Enkeltstart",        icon: "⏱" },
  { key: "stat_prl", label: "Prolog",             icon: "◷" },
  { key: "stat_bro", label: "Brosten",            icon: "⬡" },
  { key: "stat_sp",  label: "Sprint",             icon: "⚡" },
  { key: "stat_acc", label: "Acceleration",       icon: "▶" },
  { key: "stat_ned", label: "Nedkørsel",          icon: "↓" },
  { key: "stat_udh", label: "Udholdenhed",        icon: "◎" },
  { key: "stat_mod", label: "Modstandsdygtighed", icon: "◈" },
  { key: "stat_res", label: "Restituering",       icon: "↺" },
  { key: "stat_ftr", label: "Fighter",            icon: "★" },
];

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

function StatRow({ label, icon, value }) {
  const pct = Math.round(((value || 0) / 99) * 100);
  const color = value >= 80 ? "#e8c547" : value >= 70 ? "#60a5fa" : value >= 60 ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.2)";
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-white/20 w-4 text-center text-sm">{icon}</span>
      <span className="text-white/50 text-sm w-36 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-white/5 rounded-full h-2">
        <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-sm font-bold w-8 text-right flex-shrink-0" style={{ color }}>{value ?? "—"}</span>
    </div>
  );
}

function DirectOfferButton({ rider }) {
  const [show, setShow]       = useState(false);
  const [amount, setAmount]   = useState(rider.uci_points || 0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [windowOpen, setWindowOpen] = useState(true);
  const API = import.meta.env.VITE_API_URL;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      fetch(`${API}/api/transfer-window`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json())
        .then(d => setWindowOpen(d?.open !== false))
        .catch(() => {});
    });
  }, []);

  async function sendOffer() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}/api/transfers/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: rider.id, offer_amount: amount, message }),
    });
    const data = await res.json();
    if (res.ok) { setResult({ ok: true, msg: "✅ Tilbud sendt!" }); setShow(false); }
    else        { setResult({ ok: false, msg: `❌ ${data.error}` }); }
    setLoading(false);
    setTimeout(() => setResult(null), 4000);
  }
  return (
    <div>
      {result && (
        <div className={`mb-2 px-3 py-2 rounded-lg text-sm border
          ${result.ok ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
          {result.msg}
        </div>
      )}
      <button onClick={() => windowOpen && setShow(!show)} disabled={!windowOpen}
        className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all border
          ${!windowOpen
            ? "bg-white/3 text-white/20 border-white/5 cursor-not-allowed"
            : show
              ? "bg-[#e8c547]/15 text-[#e8c547] border-[#e8c547]/25"
              : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white"}`}>
        {windowOpen ? "↔ Send transfertilbud" : "Transfervindue lukket"}
      </button>
      {show && windowOpen && (
        <div className="mt-3 flex flex-col gap-2">
          <input type="number" value={amount} min={1} onChange={e => setAmount(parseInt(e.target.value) || 0)}
            placeholder="Tilbudsbeløb i CZ$"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-[#e8c547]/50" />
          <input type="text" value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Besked (valgfri)"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50" />
          <button onClick={sendOffer} disabled={loading || amount <= 0}
            className="w-full py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50 transition-all">
            {loading ? "Sender..." : "Send tilbud"}
          </button>
        </div>
      )}
    </div>
  );
}

function AuctionButton({ rider, isMyRider, onStart }) {
  const [price, setPrice]     = useState(Math.max(rider.uci_points || 1, 1));
  const [loading, setLoading] = useState(false);
  return (
    <div>
      <p className="text-white/30 text-xs uppercase tracking-widest mb-2">
        {isMyRider ? "Sæt til auktion" : "Start auktion (fri rytter)"}
      </p>
      <div className="flex gap-2">
        <input type="number" value={price} min={1} onChange={e => setPrice(parseInt(e.target.value))}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#e8c547]/50" />
        <button onClick={async () => { setLoading(true); await onStart(price); setLoading(false); }} disabled={loading}
          className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] transition-all disabled:opacity-50">
          {loading ? "..." : "Start auktion"}
        </button>
      </div>
    </div>
  );
}

export default function RiderStatsPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [rider, setRider]                   = useState(null);
  const [onWatchlist, setOnWatchlist]       = useState(false);
  const [watchlistId, setWatchlistId]       = useState(null);
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [results, setResults]               = useState([]);
  const [loading, setLoading]               = useState(true);
  const [tab, setTab]                       = useState("stats");
  const [myTeamId, setMyTeamId]             = useState(null);
  const [myTeam, setMyTeam]                 = useState(null);

  useEffect(() => { loadRider(); loadMyTeam(); loadWatchlistStatus(); }, [id]);

  async function loadWatchlistStatus() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase.from("rider_watchlist")
      .select("id").eq("user_id", user.id).eq("rider_id", id).single();
    if (data) { setOnWatchlist(true); setWatchlistId(data.id); }
    else      { setOnWatchlist(false); setWatchlistId(null); }
  }

  async function loadWatchlistCount() {
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/riders/${id}/watchlist-count`, { headers: h });
      const data = await res.json();
      setWatchlistCount(data.count || 0);
    } catch (e) {}
  }

  async function toggleWatchlist() {
    const { data: { user } } = await supabase.auth.getUser();
    if (onWatchlist) {
      await supabase.from("rider_watchlist").delete().eq("id", watchlistId);
      setOnWatchlist(false); setWatchlistId(null);
    } else {
      const { data } = await supabase.from("rider_watchlist")
        .insert({ user_id: user.id, rider_id: id }).select("id").single();
      setOnWatchlist(true); setWatchlistId(data?.id);
      // Achievement check
      const h = await authHeaders();
      fetch(`${API}/api/achievements/check`, {
        method: "POST", headers: h,
        body: JSON.stringify({ context: "watchlist_add" }),
      }).catch(() => {});
    }
    loadWatchlistCount();
  }

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("id, balance, division, name").eq("user_id", user.id).single();
    if (t) { setMyTeamId(t.id); setMyTeam(t); }
  }

  async function loadRider() {
    const [riderRes, resultsRes] = await Promise.all([
      supabase.from("riders").select(`*, team:team_id(id, name)`).eq("id", id).single(),
      supabase.from("race_results")
        .select(`*, race:race_id(name, race_type, start_date)`)
        .eq("rider_id", id).order("imported_at", { ascending: false }).limit(20),
    ]);
    setRider(riderRes.data);
    setResults(resultsRes.data || []);
    setLoading(false);
    loadWatchlistCount();

    if (riderRes.data?.team_id) {
      const h = await authHeaders();
      fetch(`${API}/api/riders/${id}/view`, { method: "POST", headers: h }).catch(() => {});
    }
  }

  async function startAuction(startPrice) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}/api/auctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: id, starting_price: startPrice }),
    });
    if (res.ok) navigate("/auctions");
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!rider) return <div className="text-white/30 text-center py-16">Rytter ikke fundet</div>;

  const bestStat = STATS.map(s => ({ ...s, val: rider[s.key] || 0 })).sort((a, b) => b.val - a.val)[0];
  const isMyRider  = rider.team_id === myTeamId;
  const isFreeAgent = !rider.team_id;
  const canAuction  = isFreeAgent || isMyRider;
  const age = rider.birthdate
    ? Math.floor((Date.now() - new Date(rider.birthdate)) / (365.25 * 24 * 3600 * 1000))
    : null;
  const typeLabel = (() => {
    const vals = STATS.map(s => rider[s.key] || 0);
    const max = Math.max(...vals);
    return STATS[vals.indexOf(max)]?.label || "Allround";
  })();

  const bySeason = results.reduce((acc, r) => {
    const yr = r.race?.start_date?.slice(0, 4) || "—";
    if (!acc[yr]) acc[yr] = { wins: 0, top3: 0, totalPrize: 0 };
    if (r.position === 1) acc[yr].wins++;
    if (r.position <= 3) acc[yr].top3++;
    acc[yr].totalPrize += r.prize_money || 0;
    return acc;
  }, {});

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="text-white/30 hover:text-white text-sm mb-4 flex items-center gap-1">← Tilbage</button>

      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{rider.firstname} {rider.lastname}</h1>
              <button onClick={toggleWatchlist} title={onWatchlist ? "Fjern fra ønskeliste" : "Tilføj til ønskeliste"}
                className={`text-2xl transition-all hover:scale-110 ${onWatchlist ? "text-[#e8c547]" : "text-white/20 hover:text-white/50"}`}>
                {onWatchlist ? "★" : "☆"}
              </button>
            </div>
            {watchlistCount > 0 && (
              <p className="text-white/25 text-xs mt-1">👁 {watchlistCount} manager{watchlistCount !== 1 ? "s" : ""} følger denne rytter</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {rider.is_u25 && <span className="text-xs uppercase bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">U25</span>}
              <span className="text-white/40 text-sm">{typeLabel}</span>
              {age && <span className="text-white/30 text-sm">{age} år</span>}
              {rider.height && <span className="text-white/30 text-sm">{rider.height} cm</span>}
              {rider.weight && <span className="text-white/30 text-sm">{rider.weight} kg</span>}
            </div>
            <p className="text-white/40 text-sm mt-2">{rider.team ? `Hold: ${rider.team.name}` : "Fri agent"}</p>
          </div>
          <div className="text-right">
            <p className="text-[#e8c547] font-mono font-bold text-2xl">{rider.uci_points?.toLocaleString("da-DK")}</p>
            <p className="text-white/30 text-xs mt-0.5">UCI Point / Pris</p>
            {bestStat && <p className="text-white/40 text-xs mt-2">Bedste: <span className="text-[#e8c547]">{bestStat.label} ({rider[bestStat.key]})</span></p>}
          </div>
        </div>
        <div className="mt-5 pt-5 border-t border-white/5 flex flex-col gap-3">
          {canAuction && <AuctionButton rider={rider} isMyRider={isMyRider} onStart={startAuction} />}
          {rider.team_id && rider.team_id !== myTeamId && <DirectOfferButton rider={rider} />}
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {[{ key: "stats", label: "Evner" }, { key: "season", label: "Sæsonhistorik" }, { key: "results", label: "Løbsresultater" }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${tab === t.key ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20" : "text-white/40 border-white/5 hover:text-white hover:border-white/10"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "stats" && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
          {STATS.map(s => <StatRow key={s.key} label={s.label} icon={s.icon} value={rider[s.key]} />)}
        </div>
      )}

      {tab === "season" && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
          {Object.keys(bySeason).length === 0 ? (
            <p className="text-white/20 text-center py-8">Ingen historik endnu</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-white/5">
                <th className="py-2 text-left text-white/30 text-xs uppercase">År</th>
                <th className="py-2 text-right text-white/30 text-xs uppercase">Sejre</th>
                <th className="py-2 text-right text-white/30 text-xs uppercase">Top 3</th>
                <th className="py-2 text-right text-white/30 text-xs uppercase">Præmier</th>
              </tr></thead>
              <tbody>
                {Object.entries(bySeason).map(([yr, d]) => (
                  <tr key={yr} className="border-b border-white/4">
                    <td className="py-2 text-white/50">{yr}</td>
                    <td className="py-2 text-right text-[#e8c547] font-mono">{d.wins}</td>
                    <td className="py-2 text-right text-white/50 font-mono">{d.top3}</td>
                    <td className="py-2 text-right text-green-400 font-mono text-xs">+{d.totalPrize.toLocaleString("da-DK")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "results" && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
          {results.length === 0 ? (
            <p className="text-white/20 text-center py-8">Ingen løbsresultater endnu</p>
          ) : (
            <table className="w-full">
              <thead><tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-white/25 text-[10px] uppercase">Løb</th>
                <th className="px-4 py-3 text-center text-white/25 text-[10px] uppercase">Type</th>
                <th className="px-4 py-3 text-right text-white/25 text-[10px] uppercase">Plac.</th>
                <th className="px-4 py-3 text-right text-white/25 text-[10px] uppercase">Præmie</th>
              </tr></thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.id} className="border-b border-white/3 last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-white text-sm">{r.race?.name || "—"}</p>
                      <p className="text-white/30 text-xs">{r.race?.start_date?.slice(0, 4) || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-center text-white/40 text-xs">{r.result_type || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono font-bold text-sm ${r.position === 1 ? "text-[#e8c547]" : r.position <= 3 ? "text-white" : "text-white/50"}`}>
                        #{r.position}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-green-400 font-mono text-xs">
                      {r.prize_money ? `+${r.prize_money.toLocaleString("da-DK")}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
