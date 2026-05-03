import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { getFlagEmoji } from "../lib/countryUtils";

function TeamSearch({ label, onSelect, excluded, autoSuggest = false }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);

  async function fetchTeams(pattern) {
    const { data } = await supabase.from("teams")
      .select("id, name, division").eq("is_ai", false)
      .ilike("name", `%${pattern}%`).order("name").limit(6);
    setResults((data || []).filter(t => t.id !== excluded));
  }

  useEffect(() => {
    if (q.length < 1) { setResults([]); return; }
    const t = setTimeout(() => fetchTeams(q), 200);
    return () => clearTimeout(t);
  }, [q, excluded]);

  function handleFocus() {
    if (autoSuggest && q.length === 0) fetchTeams("");
  }

  function handleBlur() {
    setTimeout(() => setResults([]), 150);
  }

  return (
    <div className="relative">
      <label className="block text-cz-3 text-xs uppercase tracking-wider mb-2">{label}</label>
      <input type="text" value={q} onChange={e => setQ(e.target.value)}
        onFocus={handleFocus} onBlur={handleBlur}
        placeholder="Søg hold..."
        className="w-full bg-cz-card border border-cz-border rounded-xl px-4 py-3
          text-cz-1 placeholder-cz-3 focus:outline-none focus:border-cz-accent" />
      {results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-cz-card border border-cz-border
          rounded-xl z-20 overflow-hidden shadow-2xl">
          {results.map(t => (
            <div key={t.id}
              className="px-4 py-3 hover:bg-cz-subtle cursor-pointer border-b border-cz-border last:border-0"
              onClick={() => { onSelect(t); setQ(t.name); setResults([]); }}>
              <p className="text-cz-1 font-medium text-sm">{t.name}</p>
              <p className="text-cz-3 text-xs">Division {t.division}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HeadToHeadPage() {
  const navigate = useNavigate();
  const [teamA, setTeamA] = useState(null);
  const [teamB, setTeamB] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Default: load my team as teamA
    supabase.auth.getUser().then(({ data: { user } }) => {
      supabase.from("teams").select("id, name, division").eq("user_id", user.id).single()
        .then(({ data }) => { if (data) setTeamA(data); });
    });
  }, []);

  useEffect(() => {
    if (teamA && teamB) loadStats();
  }, [teamA, teamB]);

  async function loadStats() {
    setLoading(true);
    const [standingsRes, auctionsRes, ridersARes, ridersBRes] = await Promise.all([
      supabase.from("season_standings")
        .select("*, season:season_id(number)")
        .in("team_id", [teamA.id, teamB.id])
        .order("season_id"),

      // Auctions where one team bought from the other
      supabase.from("auctions")
        .select("id, current_price, seller_team_id, current_bidder_id, rider:rider_id(firstname, lastname)")
        .eq("status", "completed")
        .or(`and(seller_team_id.eq.${teamA.id},current_bidder_id.eq.${teamB.id}),and(seller_team_id.eq.${teamB.id},current_bidder_id.eq.${teamA.id})`),

      supabase.from("riders").select("id, firstname, lastname, uci_points, nationality_code").eq("team_id", teamA.id).order("uci_points", { ascending: false }).limit(5),
      supabase.from("riders").select("id, firstname, lastname, uci_points, nationality_code").eq("team_id", teamB.id).order("uci_points", { ascending: false }).limit(5),
    ]);

    const standingsA = standingsRes.data?.filter(s => s.team_id === teamA.id) || [];
    const standingsB = standingsRes.data?.filter(s => s.team_id === teamB.id) || [];

    const h2hAuctions = auctionsRes.data || [];
    const aBoughtFromB = h2hAuctions.filter(a => a.seller_team_id === teamB.id && a.current_bidder_id === teamA.id);
    const bBoughtFromA = h2hAuctions.filter(a => a.seller_team_id === teamA.id && a.current_bidder_id === teamB.id);

    setStats({
      standingsA, standingsB,
      totalPointsA: standingsA.reduce((s, r) => s + (r.total_points || 0), 0),
      totalPointsB: standingsB.reduce((s, r) => s + (r.total_points || 0), 0),
      stageWinsA: standingsA.reduce((s, r) => s + (r.stage_wins || 0), 0),
      stageWinsB: standingsB.reduce((s, r) => s + (r.stage_wins || 0), 0),
      gcWinsA: standingsA.reduce((s, r) => s + (r.gc_wins || 0), 0),
      gcWinsB: standingsB.reduce((s, r) => s + (r.gc_wins || 0), 0),
      aBoughtFromB, bBoughtFromA,
      topRidersA: ridersARes.data || [],
      topRidersB: ridersBRes.data || [],
    });
    setLoading(false);
  }

  function StatCompare({ labelA, valueA, valueB, labelB, unit = "", higherIsBetter = true }) {
    const aWins = higherIsBetter ? valueA > valueB : valueA < valueB;
    const bWins = higherIsBetter ? valueB > valueA : valueB < valueA;
    const maxVal = Math.max(valueA, valueB, 1);
    return (
      <div className="py-3 border-b border-cz-border last:border-0">
        <div className="flex items-center justify-between mb-2">
          <span className={`font-mono font-bold text-sm ${aWins ? "text-cz-accent-t" : "text-cz-2"}`}>
            {valueA?.toLocaleString("da-DK")}{unit}
          </span>
          <span className="text-cz-3 text-xs uppercase tracking-wider">{labelA || labelB}</span>
          <span className={`font-mono font-bold text-sm ${bWins ? "text-cz-accent-t" : "text-cz-2"}`}>
            {valueB?.toLocaleString("da-DK")}{unit}
          </span>
        </div>
        <div className="flex gap-1 h-2">
          <div className="flex-1 bg-cz-subtle rounded-l-full overflow-hidden flex justify-end">
            <div className="h-2 rounded-l-full bg-cz-accent/60 transition-all"
              style={{ width: `${(valueA / maxVal) * 100}%` }} />
          </div>
          <div className="flex-1 bg-cz-subtle rounded-r-full overflow-hidden">
            <div className="h-2 rounded-r-full bg-blue-300 transition-all"
              style={{ width: `${(valueB / maxVal) * 100}%` }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">Head-to-Head</h1>
        <p className="text-cz-3 text-sm">Sammenlign to managers historik</p>
      </div>

      {/* Team selection */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <TeamSearch label="Hold A" onSelect={setTeamA} excluded={teamB?.id} />
        <TeamSearch label="Hold B" onSelect={setTeamB} excluded={teamA?.id} autoSuggest />
      </div>

      {teamA && teamB && (
        <div className="mb-6 flex items-center justify-center gap-4">
          <div className="text-center">
            <p className="text-cz-accent-t font-bold text-lg">{teamA.name}</p>
            <p className="text-cz-3 text-xs">Division {teamA.division}</p>
          </div>
          <span className="text-cz-3 text-2xl font-bold">VS</span>
          <div className="text-center">
            <p className="text-cz-info font-bold text-lg">{teamB.name}</p>
            <p className="text-cz-3 text-xs">Division {teamB.division}</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
        </div>
      )}

      {!loading && stats && (
        <div className="flex flex-col gap-4">
          {/* Stat comparison */}
          <div className="bg-cz-card border border-cz-border rounded-xl p-5">
            <h2 className="text-cz-1 font-semibold text-sm mb-4">Sæsonstatistik (alle sæsoner)</h2>
            <StatCompare labelA="Point" valueA={stats.totalPointsA} valueB={stats.totalPointsB} />
            <StatCompare labelA="Etapesejre" valueA={stats.stageWinsA} valueB={stats.stageWinsB} />
            <StatCompare labelA="GC-sejre" valueA={stats.gcWinsA} valueB={stats.gcWinsB} />
            <StatCompare labelA="Sæsoner" valueA={stats.standingsA.length} valueB={stats.standingsB.length} />
          </div>

          {/* Transfer history between them */}
          {(stats.aBoughtFromB.length > 0 || stats.bBoughtFromA.length > 0) && (
            <div className="bg-cz-card border border-cz-border rounded-xl p-5">
              <h2 className="text-cz-1 font-semibold text-sm mb-4">Transferhistorik mellem holdene</h2>
              {stats.aBoughtFromB.length > 0 && (
                <div className="mb-3">
                  <p className="text-cz-2 text-xs mb-2">{teamA.name} har købt fra {teamB.name}:</p>
                  {stats.aBoughtFromB.map(a => (
                    <div key={a.id} className="flex justify-between py-1.5 border-b border-cz-border last:border-0">
                      <span className="text-cz-1 text-sm">{a.rider?.firstname} {a.rider?.lastname}</span>
                      <span className="text-cz-accent-t font-mono text-sm">{a.current_price?.toLocaleString("da-DK")} CZ$</span>
                    </div>
                  ))}
                </div>
              )}
              {stats.bBoughtFromA.length > 0 && (
                <div>
                  <p className="text-cz-2 text-xs mb-2">{teamB.name} har købt fra {teamA.name}:</p>
                  {stats.bBoughtFromA.map(a => (
                    <div key={a.id} className="flex justify-between py-1.5 border-b border-cz-border last:border-0">
                      <span className="text-cz-1 text-sm">{a.rider?.firstname} {a.rider?.lastname}</span>
                      <span className="text-cz-info font-mono text-sm">{a.current_price?.toLocaleString("da-DK")} CZ$</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Current squads */}
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { team: teamA, riders: stats.topRidersA, color: "#e8c547" },
              { team: teamB, riders: stats.topRidersB, color: "#60a5fa" },
            ].map(({ team, riders, color }) => (
              <div key={team.id} className="bg-cz-card border border-cz-border rounded-xl p-4">
                <h3 className="font-semibold text-sm mb-3 cursor-pointer hover:underline"
                  style={{ color }} onClick={() => navigate(`/teams/${team.id}`)}>
                  {team.name} — Top 5
                </h3>
                {riders.length === 0 ? (
                  <p className="text-cz-3 text-xs">Ingen ryttere</p>
                ) : (
                  riders.map((r, i) => (
                    <div key={r.id} className="flex justify-between py-1.5 border-b border-cz-border last:border-0">
                      <span className="text-cz-2 text-xs cursor-pointer hover:text-cz-1 flex items-center gap-1"
                        onClick={() => navigate(`/riders/${r.id}`)}>
                        {i + 1}. {r.nationality_code && getFlagEmoji(r.nationality_code)} {r.firstname} {r.lastname}
                      </span>
                      <span className="font-mono text-xs" style={{ color }}>
                        {r.uci_points?.toLocaleString("da-DK")}
                      </span>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !stats && teamA && !teamB && (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">⚔</p>
          <p>Vælg et andet hold for at starte sammenligningen</p>
        </div>
      )}
    </div>
  );
}
