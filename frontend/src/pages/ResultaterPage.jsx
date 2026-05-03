import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router-dom";
import { getFlagEmoji } from "../lib/countryUtils";

const HUB_LINKS = [
  { to: "/standings",      label: "Ranglisten",      desc: "Holdranglisten for aktiv sæson",              icon: "🏆" },
  { to: "/rider-rankings", label: "Rytterrangliste",  desc: "Individuelle resultater for alle ryttere",    icon: "🚴" },
  { to: "/race-archive",   label: "Løbsarkiv",        desc: "Historik pr. løb på tværs af sæsoner",       icon: "📖" },
  { to: "/season-end",     label: "Sæsonresultater",  desc: "Historiske sæsonafslutninger",                icon: "📅" },
  { to: "/hall-of-fame",   label: "Hall of Fame",     desc: "Rekorder og manager-rangliste",               icon: "👑" },
  { to: "/race-points",    label: "Pointtabel",       desc: "UCI-point og præmier pr. løbsklasse",         icon: "📊" },
];

export default function ResultaterPage() {
  const navigate = useNavigate();
  const [season, setSeason] = useState(null);
  const [topTeams, setTopTeams] = useState([]);
  const [topRiders, setTopRiders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const { data: seasonData } = await supabase
      .from("seasons").select("*").eq("status", "active").single();
    setSeason(seasonData);

    if (!seasonData) { setLoading(false); return; }

    const [standingsRes, racesRes] = await Promise.all([
      supabase
        .from("season_standings")
        .select("total_points, stage_wins, gc_wins, team:team_id(id, name, is_ai, division)")
        .eq("season_id", seasonData.id)
        .order("total_points", { ascending: false })
        .limit(5),
      supabase.from("races").select("id").eq("season_id", seasonData.id),
    ]);

    setTopTeams((standingsRes.data || []).filter(s => !s.team?.is_ai).slice(0, 3));

    if (racesRes.data?.length) {
      const raceIds = racesRes.data.map(r => r.id);
      const { data: results } = await supabase
        .from("race_results")
        .select("rider_id, result_type, rank, points_earned, rider:rider_id(id, firstname, lastname, nationality_code, team:team_id(name, is_ai))")
        .in("race_id", raceIds)
        .not("rider_id", "is", null)
        .range(0, 9999);

      const agg = {};
      (results || []).forEach(r => {
        if (!r.rider_id || !r.rider) return;
        if (!agg[r.rider_id]) {
          agg[r.rider_id] = { rider: r.rider, points: 0, stage_wins: 0, gc_wins: 0 };
        }
        agg[r.rider_id].points += r.points_earned || 0;
        if (r.rank === 1 && r.result_type === "stage") agg[r.rider_id].stage_wins++;
        if (r.rank === 1 && r.result_type === "gc")    agg[r.rider_id].gc_wins++;
      });

      setTopRiders(
        Object.values(agg)
          .filter(a => a.rider)
          .sort((a, b) => b.points - a.points)
          .slice(0, 5)
      );
    }

    setLoading(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-cz-1">Resultater</h1>
        <p className="text-cz-3 text-sm">
          {season ? `Sæson ${season.number} · aktiv` : "Ingen aktiv sæson"}
        </p>
      </div>

      {/* Hub navigation */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {HUB_LINKS.map(link => (
          <Link key={link.to} to={link.to}
            className="bg-cz-card border border-cz-border rounded-xl p-4 hover:border-cz-accent/30 hover:shadow-sm transition-all group text-center">
            <div className="text-2xl mb-2">{link.icon}</div>
            <p className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">
              {link.label}
            </p>
            <p className="text-cz-3 text-xs mt-0.5 leading-snug">{link.desc}</p>
          </Link>
        ))}
      </div>

      {!season ? (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">◉</p>
          <p>Ingen aktiv sæson — resultater vises her når sæsonen er i gang</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Tophold */}
          {topTeams.length > 0 && (
            <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-cz-border">
                <h2 className="font-semibold text-cz-1 text-sm">Tophold — Sæson {season.number}</h2>
              </div>
              <div className="divide-y divide-cz-border">
                {topTeams.map((s, i) => (
                  <div key={s.team?.id}
                    onClick={() => navigate(`/teams/${s.team?.id}`)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-cz-subtle cursor-pointer transition-colors">
                    <span className={`w-5 text-center font-mono font-bold text-sm flex-shrink-0
                      ${i === 0 ? "text-cz-accent-t" : "text-cz-3"}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-cz-1 text-sm truncate">{s.team?.name}</p>
                      <p className="text-cz-3 text-xs">
                        {s.stage_wins || 0} etapesejre · {s.gc_wins || 0} GC
                      </p>
                    </div>
                    <span className="font-mono font-bold text-cz-accent-t text-sm">
                      {(s.total_points || 0).toLocaleString("da-DK")} pt
                    </span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-cz-border">
                <Link to="/standings" className="text-xs text-cz-accent-t hover:underline">Se hele ranglisten →</Link>
              </div>
            </div>
          )}

          {/* Topscorere */}
          {topRiders.length > 0 && (
            <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-cz-border">
                <h2 className="font-semibold text-cz-1 text-sm">Topscorere — Sæson {season.number}</h2>
              </div>
              <div className="divide-y divide-cz-border">
                {topRiders.map((a, i) => (
                  <div key={a.rider.id}
                    onClick={() => navigate(`/riders/${a.rider.id}`)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-cz-subtle cursor-pointer transition-colors">
                    <span className={`w-5 text-center font-mono font-bold text-sm flex-shrink-0
                      ${i === 0 ? "text-cz-accent-t" : "text-cz-3"}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-cz-1 text-sm truncate">
                        {a.rider.nationality_code && (
                          <span className="mr-1">{getFlagEmoji(a.rider.nationality_code)}</span>
                        )}
                        {a.rider.firstname} {a.rider.lastname}
                      </p>
                      <p className="text-cz-3 text-xs">
                        {a.rider.team?.name || "Fri agent"}
                        {a.stage_wins > 0 && ` · ${a.stage_wins} etapesejre`}
                        {a.gc_wins > 0 && ` · ${a.gc_wins} GC`}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-cz-accent-t text-sm">
                      {(a.points || 0).toLocaleString("da-DK")} pt
                    </span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-cz-border">
                <Link to="/rider-rankings" className="text-xs text-cz-accent-t hover:underline">Se alle ryttere →</Link>
              </div>
            </div>
          )}

          {topTeams.length === 0 && topRiders.length === 0 && (
            <div className="md:col-span-2 text-center py-12 text-cz-3">
              <p className="text-4xl mb-3">◉</p>
              <p>Ingen løbsresultater importeret endnu denne sæson</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
