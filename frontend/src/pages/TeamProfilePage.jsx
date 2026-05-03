import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { statBg } from "../lib/statBg";
import { getFlagEmoji } from "../lib/countryUtils";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

function SortTh({ children, sortKey, sort, sortDir, onSort, className = "" }) {
  const active = sort === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"} ${className}`}>
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
        .select(`id, firstname, lastname, uci_points, salary, prize_earnings_bonus, is_u25, pending_team_id, nationality_code, ${STATS.join(", ")}`)
        .eq("team_id", id)
        .order("uci_points", { ascending: false }),
      supabase.from("riders")
        .select(`id, firstname, lastname, uci_points, salary, prize_earnings_bonus, is_u25, pending_team_id, ${STATS.join(", ")}`)
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
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  if (!team) return <div className="text-center py-16 text-cz-3">Hold ikke fundet</div>;

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
  const totalValue = currentRiders.reduce((s, r) => s + getRiderMarketValue(r), 0);

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={() => navigate(-1)}
        className="text-cz-2 hover:text-cz-1 text-sm mb-5 flex items-center gap-2 transition-colors">
        ← Tilbage
      </button>

      {/* Header */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h1 className="text-xl font-bold text-cz-1">{team.name}</h1>
              {isMyTeam && <span className="text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 px-2 py-0.5 rounded-full">Dit hold</span>}
              <span className={`text-xs px-2 py-0.5 rounded-full border ${windowOpen ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                {windowOpen ? "🟢 Vindue åbent" : "🔒 Vindue lukket"}
              </span>
            </div>
            {team.manager_name && (
              <p className="text-cz-2 text-sm">Manager: {team.manager_name}</p>
            )}
            <p className="text-cz-2 text-sm">Division {team.division}</p>
          </div>

        </div>

        <div className="grid grid-cols-4 gap-3 mt-5">
          {[
            { label: "Ryttere nu", value: currentRiders.length },
            { label: "Indgående", value: incomingRiders.length, color: incomingRiders.length > 0 ? "text-cz-success" : "text-cz-1" },
            { label: "Udgående", value: outgoingRiders.length, color: outgoingRiders.length > 0 ? "text-cz-danger" : "text-cz-1" },
            { label: "Holdværdi", value: `${totalValue.toLocaleString("da-DK")} CZ$`, color: "text-cz-accent-t" }, // value shown, balance hidden
          ].map(s => (
            <div key={s.label} className="bg-cz-subtle rounded-lg p-3 text-center">
              <p className="text-cz-3 text-[9px] uppercase tracking-wider mb-1">{s.label}</p>
              <p className={`font-mono font-bold text-sm ${s.color || "text-cz-1"}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Season standing */}
      {standing && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
          <h2 className="text-cz-1 font-semibold text-sm mb-3">Sæsonresultater</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Point", value: standing.total_points?.toLocaleString("da-DK") || 0, color: "text-cz-accent-t" },
              { label: "Etapesejre", value: standing.stage_wins || 0 },
              { label: "GC-sejre", value: standing.gc_wins || 0 },
            ].map(s => (
              <div key={s.label} className="bg-cz-subtle rounded-lg p-3 text-center">
                <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{s.label}</p>
                <p className={`font-mono font-bold text-lg ${s.color || "text-cz-1"}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Squad with FM toggle */}
      <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-cz-border flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-cz-1 font-semibold text-sm">Trup ({currentRiders.length} ryttere)</h2>
          {hasTransfers && (
            <div className="flex gap-2 flex-wrap">
              {incomingRiders.length > 0 && (
                <button onClick={() => setShowIncoming(!showIncoming)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all
                    ${showIncoming ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  Indgående ({incomingRiders.length})
                </button>
              )}
              {outgoingRiders.length > 0 && (
                <button onClick={() => setShowOutgoing(!showOutgoing)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all
                    ${showOutgoing ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30" : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  Udgående ({outgoingRiders.length})
                </button>
              )}
            </div>
          )}
        </div>
        {displayRiders.length === 0 ? (
          <div className="text-center py-12 text-cz-3"><p>Ingen ryttere</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-cz-border">
                  <SortTh sortKey="firstname" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-4 py-3 text-left font-medium uppercase">Rytter</SortTh>
                  <SortTh sortKey="uci_points" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-4 py-3 text-right font-medium">Værdi</SortTh>
                  {STATS.map((key, i) => (
                    <SortTh key={key} sortKey={key} sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                      className="px-1.5 py-3 text-center font-medium w-10">{STAT_LABELS[i]}</SortTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRiders.map(r => (
                  <tr key={r.id}
                    className={`border-b border-cz-border hover:bg-cz-subtle cursor-pointer
                      ${r._isIncoming ? "bg-cz-success-bg0/3" : r._isOutgoing ? "bg-cz-danger-bg0/3" : ""}`}
                    onClick={() => navigate(`/riders/${r.id}`)}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {r._isIncoming && <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />}
                        {r._isOutgoing && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                        {r.nationality_code && <span className="flex-shrink-0">{getFlagEmoji(r.nationality_code)}</span>}
                        <span className="text-cz-1 font-medium">{r.firstname} {r.lastname}</span>
                        {r.is_u25 && <span className="text-[9px] uppercase bg-cz-info-bg0/20 text-cz-info px-1.5 py-0.5 rounded">U25</span>}
                        {r._isIncoming && <span className="text-[9px] uppercase bg-cz-success-bg text-cz-success px-1.5 py-0.5 rounded">Indgående</span>}
                        {r._isOutgoing && <span className="text-[9px] uppercase bg-cz-danger-bg text-cz-danger px-1.5 py-0.5 rounded">Udgående</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-cz-accent-t font-mono font-bold">
                      {formatCz(getRiderMarketValue(r)).replace(" CZ$", "")}
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
