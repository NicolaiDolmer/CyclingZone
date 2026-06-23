import { useState, useEffect, Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/supabasePagination";
import { useNavigate, useParams } from "react-router-dom";
import { computeExpectedRacePrize, formatExpectedPrize } from "../lib/expectedPrizeCalculator";
import { formatNumber } from "../lib/intl";
import { dateTextToDayOfYear } from "../lib/raceCalendar";
import LeaderBadge from "../components/LeaderBadge";
import { CoinIcon, BriefcaseIcon, ExchangeIcon, BikeIcon, FlagIcon, PageLoader } from "../components/ui";

// 2-farve-system: guld bærer division-hierarkiet via faldende opacitet (tema-bevidst),
// så Div 2/3-tabeller ikke maler sig i fremmed SaaS-blå/lilla. Bruges i rgb()-form
// så inline-style/SVG-attributter også resolver mod --accent-tokenet.
const DIV_COLORS = {
  1: "rgb(var(--accent))",
  2: "rgb(var(--accent) / 0.6)",
  3: "rgb(var(--accent) / 0.4)",
};

// Label resolves via t("status.<key>") ved render — se seasonEnd-namespacet.
const RACE_STATUS_CLS = {
  completed: "bg-cz-success-bg text-cz-success border-cz-success/30",
  active:    "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30",
  scheduled: "bg-cz-subtle text-cz-3 border-cz-border",
};

function formatCZ(amount) {
  return `${formatNumber(amount || 0)} CZ$`;
}

function MiniLineChart({ data, color }) {
  if (!data || data.length < 2) return <span className="text-cz-3 text-xs">—</span>;
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
  const { t } = useTranslation("seasonEnd");
  const navigate = useNavigate();
  const { seasonId: urlSeasonId } = useParams();
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [standings, setStandings] = useState([]);
  const [races, setRaces] = useState([]);
  const [racePoints, setRacePoints] = useState([]);
  const [pointsByTeam, setPointsByTeam] = useState({});
  const [winners, setWinners] = useState({ prize: null, biggestTransfer: null, mostActive: null, stageKing: null });
  const [myTeamId, setMyTeamId] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadInit = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) { setLoading(false); return; }
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    setMyTeamId(myTeam?.id);

    const { data: seasonsData } = await supabase.from("seasons")
      .select("*").order("number", { ascending: false });
    setSeasons(seasonsData || []);
    setLoading(false);
  };

  const changeSeason = (season) => {
    if (!season) return;
    navigate(`/seasons/${season.id}`);
  };

  const loadSeason = async (season) => {
    setSelectedSeason(season);
    const [standingsRes, racesRes, racePointsRes] = await Promise.all([
      supabase.from("season_standings")
        .select("*, team:team_id(id, name, division, is_ai)")
        .eq("season_id", season.id)
        .order("division").order("total_points", { ascending: false }),
      supabase.from("races")
        .select("id, name, race_type, race_class, stages, status, edition_year, pool_race:pool_race_id(date_text)")
        .eq("season_id", season.id)
        .order("name"),
      supabase.from("race_points").select("race_class, result_type, rank, points"),
    ]);
    setRacePoints(racePointsRes.data || []);

    const allStandings = standingsRes.data || [];
    const standings = allStandings.filter(s => !s.team?.is_ai);
    const humanTeamIds = new Set(standings.map(s => s.team_id));
    setStandings(standings);

    // Kalenderen sorteres kronologisk (efter løbsdato), ikke alfabetisk (#823).
    // Datoen ligger i pool_race.date_text ("D/M…") → sortér klient-side som på
    // dashboardet. Samme rækkefølge bruges til pointudviklings-grafen nedenfor,
    // så graf-labels (races.map(r => r.name)) ikke desynker fra data-punkterne.
    const sortedRaces = [...(racesRes.data || [])].sort(
      (a, b) => dateTextToDayOfYear(a.pool_race?.date_text) - dateTextToDayOfYear(b.pool_race?.date_text)
    );
    setRaces(sortedRaces);

    // Build point progression + winners per race
    let resultsData = [];
    if (racesRes.data?.length) {
      // Paginér: PostgREST capper ved 1000 → ellers undertælles progression + vindere.
      resultsData = await fetchAllRows(() => supabase
        .from("race_results")
        .select("rider:rider_id(id, firstname, lastname, team_id, team:team_id(id, name, is_ai)), prize_money, race_id, result_type, rank")
        .in("race_id", racesRes.data.map(r => r.id))
        .order("id", { ascending: true }));

      const prog = {};
      standings.forEach(s => { prog[s.team_id] = []; });

      let cumulative = {};
      standings.forEach(s => { cumulative[s.team_id] = 0; });

      sortedRaces.forEach(race => {
        const raceResults = resultsData.filter(r => r.race_id === race.id);
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

    // Vindere
    const teamMeta = Object.fromEntries(allStandings.map(s => [s.team_id, s.team]));

    // 1. Præmie-leader: sum(prize_money) per human team
    const prizeByTeam = {};
    resultsData.forEach(r => {
      const teamId = r.rider?.team_id;
      if (!teamId || !humanTeamIds.has(teamId)) return;
      prizeByTeam[teamId] = (prizeByTeam[teamId] || 0) + (r.prize_money || 0);
    });
    const prizeTop = Object.entries(prizeByTeam).sort((a, b) => b[1] - a[1])[0];
    const prizeWinner = prizeTop ? { team: teamMeta[prizeTop[0]], amount: prizeTop[1] } : null;

    // 2+3. Transfers: finance_transactions type=transfer_in/out for season
    const { data: txData } = await supabase
      .from("finance_transactions")
      .select("team_id, amount, description, created_at, type, team:team_id(id, name, is_ai)")
      .eq("season_id", season.id)
      .in("type", ["transfer_in", "transfer_out"]);

    const txs = (txData || []).filter(t => !t.team?.is_ai);

    // Største enkelt-transfer = max ABS(amount), but use type='transfer_in' to count seller's perspective (avoids double-count of same transfer)
    const sells = txs.filter(t => t.type === "transfer_in");
    const biggest = sells.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
    const biggestTransfer = biggest ? {
      team: biggest.team, amount: Math.abs(biggest.amount), description: biggest.description,
    } : null;

    // Mest aktive: count transactions per team (in + out)
    const activeByTeam = {};
    txs.forEach(t => { activeByTeam[t.team_id] = (activeByTeam[t.team_id] || 0) + 1; });
    const activeTop = Object.entries(activeByTeam).sort((a, b) => b[1] - a[1])[0];
    const mostActive = activeTop ? { team: teamMeta[activeTop[0]] || txs.find(t => t.team_id === activeTop[0])?.team, count: activeTop[1] } : null;

    // 4. Stage-king: count rank=1 stage results per rider
    const stageWinsByRider = {};
    resultsData.forEach(r => {
      if (r.result_type !== "stage" || r.rank !== 1) return;
      if (!r.rider?.id) return;
      const k = r.rider.id;
      if (!stageWinsByRider[k]) stageWinsByRider[k] = { rider: r.rider, count: 0 };
      stageWinsByRider[k].count += 1;
    });
    const stageTop = Object.values(stageWinsByRider).sort((a, b) => b.count - a.count)[0];
    const stageKing = stageTop || null;

    setWinners({ prize: prizeWinner, biggestTransfer, mostActive, stageKing });
  };

  useEffect(() => { loadInit(); }, []);

  useEffect(() => {
    if (!seasons.length) return;
    let target = null;
    if (urlSeasonId) target = seasons.find(s => s.id === urlSeasonId);
    if (!target) target = seasons.find(s => s.status === "active") || seasons[0];
    if (target && target.id !== selectedSeason?.id) loadSeason(target);
  }, [urlSeasonId, seasons]); // eslint-disable-line react-hooks/exhaustive-deps

  const seasonExpectedTotal = useMemo(() => {
    if (!races.length || !racePoints.length) return 0;
    return races.reduce((sum, race) => sum + computeExpectedRacePrize({
      raceClass: race.race_class,
      raceType: race.race_type,
      stages: race.stages,
      racePoints,
    }), 0);
  }, [races, racePoints]);

  // Group standings by division
  const byDiv = standings.reduce((acc, s) => {
    const div = s.team?.division || 3;
    if (!acc[div]) acc[div] = [];
    acc[div].push(s);
    return acc;
  }, {});

  if (loading) return (
    <PageLoader />
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">
            {selectedSeason ? t("title", { number: selectedSeason.number }) : t("titleFallback")}
          </h1>
          <p className="text-cz-3 text-sm">
            {t("subtitle", { status: selectedSeason?.status === "active" ? t("statusOngoing") : t("statusCompleted") })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectedSeason && myTeamId && (
            <button
              onClick={() => navigate(`/finance?tab=history&season=${selectedSeason.id}`)}
              className="text-sm bg-cz-card border border-cz-border hover:border-cz-accent rounded-lg px-3 py-2 text-cz-2 hover:text-cz-1 transition-colors">
              {t("financeReport")}
            </button>
          )}
          <select
            value={selectedSeason?.id || ""}
            onChange={e => {
              const s = seasons.find(s => s.id === e.target.value);
              changeSeason(s);
            }}
            aria-label={t("common:a11y.selectSeason")}
            className="bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
            {seasons.map(s => (
              <option key={s.id} value={s.id}>
                {t("seasonOption", { number: s.number, status: s.status === "active" ? t("statusOngoing") : t("statusCompleted") })}
              </option>
            ))}
          </select>
        </div>
      </div>

      {standings.length === 0 ? (
        <div className="text-center py-20 text-cz-3">
          <FlagIcon size={44} className="mx-auto mb-4" aria-hidden="true" />
          <p className="text-lg font-medium text-cz-3">{t("empty.title")}</p>
          <p className="text-sm mt-2">{t("empty.body")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Sæsonens vindere */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <WinnerCard
              icon={CoinIcon}
              title={t("winners.prize.title")}
              primary={winners.prize?.team?.name || "—"}
              secondary={winners.prize ? t("winners.prize.secondary", { amount: formatCZ(winners.prize.amount) }) : t("winners.prize.empty")}
              hasData={!!winners.prize?.team?.id}
              onClick={() => winners.prize?.team?.id && navigate(`/teams/${winners.prize.team.id}`)}
            />
            <WinnerCard
              icon={BriefcaseIcon}
              title={t("winners.transfer.title")}
              primary={winners.biggestTransfer ? formatCZ(winners.biggestTransfer.amount) : "—"}
              secondary={winners.biggestTransfer
                ? (winners.biggestTransfer.description || winners.biggestTransfer.team?.name || t("winners.transfer.fallback"))
                : t("winners.transfer.empty")}
              hasData={!!winners.biggestTransfer?.team?.id}
              onClick={() => winners.biggestTransfer?.team?.id && navigate(`/teams/${winners.biggestTransfer.team.id}`)}
            />
            <WinnerCard
              icon={ExchangeIcon}
              title={t("winners.active.title")}
              primary={winners.mostActive?.team?.name || "—"}
              secondary={winners.mostActive ? t("winners.active.secondary", { count: winners.mostActive.count }) : t("winners.active.empty")}
              hasData={!!winners.mostActive?.team?.id}
              onClick={() => winners.mostActive?.team?.id && navigate(`/teams/${winners.mostActive.team.id}`)}
            />
            <WinnerCard
              icon={BikeIcon}
              title={t("winners.stageKing.title")}
              primary={winners.stageKing?.rider
                ? `${winners.stageKing.rider.firstname} ${winners.stageKing.rider.lastname}`
                : "—"}
              secondary={winners.stageKing
                ? t("winners.stageKing.secondary", { count: winners.stageKing.count })
                : t("winners.stageKing.empty")}
              hasData={!!winners.stageKing?.rider?.id}
              onClick={() => winners.stageKing?.rider?.id && navigate(`/riders/${winners.stageKing.rider.id}`)}
            />
          </div>

          {/* Kalender */}
          {races.length > 0 && (
            <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
              <div className="px-5 py-3 border-b border-cz-border flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="font-bold text-cz-1 text-sm">{t("calendar.heading", { count: races.length })}</h2>
                  {seasonExpectedTotal > 0 && (
                    <p className="text-cz-3 text-xs mt-0.5" title={t("calendar.expectedTotalTooltip")}>
                      {t("calendar.expectedTotal")} <span className="text-cz-2 font-mono">{formatExpectedPrize(seasonExpectedTotal)}</span>
                    </p>
                  )}
                </div>
                <span className="text-cz-3 text-xs">
                  {t("calendar.summary", {
                    completed: races.filter(r => r.status === "completed").length,
                    scheduled: races.filter(r => r.status === "scheduled").length,
                  })}
                </span>
              </div>
              <div className="divide-y divide-cz-border">
                {races.map(race => {
                  const statusKey = RACE_STATUS_CLS[race.status] ? race.status : "scheduled";
                  const expectedPrize = computeExpectedRacePrize({
                    raceClass: race.race_class,
                    raceType: race.race_type,
                    stages: race.stages,
                    racePoints,
                  });
                  return (
                    <div key={race.id}
                      onClick={() => navigate(`/race-archive/${encodeURIComponent(race.name)}`)}
                      className="flex items-center gap-3 px-5 py-2.5 hover:bg-cz-subtle cursor-pointer transition-colors">
                      <span className="text-cz-3 text-xs font-mono w-14 flex-shrink-0">{race.pool_race?.date_text || "—"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-cz-1 text-sm font-medium truncate">{race.name}</p>
                        <p className="text-cz-3 text-xs">
                          {race.race_type === "stage_race" ? t("calendar.stageRace", { count: race.stages }) : t("calendar.oneDay")}
                          {expectedPrize > 0 ? <span className="text-cz-2 font-mono"> · {formatExpectedPrize(expectedPrize)}</span> : ""}
                        </p>
                      </div>
                      <span className={`text-[9px] uppercase px-2 py-0.5 rounded-full border flex-shrink-0 ${RACE_STATUS_CLS[statusKey]}`}>
                        {t(`status.${statusKey}`)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Slutstilling */}
          {[1, 2, 3].map(div => {
            const divStandings = byDiv[div] || [];
            if (!divStandings.length) return null;
            const color = DIV_COLORS[div];
            const isCompleted = selectedSeason?.status === "completed";
            return (
              <div key={div} className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-cz-border"
                  style={{ borderLeft: `3px solid ${color}` }}>
                  <h2 className="font-bold text-sm" style={{ color }}>{t("division", { div })}</h2>
                  {isCompleted && div < 3 && (
                    <span className="text-xs text-cz-3">{t("promotionNote")}</span>
                  )}
                  {isCompleted && div > 1 && (
                    <span className="text-xs text-cz-3">{t("relegationNote")}</span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-cz-border">
                      <th className="px-4 py-2.5 text-left text-cz-3 font-medium text-xs w-8">{t("table.rank")}</th>
                      <th className="px-4 py-2.5 text-left text-cz-3 font-medium text-xs">{t("table.team")}</th>
                      <th className="px-4 py-2.5 text-right text-cz-3 font-medium text-xs hidden sm:table-cell">{t("table.stageWins")}</th>
                      <th className="px-4 py-2.5 text-right text-cz-3 font-medium text-xs">{t("table.points")}</th>
                      <th className="px-4 py-2.5 text-right text-cz-3 font-medium text-xs hidden md:table-cell">{t("table.progression")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {divStandings.map((s, i) => {
                      const isMe = s.team_id === myTeamId;
                      const isPromotion = isCompleted && i < 2 && div < 3;
                      const isRelegation = isCompleted && i >= divStandings.length - 2 && div > 1;
                      const isLeader = i === 0;
                      const prog = pointsByTeam[s.team_id] || [];
                      // Zone bar + neutral "you" ring co-exist; gold = the leader chip (PF2 B).
                      const bars = [];
                      if (isPromotion) bars.push("inset 3px 0 0 rgb(var(--success))");
                      else if (isRelegation) bars.push("inset 3px 0 0 rgb(var(--danger))");
                      if (isMe) bars.push("inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)");
                      const rowStyle = bars.length ? { boxShadow: bars.join(", ") } : {};
                      return (
                        <Fragment key={s.id}>
                          {/* Separator before relegation zone */}
                          {isCompleted && i === divStandings.length - 2 && div > 1 && divStandings.length > 4 && (
                            <tr aria-hidden="true">
                              <td colSpan={5} style={{ padding: 0, lineHeight: 0, border: 0 }}>
                                <div className="border-t border-cz-danger/30" />
                              </td>
                            </tr>
                          )}
                          <tr
                            style={rowStyle}
                            className={`border-b border-cz-border last:border-0 hover:bg-cz-subtle cursor-pointer transition-colors
                              ${isLeader ? "bg-cz-accent/[0.08]" : isPromotion ? "bg-cz-success-bg" : isRelegation ? "bg-cz-danger-bg" : ""}`}
                            onClick={() => navigate(`/teams/${s.team_id}`)}>
                            <td className="px-4 py-3">
                              <span className={`font-mono font-bold text-sm
                                ${i === 0 ? "text-cz-accent-t" : i === 1 ? "text-cz-2" : "text-cz-3"}`}>
                                #{i + 1}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-cz-1">
                                  {s.team?.name}
                                </span>
                                {isLeader && <LeaderBadge />}
                                {isMe && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgb(var(--me-badge-bg))", color: "rgb(var(--me-badge-fg))" }}>{t("you")}</span>}
                                {isPromotion && <span className="text-[9px] bg-cz-success-bg text-cz-success px-1.5 py-0.5 rounded font-medium">{t("promotion")}</span>}
                                {isRelegation && <span className="text-[9px] bg-cz-danger-bg text-cz-danger px-1.5 py-0.5 rounded font-medium">{t("relegation")}</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-cz-2 hidden sm:table-cell">
                              {s.stage_wins || 0}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="font-mono font-bold" style={{ color }}>
                                {formatNumber(s.total_points) || 0}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right hidden md:table-cell">
                              <MiniLineChart data={prog} color={color} />
                            </td>
                          </tr>
                          {/* Separator after promotion zone */}
                          {isCompleted && i === 1 && div < 3 && divStandings.length > 2 && (
                            <tr aria-hidden="true">
                              <td colSpan={5} style={{ padding: 0, lineHeight: 0, border: 0 }}>
                                <div className="border-t border-cz-success/30" />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}

          {/* Full point progression for my team */}
          {myTeamId && pointsByTeam[myTeamId]?.length > 1 && races.length > 1 && (
            <div className="bg-cz-card border border-cz-border rounded-cz p-5">
              <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("myProgression")}</h2>
              <PointChart
                data={pointsByTeam[myTeamId]}
                labels={races.map(r => r.name)}
                color="rgb(var(--accent))" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WinnerCard({ icon: Icon, title, primary, secondary, onClick, hasData }) {
  return (
    <button
      onClick={onClick}
      disabled={!hasData}
      className={`bg-cz-card border border-cz-border rounded-cz p-3 text-left transition-colors ${
        hasData ? "hover:border-cz-accent/30 cursor-pointer" : "cursor-default"
      }`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={15} className="text-cz-accent flex-shrink-0" aria-hidden="true" />}
        <span className="text-cz-3 text-[10px] uppercase tracking-wider font-semibold">{title}</span>
      </div>
      <p className="text-cz-1 font-bold text-sm truncate">{primary}</p>
      <p className="text-cz-3 text-xs truncate mt-0.5">{secondary}</p>
    </button>
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
            stroke="rgb(var(--border))" strokeWidth="0.5" />
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
          <span key={i} className="text-[8px] text-cz-3 truncate max-w-16 text-center"
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
            {v > 0 ? formatNumber(v) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
