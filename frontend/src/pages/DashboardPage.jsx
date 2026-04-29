import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL;
const SQUAD_LIMITS = { 1: { min: 20, max: 30 }, 2: { min: 14, max: 20 }, 3: { min: 8, max: 10 } };

function isAuctionSeller(auction, teamId) {
  return auction?.seller_team_id === teamId && auction?.rider?.team_id === teamId;
}

function StatCard({ label, value, sub, accent = "text-slate-900", icon }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <p className="text-slate-400 text-xs uppercase tracking-wider">{label}</p>
        <span className="text-base">{icon}</span>
      </div>
      <p className={`text-xl font-bold font-mono ${accent}`}>{value}</p>
      {sub && <p className="text-slate-400 text-xs mt-1 truncate">{sub}</p>}
    </div>
  );
}

function MiniBar({ value, max, color = "#e8c547" }) {
  const pct = Math.min(100, Math.round((value / Math.max(max, 1)) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-100 rounded-full h-1.5">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono text-slate-500 w-8 text-right">{value}</span>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [pendingIncomingCount, setPendingIncomingCount] = useState(0);
  const [activeLoanCount, setActiveLoanCount] = useState(0);
  const [allAuctions, setAllAuctions] = useState([]);
  const [nextRaces, setNextRaces] = useState([]);
  const [standings, setStandings] = useState([]);
  const [board, setBoard] = useState(null);
  const [boardOutlook, setBoardOutlook] = useState(null);
  const [activeOffers, setActiveOffers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [transferWindow, setTransferWindow] = useState(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [{ data: { user } }, { data: { session } }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getSession(),
    ]);
    const { data: teamData } = await supabase
      .from("teams").select("*").eq("user_id", user.id).single();
    if (!teamData) { setLoading(false); return; }
    setTeam(teamData);

    const { data: activeSeason } = await supabase
      .from("seasons").select("id")
      .eq("status", "active")
      .single();

    const token = session?.access_token;
    const boardStatusPromise = token
      ? fetch(`${API}/api/board/status`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(async (response) => (response.ok ? response.json() : null))
      : Promise.resolve(null);

    const [teamsRes, ridersRes, pendingIncomingRes, loansInRes, auctionsRes, racesRes, standingsRes, boardStatus, offersRes] = await Promise.all([
      supabase.from("teams")
        .select("id, name, division, is_ai")
        .eq("is_ai", false)
        .order("division")
        .order("name"),
      supabase.from("riders").select("id, uci_points, salary, is_u25, pending_team_id")
        .eq("team_id", teamData.id),
      supabase.from("riders")
        .select("id", { count: "exact", head: true })
        .eq("pending_team_id", teamData.id)
        .neq("team_id", teamData.id),
      supabase.from("loan_agreements")
        .select("id", { count: "exact", head: true })
        .eq("to_team_id", teamData.id)
        .eq("status", "active"),
      supabase.from("auctions")
        .select("id, current_price, calculated_end, status, seller_team_id, current_bidder_id, rider:rider_id(firstname, lastname, team_id)")
        .in("status", ["active", "extended"]),
      supabase.from("races").select("*").not("status", "eq", "completed")
        .order("start_date", { ascending: true, nullsFirst: false }).limit(3),
      activeSeason
        ? supabase.from("season_standings")
            .select("*, team:team_id(id, name, division, is_ai)")
            .eq("season_id", activeSeason.id)
            .order("total_points", { ascending: false })
        : Promise.resolve({ data: [] }),
      boardStatusPromise,
      supabase.from("transfer_offers")
        .select("id, offer_amount, status, listing:listing_id(rider:rider_id(firstname, lastname), seller_team_id), buyer:buyer_team_id(name)")
        .eq("status", "pending")
        .or(`buyer_team_id.eq.${teamData.id},listing_id.in.(select id from transfer_listings where seller_team_id = '${teamData.id}')`),
    ]);

    setRiders(ridersRes.data || []);
    setPendingIncomingCount(pendingIncomingRes.count || 0);
    setActiveLoanCount(loansInRes.count || 0);
    setAllAuctions(auctionsRes.data || []);
    setNextRaces(racesRes.data || []);
    const activePlan = boardStatus?.plans?.["1yr"] || boardStatus?.plans?.["3yr"] || boardStatus?.plans?.["5yr"] || null;
    setBoard(activePlan?.board || null);
    setBoardOutlook(activePlan?.outlook || null);
    setActiveOffers(offersRes.data || []);

    const standingsMap = {};
    (standingsRes.data || []).filter(s => !s.team?.is_ai).forEach(s => {
      standingsMap[s.team_id] = s;
    });
    const mergedStandings = (teamsRes.data || []).map(otherTeam => (
      standingsMap[otherTeam.id] || {
        id: otherTeam.id,
        team_id: otherTeam.id,
        division: otherTeam.division,
        team: otherTeam,
        total_points: 0,
        stage_wins: 0,
        gc_wins: 0,
        races_completed: 0,
      }
    ));
    setStandings(mergedStandings);

    // Transfer window status
    const { data: tw } = await supabase
      .from("transfer_windows").select("*")
      .order("created_at", { ascending: false }).limit(1).single();
    setTransferWindow(tw);

    // Onboarding — show if user has no riders
    const riderCount = (ridersRes.data || []).length;
    if (riderCount === 0 && !localStorage.getItem("cz_onboarding_done")) {
      setIsNewUser(true);
      setShowOnboarding(true);
    }

    setLoading(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-slate-200 border-t-amber-700 rounded-full animate-spin" />
    </div>
  );

  const winningAuctions = allAuctions.filter(a => a.current_bidder_id === team?.id);
  const myAuctions = allAuctions.filter(a => isAuctionSeller(a, team?.id));
  const satisfactionColor = board?.satisfaction >= 70 ? "text-green-700" : board?.satisfaction >= 40 ? "text-amber-700" : "text-red-700";

  // Squad warnings
  const limits = SQUAD_LIMITS[team?.division] || SQUAD_LIMITS[3];
  const riderCount = riders.length + pendingIncomingCount + activeLoanCount;
  const squadWarning = riderCount > limits.max ? { type: "over", msg: `Hold er for stort — max ${limits.max} i Division ${team?.division}. Sælg ${riderCount - limits.max} ryttere.`, color: "red" }
    : riderCount < limits.min ? { type: "under", msg: `Hold er for lille — min ${limits.min} i Division ${team?.division}. Køb ${limits.min - riderCount} ryttere mere.`, color: "orange" }
    : null;

  // My division standings
  const myStanding = standings.find(s => s.team_id === team?.id);
  const divStandings = standings.filter(s => !s.team?.is_ai && s.division === team?.division)
    .sort((a, b) => b.total_points - a.total_points).slice(0, 5);

  const totalSalary = riders.reduce((s, r) => s + (r.salary || 0), 0);
  const pendingIncoming = pendingIncomingCount;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{team?.name}</h1>
          <p className="text-slate-400 text-sm">Division {team?.division} · {riderCount} ryttere</p>
        </div>
        <div className="text-right">
          <p className="text-amber-700 font-mono font-bold text-xl">{team?.balance?.toLocaleString("da-DK")} CZ$</p>
          <p className="text-slate-400 text-xs">Balance</p>
        </div>
      </div>

      {/* Squad warning */}
      {squadWarning && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm border flex items-center gap-2
          ${squadWarning.color === "red"
            ? "bg-red-50 text-red-700 border-red-200"
            : "bg-orange-50 text-orange-700 border-orange-200"}`}>
          <span>⚠️</span>
          <span>{squadWarning.msg}</span>
          <Link to="/team" className="ml-auto text-xs underline opacity-70 hover:opacity-100">Mit Hold →</Link>
        </div>
      )}

      {/* Deadline Day banner */}
      {transferWindow?.status === "open" && (() => {
        const closes = transferWindow.closes_at ? new Date(transferWindow.closes_at) : null;
        if (!closes) return null;
        const diff = closes - new Date();
        if (diff <= 0 || diff > 86400000 * 2) return null; // Only show last 48h
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        return (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl
            flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-2">
              <span className="text-red-700 text-lg">🔔</span>
              <div>
                <p className="text-red-700 font-bold text-sm">DEADLINE DAY</p>
                <p className="text-red-700/70 text-xs">Transfervinduet lukker om {h}t {m}m</p>
              </div>
            </div>
            <Link to="/transfers"
              className="px-3 py-1.5 bg-red-100 text-red-700 border border-red-500/30
                rounded-lg text-xs font-bold hover:bg-red-500/30 transition-all">
              Gå til transfers →
            </Link>
          </div>
        );
      })()}

      {/* Onboarding guide for new users */}
      {showOnboarding && (
        <div className="mb-4 bg-white border border-amber-200 rounded-xl p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-amber-700 font-bold text-sm">🚴 Velkommen til Cycling Zone!</p>
              <p className="text-slate-500 text-xs mt-0.5">Kom i gang med disse tre trin</p>
            </div>
            <button onClick={() => { setShowOnboarding(false); localStorage.setItem("cz_onboarding_done", "1"); }}
              className="text-slate-300 hover:text-slate-500 text-xl">×</button>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { step: "1", title: "Find ryttere", desc: "Gå til Ryttere og filtrer på stats og pris", link: "/riders", linkLabel: "Åbn ryttere →" },
              { step: "2", title: "Start en auktion", desc: "Klik på en fri rytter og tryk 'Start auktion'", link: "/riders", linkLabel: "Find fri rytter →" },
              { step: "3", title: "Følg med", desc: "Hold øje med dine bud under Auktioner", link: "/auctions", linkLabel: "Se auktioner →" },
            ].map(s => (
              <div key={s.step} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-full bg-amber-50 text-amber-700 text-xs
                    font-bold flex items-center justify-center">{s.step}</span>
                  <p className="text-slate-900 font-medium text-sm">{s.title}</p>
                </div>
                <p className="text-slate-500 text-xs mb-2">{s.desc}</p>
                <Link to={s.link} className="text-amber-700 text-xs hover:underline">{s.linkLabel}</Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Balance" value={`${team?.balance?.toLocaleString("da-DK")}`} sub="CZ$" accent="text-amber-700" icon="💰" />
        <StatCard label="Ryttere" value={riderCount} sub={`Løn: ${totalSalary.toLocaleString("da-DK")} CZ$/sæson`} icon="🚴" />
        <StatCard label="Aktive auktioner" value={allAuctions.length} sub={`${winningAuctions.length} vinder jeg`} icon="⚡" accent={winningAuctions.length > 0 ? "text-green-700" : "text-slate-900"} />
        <StatCard label="Bestyrelsestilfredshed" value={board ? `${board.satisfaction}%` : "—"} sub={board?.focus?.replace(/_/g, " ") || "Ingen data"} accent={satisfactionColor} icon="◉" />
      </div>

      {/* Main grid */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* My auctions + winning */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 text-sm">Aktive Auktioner</h2>
            <Link to="/auctions" className="text-xs text-amber-700 hover:underline">Se alle →</Link>
          </div>
          {allAuctions.length === 0 ? (
            <p className="text-slate-300 text-sm text-center py-4">Ingen aktive auktioner</p>
          ) : (
            <div className="flex flex-col gap-2">
              {[...winningAuctions, ...myAuctions.filter(a => a.current_bidder_id !== team?.id)]
                .slice(0, 5).map(a => {
                  const isWinning = a.current_bidder_id === team?.id;
                  const isSelling = isAuctionSeller(a, team?.id);
                  const diff = new Date(a.calculated_end) - new Date();
                  const h = Math.floor(diff / 3600000);
                  const m = Math.floor((diff % 3600000) / 60000);
                  const timeLeft = diff < 0 ? "Udløbet" : h > 0 ? `${h}t ${m}m` : `${m}m`;
                  const urgent = diff > 0 && diff < 600000;
                  return (
                    <div key={a.id} onClick={() => navigate("/auctions")}
                      className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-100 rounded px-1 -mx-1 transition-all">
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-900 text-sm truncate">{a.rider?.firstname} {a.rider?.lastname}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {isWinning && <span className="text-[9px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">Vinder</span>}
                          {isSelling && !isWinning && <span className="text-[9px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">Sælger</span>}
                        </div>
                      </div>
                      <div className="text-right ml-3">
                        <p className="text-amber-700 font-mono text-sm font-bold">{a.current_price?.toLocaleString("da-DK")} CZ$</p>
                        <p className={`text-xs font-mono ${urgent ? "text-red-700 animate-pulse" : "text-slate-400"}`}>{timeLeft}</p>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Pending transfers + offers */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 text-sm">Transfers & Tilbud</h2>
            <Link to="/transfers" className="text-xs text-amber-700 hover:underline">Se alle →</Link>
          </div>
          {activeOffers.length === 0 && pendingIncoming === 0 ? (
            <p className="text-slate-300 text-sm text-center py-4">Ingen ventende transfers</p>
          ) : (
            <div className="flex flex-col gap-2">
              {pendingIncoming > 0 && (
                <div className="flex items-center gap-3 py-2 border-b border-slate-100">
                  <span className="text-green-700 text-lg">↓</span>
                  <p className="text-slate-900 text-sm">{pendingIncoming} indgående transfer{pendingIncoming > 1 ? "s" : ""}</p>
                  <span className="ml-auto text-[9px] bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">Afventer vindue</span>
                </div>
              )}
              {activeOffers.slice(0, 4).map(o => {
                const isReceived = o.listing?.seller_team_id === team?.id;
                return (
                  <div key={o.id} onClick={() => navigate("/transfers")}
                    className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-100 rounded px-1 -mx-1">
                    <div>
                      <p className="text-slate-900 text-sm">{o.listing?.rider?.firstname} {o.listing?.rider?.lastname}</p>
                      <p className="text-slate-400 text-xs">{isReceived ? `Fra: ${o.buyer?.name}` : "Sendt tilbud"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-amber-700 font-mono text-sm">{o.offer_amount?.toLocaleString("da-DK")} CZ$</p>
                      {isReceived && <span className="text-[9px] text-orange-700">Afventer svar</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Upcoming races */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 text-sm">Kommende Løb</h2>
            <Link to="/races" className="text-xs text-amber-700 hover:underline">Kalender →</Link>
          </div>
          {nextRaces.length === 0 ? (
            <p className="text-slate-300 text-sm text-center py-4">Ingen planlagte løb</p>
          ) : (
            <div className="flex flex-col gap-2">
              {nextRaces.map((race, i) => (
                <div key={race.id}
                  className={`flex items-center justify-between py-2.5 ${i < nextRaces.length - 1 ? "border-b border-slate-100" : ""}`}>
                  <div>
                    <p className="text-slate-900 text-sm font-medium">{race.name}</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {race.race_type === "stage_race" ? `${race.stages} etaper` : "Enkeltdagsløb"}
                    </p>
                  </div>
                  <div className="text-right">
                    {race.start_date
                      ? <p className="text-slate-500 text-sm">{new Date(race.start_date).toLocaleDateString("da-DK", { day: "numeric", month: "short" })}</p>
                      : <p className="text-slate-300 text-sm">Dato TBD</p>}
                    <p className="text-amber-700 text-xs font-mono">{race.prize_pool?.toLocaleString("da-DK")} CZ$</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* My division standings */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 text-sm">Division {team?.division} — Stilling</h2>
            <Link to="/standings" className="text-xs text-amber-700 hover:underline">Fuld rangliste →</Link>
          </div>
          {divStandings.length === 0 ? (
            <p className="text-slate-300 text-sm text-center py-4">Ingen sæsondata endnu</p>
          ) : (
            <div className="flex flex-col gap-1">
              {divStandings.map((s, i) => {
                const isMe = s.team_id === team?.id;
                const maxPts = divStandings[0]?.total_points || 1;
                return (
                  <div key={s.id} className={`flex items-center gap-3 py-1.5 ${isMe ? "bg-amber-50 -mx-2 px-2 rounded-lg" : ""}`}>
                    <span className={`font-mono text-xs w-4 text-right flex-shrink-0 ${isMe ? "text-amber-700" : "text-slate-400"}`}>#{i+1}</span>
                    <p className={`text-sm w-28 truncate flex-shrink-0 ${isMe ? "text-amber-700 font-medium" : "text-slate-600"}`}>{s.team?.name}</p>
                    <div className="flex-1">
                      <MiniBar value={s.total_points || 0} max={maxPts} color={isMe ? "#e8c547" : "#cbd5e1"} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Board status */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 text-sm">Bestyrelsens Status</h2>
            <Link to="/board" className="text-xs text-amber-700 hover:underline">Detaljer →</Link>
          </div>
          {!board ? (
            <p className="text-slate-300 text-sm text-center py-4">Ingen bestyrelsesdata</p>
          ) : (
            <div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Tilfredshed</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-slate-100 rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all
                        ${board.satisfaction >= 70 ? "bg-green-400" : board.satisfaction >= 40 ? "bg-[#e8c547]" : "bg-red-400"}`}
                        style={{ width: `${board.satisfaction}%` }} />
                    </div>
                    <span className={`font-mono font-bold text-sm ${satisfactionColor}`}>{board.satisfaction}%</span>
                  </div>
                </div>
                <div>
                  <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Fokus</p>
                  <p className="text-slate-900 text-sm capitalize">{board.focus?.replace(/_/g, " ") || "—"}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Budget multiplikator</p>
                  <p className={`font-mono font-bold text-sm ${board.budget_modifier >= 1 ? "text-green-700" : "text-red-700"}`}>
                    ×{board.budget_modifier?.toFixed(2) || "1.00"}
                  </p>
                </div>
              </div>
              {boardOutlook?.feedback && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <p className="text-slate-900 text-sm font-medium">{boardOutlook.feedback.headline}</p>
                  <p className="text-slate-500 text-xs mt-1">{boardOutlook.feedback.summary}</p>
                  <div className="grid sm:grid-cols-4 gap-3 mt-3">
                    {Object.values(boardOutlook.score_breakdown?.categories || {}).map((category) => (
                      <div key={category.key} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-slate-400 text-[10px] uppercase tracking-wider">{category.label}</p>
                          <span className="text-slate-500 text-[10px] font-mono">{category.score_pct}%</span>
                        </div>
                        <div className="bg-slate-100 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${category.score_pct >= 75 ? "bg-green-400" : category.score_pct >= 55 ? "bg-[#e8c547]" : "bg-red-400"}`}
                            style={{ width: `${Math.min(100, category.score_pct)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
