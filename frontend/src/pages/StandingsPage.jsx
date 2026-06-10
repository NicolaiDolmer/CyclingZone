import { useState, useEffect, Fragment } from "react";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/supabasePagination";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import TeamLink from "../components/TeamLink";
import LeaderBadge from "../components/LeaderBadge";
import { formatNumber } from "../lib/intl";
import { countTeamPodiums } from "../lib/standingsPodiums";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";

const DIV_COLORS = { 1: "#e8c547", 2: "#60a5fa", 3: "#a78bfa" };
// Realtime: opdatér ranglisten live når en resultat-import skriver nye rækker (#783).
const REALTIME_TABLES = ["season_standings", "race_results"];

function MiniSparkline({ points, color }) {
  if (!points || points.length < 2) return <span className="text-cz-3 text-xs">—</span>;
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

export default function StandingsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("standings");
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [divTab, setDivTab] = useState(1);
  const [myTeamId, setMyTeamId] = useState(null);
  const [season, setSeason] = useState(null);
  const [racePoints, setRacePoints] = useState({});
  const [teamComp, setTeamComp] = useState({});
  const [podiums, setPodiums] = useState({});
  const [prizeEarned, setPrizeEarned] = useState({});
  const [races, setRaces] = useState([]);

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: myTeam } = await supabase.from("teams").select("id, division").eq("user_id", user.id).single();
    setMyTeamId(myTeam?.id);
    if (myTeam?.division) setDivTab(myTeam.division);

    const { data: activeSeason } = await supabase.from("seasons").select("*").eq("status", "active").single();
    setSeason(activeSeason);

    const [teamsRes, standingsRes, racesRes] = await Promise.all([
      supabase.from("teams").select("id, name, division").eq("is_ai", false).eq("is_test_account", false).eq("is_frozen", false).order("division").order("name"),
      activeSeason
        ? supabase.from("season_standings")
            .select("*, team:team_id(id, name, division, is_ai)")
            .eq("season_id", activeSeason.id)
            .order("total_points", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from("races")
        .select("id, name, edition_year, pool_race:pool_race_id(date_text)")
        .eq("season_id", activeSeason?.id || "")
        .order("name"),
    ]);

    // Index actual standings by team_id
    const standingsMap = {};
    (standingsRes.data || []).filter(s => !s.team?.is_ai).forEach(s => {
      standingsMap[s.team_id] = s;
    });

    // All human teams, merged with standings (0 points as fallback)
    const merged = (teamsRes.data || []).map(team => (
      standingsMap[team.id] || { id: team.id, team_id: team.id, team, total_points: 0, stage_wins: 0 }
    ));

    setStandings(merged);
    setRaces(racesRes.data || []);

    // Build race-by-race point progression
    if (racesRes.data?.length && merged.length) {
      // Paginér: PostgREST capper ved 1000 → ellers undertæller progression-grafen.
      const results = await fetchAllRows(() => supabase
        .from("race_results")
        .select("rider:rider_id(team_id), team_id, result_type, rank, prize_money, race_id")
        .in("race_id", racesRes.data.map(r => r.id))
        .order("id", { ascending: true }));

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

      // Holdkonkurrence: tæl team-classification-sejre — result_type='team', rider_id NULL, team_id sat.
      const comp = {};
      (results || []).forEach(r => {
        if (r.result_type !== "team" || !r.team_id) return;
        const c = comp[r.team_id] || (comp[r.team_id] = { wins: 0, podiums: 0 });
        if (r.rank === 1) c.wins += 1;
        if (r.rank <= 3) c.podiums += 1;
      });
      setTeamComp(comp);

      // Podier pr. hold (#1093): season_standings har ingen podiums-kolonne,
      // så kolonnen viste altid 0. Tælles client-side fra race_results —
      // semantik = rytter-ranglistens "Top 3" (kun stage + gc, rank <= 3).
      setPodiums(countTeamPodiums(results));

      // Præmiepenge pr. hold: summér prize_money på race_results.team_id (det felt
      // udbetalingen bogfører på — se prizePayoutEngine), så kolonnen viser præcis
      // hvad holdet står til at få udbetalt. Inkluderer alle completed-løb.
      const prize = {};
      merged.forEach(s => { prize[s.team_id] = 0; });
      (results || []).forEach(r => {
        if (r.team_id != null && prize[r.team_id] !== undefined) {
          prize[r.team_id] += (r.prize_money || 0);
        }
      });
      setPrizeEarned(prize);
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);
  useRealtimeRefetch("standings-live", REALTIME_TABLES, loadAll);

  const effectivePts = (s) => ((s?.total_points || 0) - (s?.penalty_points || 0));
  const divStandings = standings
    .filter(s => s.team?.division === divTab)
    .sort((a, b) => effectivePts(b) - effectivePts(a));

  const maxPts = effectivePts(divStandings[0]) || 1;
  const color = DIV_COLORS[divTab] || "#e8c547";
  const canPromote = divTab > 1;
  const canRelegate = divTab < 3;
  const divCounts = [1, 2, 3].map(d => ({
    div: d,
    count: standings.filter(s => s.team?.division === d).length,
  }));

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
          <p className="text-cz-3 text-sm">
            {season ? t("season", { n: season.number }) : t("noActiveSeason")}
          </p>
        </div>
      </div>

      {/* Division tabs */}
      <div className="flex gap-2 mb-5">
        {divCounts.map(({ div, count }) => (
          <button key={div} onClick={() => setDivTab(div)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border
              ${divTab === div
                ? "border-opacity-30 text-cz-1"
                : "bg-cz-card text-cz-2 border-cz-border hover:text-cz-1"}`}
            style={divTab === div ? { backgroundColor: `${DIV_COLORS[div]}15`, borderColor: `${DIV_COLORS[div]}40`, color: DIV_COLORS[div] } : {}}>
            {t("division", { n: div })}
            <span className="ms-2 text-[10px] opacity-60">({count})</span>
          </button>
        ))}
      </div>

      {divStandings.length === 0 ? (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">◉</p>
          <p>{t("noData", { n: divTab })}</p>
        </div>
      ) : (
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs w-8">#</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs">{t("thTeam")}</th>
                  <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden sm:table-cell">{t("thStageWins")}</th>
                  <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden lg:table-cell" title={t("thTeamComp")}>
                    <span className="hidden xl:inline">{t("thTeamComp")}</span>
                    <span className="xl:hidden">{t("thTeamCompShort")}</span>
                  </th>
                  <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden md:table-cell">{t("thPodiums")}</th>
                  <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs">
                    <span className="hidden sm:inline">{t("thPrize")}</span>
                    <span className="sm:hidden">{t("thPrizeShort")}</span>
                  </th>
                  <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs">{t("thPoints")}</th>
                  <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden lg:table-cell w-20">{t("thProgress")}</th>
                </tr>
              </thead>
              <tbody>
                {divStandings.map((s, i) => {
                  const isMe = s.team_id === myTeamId;
                  const prog = racePoints[s.team_id] || [];
                  const eff = effectivePts(s);
                  const penalty = s.penalty_points || 0;
                  const ptsWidth = Math.round((eff / maxPts) * 100);
                  const isPromotion = i < 2 && canPromote;
                  const isRelegation = i >= divStandings.length - 2 && canRelegate;
                  const isLeader = i === 0;
                  // Zone bar (green/red) + the neutral "you" ring can co-exist; gold
                  // never overrides a zone bar — the leader signal is the chip (PF2 B).
                  const bars = [];
                  if (isPromotion) bars.push("inset 3px 0 0 #4ade80");
                  else if (isRelegation) bars.push("inset 3px 0 0 #f87171");
                  if (isMe) bars.push("inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)");
                  const rowStyle = bars.length ? { boxShadow: bars.join(", ") } : {};
                  return (
                    <Fragment key={s.id}>
                      {/* Separator before relegation zone */}
                      {i === divStandings.length - 2 && canRelegate && divStandings.length > 4 && (
                        <tr aria-hidden="true">
                          <td colSpan={8} style={{ padding: 0, lineHeight: 0, border: 0 }}>
                            <div style={{ height: 2, background: "linear-gradient(to right, rgb(var(--danger) / 0.6) 40%, transparent)" }} />
                          </td>
                        </tr>
                      )}
                      <tr
                        onClick={() => navigate(`/teams/${s.team_id}`)}
                        style={rowStyle}
                        className={`border-b border-cz-border last:border-0 cursor-pointer hover:bg-cz-subtle transition-colors
                          ${isLeader ? "bg-cz-accent/[0.08]" : isPromotion ? "bg-cz-success-bg" : isRelegation ? "bg-cz-danger-bg" : ""}`}>
                        <td className="px-4 py-3.5">
                          <span className={`font-mono font-bold text-sm
                            ${i === 0 ? "text-cz-accent-t" : i === 1 ? "text-cz-2" : i === 2 ? "text-cz-2" : "text-cz-3"}`}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <TeamLink id={s.team_id} stopPropagation className="font-medium text-cz-1">{s.team?.name}</TeamLink>
                            {isLeader && <LeaderBadge />}
                            {isMe && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgb(var(--me-badge-bg))", color: "rgb(var(--me-badge-fg))" }}>{t("youBadge")}</span>}
                            {isPromotion && <span className="text-[9px] bg-cz-success-bg text-cz-success px-1.5 py-0.5 rounded font-medium">{t("promotionBadge")}</span>}
                            {isRelegation && <span className="text-[9px] bg-cz-danger-bg text-cz-danger px-1.5 py-0.5 rounded font-medium">{t("relegationBadge")}</span>}
                          </div>
                          {/* Mini progress bar */}
                          <div className="mt-1.5 bg-cz-subtle rounded-full h-1 w-full max-w-32">
                            <div className="h-1 rounded-full" style={{ width: `${ptsWidth}%`, backgroundColor: `${color}60` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right text-cz-2 hidden sm:table-cell font-mono">{s.stage_wins || 0}</td>
                        <td className="px-4 py-3.5 text-right text-cz-2 hidden lg:table-cell font-mono">{teamComp[s.team_id]?.wins || 0}</td>
                        <td className="px-4 py-3.5 text-right text-cz-2 hidden md:table-cell font-mono">{podiums[s.team_id] || 0}</td>
                        <td className="px-4 py-3.5 text-right font-mono text-cz-2 whitespace-nowrap">
                          {formatNumber(prizeEarned[s.team_id] || 0)} <span className="text-cz-3 text-[10px]">CZ$</span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="font-mono font-bold" style={{ color }}>
                            {formatNumber(eff)}
                          </span>
                          {penalty > 0 && (
                            <span
                              className="ms-1.5 font-mono text-[10px] text-cz-danger"
                              title={t("penaltyTooltip", { penalty, earned: formatNumber(s.total_points || 0) })}
                            >
                              (−{penalty})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right hidden lg:table-cell">
                          <MiniSparkline points={prog} color={color} />
                        </td>
                      </tr>
                      {/* Separator after promotion zone */}
                      {i === 1 && canPromote && divStandings.length > 2 && (
                        <tr aria-hidden="true">
                          <td colSpan={8} style={{ padding: 0, lineHeight: 0, border: 0 }}>
                            <div style={{ height: 2, background: "linear-gradient(to right, rgb(var(--success) / 0.6) 40%, transparent)" }} />
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
          <div className="px-4 py-3 border-t border-cz-border flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-cz-accent-t">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: "#e8c547" }} />
              {t("legendLeader")}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-cz-success/70">
              <span className="w-2 h-2 rounded-sm bg-cz-success-bg border border-cz-success/30" />
              {t("legendPromotion")}
            </div>
            {canRelegate && (
              <div className="flex items-center gap-1.5 text-xs text-cz-danger/70">
                <span className="w-2 h-2 rounded-sm bg-cz-danger-bg border border-cz-danger/30" />
                {t("legendRelegation")}
              </div>
            )}
            <div className="ms-auto text-xs text-cz-3">
              {t("racesPlayed", { count: races.length })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
