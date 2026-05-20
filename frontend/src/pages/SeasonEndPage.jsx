import { useState, useEffect, Fragment } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, useParams } from "react-router-dom";

const DIV_COLORS = { 1: "#e8c547", 2: "#60a5fa", 3: "#a78bfa" };

const RACE_STATUS_LABEL = {
  completed: { label: "Afsluttet", cls: "bg-cz-success-bg text-cz-success border-cz-success/30" },
  active:    { label: "Igang",     cls: "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" },
  scheduled: { label: "Kommende",  cls: "bg-cz-subtle text-cz-3 border-cz-border" },
};

function formatCZ(amount) {
  return `${(amount || 0).toLocaleString("da-DK")} CZ$`;
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
  const navigate = useNavigate();
  const { seasonId: urlSeasonId } = useParams();
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [standings, setStandings] = useState([]);
  const [races, setRaces] = useState([]);
  const [pointsByTeam, setPointsByTeam] = useState({});
  const [winners, setWinners] = useState({ prize: null, biggestTransfer: null, mostActive: null, stageKing: null });
  const [myTeamId, setMyTeamId] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadInit = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
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
    const [standingsRes, racesRes] = await Promise.all([
      supabase.from("season_standings")
        .select("*, team:team_id(id, name, division, is_ai)")
        .eq("season_id", season.id)
        .order("division").order("total_points", { ascending: false }),
      supabase.from("races")
        .select("id, name, race_type, stages, status, edition_year, pool_race:pool_race_id(date_text)")
        .eq("season_id", season.id)
        .order("name"),
    ]);

    const allStandings = standingsRes.data || [];
    const standings = allStandings.filter(s => !s.team?.is_ai);
    const humanTeamIds = new Set(standings.map(s => s.team_id));
    setStandings(standings);
    setRaces(racesRes.data || []);

    // Build point progression + winners per race
    let resultsData = [];
    if (racesRes.data?.length) {
      const { data: results } = await supabase
        .from("race_results")
        .select("rider:rider_id(id, firstname, lastname, team_id, team:team_id(id, name, is_ai)), prize_money, race_id, result_type, rank")
        .in("race_id", racesRes.data.map(r => r.id));
      resultsData = results || [];

      const prog = {};
      standings.forEach(s => { prog[s.team_id] = []; });

      let cumulative = {};
      standings.forEach(s => { cumulative[s.team_id] = 0; });

      racesRes.data.forEach(race => {
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
  }, [urlSeasonId, seasons]);

  // Group standings by division
  const byDiv = standings.reduce((acc, s) => {
    const div = s.team?.division || 3;
    if (!acc[div]) acc[div] = [];
    acc[div].push(s);
    return acc;
  }, {});

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">
            {selectedSeason ? `Sæson ${selectedSeason.number}` : "Sæson-snapshot"}
          </h1>
          <p className="text-cz-3 text-sm">
            {selectedSeason?.status === "active" ? "Igangværende" : "Afsluttet"} ·
            kalender, slutstilling og sæsonens vindere
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectedSeason && myTeamId && (
            <button
              onClick={() => navigate(`/seasons/${selectedSeason.id}/finance/${myTeamId}`)}
              className="text-sm bg-cz-card border border-cz-border hover:border-cz-accent rounded-lg px-3 py-2 text-cz-2 hover:text-cz-1 transition-colors">
              📊 Finansrapport
            </button>
          )}
          <select
            value={selectedSeason?.id || ""}
            onChange={e => {
              const s = seasons.find(s => s.id === e.target.value);
              changeSeason(s);
            }}
            className="bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-cz-1 text-sm focus:outline-none">
            {seasons.map(s => (
              <option key={s.id} value={s.id}>
                Sæson {s.number} — {s.status === "active" ? "Igangværende" : "Afsluttet"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {standings.length === 0 ? (
        <div className="text-center py-20 text-cz-3">
          <p className="text-5xl mb-4">🏁</p>
          <p className="text-lg font-medium text-cz-3">Ingen resultater endnu</p>
          <p className="text-sm mt-2">Afslut løb og sæsoner for at se resultater her</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Sæsonens vindere */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <WinnerCard
              icon="💰"
              title="Præmie-leader"
              primary={winners.prize?.team?.name || "—"}
              secondary={winners.prize ? `+${formatCZ(winners.prize.amount)} tjent` : "Ingen præmier endnu"}
              hasData={!!winners.prize?.team?.id}
              onClick={() => winners.prize?.team?.id && navigate(`/teams/${winners.prize.team.id}`)}
            />
            <WinnerCard
              icon="💸"
              title="Største transfer"
              primary={winners.biggestTransfer ? formatCZ(winners.biggestTransfer.amount) : "—"}
              secondary={winners.biggestTransfer
                ? (winners.biggestTransfer.description || winners.biggestTransfer.team?.name || "Transfer")
                : "Ingen transfers"}
              hasData={!!winners.biggestTransfer?.team?.id}
              onClick={() => winners.biggestTransfer?.team?.id && navigate(`/teams/${winners.biggestTransfer.team.id}`)}
            />
            <WinnerCard
              icon="🔄"
              title="Mest aktive"
              primary={winners.mostActive?.team?.name || "—"}
              secondary={winners.mostActive ? `${winners.mostActive.count} transfers` : "Ingen handler"}
              hasData={!!winners.mostActive?.team?.id}
              onClick={() => winners.mostActive?.team?.id && navigate(`/teams/${winners.mostActive.team.id}`)}
            />
            <WinnerCard
              icon="🚴"
              title="Stage-king"
              primary={winners.stageKing?.rider
                ? `${winners.stageKing.rider.firstname} ${winners.stageKing.rider.lastname}`
                : "—"}
              secondary={winners.stageKing
                ? `${winners.stageKing.count} etapesejr${winners.stageKing.count === 1 ? "" : "e"}`
                : "Ingen etaper kørt"}
              hasData={!!winners.stageKing?.rider?.id}
              onClick={() => winners.stageKing?.rider?.id && navigate(`/riders/${winners.stageKing.rider.id}`)}
            />
          </div>

          {/* Kalender */}
          {races.length > 0 && (
            <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-cz-border flex items-center justify-between">
                <h2 className="font-bold text-cz-1 text-sm">📅 Kalender — {races.length} løb</h2>
                <span className="text-cz-3 text-xs">
                  {races.filter(r => r.status === "completed").length} afsluttet ·
                  {" "}{races.filter(r => r.status === "scheduled").length} kommende
                </span>
              </div>
              <div className="divide-y divide-cz-border">
                {races.map(race => {
                  const meta = RACE_STATUS_LABEL[race.status] || RACE_STATUS_LABEL.scheduled;
                  return (
                    <div key={race.id}
                      onClick={() => navigate(`/race-archive/${encodeURIComponent(race.name)}`)}
                      className="flex items-center gap-3 px-5 py-2.5 hover:bg-cz-subtle cursor-pointer transition-colors">
                      <span className="text-cz-3 text-xs font-mono w-14 flex-shrink-0">{race.pool_race?.date_text || "—"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-cz-1 text-sm font-medium truncate">{race.name}</p>
                        <p className="text-cz-3 text-xs">
                          {race.race_type === "stage_race" ? `Etapeløb · ${race.stages} etaper` : "Enkeltdagsløb"}
                          {race.edition_year ? ` · ${race.edition_year}-udgave` : ""}
                        </p>
                      </div>
                      <span className={`text-[9px] uppercase px-2 py-0.5 rounded-full border flex-shrink-0 ${meta.cls}`}>
                        {meta.label}
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
              <div key={div} className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-cz-border"
                  style={{ borderLeft: `3px solid ${color}` }}>
                  <h2 className="font-bold text-sm" style={{ color }}>Division {div}</h2>
                  {isCompleted && div < 3 && (
                    <span className="text-xs text-cz-3">Top 2 rykker op ↑</span>
                  )}
                  {isCompleted && div > 1 && (
                    <span className="text-xs text-cz-3">Bund 2 rykker ned ↓</span>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-cz-border">
                      <th className="px-4 py-2.5 text-left text-cz-3 font-medium text-xs w-8">#</th>
                      <th className="px-4 py-2.5 text-left text-cz-3 font-medium text-xs">Hold</th>
                      <th className="px-4 py-2.5 text-right text-cz-3 font-medium text-xs hidden sm:table-cell">Etapesejre</th>
                      <th className="px-4 py-2.5 text-right text-cz-3 font-medium text-xs">Point</th>
                      <th className="px-4 py-2.5 text-right text-cz-3 font-medium text-xs hidden md:table-cell">Udvikling</th>
                    </tr>
                  </thead>
                  <tbody>
                    {divStandings.map((s, i) => {
                      const isMe = s.team_id === myTeamId;
                      const isPromotion = isCompleted && i < 2 && div < 3;
                      const isRelegation = isCompleted && i >= divStandings.length - 2 && div > 1;
                      const prog = pointsByTeam[s.team_id] || [];
                      const rowStyle = isPromotion
                        ? { boxShadow: "inset 3px 0 0 #4ade80" }
                        : isRelegation
                        ? { boxShadow: "inset 3px 0 0 #f87171" }
                        : {};
                      return (
                        <Fragment key={s.id}>
                          {/* Separator before relegation zone */}
                          {isCompleted && i === divStandings.length - 2 && div > 1 && divStandings.length > 4 && (
                            <tr aria-hidden="true">
                              <td colSpan={5} style={{ padding: 0, lineHeight: 0, border: 0 }}>
                                <div style={{ height: 2, background: "linear-gradient(to right, #fca5a5 40%, transparent)" }} />
                              </td>
                            </tr>
                          )}
                          <tr
                            style={rowStyle}
                            className={`border-b border-cz-border last:border-0 hover:bg-cz-subtle cursor-pointer transition-colors
                              ${isPromotion && !isMe ? "bg-emerald-50" : ""}
                              ${isRelegation && !isMe ? "bg-cz-danger-bg" : ""}
                              ${isMe ? "bg-cz-accent/10/60" : ""}`}
                            onClick={() => navigate(`/teams/${s.team_id}`)}>
                            <td className="px-4 py-3">
                              <span className={`font-mono font-bold text-sm
                                ${i === 0 ? "text-cz-accent-t" : i === 1 ? "text-cz-2" : "text-cz-3"}`}>
                                #{i + 1}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`font-medium ${isMe ? "text-cz-accent-t" : "text-cz-1"}`}>
                                  {s.team?.name}
                                </span>
                                {isMe && <span className="text-[9px] uppercase bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 px-1.5 py-0.5 rounded-full">Dig</span>}
                                {isPromotion && <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">↑ Op</span>}
                                {isRelegation && <span className="text-[9px] bg-cz-danger-bg text-cz-danger px-1.5 py-0.5 rounded font-medium">↓ Ned</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-cz-2 hidden sm:table-cell">
                              {s.stage_wins || 0}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="font-mono font-bold" style={{ color }}>
                                {s.total_points?.toLocaleString("da-DK") || 0}
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
                                <div style={{ height: 2, background: "linear-gradient(to right, #86efac 40%, transparent)" }} />
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
            <div className="bg-cz-card border border-cz-border rounded-xl p-5">
              <h2 className="text-cz-1 font-semibold text-sm mb-4">Dit holds pointudvikling</h2>
              <PointChart
                data={pointsByTeam[myTeamId]}
                labels={races.map(r => r.name)}
                color="#e8c547" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WinnerCard({ icon, title, primary, secondary, onClick, hasData }) {
  return (
    <button
      onClick={onClick}
      disabled={!hasData}
      className={`bg-cz-card border border-cz-border rounded-xl p-3 text-left transition-colors ${
        hasData ? "hover:border-cz-accent/30 cursor-pointer" : "cursor-default"
      }`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-base leading-none">{icon}</span>
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
            stroke="rgba(0,0,0,0.06)" strokeWidth="0.5" />
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
            {v > 0 ? v.toLocaleString("da-DK") : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
