import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import { Flag } from "../components/Flag";
import { formatNumber } from "../lib/intl";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import {
  Card,
  PageLoader,
  EmptyState,
  TrophyIcon,
  BikeIcon,
  BookOpenIcon,
  CalendarIcon,
  CoinIcon,
  PodiumIcon,
} from "../components/ui";

// Realtime: opdatér top-hold/-ryttere live efter en resultat-import (#783).
const REALTIME_TABLES = ["season_standings", "race_results"];

// Label + desc resolves via t() ved render — se results-namespacet (hub.*).
const HUB_LINKS = [
  { to: "/standings",          key: "standings",      Icon: TrophyIcon },
  { to: "/rider-rankings",     key: "riderRankings",  Icon: BikeIcon },
  { to: "/races?tab=library",  key: "library",        Icon: BookOpenIcon },
  { to: "/seasons",            key: "seasonSnapshot", Icon: CalendarIcon },
  { to: "/races?tab=points",   key: "points",         Icon: CoinIcon },
];

export default function ResultaterPage() {
  const { t } = useTranslation("results");
  const navigate = useNavigate();
  const [season, setSeason] = useState(null);
  const [topTeams, setTopTeams] = useState([]);
  const [topRiders, setTopRiders] = useState([]);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const { data: seasonData } = await supabase
      .from("seasons").select("*").eq("status", "active").single();
    setSeason(seasonData);

    if (!seasonData) { setLoading(false); return; }

    // #2444 · topRiders hentede tidligere ALLE sæsonens races + ALLE deres
    // race_results (paginated fetchAllRows — kunne være titusindvis af rækker)
    // og aggregerede point/sejre i JS, bare for at vise top-5. rider_rankings_mv
    // (samme matview som RiderRankingsPage/#2175 bruger) har allerede disse tal
    // færdig-aggregeret server-side — én let query mod top-5 + en lille display-
    // join for de 5 rytter-id'er, ingen paginering nødvendig.
    const [standingsRes, topRiderStatsRes] = await Promise.all([
      supabase
        .from("season_standings")
        .select("total_points, stage_wins, gc_wins, team:team_id(id, name, is_ai, division)")
        .eq("season_id", seasonData.id)
        .order("total_points", { ascending: false })
        .limit(5),
      supabase
        .from("rider_rankings_mv")
        .select("rider_id, points, stage_wins, gc_wins")
        .eq("season_id", seasonData.id)
        .order("points", { ascending: false })
        .limit(5),
    ]);

    setTopTeams((standingsRes.data || []).filter(s => !s.team?.is_ai).slice(0, 3));

    const topStats = topRiderStatsRes.data || [];
    if (topStats.length) {
      const riderIds = topStats.map(s => s.rider_id);
      const { data: displayData } = await supabase
        .from("riders")
        .select("id, firstname, lastname, nationality_code, team:team_id(name, is_ai)")
        .in("id", riderIds);
      const displayById = new Map((displayData || []).map(r => [r.id, r]));

      setTopRiders(
        topStats
          .map(s => {
            const rider = displayById.get(s.rider_id);
            if (!rider) return null; // pensioneret/slettet siden matview-refresh
            return {
              rider,
              points: Number(s.points) || 0,
              stage_wins: Number(s.stage_wins) || 0,
              gc_wins: Number(s.gc_wins) || 0,
            };
          })
          .filter(Boolean)
      );
    }

    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);
  useRealtimeRefetch("resultater-live", REALTIME_TABLES, loadAll);

  if (loading) return (
    <PageLoader label={t("loadingAria")} />
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
        <p className="text-cz-3 text-sm">
          {season ? t("subtitle.active", { number: season.number }) : t("subtitle.noSeason")}
        </p>
      </div>

      {/* Hub navigation */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {HUB_LINKS.map(({ to, key, Icon }) => (
          <Link key={to} to={to}
            className="rounded-cz border border-cz-border bg-cz-card p-4 transition-colors duration-150 hover:border-cz-3 group text-center">
            <Icon size={22} className="mx-auto mb-2 text-cz-3 transition-colors group-hover:text-cz-accent-t" />
            <p className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">
              {t(`hub.${key}.label`)}
            </p>
            <p className="text-cz-3 text-xs mt-0.5 leading-snug">{t(`hub.${key}.desc`)}</p>
          </Link>
        ))}
      </div>

      {!season ? (
        <EmptyState
          icon={<CalendarIcon size={32} aria-hidden="true" />}
          title={t("emptyNoSeason")}
        />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Tophold */}
          {topTeams.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-cz-border">
                <h2 className="font-semibold text-cz-1 text-sm">{t("topTeams", { number: season.number })}</h2>
              </div>
              <div className="divide-y divide-cz-border">
                {topTeams.map((s, i) => (
                  <div key={s.team?.id}
                    onClick={() => navigate(`/teams/${s.team?.id}`)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-cz-subtle cursor-pointer transition-colors">
                    <span className={`w-5 text-center font-mono font-bold text-sm flex-shrink-0
                      ${i === 0 ? "text-cz-accent-t" : "text-cz-3"}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-cz-1 text-sm truncate">{s.team?.name}</p>
                      <p className="text-cz-3 text-xs">
                        {t("teamMeta", { stageWins: s.stage_wins || 0, gcWins: s.gc_wins || 0 })}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-cz-accent-t text-sm">
                      {t("points", { count: formatNumber(s.total_points || 0) })}
                    </span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-cz-border">
                <Link to="/standings" className="text-xs text-cz-accent-t hover:underline">{t("seeAllStandings")}</Link>
              </div>
            </Card>
          )}

          {/* Topscorere */}
          {topRiders.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-cz-border">
                <h2 className="font-semibold text-cz-1 text-sm">{t("topScorers", { number: season.number })}</h2>
              </div>
              <div className="divide-y divide-cz-border">
                {topRiders.map((a, i) => (
                  <RiderLink key={a.rider.id} id={a.rider.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-cz-subtle cursor-pointer transition-colors">
                    <span className={`w-5 text-center font-mono font-bold text-sm flex-shrink-0
                      ${i === 0 ? "text-cz-accent-t" : "text-cz-3"}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-cz-1 text-sm truncate">
                        {a.rider.nationality_code && (
                          <Flag code={a.rider.nationality_code} className="me-1" />
                        )}
                        {a.rider.firstname} {a.rider.lastname}
                      </p>
                      <p className="text-cz-3 text-xs">
                        {a.rider.team?.name || t("freeAgent")}
                        {a.stage_wins > 0 && ` · ${t("riderStageWins", { count: a.stage_wins })}`}
                        {a.gc_wins > 0 && ` · ${t("riderGcWins", { count: a.gc_wins })}`}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-cz-accent-t text-sm">
                      {t("points", { count: formatNumber(a.points || 0) })}
                    </span>
                  </RiderLink>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-cz-border">
                <Link to="/rider-rankings" className="text-xs text-cz-accent-t hover:underline">{t("seeAllRiders")}</Link>
              </div>
            </Card>
          )}

          {topTeams.length === 0 && topRiders.length === 0 && (
            <EmptyState
              className="md:col-span-2"
              icon={<PodiumIcon size={32} aria-hidden="true" />}
              title={t("emptyNoResults")}
            />
          )}
        </div>
      )}
    </div>
  );
}
