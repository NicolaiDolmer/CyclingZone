import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useParams } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import { Flag } from "../components/Flag";
import { formatNumber } from "../lib/intl";
import { FlagIcon } from "../components/ui";

export default function RaceHistoryPage() {
  const { t } = useTranslation("races");
  const { raceSlug } = useParams();
  const raceName = decodeURIComponent(raceSlug);

  const [editions, setEditions] = useState([]);
  const [riderStats, setRiderStats] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);

    const { data: races } = await supabase
      .from("races")
      .select("id, name, race_type, stages, edition_year, status, season:season_id(id, number, status)")
      .ilike("name", raceName)
      .order("edition_year", { ascending: false, nullsFirst: false });

    if (!races?.length) { setLoading(false); return; }

    const raceIds = races.map(r => r.id);

    const { data: results } = await supabase
      .from("race_results")
      .select("race_id, result_type, rank, rider_id, rider_name, team_name, points_earned, prize_money, rider:rider_id(id, firstname, lastname, nationality_code, team:team_id(id, name))")
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
            : (res.rider_name || "–"),
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
  }, [raceName]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  if (!editions.length) return (
    <div className="max-w-4xl mx-auto">
      <Link to="/races?tab=library" className="text-xs text-cz-accent-t hover:underline mb-4 inline-block">{t("history.backToLibrary")}</Link>
      <div className="text-center py-16 text-cz-3">
        <FlagIcon size={36} className="mx-auto mb-3" aria-hidden="true" />
        <p>{t("empty.noHistory", { name: raceName })}</p>
      </div>
    </div>
  );

  const maxPoints = riderStats[0]?.total_points || 1;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <Link to="/races?tab=library" className="text-xs text-cz-accent-t hover:underline mb-2 inline-block">{t("history.backToLibrary")}</Link>
        <h1 className="text-xl font-bold text-cz-1">{raceName}</h1>
        <p className="text-cz-3 text-sm">
          {editions[0].race_type === "stage_race"
            ? t("raceType.stageRaceWithStages", { count: editions[0].stages })
            : t("raceType.oneDay")}
          {" · "}{t("history.editionsCount", { count: editions.length })}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Editions list */}
        <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
          <div className="px-4 py-3 border-b border-cz-border">
            <h2 className="font-semibold text-cz-1 text-sm">{t("history.editions")}</h2>
          </div>
          <div className="divide-y divide-cz-border">
            {editions.map(ed => (
              <div key={ed.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-cz-2 text-sm font-medium">{t("history.season", { number: ed.season?.number })}</p>
                  {ed.edition_year && (
                    <p className="text-cz-3 text-xs">{t("common.edition", { year: ed.edition_year })}</p>
                  )}
                </div>
                <div className="text-right">
                  {ed.winner ? (
                    <div>
                      <RiderLink id={ed.winner?.rider?.id}
                        className="text-cz-1 text-xs font-medium hover:text-cz-accent-t cursor-pointer transition-colors block">
                        {ed.winner.rider
                          ? `${ed.winner.rider.firstname} ${ed.winner.rider.lastname}`
                          : ed.winner.rider_name}
                      </RiderLink>
                      <p className="text-cz-3 text-[10px]">
                        <TeamLink id={ed.winner.rider?.team?.id} className="hover:text-cz-accent-t transition-colors">
                          {ed.winner.rider?.team?.name || ed.winner.team_name || "–"}
                        </TeamLink>
                      </p>
                    </div>
                  ) : (
                    <span className="text-cz-3 text-xs">{t("history.noResults")}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Best riders */}
        <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
          <div className="px-4 py-3 border-b border-cz-border">
            <h2 className="font-semibold text-cz-1 text-sm">{t("history.bestRiders")}</h2>
            <p className="text-cz-3 text-xs">{t("history.bestRidersSub")}</p>
          </div>
          {riderStats.length === 0 ? (
            <div className="px-4 py-8 text-center text-cz-3 text-sm">{t("history.noResultsYet")}</div>
          ) : (
            <div className="divide-y divide-cz-border">
              {riderStats.map((s, i) => (
                <RiderLink key={s.rider?.id || s.rider_name} id={s.rider?.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-cz-subtle cursor-pointer transition-colors">
                  <span className={`w-4 text-center font-mono font-bold text-xs flex-shrink-0
                    ${i === 0 ? "text-cz-accent-t" : "text-cz-3"}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-cz-1 text-xs font-medium truncate">
                      {s.rider?.nationality_code && (
                        <Flag code={s.rider.nationality_code} className="me-1" />
                      )}
                      {s.rider_name}
                    </p>
                    <p className="text-cz-3 text-[10px]">
                      {[
                        s.gc_wins > 0 && t("history.statGc", { count: s.gc_wins }),
                        s.stage_wins > 0 && t("history.statStageWins", { count: s.stage_wins }),
                        s.top3 > 0 && t("history.statTop3", { count: s.top3 }),
                      ].filter(Boolean).join(" · ") || t("history.noWins")}
                    </p>
                  </div>
                  <span className="text-cz-accent-t font-mono text-xs font-bold flex-shrink-0">
                    {formatNumber(s.total_points)} pt
                  </span>
                </RiderLink>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Accumulated bar chart */}
      {riderStats.length > 0 && riderStats[0].total_points > 0 && (
        <div className="bg-cz-card border border-cz-border rounded-cz p-5">
          <h2 className="font-semibold text-cz-1 text-sm mb-0.5">{t("history.accumulatedTitle")}</h2>
          <p className="text-cz-3 text-xs mb-5">{t("history.accumulatedSub")}</p>
          <div className="space-y-3">
            {riderStats.map((s, i) => {
              const pct = maxPoints > 0 ? (s.total_points / maxPoints) * 100 : 0;
              const lastName = s.rider_name.split(" ").slice(-1)[0];
              // 2-farve-system: guld bærer rang-hierarkiet via faldende opacitet (tema-bevidst).
              const barColor = i === 0 ? "rgb(var(--accent))" : i === 1 ? "rgb(var(--accent) / 0.6)" : i === 2 ? "rgb(var(--accent) / 0.4)" : "rgb(var(--accent) / 0.25)";
              return (
                <div key={s.rider?.id || s.rider_name} className="flex items-center gap-3">
                  <div className="w-28 text-xs text-cz-2 truncate text-right flex-shrink-0">
                    {s.rider?.nationality_code && (
                      <Flag code={s.rider.nationality_code} className="me-0.5" />
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
                    {formatNumber(s.total_points)}
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
