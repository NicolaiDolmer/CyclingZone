import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useSearchParams, Link, Navigate } from "react-router";
import RiderLink from "../components/RiderLink";
import RaceHubBoard from "../components/racehub/RaceHubBoard.jsx";
import OnboardingTour from "../components/OnboardingTour.jsx";
import { dateTextToDayOfYear } from "../lib/raceCalendar";
import { sortRacesByDateDesc } from "../lib/raceCalendarSort";
import { racesForPool } from "../lib/racesByPool";
import { useSortState, sortRows } from "../lib/useTableSort.js";
import { RACE_CLASS_OPTIONS } from "../lib/raceFilterOptions.js";
import { computeExpectedRacePrize, formatExpectedPrize } from "../lib/expectedPrizeCalculator";
import { hasRouteData, sharedYMax } from "../lib/stageRouteProfile.js";
import StageProfileGraph from "../components/race/StageProfileGraph.jsx";
import {
  Card,
  Tabs,
  TabList,
  Tab,
  EmptyState,
  FlagIcon,
  PageLoader,
  PageHeader,
  Section,
  SectionHeader,
  DataTable,
  SkeletonLines,
} from "../components/ui";

// Labels resolves via t() ved render — se races-namespacet (resultType.*, classOption.*, status.*).
const RESULT_TYPES = [
  { key: "stage" },
  { key: "gc" },
  { key: "points" },
  { key: "mountain" },
  { key: "young" },
];

const VALID_TABS = ["calendar", "world"];

// #3102 etape 2: bibliotek + point & præmier er flyttet til Resultat-hubben —
// de er rene KIGGE-flader og hørte ikke sammen med holdudtagelses-boardet.
// Gamle deep-links (nav-genveje, patch notes, /race-archive- og
// /race-points-redirectene) lander på den rigtige fane i stedet for at falde
// tilbage til kalenderen, som ville se ud som om fanen bare forsvandt.
const MOVED_TABS = { library: "archive", points: "points" };

// #2819 — guidet tour på /races (aktiveres fra dashboardets "Show me how" når
// onboarding-trin 3, first_squad_selected, er næste trin). Ankrene bor i Race Hub-
// brættet (kalender-fanen): første løbs-kolonne → ledige-ryttere-puljen → taktik-
// linket. Samme mønster som AuctionsPage's getAuctionsTourSteps.
function getRacesTourSteps(t) {
  return [
    {
      target: "[data-tour='races-column']",
      title: t("tour.pickRace.title"),
      body: t("tour.pickRace.body"),
    },
    {
      target: "[data-tour='races-pool']",
      title: t("tour.pickRiders.title"),
      body: t("tour.pickRiders.body"),
    },
    {
      target: "[data-tour='races-strategy']",
      title: t("tour.tactics.title"),
      body: t("tour.tactics.body"),
    },
  ];
}

// Sorterbare kolonner i verdens-kataloget (klient-side, delt useSortState/
// sortRows). Tekst-kolonner starter stigende; etaper (tal) starter faldende
// (flest først) via descFirstKeys.
const WORLD_ACCESSORS = {
  name: (r) => r.name,
  race_class: (r) => r.race_class ?? "",
  race_type: (r) => r.race_type ?? "",
  stages: (r) => r.stages ?? 0,
};
const WORLD_DESC_FIRST = new Set(["stages"]);

// Sub-4 (#2448 Task 12): profil-thumbnail på de afsluttede løbskort. Rutedata
// findes kun for løb der er migreret til Sub-1's race_stage_profiles — mangler
// den, viser vi INTET (ikke et piktogram-gæt). Kortet er lille nok til at
// tomhed er bedre end en form der lover noget den ikke har.
const CARD_THUMB_W = 120;
const CARD_THUMB_H = 34;

