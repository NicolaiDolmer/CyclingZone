import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useParams } from "react-router";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import { Flag } from "../components/Flag";
import { formatNumber } from "../lib/intl";
import {
  FlagIcon, Button,
  PageHeader, Section, SectionStack, SectionHeader,
  EmptyState, ErrorState, SkeletonLines,
} from "../components/ui";

export default function RaceHistoryPage() {
  const { t } = useTranslation("races");
  const { raceSlug } = useParams();
  const raceName = decodeURIComponent(raceSlug);

  const [editions, setEditions] = useState([]);
  const [riderStats, setRiderStats] = useState([]);
  const [loading, setLoading] = useState(true);
  // #2849 bølge 3: terminal, retry-bar fejl-state — samme mønster som
  // ActivityPage/AuctionHistoryPage (#1350-diskriminatoren). Uden dette viste en
  // fejlet races/race_results-fetch sig som en tavs "ingen historik"-tomtilstand
  // i stedet for canonical ErrorState.
  const [loadError, setLoadError] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(false);

    try {
      const { data: races, error: racesError } = await supabase
        .from("races")
        .select("id, name, race_type, stages, edition_year, status, season:season_id(id, number, status)")
        .ilike("name", raceName)
        .order("edition_year", { ascending: false, nullsFirst: false });

      if (racesError) { setLoadError(true); return; }

      if (!races?.length) { setEditions([]); setRiderStats([]); return; }

      const raceIds = races.map(r => r.id);

      const { data: results, error: resultsError } = await supabase
        .from("race_results")
        .select("race_id, result_type, rank, rider_id, rider_name, team_name, points_earned, prize_money, rider:rider_id(id, firstname, lastname, nationality_code, team:team_id(id, name))")
        .in("race_id", raceIds)
        .order("rank");

      if (resultsError) { setLoadError(true); return; }

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
    } catch (e) {
      // Netværk/auth-fejl der tidligere ville kaste uhåndteret og efterlade en
      // evig loading-spinner (loading blev aldrig sat til false).
      console.error("Race history load failed:", e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [raceName]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const maxPoints = riderStats[0]?.total_points || 1;

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/races?tab=library" className="mb-4 inline-block text-xs text-cz-accent-t hover:underline">
        {t("history.backToLibrary")}
      </Link>

      {/* #2849 bølge 3: kanonisk PageHeader (T1). Undertitlen kræver edition-data
          og vises derfor kun når editions er hentet. */}
      <PageHeader
        title={raceName}
        subtitle={editions.length > 0 ? (
          <>
            {editions[0].race_type === "stage_race"
              ? t("raceType.stageRaceWithStages", { count: editions[0].stages })
              : t("raceType.oneDay")}
            {" · "}{t("history.editionsCount", { count: editions.length })}
          </>
        ) : undefined}
      />

      {/* #2849 bølge 3 — canonical states: chrome (back-link + header) renderer
          altid; kun kropszonen herunder swapper mellem loading/error/tom/indhold. */}
      {loading ? (
        <Section><SkeletonLines lines={6} /></Section>
      ) : loadError ? (
        <Section role="alert">
          <ErrorState
            description={t("history.loadError.message")}
            action={<Button size="sm" variant="secondary" onClick={loadAll}>{t("history.loadError.retry")}</Button>}
          />
        </Section>
      ) : editions.length === 0 ? (
        <EmptyState
          icon={<FlagIcon size={26} aria-hidden="true" />}
          title={t("empty.noHistory", { name: raceName })}
        />
      ) : (
        <SectionStack>
          <div className="grid gap-[14px] md:grid-cols-2">
            {/* Editions list */}
            <Section>
              <SectionHeader title={t("history.editions")} />
              <div className="divide-y divide-cz-border">
                {editions.map(ed => (
                  <div key={ed.id} className="flex items-center justify-between gap-3 py-[13px]">
                    <p className="text-[13.5px] font-medium text-cz-1">{t("history.season", { number: ed.season?.number })}</p>
                    <div className="text-right">
                      {ed.winner ? (
                        <div>
                          <RiderLink id={ed.winner?.rider?.id}
                            className="block text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t cursor-pointer transition-colors">
                            {ed.winner.rider
                              ? `${ed.winner.rider.firstname} ${ed.winner.rider.lastname}`
                              : ed.winner.rider_name}
                          </RiderLink>
                          <p className="font-data text-2xs uppercase tracking-[.04em] text-cz-3">
                            <TeamLink id={ed.winner.rider?.team?.id} className="hover:text-cz-accent-t transition-colors">
                              {ed.winner.rider?.team?.name || ed.winner.team_name || "–"}
                            </TeamLink>
                          </p>
                        </div>
                      ) : (
                        <span className="font-data text-2xs uppercase tracking-[.04em] text-cz-3">{t("history.noResults")}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Best riders */}
            <Section>
              <SectionHeader title={t("history.bestRiders")} className="mb-1" />
              <p className="mb-4 text-[13px] text-cz-2">{t("history.bestRidersSub")}</p>
              {riderStats.length === 0 ? (
                <div className="py-4 text-center">
                  <p className="text-sm text-cz-3">{t("history.noResultsYet")}</p>
                </div>
              ) : (
                <div className="divide-y divide-cz-border">
                  {riderStats.map((s, i) => (
                    <RiderLink key={s.rider?.id || s.rider_name} id={s.rider?.id}
                      className="flex items-center gap-3 py-[13px] transition-colors hover:bg-cz-subtle cursor-pointer">
                      <span className={`w-4 flex-shrink-0 text-center font-mono text-xs font-bold
                        ${i === 0 ? "text-cz-accent-t" : "text-cz-3"}`}>
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium text-cz-1">
                          {s.rider?.nationality_code && (
                            <Flag code={s.rider.nationality_code} className="me-1" />
                          )}
                          {s.rider_name}
                        </p>
                        <p className="truncate font-data text-2xs uppercase tracking-[.04em] text-cz-3">
                          {[
                            s.gc_wins > 0 && t("history.statGc", { count: s.gc_wins }),
                            s.stage_wins > 0 && t("history.statStageWins", { count: s.stage_wins }),
                            s.top3 > 0 && t("history.statTop3", { count: s.top3 }),
                          ].filter(Boolean).join(" · ") || t("history.noWins")}
                        </p>
                      </div>
                      <span className="flex-shrink-0 font-mono text-xs font-bold text-cz-accent-t">
                        {formatNumber(s.total_points)} pt
                      </span>
                    </RiderLink>
                  ))}
                </div>
              )}
            </Section>
          </div>

          {/* Accumulated bar chart */}
          {riderStats.length > 0 && riderStats[0].total_points > 0 && (
            <Section>
              <SectionHeader title={t("history.accumulatedTitle")} className="mb-1" />
              <p className="mb-5 text-[13px] text-cz-2">{t("history.accumulatedSub")}</p>
              <div className="space-y-3">
                {riderStats.map((s, i) => {
                  const pct = maxPoints > 0 ? (s.total_points / maxPoints) * 100 : 0;
                  const lastName = s.rider_name.split(" ").slice(-1)[0];
                  // 2-farve-system: guld bærer rang-hierarkiet via faldende opacitet (tema-bevidst).
                  const barColor = i === 0 ? "rgb(var(--accent))" : i === 1 ? "rgb(var(--accent) / 0.6)" : i === 2 ? "rgb(var(--accent) / 0.4)" : "rgb(var(--accent) / 0.25)";
                  return (
                    <div key={s.rider?.id || s.rider_name} className="flex items-center gap-3">
                      <div className="w-28 flex-shrink-0 truncate text-right text-xs text-cz-2">
                        {s.rider?.nationality_code && (
                          <Flag code={s.rider.nationality_code} className="me-0.5" />
                        )}
                        {lastName}
                      </div>
                      <div className="h-5 flex-1 overflow-hidden rounded-full bg-cz-subtle">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: barColor }}
                        />
                      </div>
                      <div className="w-16 flex-shrink-0 text-right font-mono text-xs text-cz-2">
                        {formatNumber(s.total_points)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </SectionStack>
      )}
    </div>
  );
}
