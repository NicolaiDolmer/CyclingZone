import { useState, useEffect } from "react";
import RiderFilters, { DEFAULT_FILTERS } from "../components/RiderFilters";
import { buildSupabaseQuery } from "../lib/useRiderFilters";
import { supabase } from "../lib/supabase";
import { useNavigate, Link } from "react-router-dom";

const STATS = [
  { key: "stat_fl", label: "FL" }, { key: "stat_bj", label: "BJ" },
  { key: "stat_kb", label: "KB" }, { key: "stat_bk", label: "BK" },
  { key: "stat_tt", label: "TT" }, { key: "stat_prl", label: "PRL" },
  { key: "stat_bro", label: "Bro" }, { key: "stat_sp", label: "SP" },
  { key: "stat_acc", label: "ACC" }, { key: "stat_ned", label: "NED" },
  { key: "stat_udh", label: "UDH" }, { key: "stat_mod", label: "MOD" },
  { key: "stat_res", label: "RES" }, { key: "stat_ftr", label: "FTR" },
];

const MOBILE_STATS = [
  { key: "stat_bj", label: "BJ" }, { key: "stat_sp", label: "SP" },
  { key: "stat_tt", label: "TT" }, { key: "stat_fl", label: "FL" },
  { key: "stat_udh", label: "UDH" },
];

function StatBar({ value }) {
  const pct = Math.round((value / 99) * 100);
  const color = value >= 80 ? "bg-[#e8c547]" : value >= 65 ? "bg-blue-400" : "bg-white/20";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-full bg-white/8 rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[11px] font-mono w-5 text-right flex-shrink-0 ${value >= 80 ? "text-[#e8c547]" : "text-white/50"}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function StarButton({ riderId, watchlist, onToggle }) {
  const isWatched = watchlist.has(riderId);
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(riderId); }}
      title={isWatched ? "Fjern fra ønskeliste" : "Tilføj til ønskeliste"}
      className={`text-lg transition-all hover:scale-110 flex-shrink-0 ${isWatched ? "text-[#e8c547]" : "text-white/20 hover:text-white/50"}`}>
      {isWatched ? "★" : "☆"}
    </button>
  );
}

