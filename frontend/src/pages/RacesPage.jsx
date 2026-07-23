import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import RacePointsPage from "./RacePointsPage";
import RaceHubBoard from "../components/racehub/RaceHubBoard.jsx";
import { dateTextToDayOfYear } from "../lib/raceCalendar";
import { sortRacesByDateDesc } from "../lib/raceCalendarSort";
import { racesForPool } from "../lib/racesByPool";
import { deriveRaceStatus } from "../lib/raceHubLogic.js";
import { useSortState, sortRows } from "../lib/useTableSort.js";
import { computeExpectedRacePrize, formatExpectedPrize } from "../lib/expectedPrizeCalculator";
import { hasRouteData, sharedYMax } from "../lib/stageRouteProfile.js";
import StageProfileGraph from "../components/race/StageProfileGraph.jsx";
import {
  Card,
  Input,
  Select,
  Table,
  Tr,
  Th,
  Td,
  Tabs,
  TabList,
  Tab,
  EmptyState,
  Spinner,
  FlagIcon,
  PageLoader,
} from "../components/ui";
import { labelClass } from "../components/ui/fieldStyles.js";

// Labels resolves via t() ved render — se races-namespacet (resultType.*, classOption.*, status.*).
const RESULT_TYPES = [
  { key: "stage" },
  { key: "gc" },
  { key: "points" },
  { key: "mountain" },
  { key: "young" },
];

const RACE_CLASS_OPTIONS = [
  { value: "TourFrance" },
  { value: "GiroVuelta" },
  { value: "Monuments" },
  { value: "OtherWorldTourA" },
  { value: "OtherWorldTourB" },
  { value: "OtherWorldTourC" },
  { value: "ProSeries" },
  { value: "Class1" },
  { value: "Class2" },
];

const RACE_STATUS_OPTIONS = [
  { value: "completed" },
  { value: "active" },
  { value: "scheduled" },
];

const VALID_TABS = ["calendar", "library", "world", "points"];

// Sorterbare kolonner i løbs-bibliotek + verdens-katalog (klient-side, delt
// useSortState/sortRows). Tekst-kolonner starter stigende; sæson/etaper (tal)
// starter faldende (nyeste/flest først) via descFirstKeys.
const LIBRARY_ACCESSORS = {
  name: (r) => r.name,
  season: (r) => r.season?.number ?? 0,
  race_class: (r) => r.race_class ?? "",
  race_type: (r) => r.race_type ?? "",
  status: (r) => deriveRaceStatus(r.status, r.stages_completed, r.stages),
};
const LIBRARY_DESC_FIRST = new Set(["season"]);
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

