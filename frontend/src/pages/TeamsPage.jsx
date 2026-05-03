import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const DIV_COLORS = { 1: "#e8c547", 2: "#60a5fa", 3: "#a78bfa" };
const DIV_NAMES  = { 1: "Division 1", 2: "Division 2", 3: "Division 3" };

export default function TeamsPage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);
  const [search, setSearch] = useState("");
  const [divFilter, setDivFilter] = useState("all");
  const [riderCounts, setRiderCounts] = useState({});
  const [standings, setStandings] = useState({});

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (myTeam) setMyTeamId(myTeam.id);

    const { data: activeSeason } = await supabase
      .from("seasons").select("id")
      .eq("status", "active")
      .single();

    const [teamsRes, ridersRes, standingsRes] = await Promise.all([
      supabase.from("teams")
        .select("id, name, division, balance, sponsor_income, user:user_id(last_seen)")
        .eq("is_ai", false)
        .order("division").order("name"),
      supabase.from("riders").select("team_id").not("team_id", "is", null),
      activeSeason
        ? supabase.from("season_standings")
            .select("team_id, total_points, stage_wins, gc_wins")
            .eq("season_id", activeSeason.id)
        : Promise.resolve({ data: [] }),
    ]);

    const counts = {};
    (ridersRes.data || []).forEach(r => {
      counts[r.team_id] = (counts[r.team_id] || 0) + 1;
    });
    setRiderCounts(counts);

    const smap = {};
    (teamsRes.data || []).forEach(team => {
      smap[team.id] = { total_points: 0, stage_wins: 0, gc_wins: 0 };
    });
    (standingsRes.data || []).forEach(s => {
      smap[s.team_id] = s;
    });
    setStandings(smap);
    setTeams(teamsRes.data || []);
    setLoading(false);
  }

  const filtered = teams.filter(t => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase());
    const matchDiv = divFilter === "all" || t.division === parseInt(divFilter);
    return matchSearch && matchDiv;
  });

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-cz-1">Hold</h1>
        <p className="text-cz-3 text-sm">{teams.length} managere</p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-5 flex-wrap">
        <input type="text" placeholder="Søg hold..." value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-cz-card border border-cz-border rounded-lg px-3 py-2
            text-cz-1 text-sm placeholder-cz-3 w-48
            focus:outline-none focus:border-cz-accent" />
        {["all","1","2","3"].map(d => (
          <button key={d} onClick={() => setDivFilter(d)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border
              ${divFilter === d
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/40"
                : "bg-cz-card text-cz-2 border-cz-border hover:text-cz-1"}`}>
            {d === "all" ? "Alle" : `Div ${d}`}
          </button>
        ))}
      </div>

      {/* Teams by division */}
      {[1,2,3].map(div => {
        const divTeams = filtered.filter(t => t.division === div);
        if (!divTeams.length) return null;
        return (
          <div key={div} className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full" style={{ background: DIV_COLORS[div] }} />
              <span className="text-xs uppercase tracking-widest font-medium"
                style={{ color: DIV_COLORS[div] }}>
                {DIV_NAMES[div]}
              </span>
              <span className="text-cz-3 text-xs">— {divTeams.length} hold</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {divTeams.map(team => {
                const isMe = team.id === myTeamId;
                const riderCount = riderCounts[team.id] || 0;
                const standing = standings[team.id];
                const lastSeen = team.user?.last_seen;
                const isOnline = lastSeen && (Date.now() - new Date(lastSeen).getTime()) < 5 * 60 * 1000;
                return (
                  <div key={team.id}
                    onClick={() => navigate(`/teams/${team.id}`)}
                    className={`bg-cz-card border rounded-xl p-4 cursor-pointer
                      hover:border-cz-border transition-all group
                      ${isMe ? "border-[#e8c547]/25 shadow-[0_0_15px_rgba(232,197,71,0.05)]" : "border-cz-border"}`}>

                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`font-semibold text-sm group-hover:text-cz-accent-t transition-colors
                            ${isMe ? "text-cz-accent-t" : "text-cz-1"}`}>
                            {team.name}
                          </p>
                          {isMe && (
                            <span className="text-[9px] uppercase bg-cz-accent/10 text-cz-accent-t
                              px-1.5 py-0.5 rounded-full border border-cz-accent/30">Dig</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOnline ? "bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.8)]" : "bg-cz-subtle"}`} />
                          <p className="text-cz-3 text-xs">{riderCount} ryttere</p>
                        </div>
                      </div>
            
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-cz-subtle rounded-lg p-2 text-center">
                        <p className="text-cz-3 text-[9px] uppercase tracking-wider">Point</p>
                        <p className="text-cz-1 font-mono font-bold text-xs mt-0.5">
                          {standing?.total_points?.toLocaleString("da-DK") || 0}
                        </p>
                      </div>
                      <div className="bg-cz-subtle rounded-lg p-2 text-center">
                        <p className="text-cz-3 text-[9px] uppercase tracking-wider">Etapesejre</p>
                        <p className="text-cz-1 font-mono font-bold text-xs mt-0.5">
                          {standing?.stage_wins || 0}
                        </p>
                      </div>
                      <div className="bg-cz-subtle rounded-lg p-2 text-center">
                        <p className="text-cz-3 text-[9px] uppercase tracking-wider">GC-sejre</p>
                        <p className="text-cz-1 font-mono font-bold text-xs mt-0.5">
                          {standing?.gc_wins || 0}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">◈</p>
          <p>Ingen hold matcher din søgning</p>
        </div>
      )}
    </div>
  );
}
