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

function AuctionCard({ auction }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    function update() {
      const end = new Date(auction.calculated_end);
      const diff = end - new Date();
      if (diff <= 0) { setTimeLeft("Afsluttet"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (h > 0) setTimeLeft(`${h}t ${m}m`);
      else if (m > 0) setTimeLeft(`${m}m ${s}s`);
      else setTimeLeft(`${s}s`);
    }
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [auction.calculated_end]);

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
      <div>
        <p className="text-white text-sm font-medium">
          {auction.rider?.firstname} {auction.rider?.lastname}
        </p>
        <p className="text-white/40 text-xs">{auction.seller?.name}</p>
      </div>
      <div className="text-right">
        <p className="text-[#e8c547] font-mono text-sm font-bold">
          {auction.current_price} pts
        </p>
        <p className="text-white/30 text-xs">{timeLeft}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [team, setTeam] = useState(null);
  const [board, setBoard] = useState(null);
  const [auctions, setAuctions] = useState([]);
  const [nextRace, setNextRace] = useState(null);
  const [recentResults, setRecentResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();

    const [teamRes, auctionsRes, racesRes] = await Promise.all([
      supabase.from("teams").select("*").eq("user_id", user.id).single(),
      supabase.from("auctions")
        .select(`id, current_price, calculated_end, status,
          rider:rider_id(firstname, lastname),
          seller:seller_team_id(name),
          current_bidder:current_bidder_id(name)`)
        .in("status", ["active", "extended"])
        .order("calculated_end", { ascending: true })
        .limit(5),
      supabase.from("races")
        .select("*")
        .gte("start_date", new Date().toISOString().split("T")[0])
        .eq("status", "scheduled")
        .order("start_date")
        .limit(1),
    ]);

    setTeam(teamRes.data);
    setAuctions(auctionsRes.data || []);
    setNextRace(racesRes.data?.[0] || null);

    if (teamRes.data) {
      const [boardRes] = await Promise.all([
        supabase.from("board_profiles").select("*").eq("team_id", teamRes.data.id).single(),
      ]);
      setBoard(boardRes.data);
    }

    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const satisfactionColor = !board ? "text-white/40" :
    board.satisfaction >= 70 ? "text-green-400" :
    board.satisfaction >= 40 ? "text-[#e8c547]" : "text-red-400";

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">
          {team?.name || "Mit Hold"}
        </h1>
        <p className="text-white/40 text-sm mt-0.5">Manager Dashboard</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Balance"
          value={team?.balance != null ? `${team.balance.toLocaleString("da-DK")}` : "—"}
          sub="point"
          accent="text-[#e8c547]"
          icon="◈"
        />
        <StatCard
          label="Næste løb"
          value={nextRace ? new Date(nextRace.start_date).toLocaleDateString("da-DK", { day: "numeric", month: "short" }) : "Ingen planlagt"}
          sub={nextRace?.name || ""}
          icon="🏁"
        />
        <StatCard
          label="Aktive auktioner"
          value={auctions.length}
          sub="åbne bud"
          icon="⚡"
        />
        <StatCard
          label="Bestyrelses­tilfredshed"
          value={board ? `${board.satisfaction}%` : "—"}
          sub={board?.focus?.replace("_", " ") || ""}
          accent={satisfactionColor}
          icon="◉"
        />
      </div>

      {/* Two-column layout */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Active auctions */}
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white text-sm">Aktive Auktioner</h2>
            <Link to="/auctions" className="text-xs text-[#e8c547] hover:underline">
              Se alle →
            </Link>
          </div>
          {auctions.length === 0 ? (
            <p className="text-white/30 text-sm py-4 text-center">
              Ingen aktive auktioner
            </p>
          ) : (
            auctions.map(a => <AuctionCard key={a.id} auction={a} />)
          )}
        </div>

        {/* Race calendar */}
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white text-sm">Løbskalender</h2>
          </div>
          {!nextRace ? (
            <p className="text-white/30 text-sm py-4 text-center">
              Ingen kommende løb planlagt
            </p>
          ) : (
            <div>
              <div className="flex items-start gap-3 py-3">
                <div className="w-10 h-10 rounded-lg bg-[#e8c547]/10 border border-[#e8c547]/20
                  flex items-center justify-center text-[#e8c547] text-xl flex-shrink-0">
                  🏁
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{nextRace.name}</p>
                  <p className="text-white/40 text-xs mt-0.5">
                    {new Date(nextRace.start_date).toLocaleDateString("da-DK", {
                      weekday: "long", day: "numeric", month: "long"
                    })}
                  </p>
                  <div className="flex gap-2 mt-1.5">
                    <span className="text-[10px] uppercase tracking-wider bg-white/5
                      px-2 py-0.5 rounded text-white/40">
                      {nextRace.race_type === "stage_race" ? `${nextRace.stages} etaper` : "Enkeltdags"}
                    </span>
                    {nextRace.prize_pool > 0 && (
                      <span className="text-[10px] uppercase tracking-wider
                        bg-[#e8c547]/10 px-2 py-0.5 rounded text-[#e8c547]">
                        {nextRace.prize_pool.toLocaleString()} pts præmiepulje
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Board status */}
        {board && (
          <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 lg:col-span-2">
            <h2 className="font-semibold text-white text-sm mb-4">Bestyrelsens Status</h2>
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
                <p className="text-white text-sm font-medium capitalize">
                  {board.focus?.replace(/_/g, " ") || "—"}
                </p>
              </div>
              <div className="bg-white/3 rounded-lg p-3">
                <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Plan</p>
                <p className="text-white text-sm font-medium">{board.plan_type || "—"}</p>
              </div>
              <div className="bg-white/3 rounded-lg p-3">
                <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Budget modifier</p>
                <p className={`text-sm font-medium font-mono ${
                  board.budget_modifier >= 1 ? "text-green-400" : "text-red-400"
                }`}>×{board.budget_modifier?.toFixed(2) || "1.00"}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
