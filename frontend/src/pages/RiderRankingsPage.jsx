import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import TeamLink from "../components/TeamLink";
import NationCell from "../components/rider/NationCell";
import RiderNameCell from "../components/rider/RiderNameCell";
import RiderBadges from "../components/rider/RiderBadges";
import { ageBadgeKey } from "../lib/riderAge";
import { formatNumber } from "../lib/intl";
import { compareNationality, getCountryCode3 } from "../lib/countryUtils";
import { useRiderRankings } from "../hooks/useRiderRankings";
import {
  PageHeader,
  Input,
  Select,
  Button,
  Checkbox,
  Dropdown,
  DataTable,
  EmptyState,
  ErrorState,
  SkeletonLines,
  SearchIcon,
  CalendarIcon,
} from "../components/ui";
import { WRAP } from "../components/ui/dataTableStyles.js";

// Altid-synlige sejr-kolonner (kategori-sejre) — venstre→højre.
const WIN_COLS = [
  { key: "stage_wins",   labelKey: "rankings.colStageWins",   shortKey: "rankings.shortStageWins" },
  { key: "gc_wins",      labelKey: "rankings.colGcWins",      shortKey: "rankings.shortGcWins" },
  { key: "classic_wins", labelKey: "rankings.colClassicWins", shortKey: "rankings.shortClassicWins" },
  { key: "pts_wins",     labelKey: "rankings.colPtsWins",     shortKey: "rankings.shortPtsWins" },
  { key: "mtn_wins",     labelKey: "rankings.colMtnWins",     shortKey: "rankings.shortMtnWins" },
  { key: "young_wins",   labelKey: "rankings.colYoungWins",   shortKey: "rankings.shortYoungWins" },
];

// Valgfri kolonner styret af kolonne-toggle. default: top3/top10 synlige, trøjedage skjult.
const OPTIONAL_COLS = [
  { key: "top3",        labelKey: "rankings.colTop3",        shortKey: "rankings.shortTop3",        defaultVisible: true },
  { key: "top10",       labelKey: "rankings.colTop10",       shortKey: "rankings.shortTop10",       defaultVisible: true },
  { key: "yellow_days", labelKey: "rankings.colYellowDays",  shortKey: "rankings.shortYellowDays",  defaultVisible: false },
  { key: "green_days",  labelKey: "rankings.colGreenDays",   shortKey: "rankings.shortGreenDays",   defaultVisible: false },
  { key: "polka_days",  labelKey: "rankings.colPolkaDays",   shortKey: "rankings.shortPolkaDays",   defaultVisible: false },
  { key: "white_days",  labelKey: "rankings.colWhiteDays",   shortKey: "rankings.shortWhiteDays",   defaultVisible: false },
];

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

