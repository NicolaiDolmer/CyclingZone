import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const DIV_COLORS = { 1: "#e8c547", 2: "#60a5fa", 3: "#a78bfa" };

function MiniLineChart({ data, color }) {
  if (!data || data.length < 2) return <span className="text-slate-300 text-xs">—</span>;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80, h = 30, pad = 3;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts.split(" ").pop().split(",")[0]} cy={pts.split(" ").pop().split(",")[1]}
        r="2.5" fill={color} />
    </svg>
  );
}

export default function SeasonEndPage() {
  const navigate = useNavigate();
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [standings, setStandings] = useState([]);
  const [races, setRaces] = useState([]);
  const [pointsByTeam, setPointsByTeam] = useState({});
  const [myTeamId, setMyTeamId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    setMyTeamId(myTeam?.id);

    const { data: seasonsData } = await supabase.from("seasons")
      .select("*").order("number", { ascending: false });
    setSeasons(seasonsData || []);

    const latest = seasonsData?.[0];
    if (latest) await loadSeason(latest);
    setLoading(false);
  }

  async function loadSeason(season) {
    setSelectedSeason(season);
    const [standingsRes, racesRes] = await Promise.all([
      supabase.from("season_standings")
        .select("*, team:team_id(id, name, division, is_ai)")
        .eq("season_id", season.id)
        .order("division").order("total_points", { ascending: false }),
      supabase.from("races")
        .select("id, name, start_date")
        .eq("season_id", season.id)
        .order("start_date"),
    ]);

    const standings = (standingsRes.data || []).filter(s => !s.team?.is_ai);
    setStandings(standings);
    setRaces(racesRes.data || []);

    // Build point progression per team per race
    if (racesRes.data?.length) {
      const { data: results } = await supabase
        .from("race_results")
        .select("rider:rider_id(team_id), prize_money, race_id")
        .in("race_id", racesRes.data.map(r => r.id));

      const prog = {};
      standings.forEach(s => { prog[s.team_id] = []; });

      let cumulative = {};
      standings.forEach(s => { cumulative[s.team_id] = 0; });

      racesRes.data.forEach(race => {
        const raceResults = (results || []).filter(r => r.race_id === race.id);
        const racePoints = {};
        raceResults.forEach(r => {
          if (r.rider?.team_id) {
            racePoints[r.rider.team_id] = (racePoints[r.rider.team_id] || 0) + (r.prize_money || 0);
          }
        });
        standings.forEach(s => {
          cumulative[s.team_id] = (cumulative[s.team_id] || 0) + (racePoints[s.team_id] || 0);
          if (prog[s.team_id]) prog[s.team_id].push(cumulative[s.team_id]);
        });
      });

      setPointsByTeam(prog);
    }
  }

  // Group standings by division
  const byDiv = standings.reduce((acc, s) => {
    const div = s.team?.division || 3;
    if (!acc[div]) acc[div] = [];
    acc[div].push(s);
    return acc;
  }, {});

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Sæsonresultater</h1>
          <p className="text-slate-400 text-sm">Slutstillinger, op/nedrykning og pointudvikling</p>
        </div>
        <select
          value={selectedSeason?.id || ""}
          onChange={e => {
            const s = seasons.find(s => s.id === e.target.value);
            if (s) loadSeason(s);
          }}
          className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none">
          {seasons.map(s => (
            <option key={s.id} value={s.id}>
              Sæson {s.number} — {s.status === "active" ? "Igangværende" : "Afsluttet"}
            </option>
          ))}
        </select>
      </div>

      {standings.length === 0 ? (
        <div className="text-center py-20 text-slate-300">
          <p className="text-5xl mb-4">🏁</p>
          <p className="text-lg font-medium text-slate-400">Ingen resultater endnu</p>
          <p className="text-sm mt-2">Afslut løb og sæsoner for at se resultater her</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {[1, 2, 3].map(div => {
            const divStandings = byDiv[div] || [];
            if (!divStandings.length) return null;
            const color = DIV_COLORS[div];
            const isCompleted = selectedSeason?.status === "completed";
            return (
              <div key={div} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200"
                  style={{ borderLeft: `3px solid ${color}` }}>
                  <h2 className="font-bold text-sm" style={{ color }}>Division {div}</h2>
                  {isCompleted && div < 3 && (
                    <span className="text-xs text-slate-400">Top 2 rykker op ↑</span>
                  )}
                  {isCompleted && div > 1 && (
                    <span className="text-xs text-slate-400">Bund 2 rykker ned ↓</span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-4 py-2.5 text-left text-slate-400 font-medium text-xs w-8">#</th>
                      <th className="px-4 py-2.5 text-left text-slate-400 font-medium text-xs">Hold</th>
                      <th className="px-4 py-2.5 text-right text-slate-400 font-medium text-xs hidden sm:table-cell">Etapesejre</th>
                      <th className="px-4 py-2.5 text-right text-slate-400 font-medium text-xs">Point</th>
                      <th className="px-4 py-2.5 text-right text-slate-400 font-medium text-xs hidden md:table-cell">Udvikling</th>
                    </tr>
                  </thead>
                  <tbody>
                    {divStandings.map((s, i) => {
                      const isMe = s.team_id === myTeamId;
                      const isPromotion = isCompleted && i < 2 && div < 3;
                      const isRelegation = isCompleted && i >= divStandings.length - 2 && div > 1;
                      const prog = pointsByTeam[s.team_id] || [];
                      return (
                        <tr key={s.id}
                          className={`border-b border-slate-100 last:border-0 hover:bg-slate-100 cursor-pointer
                            ${isPromotion ? "bg-green-500/3" : ""}
                            ${isRelegation ? "bg-red-500/3" : ""}
                            ${isMe ? "bg-[#e8c547]/3" : ""}`}
                          onClick={() => navigate(`/teams/${s.team_id}`)}>
                          <td className="px-4 py-3">
                            <span className={`font-mono font-bold text-sm
                              ${i === 0 ? "text-amber-700" : i === 1 ? "text-slate-500" : "text-slate-400"}`}>
                              #{i + 1}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`font-medium ${isMe ? "text-amber-700" : "text-slate-900"}`}>
                                {s.team?.name}
                              </span>
                              {isMe && <span className="text-[9px] uppercase bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">Dig</span>}
                              {isPromotion && <span className="text-[9px] text-green-700">↑ Op</span>}
                              {isRelegation && <span className="text-[9px] text-red-700">↓ Ned</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-500 hidden sm:table-cell">
                            {s.stage_wins || 0}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-mono font-bold" style={{ color }}>
                              {s.total_points?.toLocaleString("da-DK") || 0}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right hidden md:table-cell">
                            <MiniLineChart data={prog} color={color} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}

          {/* Full point progression for my team */}
          {myTeamId && pointsByTeam[myTeamId]?.length > 1 && races.length > 1 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-slate-900 font-semibold text-sm mb-4">Dit holds pointudvikling</h2>
              <PointChart
                data={pointsByTeam[myTeamId]}
                labels={races.map(r => r.name)}
                color="#e8c547" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PointChart({ data, labels, color }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 100, h = 80, padX = 5, padY = 8;
  const pts = data.map((v, i) => {
    const x = padX + (i / (data.length - 1)) * (w - padX * 2);
    const y = h - padY - (v / max) * (h - padY * 2);
    return { x, y, v, label: labels[i] };
  });
  const polyline = pts.map(p => `${p.x},${p.y}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <line key={t} x1={padX} x2={w - padX}
            y1={padY + t * (h - padY * 2)} y2={padY + t * (h - padY * 2)}
            stroke="rgba(0,0,0,0.06)" strokeWidth="0.5" />
        ))}
        {/* Area fill */}
        <polygon
          points={`${pts[0].x},${h - padY} ${polyline} ${pts[pts.length-1].x},${h - padY}`}
          fill={color} fillOpacity="0.08" />
        {/* Line */}
        <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots */}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2" fill={color} />
        ))}
      </svg>
      {/* X-axis labels */}
      <div className="flex justify-between mt-1 px-1">
        {labels.map((l, i) => (
          <span key={i} className="text-[8px] text-slate-300 truncate max-w-16 text-center"
            style={{ width: `${100 / labels.length}%` }}>
            {l.length > 8 ? l.slice(0, 8) + "…" : l}
          </span>
        ))}
      </div>
      {/* Values */}
      <div className="flex justify-between mt-2">
        {data.map((v, i) => (
          <span key={i} className="text-[9px] font-mono text-center"
            style={{ color, width: `${100 / data.length}%` }}>
            {v > 0 ? v.toLocaleString("da-DK") : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