export default function RacesPage() {
  const { t } = useTranslation("races");
  const navigate = useNavigate();
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

  // Library state (lazy loaded når tab="library" åbnes første gang)
  const [libRaces, setLibRaces] = useState([]);
  const [libSeasons, setLibSeasons] = useState([]);
  const [libLoaded, setLibLoaded] = useState(false);
  const [libLoading, setLibLoading] = useState(false);
  const [libFilterSeason, setLibFilterSeason] = useState("");
  const [libFilterClass, setLibFilterClass] = useState("");
  const [libFilterStatus, setLibFilterStatus] = useState("");
  const [libSearch, setLibSearch] = useState("");
  // #2081 (zootne, Discord 2/7): "hvad kørte jeg i dag" er lettere at finde når
  // listen er begrænset til egen pulje. Genbruger myPoolId (allerede hentet i
  // loadAll for kalender-fanen — samme state, ikke division-specifik data).
  const [libMyDivisionOnly, setLibMyDivisionOnly] = useState(false);

  // World pool state (Slice 09 — lazy load når tab="world" åbnes)
  const [worldPool, setWorldPool] = useState([]);
  const [worldSummary, setWorldSummary] = useState({});
  const [worldLoaded, setWorldLoaded] = useState(false);
  const [worldLoading, setWorldLoading] = useState(false);
  const [worldFilterClass, setWorldFilterClass] = useState("");

  // Klient-sortering af bibliotek- + verdens-tabellerne (klikbare headers).
  const librarySort = useSortState({ descFirstKeys: LIBRARY_DESC_FIRST });
  const worldSort = useSortState({ descFirstKeys: WORLD_DESC_FIRST });

  // Tab → URL sync (deep-linkbar fra eksterne kilder, fx /races?tab=library)
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

  async function loadLibrary() {
    setLibLoading(true);
    const [racesRes, seasonsRes] = await Promise.all([
      supabase
        .from("races")
        .select("id, name, race_type, race_class, stages, stages_completed, status, edition_year, league_division_id, pool_race:pool_race_id(date_text), season:season_id(id, number, status)")
        .order("name"),
      // #2763: sæson 0 (bogførings-sæson, 0 løb) filtreres ud af biblioteks-
      // vælgeren — samme diskriminator som #2600 (.gt("number", 0)).
      supabase
        .from("seasons")
        .select("id, number, status")
        .gt("number", 0)
        .order("number", { ascending: false }),
    ]);
    setLibRaces(racesRes.data || []);
    setLibSeasons(seasonsRes.data || []);
    setLibLoaded(true);
    setLibLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (tab === "library" && !libLoaded && !libLoading) {
      loadLibrary();
    }
    if (tab === "world" && !worldLoaded && !worldLoading) {
      loadWorld();
    }
  }, [tab, libLoaded, libLoading, worldLoaded, worldLoading]);

  const filteredLibRaces = useMemo(() => {
    const base = libMyDivisionOnly ? racesForPool(libRaces, myPoolId) : libRaces;
    const filtered = base.filter(r => {
      if (libFilterSeason && r.season?.id !== libFilterSeason) return false;
      if (libFilterClass && r.race_class !== libFilterClass) return false;
      if (libFilterStatus && r.status !== libFilterStatus) return false;
      if (libSearch && !r.name.toLowerCase().includes(libSearch.toLowerCase())) return false;
      return true;
    });
    // #2081: nyeste (afsluttede) løb først i stedet for alfabetisk — "hvad kørte
    // jeg i dag" skal ligge øverst uden at spilleren skal gennemgå hele listen.
    return sortRacesByDateDesc(filtered);
  }, [libRaces, libFilterSeason, libFilterClass, libFilterStatus, libSearch, libMyDivisionOnly, myPoolId]);

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
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
          <p className="text-cz-3 text-sm">
            {tab === "library"
              ? t("subtitle.library", { count: libRaces.length })
              : tab === "points"
              ? t("subtitle.points")
              : season
              ? t("subtitle.withSeason", { number: season.number, count: myRaces.length })
              : t("subtitle.noSeasonWithCount", { count: myRaces.length })}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onChange={changeTab} className="mb-5">
        <TabList label={t("title")}>
          {[
            { key: "calendar", label: t("tabs.calendar") },
            { key: "library", label: t("tabs.library") },
            { key: "world", label: t("tabs.world") },
            { key: "points", label: t("tabs.points") },
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
              <div>
                <h2 className="text-cz-2 text-xs uppercase tracking-wider mb-3 font-semibold">{t("calendar.completed")}</h2>
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
                        <span className="text-[9px] uppercase bg-cz-success-bg text-cz-success border border-cz-success/30 px-2 py-0.5 rounded-full">
                          {t("status.completed")}
                        </span>
                      </div>
                      <RaceCardRouteThumbnail race={race} profiles={stageProfilesByRace[race.id]} />
                    </Card>
                  ))}
                </div>
              </div>
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
              <Card className="p-5 sticky top-4">
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

                {selectedRace.loading && (
                  <div className="flex justify-center py-8">
                    <Spinner size={20} />
                  </div>
                )}

                {!selectedRace.loading && selectedRace.results?.length === 0 && (
                  <div className="text-center py-8 text-cz-3 text-sm">
                    <p>{t("calendar.noResultsYet")}</p>
                  </div>
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
              </Card>
            ) : (
              <Card className="p-8 text-center text-cz-3 sticky top-4">
                <FlagIcon size={24} className="mx-auto mb-2 text-cz-3" />
                <p className="text-sm">{t("calendar.selectPrompt")}</p>
              </Card>
            )}
          </div>
        </div>
        </div>
      )}

      {/* Library tab — alle løb på tværs af sæsoner med filtre */}
      {tab === "library" && (
        <div>
          {/* Filter bar */}
          <Card className="p-4 mb-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="lib-search" className={labelClass()}>{t("library.searchLabel")}</label>
              <Input id="lib-search" type="text" value={libSearch} onChange={e => setLibSearch(e.target.value)}
                placeholder={t("library.searchPlaceholder")} />
            </div>
            <div>
              <label htmlFor="lib-season" className={labelClass()}>{t("library.seasonLabel")}</label>
              <Select id="lib-season" value={libFilterSeason} onChange={e => setLibFilterSeason(e.target.value)}>
                <option value="">{t("library.allSeasons")}</option>
                {libSeasons.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.status === "active"
                      ? t("library.seasonOptionActive", { number: s.number })
                      : t("library.seasonOption", { number: s.number })}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="lib-class" className={labelClass()}>{t("library.classLabel")}</label>
              <Select id="lib-class" value={libFilterClass} onChange={e => setLibFilterClass(e.target.value)}>
                <option value="">{t("library.allClasses")}</option>
                {RACE_CLASS_OPTIONS.map(c => (
                  <option key={c.value} value={c.value}>{t(`classOption.${c.value}`)}</option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="lib-status" className={labelClass()}>{t("library.statusLabel")}</label>
              <Select id="lib-status" value={libFilterStatus} onChange={e => setLibFilterStatus(e.target.value)}>
                <option value="">{t("library.allStatuses")}</option>
                {RACE_STATUS_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{t(`status.${s.value}`)}</option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="lib-my-division" className={labelClass()}>{t("library.myDivisionOnly")}</label>
              <label htmlFor="lib-my-division" className="flex items-center gap-2 h-10 px-1 cursor-pointer select-none">
                <input id="lib-my-division" type="checkbox" checked={libMyDivisionOnly}
                  onChange={e => setLibMyDivisionOnly(e.target.checked)}
                  className="rounded border-cz-border" />
                <span className="text-sm text-cz-2">{t("library.myDivisionOnly")}</span>
              </label>
            </div>
          </Card>

          {(libFilterSeason || libFilterClass || libFilterStatus || libSearch || libMyDivisionOnly) && (
            <div className="flex items-center justify-between mb-3 px-1">
              <p className="text-cz-3 text-xs">
                {t("library.filteredCount", { filtered: filteredLibRaces.length, total: libRaces.length })}
              </p>
              <button
                onClick={() => {
                  setLibFilterSeason(""); setLibFilterClass(""); setLibFilterStatus(""); setLibSearch(""); setLibMyDivisionOnly(false);
                }}
                className="text-cz-accent-t text-xs hover:underline">
                {t("library.clearFilters")}
              </button>
            </div>
          )}

          {libLoading ? (
            <PageLoader />
          ) : filteredLibRaces.length === 0 ? (
            <EmptyState icon={<FlagIcon size={28} />} title={t("empty.noRacesMatch")} />
          ) : (
            <Card className="overflow-hidden">
              <Table className="text-sm" data-sortable>
                <thead>
                  <Tr className="hover:bg-transparent">
                    <Th sortKey="name" sort={librarySort.sort} sortDir={librarySort.sortDir} onSort={librarySort.handleSort}>{t("library.thRace")}</Th>
                    <Th sortKey="season" sort={librarySort.sort} sortDir={librarySort.sortDir} onSort={librarySort.handleSort}>{t("library.thSeason")}</Th>
                    <Th sortKey="race_class" sort={librarySort.sort} sortDir={librarySort.sortDir} onSort={librarySort.handleSort}>{t("library.thClass")}</Th>
                    <Th sortKey="race_type" sort={librarySort.sort} sortDir={librarySort.sortDir} onSort={librarySort.handleSort}>{t("library.thType")}</Th>
                    <Th sortKey="status" sort={librarySort.sort} sortDir={librarySort.sortDir} onSort={librarySort.handleSort}>{t("library.thStatus")}</Th>
                  </Tr>
                </thead>
                <tbody>
                  {sortRows(filteredLibRaces, librarySort.sort ? LIBRARY_ACCESSORS[librarySort.sort] : null, librarySort.sortDir).map(r => {
                    const classMeta = RACE_CLASS_OPTIONS.find(c => c.value === r.race_class);
                    // Afled visnings-status (#1828): igangværende etapeløb vises "Live", ikke "Kommende".
                    const derivedStatus = deriveRaceStatus(r.status, r.stages_completed, r.stages);
                    return (
                      <Tr key={r.id}
                        onClick={() => navigate(`/race-archive/${encodeURIComponent(r.name)}`)}
                        className="cursor-pointer">
                        <Td className="text-cz-1 font-medium">{r.name}</Td>
                        <Td className="text-cz-2 text-xs">
                          {r.season ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/seasons/${r.season.id}`); }}
                              className="text-cz-accent-t hover:underline">
                              {t("library.seasonLink", { number: r.season.number })}
                            </button>
                          ) : "—"}
                        </Td>
                        <Td className="text-cz-2 text-xs">
                          {classMeta ? t(`classOption.${r.race_class}`) : (r.race_class ?? "—")}
                        </Td>
                        <Td className="text-cz-2 text-xs">
                          {r.race_type === "stage_race" ? t("raceType.stageRaceParen", { count: r.stages }) : t("raceType.oneDayShort")}
                        </Td>
                        <Td className="text-xs">
                          <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] uppercase
                            ${derivedStatus === "completed" ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                              : derivedStatus === "live" ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                              : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                            {t(`status.${derivedStatus}`)}
                          </span>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* Verdens-kalender tab (Slice 09) — read-only katalog af alle løb */}
      {tab === "world" && (
        <div>
          {worldLoading && <p className="text-cz-3 text-sm">{t("world.loading")}</p>}
          {!worldLoading && (
            <>
              <Card className="p-4 mb-4">
                <p className="text-cz-2 font-medium text-sm mb-3">
                  {t("world.totalRaces", { count: worldPool.length })}
                </p>
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
              </Card>

              <Card className="overflow-hidden">
                <Table className="text-sm" data-sortable>
                  <thead>
                    <Tr className="hover:bg-transparent">
                      <Th sortKey="name" sort={worldSort.sort} sortDir={worldSort.sortDir} onSort={worldSort.handleSort}>{t("world.thRace")}</Th>
                      <Th sortKey="race_class" sort={worldSort.sort} sortDir={worldSort.sortDir} onSort={worldSort.handleSort}>{t("world.thClass")}</Th>
                      <Th sortKey="race_type" sort={worldSort.sort} sortDir={worldSort.sortDir} onSort={worldSort.handleSort}>{t("world.thType")}</Th>
                      <Th numeric sortKey="stages" sort={worldSort.sort} sortDir={worldSort.sortDir} onSort={worldSort.handleSort}>{t("world.thStages")}</Th>
                    </Tr>
                  </thead>
                  <tbody>
                    {sortRows(
                      worldPool.filter(r => !worldFilterClass || r.race_class === worldFilterClass),
                      worldSort.sort ? WORLD_ACCESSORS[worldSort.sort] : null,
                      worldSort.sortDir,
                    ).map(r => (
                        <Tr key={r.id}>
                          <Td className="text-cz-1">{r.name}</Td>
                          <Td className="text-cz-2">{r.race_class}</Td>
                          <Td className="text-cz-2">{r.race_type === "single" ? t("raceType.oneDayShort") : t("resultType.stage")}</Td>
                          <Td numeric className="text-cz-2">{r.stages}</Td>
                        </Tr>
                      ))}
                  </tbody>
                </Table>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Point & præmier tab — embedder RacePointsPage som tab-indhold */}
      {tab === "points" && (
        <div className="-mt-2">
          <RacePointsPage />
        </div>
      )}
    </div>
  );
}
