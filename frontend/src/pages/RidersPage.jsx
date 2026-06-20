import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import RiderFilters, { DEFAULT_FILTERS } from "../components/RiderFilters";
import { fetchRidersPage } from "../lib/useRiderFilters";
import { ABILITY_STATS as STATS } from "../lib/abilities";
import {
  filtersToSearchParams,
  initialFiltersFromUrlOrSession,
  saveFiltersToSession,
} from "../lib/ridersUrlState";
import { supabase } from "../lib/supabase";
import { statStyle } from "../lib/statColor";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import NationCell from "../components/rider/NationCell";
import RiderNameCell from "../components/rider/RiderNameCell";
import RiderBadges from "../components/rider/RiderBadges";
import RiderTypeBadge from "../components/rider/RiderTypeBadge";
import TeamCell from "../components/rider/TeamCell";
import { ageBadgeKey } from "../lib/riderAge";
import { getRiderMarketValue, getRiderSalary } from "../lib/marketValues.js";
import RidersEmptyState from "../components/RidersEmptyState";
import OnboardingTour from "../components/OnboardingTour";
import WatchlistStar from "../components/WatchlistStar";
import { CompareToggle, CompareBar, MAX_COMPARE } from "../components/CompareSelection";
import StatsToggle from "../components/StatsToggle";
import useStatsToggle from "../lib/useStatsToggle";
import { startTour } from "../lib/onboardingTour";
import { formatNumber } from "../lib/intl";
import { Card, ExchangeIcon, Select, ArrowUpIcon, ArrowDownIcon } from "../components/ui";

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

// Stat-kolonner = de 15 CZ-evner (delt config lib/abilities.js, importeret som STATS).
// #1529: erstattede de 14 PCM stat_*-kolonner — visningen viser nu evner.

