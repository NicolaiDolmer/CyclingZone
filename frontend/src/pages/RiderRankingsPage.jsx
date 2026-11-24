import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import TeamLink from "../components/TeamLink";
import { Flag } from "../components/Flag";
import Tooltip from "../components/ui/Tooltip.jsx";
import RiderNameCell from "../components/rider/RiderNameCell";
import RiderBadges from "../components/rider/RiderBadges";
import { ageBadgeKey } from "../lib/riderAge";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import { formatNumber } from "../lib/intl";
import { riderNameMatches } from "../lib/riderNameSearch";
import { compareNationality, getCountryCode3, getCountryName } from "../lib/countryUtils";
import { useRiderRankings } from "../hooks/useRiderRankings";
import UpdatedAtLine from "../components/rankings/UpdatedAtLine.tsx"; // #7664
import { filterByDivisionPool, ALL_POOLS_VALUE } from "../lib/resultsFilter";
import { resolveDivisionSelectionFromParams, ALL_DIVISIONS_VALUE } from "../lib/riderRankingDivisionLink";
import { RULES_NUMBERS } from "../lib/rulesNumbers";
import { withActiveSeniorPools } from "../lib/seniorScope.ts";
import { useIsMobileViewport } from "../hooks/useMediaQuery.ts";
import {
  Select,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  SkeletonLines,
  SearchIcon,
  CalendarIcon,
} from "../components/ui";
import { WRAP } from "../components/ui/dataTableStyles.js";

// #3507 — division-vælgerens faste tier-liste (1..4), samme kilde/mønster som
// ResultaterPage's ALL_DIVISIONS (#3197), så begge flader viser identiske tiers.
const ALL_DIVISIONS = Array.from(
  { length: RULES_NUMBERS.maxDivision - RULES_NUMBERS.minDivision + 1 },
  (_, i) => RULES_NUMBERS.minDivision + i,
);

// Altid-synlige sejr-kolonner (kategori-sejre) — venstre→højre.
const WIN_COLS = [
  { key: "stage_wins",   labelKey: "rankings.colStageWins" },
  { key: "gc_wins",      labelKey: "rankings.colGcWins" },
  { key: "classic_wins", labelKey: "rankings.colClassicWins" },
  { key: "pts_wins",     labelKey: "rankings.colPtsWins" },
  { key: "mtn_wins",     labelKey: "rankings.colMtnWins" },
  { key: "young_wins",   labelKey: "rankings.colYoungWins" },
];

// Valgfri kolonner styret af kolonne-toggle. default: top3/top10 synlige, trøjedage skjult.
const OPTIONAL_COLS = [
  { key: "top3",        labelKey: "rankings.colTop3",        defaultVisible: true },
  { key: "top10",       labelKey: "rankings.colTop10",       defaultVisible: true },
  { key: "yellow_days", labelKey: "rankings.colYellowDays",  defaultVisible: false },
  { key: "green_days",  labelKey: "rankings.colGreenDays",   defaultVisible: false },
  { key: "polka_days",  labelKey: "rankings.colPolkaDays",   defaultVisible: false },
  { key: "white_days",  labelKey: "rankings.colWhiteDays",   defaultVisible: false },
];

const WIN_VIEW_KEYS = ["gc_wins", "classic_wins", "total_wins"];
const WIN_SORT_DEFAULT = { key: "total_wins", ascending: false };

const COLUMNS_STORAGE_KEY = "cz.riderRankings.columns";

function defaultColumnVisibility() {
  const out = {};
  OPTIONAL_COLS.forEach(c => { out[c.key] = c.defaultVisible; });
  return out;
}

function loadColumnVisibility() {
  const defaults = defaultColumnVisibility();
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    // Merge: kun kendte nøgler, ellers fallback til default (forward-compat ved nye kolonner).
    OPTIONAL_COLS.forEach(c => {
      if (typeof parsed[c.key] === "boolean") defaults[c.key] = parsed[c.key];
    });
    return defaults;
  } catch {
    return defaults;
  }
}