// Dobbelt header-label (kort på mobil, langt på desktop) — bevaret 1:1 fra den
// tidligere SortColHeader-hjælper, nu som DataTable `header`-node.
function ColHeader({ t, labelKey, shortKey }) {
  return (
    <>
      <span className="hidden lg:inline">{t(labelKey)}</span>
      <span className="lg:hidden">{t(shortKey)}</span>
    </>
  );
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

export default function RiderRankingsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("riders");
  // #2175: rangliste-data (sæson + færdig-aggregerede rytter-stats) kommer fra
  // useRiderRankings — ÉN let query mod rider_rankings_mv + display-join i stedet
  // for den gamle client-agg over ~38k race_results. error → fejl-UI, ikke spinner.
  const { riders, season, loading, error, reload } = useRiderRankings();
  const [sortKey, setSortKey] = useState("points");
  const [sortAsc, setSortAsc] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("all");
  // #1004: filter på ét konkret hold ("all" = alle hold).
  const [teamFilter, setTeamFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [colVisible, setColVisible] = useState(loadColumnVisibility);

  function handleSort(key) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
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
  }

  // #1004: hold-vælgerens options = de hold der faktisk optræder i ranglisten.
  const teamOptions = [...new Map(
    riders.filter(r => r.team).map(r => [String(r.team.id), r.team.name])
  ).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const filtered = riders
    .filter(r => {
      if (ownerFilter === "manager") return r.team && !r.team.is_ai;
      if (ownerFilter === "ai")      return !!r.team?.is_ai;
      if (ownerFilter === "free")    return !r.team;
      return true;
    })
    .filter(r => teamFilter === "all" || String(r.team?.id) === teamFilter)
    .filter(r => {
      if (!search) return true;
      return `${r.firstname} ${r.lastname}`.toLowerCase().includes(search.toLowerCase());
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

  const hasActiveFilters = ownerFilter !== "all" || teamFilter !== "all" || !!search;

  if (loading) return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t("rankings.title")} />
      <div className={`${WRAP} p-5`}>
        <SkeletonLines lines={6} />
      </div>
    </div>
  );

  // #2175: eksplicit fejl-tilstand — en fejlet query viser en handlingsanvisende
  // fejl med retry, ikke en uendelig spinner ("loading and going nowhere").
  if (error) return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t("rankings.title")} />
      <ErrorState
        title={t("rankings.loadError")}
        action={<Button size="sm" variant="secondary" onClick={reload}>{t("rankings.retry")}</Button>}
      />
    </div>
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
      foldValue: (rider) => getCountryCode3(rider.nationality_code) || "",
      render: (rider) => <NationCell code={rider.nationality_code} />,
    },
    {
      key: "badges",
      header: t("rankings.thBadges"),
      fold: true,
      foldValue: (rider) => {
        const key = ageBadgeKey(rider);
        return key ? t(`badges.label.${key}`, { ns: "rider" }) : "";
      },
      render: (rider) => (
        <div className="flex flex-wrap items-center gap-1">
          <RiderBadges badges={[ageBadgeKey(rider), rider.team?.is_ai && "ai"]} />
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
      header: <ColHeader t={t} labelKey="rankings.colPoints" shortKey="rankings.shortPoints" />,
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
      header: <ColHeader t={t} labelKey={col.labelKey} shortKey={col.shortKey} />,
      numeric: true,
      sortKey: col.key,
      render: (rider) => <StatCell value={rider[col.key]} active={sortKey === col.key} />,
    })),
    // Sejre i alt — til højre for kategorierne (#925).
    {
      key: "total_wins",
      header: <ColHeader t={t} labelKey="rankings.colTotalWins" shortKey="rankings.shortTotalWins" />,
      numeric: true,
      sortKey: "total_wins",
      render: (rider) => <StatCell value={rider.total_wins} active={sortKey === "total_wins"} />,
    },
    // Tjent præmie.
    {
      key: "prize_earned",
      header: <ColHeader t={t} labelKey="rankings.colPrize" shortKey="rankings.shortPrize" />,
      numeric: true,
      sortKey: "prize_earned",
      render: (rider) => (
        <span className={sortKey === "prize_earned" ? "font-bold text-cz-accent-t" : rider.prize_earned > 0 ? "text-cz-2" : "text-cz-3"}>
          {formatNumber(rider.prize_earned || 0)} <span className="text-[10px] text-cz-3">CZ$</span>
        </span>
      ),
    },
    // Valgfri kolonner.
    ...visibleOptionalCols.map(col => ({
      key: col.key,
      header: <ColHeader t={t} labelKey={col.labelKey} shortKey={col.shortKey} />,
      numeric: true,
      sortKey: col.key,
      render: (rider) => <StatCell value={rider[col.key]} active={sortKey === col.key} />,
    })),
  ];

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader
        title={t("rankings.title")}
        subtitle={
          season
            ? `${t("rankings.season", { n: season.number })}${filtered.length > 0 ? ` · ${t("rankings.ridersCount", { count: filtered.length })}` : ""}`
            : t("rankings.noActiveSeason")
        }
      />

      {/* Filter-bar (T2-recept): search Input + op til 3 Selects, kolonne-toggle
          højrestillet (samme mønster som StandingsPage's Compare-knap, #2849 bølge 1). */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-60">
          <Input
            type="text" size="sm" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t("rankings.searchPlaceholder")}
          />
        </div>
        <Select
          size="sm"
          aria-label={t("rankings.ownerFilterLabel")}
          value={ownerFilter}
          onChange={e => setOwnerFilter(e.target.value)}
        >
          {OWNER_FILTERS.map(f => (
            <option key={f.key} value={f.key}>{t(f.labelKey)}</option>
          ))}
        </Select>
        {/* #1004: filter på ét konkret hold (fx for at se egne ryttere samlet). */}
        <Select
          size="sm"
          aria-label={t("rankings.teamFilterLabel")}
          value={teamFilter}
          onChange={e => setTeamFilter(e.target.value)}
        >
          <option value="all">{t("rankings.teamFilterAll")}</option>
          {teamOptions.map(team => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </Select>

        {/* Kolonne-synlighed. */}
        <Dropdown
          align="right"
          className="ms-auto"
          trigger={({ open, toggle }) => (
            <Button type="button" variant="secondary" size="sm" onClick={toggle} aria-expanded={open}>
              {t("rankings.columnsButton")}
            </Button>
          )}
        >
          <p className="px-2.5 py-1 text-xs font-medium text-cz-3">{t("rankings.columnsHeading")}</p>
          <div className="flex flex-col gap-1.5 px-2.5 py-1.5">
            {OPTIONAL_COLS.map(col => (
              <Checkbox
                key={col.key}
                id={`rankings-col-${col.key}`}
                label={t(col.labelKey)}
                checked={!!colVisible[col.key]}
                onChange={() => toggleColumn(col.key)}
              />
            ))}
          </div>
        </Dropdown>
      </div>

      {!season ? (
        <EmptyState icon={<CalendarIcon size={26} aria-hidden="true" />} title={t("rankings.noActiveSeason")} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SearchIcon size={26} aria-hidden="true" />}
          title={search ? t("rankings.noResultsFor", { q: search }) : t("rankings.noResults")}
          action={hasActiveFilters
            ? <Button size="sm" variant="secondary" onClick={clearFilters}>{t("common:controls.clearFilters")}</Button>
            : null}
        />
      ) : (
        <DataTable
          label={t("rankings.title")}
          columns={columns}
          rows={filtered}
          rowKey={(rider) => rider.id}
          sort={sortKey}
          sortDir={sortAsc ? "asc" : "desc"}
          onSort={handleSort}
          rowProps={(rider) => ({
            onClick: () => navigate(`/riders/${rider.id}`),
            className: "cursor-pointer",
          })}
          count={
            <div className="flex flex-wrap items-center gap-4">
              <span>{t("rankings.legendStage")}</span>
              <span>{t("rankings.legendGc")}</span>
              <span>{t("rankings.legendClassic")}</span>
              <span>{t("rankings.legendPcl")}</span>
              <span>{t("rankings.legendMtn")}</span>
              <span>{t("rankings.legendU25")}</span>
              <span className="ms-auto">{t("rankings.ridersCount", { count: filtered.length })}</span>
            </div>
          }
        />
      )}
    </div>
  );
}
