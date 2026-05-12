import { useState, useEffect } from "react";
import RiderFilters, { DEFAULT_FILTERS } from "../components/RiderFilters";
import { buildSupabaseQuery } from "../lib/useRiderFilters";
import { supabase } from "../lib/supabase";
import { statBg } from "../lib/statBg";
import { useNavigate, Link } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import { Flag } from "../components/Flag";
import { getRiderMarketValue } from "../lib/marketValues";
import PotentialeStars from "../components/PotentialeStars";
import RidersEmptyState from "../components/RidersEmptyState";
import OnboardingTour from "../components/OnboardingTour";
import WatchlistStar from "../components/WatchlistStar";
import { CompareToggle, CompareBar, MAX_COMPARE } from "../components/CompareSelection";
import { startTour } from "../lib/onboardingTour";

const API = import.meta.env.VITE_API_URL;

// Onboarding v2 Slice 1b — tour-trin på /riders (aktiveres fra Dashboard "Vis mig hvordan").
const RIDERS_TOUR_STEPS = [
  {
    target: "[data-tour='riders-filters']",
    title: "Filtrér listen til dit budget",
    body: "Sæt 'Værdi max' til din balance for kun at se ryttere du har råd til. U25/Fri agent-knapperne åbner billigere veje.",
  },
  {
    target: "[data-tour='riders-list']",
    title: "Klik på en rytter",
    body: "Detaljesiden viser fulde stats, kontraktstatus og købs-/auktionsmuligheder. Du kan starte en auktion eller sende et tilbud derfra.",
  },
  {
    target: "[data-tour='riders-watchlist']",
    title: "Brug ønskelisten",
    body: "Stjernen tilføjer rytteren til din ønskeliste, så du nemt kan vende tilbage. Listen findes også i menuen under Marked → Ønskeliste.",
  },
];

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

function RiderRow({ rider, onSelect, watchlist, onToggleWatchlist, isInAuction, compareActive, compareDisabled, onToggleCompare }) {
  return (
    <tr className={`border-b border-cz-border hover:bg-cz-subtle cursor-pointer transition-colors ${compareActive ? "bg-cz-accent/[0.04]" : ""}`}>
      <td className="px-3 py-2.5" onClick={() => onSelect(rider)}>
        <div>
          <RiderLink id={rider.id} stopPropagation
            className="text-cz-1 text-sm font-medium hover:text-cz-accent-t transition-colors block">
            {rider.nationality_code && <Flag code={rider.nationality_code} className="mr-1" />}
            {rider.firstname} {rider.lastname}
          </RiderLink>
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
      <td className="px-1 py-2.5 w-8">
        <CompareToggle active={compareActive} disabled={compareDisabled} onToggle={() => onToggleCompare(rider.id)} />
      </td>
      <td className="px-2 py-2.5 w-8">
        <WatchlistStar active={watchlist.has(rider.id)} onToggle={() => onToggleWatchlist(rider.id)} />
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
    </tr>
  );
}

export default function RidersPage() {
  const navigate = useNavigate();
  const [riders, setRiders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState(new Set());
  const [activeAuctionRiders, setActiveAuctionRiders] = useState(new Set());
  const [userId, setUserId] = useState(null);
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS, page: 1 });
  const [nationalities, setNationalities] = useState([]);
  const [myTeam, setMyTeam] = useState(null);
  const [showEmptyState, setShowEmptyState] = useState(false);
  const [compareIds, setCompareIds] = useState([]);

  function toggleCompare(riderId) {
    setCompareIds(prev => {
      if (prev.includes(riderId)) return prev.filter(id => id !== riderId);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, riderId];
    });
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      supabase.from("rider_watchlist").select("rider_id").eq("user_id", user.id)
        .then(({ data }) => setWatchlist(new Set((data || []).map(w => w.rider_id))));
    });
  }, []);

  // Onboarding v2 Slice 1b — load own team + first_rider_owned-status for empty-state
  useEffect(() => {
    async function loadOnboardingContext() {
      const [{ data: { user } }, { data: { session } }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
      ]);
      if (!user) return;
      const { data: team } = await supabase.from("teams")
        .select("id, balance, division")
        .eq("user_id", user.id).single();
      if (team) setMyTeam(team);
      const token = session?.access_token;
      if (!token) return;
      try {
        const res = await fetch(`${API}/api/me/onboarding-progress`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const prog = await res.json();
        const firstRider = prog.steps?.find(s => s.key === "first_rider_owned");
        setShowEmptyState(firstRider ? !firstRider.done : false);
      } catch {
        // best-effort — empty-state forbliver skjult ved fejl
      }
    }
    loadOnboardingContext();
  }, []);

  useEffect(() => {
    supabase.from("riders").select("nationality_code").eq("is_retired", false).neq("nationality_code", null)
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

  useEffect(() => { loadRiders(); }, [filters]);

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
      <OnboardingTour pageKey="riders" steps={RIDERS_TOUR_STEPS} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">Rytterdatabase</h1>
          <p className="text-cz-3 text-sm">{total.toLocaleString("da-DK")} ryttere</p>
        </div>
        <Link to="/watchlist" data-tour="riders-watchlist"
          className="w-full sm:w-auto text-center px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
            rounded-lg text-xs font-medium hover:bg-cz-accent/10 transition-all">
          ⭐ Min ønskeliste ({watchlist.size})
        </Link>
      </div>

      {showEmptyState && myTeam && (
        <RidersEmptyState
          balance={myTeam.balance}
          division={myTeam.division}
          onFilterByBudget={() => setFilter("max_uci", String(myTeam.balance ?? ""))}
          onStartTour={() => startTour("riders")}
        />
      )}

      <div data-tour="riders-filters">
        <RiderFilters filters={filters} onChange={setFilter} onReset={onReset} showTeamFilter={false} nationalities={nationalities} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
        </div>
      ) : (
        <div data-tour="riders-list" className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-20 bg-cz-card shadow-sm">
                <tr className="border-b border-cz-border">
                  <SortTh sortKey="firstname" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider w-48">Rytter</SortTh>
                  <th className="px-1 py-3 w-8" title="Vælg til sammenligning">⇄</th>
                  <th className="px-2 py-3 w-8" />
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
                </tr>
              </thead>
              <tbody>
                {riders.map(r => (
                  <RiderRow key={r.id} rider={r}
                    onSelect={r => navigate(`/riders/${r.id}`)}
                    watchlist={watchlist}
                    onToggleWatchlist={toggleWatchlist}
                    isInAuction={activeAuctionRiders.has(r.id)}
                    compareActive={compareIds.includes(r.id)}
                    compareDisabled={compareIds.length >= MAX_COMPARE}
                    onToggleCompare={toggleCompare} />
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

      <CompareBar ids={compareIds} onClear={() => setCompareIds([])} />
    </div>
  );
}