function SortTh({ children, sortKey, sort, sortDir, onSort, className = "", title }) {
  const active = sort === sortKey;
  return (
    <th onClick={() => onSort(sortKey)} title={title}
      className={`cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"} ${className}`}>
      {children}{active && <span className="ms-0.5 text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

// #1592: nye spillere kan ikke afkode de 15 evne-koder (CLM/TT/FLT/…) i kolonne-
// overskrifterne, og det blokerer det første rytter-valg. Hver stat-header får en
// `title`-tooltip med det fulde navn, og denne kollapsbare legende giver en altid-
// tilgængelig oversigt over alle koder → fulde navne. Begge genbruger samme kilde
// (rider:racePreview.derived.*), så tooltip og legende aldrig kan drifte fra hinanden.
function AbilityLegend({ t, tRider }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-cz-3 hover:text-cz-2 text-xs transition-colors"
      >
        <span className="font-mono text-[10px] border border-cz-border rounded px-1" aria-hidden="true">?</span>
        {t("abilityLegend.toggle")}
        <span className="text-[9px]" aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <dl className="mt-2 p-3 bg-cz-subtle border border-cz-border rounded-cz max-w-3xl
          grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
          {STATS.map(({ key, label }) => (
            <div key={key} className="flex items-baseline gap-2 text-xs min-w-0">
              <dt className="font-mono text-[10px] text-cz-accent-t/80 w-9 flex-shrink-0">{label}</dt>
              <dd className="text-cz-2 truncate">{tRider(`racePreview.derived.${key}`)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// Mobil-sorterings-kontrol (#9): på mobil er de fleste sortérbare kolonne-headers
// skjult (`hidden sm:table-cell`), så Nation/Hold/Status/Type ikke kan sorteres.
// Denne select + retnings-toggle eksponerer NØJAGTIG de samme sort-nøgler som
// desktop-SortTh'erne og skriver til samme filters.sort/sort_dir via handleSort —
// ingen ny sort-logik. Synlig kun under sm-breakpointet (`sm:hidden`).
function MobileSortControl({ sort, sortDir, onSort, statCols, t }) {
  // Samme nøgler + rækkefølge som desktop-headers (RidersPage tabel-thead).
  // Labels genbruger table.*-nøglerne; stat-options bruger de internationale
  // korte evne-labels (oversættes ikke, jf. #487).
  const baseOptions = [
    { key: "firstname", label: t("table.rider") },
    { key: "nationality_code", label: t("table.nation") },
    { key: "team_id", label: t("table.team") },
    { key: "is_u25", label: t("table.badges") },
    { key: "primary_type", label: t("table.type") },
    { key: "value", label: t("table.value") },
    { key: "salary", label: t("table.salary") },
  ];
  const options = [...baseOptions, ...statCols.map(({ key, label }) => ({ key, label }))];
  const dirAria = sortDir === "desc" ? t("mobileSort.descAria") : t("mobileSort.ascAria");

  return (
    <div className="sm:hidden flex items-end gap-2 mb-3">
      <label className="flex-1 min-w-0">
        <span className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("mobileSort.label")}</span>
        <Select size="sm" value={sort} onChange={e => onSort(e.target.value)} className="w-full">
          {options.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </Select>
      </label>
      <button
        type="button"
        onClick={() => onSort(sort)}
        aria-label={dirAria}
        title={dirAria}
        className="flex-shrink-0 flex items-center justify-center px-3 py-[7px] rounded-cz border border-cz-border
          bg-cz-subtle text-cz-2 hover:text-cz-1 transition-colors"
      >
        {sortDir === "desc"
          ? <ArrowDownIcon size={16} aria-hidden="true" />
          : <ArrowUpIcon size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}

function StatBar({ value }) {
  return (
    <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded" style={statStyle(value ?? 0)}>
      {value ?? "-"}
    </span>
  );
}

function RiderRow({ rider, statCols, onSelect, watchlist, onToggleWatchlist, isInAuction, compareActive, compareDisabled, onToggleCompare, t }) {
  // #1029 affordance: hele rækken er ét klikmål (navigerer til rytter-detalje).
  // Data-cellerne (stjerner, stat-bjælker) er rent display — kun de eksplicitte
  // knapper (Compare/Watchlist) + interne links (navn/hold) stopper propagation.
  return (
    <tr onClick={() => onSelect(rider)}
      className={`border-b border-cz-border hover:bg-cz-subtle cursor-pointer transition-colors ${compareActive ? "bg-cz-accent/[0.04]" : ""}`}>
      <td className="px-2 py-2.5 w-12 hidden sm:table-cell">
        <NationCell code={rider.nationality_code} />
      </td>
      <td className="px-3 py-2.5 sticky-name-cell sticky left-0 z-10 border-r border-cz-border shadow-[10px_0_16px_-16px_rgba(0,0,0,0.5)]">
        <RiderNameCell id={rider.id} firstname={rider.firstname} lastname={rider.lastname} stopPropagation />
      </td>
      <td className="px-1 py-2.5 w-8">
        <CompareToggle active={compareActive} disabled={compareDisabled} onToggle={() => onToggleCompare(rider.id)} />
      </td>
      <td className="px-2 py-2.5 w-8">
        <WatchlistStar active={watchlist.has(rider.id)} onToggle={() => onToggleWatchlist(rider.id)} />
      </td>
      <td className="px-3 py-2.5 hidden sm:table-cell">
        {/* #950: parkeret handel → vis kommende hold som "på vej til holdskifte"-chip */}
        <TeamCell team={rider.team} freeLabel={t("table.teamFree")}
          pendingTeam={rider.pending_team}
          pendingTitle={rider.pending_team ? t("table.pendingTransfer", { team: rider.pending_team.name }) : ""}
          stopPropagation />
      </td>
      {/* #1537: Status (badges) og ryttertype delt i hver sin kolonne — som
          holdsiden (#1482), så begge kan sorteres uafhængigt. */}
      <td className="px-3 py-2.5 hidden sm:table-cell">
        <div className="flex flex-wrap items-center gap-1">
          <RiderBadges badges={[ageBadgeKey(rider), isInAuction && "auction"]} />
        </div>
      </td>
      <td className="px-3 py-2.5 hidden sm:table-cell">
        <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} />
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-cz-accent-t font-mono text-sm font-bold">
          {formatNumber(getRiderMarketValue(rider))}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-cz-2 font-mono text-sm">
          {formatNumber(getRiderSalary(rider))}
        </span>
      </td>
      {statCols.map(({ key }) => (
        <td key={key} className="px-1.5 py-2.5 w-14">
          <StatBar value={rider[key]} />
        </td>
      ))}
    </tr>
  );
}

export default function RidersPage() {
  const { t } = useTranslation("riders");
  const { t: tCommon } = useTranslation("common");
  const { t: tRider } = useTranslation("rider"); // #1592: fulde evne-navne til tooltips + legende
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

  // #1006: skjul/vis stats-kolonner — samme mønster som auktionssiden, men
  // "omvendt" default: alle stats er synlige, og man klikker dem FRA.
  const { visibleStats, toggleStat, showAll, hideAll } = useStatsToggle({
    storageKey: "cz-riders-visible-stats",
    defaultVisible: STATS.map(s => s.key),
  });
  const visibleStatCols = STATS.filter(s => visibleStats.has(s.key));

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

  async function loadRiders({ silent = false } = {}) {
    if (!silent) setLoading(true);
    // Evnerne hentes via join + flades op på rytter-objektet i fetchRidersPage (#1529).
    const riderSelect = "id, firstname, lastname, birthdate, salary, market_value, prize_earnings_bonus, is_u25, nationality_code, primary_type, secondary_type, team:team_id(id, name), pending_team:pending_team_id(id, name)";
    try {
      const [{ rows, count }, { data: auctionData }] = await Promise.all([
        fetchRidersPage(supabase, { filters, page: filters.page, pageSize: 50, riderSelect }),
        supabase.from("auctions").select("rider_id").in("status", ["active", "extended"]),
      ]);
      setRiders(rows);
      setTotal(count);
      setActiveAuctionRiders(new Set((auctionData || []).map(a => a.rider_id)));
    } catch (err) {
      console.error("loadRiders failed:", err.message);
      setRiders([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRiders(); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // #916: realtime — opdatér listen når en rytter ændres (fx solgt til AI-hold →
  // team_id skifter), så TeamCell ikke bliver ved at vise "Fri" på stale data.
  // Stille refetch (ingen spinner), debounced fordi auktions-finalisering kan
  // opdatere mange ryttere i én burst. Ref undgår stale filters-closure.
  const loadRidersRef = useRef(loadRiders);
  useEffect(() => { loadRidersRef.current = loadRiders; });
  useEffect(() => {
    let timer;
    const channel = supabase.channel("riders-page-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "riders" }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => loadRidersRef.current?.({ silent: true }), 400);
      })
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, []);

  // #8 — sync filters → URL + sessionStorage så de persisterer på tværs af
  // navigation (klik på rytter → tilbage).
  useEffect(() => {
    const params = filtersToSearchParams(filters, FILTER_DEFAULTS);
    setSearchParams(params, { replace: true });
    saveFiltersToSession(filters);
  }, [filters, setSearchParams]);

  // #229: scroll til toppen ved side-skift, så en ny side ikke starter i bunden
  // (window er scroll-containeren — <main> i Layout er ikke en overflow-scroll-boks).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [filters.page]);

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
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <StatsToggle
            visibleStats={visibleStats}
            onToggleStat={toggleStat}
            onShowAll={showAll}
            onHideAll={hideAll}
          />
          <Link to="/watchlist" data-tour="riders-watchlist"
            className="flex-1 sm:flex-none text-center px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
              rounded-cz text-xs font-medium hover:bg-cz-accent/10 transition-all">
            {t("page.watchlistLink", { count: watchlist.size })}
          </Link>
        </div>
      </div>

      {showEmptyState && myTeam && (
        <RidersEmptyState
          balance={myTeam.balance}
          onFilterByBudget={() => setFilter("max_value", String(myTeam.balance ?? ""))}
          onStartTour={() => startTour("riders")}
        />
      )}

      <div data-tour="riders-filters" className="max-w-[1600px]">
        <RiderFilters filters={filters} onChange={setFilter} onReset={onReset} showTeamFilter={false} nationalities={nationalities} />
      </div>

      {/* #1592: evne-kode-legende — afkoder de 15 kolonne-koder for nye spillere. */}
      <AbilityLegend t={t} tRider={tRider} />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* #9: mobil-sortering — desktop sorterer via kolonne-headers, men de
              fleste er skjult på mobil. Denne kontrol eksponerer samme sort-nøgler. */}
          <MobileSortControl
            sort={filters.sort}
            sortDir={filters.sort_dir}
            onSort={handleSort}
            statCols={visibleStatCols}
            t={t}
          />
        <Card data-tour="riders-list" className="overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-20 bg-cz-card shadow-sm">
                <tr className="border-b border-cz-border">
                  <SortTh sortKey="nationality_code" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-2 py-3 text-left font-medium uppercase tracking-wider w-12 hidden sm:table-cell">{t("table.nation")}</SortTh>
                  <SortTh sortKey="firstname" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider w-40 sticky left-0 z-30 bg-cz-card border-r border-cz-border">{t("table.rider")}</SortTh>
                  <th className="px-1 py-3 w-8 text-cz-3" title={t("table.compareTooltip")}>
                    <ExchangeIcon size={14} className="mx-auto" aria-hidden="true" />
                  </th>
                  <th className="px-2 py-3 w-8" />
                  {/* #1537: Hold sortérbar (grupperer ryttere pr. hold; fri agenter
                      i den ene ende) — var en død header før. */}
                  <SortTh sortKey="team_id" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider hidden sm:table-cell">{t("table.team")}</SortTh>
                  {/* #1537: Status sortérbar på alders-tier (U25-talenter samles) +
                      ryttertype som egen sortérbar kolonne (delt fra Status). */}
                  <SortTh sortKey="is_u25" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider hidden sm:table-cell">{t("table.badges")}</SortTh>
                  <SortTh sortKey="primary_type" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider hidden sm:table-cell">{t("table.type")}</SortTh>
                  <SortTh sortKey="value" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-right font-medium uppercase tracking-wider w-20">{t("table.value")}</SortTh>
                  <SortTh sortKey="salary" sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                    className="px-3 py-3 text-right font-medium uppercase tracking-wider w-20">{t("table.salary")}</SortTh>
                  {/* #1537: Potentiale-kolonnen fjernet — potentiale skjules helt i
                      visningen (doctrine #1138). */}
                  {visibleStatCols.map(({ key, label }) => (
                    <SortTh key={key} sortKey={key} sort={filters.sort} sortDir={filters.sort_dir} onSort={handleSort}
                      title={tRider(`racePreview.derived.${key}`)}
                      className="px-1.5 py-3 text-center font-medium w-14">{label}</SortTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riders.length === 0 ? (
                  <tr>
                    <td colSpan={9 + visibleStatCols.length} className="px-3 py-12 text-center">
                      <p className="text-cz-3 text-sm">{tCommon("controls.noFilterResults")}</p>
                      <button onClick={onReset}
                        className="mt-3 px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
                          rounded-cz text-xs font-medium hover:bg-cz-accent/10 transition-all">
                        {tCommon("controls.clearFilters")}
                      </button>
                    </td>
                  </tr>
                ) : riders.map(r => (
                  <RiderRow key={r.id} rider={r}
                    statCols={visibleStatCols}
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
        </Card>
        </>
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
            className="px-3 py-1.5 bg-cz-subtle rounded-cz text-cz-2 text-xs
              hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed">
            {t("pagination.prev")}
          </button>
          <button disabled={filters.page * 50 >= total}
            onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
            className="px-3 py-1.5 bg-cz-subtle rounded-cz text-cz-2 text-xs
              hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed">
            {t("pagination.next")}
          </button>
        </div>
      </div>

      <CompareBar ids={compareIds} onClear={() => setCompareIds([])} />
    </div>
  );
}
