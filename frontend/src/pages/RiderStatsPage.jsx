import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const STATS = [
  { key: "stat_fl", label: "Flad", icon: "═" },
  { key: "stat_bj", label: "Bjerg", icon: "▲" },
  { key: "stat_kb", label: "Mellembjerg", icon: "△" },
  { key: "stat_bk", label: "Bakke", icon: "∧" },
  { key: "stat_tt", label: "Enkeltstart", icon: "⏱" },
  { key: "stat_prl", label: "Prolog", icon: "◷" },
  { key: "stat_bro", label: "Brosten", icon: "⬡" },
  { key: "stat_sp", label: "Sprint", icon: "⚡" },
  { key: "stat_acc", label: "Acceleration", icon: "▶" },
  { key: "stat_ned", label: "Nedkørsel", icon: "↓" },
  { key: "stat_udh", label: "Udholdenhed", icon: "◎" },
  { key: "stat_mod", label: "Modstandsdygtighed", icon: "◈" },
  { key: "stat_res", label: "Restituering", icon: "↺" },
  { key: "stat_ftr", label: "Fighter", icon: "★" },
];

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
      <span className="font-mono text-sm font-bold w-8 text-right flex-shrink-0" style={{ color }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

export default function RiderStatsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [rider, setRider] = useState(null);
  const [onWatchlist, setOnWatchlist] = useState(false);
  const [watchlistId, setWatchlistId] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('stats');
  const [myTeamId, setMyTeamId] = useState(null);

  useEffect(() => { loadRider(); loadMyTeam(); loadWatchlistStatus(); }, [id]);

  async function loadWatchlistStatus() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase.from("rider_watchlist")
      .select("id").eq("user_id", user.id).eq("rider_id", id).single();
    if (data) { setOnWatchlist(true); setWatchlistId(data.id); }
    else { setOnWatchlist(false); setWatchlistId(null); }
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
    }
  }

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (t) setMyTeamId(t.id);
  }

  async function loadRider() {
    const [riderRes, resultsRes] = await Promise.all([
      supabase.from("riders")
        .select(`*, team:team_id(id, name)`)
        .eq("id", id)
        .single(),
      supabase.from("race_results")
        .select(`*, race:race_id(name, race_type, start_date)`)
        .eq("rider_id", id)
        .order("imported_at", { ascending: false })
        .limit(20),
    ]);
    setRider(riderRes.data);
    setResults(resultsRes.data || []);
    setLoading(false);
  }

  async function startAuction(price) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: rider.id, starting_price: price }),
    });
    const data = await res.json();
    if (res.ok) navigate("/auctions");
    else alert(data.error);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!rider) return <div className="text-center py-16 text-white/30">Rytter ikke fundet</div>;

  const age = rider.birthdate ? Math.floor((new Date() - new Date(rider.birthdate)) / 31557600000) : null;
  const canAuction = !rider.team_id || rider.team_id === myTeamId;
  const isMyRider = rider.team_id === myTeamId;

  const bestStat = STATS.reduce((best, s) => (!best || (rider[s.key] || 0) > (rider[best.key] || 0)) ? s : best, null);
  const typeLabel = (() => {
    const bj = rider.stat_bj || 0, sp = rider.stat_sp || 0, tt = rider.stat_tt || 0, fl = rider.stat_fl || 0;
    if (bj >= 80) return "🏔️ Klatrer";
    if (sp >= 80) return "⚡ Sprinter";
    if (tt >= 80) return "⏱ TT-specialist";
    if (fl >= 78) return "═ Rouleur";
    return "◈ Allrounder";
  })();

  return (
    <div className="max-w-3xl mx-auto">
      {/* Back button */}
      <button onClick={() => navigate(-1)} className="text-white/40 hover:text-white text-sm mb-5 flex items-center gap-2 transition-colors">
        ← Tilbage
      </button>

      {/* Header */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{rider.firstname} {rider.lastname}</h1>
              <button onClick={toggleWatchlist}
                title={onWatchlist ? "Fjern fra ønskeliste" : "Tilføj til ønskeliste"}
                className={`text-2xl transition-all hover:scale-110 ${onWatchlist ? "text-[#e8c547]" : "text-white/20 hover:text-white/50"}`}>
                {onWatchlist ? "★" : "☆"}
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {rider.is_u25 && <span className="text-xs uppercase bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">U25</span>}
              <span className="text-white/40 text-sm">{typeLabel}</span>
              {age && <span className="text-white/30 text-sm">{age} år</span>}
              {rider.height && <span className="text-white/30 text-sm">{rider.height} cm</span>}
              {rider.weight && <span className="text-white/30 text-sm">{rider.weight} kg</span>}
            </div>
            <p className="text-white/40 text-sm mt-2">
              {rider.team ? `Hold: ${rider.team.name}` : "Fri agent"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[#e8c547] font-mono font-bold text-2xl">{rider.uci_points?.toLocaleString("da-DK")}</p>
            <p className="text-white/30 text-xs mt-0.5">UCI Point / Pris</p>
            {bestStat && (
              <p className="text-white/40 text-xs mt-2">
                Bedste: <span className="text-[#e8c547]">{bestStat.label} ({rider[bestStat.key]})</span>
              </p>
            )}
          </div>
        </div>

        {/* Auction button */}
        {canAuction && (
          <div className="mt-5 pt-5 border-t border-white/5">
            <AuctionButton rider={rider} isMyRider={isMyRider} onStart={startAuction} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {[
          { key: "stats", label: "Evner" },
          { key: "season", label: "Sæsonhistorik" },
          { key: "results", label: "Løbsresultater" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${tab === t.key ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20" : "text-white/40 hover:text-white bg-[#0f0f18] border-white/5"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      {tab === "stats" && <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-4">
        <h2 className="text-white font-semibold text-sm mb-4">Evner</h2>
        <div className="grid md:grid-cols-2 gap-x-8">
          {STATS.map(s => <StatRow key={s.key} label={s.label} icon={s.icon} value={rider[s.key]} />)}
        </div>
      </div>

      {/* Race history */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
        <h2 className="text-white font-semibold text-sm mb-4">Løbshistorik ({results.length} resultater)</h2>
        {results.length === 0 ? (
          <p className="text-white/20 text-sm text-center py-6">Ingen løbsresultater endnu</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="py-2 text-left text-white/30 font-medium text-xs uppercase">Løb</th>
                <th className="py-2 text-left text-white/30 font-medium text-xs uppercase">Type</th>
                <th className="py-2 text-right text-white/30 font-medium text-xs uppercase">Placering</th>
                <th className="py-2 text-right text-white/30 font-medium text-xs uppercase">Point</th>
                <th className="py-2 text-right text-white/30 font-medium text-xs uppercase">Præmie</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.id} className="border-b border-white/4 hover:bg-white/3">
                  <td className="py-2.5 text-white font-medium">{r.race?.name || r.race_id?.slice(0, 8)}</td>
                  <td className="py-2.5 text-white/40 text-xs capitalize">
                    {r.result_type === "stage" ? `Etape ${r.stage_number}` :
                     r.result_type === "gc" ? "Samlet" :
                     r.result_type === "points" ? "Point" :
                     r.result_type === "mountain" ? "Bjerg" :
                     r.result_type === "young" ? "Ungt" : r.result_type}
                  </td>
                  <td className="py-2.5 text-right">
                    <span className={`font-mono font-bold ${r.rank === 1 ? "text-[#e8c547]" : r.rank <= 3 ? "text-white" : "text-white/50"}`}>
                      #{r.rank}
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-white/50 font-mono">{r.points_earned || 0}</td>
                  <td className="py-2.5 text-right text-green-400 font-mono text-xs">
                    {r.prize_money > 0 ? `+${r.prize_money}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>}
    </div>
  );
}

function SeasonHistoryTab({ riderId }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Get all completed auctions involving this rider (team changes)
      const { data: transfers } = await supabase
        .from("auctions")
        .select("current_price, actual_end, seller:seller_team_id(name), buyer:current_bidder_id(name)")
        .eq("rider_id", riderId)
        .eq("status", "completed")
        .order("actual_end", { ascending: false });

      // Get race results per season
      const { data: results } = await supabase
        .from("race_results")
        .select("rank, result_type, prize_money, points_earned, race:race_id(name, start_date, season_id)")
        .eq("rider_id", riderId)
        .order("imported_at", { ascending: false });

      // Group results by season
      const bySeason = {};
      (results || []).forEach(r => {
        const sid = r.race?.season_id || "unknown";
        if (!bySeason[sid]) bySeason[sid] = { results: [], totalPrize: 0, wins: 0, top3: 0 };
        bySeason[sid].results.push(r);
        bySeason[sid].totalPrize += r.prize_money || 0;
        if (r.rank === 1) bySeason[sid].wins++;
        if (r.rank <= 3) bySeason[sid].top3++;
      });

      setHistory({ transfers: transfers || [], bySeason });
      setLoading(false);
    }
    load();
  }, [riderId]);

  if (loading) return <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="flex flex-col gap-4">
      {/* Team history */}
      {history.transfers?.length > 0 && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
          <h3 className="text-white font-semibold text-sm mb-3">Holdhistorik</h3>
          <div className="flex flex-col gap-2">
            {history.transfers.map((t, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div>
                  <p className="text-white text-sm">{t.buyer?.name || "Ukendt"}</p>
                  <p className="text-white/30 text-xs">Købt fra: {t.seller?.name || "Fri agent"}</p>
                </div>
                <div className="text-right">
                  <p className="text-[#e8c547] font-mono text-sm">{t.current_price?.toLocaleString("da-DK")} CZ$</p>
                  <p className="text-white/30 text-xs">{t.actual_end ? new Date(t.actual_end).toLocaleDateString("da-DK") : "—"}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Season stats */}
      {Object.entries(history.bySeason || {}).length > 0 && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
          <h3 className="text-white font-semibold text-sm mb-3">Sæsonresultater</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/5">
              <th className="py-2 text-left text-white/30 font-medium text-xs uppercase">Sæson</th>
              <th className="py-2 text-right text-white/30 font-medium text-xs uppercase">Sejre</th>
              <th className="py-2 text-right text-white/30 font-medium text-xs uppercase">Top 3</th>
              <th className="py-2 text-right text-white/30 font-medium text-xs uppercase">Præmier</th>
            </tr></thead>
            <tbody>
              {Object.entries(history.bySeason).map(([sid, data]) => (
                <tr key={sid} className="border-b border-white/4">
                  <td className="py-2 text-white/50 text-xs">{sid === "unknown" ? "—" : sid.slice(0, 8)}</td>
                  <td className="py-2 text-right text-[#e8c547] font-mono">{data.wins}</td>
                  <td className="py-2 text-right text-white/50 font-mono">{data.top3}</td>
                  <td className="py-2 text-right text-green-400 font-mono text-xs">+{data.totalPrize.toLocaleString("da-DK")} CZ$</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history.transfers?.length === 0 && Object.keys(history.bySeason || {}).length === 0 && (
        <div className="text-center py-10 text-white/20">
          <p>Ingen historik endnu</p>
        </div>
      )}
    </div>
  );
}

function AuctionButton({ rider, isMyRider, onStart }) {
  const [price, setPrice] = useState(Math.max(rider.uci_points || 1, 1));
  const [loading, setLoading] = useState(false);

  return (
    <div>
      <p className="text-white/30 text-xs uppercase tracking-widest mb-2">
        {isMyRider ? "Sæt til auktion" : "Start auktion (fri rytter)"}
      </p>
      <div className="flex gap-2">
        <input type="number" value={price} min={1}
          onChange={e => setPrice(parseInt(e.target.value))}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2
            text-white text-sm font-mono focus:outline-none focus:border-[#e8c547]/50" />
        <button onClick={async () => { setLoading(true); await onStart(price); setLoading(false); }}
          disabled={loading}
          className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm
            hover:bg-[#f0d060] transition-all disabled:opacity-50">
          {loading ? "..." : "Start auktion"}
        </button>
      </div>
    </div>
  );
}