function RaceCardRouteThumbnail({ race, profiles }) {
  const withRoute = (profiles || [])
    .filter(hasRouteData)
    .sort((a, b) => (a.stage_number ?? 1) - (b.stage_number ?? 1));
  if (withRoute.length === 0) return null;

  // Endagsløb (eller et etapeløb hvor kun én etape har rutedata): én enkelt graf.
  if (race.race_type !== "stage_race" || withRoute.length === 1) {
    const p = withRoute[0];
    return (
      <div className="mt-2" style={{ width: CARD_THUMB_W, height: CARD_THUMB_H }}>
        <StageProfileGraph profile={p} tier="mini" width={CARD_THUMB_W} height={CARD_THUMB_H}
          uid={`cal-${race.id}-${p.stage_number ?? 1}`} />
      </div>
    );
  }

  // Etapeløb: komprimeret mini-stribe med ALLE etaper på FÆLLES y-skala — en
  // enkelt etape ville give et falsk indtryk af hele løbets form. yMax er
  // løbets EGET loft, ikke boardets — det ville gøre alle løb lige høje.
  const yMax = sharedYMax(withRoute);
  const perW = CARD_THUMB_W / withRoute.length;
  return (
    <div className="mt-2 flex" style={{ width: CARD_THUMB_W, height: CARD_THUMB_H }}>
      {withRoute.map((p) => (
        <div key={p.stage_number} style={{ width: perW }}>
          <StageProfileGraph profile={p} tier="mini" width={perW} height={CARD_THUMB_H} yMax={yMax}
            uid={`cal-${race.id}-${p.stage_number}`} />
        </div>
      ))}
    </div>
  );
}

// Rute-wrapper: kun ét hook, så redirecten sker FØR RacesPage mounter og
// begynder at hente kalender-data den alligevel smider væk.
export default function RacesPageRoute() {
  const [searchParams] = useSearchParams();
  const movedTo = MOVED_TABS[searchParams.get("tab")];
  if (movedTo) return <Navigate to={`/resultater?tab=${movedTo}`} replace />;
  return <RacesPage />;
}

