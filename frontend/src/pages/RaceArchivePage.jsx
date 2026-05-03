import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";

export default function RaceArchivePage() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const { data: races } = await supabase
      .from("races")
      .select("id, name, race_type, stages, start_date, status, season:season_id(id, number, status)")
      .order("name");

    const map = {};
    (races || []).forEach(r => {
      const key = r.name.toLowerCase().trim();
      if (!map[key]) map[key] = { name: r.name, race_type: r.race_type, stages: r.stages, editions: [] };
      map[key].editions.push(r);
    });

    const result = Object.values(map).map(g => ({
      ...g,
      editions: g.editions.sort((a, b) => (a.season?.number || 0) - (b.season?.number || 0)),
      latestSeason: g.editions.reduce((max, e) => Math.max(max, e.season?.number || 0), 0),
    })).sort((a, b) => a.name.localeCompare(b.name, "da"));

    setGroups(result);
    setLoading(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">Løbsarkiv</h1>
        <p className="text-cz-3 text-sm">
          {groups.length} {groups.length === 1 ? "løb" : "løb"} på tværs af alle sæsoner
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">🏁</p>
          <p>Ingen løb registreret endnu</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {groups.map(group => (
            <Link
              key={group.name}
              to={`/race-archive/${encodeURIComponent(group.name)}`}
              className="bg-cz-card border border-cz-border rounded-xl p-4 hover:border-cz-accent/30 hover:shadow-sm transition-all group">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors truncate">
                    {group.name}
                  </p>
                  <p className="text-cz-3 text-xs mt-0.5">
                    {group.race_type === "stage_race"
                      ? `Etapeløb · ${group.stages} etaper`
                      : "Enkeltdagsløb"}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-cz-accent-t font-bold text-sm">{group.editions.length}</p>
                  <p className="text-cz-3 text-[10px]">
                    {group.editions.length === 1 ? "udgave" : "udgaver"}
                  </p>
                </div>
              </div>
              {group.latestSeason > 0 && (
                <p className="text-cz-3 text-xs mt-2">
                  Seneste: Sæson {group.latestSeason}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
