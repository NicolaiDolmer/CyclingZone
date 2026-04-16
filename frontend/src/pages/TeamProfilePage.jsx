import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

export default function TeamProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [standing, setStanding] = useState(null);
  const [board, setBoard] = useState(null);
  const [activeAuctions, setActiveAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);

  useEffect(() => { loadAll(); }, [id]);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (myTeam) setMyTeamId(myTeam.id);

    const [teamRes, ridersRes, standingRes, boardRes, auctionsRes] = await Promise.all([
      supabase.from("teams").select("*").eq("id", id).single(),
      supabase.from("riders")
        .select(`id, firstname, lastname, uci_points, salary, is_u25, ${STATS.join(", ")}`)
        .eq("team_id", id)
        .order("uci_points", { ascending: false }),
      supabase.from("season_standings")
        .select("*")
        .eq("team_id", id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .single(),
      supabase.from("board_profiles").select("focus, plan_type, satisfaction").eq("team_id", id).single(),
      supabase.from("auctions")
        .select(`id, current_price, calculated_end, status,
          rider:rider_id(firstname, lastname, uci_points)`)
        .eq("seller_team_id", id)
        .in("status", ["active", "extended"])
        .order("calculated_end"),
    ]);

    setTeam(teamRes.data);
    setRiders(ridersRes.data || []);
    setStanding(standingRes.data);
    setBoard(boardRes.data);
    setActiveAuctions(auctionsRes.data || []);
    setLoading(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!team) return <div className="text-center py-16 text-white/30">Hold ikke fundet</div>;

  const totalValue = riders.reduce((s, r) => s + (r.uci_points || 0), 0);
  const totalSalary = riders.reduce((s, r) => s + (r.salary || 0), 0);
  const u25Count = riders.filter(r => r.is_u25).length;
  const isMyTeam = team.id === myTeamId;

  const topRiders = riders.slice(0, 5);
  const satisfactionColor = !board ? "text-white/40" :
    board.satisfaction >= 70 ? "text-green-400" :
    board.satisfaction >= 40 ? "text-[#e8c547]" : "text-red-400";

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
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-white">{team.name}</h1>
              {isMyTeam && (
                <span className="text-xs bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20
                  px-2 py-0.5 rounded-full">Dit hold</span>
              )}
              {team.is_ai && (
                <span className="text-xs bg-white/5 text-white/30 px-2 py-0.5 rounded-full">AI</span>
              )}
            </div>
            <p className="text-white/40 text-sm">Division {team.division}</p>
          </div>
          <div className="text-right">
            <p className="text-[#e8c547] font-mono font-bold text-xl">
              {team.balance?.toLocaleString("da-DK")} CZ$
            </p>
            <p className="text-white/30 text-xs mt-0.5">Balance</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 mt-5">
          {[
            { label: "Ryttere", value: riders.length },
            { label: "U25", value: u25Count, color: "text-blue-400" },
            { label: "Holdværdi", value: `${totalValue.toLocaleString("da-DK")} CZ$`, color: "text-[#e8c547]" },
            { label: "Løn/sæson", value: `${totalSalary.toLocaleString("da-DK")} CZ$` },
          ].map(s => (
            <div key={s.label} className="bg-white/3 rounded-lg p-3 text-center">
              <p className="text-white/30 text-xs uppercase tracking-wider mb-1">{s.label}</p>
              <p className={`font-mono font-bold text-sm ${s.color || "text-white"}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        {/* Season standing */}
        {standing && (
          <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
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

        {/* Board */}
        {board && (
          <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
            <h2 className="text-white font-semibold text-sm mb-3">Bestyrelse</h2>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 bg-white/5 rounded-full h-2">
                <div className={`h-2 rounded-full ${board.satisfaction >= 70 ? "bg-green-400" : board.satisfaction >= 40 ? "bg-[#e8c547]" : "bg-red-400"}`}
                  style={{ width: `${board.satisfaction}%` }} />
              </div>
              <span className={`font-mono text-sm font-bold ${satisfactionColor}`}>{board.satisfaction}%</span>
            </div>
            <div className="flex gap-3">
              <div className="bg-white/3 rounded-lg p-3 flex-1">
                <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Fokus</p>
                <p className="text-white text-sm font-medium capitalize">{board.focus?.replace(/_/g, " ") || "—"}</p>
              </div>
              <div className="bg-white/3 rounded-lg p-3 flex-1">
                <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Plan</p>
                <p className="text-white text-sm font-medium">{board.plan_type || "—"}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Active auctions */}
      {activeAuctions.length > 0 && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-4">
          <h2 className="text-white font-semibold text-sm mb-3">
            Aktive Auktioner ({activeAuctions.length})
          </h2>
          <div className="flex flex-col gap-2">
            {activeAuctions.map(a => (
              <div key={a.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <p className="text-white text-sm">{a.rider?.firstname} {a.rider?.lastname}</p>
                <div className="text-right">
                  <p className="text-[#e8c547] font-mono text-sm font-bold">
                    {a.current_price?.toLocaleString("da-DK")} CZ$
                  </p>
                  {a.status === "extended" && (
                    <span className="text-[9px] text-orange-400">⚡ Forlænget</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Squad */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h2 className="text-white font-semibold text-sm">Trup ({riders.length} ryttere)</h2>
        </div>
        {riders.length === 0 ? (
          <div className="text-center py-12 text-white/20">
            <p>Ingen ryttere på holdet endnu</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-4 py-3 text-left text-white/30 font-medium uppercase tracking-wider">Rytter</th>
                  <th className="px-4 py-3 text-right text-white/30 font-medium uppercase tracking-wider">UCI</th>
                  {STAT_LABELS.map(l => (
                    <th key={l} className="px-1.5 py-3 text-center text-white/20 font-medium w-10">{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riders.map(r => (
                  <tr key={r.id}
                    className="border-b border-white/4 hover:bg-white/3 cursor-pointer"
                    onClick={() => navigate(`/riders/${r.id}`)}>
                    <td className="px-4 py-2.5">
                      <span className="text-white font-medium">{r.firstname} {r.lastname}</span>
                      {r.is_u25 && (
                        <span className="ml-2 text-[9px] uppercase bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">U25</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#e8c547] font-mono font-bold">
                      {r.uci_points?.toLocaleString("da-DK")}
                    </td>
                    {STATS.map(key => (
                      <td key={key} className="px-1.5 py-2.5 text-center">
                        <span className={`font-mono ${r[key] >= 80 ? "text-[#e8c547] font-bold" : "text-white/40"}`}>
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
