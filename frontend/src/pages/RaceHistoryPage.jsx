import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { Link, useParams, useNavigate } from "react-router-dom";
import { getFlagEmoji } from "../lib/countryUtils";

export default function RaceHistoryPage() {
  const { raceSlug } = useParams();
  const navigate = useNavigate();
  const raceName = decodeURIComponent(raceSlug);

  const [editions, setEditions] = useState([]);
  const [riderStats, setRiderStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, [raceSlug]);

  async function loadAll() {
    setLoading(true);

    const { data: races } = await supabase
      .from("races")
      .select("id, name, race_type, stages, start_date, prize_pool, status, season:season_id(id, number, status)")
      .ilike("name", raceName)
      .order("start_date");

    if (!races?.length) { setLoading(false); return; }

    const raceIds = races.map(r => r.id);

    const { data: results } = await supabase
      .from("race_results")
      .select("race_id, result_type, rank, rider_id, rider_name, team_name, points_earned, prize_money, rider:rider_id(id, firstname, lastname, nationality_code, team:team_id(name))")
      .in("race_id", raceIds)
      .order("rank");

    const raceType = races[0].race_type;
    const primaryType = raceType === "stage_race" ? "gc" : "stage";

    const editionMap = {};
    races.forEach(r => { editionMap[r.id] = { ...r, winner: null }; });
    (results || []).forEach(res => {
      const ed = editionMap[res.race_id];
      if (!ed) return;
      if (res.rank === 1 && res.result_type === primaryType && !ed.winner) {
        ed.winner = res;
      }
    });

    setEditions(
      Object.values(editionMap).sort((a, b) => (a.season?.number || 0) - (b.season?.number || 0))
    );

    const riderMap = {};
    (results || []).forEach(res => {
      if (!res.rider_id) return;
      if (!riderMap[res.rider_id]) {
        riderMap[res.rider_id] = {
          rider: res.rider,
          rider_name: res.rider
            ? `${res.rider.firstname} ${res.rider.lastname}`
            : (res.rider_name || "—"),
          stage_wins: 0,
          gc_wins: 0,
          top3: 0,
          total_points: 0,
        };
      }
      const s = riderMap[res.rider_id];
      s.total_points += res.points_earned || 0;
      if (res.rank === 1 && res.result_type === "stage") s.stage_wins++;
      if (res.rank === 1 && res.result_type === "gc") s.gc_wins++;
      if (res.rank <= 3) s.top3++;
    });

    setRiderStats(
      Object.values(riderMap)
        .sort((a, b) => {
          const wA = a.gc_wins + a.stage_wins;
          const wB = b.gc_wins + b.stage_wins;
          if (wB !== wA) return wB - wA;
          return b.total_points - a.total_points;
        })
        .slice(0, 10)
    );

    setLoading(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  if (!editions.length) return (
    <div className="max-w-4xl mx-auto">
      <Link to="/race-archive" className="text-xs text-cz-accent-t hover:underline mb-4 inline-block">← Løbsarkiv</Link>
      <div className="text-center py-16 text-cz-3">
        <p className="text-4xl mb-3">🏁</p>
        <p>Ingen data fundet for "{raceName}"</p>
      </div>
    </div>
  );

  const maxPoints = riderStats[0]?.total_points || 1;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <Link to="/race-archive" className="text-xs text-cz-accent-t hover:underline mb-2 inline-block">← Løbsarkiv</Link>
        <h1 className="text-xl font-bold text-cz-1">{raceName}</h1>
        <p className="text-cz-3 text-sm">
          {editions[0].race_type === "stage_race"
            ? `Etapeløb · ${editions[0].stages} etaper`
            : "Enkeltdagsløb"}
          {" · "}{editions.length} {editions.length === 1 ? "udgave" : "udgaver"}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Editions list */}
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-cz-border">
            <h2 className="font-semibold text-cz-1 text-sm">Udgaver</h2>
          </div>
          <div className="divide-y divide-cz-border">
            {editions.map(ed => (
              <div key={ed.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-cz-2 text-sm font-medium">Sæson {ed.season?.number}</p>
                  {ed.start_date && (
                    <p className="text-cz-3 text-xs">
                      {new Date(ed.start_date).toLocaleDateString("da-DK", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  {ed.winner ? (
                    <div>
                      <p
                        className="text-cz-1 text-xs font-medium hover:text-cz-accent-t cursor-pointer transition-colors"
                        onClick={() => ed.winner?.rider?.id && navigate(`/riders/${ed.winner.rider.id}`)}>
                        {ed.winner.rider
                          ? `${ed.winner.rider.firstname} ${ed.winner.rider.lastname}`
                          : ed.winner.rider_name}
                      </p>
                      <p className="text-cz-3 text-[10px]">
                        {ed.winner.rider?.team?.name || ed.winner.team_name || "—"}
                      </p>
                    </div>
                  ) : (
                    <span className="text-cz-3 text-xs">Ingen resultater</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Best riders */}
        <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-cz-border">
            <h2 className="font-semibold text-cz-1 text-sm">Bedste ryttere</h2>
            <p className="text-cz-3 text-xs">Akkumuleret på tværs af alle udgaver</p>
          </div>
          {riderStats.length === 0 ? (
            <div className="px-4 py-8 text-center text-cz-3 text-sm">Ingen resultater endnu</div>
          ) : (
            <div className="divide-y divide-cz-border">
              {riderStats.map((s, i) => (
                <div
                  key={s.rider?.id || s.rider_name}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-cz-subtle cursor-pointer transition-colors"
                  onClick={() => s.rider?.id && navigate(`/riders/${s.rider.id}`)}>
                  <span className={`w-4 text-center font-mono font-bold text-xs flex-shrink-0
                    ${i === 0 ? "text-cz-accent-t" : "text-cz-3"}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-cz-1 text-xs font-medium truncate">
                      {s.rider?.nationality_code && (
                        <span className="mr-1">{getFlagEmoji(s.rider.nationality_code)}</span>
                      )}
                      {s.rider_name}
                    </p>
                    <p className="text-cz-3 text-[10px]">
                      {[
                        s.gc_wins > 0 && `${s.gc_wins} GC`,
                        s.stage_wins > 0 && `${s.stage_wins} etapesejre`,
                        s.top3 > 0 && `${s.top3} top-3`,
                      ].filter(Boolean).join(" · ") || "Ingen sejre"}
                    </p>
                  </div>
                  <span className="text-cz-accent-t font-mono text-xs font-bold flex-shrink-0">
                    {s.total_points.toLocaleString("da-DK")} pt
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Accumulated bar chart */}
      {riderStats.length > 0 && riderStats[0].total_points > 0 && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5">
          <h2 className="font-semibold text-cz-1 text-sm mb-0.5">Akkumuleret point-total</h2>
          <p className="text-cz-3 text-xs mb-5">Top ryttere efter samlede point på tværs af alle udgaver</p>
          <div className="space-y-3">
            {riderStats.map((s, i) => {
              const pct = maxPoints > 0 ? (s.total_points / maxPoints) * 100 : 0;
              const lastName = s.rider_name.split(" ").slice(-1)[0];
              const barColor = i === 0 ? "#e8c547" : i === 1 ? "#94a3b8" : i === 2 ? "#b45309" : "#e2e8f0";
              return (
                <div key={s.rider?.id || s.rider_name} className="flex items-center gap-3">
                  <div className="w-28 text-xs text-cz-2 truncate text-right flex-shrink-0">
                    {s.rider?.nationality_code && (
                      <span className="mr-0.5">{getFlagEmoji(s.rider.nationality_code)}</span>
                    )}
                    {lastName}
                  </div>
                  <div className="flex-1 h-5 bg-cz-subtle rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: barColor }}
                    />
                  </div>
                  <div className="w-16 text-xs font-mono text-cz-2 text-right flex-shrink-0">
                    {s.total_points.toLocaleString("da-DK")}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
