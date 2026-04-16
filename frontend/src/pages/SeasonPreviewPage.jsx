import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];

export default function SeasonPreviewPage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState(null);
  const [myTeamId, setMyTeamId] = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (myTeam) setMyTeamId(myTeam.id);

    const [teamsRes, ridersRes, seasonRes] = await Promise.all([
      supabase.from("teams").select("id, name, division, sponsor_income").eq("is_ai", false).order("division").order("name"),
      supabase.from("riders").select("id, team_id, uci_points, is_u25, stat_bj, stat_sp, stat_tt, stat_fl").not("team_id", "is", null),
      supabase.from("seasons").select("*").eq("status", "active").single(),
    ]);

    const ridersByTeam = {};
    (ridersRes.data || []).forEach(r => {
      if (!ridersByTeam[r.team_id]) ridersByTeam[r.team_id] = [];
      ridersByTeam[r.team_id].push(r);
    });

    const enriched = (teamsRes.data || []).map(t => {
      const riders = ridersByTeam[t.id] || [];
      const totalValue = riders.reduce((s, r) => s + (r.uci_points || 0), 0);
      const avgBj = riders.length ? Math.round(riders.reduce((s, r) => s + (r.stat_bj || 0), 0) / riders.length) : 0;
      const avgSp = riders.length ? Math.round(riders.reduce((s, r) => s + (r.stat_sp || 0), 0) / riders.length) : 0;
      const avgTt = riders.length ? Math.round(riders.reduce((s, r) => s + (r.stat_tt || 0), 0) / riders.length) : 0;
      const u25Count = riders.filter(r => r.is_u25).length;
      const topRider = riders.sort((a, b) => b.uci_points - a.uci_points)[0];
      return { ...t, riders, totalValue, avgBj, avgSp, avgTt, u25Count, topRider, riderCount: riders.length };
    });

    // Sort by total value for strength ranking
    const ranked = [...enriched].sort((a, b) => b.totalValue - a.totalValue);
    const maxValue = ranked[0]?.totalValue || 1;

    setTeams(ranked.map((t, i) => ({ ...t, rank: i + 1, strengthPct: Math.round((t.totalValue / maxValue) * 100) })));
    setSeason(seasonRes.data);
    setLoading(false);
  }

  const DIV_COLORS = { 1: "#e8c547", 2: "#60a5fa", 3: "#a78bfa" };

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Sæson Preview</h1>
        <p className="text-white/30 text-sm">
          {season ? `Sæson ${season.number} — Hold styrker og spådomme` : "Ingen aktiv sæson"}
        </p>
      </div>

      {/* Strength overview */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-5">
        <h2 className="text-white font-semibold text-sm mb-4">Holdstyrker — baseret på samlet holdværdi</h2>
        <div className="flex flex-col gap-3">
          {teams.map(t => {
            const isMe = t.id === myTeamId;
            const color = DIV_COLORS[t.division] || "#e8c547";
            return (
              <div key={t.id} className={`flex items-center gap-3 ${isMe ? "opacity-100" : "opacity-80"}`}>
                <span className="text-white/30 font-mono text-xs w-5 text-right">{t.rank}</span>
                <div className="w-28 flex-shrink-0">
                  <p className={`text-sm font-medium truncate cursor-pointer hover:text-[#e8c547] ${isMe ? "text-[#e8c547]" : "text-white"}`}
                    onClick={() => navigate(`/teams/${t.id}`)}>
                    {t.name}
                  </p>
                  <p className="text-[9px] uppercase tracking-wider" style={{ color: `${color}80` }}>Div {t.division}</p>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-white/5 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all duration-500"
                        style={{ width: `${t.strengthPct}%`, backgroundColor: color }} />
                    </div>
                    <span className="text-white/40 font-mono text-xs w-20 text-right flex-shrink-0">
                      {t.totalValue.toLocaleString("da-DK")} CZ$
                    </span>
                  </div>
                </div>
                <div className="hidden sm:flex gap-3 flex-shrink-0 text-center">
                  {[
                    { label: "BJ", value: t.avgBj },
                    { label: "SP", value: t.avgSp },
                    { label: "TT", value: t.avgTt },
                  ].map(s => (
                    <div key={s.label} className="w-10">
                      <p className="text-[9px] text-white/20 uppercase">{s.label}</p>
                      <p className={`font-mono text-xs font-bold ${s.value >= 75 ? "text-[#e8c547]" : "text-white/50"}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Team cards */}
      <div className="grid sm:grid-cols-2 gap-4">
        {teams.map(t => {
          const isMe = t.id === myTeamId;
          const color = DIV_COLORS[t.division] || "#e8c547";
          return (
            <div key={t.id}
              className={`bg-[#0f0f18] border rounded-xl p-5 cursor-pointer hover:border-white/15 transition-all
                ${isMe ? "border-[#e8c547]/25" : "border-white/5"}`}
              onClick={() => navigate(`/teams/${t.id}`)}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className={`font-bold text-sm ${isMe ? "text-[#e8c547]" : "text-white"}`}>{t.name}</p>
                    {isMe && <span className="text-[9px] uppercase bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20 px-1.5 py-0.5 rounded-full">Dig</span>}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: `${color}80` }}>Division {t.division} — #{t.rank} styrke</p>
                </div>
                <span className="text-2xl font-bold font-mono" style={{ color }}>#{t.rank}</span>
              </div>

              <div className="grid grid-cols-4 gap-2 mb-4">
                {[
                  { label: "Ryttere", value: t.riderCount },
                  { label: "U25", value: t.u25Count, color: "#60a5fa" },
                  { label: "Avg BJ", value: t.avgBj, color: t.avgBj >= 75 ? "#e8c547" : undefined },
                  { label: "Avg SP", value: t.avgSp, color: t.avgSp >= 75 ? "#e8c547" : undefined },
                ].map(s => (
                  <div key={s.label} className="bg-white/3 rounded-lg p-2 text-center">
                    <p className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">{s.label}</p>
                    <p className="font-mono font-bold text-sm" style={{ color: s.color || "white" }}>{s.value}</p>
                  </div>
                ))}
              </div>

              {t.topRider && (
                <div className="flex items-center gap-2 bg-white/3 rounded-lg px-3 py-2">
                  <span className="text-white/30 text-xs">Topstjerne:</span>
                  <span className="text-white text-xs font-medium">
                    {t.topRider.firstname} {t.topRider.lastname}
                  </span>
                  <span className="text-[#e8c547] font-mono text-xs ml-auto">
                    {t.topRider.uci_points?.toLocaleString("da-DK")} CZ$
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
