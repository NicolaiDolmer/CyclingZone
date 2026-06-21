import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RiderLink from "./RiderLink";
import { Flag } from "./Flag";
import StatCompare from "./StatCompare";
import { Portal } from "./ui";
import { XIcon } from "./ui/icons";
import { formatNumber } from "../lib/intl";

// Compare-drawer — folder Head-to-Head ind i Standings-hub'en (#1609). Side-panel
// der sammenligner to hold: StatCompare (point/etapesejre/GC/sæsoner) + indbyrdes
// transfer-historik (den unikke relationelle auctions-query) + top-5 ryttere pr.
// hold efter optjente race-point. loadStats-logikken er genbrugt ~1:1 fra
// HeadToHeadPage.jsx:120-187 — tager allerede to team-id'er.
export default function CompareDrawer({ teamA, teamB, onClose }) {
  const navigate = useNavigate();
  // Drawer-tekster genbruger headtohead-namespacet (statPoints, transferHistory,
  // topFive osv. lever allerede der); hub-specifikke labels via standings.
  const { t } = useTranslation("headtohead");
  const { t: tStandings } = useTranslation("standings");
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadStats = useCallback(async () => {
    if (!teamA?.id || !teamB?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [standingsRes, auctionsRes, ridersARes, ridersBRes] = await Promise.all([
        supabase.from("season_standings")
          .select("*, season:season_id(number)")
          .in("team_id", [teamA.id, teamB.id])
          .order("season_id"),

        // Auctions where one team bought from the other (the unique relational query)
        supabase.from("auctions")
          .select("id, current_price, seller_team_id, current_bidder_id, rider:rider_id(firstname, lastname)")
          .eq("status", "completed")
          .or(`and(seller_team_id.eq.${teamA.id},current_bidder_id.eq.${teamB.id}),and(seller_team_id.eq.${teamB.id},current_bidder_id.eq.${teamA.id})`),

        supabase.from("riders").select("id, firstname, lastname, market_value, nationality_code").eq("team_id", teamA.id),
        supabase.from("riders").select("id, firstname, lastname, market_value, nationality_code").eq("team_id", teamB.id),
      ]);

      const standingsA = standingsRes.data?.filter(s => s.team_id === teamA.id) || [];
      const standingsB = standingsRes.data?.filter(s => s.team_id === teamB.id) || [];

      const h2hAuctions = auctionsRes.data || [];
      const aBoughtFromB = h2hAuctions.filter(a => a.seller_team_id === teamB.id && a.current_bidder_id === teamA.id);
      const bBoughtFromA = h2hAuctions.filter(a => a.seller_team_id === teamA.id && a.current_bidder_id === teamB.id);

      // #826 — squad "Top 5" must show points the rider actually earned racing in-game
      // (summed from race_results), not a static strength attribute. Tie-break on
      // market_value (#1101) so pre-season (no results yet) still surfaces the strongest riders.
      const ridersA = ridersARes.data || [];
      const ridersB = ridersBRes.data || [];
      const allRiderIds = [...ridersA, ...ridersB].map(r => r.id);
      const pointsByRider = {};
      if (allRiderIds.length > 0) {
        const { data: resultRows } = await supabase
          .from("race_results")
          .select("rider_id, points_earned")
          .in("rider_id", allRiderIds);
        for (const row of resultRows || []) {
          pointsByRider[row.rider_id] = (pointsByRider[row.rider_id] || 0) + (row.points_earned || 0);
        }
      }
      const topFiveByPoints = (list) => list
        .map(r => ({ ...r, pointsEarned: pointsByRider[r.id] || 0 }))
        .sort((a, b) => b.pointsEarned - a.pointsEarned || (b.market_value || 0) - (a.market_value || 0))
        .slice(0, 5);

      setStats({
        standingsA, standingsB,
        totalPointsA: standingsA.reduce((s, r) => s + (r.total_points || 0), 0),
        totalPointsB: standingsB.reduce((s, r) => s + (r.total_points || 0), 0),
        stageWinsA: standingsA.reduce((s, r) => s + (r.stage_wins || 0), 0),
        stageWinsB: standingsB.reduce((s, r) => s + (r.stage_wins || 0), 0),
        gcWinsA: standingsA.reduce((s, r) => s + (r.gc_wins || 0), 0),
        gcWinsB: standingsB.reduce((s, r) => s + (r.gc_wins || 0), 0),
        aBoughtFromB, bBoughtFromA,
        topRidersA: topFiveByPoints(ridersA),
        topRidersB: topFiveByPoints(ridersB),
      });
    } catch (e) {
      console.error("CompareDrawer loadStats failed", e);
      setStats(null);
      setError(t("errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [teamA, teamB, t]);

  useEffect(() => { loadStats(); }, [loadStats]);

  return (
    <Portal>
      <div className="fixed inset-0 z-modal flex justify-end">
        <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={tStandings("compare.drawerTitle")}
          className="relative h-full w-full max-w-md bg-cz-card border-s border-cz-border overflow-y-auto shadow-overlay">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-cz-card border-b border-cz-border px-5 py-4 flex items-center justify-between gap-3">
            <h2 className="text-cz-1 font-semibold text-sm">{tStandings("compare.drawerTitle")}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={tStandings("compare.close")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-cz text-cz-3 transition-colors duration-150 hover:bg-cz-subtle hover:text-cz-1">
              <XIcon size={18} />
            </button>
          </div>

          <div className="px-5 py-4">
            {/* Team headers */}
            <div className="mb-5 flex items-center justify-center gap-4">
              <div className="text-center min-w-0">
                <p className="text-cz-accent-t font-bold text-sm truncate">{teamA?.name}</p>
                <p className="text-cz-3 text-xs">{t("division", { n: teamA?.division })}</p>
              </div>
              <span className="text-cz-3 text-lg font-bold">VS</span>
              <div className="text-center min-w-0">
                <p className="text-cz-info font-bold text-sm truncate">{teamB?.name}</p>
                <p className="text-cz-3 text-xs">{t("division", { n: teamB?.division })}</p>
              </div>
            </div>

            {loading && (
              <div className="flex justify-center py-16">
                <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
              </div>
            )}

            {!loading && error && (
              <div className="bg-cz-danger-bg border border-cz-danger/30 rounded-cz p-4 mb-4 flex items-center justify-between gap-3">
                <p className="text-cz-danger text-sm">{error}</p>
                <button onClick={loadStats}
                  className="px-3 py-1.5 text-xs text-cz-1 bg-cz-card hover:bg-cz-subtle border border-cz-border rounded-cz transition-all">
                  {t("retry")}
                </button>
              </div>
            )}

            {!loading && !error && stats && (
              <div className="flex flex-col gap-4">
                {/* Stat comparison */}
                <div className="bg-cz-subtle border border-cz-border rounded-cz p-4">
                  <h3 className="text-cz-1 font-semibold text-sm mb-3">{t("seasonStats")}</h3>
                  <StatCompare labelA={t("statPoints")} valueA={stats.totalPointsA} valueB={stats.totalPointsB} />
                  <StatCompare labelA={t("statStageWins")} valueA={stats.stageWinsA} valueB={stats.stageWinsB} />
                  <StatCompare labelA={t("statGcWins")} valueA={stats.gcWinsA} valueB={stats.gcWinsB} />
                  <StatCompare labelA={t("statSeasons")} valueA={stats.standingsA.length} valueB={stats.standingsB.length} />
                </div>

                {/* Transfer history between them (unique relational data) */}
                {(stats.aBoughtFromB.length > 0 || stats.bBoughtFromA.length > 0) && (
                  <div className="bg-cz-subtle border border-cz-border rounded-cz p-4">
                    <h3 className="text-cz-1 font-semibold text-sm mb-3">{t("transferHistory")}</h3>
                    {stats.aBoughtFromB.length > 0 && (
                      <div className="mb-3">
                        <p className="text-cz-2 text-xs mb-2">{t("boughtFrom", { buyer: teamA.name, seller: teamB.name })}</p>
                        {stats.aBoughtFromB.map(a => (
                          <div key={a.id} className="flex justify-between py-1.5 border-b border-cz-border last:border-0">
                            <span className="text-cz-1 text-sm">{a.rider?.firstname} {a.rider?.lastname}</span>
                            <span className="text-cz-accent-t font-mono text-sm">{formatNumber(a.current_price)} CZ$</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {stats.bBoughtFromA.length > 0 && (
                      <div>
                        <p className="text-cz-2 text-xs mb-2">{t("boughtFrom", { buyer: teamB.name, seller: teamA.name })}</p>
                        {stats.bBoughtFromA.map(a => (
                          <div key={a.id} className="flex justify-between py-1.5 border-b border-cz-border last:border-0">
                            <span className="text-cz-1 text-sm">{a.rider?.firstname} {a.rider?.lastname}</span>
                            <span className="text-cz-info font-mono text-sm">{formatNumber(a.current_price)} CZ$</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Top 5 riders per team by race points */}
                <div className="flex flex-col gap-4">
                  {[
                    { team: teamA, riders: stats.topRidersA, color: "rgb(var(--accent-t))" },
                    { team: teamB, riders: stats.topRidersB, color: "rgb(var(--info))" },
                  ].map(({ team, riders, color }) => (
                    <div key={team.id} className="bg-cz-subtle border border-cz-border rounded-cz p-4">
                      <h3 className="font-semibold text-sm mb-3 cursor-pointer hover:underline"
                        style={{ color }} onClick={() => navigate(`/teams/${team.id}`)}>
                        {t("topFive", { team: team.name })}
                      </h3>
                      {riders.length === 0 ? (
                        <p className="text-cz-3 text-xs">{t("noRiders")}</p>
                      ) : (
                        riders.map((r, i) => (
                          <div key={r.id} className="flex justify-between py-1.5 border-b border-cz-border last:border-0">
                            <RiderLink id={r.id}
                              className="text-cz-2 text-xs cursor-pointer hover:text-cz-1 flex items-center gap-1">
                              {i + 1}. {r.nationality_code && <Flag code={r.nationality_code} />} {r.firstname} {r.lastname}
                            </RiderLink>
                            <span className="font-mono text-xs" style={{ color }} title={t("pointsEarnedTitle")}>
                              {formatNumber(r.pointsEarned)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </Portal>
  );
}
