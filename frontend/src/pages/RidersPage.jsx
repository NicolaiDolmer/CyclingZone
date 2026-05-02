import { useState, useEffect } from "react";
import RiderFilters, { DEFAULT_FILTERS } from "../components/RiderFilters";
import { buildSupabaseQuery } from "../lib/useRiderFilters";
import { supabase } from "../lib/supabase";
import { statBg } from "../lib/statBg";
import { useNavigate, Link } from "react-router-dom";
import { getFlagEmoji } from "../lib/countryUtils";
import { getRiderMarketValue } from "../lib/marketValues";
import PotentialeStars from "../components/PotentialeStars";

const STATS = [
  { key: "stat_fl", label: "FL" }, { key: "stat_bj", label: "BJ" },
  { key: "stat_kb", label: "KB" }, { key: "stat_bk", label: "BK" },
  { key: "stat_tt", label: "TT" }, { key: "stat_prl", label: "PRL" },
  { key: "stat_bro", label: "Bro" }, { key: "stat_sp", label: "SP" },
  { key: "stat_acc", label: "ACC" }, { key: "stat_ned", label: "NED" },
  { key: "stat_udh", label: "UDH" }, { key: "stat_mod", label: "MOD" },
  { key: "stat_res", label: "RES" }, { key: "stat_ftr", label: "FTR" },
];

