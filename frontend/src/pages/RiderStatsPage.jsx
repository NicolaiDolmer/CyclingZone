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
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);

  useEffect(() => { loadRider(); loadMyTeam(); }, [id]);

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
            <h1 className="text-2xl font-bold text-white">{rider.firstname} {rider.lastname}</h1>
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

      {/* Stats */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-4">
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
      </div>
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
