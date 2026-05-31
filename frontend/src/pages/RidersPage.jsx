import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import RiderFilters, { DEFAULT_FILTERS } from "../components/RiderFilters";
import { buildSupabaseQuery } from "../lib/useRiderFilters";
import {
  filtersToSearchParams,
  initialFiltersFromUrlOrSession,
  saveFiltersToSession,
} from "../lib/ridersUrlState";
import { supabase } from "../lib/supabase";
import { statColor, statStyle } from "../lib/statColor";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import NationCell from "../components/rider/NationCell";
import RiderNameCell from "../components/rider/RiderNameCell";
import RiderBadges from "../components/rider/RiderBadges";
import TeamCell from "../components/rider/TeamCell";
import { ageBadgeKey } from "../lib/riderAge";
import { getRiderMarketValue } from "../lib/marketValues";
import PotentialeStars from "../components/PotentialeStars";
import RidersEmptyState from "../components/RidersEmptyState";
import OnboardingTour from "../components/OnboardingTour";
import WatchlistStar from "../components/WatchlistStar";
import { CompareToggle, CompareBar, MAX_COMPARE } from "../components/CompareSelection";
import { startTour } from "../lib/onboardingTour";
import { formatNumber } from "../lib/intl";

const API = import.meta.env.VITE_API_URL;

// #8 — filtre persisteres i URL (primær) + sessionStorage (fallback) så de
// overlever navigation til rytter-detalje og tilbage.
const FILTER_DEFAULTS = { ...DEFAULT_FILTERS, page: 1 };

// Onboarding v2 Slice 1b — tour-trin på /riders (aktiveres fra Dashboard "Vis mig hvordan").
// Bygges fra t() ved render-tid, så sproget følger den aktive locale (Refs #487).
function buildRidersTourSteps(t) {
  return [
    {
      target: "[data-tour='riders-filters']",
      title: t("tour.filters.title"),
      body: t("tour.filters.body"),
    },
    {
      target: "[data-tour='riders-list']",
      title: t("tour.list.title"),
      body: t("tour.list.body"),
    },
    {
      target: "[data-tour='riders-watchlist']",
      title: t("tour.watchlist.title"),
      body: t("tour.watchlist.body"),
    },
  ];
}

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
      {children}{active && <span className="ms-0.5 text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

function StatBar({ value }) {
  const pct = Math.round((value / 99) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-full bg-cz-subtle rounded-full h-1.5">
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: statColor(value ?? 0) }} />
      </div>
      <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded flex-shrink-0" style={statStyle(value ?? 0)}>
        {value ?? "-"}
      </span>
    </div>
  );
}