const OWNER_FILTERS = [
  { key: "all",     labelKey: "rankings.ownerAll" },
  { key: "manager", labelKey: "rankings.ownerManager" },
  { key: "ai",      labelKey: "rankings.ownerAi" },
  { key: "free",    labelKey: "rankings.ownerFree" },
];

function rankingColumnLabels(label) {
  return {
    header: label,
    mobileHeader: <span className="hyphens-auto wrap-anywhere">{label}</span>,
    mobileLabel: label,
  };
}

// Kategori-/valgfri-tal-celle: mørk når 0, fremhævet gold når kolonnen er aktiv sort.
// Selve <td>-alignment/tabular-nums kommer fra DataTable's tdClass (numeric: true).
function StatCell({ value, active }) {
  return (
    <span className={active ? "font-bold text-cz-accent-t" : value > 0 ? "text-cz-2" : "text-cz-3"}>
      {value || 0}
    </span>
  );
}

function RankingCountryFlag({ code }) {
  const { i18n } = useTranslation();
  if (!getCountryCode3(code)) return null;
  const country = getCountryName(code, i18n.language);
  return (
    <span className="inline-flex align-middle" onClick={(event) => event.stopPropagation()}>
      <Tooltip label={country} labelTrigger dismissOnEscape id={undefined}>
        <button
          type="button"
          onClick={(event) => event.currentTarget.focus()}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-cz text-sm focus-visible:outline-2 focus-visible:outline-cz-accent [@media(min-width:641px)_and_(pointer:fine)]:min-h-6 [@media(min-width:641px)_and_(pointer:fine)]:min-w-6"
        >
          <span aria-hidden="true"><Flag code={code} title="" /></span>
        </button>
      </Tooltip>
    </span>
  );
}

function rankingCountry(rider) {
  return getCountryCode3(rider.nationality_code) ? <RankingCountryFlag code={rider.nationality_code} /> : null;
}

