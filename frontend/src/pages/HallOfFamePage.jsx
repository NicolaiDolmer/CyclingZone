import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const CATEGORIES = [
  { key: "most_points_season", label: "Flest point i én sæson", icon: "🏆", unit: "point", color: "#e8c547" },
  { key: "most_stage_wins_season", label: "Flest etapesejre i én sæson", icon: "⚡", unit: "sejre", color: "#60a5fa" },
  { key: "most_div1_titles", label: "Flest Division 1 titler", icon: "👑", unit: "titler", color: "#a78bfa" },
];

const LEVEL_TITLES = [
  { min: 1,  max: 4,  title: "Rookie",      color: "#9ca3af" },
  { min: 5,  max: 9,  title: "Amateur",     color: "#6b7280" },
  { min: 10, max: 14, title: "Continental", color: "#34d399" },
  { min: 15, max: 19, title: "Pro",         color: "#60a5fa" },
  { min: 20, max: 24, title: "Pro Team",    color: "#818cf8" },
  { min: 25, max: 29, title: "WorldTour",   color: "#e8c547" },
  { min: 30, max: 34, title: "Monument",    color: "#f97316" },
  { min: 35, max: 39, title: "GC Contender",color: "#ef4444" },
  { min: 40, max: 44, title: "Grand Tour",  color: "#ec4899" },
  { min: 45, max: 50, title: "Legende",     color: "#e8c547" },
];

export function getLevelInfo(level) {
  return LEVEL_TITLES.find(l => level >= l.min && level <= l.max) || LEVEL_TITLES[0];
}

