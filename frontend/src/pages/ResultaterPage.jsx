import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useNavigate, useSearchParams } from "react-router";
import RiderLink from "../components/RiderLink";
import RacePointsPage from "./RacePointsPage";
import RaceArchiveTable from "../components/race/RaceArchiveTable.jsx";
import { Flag } from "../components/Flag";
import { formatNumber } from "../lib/intl";
import { racesForPool } from "../lib/racesByPool";
import { sortRacesByDateDesc } from "../lib/raceCalendarSort";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import {
  Card,
  Button,
  Tabs,
  TabList,
  Tab,
  PageHeader,
  PageLoader,
  Section,
  SectionHeader,
  SectionAction,
  EmptyState,
  ErrorState,
  TrophyIcon,
  BikeIcon,
  CalendarIcon,
  PodiumIcon,
  FlagIcon,
} from "../components/ui";

// Realtime: opdatér seneste løb + top-hold/-ryttere live efter en resultat-import (#783).
const REALTIME_TABLES = ["season_standings", "race_results"];

const VALID_TABS = ["latest", "archive", "points"];

// #3102 etape 2 — hvor mange afsluttede løb "Seneste" viser. 9 = tre fulde
// rækker i xl-gridet. Dashboardet svarer allerede på "hvordan gik MIT løb" på
// 0 klik; hubben svarer på "hvad skete der i min pulje", så listen skal være
// lang nok til en løbsdag eller to, ikke et helt arkiv (det er Arkiv-fanen).
const LATEST_LIMIT = 9;

// Label + desc resolves via t() ved render — se results-namespacet (hub.*).
// #3102 etape 2: Race library + Points & prizes er ikke længere tiles — de er
// faner på denne side. De tre der er tilbage peger ud af hubben.
// #3104 etape C: rytterranglisten bor som fane i Ranglister-hubben nu.
const HUB_LINKS = [
  { to: "/standings",             key: "standings",      Icon: TrophyIcon },
  { to: "/standings?tab=riders",  key: "riderRankings",  Icon: BikeIcon },
  { to: "/seasons",               key: "seasonSnapshot", Icon: CalendarIcon },
];

// Podiet for ét løb: etapeløb afgøres på det samlede klassement (gc), endagsløb
// på selve etaperesultatet. GC-rækker findes kun på den sidst kørte etape, så vi
// tager altid det højeste stage_number og lader rank bestemme rækkefølgen.
export function podiumFor(race, rows) {
  const type = race.race_type === "stage_race" ? "gc" : "stage";
  const forRace = (rows || []).filter(r => r.race_id === race.id && r.result_type === type);
  if (forRace.length === 0) return [];
  const maxStage = Math.max(...forRace.map(r => r.stage_number ?? 0));
  return forRace
    .filter(r => (r.stage_number ?? 0) === maxStage)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .slice(0, 3);
}

