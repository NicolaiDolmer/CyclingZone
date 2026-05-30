import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/supabasePagination";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import TeamLink from "../components/TeamLink";
import NationCell from "../components/rider/NationCell";
import RiderNameCell from "../components/rider/RiderNameCell";
import RiderBadges from "../components/rider/RiderBadges";
import { formatNumber } from "../lib/intl";

const SORT_COLS = [
  { key: "points",      labelKey: "rankings.colPoints",     shortKey: "rankings.shortPoints" },
  { key: "total_wins",  labelKey: "rankings.colTotalWins",  shortKey: "rankings.shortTotalWins" },
  { key: "stage_wins",  labelKey: "rankings.colStageWins",  shortKey: "rankings.shortStageWins" },
  { key: "gc_wins",     labelKey: "rankings.colGcWins",     shortKey: "rankings.shortGcWins" },
  { key: "pts_wins",    labelKey: "rankings.colPtsWins",    shortKey: "rankings.shortPtsWins" },
  { key: "mtn_wins",    labelKey: "rankings.colMtnWins",    shortKey: "rankings.shortMtnWins" },
  { key: "young_wins",  labelKey: "rankings.colYoungWins",  shortKey: "rankings.shortYoungWins" },
];

const OWNER_FILTERS = [
  { key: "all",     labelKey: "rankings.ownerAll" },
  { key: "manager", labelKey: "rankings.ownerManager" },
  { key: "ai",      labelKey: "rankings.ownerAi" },
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
  const [search, setSearch] = useState("");

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
    const results = await fetchAllRows(() => supabase
      .from("race_results")
      .select("rider_id, result_type, rank, points_earned, rider:rider_id(id, firstname, lastname, nationality_code, is_u25, is_retired, team:team_id(id, name, is_ai))")
      .in("race_id", raceIds)
      .not("rider_id", "is", null)
      .order("id", { ascending: true }));

    const agg = {};
    (results || []).forEach(r => {
      if (!r.rider_id || !r.rider || r.rider.is_retired) return;
      if (!agg[r.rider_id]) {
        agg[r.rider_id] = {
          ...r.rider,
          points: 0,
          stage_wins: 0,
          gc_wins: 0,
          pts_wins: 0,
          mtn_wins: 0,
          young_wins: 0,
        };
      }
      agg[r.rider_id].points += r.points_earned || 0;
      if (r.rank === 1) {
        if (r.result_type === "stage")    agg[r.rider_id].stage_wins++;
        if (r.result_type === "gc")       agg[r.rider_id].gc_wins++;
        if (r.result_type === "points")   agg[r.rider_id].pts_wins++;
        if (r.result_type === "mountain") agg[r.rider_id].mtn_wins++;
        if (r.result_type === "young")    agg[r.rider_id].young_wins++;
      }
    });

    setRiders(
      Object.values(agg).map(a => ({
        ...a,
        total_wins: a.stage_wins + a.gc_wins,
      }))
    );
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  function handleSort(key) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  }

  const filtered = riders
    .filter(r => {
      if (ownerFilter === "manager") return !r.team?.is_ai;
      if (ownerFilter === "ai")      return r.team?.is_ai;
      return true;
    })
    .filter(r => {
      if (!search) return true;
      return `${r.firstname} ${r.lastname}`.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => {
      const diff = (b[sortKey] || 0) - (a[sortKey] || 0);
      return sortAsc ? -diff : diff;
    });

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto">
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

      {/* Owner filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {OWNER_FILTERS.map(f => (
          <button key={f.key} onClick={() => setOwnerFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border
              ${ownerFilter === f.key
                ? "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t"
                : "bg-cz-card border-cz-border text-cz-2 hover:text-cz-1"}`}>
            {t(f.labelKey)}
          </button>
        ))}
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
                  <th className="px-3 py-3 text-left text-xs font-medium text-cz-3 hidden md:table-cell">{t("rankings.thTeam")}</th>
                  {SORT_COLS.map(col => (
                    <th key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`px-3 py-3 text-right text-xs font-medium cursor-pointer hover:text-cz-1 select-none transition-colors whitespace-nowrap
                        ${sortKey === col.key ? "text-cz-accent-t" : "text-cz-3"}`}>
                      <span className="hidden lg:inline">{t(col.labelKey)}</span>
                      <span className="lg:hidden">{t(col.shortKey)}</span>
                      {sortKey === col.key && (
                        <span className="ms-1">{sortAsc ? "↑" : "↓"}</span>
                      )}
                    </th>
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
                        className="font-medium text-cz-1 hover:text-cz-accent-t transition-colors">
                        <RiderBadges badges={[rider.is_u25 && "u25", rider.team?.is_ai && "ai"]} className="hidden sm:inline-flex" />
                      </RiderNameCell>
                    </td>
                    <td className="px-3 py-3 text-xs hidden md:table-cell">
                      <TeamLink id={rider.team?.id} stopPropagation className="text-cz-2 hover:text-cz-accent-t transition-colors">{rider.team?.name || t("rankings.teamFree")}</TeamLink>
                    </td>
                    {/* Point — bold, sorted col highlighted */}
                    <td className={`px-3 py-3 text-right font-mono font-bold
                      ${sortKey === "points" ? "text-cz-accent-t" : "text-cz-1"}`}>
                      {formatNumber(rider.points || 0)}
                    </td>
                    <StatCell value={rider.total_wins}  active={sortKey === "total_wins"} />
                    <StatCell value={rider.stage_wins}  active={sortKey === "stage_wins"} />
                    <StatCell value={rider.gc_wins}     active={sortKey === "gc_wins"} />
                    <StatCell value={rider.pts_wins}    active={sortKey === "pts_wins"} />
                    <StatCell value={rider.mtn_wins}    active={sortKey === "mtn_wins"} />
                    <StatCell value={rider.young_wins}  active={sortKey === "young_wins"} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-cz-border flex items-center gap-4 flex-wrap text-xs text-cz-3">
            <span>{t("rankings.legendStage")}</span>
            <span>{t("rankings.legendGc")}</span>
            <span>{t("rankings.legendPcl")}</span>
            <span>{t("rankings.legendMtn")}</span>
            <span>{t("rankings.legendU25")}</span>
            <span className="ms-auto">{t("rankings.legendSort")}</span>
          </div>
        </div>
      )}
    </div>
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
