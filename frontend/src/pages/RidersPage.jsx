import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const STATS = [
  { key: "stat_fl", label: "FL" },
  { key: "stat_bj", label: "BJ" },
  { key: "stat_kb", label: "KB" },
  { key: "stat_bk", label: "BK" },
  { key: "stat_tt", label: "TT" },
  { key: "stat_prl", label: "PRL" },
  { key: "stat_bro", label: "Bro" },
  { key: "stat_sp", label: "SP" },
  { key: "stat_acc", label: "ACC" },
  { key: "stat_ned", label: "NED" },
  { key: "stat_udh", label: "UDH" },
  { key: "stat_mod", label: "MOD" },
  { key: "stat_res", label: "RES" },
  { key: "stat_ftr", label: "FTR" },
];

// Top 5 stats to show in mobile card view
const MOBILE_STATS = [
  { key: "stat_bj", label: "BJ" },
  { key: "stat_sp", label: "SP" },
  { key: "stat_tt", label: "TT" },
  { key: "stat_fl", label: "FL" },
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
      <span className={`text-[11px] font-mono w-5 text-right flex-shrink-0
        ${value >= 80 ? "text-[#e8c547]" : "text-white/50"}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}

// Mobile card view
function RiderCard({ rider, onClick }) {
  return (
    <div onClick={() => onClick(rider)}
      className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 hover:border-white/10
        cursor-pointer transition-all active:scale-98">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-white font-medium text-sm">
            {rider.firstname} {rider.lastname}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {rider.is_u25 && (
              <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>
            )}
            <span className="text-white/30 text-xs">{rider.team?.name || "Fri"}</span>
          </div>
        </div>
        <span className="text-[#e8c547] font-mono font-bold text-sm">
          {rider.uci_points?.toLocaleString("da-DK")} CZ$
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {MOBILE_STATS.map(({ key, label }) => (
          <div key={key} className="text-center">
            <p className="text-white/20 text-[9px] uppercase mb-0.5">{label}</p>
            <p className={`font-mono text-xs font-bold
              ${rider[key] >= 80 ? "text-[#e8c547]" : "text-white/50"}`}>
              {rider[key] || "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Desktop table row
function RiderRow({ rider, onSelect }) {
  return (
    <tr className="border-b border-white/4 hover:bg-white/3 cursor-pointer transition-colors"
      onClick={() => onSelect(rider)}>
      <td className="px-3 py-2.5">
        <div>
          <p className="text-white text-sm font-medium">
            {rider.firstname} {rider.lastname}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {rider.is_u25 && (
              <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>
            )}
            <span className="text-white/30 text-xs">{rider.team?.name || "Fri"}</span>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-[#e8c547] font-mono text-sm font-bold">
          {rider.uci_points?.toLocaleString("da-DK")}
        </span>
      </td>
      {STATS.map(({ key }) => (
        <td key={key} className="px-1.5 py-2.5 w-14">
          <StatBar value={rider[key]} />
        </td>
      ))}
    </tr>
  );
}

export default function RidersPage() {
  const navigate = useNavigate();
  const [riders, setRiders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [filters, setFilters] = useState({
    q: "", free_agent: false, u25: false, min_uci: "", max_uci: "",
    sort: "uci_points", page: 1,
  });

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => { loadRiders(); }, [filters]);

  async function loadRiders() {
    setLoading(true);
    let query = supabase
      .from("riders")
      .select(`id, firstname, lastname, birthdate, uci_points, is_u25,
        stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl,
        stat_bro, stat_sp, stat_acc, stat_ned, stat_udh, stat_mod,
        stat_res, stat_ftr,
        team:team_id(id, name)`, { count: "exact" })
      .order(filters.sort, { ascending: false })
      .range((filters.page - 1) * 50, filters.page * 50 - 1);

    if (filters.q) query = query.or(`firstname.ilike.%${filters.q}%,lastname.ilike.%${filters.q}%`);
    if (filters.free_agent) query = query.is("team_id", null);
    if (filters.u25) query = query.eq("is_u25", true);
    if (filters.min_uci) query = query.gte("uci_points", parseInt(filters.min_uci));
    if (filters.max_uci) query = query.lte("uci_points", parseInt(filters.max_uci));

    const { data, count } = await query;
    setRiders(data || []);
    setTotal(count || 0);
    setLoading(false);
  }

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value, page: 1 }));
  }

  return (
    <div className="max-w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Rytterdatabase</h1>
          <p className="text-white/30 text-sm">{total.toLocaleString("da-DK")} ryttere</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input type="text" placeholder="Søg rytter..." value={filters.q}
          onChange={e => setFilter("q", e.target.value)}
          className="bg-[#0f0f18] border border-white/8 rounded-lg px-3 py-2
            text-white text-sm placeholder-white/20 w-full sm:w-48
            focus:outline-none focus:border-[#e8c547]/50" />
        <input type="number" placeholder="Min UCI" value={filters.min_uci}
          onChange={e => setFilter("min_uci", e.target.value)}
          className="bg-[#0f0f18] border border-white/8 rounded-lg px-3 py-2
            text-white text-sm placeholder-white/20 w-24
            focus:outline-none focus:border-[#e8c547]/50" />
        <input type="number" placeholder="Max UCI" value={filters.max_uci}
          onChange={e => setFilter("max_uci", e.target.value)}
          className="bg-[#0f0f18] border border-white/8 rounded-lg px-3 py-2
            text-white text-sm placeholder-white/20 w-24
            focus:outline-none focus:border-[#e8c547]/50" />
        <button onClick={() => setFilter("free_agent", !filters.free_agent)}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border
            ${filters.free_agent
              ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/30"
              : "bg-[#0f0f18] text-white/40 border-white/8 hover:text-white"}`}>
          Fri agents
        </button>
        <button onClick={() => setFilter("u25", !filters.u25)}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border
            ${filters.u25
              ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
              : "bg-[#0f0f18] text-white/40 border-white/8 hover:text-white"}`}>
          U25
        </button>
        <select value={filters.sort} onChange={e => setFilter("sort", e.target.value)}
          className="bg-[#0f0f18] border border-white/8 rounded-lg px-3 py-2
            text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
          <option value="uci_points">UCI Point</option>
          <option value="stat_bj">Bjerg</option>
          <option value="stat_sp">Sprint</option>
          <option value="stat_tt">TT</option>
          <option value="stat_fl">Flad</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : isMobile ? (
        /* Mobile card view */
        <div className="flex flex-col gap-3">
          {riders.map(r => (
            <RiderCard key={r.id} rider={r} onClick={(r) => navigate(`/riders/${r.id}`)} />
          ))}
        </div>
      ) : (
        /* Desktop table view */
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
                </tr>
              </thead>
              <tbody>
                {riders.map(r => (
                  <RiderRow key={r.id} rider={r} onSelect={(r) => navigate(`/riders/${r.id}`)} />
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
