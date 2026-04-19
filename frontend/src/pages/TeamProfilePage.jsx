import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { statBg } from "../lib/statBg";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

function SortTh({ children, sortKey, sort, sortDir, onSort, className = "" }) {
  const active = sort === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none transition-colors ${active ? "text-[#e8c547]/80" : "text-white/30 hover:text-white/50"} ${className}`}>
      {children}{active && <span className="ml-0.5 text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

export default function TeamProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [standing, setStanding] = useState(null);
  const [windowOpen, setWindowOpen] = useState(false);
  const [showIncoming, setShowIncoming] = useState(true);
  const [showOutgoing, setShowOutgoing] = useState(true);
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);
  const [tableSort, setTableSort] = useState({ key: "uci_points", dir: "desc" });

  function handleSort(key) {
    setTableSort(s => ({ key, dir: s.key === key ? (s.dir === "desc" ? "asc" : "desc") : "desc" }));
  }

  useEffect(() => { loadAll(); }, [id]);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (myTeam) setMyTeamId(myTeam.id);

    const [teamRes, ridersRes, pendingRes, standingRes, windowRes] = await Promise.all([
      supabase.from("teams").select("*").eq("id", id).single(),
      supabase.from("riders")
        .select(`id, firstname, lastname, uci_points, salary, is_u25, pending_team_id, ${STATS.join(", ")}`)
        .eq("team_id", id)
        .order("uci_points", { ascending: false }),
      supabase.from("riders")
        .select(`id, firstname, lastname, uci_points, salary, is_u25, pending_team_id, ${STATS.join(", ")}`)
        .eq("pending_team_id", id)
        .order("uci_points", { ascending: false }),
      supabase.from("season_standings")
        .select("*").eq("team_id", id)
        .order("updated_at", { ascending: false }).limit(1).single(),
      supabase.from("transfer_windows")
        .select("status").order("created_at", { ascending: false }).limit(1).single(),
    ]);

    setTeam(teamRes.data);
    const current = (ridersRes.data || []).map(r => ({
      ...r, _isOutgoing: r.pending_team_id && r.pending_team_id !== id,
    }));
    const incoming = (pendingRes.data || []).map(r => ({ ...r, _isIncoming: true }));
    setRiders([...current, ...incoming]);
    setStanding(standingRes.data);
    setWindowOpen(windowRes.data?.status === "open");
    setLoading(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!team) return <div className="text-center py-16 text-white/30">Hold ikke fundet</div>;

  const currentRiders = riders.filter(r => !r._isIncoming);
  const incomingRiders = riders.filter(r => r._isIncoming);
  const outgoingRiders = riders.filter(r => r._isOutgoing);
  const isMyTeam = team.id === myTeamId;

  const displayRiders = [
    ...riders.filter(r => !r._isIncoming && !r._isOutgoing),
    ...(showIncoming ? incomingRiders : []),
    ...(showOutgoing ? outgoingRiders : []),
  ].sort((a, b) => {
    if (tableSort.key === "firstname") {
      const an = `${a.lastname} ${a.firstname}`.toLowerCase();
      const bn = `${b.lastname} ${b.firstname}`.toLowerCase();
      return tableSort.dir === "desc" ? bn.localeCompare(an) : an.localeCompare(bn);
    }
    const av = a[tableSort.key] || 0;
    const bv = b[tableSort.key] || 0;
    return tableSort.dir === "desc" ? bv - av : av - bv;
  });

  const hasTransfers = incomingRiders.length > 0 || outgoingRiders.length > 0;
  const totalValue = currentRiders.reduce((s, r) => s + (r.uci_points || 0), 0);

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={() => navigate(-1)}
        className="text-white/40 hover:text-white text-sm mb-5 flex items-center gap-2 transition-colors">
        ← Tilbage
      </button>

      {/* Header */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h1 className="text-xl font-bold text-white">{team.name}</h1>
              {isMyTeam && <span className="text-xs bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20 px-2 py-0.5 rounded-full">Dit hold</span>}
              <span className={`text-xs px-2 py-0.5 rounded-full border ${windowOpen ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-white/5 text-white/30 border-white/8"}`}>
                {windowOpen ? "🟢 Vindue åbent" : "🔒 Vindue lukket"}
              </span>
            </div>
            {team.manager_name && (
              <p className="text-white/40 text-sm">Manager: {team.manager_name}</p>
            )}
            <p className="text-white/40 text-sm">Division {team.division}</p>
          </div>

        </div>

        <div className="grid grid-cols-4 gap-3 mt-5">
          {[
            { label: "Ryttere nu", value: currentRiders.length },
            { label: "Indgående", value: incomingRiders.length, color: incomingRiders.length > 0 ? "text-green-400" : "text-white" },
            { label: "Udgående", value: outgoingRiders.length, color: outgoingRiders.length > 0 ? "text-red-400" : "text-white" },
            { label: "Holdværdi", value: `${totalValue.toLocaleString("da-DK")} CZ$`, color: "text-[#e8c547]" }, // value shown, balance hidden
          ].map(s => (
            <div key={s.label} className="bg-white/3 rounded-lg p-3 text-center">
              <p className="text-white/25 text-[9px] uppercase tracking-wider mb-1">{s.label}</p>
              <p className={`font-mono font-bold text-sm ${s.color || "text-white"}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Season standing */}
      {standing && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-4">
          <h2 className="text-white font-semibold text-sm mb-3">Sæsonresultater</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Point", value: standing.total_points?.toLocaleString("da-DK") || 0, color: "text-[#e8c547]" },
              { label: "Etapesejre", value: standing.stage_wins || 0 },
              { label: "GC-sejre", value: standing.gc_wins || 0 },
            ].map(s => (
              <div key={s.label} className="bg-white/3 rounded-lg p-3 text-center">
                <p className="text-white/30 text-xs uppercase tracking-wider mb-1">{s.label}</p>
                <p className={`font-mono font-bold text-lg ${s.color || "text-white"}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Squad with FM toggle */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-white font-semibold text-sm">Trup ({currentRiders.length} ryttere)</h2>
          {hasTransfers && (
            <div className="flex gap-2 flex-wrap">
              {incomingRiders.length > 0 && (
                <button onClick={() => setShowIncoming(!showIncoming)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all
                    ${showIncoming ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-white/5 text-white/30 border-white/5"}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  Indgående ({incomingRiders.length})
                </button>
              )}
              {outgoingRiders.length > 0 && (
                <button onClick={() => setShowOutgoing(!showOutgoing)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all
                    ${showOutgoing ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-white/5 text-white/30 border-white/5"}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  Udgående ({outgoingRiders.length})
                </button>
              )}
            </div>
          )}
        </div>
        {displayRiders.length === 0 ? (
          <div className="text-center py-12 text-white/20"><p>Ingen ryttere</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  <SortTh sortKey="firstname" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-4 py-3 text-left font-medium uppercase">Rytter</SortTh>
                  <SortTh sortKey="uci_points" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-4 py-3 text-right font-medium">UCI</SortTh>
                  {STATS.map((key, i) => (
                    <SortTh key={key} sortKey={key} sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                      className="px-1.5 py-3 text-center font-medium w-10">{STAT_LABELS[i]}</SortTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRiders.map(r => (
                  <tr key={r.id}
                    className={`border-b border-white/4 hover:bg-white/3 cursor-pointer
                      ${r._isIncoming ? "bg-green-500/3" : r._isOutgoing ? "bg-red-500/3" : ""}`}
                    onClick={() => navigate(`/riders/${r.id}`)}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {r._isIncoming && <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />}
                        {r._isOutgoing && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                        <span className="text-white font-medium">{r.firstname} {r.lastname}</span>
                        {r.is_u25 && <span className="text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>}
                        {r._isIncoming && <span className="text-[9px] uppercase bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">Indgående</span>}
                        {r._isOutgoing && <span className="text-[9px] uppercase bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Udgående</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#e8c547] font-mono font-bold">
                      {r.uci_points?.toLocaleString("da-DK")}
                    </td>
                    {STATS.map(key => (
                      <td key={key} className="px-1.5 py-2.5 text-center">
                        <span className={`inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded ${statBg(r[key] || 0)}`}>
                          {r[key] || "—"}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