export default function HallOfFamePage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState({});
  const [standings, setStandings] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("hof");
  const [myUserId, setMyUserId] = useState(null);
  const [myTeamId, setMyTeamId] = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setMyUserId(user.id);
    const { data: myTeamData } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (myTeamData) setMyTeamId(myTeamData.id);
    const [hofRes, standingsRes, managersRes] = await Promise.all([
      supabase.from("hall_of_fame").select("*, team:team_id(id, name)").order("value", { ascending: false }),
      supabase.from("season_standings")
        .select("*, team:team_id(id, name, is_ai), season:season_id(number)")
        .order("total_points", { ascending: false }),
      supabase.from("teams")
        .select("id, name, division, user:user_id(id, username, level, xp, role)")
        .eq("is_ai", false)
        .order("name"),
    ]);

    // Group HoF by category
    const grouped = {};
    (hofRes.data || []).forEach(r => {
      if (!grouped[r.category]) grouped[r.category] = [];
      grouped[r.category].push(r);
    });
    setRecords(grouped);
    setStandings(standingsRes.data || []);
    // Flatten team + user data for managers tab
    setManagers((managersRes.data || [])
      .map(t => ({ ...t.user, team_name: t.name, team_division: t.division }))
      .filter(m => m.username)
      .sort((a, b) => (b.level || 1) - (a.level || 1) || (b.xp || 0) - (a.xp || 0)));
    setLoading(false);
  }

  // Calculate all-time stats from standings if no HoF records yet
  function getBestFromStandings(category) {
    if (records[category]?.length) return records[category].slice(0, 5);
    if (category === "most_points_season") {
      return standings
        .filter(s => !s.team?.is_ai)
        .sort((a, b) => b.total_points - a.total_points)
        .slice(0, 5)
        .map(s => ({
          team_name: s.team?.name,
          team: s.team,
          value: s.total_points || 0,
          season_number: s.season?.number,
        }));
    }
    if (category === "most_stage_wins_season") {
      return standings
        .filter(s => !s.team?.is_ai)
        .sort((a, b) => (b.stage_wins || 0) - (a.stage_wins || 0))
        .slice(0, 5)
        .map(s => ({
          team_name: s.team?.name,
          team: s.team,
          value: s.stage_wins || 0,
          season_number: s.season?.number,
        }));
    }
    return [];
  }

  // Division history from standings
  const divHistory = {};
  standings.filter(s => !s.team?.is_ai && s.division === 1).forEach(s => {
    const key = s.season?.number;
    if (!divHistory[key]) divHistory[key] = [];
    divHistory[key].push(s);
  });

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Hall of Fame</h1>
        <p className="text-white/30 text-sm">Historiske rekorder og manager statistik</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { key: "hof", label: "🏆 Rekorder" },
          { key: "managers", label: "👤 Managers" },
          { key: "divhistory", label: "◉ Divisionshistorik" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${tab === t.key ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20" : "text-white/40 hover:text-white bg-[#0f0f18] border-white/5"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Records tab */}
      {tab === "hof" && (
        <div className="flex flex-col gap-6">
          {CATEGORIES.map(cat => {
            const entries = getBestFromStandings(cat.key);
            return (
              <div key={cat.key} className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5"
                  style={{ borderLeft: `3px solid ${cat.color}` }}>
                  <span className="text-xl">{cat.icon}</span>
                  <h2 className="text-white font-semibold text-sm">{cat.label}</h2>
                </div>
                {entries.length === 0 ? (
                  <div className="px-5 py-8 text-center text-white/20 text-sm">
                    Ingen rekorder endnu — spil sæsoner for at sætte rekorder
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {entries.map((e, i) => (
                        <tr key={i} className="border-b border-white/4 last:border-0 hover:bg-white/3">
                          <td className="px-5 py-3 w-8">
                            <span className={`font-mono font-bold text-sm
                              ${i === 0 ? "text-[#e8c547]" : i === 1 ? "text-white/60" : i === 2 ? "text-orange-400/60" : "text-white/30"}`}>
                              #{i + 1}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <p className="text-white font-medium cursor-pointer hover:text-[#e8c547]"
                              onClick={() => e.team?.id && navigate(`/teams/${e.team.id}`)}>
                              {e.team_name || e.team?.name || "—"}
                            </p>
                            {e.season_number && (
                              <p className="text-white/30 text-xs">Sæson {e.season_number}</p>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className="font-mono font-bold text-lg" style={{ color: cat.color }}>
                              {e.value?.toLocaleString("da-DK")}
                            </span>
                            <span className="text-white/30 text-xs ml-1">{cat.unit}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Managers tab */}
      {tab === "managers" && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase">#</th>
                <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase">Manager</th>
                <th className="px-4 py-3 text-left text-white/30 font-medium text-xs uppercase">Titel</th>
                <th className="px-4 py-3 text-right text-white/30 font-medium text-xs uppercase">Niveau</th>
                <th className="px-4 py-3 text-right text-white/30 font-medium text-xs uppercase">XP</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((m, i) => {
                const isMe = m.id === myUserId;
                const levelInfo = getLevelInfo(m.level || 1);
                const xpForNext = (m.level || 1) * 100;
                const xpProgress = ((m.xp || 0) % 100);
                return (
                  <tr key={m.id} className="border-b border-white/4 hover:bg-white/3">
                    <td className="px-4 py-3 text-white/40 font-mono text-sm">#{i + 1}</td>
                    <td className="px-4 py-3 text-white font-medium">{m.username || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/5"
                        style={{ color: levelInfo.color }}>
                        {levelInfo.title}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono font-bold" style={{ color: levelInfo.color }}>
                        {m.level || 1}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-white/5 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-[#e8c547]"
                            style={{ width: `${Math.min(xpProgress, 100)}%` }} />
                        </div>
                        <span className="text-white/40 font-mono text-xs">{m.xp || 0}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Division history tab */}
      {tab === "divhistory" && (
        <div>
          {Object.keys(divHistory).length === 0 ? (
            <div className="text-center py-16 text-white/20">
              <p className="text-4xl mb-3">◉</p>
              <p>Ingen divisionshistorik endnu</p>
              <p className="text-sm mt-2">Afslut sæsoner for at se historik</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {Object.entries(divHistory).sort((a, b) => parseInt(b[0]) - parseInt(a[0])).map(([season, entries]) => (
                <div key={season} className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-white/5 flex items-center gap-2">
                    <span className="text-[#e8c547] font-bold text-sm">Sæson {season}</span>
                    <span className="text-white/30 text-xs">Division 1</span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {entries.sort((a, b) => b.total_points - a.total_points).map((s, i) => (
                        <tr key={s.id} className="border-b border-white/4 last:border-0 hover:bg-white/3">
                          <td className="px-5 py-2.5 w-8">
                            <span className={`font-mono font-bold ${i === 0 ? "text-[#e8c547]" : "text-white/40"}`}>
                              #{i + 1}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-white font-medium cursor-pointer hover:text-[#e8c547]"
                              onClick={() => s.team?.id && navigate(`/teams/${s.team.id}`)}>
                              {s.team?.name}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right text-[#e8c547] font-mono font-bold">
                            {s.total_points?.toLocaleString("da-DK")} pt
                          </td>
                          <td className="px-5 py-2.5 text-right text-white/40 text-xs">
                            {s.stage_wins || 0} etapesejre
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
