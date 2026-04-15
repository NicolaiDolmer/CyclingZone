import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

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

function StatBar({ value, max = 99 }) {
  const pct = Math.round((value / max) * 100);
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

function RiderRow({ rider, onSelect }) {
  return (
    <tr className="border-b border-white/4 hover:bg-white/3 cursor-pointer transition-colors"
      onClick={() => onSelect(rider)}>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div>
            <p className="text-white text-sm font-medium">
              {rider.firstname} {rider.lastname}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {rider.is_u25 && (
                <span className="text-[9px] uppercase tracking-wider bg-blue-500/20
                  text-blue-400 px-1.5 py-0.5 rounded">U25</span>
              )}
              <span className="text-white/30 text-xs">{rider.team?.name || "Fri"}</span>
            </div>
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

function RiderDetail({ rider, onClose, myTeamId }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [auctionPrice, setAuctionPrice] = useState(rider.uci_points || 1);

  async function startAuction() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auctions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ rider_id: rider.id, starting_price: auctionPrice }),
    });
    const data = await res.json();
    setMsg(res.ok ? data.message : data.error);
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#0f0f18] border border-white/10 rounded-2xl
        w-full max-w-lg max-h-[90vh] overflow-y-auto">

        <div className="flex items-start justify-between p-5 border-b border-white/5">
          <div>
            <h2 className="text-white font-bold text-lg">
              {rider.firstname} {rider.lastname}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              {rider.is_u25 && (
                <span className="text-[10px] uppercase bg-blue-500/20 text-blue-400
                  px-1.5 py-0.5 rounded">U25</span>
              )}
              <span className="text-white/40 text-sm">{rider.team?.name || "Fri agent"}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[#e8c547] font-mono font-bold text-xl">
              {rider.uci_points?.toLocaleString("da-DK")} pts
            </p>
            <p className="text-white/30 text-xs">Pris</p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="p-5">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Evner</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {STATS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-white/30 text-xs w-8 flex-shrink-0">{label}</span>
                <StatBar value={rider[key]} />
              </div>
            ))}
          </div>

          {/* Auction section — only if rider is on my team */}
          {/* Show auction section if: own rider OR free agent/AI rider */}
          {(rider.team?.id === myTeamId || !rider.team?.id) && (
            <div className="mt-5 pt-5 border-t border-white/5">
              <p className="text-white/30 text-xs uppercase tracking-widest mb-3">
                {rider.team?.id === myTeamId ? "Sæt til auktion" : "Byd på rytter — start auktion"}
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={auctionPrice}
                  min={1}
                  onChange={e => setAuctionPrice(parseInt(e.target.value))}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2
                    text-white text-sm font-mono focus:outline-none focus:border-[#e8c547]/50"
                />
                <button onClick={startAuction} disabled={loading}
                  className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
                    text-sm hover:bg-[#f0d060] transition-all disabled:opacity-50">
                  {loading ? "..." : "Start auktion"}
                </button>
              </div>
              {msg && (
                <p className={`text-xs mt-2 ${msg.includes("startet") ? "text-green-400" : "text-red-400"}`}>
                  {msg}
                </p>
              )}
            </div>
          )}
        </div>

        <button onClick={onClose}
          className="absolute top-4 right-4 text-white/30 hover:text-white text-xl">
          ×
        </button>
      </div>
    </div>
  );
}

export default function RidersPage() {
  const [riders, setRiders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [myTeamId, setMyTeamId] = useState(null);
  const [filters, setFilters] = useState({
    q: "", free_agent: false, u25: false, min_uci: "", max_uci: "",
    sort: "uci_points", page: 1,
  });

  useEffect(() => {
    loadMyTeam();
  }, []);

  useEffect(() => {
    loadRiders();
  }, [filters]);

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: team } = await supabase
      .from("teams").select("id").eq("user_id", user.id).single();
    if (team) setMyTeamId(team.id);
  }

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
        <input
          type="text"
          placeholder="Søg rytter..."
          value={filters.q}
          onChange={e => setFilter("q", e.target.value)}
          className="bg-[#0f0f18] border border-white/8 rounded-lg px-3 py-2
            text-white text-sm placeholder-white/20 w-48
            focus:outline-none focus:border-[#e8c547]/50"
        />
        <input
          type="number"
          placeholder="Min UCI"
          value={filters.min_uci}
          onChange={e => setFilter("min_uci", e.target.value)}
          className="bg-[#0f0f18] border border-white/8 rounded-lg px-3 py-2
            text-white text-sm placeholder-white/20 w-28
            focus:outline-none focus:border-[#e8c547]/50"
        />
        <input
          type="number"
          placeholder="Max UCI"
          value={filters.max_uci}
          onChange={e => setFilter("max_uci", e.target.value)}
          className="bg-[#0f0f18] border border-white/8 rounded-lg px-3 py-2
            text-white text-sm placeholder-white/20 w-28
            focus:outline-none focus:border-[#e8c547]/50"
        />
        <button
          onClick={() => setFilter("free_agent", !filters.free_agent)}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border
            ${filters.free_agent
              ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/30"
              : "bg-[#0f0f18] text-white/40 border-white/8 hover:text-white"}`}>
          Fri agents
        </button>
        <button
          onClick={() => setFilter("u25", !filters.u25)}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border
            ${filters.u25
              ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
              : "bg-[#0f0f18] text-white/40 border-white/8 hover:text-white"}`}>
          U25
        </button>
        <select
          value={filters.sort}
          onChange={e => setFilter("sort", e.target.value)}
          className="bg-[#0f0f18] border border-white/8 rounded-lg px-3 py-2
            text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
          <option value="uci_points">Sorter: UCI Point</option>
          <option value="stat_bj">Sorter: Bjerg</option>
          <option value="stat_sp">Sorter: Sprint</option>
          <option value="stat_tt">Sorter: TT</option>
          <option value="stat_fl">Sorter: Flad</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-3 py-3 text-left text-white/30 font-medium uppercase tracking-wider w-48">
                  Rytter
                </th>
                <th className="px-3 py-3 text-right text-white/30 font-medium uppercase tracking-wider w-20">
                  UCI pts
                </th>
                {STATS.map(({ label }) => (
                  <th key={label} className="px-1.5 py-3 text-center text-white/20 font-medium w-14">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={16} className="text-center py-12 text-white/30">
                    <div className="w-5 h-5 border-2 border-[#e8c547] border-t-transparent
                      rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              ) : riders.map(r => (
                <RiderRow key={r.id} rider={r} onSelect={setSelected} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
          <span className="text-white/30 text-xs">
            Viser {Math.min((filters.page - 1) * 50 + 1, total)}–{Math.min(filters.page * 50, total)} af {total.toLocaleString("da-DK")}
          </span>
          <div className="flex gap-2">
            <button
              disabled={filters.page <= 1}
              onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
              className="px-3 py-1.5 bg-white/5 rounded text-white/50 text-xs
                hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed">
              ← Forrige
            </button>
            <button
              disabled={filters.page * 50 >= total}
              onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
              className="px-3 py-1.5 bg-white/5 rounded text-white/50 text-xs
                hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed">
              Næste →
            </button>
          </div>
        </div>
      </div>

      {selected && (
        <RiderDetail
          rider={selected}
          onClose={() => setSelected(null)}
          myTeamId={myTeamId}
        />
      )}
    </div>
  );
}
