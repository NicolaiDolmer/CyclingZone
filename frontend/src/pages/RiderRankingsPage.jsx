import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/supabasePagination";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import TeamLink from "../components/TeamLink";
import NationCell from "../components/rider/NationCell";
import RiderNameCell from "../components/rider/RiderNameCell";
import RiderBadges from "../components/rider/RiderBadges";
import { ageBadgeKey } from "../lib/riderAge";
import { formatNumber } from "../lib/intl";
import { STAT_KEYS, riderStatRating } from "../lib/riderRating";

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

export default function RiderRankingsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("riders");
  const [riders, setRiders] = useState([]);
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState("points");
  const [sortAsc, setSortAsc] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("all");
  // #1004: filter på ét konkret hold ("all" = alle hold).
  const [teamFilter, setTeamFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [colVisible, setColVisible] = useState(loadColumnVisibility);
  const [colMenuOpen, setColMenuOpen] = useState(false);

  async function loadAll() {
    const { data: seasonData } = await supabase
      .from("seasons").select("*").eq("status", "active").single();
    setSeason(seasonData);

    if (!seasonData) { setLoading(false); return; }

    const { data: racesData } = await supabase
      .from("races").select("id").eq("season_id", seasonData.id);

    if (!racesData?.length) { setLoading(false); return; }

    const raceIds = racesData.map(r => r.id);
    // Paginér: PostgREST capper ved 1000 (også .range(0,9999)) → ellers
    // underberegnes ranglisten for sæsoner med >1000 resultatrækker.
    // #1009: stats hentes som separat parallel query (i stedet for at blæse
    // 14 ekstra felter ind i rider-embed'et pr. resultatrække). Best-effort:
    // fejler stats-fetch, viser ranglisten stadig (rating = 0).
    const [results, statRows] = await Promise.all([
      fetchAllRows(() => supabase
        .from("race_results")
        .select("rider_id, result_type, rank, points_earned, prize_money, race:race_id(race_type), rider:rider_id(id, firstname, lastname, birthdate, nationality_code, is_u25, is_retired, team:team_id(id, name, is_ai))")
        .in("race_id", raceIds)
        .not("rider_id", "is", null)
        .order("id", { ascending: true })),
      fetchAllRows(() => supabase
        .from("riders")
        .select(`id, ${STAT_KEYS.join(", ")}`)
        .eq("is_retired", false)
        .order("id", { ascending: true }))
        .catch(() => []),
    ]);

    const ratingByRider = new Map((statRows || []).map(r => [r.id, riderStatRating(r)]));

    const agg = {};
    (results || []).forEach(r => {
      if (!r.rider_id || !r.rider || r.rider.is_retired) return;
      if (!agg[r.rider_id]) {
        agg[r.rider_id] = {
          ...r.rider,
          rating: ratingByRider.get(r.rider_id) ?? 0,
          points: 0,
          stage_wins: 0,
          gc_wins: 0,
          classic_wins: 0,
          pts_wins: 0,
          mtn_wins: 0,
          young_wins: 0,
          yellow_days: 0,
          green_days: 0,
          polka_days: 0,
          white_days: 0,
          prize_earned: 0,
          top3: 0,
          top10: 0,
        };
      }
      const a = agg[r.rider_id];
      a.points += r.points_earned || 0;
      a.prize_earned += r.prize_money || 0;
      const raceType = r.race?.race_type;
      if (r.rank === 1) {
        if (r.result_type === "stage")                                  a.stage_wins++;
        if (r.result_type === "gc" && raceType === "stage_race")        a.gc_wins++;
        if (r.result_type === "gc" && raceType === "single")            a.classic_wins++;
        if (r.result_type === "points")                                 a.pts_wins++;
        if (r.result_type === "mountain")                               a.mtn_wins++;
        if (r.result_type === "young")                                  a.young_wins++;
        if (r.result_type === "leader")                                 a.yellow_days++;
        if (r.result_type === "points_day")                             a.green_days++;
        if (r.result_type === "mountain_day")                           a.polka_days++;
        if (r.result_type === "young_day")                              a.white_days++;
      }
      // Top 3 / Top 10 — kun etape- og GC-placeringer (samlet/klassiker).
      if (r.result_type === "stage" || r.result_type === "gc") {
        if (r.rank <= 3)  a.top3++;
        if (r.rank <= 10) a.top10++;
      }
    });

    setRiders(
      Object.values(agg).map(a => ({
        ...a,
        // #925: Sejre i alt = alle kategori-sejre, ikke kun etape + samlet.
        total_wins: a.stage_wins + a.gc_wins + a.classic_wins + a.pts_wins + a.mtn_wins + a.young_wins,
      }))
    );
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

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
      const diff = (b[sortKey] || 0) - (a[sortKey] || 0);
      return sortAsc ? -diff : diff;
    });

  // Synlige valgfri kolonner i fast rækkefølge.
  const visibleOptionalCols = OPTIONAL_COLS.filter(c => colVisible[c.key]);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-full">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("rankings.title")}</h1>
          <p className="text-cz-3 text-sm">
            {season ? t("rankings.season", { n: season.number }) : t("rankings.noActiveSeason")}
            {filtered.length > 0 && ` · ${t("rankings.ridersCount", { count: filtered.length })}`}
          </p>
        </div>
        <input
          type="text"
          placeholder={t("rankings.searchPlaceholder")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 text-sm border border-cz-border rounded-lg bg-cz-subtle text-cz-1 placeholder-cz-3 focus:outline-none focus:ring-1 focus:ring-cz-accent w-48"
        />
      </div>

      {/* Owner filter + kolonne-toggle */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {OWNER_FILTERS.map(f => (
          <button key={f.key} onClick={() => setOwnerFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border
              ${ownerFilter === f.key
                ? "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t"
                : "bg-cz-card border-cz-border text-cz-2 hover:text-cz-1"}`}>
            {t(f.labelKey)}
          </button>
        ))}

        {/* #1004: filter på ét konkret hold (fx for at se egne ryttere samlet) */}
        <select
          value={teamFilter}
          onChange={e => setTeamFilter(e.target.value)}
          aria-label={t("rankings.teamFilterLabel")}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border max-w-[14rem] cursor-pointer
            focus:outline-none focus:ring-1 focus:ring-cz-accent
            ${teamFilter !== "all"
              ? "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t"
              : "bg-cz-card border-cz-border text-cz-2"}`}>
          <option value="all">{t("rankings.teamFilterAll")}</option>
          {teamOptions.map(team => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>

        {/* Kolonne-synlighed */}
        <div className="relative ms-auto">
          <button
            type="button"
            onClick={() => setColMenuOpen(o => !o)}
            aria-expanded={colMenuOpen}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all border bg-cz-card border-cz-border text-cz-2 hover:text-cz-1">
            {t("rankings.columnsButton")}
          </button>
          {colMenuOpen && (
            <>
              {/* Klik-udenfor-overlay */}
              <div className="fixed inset-0 z-30" onClick={() => setColMenuOpen(false)} />
              <div className="absolute right-0 mt-2 z-40 w-56 bg-cz-card border border-cz-border rounded-lg shadow-lg p-3">
                <p className="text-xs font-medium text-cz-3 mb-2">{t("rankings.columnsHeading")}</p>
                <div className="flex flex-col gap-1.5">
                  {OPTIONAL_COLS.map(col => (
                    <label key={col.key} className="flex items-center gap-2 text-sm text-cz-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!colVisible[col.key]}
                        onChange={() => toggleColumn(col.key)}
                        className="accent-cz-accent"
                      />
                      <span>{t(col.labelKey)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {!season ? (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">◉</p>
          <p>{t("rankings.noActiveSeason")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">◉</p>
          <p>{search ? t("rankings.noResultsFor", { q: search }) : t("rankings.noResults")}</p>
          {(ownerFilter !== "all" || teamFilter !== "all" || search) && (
            <button onClick={() => { setOwnerFilter("all"); setTeamFilter("all"); setSearch(""); }}
              className="mt-4 px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
                rounded-lg text-xs font-medium hover:bg-cz-accent/10 transition-all">
              {t("common:controls.clearFilters")}
            </button>
          )}
        </div>
      ) : (
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cz-border bg-cz-subtle">
                  <th className="px-3 py-3 text-left text-xs font-medium text-cz-3 w-8">#</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-cz-3 hidden sm:table-cell">{t("rankings.thNation")}</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-cz-3 min-w-[120px] sticky left-0 z-20 bg-cz-subtle border-r border-cz-border">{t("rankings.thRider")}</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-cz-3 hidden sm:table-cell">{t("rankings.thBadges")}</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-cz-3 hidden md:table-cell">{t("rankings.thTeam")}</th>
                  {/* #1009: Samlet rating (snit af rytterens stats) — attribut, ikke resultat, derfor før Point */}
                  <SortHeader col={{ key: "rating", labelKey: "rankings.colRating", shortKey: "rankings.shortRating" }}
                    sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} t={t} />
                  {/* Point — primær sortering, længst til venstre af stats */}
                  <SortHeader col={{ key: "points", labelKey: "rankings.colPoints", shortKey: "rankings.shortPoints" }}
                    sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} t={t} />
                  {/* Kategori-sejre */}
                  {WIN_COLS.map(col => (
                    <SortHeader key={col.key} col={col} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} t={t} />
                  ))}
                  {/* Sejre i alt — til højre for kategorierne (#925) */}
                  <SortHeader col={{ key: "total_wins", labelKey: "rankings.colTotalWins", shortKey: "rankings.shortTotalWins" }}
                    sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} t={t} />
                  {/* Tjent præmie */}
                  <SortHeader col={{ key: "prize_earned", labelKey: "rankings.colPrize", shortKey: "rankings.shortPrize" }}
                    sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} t={t} />
                  {/* Valgfri kolonner */}
                  {visibleOptionalCols.map(col => (
                    <SortHeader key={col.key} col={col} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} t={t} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((rider, i) => (
                  <tr key={rider.id}
                    onClick={() => navigate(`/riders/${rider.id}`)}
                    className="border-b border-cz-border last:border-0 hover:bg-cz-subtle cursor-pointer transition-colors">
                    <td className="px-3 py-3">
                      <span className={`font-mono font-bold text-sm
                        ${i === 0 ? "text-cz-accent-t" : i < 3 ? "text-cz-2" : "text-cz-3"}`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-2 py-3 hidden sm:table-cell">
                      <NationCell code={rider.nationality_code} />
                    </td>
                    <td className="px-3 py-3 sticky-name-cell sticky left-0 z-10 border-r border-cz-border shadow-[10px_0_16px_-16px_rgba(0,0,0,0.5)]">
                      <RiderNameCell id={rider.id} firstname={rider.firstname} lastname={rider.lastname} stopPropagation
                        className="font-medium text-cz-1 hover:text-cz-accent-t transition-colors" />
                    </td>
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <div className="flex flex-wrap items-center gap-1">
                        <RiderBadges badges={[ageBadgeKey(rider), rider.team?.is_ai && "ai"]} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs hidden md:table-cell">
                      <TeamLink id={rider.team?.id} stopPropagation className="text-cz-2 hover:text-cz-accent-t transition-colors">{rider.team?.name || t("rankings.teamFree")}</TeamLink>
                    </td>
                    {/* #1009: Samlet rating */}
                    <StatCell value={rider.rating} active={sortKey === "rating"} />
                    {/* Point — bold, sorted col highlighted */}
                    <td className={`px-3 py-3 text-right font-mono font-bold
                      ${sortKey === "points" ? "text-cz-accent-t" : "text-cz-1"}`}>
                      {formatNumber(rider.points || 0)}
                    </td>
                    {/* Kategori-sejre */}
                    <StatCell value={rider.stage_wins}   active={sortKey === "stage_wins"} />
                    <StatCell value={rider.gc_wins}      active={sortKey === "gc_wins"} />
                    <StatCell value={rider.classic_wins} active={sortKey === "classic_wins"} />
                    <StatCell value={rider.pts_wins}     active={sortKey === "pts_wins"} />
                    <StatCell value={rider.mtn_wins}     active={sortKey === "mtn_wins"} />
                    <StatCell value={rider.young_wins}   active={sortKey === "young_wins"} />
                    {/* Sejre i alt */}
                    <StatCell value={rider.total_wins}   active={sortKey === "total_wins"} />
                    {/* Tjent præmie */}
                    <td className={`px-3 py-3 text-right font-mono text-sm whitespace-nowrap
                      ${sortKey === "prize_earned" ? "text-cz-accent-t font-bold" : rider.prize_earned > 0 ? "text-cz-2" : "text-cz-3"}`}>
                      {formatNumber(rider.prize_earned || 0)} CZ$
                    </td>
                    {/* Valgfri kolonner */}
                    {visibleOptionalCols.map(col => (
                      <StatCell key={col.key} value={rider[col.key]} active={sortKey === col.key} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-cz-border flex items-center gap-4 flex-wrap text-xs text-cz-3">
            <span>{t("rankings.legendStage")}</span>
            <span>{t("rankings.legendGc")}</span>
            <span>{t("rankings.legendClassic")}</span>
            <span>{t("rankings.legendPcl")}</span>
            <span>{t("rankings.legendMtn")}</span>
            <span>{t("rankings.legendU25")}</span>
            <span>{t("rankings.legendRating")}</span>
            <span className="ms-auto">{t("rankings.legendSort")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({ col, sortKey, sortAsc, onSort, t }) {
  return (
    <th
      onClick={() => onSort(col.key)}
      className={`px-3 py-3 text-right text-xs font-medium cursor-pointer hover:text-cz-1 select-none transition-colors whitespace-nowrap
        ${sortKey === col.key ? "text-cz-accent-t" : "text-cz-3"}`}>
      <span className="hidden lg:inline">{t(col.labelKey)}</span>
      <span className="lg:hidden">{t(col.shortKey)}</span>
      {sortKey === col.key && (
        <span className="ms-1">{sortAsc ? "↑" : "↓"}</span>
      )}
    </th>
  );
}

function StatCell({ value, active }) {
  return (
    <td className={`px-3 py-3 text-right font-mono text-sm
      ${active ? "text-cz-accent-t font-bold" : value > 0 ? "text-cz-2" : "text-cz-3"}`}>
      {value || 0}
    </td>
  );
}