function RiderCard({ rider, onClick, watchlist, onToggleWatchlist }) {
  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 hover:border-white/10
      cursor-pointer transition-all active:scale-98">
      <div className="flex items-start justify-between mb-3">
        <div onClick={() => onClick(rider)} className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm truncate">
            {rider.firstname} {rider.lastname}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {rider.is_u25 && (
              <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>
            )}
            <span className="text-white/30 text-xs">{rider.team?.name || "Fri"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-2">
          <span className="text-[#e8c547] font-mono font-bold text-sm whitespace-nowrap">
            {rider.uci_points?.toLocaleString("da-DK")} CZ$
          </span>
          <StarButton riderId={rider.id} watchlist={watchlist} onToggle={onToggleWatchlist} />
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2" onClick={() => onClick(rider)}>
        {MOBILE_STATS.map(({ key, label }) => (
          <div key={key} className="text-center">
            <p className="text-white/20 text-[9px] uppercase mb-0.5">{label}</p>
            <p className={`font-mono text-xs font-bold ${rider[key] >= 80 ? "text-[#e8c547]" : "text-white/50"}`}>
              {rider[key] || "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiderRow({ rider, onSelect, watchlist, onToggleWatchlist }) {
  return (
    <tr className="border-b border-white/4 hover:bg-white/3 cursor-pointer transition-colors">
      <td className="px-3 py-2.5" onClick={() => onSelect(rider)}>
        <div>
          <p className="text-white text-sm font-medium">{rider.firstname} {rider.lastname}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {rider.is_u25 && (
              <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>
            )}
            <span className="text-white/30 text-xs">{rider.team?.name || "Fri"}</span>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right" onClick={() => onSelect(rider)}>
        <span className="text-[#e8c547] font-mono text-sm font-bold">
          {rider.uci_points?.toLocaleString("da-DK")}
        </span>
      </td>
      {STATS.map(({ key }) => (
        <td key={key} className="px-1.5 py-2.5 w-14" onClick={() => onSelect(rider)}>
          <StatBar value={rider[key]} />
        </td>
      ))}
      <td className="px-3 py-2.5">
        <StarButton riderId={rider.id} watchlist={watchlist} onToggle={onToggleWatchlist} />
      </td>
    </tr>
  );
}

export default function RidersPage() {
  const navigate = useNavigate();
  const [riders, setRiders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [watchlist, setWatchlist] = useState(new Set());
  const [userId, setUserId] = useState(null);
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS, page: 1 });

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      supabase.from("rider_watchlist").select("rider_id").eq("user_id", user.id)
        .then(({ data }) => setWatchlist(new Set((data || []).map(w => w.rider_id))));
    });
  }, []);

  useEffect(() => { loadRiders(); }, [filters]);

  async function toggleWatchlist(riderId) {
    if (!userId) return;
    if (watchlist.has(riderId)) {
      await supabase.from("rider_watchlist").delete().eq("user_id", userId).eq("rider_id", riderId);
      setWatchlist(prev => { const s = new Set(prev); s.delete(riderId); return s; });
    } else {
      await supabase.from("rider_watchlist").insert({ user_id: userId, rider_id: riderId });
      setWatchlist(prev => new Set([...prev, riderId]));
    }
  }

  async function loadRiders() {
    setLoading(true);
    const statKeys = STATS.map(s => s.key).join(", ");
    let query = supabase
      .from("riders")
      .select(`id, firstname, lastname, birthdate, uci_points, is_u25,
        ${statKeys}, team:team_id(id, name)`, { count: "exact" })
      .range((filters.page - 1) * 50, filters.page * 50 - 1);

    query = buildSupabaseQuery(query, filters);

    const { data, count } = await query;
    setRiders(data || []);
    setTotal(count || 0);
    setLoading(false);
  }

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value, page: 1 }));
  }

  function onReset() {
    setFilters({ ...DEFAULT_FILTERS, page: 1 });
  }

  return (
    <div className="max-w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Rytterdatabase</h1>
          <p className="text-white/30 text-sm">{total.toLocaleString("da-DK")} ryttere</p>
        </div>
        <Link to="/watchlist"
          className="px-3 py-1.5 bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20
            rounded-lg text-xs font-medium hover:bg-[#e8c547]/20 transition-all">
          ⭐ Min ønskeliste ({watchlist.size})
        </Link>
      </div>

      <RiderFilters filters={filters} onChange={setFilter} onReset={onReset} showTeamFilter={false} />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : isMobile ? (
        <div className="flex flex-col gap-3">
          {riders.map(r => (
            <RiderCard key={r.id} rider={r}
              onClick={r => navigate(`/riders/${r.id}`)}
              watchlist={watchlist}
              onToggleWatchlist={toggleWatchlist} />
          ))}
        </div>
      ) : (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-3 py-3 text-left text-white/30 font-medium uppercase tracking-wider w-48">Rytter</th>
                  <th className="px-3 py-3 text-right text-white/30 font-medium uppercase tracking-wider w-20">UCI CZ$</th>
                  {STATS.map(({ label }) => (
                    <th key={label} className="px-1.5 py-3 text-center text-white/20 font-medium w-14">{label}</th>
                  ))}
                  <th className="px-3 py-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {riders.map(r => (
                  <RiderRow key={r.id} rider={r}
                    onSelect={r => navigate(`/riders/${r.id}`)}
                    watchlist={watchlist}
                    onToggleWatchlist={toggleWatchlist} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-white/30 text-xs">
          Viser {Math.min((filters.page - 1) * 50 + 1, total)}–{Math.min(filters.page * 50, total)} af {total.toLocaleString("da-DK")}
        </span>
        <div className="flex gap-2">
          <button disabled={filters.page <= 1}
            onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
            className="px-3 py-1.5 bg-white/5 rounded text-white/50 text-xs
              hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed">
            ← Forrige
          </button>
          <button disabled={filters.page * 50 >= total}
            onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
            className="px-3 py-1.5 bg-white/5 rounded text-white/50 text-xs
              hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed">
            Næste →
          </button>
        </div>
      </div>
    </div>
  );
}