export default function ResultaterPage() {
  // races-namespacet leverer løbs-taksonomien (klasse, type) som kortene deler
  // med kalender- og arkiv-fladerne. Nøglerne beskriver løb, ikke hubben.
  const { t } = useTranslation(["results", "races"]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [season, setSeason] = useState(null);
  const [latestRaces, setLatestRaces] = useState([]);
  const [latestResults, setLatestResults] = useState([]);
  const [topTeams, setTopTeams] = useState([]);
  const [topRiders, setTopRiders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // URL'en ER fane-tilstanden — ikke en kopi i state der seedes ved mount.
  // Med en useState-kopi skifter fanen ikke når location'en ændrer sig uden en
  // remount: browserens tilbage/frem mellem ?tab=archive og ?tab=points ville
  // flytte URL'en men efterlade indholdet på den gamle fane.
  const tabParam = searchParams.get("tab");
  const tab = VALID_TABS.includes(tabParam) ? tabParam : "latest";

  // Tab → URL sync (deep-linkbar: /resultater?tab=archive). "latest" er default
  // og skriver ingen param. Opdateringen sker på en KOPI af params — instansen
  // fra hooken ejes af React Router, og at mutere den er samme fælde som
  // FinancePage/TransfersPage allerede undgår.
  function changeTab(next) {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next === "latest") params.delete("tab");
      else params.set("tab", next);
      return params;
    }, { replace: true });
  }

  // #2849 bølge 3 — wrapper med try/catch/finally, så en fejlet query giver
  // en kanonisk fejl-tilstand med retry i stedet for en uendelig spinner
  // (samme mønster som StandingsPage/#2175).
  async function loadAll() {
    setError(null);
    try {
      await loadAllInner();
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadAllInner() {
    const { data: seasonData } = await supabase
      .from("seasons").select("*").eq("status", "active").single();
    setSeason(seasonData);

    if (!seasonData) { return; }

    // #2444 · topRiders hentede tidligere ALLE sæsonens races + ALLE deres
    // race_results (paginated fetchAllRows — kunne være titusindvis af rækker)
    // og aggregerede point/sejre i JS, bare for at vise top-5. rider_rankings_mv
    // (samme matview som RiderRankingsPage/#2175 bruger) har allerede disse tal
    // færdig-aggregeret server-side — én let query mod top-5 + en lille display-
    // join for de 5 rytter-id'er, ingen paginering nødvendig.
    const { data: { user } } = await supabase.auth.getUser();
    const [standingsRes, topRiderStatsRes, myTeamRes, finishedRacesRes] = await Promise.all([
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
      // #1715: spillerens egen pulje — hubben viser puljens løb, ikke alle syv
      // puljers (samme diskriminator som kalenderen bruger).
      user
        ? supabase.from("teams").select("league_division_id").eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("races")
        .select("id, name, race_type, race_class, stages, status, league_division_id, pool_race:pool_race_id(date_text)")
        .eq("season_id", seasonData.id)
        .eq("status", "completed"),
    ]);

    setTopTeams((standingsRes.data || []).filter(s => !s.team?.is_ai).slice(0, 3));

    // #3102 etape 2: de faktiske resultater. racesForPool + sortRacesByDateDesc
    // er de samme rene funktioner kalenderen bruger, så "seneste" betyder det
    // samme begge steder.
    const myPoolId = myTeamRes.data?.league_division_id ?? null;
    const finished = sortRacesByDateDesc(racesForPool(finishedRacesRes.data || [], myPoolId))
      .slice(0, LATEST_LIMIT);
    setLatestRaces(finished);

    if (finished.length) {
      // Kun podiet (rank ≤ 3) hentes, og kun de to klassementer et podie kan
      // komme fra. Uden .lte("rank", 3) ville et etapeløb trække hele feltet
      // for hver etape hjem for at vise tre navne.
      const { data: resultRows, error: resultsError } = await supabase
        .from("race_results")
        .select("race_id, result_type, rank, stage_number, rider_id, rider_name, team_name, points_earned, rider:rider_id(id, firstname, lastname, nationality_code, team:team_id(id, name))")
        .in("race_id", finished.map(r => r.id))
        .in("result_type", ["gc", "stage"])
        .lte("rank", 3);
      // Kast, ikke tavst `|| []`: en fejlet podie-hentning skal give ErrorState
      // med retry, ikke ni løbskort der ser resultatløse ud.
      if (resultsError) throw resultsError;
      setLatestResults(resultRows || []);
    } else {
      setLatestResults([]);
    }

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
  }

  useEffect(() => { loadAll(); }, []);
  useRealtimeRefetch("resultater-live", REALTIME_TABLES, loadAll);

  if (loading) return (
    <PageLoader label={t("loadingAria")} />
  );

  // #2849 bølge 3 — kanonisk fejl-tilstand med retry (docs/design/PAGE_TEMPLATES.md
  // states-sheet); erstatter den tidligere stille fejl (eternal spinner, da loadAll
  // manglede try/catch).
  if (error) return (
    <div className="max-w-[1600px] mx-auto">
      <PageHeader title={t("title")} />
      <ErrorState
        title={t("loadError")}
        description={t("loadErrorBody")}
        action={<Button size="sm" variant="secondary" onClick={() => { setLoading(true); loadAll(); }}>{t("retry")}</Button>}
      />
    </div>
  );

  return (
    // T2 wide data (PAGE_TEMPLATES.md): to af de tre faner er tabeller (arkivets
    // fem kolonner + point-tabellerne pr. løbsklasse), og skabelonen nævner
    // eksplicit "Results". Ruten er tilføjet til WIDE_CONTENT_ROUTES i Layout.jsx,
    // ellers ville tabellerne stadig være klemt i max-w-6xl.
    <div className="max-w-[1600px] mx-auto">
      <PageHeader
        title={t("title")}
        subtitle={season ? t("subtitle.active", { number: season.number }) : t("subtitle.noSeason")}
      />

      <Tabs value={tab} onChange={changeTab} className="mb-5">
        <TabList label={t("title")}>
          {[
            { key: "latest", label: t("tabs.latest") },
            { key: "archive", label: t("tabs.archive") },
            { key: "points", label: t("tabs.points") },
          ].map(tb => (
            <Tab key={tb.key} value={tb.key}>{tb.label}</Tab>
          ))}
        </TabList>
      </Tabs>

      {tab === "latest" && (
        <div className="space-y-[14px]">
          {!season ? (
            <EmptyState
              icon={<CalendarIcon size={32} aria-hidden="true" />}
              title={t("emptyNoSeason")}
            />
          ) : (
            <>
              {/* Seneste løb i egen pulje — hubbens hovedindhold. */}
              {latestRaces.length === 0 ? (
                <EmptyState
                  icon={<FlagIcon size={32} aria-hidden="true" />}
                  title={t("latest.empty")}
                  description={t("latest.emptyBody")}
                />
              ) : (
                <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-3">
                  {latestRaces.map(race => (
                    <RaceResultCard key={race.id} race={race} podium={podiumFor(race, latestResults)} t={t} />
                  ))}
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-[14px]">
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
                      <Link to="/standings?tab=riders" className="text-xs text-cz-accent-t hover:underline">{t("seeAllRiders")}</Link>
                    </div>
                  </Card>
                )}

                {latestRaces.length === 0 && topTeams.length === 0 && topRiders.length === 0 && (
                  <EmptyState
                    className="md:col-span-2"
                    icon={<PodiumIcon size={32} aria-hidden="true" />}
                    title={t("emptyNoResults")}
                  />
                )}
              </div>

              {/* Ud af hubben. Arkiv og Point & præmier er faner nu, så det der
                  er tilbage er de tre flader der bor på egne ruter. */}
              <Section>
                <SectionHeader title={t("hub.moreTitle")} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {HUB_LINKS.map(({ to, key, Icon }) => (
                    <Link key={to} to={to}
                      className="rounded-cz border border-cz-border bg-cz-card p-4 transition-colors duration-150 hover:border-cz-3 group">
                      <Icon size={20} className="mb-2 text-cz-3 transition-colors group-hover:text-cz-accent-t" />
                      <p className="font-semibold text-cz-1 text-sm group-hover:text-cz-accent-t transition-colors">
                        {t(`hub.${key}.label`)}
                      </p>
                      <p className="text-cz-3 text-xs mt-0.5 leading-snug">{t(`hub.${key}.desc`)}</p>
                    </Link>
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>
      )}

      {/* #3102 etape 2: arkivet og point-tabellerne flyttede hertil fra /races.
          Begge er rene KIGGE-flader og hørte aldrig hjemme sammen med
          holdudtagelses-boardet. */}
      {tab === "archive" && <RaceArchiveTable />}
      {tab === "points" && <div className="-mt-2"><RacePointsPage /></div>}
    </div>
  );
}

// Ét afsluttet løb: navn + dato/klasse som meta, podiet, og vejen videre til
// hele resultatet (RaceDetailPage). Kortet er ikke helrække-klikbart — podiets
// rytternavne er selv links, og et link i et link er ikke tilgængeligt.
function RaceResultCard({ race, podium, t }) {
  const dateText = race.pool_race?.date_text;
  const typeText = race.race_type === "stage_race"
    ? t("races:raceType.stageRaceParen", { count: race.stages })
    : t("races:raceType.oneDayShort");

  return (
    <Section>
      <SectionHeader
        title={
          <Link to={`/races/${race.id}`} className="hover:text-cz-accent-t transition-colors">
            {race.name}
          </Link>
        }
        meta={[dateText, typeText].filter(Boolean).join(" · ")}
      />

      {podium.length === 0 ? (
        <p className="py-2 text-[13px] text-cz-2">{t("latest.noPodium")}</p>
      ) : (
        <div className="divide-y divide-cz-border">
          {podium.map(row => (
            <div key={`${row.rank}-${row.rider_id ?? row.rider_name}`} className="flex items-center gap-3 py-[13px]">
              <span className={`w-4 flex-shrink-0 text-center font-mono text-xs font-bold
                ${row.rank === 1 ? "text-cz-accent-t" : "text-cz-3"}`}>
                {row.rank}
              </span>
              <div className="min-w-0 flex-1">
                <RiderLink id={row.rider?.id}
                  className="block truncate text-[13.5px] font-medium text-cz-1 transition-colors hover:text-cz-accent-t">
                  {row.rider?.nationality_code && (
                    <Flag code={row.rider.nationality_code} className="me-1" />
                  )}
                  {row.rider ? `${row.rider.firstname} ${row.rider.lastname}` : (row.rider_name || "–")}
                </RiderLink>
                <p className="truncate font-data text-2xs uppercase tracking-[.04em] text-cz-3">
                  {row.rider?.team?.name || row.team_name || t("freeAgent")}
                </p>
              </div>
              {row.points_earned > 0 && (
                <span className="flex-shrink-0 font-mono text-xs font-bold text-cz-accent-t">
                  {t("points", { count: formatNumber(row.points_earned) })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-cz-border pt-3">
        <SectionAction as={Link} to={`/races/${race.id}`}>
          {t("latest.viewFull")}
        </SectionAction>
      </div>
    </Section>
  );
}