export default function RiderRankingsPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobileViewport();
  const { t } = useTranslation("riders");
  const [searchParams, setSearchParams] = useSearchParams();
  // #2175: rangliste-data (sæson + færdig-aggregerede rytter-stats) kommer fra
  // useRiderRankings — ÉN let query mod rider_rankings_mv + display-join i stedet
  // for den gamle client-agg over ~38k race_results. error → fejl-UI, ikke spinner.
  const { riders, season, isStale, loading, error, reload, updatedAt } = useRiderRankings();
  // #3071 → #4225: alderen må IKKE længere udledes af ranglistens sæson. De to
  // faldt sammen så længe ranglisten altid viste den aktive sæson, men #4225 lader
  // den vise sidste AFSLUTTEDE sæson i mellemrummet mellem to sæsoner. Gjorde vi
  // stadig `seasonReferenceYear(season.number)`, ville en rytter stå som 29 her og
  // 30 på Mit Hold samtidig — præcis den divergens #3071 blev åbnet for at lukke.
  // Alderen kommer derfor fra den delte kilde, ligesom alle andre flader.
  const seasonYear = useActiveSeasonYear();
  const [view, setView] = useState("overview");
  const [overviewSort, setOverviewSort] = useState({ key: "points", ascending: false });
  const [winSort, setWinSort] = useState(WIN_SORT_DEFAULT);
  const showWins = view === "wins";
  const { key: sortKey, ascending: sortAsc } = showWins ? winSort : overviewSort;
  const [ownerFilter, setOwnerFilter] = useState("all");
  // #1004: filter på ét konkret hold ("all" = alle hold).
  const [teamFilter, setTeamFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [colVisible, setColVisible] = useState(loadColumnVisibility);
  // #3507 — league_divisions (referencedata: pulje-id → tier/pool_index/label),
  // hentet én gang. Bruges KUN til at slå rytterens team.league_division_id op
  // mod division/pulje-URL-param'ene (resolveDivisionSelectionFromParams) —
  // fanens EGEN default forbliver "alle divisioner" uden param'ene.
  /** @typedef {Pick<import("../types/database.types.ts").Database["public"]["Tables"]["league_divisions"]["Row"], "id" | "tier" | "pool_index" | "label">} RankingDivision */
  const [divisions, setDivisions] = useState(/** @type {RankingDivision[]} */ ([]));
  // #2795 — brugerens eget hold, til --me-ring-markeringen nedenfor. Samme
  // mønster som StandingsPage/RaceDetailPage: uafhængig af rangliste-data,
  // så et fejlende/langsomt team-opslag aldrig blokerer selve ranglisten.
  const [myTeamId, setMyTeamId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // #5648 (Y2): kun senior + ikke-pensionerede puljer (spec-s4-struktur risiko 3).
    withActiveSeniorPools((scope) =>
      scope(supabase.from("league_divisions").select("id, tier, pool_index, label")).order("tier").order("pool_index"))
      .then(({ data }) => { if (!cancelled) setDivisions(data || []); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).maybeSingle();
      if (!cancelled) setMyTeamId(myTeam?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, []);

  const divisionsById = useMemo(() => new Map(divisions.map(d => [d.id, d])), [divisions]);

  // #3507 — dashboardets "Fuld rangliste →"-link bærer spillerens division
  // (+pulje) som ?division=&pool= (riderRankingDivisionLink.js). Fraværende/
  // "all" param = ingen filtrering (uændret status quo for direkte besøg).
  const divisionParamRaw = searchParams.get("division");
  const poolParamRaw = searchParams.get("pool");
  const selection = resolveDivisionSelectionFromParams(divisionParamRaw, poolParamRaw);
  const tierPools = divisions
    .filter(d => d.tier === selection.tier)
    .sort((a, b) => a.pool_index - b.pool_index);
  const hasPoolSubtabs = selection.tier != null && tierPools.length > 1;

  // Division-vælger: skifter division nulstiller ALTID pulje-valget (samme
  // mønster som ResultaterPage/StandingsPage's divTab→poolTab-reset, #3197).
  function changeDivision(value) {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (value === ALL_DIVISIONS_VALUE) params.delete("division");
      else params.set("division", value);
      params.delete("pool");
      return params;
    }, { replace: true });
  }

  function changePool(value) {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (value === ALL_POOLS_VALUE) params.delete("pool");
      else params.set("pool", value);
      return params;
    }, { replace: true });
  }

  function handleSort(key) {
    const setSort = showWins ? setWinSort : setOverviewSort;
    setSort(current => ({ key, ascending: current.key === key && !current.ascending }));
  }

  function changeView(value) {
    if (value === "wins") setWinSort(WIN_SORT_DEFAULT);
    setView(value);
  }

  function toggleColumn(key) {
    setColVisible(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function clearFilters() {
    setOwnerFilter("all");
    setTeamFilter("all");
    setSearch("");
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.delete("division");
      params.delete("pool");
      return params;
    }, { replace: true });
  }

  // #3507 — division/pulje-filteret anvendes FØRST (samme model som
  // ResultaterPage/#3197): fravaerende param = alle rytter-hold matcher
  // (poolMatchesSelection tier=null), så resten af filtrene/hold-vælgeren
  // arbejder på det allerede division-scopede felt.
  const divisionFiltered = filterByDivisionPool(riders, r => r.team?.league_division_id, selection, divisionsById);

  // #1004: hold-vælgerens options = de hold der faktisk optræder i (division-
  // filtrerede) ranglisten.
  const teamOptions = [...new Map(
    divisionFiltered.filter(r => r.team).map(r => [String(r.team.id), r.team.name])
  ).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const filtered = divisionFiltered
    .filter(r => {
      if (ownerFilter === "manager") return r.team && !r.team.is_ai;
      if (ownerFilter === "ai")      return !!r.team?.is_ai;
      if (ownerFilter === "free")    return !r.team;
      return true;
    })
    .filter(r => teamFilter === "all" || String(r.team?.id) === teamFilter)
    .filter(r => {
      if (!search) return true;
      return riderNameMatches(`${r.firstname} ${r.lastname}`, search); // #5941
    })
    .sort((a, b) => {
      // Nation sorteres på den viste IOC-kode (#802) — øvrige kolonner er numeriske.
      const diff = sortKey === "nationality_code"
        ? compareNationality(b.nationality_code, a.nationality_code)
        : (b[sortKey] || 0) - (a[sortKey] || 0);
      return sortAsc ? -diff : diff;
    });

  // Synlige valgfri kolonner i fast rækkefølge.
  const visibleOptionalCols = OPTIONAL_COLS.filter(c => colVisible[c.key]);

  const hasActiveFilters = ownerFilter !== "all" || teamFilter !== "all" || !!search || selection.tier != null;

  // #3104 etape C: siden er fane-indhold i Ranglister-hubben nu (RankingsHubPage
  // ejer PageHeader + faner), så egen PageHeader og yder-container udgik — samme
  // regel som RacePointsPage under #3102 etape 2. States renderer kun kropszonen.
  if (loading) return (
    <div className={`${WRAP} p-5`}>
      <SkeletonLines lines={6} />
    </div>
  );

  // #2175: eksplicit fejl-tilstand — en fejlet query viser en handlingsanvisende
  // fejl med retry, ikke en uendelig spinner ("loading and going nowhere").
  if (error) return (
    <ErrorState
      title={t("rankings.loadError")}
      action={<Button size="sm" variant="secondary" onClick={reload}>{t("rankings.retry")}</Button>}
    />
  );

  // #2849 bølge 1 — kolonne-recept for DataTable (T2). Sticky navnekolonne
  // (rang + rytternavn), fold-kolonner (nation/status/hold) der på mobil
  // samles ind i navnecellens underlinje, resten er numeriske sorterbare
  // kolonner der scroller under den pinnede navnekolonne.
  const columns = [
    {
      key: "rider",
      header: t("rankings.thRider"),
      sticky: true,
      render: (rider, i) => (
        <>
          <span className={`font-data text-xs font-bold ${i === 0 ? "text-cz-accent-t" : i < 3 ? "text-cz-2" : "text-cz-3"}`}>
            {i + 1}
          </span>
          <RiderNameCell id={rider.id} firstname={rider.firstname} lastname={rider.lastname} stopPropagation
            className="font-medium text-cz-1 hover:text-cz-accent-t transition-colors" />
        </>
      ),
    },
    // #802: nation sorterbar (IOC-kode) som på rytterdatabasen.
    {
      key: "nation",
      header: t("rankings.thNation"),
      sortKey: "nationality_code",
      fold: true,
      foldValue: rankingCountry,
      render: rankingCountry,
    },
    {
      key: "badges",
      header: t("rankings.thBadges"),
      fold: true,
      foldValue: (rider) => {
        const key = ageBadgeKey(rider, seasonYear);
        return key ? t(`badges.label.${key}`, { ns: "rider" }) : "";
      },
      render: (rider) => (
        <div className="flex flex-wrap items-center gap-1">
          <RiderBadges badges={[ageBadgeKey(rider, seasonYear), rider.team?.is_ai && "ai"]} />
        </div>
      ),
    },
    {
      key: "team",
      header: t("rankings.thTeam"),
      fold: true,
      foldValue: (rider) => rider.team?.name || t("rankings.teamFree"),
      render: (rider) => (
        <TeamLink id={rider.team?.id} stopPropagation className="text-xs text-cz-2 hover:text-cz-accent-t transition-colors">
          {rider.team?.name || t("rankings.teamFree")}
        </TeamLink>
      ),
    },
    // Point — primær sortering, længst til venstre af stats.
    {
      key: "points",
      ...rankingColumnLabels(t("rankings.colPoints")),
      numeric: true,
      sortKey: "points",
      render: (rider) => (
        <span className={`font-bold ${sortKey === "points" ? "text-cz-accent-t" : "text-cz-1"}`}>
          {formatNumber(rider.points || 0)}
        </span>
      ),
    },
    // Kategori-sejre.
    ...WIN_COLS.map(col => ({
      key: col.key,
      ...rankingColumnLabels(t(col.labelKey)),
      numeric: true,
      sortKey: col.key,
      render: (rider) => <StatCell value={rider[col.key]} active={sortKey === col.key} />,
    })),
    // Sejre i alt — til højre for kategorierne (#925).
    {
      key: "total_wins",
      ...rankingColumnLabels(t("rankings.colTotalWins")),
      numeric: true,
      sortKey: "total_wins",
      render: (rider) => <StatCell value={rider.total_wins} active={sortKey === "total_wins"} />,
    },
    // Tjent præmie.
    {
      key: "prize_earned",
      ...rankingColumnLabels(t("rankings.colPrize")),
      numeric: true,
      sortKey: "prize_earned",
      render: (rider) => (
        <span className={sortKey === "prize_earned" ? "font-bold text-cz-accent-t" : rider.prize_earned > 0 ? "text-cz-2" : "text-cz-3"}>
          {formatNumber(rider.prize_earned || 0)} <span className="text-3xs text-cz-3">CZ$</span>
        </span>
      ),
    },
    // Valgfri kolonner.
    // Telefon: alle valgfrie kolonner er valgbare i kolonne-arket (det erstatter
    // kolonne-menuen dér); computer: dem kolonne-knappen har slået til.
    ...(isMobile ? OPTIONAL_COLS : visibleOptionalCols).map(col => ({
      key: col.key,
      ...rankingColumnLabels(t(col.labelKey)),
      numeric: true,
      sortKey: col.key,
      render: (rider) => <StatCell value={rider[col.key]} active={sortKey === col.key} />,
    })),
  ];

  const visibleColumns = showWins
    ? columns.filter(col => (
      WIN_VIEW_KEYS.includes(col.key) || ("sticky" in col && col.sticky) || ("fold" in col && col.fold)
    )).map(col => {
      if (!WIN_VIEW_KEYS.includes(col.key) || !("mobileLabel" in col) || typeof col.mobileLabel !== "string") return col;
      // DataTable handles bubbled clicks and exposes its current aria-sort on the th.
      const header = (
        <button type="button"
          className="cursor-pointer rounded-cz text-end hyphens-auto wrap-anywhere focus-visible:outline-2 focus-visible:outline-cz-accent-t"
        >
          {col.mobileLabel}
        </button>
      );
      return { ...col, tight: isMobile, header, mobileHeader: header };
    })
    : columns;

  // #8280 (P21): kontrollerne bor i ÉN titellinje inde i tabellens ramme. Valgene
  // står som ord (visning · division · pulje · ejer), søg yderst til højre, hold-valget bag
  // filter-ikonet og kolonne-valget bag kolonne-knappen. Sæson, antal og
  // "opdateret"-tid står i tællelinjen under tabellen (P9), ikke i en løs linje
  // mellem fanerne og tabellen.
  const titleBar = {
    page: "rider_rankings",
    compactChoices: true,
    choices: [
      {
        key: "view",
        ariaLabel: t("rankings.viewLabel"),
        value: view,
        onChange: e => changeView(e.target.value),
        options: [
          { value: "overview", label: t("rankings.viewOverview") },
          { value: "wins", label: t("rankings.viewWins") },
        ],
      },
      {
        key: "division",
        ariaLabel: t("rankings.divisionFilterLabel"),
        value: selection.tier ?? ALL_DIVISIONS_VALUE,
        onChange: e => changeDivision(e.target.value),
        options: [
          { value: ALL_DIVISIONS_VALUE, label: t("rankings.divisionFilterAll") },
          ...ALL_DIVISIONS.map(d => ({
            value: String(d), label: t("rankings.divisionFilterOption", { n: d }),
          })),
        ],
      },
      ...(hasPoolSubtabs ? [{
        key: "pool",
        ariaLabel: t("rankings.poolFilterLabel"),
        value: selection.poolId ?? ALL_POOLS_VALUE,
        onChange: e => changePool(e.target.value),
        options: [
          { value: ALL_POOLS_VALUE, label: t("rankings.poolFilterAll") },
          ...tierPools.map(p => ({ value: String(p.id), label: p.label })),
        ],
      }] : []),
      {
        key: "owner",
        ariaLabel: t("rankings.ownerFilterLabel"),
        value: ownerFilter,
        onChange: e => setOwnerFilter(e.target.value),
        options: OWNER_FILTERS.map(f => ({ value: f.key, label: t(f.labelKey) })),
      },
    ],
    // #1004: filter på ét konkret hold (fx for at se egne ryttere samlet).
    filters: {
      label: t("rankings.teamFilterLabel"),
      count: teamFilter !== "all" ? 1 : 0,
      onReset: () => setTeamFilter("all"),
      children: (
        <Select
          aria-label={t("rankings.teamFilterLabel")}
          value={teamFilter}
          onChange={e => setTeamFilter(e.target.value)}
        >
          <option value="all">{t("rankings.teamFilterAll")}</option>
          {teamOptions.map(team => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </Select>
      ),
    },
    search: {
      value: search,
      onChange: e => setSearch(e.target.value),
      placeholder: t("rankings.searchPlaceholder"),
    },
    // Computer: de valgfrie kolonner. Telefon: DataTable bytter selv til sit eget
    // kolonne-ark (tre kolonner + "Fuld tabel").
    columns: showWins ? null : {
      label: t("rankings.columnsHeading"),
      count: visibleOptionalCols.length,
      total: OPTIONAL_COLS.length,
      items: OPTIONAL_COLS.map(col => ({ key: col.key, label: t(col.labelKey), checked: !!colVisible[col.key] })),
      onToggle: toggleColumn,
    },
  };

  const seasonLine = season
    ? t("rankings.season", { n: season.number })
    : t("rankings.noActiveSeason");

  return (
    <div>
      {!season ? (
        <EmptyState icon={<CalendarIcon size={26} aria-hidden="true" />} title={t("rankings.noActiveSeason")} />
      ) : (
        <DataTable
          label={t("rankings.title")}
          columns={visibleColumns}
          rows={filtered}
          rowKey={(rider) => rider.id}
          titleBar={titleBar}
          /* Titellinjen bliver monteret også når et filter tømmer tabellen (samme
             træ, så søgefeltet beholder fokus og filteret kan slås fra igen). */
          empty={/** @type {any} */ (
            <EmptyState
              icon={<SearchIcon size={26} aria-hidden="true" />}
              title={search ? t("rankings.noResultsFor", { q: search }) : t("rankings.noResults")}
              action={hasActiveFilters
                ? <Button size="sm" variant="secondary" onClick={clearFilters}>{t("common:controls.clearFilters")}</Button>
                : null}
            />
          )}
          mobileDefaults={showWins ? WIN_VIEW_KEYS : ["points", "total_wins", "prize_earned"]}
          sort={sortKey}
          sortDir={sortAsc ? "asc" : "desc"}
          onSort={handleSort}
          rowProps={(rider) => {
            // #2795 — egne ryttere markeret uden at et hold-filter skal slås til.
            // Markeringen er .cz-me (celle-niveau), ikke en box-shadow på <tr>:
            // rækkens skygge blev malet under cellernes egen baggrund og var i
            // praksis usynlig. Se index.css.
            const isMine = myTeamId != null && String(rider.team?.id) === String(myTeamId);
            return {
              onClick: () => navigate(`/riders/${rider.id}`),
              className: `cursor-pointer${isMine ? " cz-me" : ""}`,
            };
          }}
          count={
            <div className="flex flex-wrap items-center gap-4">
              <span className="ms-auto">
                {seasonLine} · {t("rankings.ridersCount", { count: filtered.length })}
                {/* #4225 — mellem to sæsoner viser ranglisten sidste AFSLUTTEDE sæson,
                    fordi den kommende har nul løbsdage. Uden denne etiket ville tallene
                    ligne den igangværende sæsons. Ejer-beslutning 25/8. */}
                {isStale && <span className="ms-2 text-cz-3">{t("rankings.completedSeasonNote")}</span>}
                {!isStale && <UpdatedAtLine at={updatedAt} />}{/* #7664: kun naar de nye tabeller laeses */}
              </span>
            </div>
          }
        />
      )}
    </div>
  );
}
