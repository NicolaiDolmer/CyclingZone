import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

function DivisionTable({ division, standings, myTeamId }) {
  const divNames = { 1: "Division 1", 2: "Division 2", 3: "Division 3" };
  const divColors = { 1: "#e8c547", 2: "#60a5fa", 3: "#a78bfa" };
  const color = divColors[division];
  const sorted = [...standings].filter(s => s.division === division).sort((a, b) => b.total_points - a.total_points);
  if (!sorted.length) return null;

  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5" style={{ borderLeft: `3px solid ${color}` }}>
        <span className="font-bold text-white text-sm">{divNames[division]}</span>
        <span className="text-white/30 text-xs">{sorted.length} hold</span>
        {division > 1 && <span className="ml-auto text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider">Top 2 rykker op</span>}
        {division < 3 && <span className={`${division > 1 ? "" : "ml-auto"} text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full uppercase tracking-wider`}>Bund 2 rykker ned</span>}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5">
            <th className="px-4 py-2.5 text-left text-white/30 font-medium text-xs uppercase w-8">#</th>
            <th className="px-4 py-2.5 text-left text-white/30 font-medium text-xs uppercase">Hold</th>
            <th className="px-4 py-2.5 text-right text-white/30 font-medium text-xs uppercase">Point</th>
            <th className="px-4 py-2.5 text-right text-white/30 font-medium text-xs uppercase hidden sm:table-cell">Etapesejre</th>
            <th className="px-4 py-2.5 text-right text-white/30 font-medium text-xs uppercase hidden sm:table-cell">GC-sejre</th>
            <th className="px-4 py-2.5 text-right text-white/30 font-medium text-xs uppercase hidden md:table-cell">Løb</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s, i) => {
            const isMe = s.team_id === myTeamId;
            const isPromotion = division > 1 && i < 2;
            const isRelegation = division < 3 && i >= sorted.length - 2;
            return (
              <tr key={s.id} className={`border-b border-white/4 transition-colors ${isMe ? "bg-[#e8c547]/5" : "hover:bg-white/3"}`}>
                <td className="px-4 py-3">
                  <span className={`font-mono text-sm font-bold ${isPromotion ? "text-green-400" : isRelegation ? "text-red-400" : "text-white/40"}`}>
                    {i + 1}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {isMe && <span className="w-1.5 h-1.5 rounded-full bg-[#e8c547]" />}
                    <span className={`font-medium ${isMe ? "text-[#e8c547]" : "text-white"}`}>{s.team?.name || "Ukendt"}</span>
                    {s.team?.is_ai && <span className="text-[9px] uppercase text-white/20 bg-white/5 px-1.5 py-0.5 rounded">AI</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold" style={{ color }}>{s.total_points?.toLocaleString("da-DK") || 0}</td>
                <td className="px-4 py-3 text-right text-white/50 hidden sm:table-cell">{s.stage_wins || 0}</td>
                <td className="px-4 py-3 text-right text-white/50 hidden sm:table-cell">{s.gc_wins || 0}</td>
                <td className="px-4 py-3 text-right text-white/30 hidden md:table-cell">{s.races_completed || 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function StandingsPage() {
  const [standings, setStandings] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [myTeamId, setMyTeamId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [seasonInfo, setSeasonInfo] = useState(null);

  useEffect(() => { loadMyTeam(); loadSeasons(); }, []);
  useEffect(() => { if (selectedSeason) loadStandings(selectedSeason); }, [selectedSeason]);

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (t) setMyTeamId(t.id);
  }

  async function loadSeasons() {
    const { data } = await supabase.from("seasons").select("*").order("number", { ascending: false });
    setSeasons(data || []);
    if (data?.length) { setSelectedSeason(data[0].id); setSeasonInfo(data[0]); }
  }

  async function loadStandings(seasonId) {
    setLoading(true);
    const { data } = await supabase
      .from("season_standings")
      .select("*, team:team_id(id, name, is_ai)")
      .eq("season_id", seasonId)
      .order("total_points", { ascending: false });
    setStandings(data || []);
    setLoading(false);
  }

  const totalPoints = standings.reduce((s, r) => s + (r.total_points || 0), 0);
  const myStanding = standings.find(s => s.team_id === myTeamId);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Rangliste</h1>
          <p className="text-white/30 text-sm">
            {seasonInfo ? `Sæson ${seasonInfo.number} — ${seasonInfo.status === "active" ? "Aktiv" : seasonInfo.status === "completed" ? "Afsluttet" : "Kommende"}` : ""}
          </p>
        </div>
        {seasons.length > 0 && (
          <select value={selectedSeason || ""} onChange={e => { setSelectedSeason(e.target.value); setSeasonInfo(seasons.find(s => s.id === e.target.value)); }}
            className="bg-[#0f0f18] border border-white/8 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
            {seasons.map(s => <option key={s.id} value={s.id}>Sæson {s.number}</option>)}
          </select>
        )}
      </div>

      {/* My position highlight */}
      {myStanding && (
        <div className="bg-[#e8c547]/5 border border-[#e8c547]/15 rounded-xl p-4 mb-5 flex items-center justify-between">
          <div>
            <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Din placering</p>
            <p className="text-white font-bold">Division {myStanding.division} — #{standings.filter(s => s.division === myStanding.division).sort((a,b) => b.total_points - a.total_points).findIndex(s => s.team_id === myTeamId) + 1}</p>
          </div>
          <div className="flex gap-4 text-center">
            <div><p className="text-white/30 text-xs">Point</p><p className="text-[#e8c547] font-mono font-bold">{myStanding.total_points?.toLocaleString("da-DK") || 0}</p></div>
            <div><p className="text-white/30 text-xs">Etapesejre</p><p className="text-white font-mono font-bold">{myStanding.stage_wins || 0}</p></div>
            <div><p className="text-white/30 text-xs">GC-sejre</p><p className="text-white font-mono font-bold">{myStanding.gc_wins || 0}</p></div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : standings.length === 0 ? (
        <div className="text-center py-16 text-white/20">
          <p className="text-4xl mb-3">◈</p>
          <p>Ingen rangliste data endnu</p>
          <p className="text-sm mt-2">Importer løbsresultater for at se standings</p>
        </div>
      ) : (
        <div>
          {[1, 2, 3].map(div => <DivisionTable key={div} division={div} standings={standings} myTeamId={myTeamId} />)}
        </div>
      )}
    </div>
  );
}