function RacesPage() {
  const { t } = useTranslation("races");
  // #2819: guidet rundvisning for onboarding-trin 3 (first_squad_selected).
  const racesTourSteps = useMemo(() => getRacesTourSteps(t), [t]);
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab = VALID_TABS.includes(searchParams.get("tab"))
    ? searchParams.get("tab")
    : "calendar";

  const [races, setRaces] = useState([]);
  const [racePoints, setRacePoints] = useState([]);
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedRace, setSelectedRace] = useState(null);
  const [tab, setTab] = useState(initialTab);
  const [isAdmin, setIsAdmin] = useState(false);
  // #1715 — spillerens egen liga-pulje (teams.league_division_id). Kalender-fanen
  // filtrerer til denne pulje + fælles (NULL) løb, så de 7 puljers løb ikke
  // blandes i én liste (gav dublet-lignende visning).
  const [myPoolId, setMyPoolId] = useState(null);

  // World pool state (Slice 09 — lazy load når tab="world" åbnes)
  const [worldPool, setWorldPool] = useState([]);
  const [worldSummary, setWorldSummary] = useState({});
  const [worldLoaded, setWorldLoaded] = useState(false);
  const [worldLoading, setWorldLoading] = useState(false);
  const [worldFilterClass, setWorldFilterClass] = useState("");

  // Klient-sortering af verdens-tabellen (klikbare headers).
  const worldSort = useSortState({ descFirstKeys: WORLD_DESC_FIRST });

  // Tab → URL sync (deep-linkbar fra eksterne kilder, fx /races?tab=world)
  function changeTab(next) {
    setTab(next);
    if (next === "calendar") {
      searchParams.delete("tab");
    } else {
      searchParams.set("tab", next);
    }
    setSearchParams(searchParams, { replace: true });
  }

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) { setLoading(false); return; }
    const { data: userData } = await supabase.from("users").select("role").eq("id", user.id).single();
    setIsAdmin(userData?.role === "admin");

    const [seasonRes, racesRes, racePointsRes, myTeamRes] = await Promise.all([
      supabase.from("seasons").select("*").eq("status", "active").single(),
      // #1715: league_division_id med, så kalenderen kan filtrere til spillerens pulje.
      supabase.from("races").select("*, league_division_id, results:race_results(id), pool_race:pool_race_id(date_text)").order("name"),
      supabase.from("race_points").select("race_class, result_type, rank, points"),
      // #1715: spillerens egen pulje (teams.league_division_id) til kalender-filteret.
      supabase.from("teams").select("league_division_id").eq("user_id", user.id).maybeSingle(),
    ]);

    setSeason(seasonRes.data);
    setRaces(racesRes.data || []);
    setRacePoints(racePointsRes.data || []);
    setMyPoolId(myTeamRes.data?.league_division_id ?? null);
    setLoading(false);
  }

  async function loadWorld() {
    setWorldLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/race-pool`);
      const data = await res.json();
      setWorldPool(data.pool || []);
      setWorldSummary(data.summary || {});
      setWorldLoaded(true);
    } finally {
      setWorldLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (tab === "world" && !worldLoaded && !worldLoading) {
      loadWorld();
    }
  }, [tab, worldLoaded, worldLoading]);

  async function loadRaceResults(raceId) {
    const { data } = await supabase
      .from("race_results")
      .select("*, rider:rider_id(id, firstname, lastname, team:team_id(name))")
      .eq("race_id", raceId)
      .order("result_type")
      .order("rank");
    return data || [];
  }

  async function handleRaceClick(race) {
    setSelectedRace({ ...race, results: null, loading: true });
    const results = await loadRaceResults(race.id);
    setSelectedRace({ ...race, results, loading: false });
  }

  // #1715: kalenderen viser kun spillerens egen puljes løb + fælles (NULL) løb,
  // så de 7 puljers løb ikke blandes i én liste. Falder tilbage til alle løb hvis
  // spilleren ikke har en pulje (myPoolId === null).
  const myRaces = useMemo(() => racesForPool(races, myPoolId), [races, myPoolId]);

  // #1930: afsluttede løb vises nyeste-først (spejler kommende-sorteringen men DESC).
  // Memoized separat (#2448 Task 12) så profil-fetch-effekten herunder kun
  // genkører når selve løbslisten ændrer sig — ikke ved hvert render (fx et klik
  // der sætter selectedRace).
  const completedRaces = useMemo(
    () => sortRacesByDateDesc(myRaces.filter(r => r.results?.length > 0 || r.status === "completed")),
    [myRaces],
  );
  const completedRaceIds = useMemo(() => completedRaces.map(r => r.id), [completedRaces]);

  // #2448 (Task 12): rutedata KUN for de løb der faktisk renderes som kort
  // (racesByStatus.completed) — ét .in()-kald, ikke hele kataloget. Gaten er målt
  // mod prod (40 løb → 60 ms / 89 kB, budget 150 ms / 250 kB) og PASSERER.
  const [stageProfilesByRace, setStageProfilesByRace] = useState({});

  useEffect(() => {
    if (completedRaceIds.length === 0) {
      setStageProfilesByRace({});
      return;
    }
    let cancelled = false;
    (async () => {
      let rows;
      try {
        const { data, error } = await supabase
          .from("race_stage_profiles")
          .select("race_id, stage_number, profile_type, distance_km, elevation_gain_m, climbs, sectors")
          .in("race_id", completedRaceIds);
        if (error) throw error;
        rows = data || [];
      } catch (err) {
        // Thumbnailen er en ren visnings-bonus — en fejl her må ALDRIG vælte
        // boardet. Samme degradér-ærligt-mønster som passagesPromise i
        // RaceDetailPage.jsx: warn + tom liste, ingen kastet fejl.
        console.warn("race_stage_profiles fetch failed (thumbnails degraderer til ingen):", err.message);
        rows = [];
      }
      if (cancelled) return;
      const byRace = {};
      for (const row of rows) {
        if (!byRace[row.race_id]) byRace[row.race_id] = [];
        byRace[row.race_id].push(row);
      }
      setStageProfilesByRace(byRace);
    })();
    return () => { cancelled = true; };
  }, [completedRaceIds]);

  const racesByStatus = {
    upcoming: myRaces
      .filter(r => !r.results?.length && r.status !== "completed")
      .sort((a, b) => dateTextToDayOfYear(a.pool_race?.date_text) - dateTextToDayOfYear(b.pool_race?.date_text)),
    completed: completedRaces,
  };

  if (loading) return (
    <PageLoader />
  );

  return (
    <div className="max-w-[1600px] mx-auto">
      {/* #2819: ankrene bor i Race Hub-brættet på kalender-fanen — touren mountes
          uanset fane, og OnboardingTour's egen "target ikke fundet"-fallback giver
          en escape hvis manageren står på en anden fane. */}
      <OnboardingTour pageKey="races" steps={racesTourSteps} />
      <PageHeader
        title={t("title")}
        subtitle={
          season
            ? t("subtitle.withSeason", { number: season.number, count: myRaces.length })
            : t("subtitle.noSeasonWithCount", { count: myRaces.length })
        }
      />

      {/* Tabs */}
      <Tabs value={tab} onChange={changeTab} className="mb-5">
        <TabList label={t("title")}>
          {[
            { key: "calendar", label: t("tabs.calendar") },
            { key: "world", label: t("tabs.world") },
          ].map(tb => (
            <Tab key={tb.key} value={tb.key}>{tb.label}</Tab>
          ))}
        </TabList>
      </Tabs>

      {/* Calendar tab */}
      {tab === "calendar" && (
        <div>
          {/* Race Hub Fase 1 — trup-fordeling-board'et afløser den flade "kommende"-liste
              som landing (overlap-fordeling pr. dag). Afsluttede løb + resultat-panel under. */}
          <RaceHubBoard />
          <div className="grid md:grid-cols-2 gap-4 mt-8">
          <div>
            {/* Completed */}
            {racesByStatus.completed.length > 0 && (
              <Section>
                <SectionHeader title={t("calendar.completed")} />
                <div className="flex flex-col gap-2">
                  {racesByStatus.completed.map(race => (
                    <Card key={race.id} interactive
                      className={`p-4 cursor-pointer ${selectedRace?.id === race.id ? "border-cz-accent/40" : ""}`}
                      onClick={() => handleRaceClick(race)}>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-cz-1 font-medium text-sm">{race.name}</p>
                          <p className="text-cz-3 text-xs mt-0.5">
                            {t("calendar.resultsImported", { count: race.results?.length || 0 })}
                          </p>
                        </div>
                        <span className="text-3xs uppercase bg-cz-success-bg text-cz-success border border-cz-success/30 px-2 py-0.5 rounded-full">
                          {t("status.completed")}
                        </span>
                      </div>
                      <RaceCardRouteThumbnail race={race} profiles={stageProfilesByRace[race.id]} />
                    </Card>
                  ))}
                </div>
              </Section>
            )}

            {myRaces.length === 0 && (
              <EmptyState
                icon={<FlagIcon size={28} />}
                title={t("empty.noRacesSeason")}
                description={isAdmin ? t("empty.addRaceAdmin") : null}
              />
            )}
          </div>

          {/* Race detail panel */}
          <div>
            {selectedRace ? (
              <Section className="sticky top-4">
                <h2 className="text-cz-1 font-bold text-base mb-1">{selectedRace.name}</h2>
                <p className="text-cz-3 text-xs mb-1">
                  {selectedRace.race_type === "stage_race" ? t("raceType.stages", { count: selectedRace.stages }) : t("raceType.oneDay")}
                </p>
                {(() => {
                  const expected = computeExpectedRacePrize({
                    raceClass: selectedRace.race_class,
                    raceType: selectedRace.race_type,
                    stages: selectedRace.stages,
                    racePoints,
                  });
                  return expected > 0 ? (
                    <p className="text-cz-2 text-xs font-mono mb-4" title={t("calendar.expectedPoolTooltip")}>
                      {t("calendar.expectedPool", { amount: formatExpectedPrize(expected) })}
                    </p>
                  ) : <div className="mb-4" />;
                })()}

                {selectedRace.loading && <SkeletonLines lines={4} className="py-4" />}

                {!selectedRace.loading && selectedRace.results?.length === 0 && (
                  <EmptyState title={t("calendar.noResultsYet")} />
                )}

                {!selectedRace.loading && selectedRace.results?.length > 0 && (
                  <div>
                    <Link to={`/races/${selectedRace.id}`}
                      className="inline-flex items-center gap-1 mb-4 text-xs font-medium text-cz-accent-t hover:underline">
                      {selectedRace.race_type === "stage_race" ? t("calendar.viewFullWithStages") : t("calendar.viewFull")}
                    </Link>
                    {RESULT_TYPES.map(rt => {
                      const rows = selectedRace.results.filter(r => r.result_type === rt.key).slice(0, 10);
                      if (!rows.length) return null;
                      return (
                        <div key={rt.key} className="mb-4">
                          <p className="text-cz-2 text-xs uppercase tracking-wider mb-2 font-semibold">{t(`resultType.${rt.key}`)}</p>
                          <table data-sort-exempt="Loebsresultat top-10, sorteret paa placering" className="w-full text-xs">
                            <tbody>
                              {rows.map(r => (
                                <tr key={r.id} className="border-b border-cz-border last:border-0">
                                  <td className="py-1.5 w-6 text-cz-3 font-mono">#{r.rank}</td>
                                  <td className="py-1.5">
                                    <RiderLink id={r.rider?.id}
                                      className="cursor-pointer hover:text-cz-accent-t transition-colors block">
                                      <span className="text-cz-1">{r.rider?.firstname} {r.rider?.lastname}</span>
                                      <span className="text-cz-3 ms-2">{r.rider?.team?.name || t("common.free")}</span>
                                    </RiderLink>
                                  </td>
                                  <td className="py-1.5 text-right text-cz-success font-mono">
                                    {r.prize_money > 0 ? `+${r.prize_money}` : ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            ) : (
              <EmptyState
                className="sticky top-4"
                icon={<FlagIcon size={26} aria-hidden="true" />}
                title={t("calendar.selectPrompt")}
              />
            )}
          </div>
        </div>
        </div>
      )}

      {/* Verdens-kalender tab (Slice 09) — read-only katalog af alle løb */}
      {tab === "world" && (
        <div>
          {worldLoading && <p className="text-cz-3 text-sm">{t("world.loading")}</p>}
          {!worldLoading && (
            <>
              <Section className="mb-4">
                <SectionHeader title={t("world.totalRaces", { count: worldPool.length })} />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                  {RACE_CLASS_OPTIONS.map(opt => {
                    const s = worldSummary[opt.value];
                    if (!s || s.count === 0) return null;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setWorldFilterClass(worldFilterClass === opt.value ? "" : opt.value)}
                        className={`flex justify-between items-center px-3 py-2 rounded-lg border text-left transition-all
                          ${worldFilterClass === opt.value
                            ? "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t"
                            : "border-cz-border text-cz-2 hover:bg-cz-subtle"}`}
                      >
                        <span className="truncate">{t(`classOption.${opt.value}`)}</span>
                        <span className="text-cz-3 text-xs whitespace-nowrap ms-2">
                          {t("world.classSummary", { count: s.count, days: s.raceDays })}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {worldFilterClass && (
                  <p className="text-cz-3 text-xs mt-2">
                    {t("world.filteredOn", { class: t(`classOption.${worldFilterClass}`) })}{" "}
                    <button onClick={() => setWorldFilterClass("")} className="text-cz-accent-t underline">
                      {t("world.clearFilter")}
                    </button>
                  </p>
                )}
              </Section>

              <DataTable
                label={t("tabs.world")}
                rowKey={(r) => r.id}
                sort={worldSort.sort}
                sortDir={worldSort.sortDir}
                onSort={worldSort.handleSort}
                rows={sortRows(
                  worldPool.filter(r => !worldFilterClass || r.race_class === worldFilterClass),
                  worldSort.sort ? WORLD_ACCESSORS[worldSort.sort] : null,
                  worldSort.sortDir,
                )}
                columns={[
                  { key: "name", header: t("world.thRace"), sticky: true, sortKey: "name" },
                  { key: "race_class", header: t("world.thClass"), sortKey: "race_class", fold: true },
                  {
                    key: "race_type",
                    header: t("world.thType"),
                    sortKey: "race_type",
                    fold: true,
                    render: (r) => (r.race_type === "single" ? t("raceType.oneDayShort") : t("resultType.stage")),
                    foldValue: (r) => (r.race_type === "single" ? t("raceType.oneDayShort") : t("resultType.stage")),
                  },
                  { key: "stages", header: t("world.thStages"), numeric: true, sortKey: "stages" },
                ]}
              />
            </>
          )}
        </div>
      )}

    </div>
  );
}
