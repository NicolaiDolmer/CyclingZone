import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";

function StatCard({ label, value, sub, accent, icon }) {
  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 hover:border-white/10 transition-all">
      <div className="flex items-start justify-between mb-3">
        <span className="text-white/30 text-xs uppercase tracking-widest">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <div className={`text-2xl font-bold font-mono ${accent || "text-white"}`}>
        {value ?? "—"}
      </div>
      {sub && <p className="text-white/30 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function AuctionCountdown({ end, status }) {
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    function update() {
      const diff = new Date(end) - new Date();
      if (diff <= 0) { setText("Afsluttet"); return; }
      setUrgent(diff < 600000);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (h > 0) setText(`${h}t ${m}m`);
      else if (m > 0) setText(`${m}m ${s}s`);
      else setText(`${s}s`);
    }
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [end]);

  return (
    <span className={`font-mono text-xs font-bold
      ${urgent ? "text-red-400" : "text-white/40"}
      ${status === "extended" ? "text-orange-400" : ""}`}>
      {text} {status === "extended" ? "⚡" : ""}
    </span>
  );
}

export default function DashboardPage() {
  const [team, setTeam] = useState(null);
  const [board, setBoard] = useState(null);
  const [myAuctions, setMyAuctions] = useState([]);
  const [allAuctions, setAllAuctions] = useState([]);
  const [nextRaces, setNextRaces] = useState([]);
  const [standing, setStanding] = useState(null);
  const [recentResults, setRecentResults] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams").select("*").eq("user_id", user.id).single();
    if (!t) { setLoading(false); return; }
    setTeam(t);

    const [boardRes, auctionsRes, racesRes, standingRes, notifRes] = await Promise.all([
      supabase.from("board_profiles").select("*").eq("team_id", t.id).single(),
      supabase.from("auctions")
        .select(`id, current_price, calculated_end, status, seller_team_id, current_bidder_id,
          rider:rider_id(firstname, lastname, uci_points),
          seller:seller_team_id(name),
          current_bidder:current_bidder_id(name)`)
        .in("status", ["active", "extended"])
        .order("calculated_end", { ascending: true })
        .limit(20),
      supabase.from("races")
        .select("*")
        .not("status", "eq", "completed")
        .order("start_date", { ascending: true, nullsFirst: false })
        .limit(3),
      supabase.from("season_standings")
        .select("*")
        .eq("team_id", t.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .single(),
      supabase.from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    setBoard(boardRes.data);
    setAllAuctions(auctionsRes.data || []);
    setMyAuctions((auctionsRes.data || []).filter(a =>
      a.seller_team_id === t.id || a.current_bidder_id === t.id
    ));
    setNextRaces(racesRes.data || []);
    setStanding(standingRes.data);
    setNotifications(notifRes.data || []);
    setLoading(false);
  }

  async function markNotifRead(id) {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const satisfactionColor = !board ? "text-white/40" :
    board.satisfaction >= 70 ? "text-green-400" :
    board.satisfaction >= 40 ? "text-[#e8c547]" : "text-red-400";

  const winningAuctions = allAuctions.filter(a => a.current_bidder_id === team?.id);
  const myListedAuctions = allAuctions.filter(a => a.seller_team_id === team?.id);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">{team?.name || "Mit Hold"}</h1>
        <p className="text-white/40 text-sm mt-0.5">Manager Dashboard</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Balance" value={team?.balance != null ? team.balance.toLocaleString("da-DK") : "—"} sub="point" accent="text-[#e8c547]" icon="◈" />
        <StatCard label="Næste løb" value={nextRaces[0] ? new Date(nextRaces[0].start_date).toLocaleDateString("da-DK", { day: "numeric", month: "short" }) : "Ingen"} sub={nextRaces[0]?.name || "Ingen planlagt"} icon="🏁" />
        <StatCard label="Aktive auktioner" value={allAuctions.length} sub={`${winningAuctions.length} vinder jeg`} icon="⚡" />
        <StatCard label="Bestyrelsestilfredshed" value={board ? `${board.satisfaction}%` : "—"} sub={board?.focus?.replace(/_/g, " ") || ""} accent={satisfactionColor} icon="◉" />
      </div>

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="mb-5 flex flex-col gap-2">
          {notifications.map(n => (
            <div key={n.id} className="bg-[#e8c547]/5 border border-[#e8c547]/15 rounded-xl px-4 py-3
              flex items-start justify-between gap-3">
              <div>
                <p className="text-white text-sm font-medium">{n.title}</p>
                <p className="text-white/40 text-xs mt-0.5">{n.message}</p>
              </div>
              <button onClick={() => markNotifRead(n.id)}
                className="text-white/20 hover:text-white text-lg flex-shrink-0">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* My auctions — ones I'm winning or selling */}
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white text-sm">Mine Auktioner</h2>
            <Link to="/auctions" className="text-xs text-[#e8c547] hover:underline">Se alle →</Link>
          </div>
          {myAuctions.length === 0 ? (
            <p className="text-white/20 text-sm text-center py-6">Ingen aktive auktioner du er involveret i</p>
          ) : (
            myAuctions.slice(0, 5).map(a => (
              <div key={a.id} className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
                <div>
                  <p className="text-white text-sm font-medium">
                    {a.rider?.firstname} {a.rider?.lastname}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {a.seller_team_id === team?.id && (
                      <span className="text-[9px] uppercase bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">Sælger</span>
                    )}
                    {a.current_bidder_id === team?.id && (
                      <span className="text-[9px] uppercase bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded">Vinder</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[#e8c547] font-mono text-sm font-bold">
                    {a.current_price?.toLocaleString("da-DK")} CZ$
                  </p>
                  <AuctionCountdown end={a.calculated_end} status={a.status} />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Race calendar */}
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white text-sm">Kommende Løb</h2>
          </div>
          {nextRaces.length === 0 ? (
            <p className="text-white/20 text-sm text-center py-6">Ingen kommende løb planlagt</p>
          ) : (
            nextRaces.map((race, i) => (
              <div key={race.id} className={`flex items-start gap-3 py-3 ${i < nextRaces.length - 1 ? "border-b border-white/5" : ""}`}>
                <div className="w-10 h-10 rounded-lg bg-[#e8c547]/10 border border-[#e8c547]/20
                  flex items-center justify-center text-xl flex-shrink-0">
                  {i === 0 ? "🏁" : "📅"}
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{race.name}</p>
                  <p className="text-white/40 text-xs mt-0.5">
                    {new Date(race.start_date).toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" })}
                  </p>
                  <div className="flex gap-2 mt-1.5">
                    <span className="text-[10px] uppercase tracking-wider bg-white/5 px-2 py-0.5 rounded text-white/40">
                      {race.race_type === "stage_race" ? `${race.stages} etaper` : "Enkeltdags"}
                    </span>
                    {race.prize_pool > 0 && (
                      <span className="text-[10px] uppercase tracking-wider bg-[#e8c547]/10 px-2 py-0.5 rounded text-[#e8c547]">
                        {race.prize_pool.toLocaleString()} CZ$
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Season standing */}
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white text-sm">Sæsonresultater</h2>
            <Link to="/standings" className="text-xs text-[#e8c547] hover:underline">Rangliste →</Link>
          </div>
          {!standing ? (
            <p className="text-white/20 text-sm text-center py-6">Ingen sæsonresultater endnu</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Point", value: standing.total_points?.toLocaleString("da-DK"), color: "text-[#e8c547]" },
                { label: "Etapesejre", value: standing.stage_wins, color: "text-white" },
                { label: "GC-sejre", value: standing.gc_wins, color: "text-white" },
              ].map(s => (
                <div key={s.label} className="bg-white/3 rounded-lg p-3 text-center">
                  <p className="text-white/30 text-xs uppercase tracking-wider mb-1">{s.label}</p>
                  <p className={`font-mono font-bold text-lg ${s.color}`}>{s.value ?? 0}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Board status */}
        {board && (
          <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white text-sm">Bestyrelsens Status</h2>
              <Link to="/board" className="text-xs text-[#e8c547] hover:underline">Detaljer →</Link>
            </div>
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1 bg-white/5 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-500
                    ${board.satisfaction >= 70 ? "bg-green-400" :
                      board.satisfaction >= 40 ? "bg-[#e8c547]" : "bg-red-400"}`}
                  style={{ width: `${board.satisfaction}%` }}
                />
              </div>
              <span className={`font-mono text-sm font-bold ${satisfactionColor}`}>
                {board.satisfaction}%
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/3 rounded-lg p-3">
                <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Fokus</p>
                <p className="text-white text-sm font-medium capitalize">{board.focus?.replace(/_/g, " ") || "—"}</p>
              </div>
              <div className="bg-white/3 rounded-lg p-3">
                <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Plan</p>
                <p className="text-white text-sm font-medium">{board.plan_type || "—"}</p>
              </div>
              <div className="bg-white/3 rounded-lg p-3">
                <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Sponsor mod.</p>
                <p className={`text-sm font-medium font-mono ${board.budget_modifier >= 1 ? "text-green-400" : "text-red-400"}`}>
                  ×{board.budget_modifier?.toFixed(2) || "1.00"}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
