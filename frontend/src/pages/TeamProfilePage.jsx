import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RiderLink from "../components/RiderLink";
import { supabase } from "../lib/supabase";
import { statBg } from "../lib/statBg";
import NationCell from "../components/rider/NationCell";
import RiderBadges from "../components/rider/RiderBadges";
import OnlineBadge from "../components/OnlineBadge";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";
import { formatNumber } from "../lib/intl";
import TeamTransferHistoryTab from "../components/TeamTransferHistoryTab";

const STATS = ["stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
  "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod","stat_res","stat_ftr"];
const STAT_LABELS = ["FL","BJ","KB","BK","TT","PRL","Bro","SP","ACC","NED","UDH","MOD","RES","FTR"];

function SortTh({ children, sortKey, sort, sortDir, onSort, className = "" }) {
  const active = sort === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"} ${className}`}>
      {children}{active && <span className="ms-0.5 text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

export default function TeamProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation("team");
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [standing, setStanding] = useState(null);
  const [managerStatus, setManagerStatus] = useState({ isOnline: false, lastSeen: null });
  const [showIncoming, setShowIncoming] = useState(true);
  const [showOutgoing, setShowOutgoing] = useState(true);
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);
  const [tableSort, setTableSort] = useState({ key: "uci_points", dir: "desc" });
  const [activeTab, setActiveTab] = useState("squad");

  function handleSort(key) {
    setTableSort(s => ({ key, dir: s.key === key ? (s.dir === "desc" ? "asc" : "desc") : "desc" }));
  }

  const loadAll = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (myTeam) setMyTeamId(myTeam.id);

    const [teamRes, ridersRes, pendingRes, standingRes] = await Promise.all([
      supabase.from("teams").select("*, manager:user_id(last_seen)").eq("id", id).single(),
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
    ]);

    setTeam(teamRes.data);
    const lastSeen = teamRes.data?.manager?.last_seen || null;
    const isOnline = lastSeen ? (Date.now() - new Date(lastSeen).getTime()) < 5 * 60 * 1000 : false;
    setManagerStatus({ isOnline, lastSeen });
    const current = (ridersRes.data || []).map(r => ({
      ...r, _isOutgoing: r.pending_team_id && r.pending_team_id !== id,
    }));
    const incoming = (pendingRes.data || []).map(r => ({ ...r, _isIncoming: true }));
    setRiders([...current, ...incoming]);
    setStanding(standingRes.data);
    setLoading(false);
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  if (!team) return <div className="text-center py-16 text-cz-3">{t("profile.notFound")}</div>;

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
        {t("profile.back")}
      </button>

      {/* Header */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h1 className="text-xl font-bold text-cz-1">{team.name}</h1>
              {isMyTeam && <span className="text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 px-2 py-0.5 rounded-full">{t("profile.yourTeam")}</span>}
            </div>
            {team.manager_name && (
              <p className="text-cz-2 text-sm flex items-center gap-2">
                <span>{t("profile.managerLabel", { name: team.manager_name })}</span>
                <OnlineBadge isOnline={managerStatus.isOnline} lastSeen={managerStatus.lastSeen} />
              </p>
            )}
            <p className="text-cz-2 text-sm">{t("profile.division", { n: team.division })}</p>
          </div>

        </div>

        <div className="grid grid-cols-4 gap-3 mt-5">
          {[
            { label: t("profile.statRidersNow"), value: currentRiders.length },
            { label: t("profile.statIncoming"), value: incomingRiders.length, color: incomingRiders.length > 0 ? "text-cz-success" : "text-cz-1" },
            { label: t("profile.statOutgoing"), value: outgoingRiders.length, color: outgoingRiders.length > 0 ? "text-cz-danger" : "text-cz-1" },
            { label: t("profile.statTeamValue"), value: `${formatNumber(totalValue)} CZ$`, color: "text-cz-accent-t" }, // value shown, balance hidden
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
          <h2 className="text-cz-1 font-semibold text-sm mb-3">{t("profile.seasonResults")}</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: t("profile.seasonPoints"), value: formatNumber(standing.total_points) || 0, color: "text-cz-accent-t" },
              { label: t("profile.seasonStageWins"), value: standing.stage_wins || 0 },
              { label: t("profile.seasonGcWins"), value: standing.gc_wins || 0 },
            ].map(s => (
              <div key={s.label} className="bg-cz-subtle rounded-lg p-3 text-center">
                <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{s.label}</p>
                <p className={`font-mono font-bold text-lg ${s.color || "text-cz-1"}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {[
          { key: "squad", label: t("profile.tabSquad", { count: currentRiders.length }) },
          { key: "transfers", label: t("profile.tabTransfers") },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${activeTab === tab.key ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "transfers" && (
        <TeamTransferHistoryTab teamId={id} />
      )}

      {/* Squad with FM toggle */}
      {activeTab === "squad" && (
      <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-cz-border flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-cz-1 font-semibold text-sm">{t("profile.squadTitle", { count: currentRiders.length })}</h2>
          {hasTransfers && (
            <div className="flex gap-2 flex-wrap">
              {incomingRiders.length > 0 && (
                <button onClick={() => setShowIncoming(!showIncoming)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all
                    ${showIncoming ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  {t("profile.incomingToggle", { count: incomingRiders.length })}
                </button>
              )}
              {outgoingRiders.length > 0 && (
                <button onClick={() => setShowOutgoing(!showOutgoing)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all
                    ${showOutgoing ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30" : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  {t("profile.outgoingToggle", { count: outgoingRiders.length })}
                </button>
              )}
            </div>
          )}
        </div>
        {displayRiders.length === 0 ? (
          <div className="text-center py-12 text-cz-3"><p>{t("profile.noRiders")}</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-2 py-3 text-left font-medium uppercase hidden sm:table-cell">{t("profile.thNation")}</th>
                  <SortTh sortKey="firstname" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-4 py-3 text-left font-medium uppercase sticky left-0 z-20 bg-cz-card border-r border-cz-border">{t("profile.thRider")}</SortTh>
                  <SortTh sortKey="uci_points" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-4 py-3 text-right font-medium">{t("profile.thValue")}</SortTh>
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
                    <td className="px-2 py-2.5 hidden sm:table-cell">
                      <NationCell code={r.nationality_code} />
                    </td>
                    <td className="px-4 py-2.5 sticky-name-cell sticky left-0 z-10 border-r border-cz-border shadow-[10px_0_16px_-16px_rgba(0,0,0,0.5)]">
                      <div className="flex items-center gap-2">
                        <RiderLink id={r.id} stopPropagation
                          className="text-cz-1 font-medium hover:text-cz-accent-t transition-colors">
                          {r.firstname} {r.lastname}
                        </RiderLink>
                        <RiderBadges badges={[r.is_u25 && "u25", r._isIncoming && "incoming", r._isOutgoing && "outgoing"]} />
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
      )}
    </div>
  );
}