function RiderRow({ rider, onSelect, watchlist, onToggleWatchlist, isInAuction, compareActive, compareDisabled, onToggleCompare, t }) {
  return (
    <tr className={`border-b border-cz-border hover:bg-cz-subtle cursor-pointer transition-colors ${compareActive ? "bg-cz-accent/[0.04]" : ""}`}>
      <td className="px-2 py-2.5 w-12 hidden sm:table-cell" onClick={() => onSelect(rider)}>
        <NationCell code={rider.nationality_code} />
      </td>
      <td className="px-3 py-2.5 sticky-name-cell sticky left-0 z-10 border-r border-cz-border shadow-[10px_0_16px_-16px_rgba(0,0,0,0.5)]" onClick={() => onSelect(rider)}>
        <RiderNameCell id={rider.id} firstname={rider.firstname} lastname={rider.lastname} stopPropagation />
      </td>
      <td className="px-1 py-2.5 w-8">
        <CompareToggle active={compareActive} disabled={compareDisabled} onToggle={() => onToggleCompare(rider.id)} />
      </td>
      <td className="px-2 py-2.5 w-8">
        <WatchlistStar active={watchlist.has(rider.id)} onToggle={() => onToggleWatchlist(rider.id)} />
      </td>
      <td className="px-3 py-2.5 hidden sm:table-cell" onClick={() => onSelect(rider)}>
        <TeamCell team={rider.team} freeLabel={t("table.teamFree")} stopPropagation />
      </td>
      <td className="px-3 py-2.5 hidden sm:table-cell" onClick={() => onSelect(rider)}>
        <div className="flex flex-wrap items-center gap-1">
          <RiderBadges badges={[ageBadgeKey(rider), isInAuction && "auction"]} />
        </div>
      </td>
      <td className="px-3 py-2.5 text-right" onClick={() => onSelect(rider)}>
        <span className="text-cz-accent-t font-mono text-sm font-bold">
          {formatNumber(getRiderMarketValue(rider))}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right" onClick={() => onSelect(rider)}>
        <span className="text-cz-2 font-mono text-sm">
          {rider.salary ? formatNumber(rider.salary) : "-"}
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
  const { t } = useTranslation("riders");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [riders, setRiders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState(new Set());
  const [activeAuctionRiders, setActiveAuctionRiders] = useState(new Set());
  const [userId, setUserId] = useState(null);
  const [filters, setFilters] = useState(() =>
    initialFiltersFromUrlOrSession(searchParams, FILTER_DEFAULTS),
  );
  const [nationalities, setNationalities] = useState([]);
  const [myTeam, setMyTeam] = useState(null);
  const [showEmptyState, setShowEmptyState] = useState(false);
  const [compareIds, setCompareIds] = useState([]);

  const ridersTourSteps = buildRidersTourSteps(t);

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

  // #8 — sync filters → URL + sessionStorage så de persisterer på tværs af
  // navigation (klik på rytter → tilbage).
  useEffect(() => {
    const params = filtersToSearchParams(filters, FILTER_DEFAULTS);
    setSearchParams(params, { replace: true });
    saveFiltersToSession(filters);
  }, [filters, setSearchParams]);

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value, page: 1 }));
  }

  function onReset() {
    setFilters({ ...FILTER_DEFAULTS });
  }

  function handleSort(key) {
    if (filters.sort === key) setFilter("sort_dir", filters.sort_dir === "desc" ? "asc" : "desc");
    else { setFilter("sort", key); setFilter("sort_dir", "desc"); }
  }

  return (
    <div className="max-w-full">
      <OnboardingTour pageKey="riders" steps={ridersTourSteps} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
          <p className="text-cz-3 text-sm">{t("page.subtitle", { count: formatNumber(total) })}</p>
        </div>
        <Link to="/watchlist" data-tour="riders-watchlist"
          className="w-full sm:w-auto text-center px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
            rounded-lg text-xs font-medium hover:bg-cz-accent/10 transition-all">
          {t("page.watchlistLink", { count: watchlist.size })}
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
                  <SortTh sortKey="nationality_code" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-2 py-3 text-left font-medium uppercase tracking-wider w-12 hidden sm:table-cell">{t("table.nation")}</SortTh>
                  <SortTh sortKey="firstname" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider w-40 sticky left-0 z-30 bg-cz-card border-r border-cz-border">{t("table.rider")}</SortTh>
                  <th className="px-1 py-3 w-8" title={t("table.compareTooltip")}>⇄</th>
                  <th className="px-2 py-3 w-8" />
                  <th className="px-3 py-3 text-left font-medium uppercase tracking-wider hidden sm:table-cell">{t("table.team")}</th>
                  <th className="px-3 py-3 text-left font-medium uppercase tracking-wider hidden sm:table-cell">{t("table.badges")}</th>
                  <SortTh sortKey="uci_points" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-right font-medium uppercase tracking-wider w-20">{t("table.value")}</SortTh>
                  <SortTh sortKey="salary" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-right font-medium uppercase tracking-wider w-20">{t("table.salary")}</SortTh>
                  <SortTh sortKey="potentiale" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider w-24">{t("table.potential")}</SortTh>
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
                    onToggleCompare={toggleCompare}
                    t={t} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
        <span className="text-cz-3 text-xs">
          {t("pagination.showing", {
            from: Math.min((filters.page - 1) * 50 + 1, total),
            to: Math.min(filters.page * 50, total),
            total: formatNumber(total),
          })}
        </span>
        <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
          <button disabled={filters.page <= 1}
            onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
            className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
              hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed">
            {t("pagination.prev")}
          </button>
          <button disabled={filters.page * 50 >= total}
            onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
            className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
              hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed">
            {t("pagination.next")}
          </button>
        </div>
      </div>

      <CompareBar ids={compareIds} onClear={() => setCompareIds([])} />
    </div>
  );
}
