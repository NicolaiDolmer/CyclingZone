import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { getFlagEmoji } from "../lib/countryUtils";

const SORT_COLS = [
  { key: "points",      label: "Point",              shortLabel: "Pt" },
  { key: "total_wins",  label: "Samlede sejre",       shortLabel: "Sejre" },
  { key: "stage_wins",  label: "Etapesejre",          shortLabel: "Etape" },
  { key: "gc_wins",     label: "GC-sejre",            shortLabel: "GC" },
  { key: "pts_wins",    label: "Pointklassement",     shortLabel: "PKL" },
  { key: "mtn_wins",    label: "Bjergklassement",     shortLabel: "Bjerg" },
  { key: "young_wins",  label: "Ungdomsklassement",   shortLabel: "U25" },
];

const OWNER_FILTERS = [
  { key: "all",     label: "Alle" },
  { key: "manager", label: "Manager-ejede" },
  { key: "ai",      label: "AI-ejede" },
];

export default function RiderRankingsPage() {
  const navigate = useNavigate();
  const [riders, setRiders] = useState([]);
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState("points");
  const [sortAsc, setSortAsc] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const { data: seasonData } = await supabase
      .from("seasons").select("*").eq("status", "active").single();
    setSeason(seasonData);

    if (!seasonData) { setLoading(false); return; }

    const { data: racesData } = await supabase
      .from("races").select("id").eq("season_id", seasonData.id);

    if (!racesData?.length) { setLoading(false); return; }

    const raceIds = racesData.map(r => r.id);
    const { data: results } = await supabase
      .from("race_results")
      .select("rider_id, result_type, rank, points_earned, rider:rider_id(id, firstname, lastname, nationality_code, is_u25, team:team_id(id, name, is_ai))")
      .in("race_id", raceIds)
      .not("rider_id", "is", null)
      .range(0, 9999);

    const agg = {};
    (results || []).forEach(r => {
      if (!r.rider_id || !r.rider) return;
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
          <h1 className="text-xl font-bold text-cz-1">Rytterrangliste</h1>
          <p className="text-cz-3 text-sm">
            {season ? `Sæson ${season.number}` : "Ingen aktiv sæson"}
            {filtered.length > 0 && ` · ${filtered.length} ryttere`}
          </p>
        </div>
        <input
          type="text"
          placeholder="Søg rytternavn…"
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
            {f.label}
          </button>
        ))}
      </div>

      {!season ? (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">◉</p>
          <p>Ingen aktiv sæson</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">◉</p>
          <p>Ingen resultater fundet{search && ` for "${search}"`}</p>
        </div>
      ) : (
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cz-border bg-cz-subtle">
                  <th className="px-3 py-3 text-left text-xs font-medium text-cz-3 w-8">#</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-cz-3 min-w-[160px]">Rytter</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-cz-3 hidden md:table-cell">Hold</th>
                  {SORT_COLS.map(col => (
                    <th key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`px-3 py-3 text-right text-xs font-medium cursor-pointer hover:text-cz-1 select-none transition-colors whitespace-nowrap
                        ${sortKey === col.key ? "text-cz-accent-t" : "text-cz-3"}`}>
                      <span className="hidden lg:inline">{col.label}</span>
                      <span className="lg:hidden">{col.shortLabel}</span>
                      {sortKey === col.key && (
                        <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>
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
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {rider.nationality_code && (
                          <span className="flex-shrink-0">{getFlagEmoji(rider.nationality_code)}</span>
                        )}
                        <span className="font-medium text-cz-1">
                          {rider.firstname} {rider.lastname}
                        </span>
                        {rider.is_u25 && (
                          <span className="text-[9px] uppercase bg-cz-info-bg text-blue-600 border border-cz-info/30 px-1 py-0.5 rounded hidden sm:inline flex-shrink-0">
                            U25
                          </span>
                        )}
                        {rider.team?.is_ai && (
                          <span className="text-[9px] uppercase bg-cz-subtle text-cz-2 border border-cz-border px-1 py-0.5 rounded hidden sm:inline flex-shrink-0">
                            AI
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-cz-2 text-xs hidden md:table-cell">
                      {rider.team?.name || "Fri agent"}
                    </td>
                    {/* Point — bold, sorted col highlighted */}
                    <td className={`px-3 py-3 text-right font-mono font-bold
                      ${sortKey === "points" ? "text-cz-accent-t" : "text-cz-1"}`}>
                      {(rider.points || 0).toLocaleString("da-DK")}
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
            <span>Etape = etapesejre</span>
            <span>GC = klassementssejre</span>
            <span>PKL = pointklassement</span>
            <span>Bjerg = bjergklassement</span>
            <span>U25 = ungdomsklassement</span>
            <span className="ml-auto">Klik kolonne for at sortere</span>
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
