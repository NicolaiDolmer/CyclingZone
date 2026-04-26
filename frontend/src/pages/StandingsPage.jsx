import { useState, useEffect, Fragment } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const DIV_COLORS = { 1: "#e8c547", 2: "#60a5fa", 3: "#a78bfa" };

function MiniSparkline({ points, color }) {
  if (!points || points.length < 2) return <span className="text-slate-300 text-xs">—</span>;
  const max = Math.max(...points, 1);
  const w = 60, h = 24, p = 2;
  const pts = points.map((v, i) => {
    const x = p + (i / (points.length - 1)) * (w - p * 2);
    const y = h - p - (v / max) * (h - p * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
}

function FormBadge({ form }) {
  // form = array of recent results e.g. [1,5,2,null] — rank in last races
  if (!form || !form.length) return null;
  return (
    <div className="flex gap-0.5">
      {form.slice(-5).map((rank, i) => {
        const color = rank === 1 ? "bg-[#e8c547]" : rank <= 3 ? "bg-green-400" : rank <= 10 ? "bg-blue-300" : "bg-slate-100";
        return <span key={i} className={`w-2 h-2 rounded-full ${color}`} title={rank ? `#${rank}` : "—"} />;
      })}
    </div>
  );
}

export default function StandingsPage() {
  const navigate = useNavigate();
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [divTab, setDivTab] = useState(1);
  const [myTeamId, setMyTeamId] = useState(null);
  const [season, setSeason] = useState(null);
  const [racePoints, setRacePoints] = useState({});
  const [races, setRaces] = useState([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: myTeam } = await supabase.from("teams").select("id, division").eq("user_id", user.id).single();
    setMyTeamId(myTeam?.id);
    if (myTeam?.division) setDivTab(myTeam.division);

    const { data: activeSeason } = await supabase.from("seasons").select("*").eq("status", "active").single();
    setSeason(activeSeason);

    const [teamsRes, standingsRes, racesRes] = await Promise.all([
      supabase.from("teams").select("id, name, division").eq("is_ai", false).order("division").order("name"),
      activeSeason
        ? supabase.from("season_standings")
            .select("*, team:team_id(id, name, division, is_ai)")
            .eq("season_id", activeSeason.id)
            .order("total_points", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from("races")
        .select("id, name, start_date")
        .eq("season_id", activeSeason?.id || "")
        .order("start_date"),
    ]);

    // Index actual standings by team_id
    const standingsMap = {};
    (standingsRes.data || []).filter(s => !s.team?.is_ai).forEach(s => {
      standingsMap[s.team_id] = s;
    });

    // All human teams, merged with standings (0 points as fallback)
    const merged = (teamsRes.data || []).map(team => (
      standingsMap[team.id] || { id: team.id, team_id: team.id, team, total_points: 0, stage_wins: 0, podiums: 0 }
    ));

    setStandings(merged);
    setRaces(racesRes.data || []);

    // Build race-by-race point progression
    if (racesRes.data?.length && merged.length) {
      const { data: results } = await supabase
        .from("race_results")
        .select("rider:rider_id(team_id), prize_money, race_id")
        .in("race_id", racesRes.data.map(r => r.id));

      const prog = {};
      const cumul = {};
      merged.forEach(s => { prog[s.team_id] = []; cumul[s.team_id] = 0; });

      racesRes.data.forEach(race => {
        const rr = (results || []).filter(r => r.race_id === race.id);
        const pts = {};
        rr.forEach(r => {
          if (r.rider?.team_id) pts[r.rider.team_id] = (pts[r.rider.team_id] || 0) + (r.prize_money || 0);
        });
        merged.forEach(s => {
          cumul[s.team_id] = (cumul[s.team_id] || 0) + (pts[s.team_id] || 0);
          prog[s.team_id].push(cumul[s.team_id]);
        });
      });
      setRacePoints(prog);
    }
    setLoading(false);
  }

  const divStandings = standings
    .filter(s => s.team?.division === divTab)
    .sort((a, b) => (b.total_points || 0) - (a.total_points || 0));

  const maxPts = divStandings[0]?.total_points || 1;
  const color = DIV_COLORS[divTab] || "#e8c547";
  const divCounts = [1, 2, 3].map(d => ({
    div: d,
    count: standings.filter(s => s.team?.division === d).length,
  }));

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Rangliste</h1>
          <p className="text-slate-400 text-sm">
            {season ? `Sæson ${season.number}` : "Ingen aktiv sæson"}
          </p>
        </div>
      </div>

      {/* Division tabs */}
      <div className="flex gap-2 mb-5">
        {divCounts.map(({ div, count }) => (
          <button key={div} onClick={() => setDivTab(div)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border
              ${divTab === div
                ? "border-opacity-30 text-slate-900"
                : "bg-white text-slate-500 border-slate-200 hover:text-slate-900"}`}
            style={divTab === div ? { backgroundColor: `${DIV_COLORS[div]}15`, borderColor: `${DIV_COLORS[div]}40`, color: DIV_COLORS[div] } : {}}>
            Division {div}
            <span className="ml-2 text-[10px] opacity-60">({count})</span>
          </button>
        ))}
      </div>

      {divStandings.length === 0 ? (
        <div className="text-center py-16 text-slate-300">
          <p className="text-4xl mb-3">◉</p>
          <p>Ingen data for Division {divTab} endnu</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs w-8">#</th>
                  <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs">Hold</th>
                  <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs hidden sm:table-cell">Etapesejre</th>
                  <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs hidden md:table-cell">Podier</th>
                  <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs">Point</th>
                  <th className="px-4 py-3 text-right text-slate-400 font-medium text-xs hidden lg:table-cell w-20">Udvikling</th>
                </tr>
              </thead>
              <tbody>
                {divStandings.map((s, i) => {
                  const isMe = s.team_id === myTeamId;
                  const prog = racePoints[s.team_id] || [];
                  const ptsWidth = Math.round(((s.total_points || 0) / maxPts) * 100);
                  const isPromotion = i < 2 && divTab < 3;
                  const isRelegation = i >= divStandings.length - 2 && divTab > 1;
                  const rowStyle = isPromotion
                    ? { boxShadow: "inset 3px 0 0 #4ade80" }
                    : isRelegation
                    ? { boxShadow: "inset 3px 0 0 #f87171" }
                    : {};
                  return (
                    <Fragment key={s.id}>
                      {/* Separator before relegation zone */}
                      {i === divStandings.length - 2 && divTab > 1 && divStandings.length > 4 && (
                        <tr aria-hidden="true">
                          <td colSpan={6} style={{ padding: 0, lineHeight: 0, border: 0 }}>
                            <div style={{ height: 2, background: "linear-gradient(to right, #fca5a5 40%, transparent)" }} />
                          </td>
                        </tr>
                      )}
                      <tr
                        onClick={() => navigate(`/teams/${s.team_id}`)}
                        style={rowStyle}
                        className={`border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 transition-colors
                          ${isMe ? "bg-amber-50/60" : ""}
                          ${isPromotion && !isMe ? "bg-emerald-50" : ""}
                          ${isRelegation && !isMe ? "bg-red-50" : ""}`}>
                        <td className="px-4 py-3.5">
                          <span className={`font-mono font-bold text-sm
                            ${i === 0 ? "text-amber-700" : i === 1 ? "text-slate-500" : i === 2 ? "text-slate-500" : "text-slate-400"}`}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-medium ${isMe ? "text-amber-700" : "text-slate-900"}`}>{s.team?.name}</span>
                            {isMe && <span className="text-[9px] uppercase bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">Dig</span>}
                            {isPromotion && <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">↑ Op</span>}
                            {isRelegation && <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">↓ Ned</span>}
                          </div>
                          {/* Mini progress bar */}
                          <div className="mt-1.5 bg-slate-100 rounded-full h-1 w-full max-w-32">
                            <div className="h-1 rounded-full" style={{ width: `${ptsWidth}%`, backgroundColor: isMe ? "#e8c547" : `${color}60` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-500 hidden sm:table-cell font-mono">{s.stage_wins || 0}</td>
                        <td className="px-4 py-3.5 text-right text-slate-500 hidden md:table-cell font-mono">{s.podiums || 0}</td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="font-mono font-bold" style={{ color: isMe ? "#e8c547" : color }}>
                            {(s.total_points || 0).toLocaleString("da-DK")}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right hidden lg:table-cell">
                          <MiniSparkline points={prog} color={isMe ? "#e8c547" : color} />
                        </td>
                      </tr>
                      {/* Separator after promotion zone */}
                      {i === 1 && divTab < 3 && divStandings.length > 2 && (
                        <tr aria-hidden="true">
                          <td colSpan={6} style={{ padding: 0, lineHeight: 0, border: 0 }}>
                            <div style={{ height: 2, background: "linear-gradient(to right, #86efac 40%, transparent)" }} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-slate-200 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-green-700/70">
              <span className="w-2 h-2 rounded-sm bg-green-100 border border-green-200" />
              Oprykningszone (top 2)
            </div>
            {divTab > 1 && (
              <div className="flex items-center gap-1.5 text-xs text-red-700/70">
                <span className="w-2 h-2 rounded-sm bg-red-100 border border-red-200" />
                Nedrykningszone (bund 2)
              </div>
            )}
            <div className="ml-auto text-xs text-slate-300">
              {races.length} løb spillet
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
