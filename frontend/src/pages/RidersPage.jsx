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
import { ageBadgeKey, getRiderAge } from "../lib/riderAge";
import { getRiderMarketValue, getRiderSalary } from "../lib/marketValues.js";
import { getCountryCode3 } from "../lib/countryUtils";
import RidersEmptyState from "../components/RidersEmptyState";
import OnboardingTour from "../components/OnboardingTour";
import WatchlistStar from "../components/WatchlistStar";
import { CompareToggle, CompareBar, MAX_COMPARE } from "../components/CompareSelection";
import StatsToggle from "../components/StatsToggle";
import useStatsToggle from "../lib/useStatsToggle";
import { startTour } from "../lib/onboardingTour";
import { formatNumber } from "../lib/intl";
import { cycleSortState } from "../lib/riderSort";
import {
  ExchangeIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  Select,
  Button,
  PageHeader,
  DataTable,
  EmptyState,
  ErrorState,
  SkeletonLines,
  BikeIcon,
} from "../components/ui";
import { WRAP } from "../components/ui/dataTableStyles.js";

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

// #2849 bølge 2: DataTable's indbyggede sortable-header (sortKey/onSort) afløser
// den tidligere delte SortTh-komponent på denne side — samme cyklus-logik
// (cycleSortState), blot trigget af DataTable i stedet for en per-kolonne <th>.

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
        {open ? <ChevronUpIcon size={12} aria-hidden="true" /> : <ChevronDownIcon size={12} aria-hidden="true" />}
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
// skjult (DataTable's `fold`), så Nation/Hold/Status/Type ikke kan sorteres.
// Denne select + retnings-toggle eksponerer NØJAGTIG de samme sort-nøgler som
// desktop-headerne og skriver til samme filters.sort/sort_dir via handleSort —
// ingen ny sort-logik. Synlig kun under sm-breakpointet (`sm:hidden`).
function MobileSortControl({ sort, sortDir, onSort, statCols, t }) {
  // Samme nøgler + rækkefølge som desktop-kolonnerne (RidersPage's `columns`).
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

export default function RidersPage() {
  const { t } = useTranslation("riders");
  const { t: tCommon } = useTranslation("common");
  const { t: tRider } = useTranslation("rider"); // #1592: fulde evne-navne til tooltips + legende
  const { t: tTypes } = useTranslation("riderTypes"); // #2849 bølge 2: mobil-fold-tekst for ryttertype
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [riders, setRiders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
    if (!silent) { setLoading(true); setError(null); }
    // Evnerne hentes via join + flades op på rytter-objektet i fetchRidersPage (#1529).
    const riderSelect = "id, firstname, lastname, birthdate, salary, market_value, prize_earnings_bonus, current_production_value, is_u25, nationality_code, primary_type, secondary_type, team:team_id(id, name), pending_team:pending_team_id(id, name)";
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
      // #2849 bølge 2 (audit-fund): en fejlet HOVED-fetch (ikke-silent) surfaces nu
      // som ErrorState i stedet for en tavst tømt liste. Den stille realtime-refetch
      // (silent=true, se herunder) logger fortsat kun — en transient hikke i den
      // skal ikke erstatte en allerede-vist liste med en fejlflade.
      if (!silent) {
        setRiders([]);
        setTotal(0);
        setError(err);
      }
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
    // #1755: delt cyklus-logik (klik aktiv nøgle = vend retning; ny nøgle =
    // skift + default-retning) så alle rytter-tabeller opfører sig ens.
    const next = cycleSortState({ sort: filters.sort, dir: filters.sort_dir }, key);
    setFilters(f => ({ ...f, sort: next.sort, sort_dir: next.dir, page: 1 }));
  }

  // #2849 bølge 2 — DataTable-kolonner (T2 wide-data-recipe). Sticky navnekolonne
  // + fold-kolonner (Nation/Hold/Status/Alder/Type skjules ≤640px og foldes ind i
  // navnecellens underlinje i stedet for at forsvinde sporløst som før). Compare/
  // watchlist forbliver egne, altid-synlige kolonner (ikke fold — de er aktive
  // kontroller, ikke sekundær tekst). Numerik (alder/værdi/løn/evner) højrestilles
  // tabular via DataTable's numeric-flag.
  const columns = [
    {
      key: "nation",
      header: t("table.nation"),
      sortKey: "nationality_code",
      fold: true,
      foldValue: (r) => getCountryCode3(r.nationality_code) || "—",
      render: (r) => <NationCell code={r.nationality_code} />,
    },
    {
      key: "name",
      header: t("table.rider"),
      sticky: true,
      sortKey: "firstname",
      render: (r) => (
        <RiderNameCell
          id={r.id}
          firstname={r.firstname}
          lastname={r.lastname}
          stopPropagation
          className="text-cz-1 hover:text-cz-accent-t transition-colors"
        />
      ),
    },
    {
      key: "compare",
      header: (
        <span className="flex justify-center" title={t("table.compareTooltip")}>
          <ExchangeIcon size={14} aria-hidden="true" />
        </span>
      ),
      render: (r) => (
        <CompareToggle
          active={compareIds.includes(r.id)}
          disabled={compareIds.length >= MAX_COMPARE}
          onToggle={() => toggleCompare(r.id)}
        />
      ),
    },
    {
      key: "watchlist",
      header: null,
      render: (r) => (
        <WatchlistStar active={watchlist.has(r.id)} onToggle={() => toggleWatchlist(r.id)} />
      ),
    },
    {
      key: "team",
      header: t("table.team"),
      sortKey: "team_id",
      fold: true,
      foldValue: (r) => r.team?.name || t("table.teamFree"),
      render: (r) => (
        <TeamCell
          team={r.team}
          freeLabel={t("table.teamFree")}
          pendingTeam={r.pending_team}
          pendingTitle={r.pending_team ? t("table.pendingTransfer", { team: r.pending_team.name }) : ""}
          stopPropagation
        />
      ),
    },
    // #1537: Status (badges) og ryttertype delt i hver sin kolonne — som
    // holdsiden (#1482), så begge kan sorteres uafhængigt.
    {
      key: "badges",
      header: t("table.badges"),
      sortKey: "is_u25",
      fold: true,
      foldValue: (r) => {
        const keys = [ageBadgeKey(r), activeAuctionRiders.has(r.id) && "auction"].filter(Boolean);
        return keys.map((k) => tRider(`badges.label.${k}`)).join("/");
      },
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <RiderBadges badges={[ageBadgeKey(r), activeAuctionRiders.has(r.id) && "auction"]} />
        </div>
      ),
    },
    // #1674: numerisk alder i egen kolonne (Status-badget viser kun U23/U25-tier).
    {
      key: "age",
      header: t("table.age"),
      sortKey: "birthdate",
      numeric: true,
      fold: true,
      foldValue: (r) => String(getRiderAge(r.birthdate) ?? "—"),
      render: (r) => <span className="text-cz-2 text-xs">{getRiderAge(r.birthdate) ?? "—"}</span>,
    },
    {
      key: "type",
      header: t("table.type"),
      sortKey: "primary_type",
      fold: true,
      foldValue: (r) => {
        if (!r.primary_type) return "";
        const primary = tTypes(`types.${r.primary_type}`);
        const hasSecondary = r.secondary_type && r.secondary_type !== r.primary_type;
        return hasSecondary ? `${primary}/${tTypes(`types.${r.secondary_type}`)}` : primary;
      },
      render: (r) => <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} />,
    },
    // #1537: Potentiale-kolonnen fjernet — potentiale skjules helt i visningen (doctrine #1138).
    {
      key: "value",
      header: t("table.value"),
      sortKey: "value",
      numeric: true,
      render: (r) => <span className="text-cz-accent-t font-bold">{formatNumber(getRiderMarketValue(r))}</span>,
    },
    {
      key: "salary",
      header: t("table.salary"),
      sortKey: "salary",
      numeric: true,
      render: (r) => <span className="text-cz-2">{formatNumber(getRiderSalary(r))}</span>,
    },
    ...visibleStatCols.map(({ key, label }) => ({
      key,
      header: <span title={tRider(`racePreview.derived.${key}`)}>{label}</span>,
      sortKey: key,
      numeric: true,
      render: (r) => <StatBar value={r[key]} />,
    })),
  ];

  return (
    <div className="mx-auto max-w-[1600px]">
      <OnboardingTour pageKey="riders" steps={ridersTourSteps} />
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle", { count: formatNumber(total) })} />

      {/* #2849 bølge 2 — kolonnevalg (StatsToggle) + watchlist-genvej hører ikke til
          PageHeader's action-cluster-kontrakt (maks 1 Select sm + 1 primær Button sm,
          intet andet). Flyttet til en let værktøjslinje under headeren — samme
          mønster som Standings' Compare-knap i filter-bar-rækken (#2849 bølge 1).
          Ingen adfærd ændret, kun placering. */}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <StatsToggle
          visibleStats={visibleStats}
          onToggleStat={toggleStat}
          onShowAll={showAll}
          onHideAll={hideAll}
        />
        <Link to="/watchlist" data-tour="riders-watchlist"
          className="inline-flex items-center justify-center px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
            rounded-cz text-xs font-medium hover:bg-cz-accent/10 transition-all">
          {t("page.watchlistLink", { count: watchlist.size })}
        </Link>
      </div>

      {showEmptyState && myTeam && (
        <RidersEmptyState
          balance={myTeam.balance}
          onFilterByBudget={() => setFilter("max_value", String(myTeam.balance ?? ""))}
          onStartTour={() => startTour("riders")}
        />
      )}

      <div data-tour="riders-filters">
        <RiderFilters filters={filters} onChange={setFilter} onReset={onReset} showTeamFilter={false} nationalities={nationalities} showAiToggle={true} />
      </div>

      {/* #1592: evne-kode-legende — afkoder de 15 kolonne-koder for nye spillere. */}
      <AbilityLegend t={t} tRider={tRider} />

      {loading ? (
        <div className={`${WRAP} p-5`}>
          <SkeletonLines lines={6} />
        </div>
      ) : error ? (
        // #2849 bølge 2 (audit-fund): tidligere tavs fejl-degradering (console.error
        // + tom liste) — en fejlet hoved-fetch viser nu ErrorState med retry.
        <ErrorState
          title={t("loadError")}
          action={<Button size="sm" variant="secondary" onClick={() => loadRiders()}>{t("retry")}</Button>}
        />
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
          <div data-tour="riders-list">
            {riders.length === 0 ? (
              <EmptyState
                icon={<BikeIcon size={26} aria-hidden="true" />}
                title={tCommon("controls.noFilterResults")}
                action={<Button size="sm" onClick={onReset}>{tCommon("controls.clearFilters")}</Button>}
              />
            ) : (
              <DataTable
                label={t("page.title")}
                columns={columns}
                rows={riders}
                rowKey={(r) => r.id}
                rowProps={(r) => ({ onClick: () => navigate(`/riders/${r.id}`), className: "cursor-pointer" })}
                sort={filters.sort}
                sortDir={filters.sort_dir}
                onSort={handleSort}
                count={t("pagination.showing", {
                  from: Math.min((filters.page - 1) * 50 + 1, total),
                  to: Math.min(filters.page * 50, total),
                  total: formatNumber(total),
                })}
              />
            )}
          </div>
        </>
      )}

      {/* Pagination */}
      <div className="flex justify-end mt-4">
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
