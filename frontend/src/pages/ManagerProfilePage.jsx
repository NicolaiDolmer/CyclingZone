import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

function timeAgo(dateStr) {
  if (!dateStr) return "aldrig";
  const diff = Date.now() - new Date(dateStr).getTime();
  const min  = Math.floor(diff / 60000);
  if (min < 1)  return "online nu";
  if (min < 60) return `${min} min siden`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}t siden`;
  const d = Math.floor(h / 24);
  return `${d}d siden`;
}

function OnlineBadge({ isOnline, lastSeen }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]" : "bg-slate-500"}`} />
      <span className={`text-xs ${isOnline ? "text-green-700" : "text-slate-400"}`}>
        {isOnline ? "Online nu" : timeAgo(lastSeen)}
      </span>
    </span>
  );
}

function AchievementBadge({ achievement }) {
  const isLocked = !achievement.unlocked;
  return (
    <div className="group relative">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all text-lg
        ${isLocked ? "bg-slate-50 border-slate-200 opacity-40 grayscale" : "bg-amber-50 border-amber-200"}`}>
        <span>{isLocked && achievement.is_secret ? "🔒" : achievement.icon}</span>
      </div>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 w-44
        opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="text-slate-900 text-xs font-bold">{isLocked && achievement.is_secret ? "???" : achievement.title}</p>
        {(!isLocked || !achievement.is_secret) && (
          <p className="text-slate-500 text-[10px] mt-0.5 leading-relaxed">{achievement.description}</p>
        )}
        {achievement.unlocked_at && (
          <p className="text-amber-700/60 text-[9px] mt-1">
            {new Date(achievement.unlocked_at).toLocaleDateString("da-DK")}
          </p>
        )}
      </div>
    </div>
  );
}

export default function ManagerProfilePage() {
  const { teamId } = useParams();
  const navigate   = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState("overblik");
  const [myTeamId, setMyTeamId] = useState(null);

  useEffect(() => { loadProfile(); loadMyTeam(); }, [teamId]);

  async function loadMyTeam() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (t) setMyTeamId(t.id);
  }

  async function loadProfile() {
    setLoading(true);
    const h = await authHeaders();
    const res = await fetch(`${API}/api/managers/${teamId}`, { headers: h });
    const json = await res.json();
    if (res.ok) setData(json);
    setLoading(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
    </div>
  );
  if (!data) return <div className="text-center py-16 text-slate-400">Hold ikke fundet</div>;

  const { team, user, riders, season_history, achievements, transfer_activity } = data;
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const isOwnProfile  = team.id === myTeamId;

  const achByCategory = achievements.reduce((acc, a) => {
    if (!acc[a.category]) acc[a.category] = [];
    acc[a.category].push(a);
    return acc;
  }, {});

  const TABS = [
    { key: "overblik",     label: "Overblik" },
    { key: "ryttere",      label: `Hold (${riders.length})` },
    { key: "sæson",        label: "Sæsonhistorik" },
    { key: "achievements", label: `Achievements ${unlockedCount}/${achievements.length}` },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-900 text-sm mb-4 flex items-center gap-1">← Tilbage</button>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-xl font-bold text-slate-900">{team.name}</h1>
              {isOwnProfile && (
                <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">Dit hold</span>
              )}
            </div>
            <p className="text-slate-500 text-sm mb-3">
              Manager: <span className="text-slate-600">{user.username}</span>
              {" · "}Division {team.division}
            </p>
            <OnlineBadge isOnline={user.is_online} lastSeen={user.last_seen} />
          </div>
          <div className="flex gap-3 ml-4">
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-center">
              <p className="text-lg">🔥</p>
              <p className="text-slate-900 font-bold text-sm">{user.login_streak || 0}</p>
              <p className="text-slate-400 text-[10px]">streak</p>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-center">
              <p className="text-lg">🏆</p>
              <p className="text-slate-900 font-bold text-sm">{unlockedCount}</p>
              <p className="text-slate-400 text-[10px]">achievements</p>
            </div>
          </div>
        </div>

        {unlockedCount > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-3">Senest låst op</p>
            <div className="flex gap-2 flex-wrap">
              {achievements
                .filter(a => a.unlocked)
                .sort((a, b) => new Date(b.unlocked_at) - new Date(a.unlocked_at))
                .slice(0, 8)
                .map(a => <AchievementBadge key={a.id} achievement={a} />)}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-50 p-1 rounded-xl border border-slate-200">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all
              ${tab === t.key ? "bg-[#e8c547] text-[#0a0a0f]" : "text-slate-500 hover:text-slate-600"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overblik" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4 text-center">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">Ryttere</p>
              <p className="text-slate-900 font-bold text-xl">{riders.length}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 text-center">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">Sæsoner</p>
              <p className="text-slate-900 font-bold text-xl">{season_history.length}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 text-center">
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">Transfers</p>
              <p className="text-slate-900 font-bold text-xl">{transfer_activity.length}</p>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-slate-900 font-semibold text-sm mb-4">Seneste transfers</h2>
            {transfer_activity.length === 0 ? (
              <p className="text-slate-300 text-sm text-center py-4">Ingen transfers endnu</p>
            ) : (
              <div className="flex flex-col gap-2">
                {transfer_activity.map(t => {
                  const isBuyer = t.buyer_team?.id === teamId;
                  return (
                    <div key={t.id} className="flex items-center justify-between py-2 border-b border-slate-200 last:border-0">
                      <div>
                        <p className="text-slate-900 text-sm">{t.rider?.firstname} {t.rider?.lastname}</p>
                        <p className="text-slate-400 text-xs">
                          {isBuyer ? "Købt fra" : "Solgt til"}{" "}
                          <Link to={`/managers/${isBuyer ? t.seller_team?.id : t.buyer_team?.id}`}
                            className="text-amber-700/70 hover:text-amber-700">
                            {isBuyer ? t.seller_team?.name : t.buyer_team?.name}
                          </Link>
                        </p>
                      </div>
                      <span className={`font-mono font-bold text-sm ${isBuyer ? "text-red-700" : "text-green-700"}`}>
                        {isBuyer ? "-" : "+"}{t.offer_amount?.toLocaleString("da-DK")} CZ$
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "ryttere" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {riders.length === 0 ? (
            <p className="text-slate-300 text-sm text-center py-8">Ingen ryttere</p>
          ) : (
            <table className="w-full">
              <thead><tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-slate-400 text-[10px] uppercase">Rytter</th>
                <th className="px-4 py-3 text-right text-slate-400 text-[10px] uppercase">UCI</th>
                <th className="px-4 py-3 text-right text-slate-400 text-[10px] uppercase hidden sm:table-cell">BJ</th>
                <th className="px-4 py-3 text-right text-slate-400 text-[10px] uppercase hidden sm:table-cell">SP</th>
                <th className="px-4 py-3 text-right text-slate-400 text-[10px] uppercase hidden sm:table-cell">TT</th>
              </tr></thead>
              <tbody>
                {riders.map(r => (
                  <tr key={r.id} onClick={() => navigate(`/riders/${r.id}`)}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-100 cursor-pointer transition-all">
                    <td className="px-4 py-3">
                      <p className="text-slate-900 text-sm">{r.firstname} {r.lastname}</p>
                      {r.is_u25 && <span className="text-[9px] bg-blue-500/20 text-blue-700 px-1.5 py-0.5 rounded">U25</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-700 font-mono text-sm">{r.uci_points?.toLocaleString("da-DK")}</td>
                    <td className="px-4 py-3 text-right text-slate-500 text-sm hidden sm:table-cell">{r.stat_bj || "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-500 text-sm hidden sm:table-cell">{r.stat_sp || "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-500 text-sm hidden sm:table-cell">{r.stat_tt || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "sæson" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {season_history.length === 0 ? (
            <p className="text-slate-300 text-sm text-center py-8">Ingen sæsonhistorik endnu</p>
          ) : (
            <table className="w-full">
              <thead><tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-slate-400 text-[10px] uppercase">Sæson</th>
                <th className="px-4 py-3 text-center text-slate-400 text-[10px] uppercase">Division</th>
                <th className="px-4 py-3 text-right text-slate-400 text-[10px] uppercase">Point</th>
                <th className="px-4 py-3 text-right text-slate-400 text-[10px] uppercase">Placering</th>
              </tr></thead>
              <tbody>
                {season_history.map(s => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 text-slate-900 text-sm">Sæson {s.season?.number}</td>
                    <td className="px-4 py-3 text-center text-slate-500 text-sm">Div. {s.division}</td>
                    <td className="px-4 py-3 text-right text-amber-700 font-mono text-sm">{s.total_points?.toLocaleString("da-DK")}</td>
                    <td className="px-4 py-3 text-right">
                      {s.final_rank === 1
                        ? <span className="text-amber-700 font-bold text-sm">🏆 #1</span>
                        : <span className="text-slate-500 text-sm">#{s.final_rank || "—"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "achievements" && (
        <div className="space-y-4">
          {Object.entries(achByCategory).map(([cat, achs]) => (
            <div key={cat} className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-slate-900 font-semibold text-sm capitalize">{cat}</h2>
                <span className="text-slate-400 text-xs">{achs.filter(a => a.unlocked).length}/{achs.length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {achs.map(a => <AchievementBadge key={a.id} achievement={a} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
