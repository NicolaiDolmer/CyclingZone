import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { getFlagEmoji } from "../lib/countryUtils";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";
import PotentialeStars from "../components/PotentialeStars";

const STATS = [
  { key: "stat_fl",  label: "Flad",             icon: "═" },
  { key: "stat_bj",  label: "Bjerg",            icon: "▲" },
  { key: "stat_kb",  label: "Mellembjerg",       icon: "△" },
  { key: "stat_bk",  label: "Bakke",            icon: "∧" },
  { key: "stat_tt",  label: "Enkeltstart",       icon: "⏱" },
  { key: "stat_prl", label: "Prolog",            icon: "◷" },
  { key: "stat_bro", label: "Brosten",           icon: "⬡" },
  { key: "stat_sp",  label: "Sprint",            icon: "⚡" },
  { key: "stat_acc", label: "Acceleration",      icon: "▶" },
  { key: "stat_ned", label: "Nedkørsel",         icon: "↓" },
  { key: "stat_udh", label: "Udholdenhed",       icon: "◎" },
  { key: "stat_mod", label: "Modstandsdygtighed",icon: "◈" },
  { key: "stat_res", label: "Restituering",      icon: "↺" },
  { key: "stat_ftr", label: "Fighter",           icon: "★" },
];

function RiderSearch({ onSelect, excluded }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    const timeout = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase
        .from("riders")
        .select("id, firstname, lastname, uci_points, market_value, prize_earnings_bonus, team:team_id(name)")
        .or(`firstname.ilike.%${q}%,lastname.ilike.%${q}%`)
        .order("uci_points", { ascending: false })
        .limit(8);
      setResults((data || []).filter(r => !excluded.includes(r.id)));
      setLoading(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [q, excluded]);

  return (
    <div className="relative">
      <input
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Søg rytter at tilføje..."
        className="w-full bg-slate-100 border border-slate-300 rounded-lg px-4 py-2.5
          text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:border-amber-400"
      />
      {(results.length > 0 || loading) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-300
          rounded-xl shadow-2xl z-20 overflow-hidden">
          {loading ? (
            <div className="p-3 text-center text-slate-400 text-sm">Søger...</div>
          ) : (
            results.map(r => (
              <div key={r.id}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-100
                  cursor-pointer border-b border-slate-200 last:border-0"
                onClick={() => { onSelect(r); setQ(""); setResults([]); }}>
                <div>
                  <p className="text-slate-900 text-sm font-medium">{r.firstname} {r.lastname}</p>
                  <p className="text-slate-400 text-xs">{r.team?.name || "Fri agent"}</p>
                </div>
                <span className="text-amber-700 font-mono text-xs">
                  {formatCz(getRiderMarketValue(r))}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function RiderComparePage() {
  const navigate = useNavigate();
  const [riders, setRiders] = useState([]);
  const [fullRiders, setFullRiders] = useState([]);

  async function addRider(rider) {
    if (fullRiders.length >= 3) return;
    if (fullRiders.find(r => r.id === rider.id)) return;

    const { data } = await supabase
      .from("riders")
      .select(`*, team:team_id(name)`)
      .eq("id", rider.id)
      .single();
    if (data) setFullRiders(prev => [...prev, data]);
  }

  function removeRider(id) {
    setFullRiders(prev => prev.filter(r => r.id !== id));
  }

  const COLORS = ["#e8c547", "#60a5fa", "#a78bfa"];

  function getBestForStat(statKey) {
    if (fullRiders.length < 2) return null;
    return fullRiders.reduce((best, r) =>
      (r[statKey] || 0) > (best[statKey] || 0) ? r : best
    ).id;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Sammenlign Ryttere</h1>
        <p className="text-slate-400 text-sm">Tilføj op til 3 ryttere for at sammenligne stats</p>
      </div>

      {/* Search */}
      {fullRiders.length < 3 && (
        <div className="mb-5">
          <RiderSearch onSelect={addRider} excluded={fullRiders.map(r => r.id)} />
        </div>
      )}

      {fullRiders.length === 0 ? (
        <div className="text-center py-16 text-slate-300">
          <p className="text-4xl mb-3">◈</p>
          <p>Søg efter en rytter ovenfor for at starte sammenligning</p>
        </div>
      ) : (
        <>
          {/* Rider headers */}
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: `200px repeat(${fullRiders.length}, 1fr)` }}>
            <div /> {/* Empty cell for label column */}
            {fullRiders.map((r, i) => (
              <div key={r.id} className="bg-white border rounded-xl p-4 text-center"
                style={{ borderColor: `${COLORS[i]}30` }}>
                <button
                  onClick={() => removeRider(r.id)}
                  className="float-right text-slate-300 hover:text-slate-500 text-sm -mt-1 -mr-1">×</button>
                <p className="font-bold text-slate-900 text-sm cursor-pointer hover:text-amber-700"
                  onClick={() => navigate(`/riders/${r.id}`)}>
                  {r.nationality_code && <span className="mr-1">{getFlagEmoji(r.nationality_code)}</span>}{r.firstname} {r.lastname}
                </p>
                <p className="text-slate-400 text-xs mt-1">{r.team?.name || "Fri agent"}</p>
                <p className="font-mono font-bold mt-2 text-sm" style={{ color: COLORS[i] }}>
                  {formatCz(getRiderMarketValue(r))}
                </p>
                {r.is_u25 && (
                  <span className="text-[9px] uppercase bg-blue-500/20 text-blue-700
                    px-1.5 py-0.5 rounded mt-1 inline-block">U25</span>
                )}
              </div>
            ))}
          </div>

          {/* Stats comparison */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Potentiale row */}
            {fullRiders.some(r => r.potentiale != null) && (
              <div className="grid items-center py-3 px-4 border-b border-slate-200 bg-amber-50/30"
                style={{ gridTemplateColumns: `200px repeat(${fullRiders.length}, 1fr)` }}>
                <div className="flex items-center gap-2">
                  <span className="text-slate-300 w-4 text-center">◆</span>
                  <span className="text-slate-500 text-sm font-medium">Potentiale</span>
                </div>
                {fullRiders.map(r => (
                  <div key={r.id} className="px-2">
                    <PotentialeStars value={r.potentiale} birthdate={r.birthdate} showValue />
                  </div>
                ))}
              </div>
            )}
            {STATS.map((stat, idx) => {
              const bestId = getBestForStat(stat.key);
              return (
                <div key={stat.key}
                  className={`grid items-center py-3 px-4 border-b border-slate-200 last:border-0
                    ${idx % 2 === 0 ? "bg-transparent" : ""}`}
                  style={{ gridTemplateColumns: `200px repeat(${fullRiders.length}, 1fr)` }}>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-300 w-4 text-center">{stat.icon}</span>
                    <span className="text-slate-500 text-sm">{stat.label}</span>
                  </div>
                  {fullRiders.map((r, i) => {
                    const val = r[stat.key];
                    const isBest = r.id === bestId;
                    return (
                      <div key={r.id} className="px-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-2">
                            <div className="h-2 rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.round(((val || 0) / 99) * 100)}%`,
                                backgroundColor: isBest ? COLORS[i] : `${COLORS[i]}60`,
                              }} />
                          </div>
                          <span className={`font-mono text-xs font-bold w-6 text-right flex-shrink-0
                            ${isBest ? "text-slate-900" : "text-slate-500"}`}
                            style={{ color: isBest ? COLORS[i] : undefined }}>
                            {val ?? "—"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