function SortTh({ children, sortKey, sort, sortDir, onSort, className = "" }) {
  const active = sort === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"} ${className}`}>
      {children}{active && <span className="ml-0.5 text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

const MOBILE_STATS = [
  { key: "stat_bj", label: "BJ" }, { key: "stat_sp", label: "SP" },
  { key: "stat_tt", label: "TT" }, { key: "stat_fl", label: "FL" },
  { key: "stat_udh", label: "UDH" },
];

function StatBar({ value }) {
  const pct = Math.round((value / 99) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-full bg-cz-subtle rounded-full h-1.5">
        <div className="bg-cz-3 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className={`inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded flex-shrink-0 ${statBg(value ?? 0)}`}>
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
      className={`text-lg transition-all hover:scale-110 flex-shrink-0 ${isWatched ? "text-cz-accent-t" : "text-cz-3 hover:text-cz-2"}`}>
      {isWatched ? "★" : "☆"}
    </button>
  );
}

function RiderCard({ rider, onClick, watchlist, onToggleWatchlist, isInAuction }) {
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-4 hover:border-cz-border
      cursor-pointer transition-all active:scale-98">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div onClick={() => onClick(rider)} className="flex-1 min-w-0">
          <p className="text-cz-1 font-medium text-sm truncate">
            {rider.nationality_code && <span className="mr-1">{getFlagEmoji(rider.nationality_code)}</span>}
            {rider.firstname} {rider.lastname}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {rider.is_u25 && (
              <span className="text-[9px] uppercase bg-cz-info/20 text-cz-info px-1.5 py-0.5 rounded">U25</span>
            )}
            {isInAuction && (
              <span className="text-[9px] uppercase bg-cz-accent/100/15 text-cz-accent-t px-1.5 py-0.5 rounded">⚡ Auktion</span>
            )}
            <span className="text-cz-3 text-xs">{rider.team?.name || "Fri"}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-cz-accent-t font-mono font-bold text-xs whitespace-nowrap">
            {getRiderMarketValue(rider).toLocaleString("da-DK")} CZ$
          </span>
          <StarButton riderId={rider.id} watchlist={watchlist} onToggle={onToggleWatchlist} />
        </div>
      </div>
      {rider.potentiale != null && (
        <div className="flex items-center gap-1.5 mb-2" onClick={() => onClick(rider)}>
          <span className="text-cz-3 text-[9px] uppercase tracking-wider">Potentiale</span>
          <PotentialeStars value={rider.potentiale} birthdate={rider.birthdate} showValue />
        </div>
      )}
      <div className="grid grid-cols-5 gap-2" onClick={() => onClick(rider)}>
        {MOBILE_STATS.map(({ key, label }) => (
          <div key={key} className="text-center">
            <p className="text-cz-3 text-[9px] uppercase mb-0.5">{label}</p>
            <span className={`inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded ${statBg(rider[key] || 0)}`}>
              {rider[key] || "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiderRow({ rider, onSelect, watchlist, onToggleWatchlist, isInAuction }) {
  return (
    <tr className="border-b border-cz-border hover:bg-cz-subtle cursor-pointer transition-colors">
      <td className="px-3 py-2.5" onClick={() => onSelect(rider)}>
        <div>
          <p className="text-cz-1 text-sm font-medium">
            {rider.nationality_code && <span className="mr-1">{getFlagEmoji(rider.nationality_code)}</span>}
            {rider.firstname} {rider.lastname}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {rider.is_u25 && (
              <span className="text-[9px] uppercase bg-cz-info/20 text-cz-info px-1.5 py-0.5 rounded">U25</span>
            )}
            {isInAuction && (
              <span className="text-[9px] uppercase bg-cz-accent/100/15 text-cz-accent-t px-1.5 py-0.5 rounded">⚡ Auktion</span>
            )}
            <span className="text-cz-3 text-xs">{rider.team?.name || "Fri"}</span>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right" onClick={() => onSelect(rider)}>
        <span className="text-cz-accent-t font-mono text-sm font-bold">
          {getRiderMarketValue(rider).toLocaleString("da-DK")}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right" onClick={() => onSelect(rider)}>
        <span className="text-cz-2 font-mono text-sm">
          {rider.salary ? rider.salary.toLocaleString("da-DK") : "—"}
        </span>
      </td>
      <td className="px-3 py-2.5" onClick={() => onSelect(rider)}>
        <PotentialeStars value={rider.potentiale} birthdate={rider.birthdate} />
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
  const [activeAuctionRiders, setActiveAuctionRiders] = useState(new Set());
  const [userId, setUserId] = useState(null);
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS, page: 1 });
  const [nationalities, setNationalities] = useState([]);

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

  useEffect(() => {
    supabase.from("riders").select("nationality_code").neq("nationality_code", null)
      .then(({ data }) => {
        if (!data) return;
        const codes = [...new Set(data.map(r => r.nationality_code))].sort();
        setNationalities(codes);
      });
  }, []);

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
      .select(`id, firstname, lastname, birthdate, uci_points, salary, market_value, prize_earnings_bonus, is_u25, nationality_code, potentiale,
        ${statKeys}, team:team_id(id, name)`, { count: "exact" })
      .range((filters.page - 1) * 50, filters.page * 50 - 1);

    query = buildSupabaseQuery(query, filters);

    const [{ data, count }, { data: auctionData }] = await Promise.all([
      query,
      supabase.from("auctions").select("rider_id").in("status", ["active", "extended"]),
    ]);
    setRiders(data || []);
    setTotal(count || 0);
    setActiveAuctionRiders(new Set((auctionData || []).map(a => a.rider_id)));
    setLoading(false);
  }

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value, page: 1 }));
  }

  function onReset() {
    setFilters({ ...DEFAULT_FILTERS, page: 1 });
  }

  function handleSort(key) {
    if (filters.sort === key) setFilter("sort_dir", filters.sort_dir === "desc" ? "asc" : "desc");
    else { setFilter("sort", key); setFilter("sort_dir", "desc"); }
  }

  return (
    <div className="max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">Rytterdatabase</h1>
          <p className="text-cz-3 text-sm">{total.toLocaleString("da-DK")} ryttere</p>
        </div>
        <Link to="/watchlist"
          className="w-full sm:w-auto text-center px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
            rounded-lg text-xs font-medium hover:bg-cz-accent/10 transition-all">
          ⭐ Min ønskeliste ({watchlist.size})
        </Link>
      </div>

      <RiderFilters filters={filters} onChange={setFilter} onReset={onReset} showTeamFilter={false} nationalities={nationalities} />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
        </div>
      ) : isMobile ? (
        <div className="flex flex-col gap-3">
          {riders.map(r => (
            <RiderCard key={r.id} rider={r}
              onClick={r => navigate(`/riders/${r.id}`)}
              watchlist={watchlist}
              onToggleWatchlist={toggleWatchlist}
              isInAuction={activeAuctionRiders.has(r.id)} />
          ))}
        </div>
      ) : (
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-20 bg-cz-card shadow-sm">
                <tr className="border-b border-cz-border">
                  <SortTh sortKey="firstname" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider w-48">Rytter</SortTh>
                  <SortTh sortKey="uci_points" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-right font-medium uppercase tracking-wider w-20">Værdi</SortTh>
                  <SortTh sortKey="salary" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-right font-medium uppercase tracking-wider w-20">Løn</SortTh>
                  <SortTh sortKey="potentiale" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider w-24">Potentiale</SortTh>
                  {STATS.map(({ key, label }) => (
                    <SortTh key={key} sortKey={key} sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                      className="px-1.5 py-3 text-center font-medium w-14">{label}</SortTh>
                  ))}
                  <th className="px-3 py-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {riders.map(r => (
                  <RiderRow key={r.id} rider={r}
                    onSelect={r => navigate(`/riders/${r.id}`)}
                    watchlist={watchlist}
                    onToggleWatchlist={toggleWatchlist}
                    isInAuction={activeAuctionRiders.has(r.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
        <span className="text-cz-3 text-xs">
          Viser {Math.min((filters.page - 1) * 50 + 1, total)}–{Math.min(filters.page * 50, total)} af {total.toLocaleString("da-DK")}
        </span>
        <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
          <button disabled={filters.page <= 1}
            onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
            className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
              hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed">
            ← Forrige
          </button>
          <button disabled={filters.page * 50 >= total}
            onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
            className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
              hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed">
            Næste →
          </button>
        </div>
      </div>
    </div>
  );
}
