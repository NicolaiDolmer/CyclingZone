import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useNavigate, useSearchParams } from "react-router";
import RiderLink from "../components/RiderLink";
import RacePointsPage from "./RacePointsPage";
import RaceArchiveTable from "../components/race/RaceArchiveTable.jsx";
import CompletedRacesExplorer from "../components/race/CompletedRacesExplorer.jsx";
import WorldCatalog from "../components/race/WorldCatalog.jsx";
import { Flag } from "../components/Flag";
import { formatNumber, formatDate } from "../lib/intl";
import { sortRacesByDateDesc } from "../lib/raceCalendarSort";
import { filterByDivisionPool, ALL_DIVISIONS_VALUE, ALL_POOLS_VALUE } from "../lib/resultsFilter";
import { latestScheduledMsByRace } from "../lib/raceCompletionDate";
import { RULES_NUMBERS } from "../lib/rulesNumbers";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import {
  Card,
  Button,
  Select,
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

// #3197 — division-vælgerens faste tier-liste (1..4), samme kilde som
// StandingsPage's ALL_DIVISIONS, så begge flader viser identiske tiers uanset
// om league_divisions (endnu) har rækker for alle af dem.
const ALL_DIVISIONS = Array.from(
  { length: RULES_NUMBERS.maxDivision - RULES_NUMBERS.minDivision + 1 },
  (_, i) => RULES_NUMBERS.minDivision + i,
);

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
  const [raceScheduleMs, setRaceScheduleMs] = useState(() => new Map());
  const [topTeams, setTopTeams] = useState([]);
  const [topRiders, setTopRiders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // #3197 — sæson/division/pulje-vælgernes afledte kontekst (ejerens egen sæson +
  // division + pulje, fundet ved load). Bruges både til at BYGGE queryen og til
  // at vise vælgernes nuværende værdi — se loadAllInner.
  const [availableSeasons, setAvailableSeasons] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [activeSeasonNumber, setActiveSeasonNumber] = useState(null);
  const [ownTier, setOwnTier] = useState(null);
  const [ownPoolId, setOwnPoolId] = useState(null);
  const [selectedTier, setSelectedTier] = useState(null);
  const [selectedPoolId, setSelectedPoolId] = useState(ALL_POOLS_VALUE);

  // URL'en ER fane-tilstanden — ikke en kopi i state der seedes ved mount.
  // Med en useState-kopi skifter fanen ikke når location'en ændrer sig uden en
  // remount: browserens tilbage/frem mellem ?tab=archive og ?tab=points ville
  // flytte URL'en men efterlade indholdet på den gamle fane.
  const tabParam = searchParams.get("tab");
  const tab = VALID_TABS.includes(tabParam) ? tabParam : "latest";

  // #3197 — sæson/division/pulje er, ligesom tab, URL-drevet (delelig/bogmærkbar
  // visning). Fraværende param = "brug default" (nuværende sæson / egen division+
  // pulje) — netop derfor er default-kaldet aldrig synligt i URL'en, kun afvigelser.
  // division: fraværende → undefined (brug egen tier); "all" → null (alle
  // divisioner); ellers → tier-tal. pool: fraværende → undefined (brug egen
  // pulje); ellers → rå værdi ("all" eller et pulje-id).
  const seasonParamRaw = searchParams.get("season");
  const seasonParam = seasonParamRaw != null && seasonParamRaw !== "" ? Number(seasonParamRaw) : null;
  const divisionParamRaw = searchParams.get("division");
  const divisionParam = divisionParamRaw == null
    ? undefined
    : divisionParamRaw === ALL_DIVISIONS_VALUE ? null : Number(divisionParamRaw);
  const poolParamRaw = searchParams.get("pool");
  const poolParam = poolParamRaw == null ? undefined : poolParamRaw;

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

  // Sæson-vælger: udelader param når valget matcher den aktive sæson (default).
  function changeSeason(numberStr) {
    const n = Number(numberStr);
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (n === activeSeasonNumber) params.delete("season");
      else params.set("season", String(n));
      return params;
    }, { replace: true });
  }

  // Division-vælger: udelader param når valget matcher egen division (default).
  // Skifter division nulstiller ALTID pulje-valget (samme mønster som
  // StandingsPage's divTab→poolTab-reset) — den nye tiers default (egen pulje
  // hvis det er egen division, ellers "alle puljer") beregnes i loadAllInner.
  function changeDivision(value) {
    const isAll = value === ALL_DIVISIONS_VALUE;
    const tierNum = isAll ? null : Number(value);
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (tierNum === ownTier) params.delete("division");
      else params.set("division", isAll ? ALL_DIVISIONS_VALUE : String(tierNum));
      params.delete("pool");
      return params;
    }, { replace: true });
  }

  // Pulje-vælger: udelader param når valget matcher den valgte tiers default
  // (egen pulje hvis tieren er egen division, ellers "alle puljer").
  function changePool(value) {
    const defaultForTier = selectedTier === ownTier ? ownPoolId : ALL_POOLS_VALUE;
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (String(value) === String(defaultForTier)) params.delete("pool");
      else params.set("pool", value);
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
    const { data: { user } } = await supabase.auth.getUser();

    // #3197 — sæson-listen, division/pulje-referencedata og holdets egen pulje er
    // alle uafhængige af hinanden (og af hvilken sæson der ender med at blive
    // valgt) — hentes parallelt i stedet for sekventielt.
    const [seasonsRes, divisionsRes, myTeamRes] = await Promise.all([
      // #2763: sæson 0 (bogførings-sæson, 0 løb) er ikke en rigtig spillesæson.
      supabase.from("seasons").select("id, number, status").gt("number", 0).order("number", { ascending: false }),
      supabase.from("league_divisions").select("id, tier, pool_index, label").order("tier").order("pool_index"),
      // #1715: spillerens egen pulje — hubbens default-kontekst (#2182-princippet:
      // default er spillerens egen verden), ikke en fast forvalgt sæson-visning.
      user
        ? supabase.from("teams").select("league_division_id").eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (seasonsRes.error) throw seasonsRes.error;
    if (divisionsRes.error) throw divisionsRes.error;

    const seasons = seasonsRes.data || [];
    setAvailableSeasons(seasons);
    const divisionRows = divisionsRes.data || [];
    setDivisions(divisionRows);
    const divisionsById = new Map(divisionRows.map(d => [d.id, d]));

    const resolvedOwnPoolId = myTeamRes.data?.league_division_id ?? null;
    const resolvedOwnTier = resolvedOwnPoolId != null ? (divisionsById.get(resolvedOwnPoolId)?.tier ?? null) : null;
    setOwnPoolId(resolvedOwnPoolId);
    setOwnTier(resolvedOwnTier);

    const activeSeasonRow = seasons.find(s => s.status === "active") || null;
    setActiveSeasonNumber(activeSeasonRow?.number ?? null);
    const fallbackSeasonRow = activeSeasonRow || seasons[0] || null;

    // season: ?season=N vinder, ellers den aktive sæson, ellers den nyeste
    // oprettede (fx før S1 er sat aktiv). division: fraværende param → egen
    // tier; "all" → ingen tier-filter. pool: fraværende param → egen pulje HVIS
    // den valgte tier er egen division, ellers "alle puljer" (samme reset-regel
    // som når man skifter division via vælgeren).
    const resolvedSeasonNumber = Number.isFinite(seasonParam) ? seasonParam : (fallbackSeasonRow?.number ?? null);
    const seasonRow = seasons.find(s => s.number === resolvedSeasonNumber) || fallbackSeasonRow;
    setSeason(seasonRow);

    const resolvedTier = divisionParam === undefined ? resolvedOwnTier : divisionParam;
    setSelectedTier(resolvedTier);
    const resolvedPoolId = poolParam !== undefined
      ? poolParam
      : (resolvedTier === resolvedOwnTier ? (resolvedOwnPoolId ?? ALL_POOLS_VALUE) : ALL_POOLS_VALUE);
    setSelectedPoolId(resolvedPoolId);

    if (!seasonRow) { return; }

    const selection = { tier: resolvedTier, poolId: resolvedPoolId };

    // #2444 · topRiders hentede tidligere ALLE sæsonens races + ALLE deres
    // race_results (paginated fetchAllRows — kunne være titusindvis af rækker)
    // og aggregerede point/sejre i JS, bare for at vise top-5. rider_rankings_mv
    // (samme matview som RiderRankingsPage/#2175 bruger) har allerede disse tal
    // færdig-aggregeret server-side — én let query mod top-5 + en lille display-
    // join for de 5 rytter-id'er, ingen paginering nødvendig.
    //
    // #3197: Topscorere forbliver SÆSON-BREDT (uændret fra før vælgerne) — at
    // gøre den korrekt pulje-scoped kræver at hente/paginere HELE sæsonens
    // rider_rankings_mv (samme omfang som RiderRankingsPage), for at undgå at
    // "top 5 overall" limiteres FØR pulje-filtreringen kan fjerne nogle af dem.
    // Tophold er billigere at rette rigtigt (season_standings er lille) og er
    // derfor pulje-scoped nedenfor.
    const [standingsRes, topRiderStatsRes, finishedRacesRes] = await Promise.all([
      supabase
        .from("season_standings")
        .select("total_points, stage_wins, gc_wins, team:team_id(id, name, is_ai, division, league_division_id)")
        .eq("season_id", seasonRow.id)
        .order("total_points", { ascending: false })
        .limit(1000),
      supabase
        .from("rider_rankings_mv")
        .select("rider_id, points, stage_wins, gc_wins")
        .eq("season_id", seasonRow.id)
        .order("points", { ascending: false })
        .limit(5),
      supabase
        .from("races")
        .select("id, name, race_type, race_class, stages, status, league_division_id, pool_race:pool_race_id(date_text)")
        .eq("season_id", seasonRow.id)
        .eq("status", "completed"),
    ]);
    if (standingsRes.error) throw standingsRes.error;
    if (finishedRacesRes.error) throw finishedRacesRes.error;

    const matchingTeams = filterByDivisionPool(standingsRes.data || [], s => s.team?.league_division_id, selection, divisionsById);
    setTopTeams(matchingTeams.filter(s => !s.team?.is_ai).slice(0, 3));

    // #3102 etape 2 / #3197: de faktiske resultater, nu filtreret til den valgte
    // sæson+division+pulje (default = egen kontekst) i stedet for altid egen
    // pulje i den aktive sæson. sortRacesByDateDesc er den samme rene funktion
    // kalenderen bruger, så "seneste" betyder det samme begge steder.
    const matchingFinishedRaces = filterByDivisionPool(finishedRacesRes.data || [], r => r.league_division_id, selection, divisionsById);
    const finished = sortRacesByDateDesc(matchingFinishedRaces).slice(0, LATEST_LIMIT);
    setLatestRaces(finished);

    if (finished.length) {
      // Kun podiet (rank ≤ 3) hentes, og kun de to klassementer et podie kan
      // komme fra. Uden .lte("rank", 3) ville et etapeløb trække hele feltet
      // for hver etape hjem for at vise tre navne.
      // pagination-safe: LATEST_LIMIT (9) races × rank<=3 × 2 result_types —
      // worst case ~21 stages × 3 ranks + 3 gc podium per race ≈ 66 rows ×
      // 9 races ≈ 594, verified comfortably under the 1000-row cap (#3331
      // audit, 2026-08-05; race_stage_schedule max 21 stages/race).
      const [resultsRes, scheduleRes] = await Promise.all([
        supabase
          .from("race_results")
          .select("race_id, result_type, rank, stage_number, rider_id, rider_name, team_name, points_earned, rider:rider_id(id, firstname, lastname, nationality_code, team:team_id(id, name))")
          .in("race_id", finished.map(r => r.id))
          .in("result_type", ["gc", "stage"])
          .lte("rank", 3),
        // #3197: kortenes dato-meta var race_pool.date_text (rå import-dato uden
        // årstal, ingen forbindelse til spillets faktiske kalender — se
        // lib/raceCompletionDate.js). Den rigtige afviklingsdato er seneste
        // etapes scheduled_at.
        supabase
          .from("race_stage_schedule")
          .select("race_id, scheduled_at")
          .in("race_id", finished.map(r => r.id)),
      ]);
      // Kast, ikke tavst `|| []`: en fejlet podie-hentning skal give ErrorState
      // med retry, ikke ni løbskort der ser resultatløse ud.
      if (resultsRes.error) throw resultsRes.error;
      setLatestResults(resultsRes.data || []);
      // Etape-tider er ren visnings-bonus (datoen på kortet) — en fejl her må
      // ALDRIG vælte podie-visningen (samme degradér-ærligt-mønster som
      // RaceDetailPage's passagesPromise/#2770): degraderer til ingen dato.
      setRaceScheduleMs(scheduleRes.error ? new Map() : latestScheduledMsByRace(scheduleRes.data));
    } else {
      setLatestResults([]);
      setRaceScheduleMs(new Map());
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
    } else {
      setTopRiders([]);
    }
  }

  // #3197: sæson/division/pulje er nu del af forespørgslen (ikke kun tab) — et
  // ændret filter skal genindlæse data. tab udelades bevidst: Arkiv/Point ejer
  // deres egen data-hentning (RaceArchiveTable/RacePointsPage), et fane-skift
  // alene skal ikke re-fetche denne sides "Seneste"-forespørgsel.
  useEffect(() => { loadAll(); }, [seasonParam, divisionParam, poolParam]);
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

  // #3197 — puljer i den valgte tier (til pulje-vælgeren). Kun vist når tieren
  // reelt har mere end én pulje (samme `hasPoolSubtabs`-regel som StandingsPage).
  const tierPools = divisions
    .filter(d => d.tier === selectedTier)
    .sort((a, b) => a.pool_index - b.pool_index);
  const hasPoolSubtabs = selectedTier != null && tierPools.length > 1;

  return (
    // T2 wide data (PAGE_TEMPLATES.md): to af de tre faner er tabeller (arkivets
    // fem kolonner + point-tabellerne pr. løbsklasse), og skabelonen nævner
    // eksplicit "Results". Ruten er tilføjet til WIDE_CONTENT_ROUTES i Layout.jsx,
    // ellers ville tabellerne stadig være klemt i max-w-6xl.
    <div className="max-w-[1600px] mx-auto">
      <PageHeader
        title={t("title")}
        subtitle={
          season
            ? (season.status === "active" ? t("subtitle.active", { number: season.number }) : t("subtitle.viewing", { number: season.number }))
            : t("subtitle.noSeason")
        }
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
              {/* #3197 — sæson/division/pulje-vælgere (T2 filterbar-slot, PAGE_TEMPLATES.md:
                  op til 3 Selects). Default = nuværende sæson + spillerens egen
                  division+pulje (#2182-princippet); vælgerne er URL-synkroniserede
                  (samme mønster som ?tab= ovenfor), så en filtreret visning kan deles/
                  bogmærkes. Bevidst ÉN tynd kontrol-række uden Card-ramme — resultat-
                  kortene nedenunder skal forblive fladens dominerende indhold. */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Select
                  size="sm"
                  aria-label={t("filters.seasonLabel")}
                  value={season?.number ?? ""}
                  onChange={(e) => changeSeason(e.target.value)}
                  className="w-32"
                >
                  {availableSeasons.map(s => (
                    <option key={s.id} value={s.number}>
                      {s.status === "active"
                        ? t("filters.seasonOptionActive", { number: s.number })
                        : t("filters.seasonOption", { number: s.number })}
                    </option>
                  ))}
                </Select>
                <Select
                  size="sm"
                  aria-label={t("filters.divisionLabel")}
                  value={selectedTier ?? ALL_DIVISIONS_VALUE}
                  onChange={(e) => changeDivision(e.target.value)}
                  className="w-40"
                >
                  <option value={ALL_DIVISIONS_VALUE}>{t("filters.allDivisions")}</option>
                  {ALL_DIVISIONS.map(d => (
                    <option key={d} value={d}>{t("filters.division", { n: d })}</option>
                  ))}
                </Select>
                {hasPoolSubtabs && (
                  <Select
                    size="sm"
                    aria-label={t("filters.poolLabel")}
                    value={selectedPoolId}
                    onChange={(e) => changePool(e.target.value)}
                    className="w-40"
                  >
                    <option value={ALL_POOLS_VALUE}>{t("filters.allPools")}</option>
                    {tierPools.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </Select>
                )}
              </div>

              {/* Seneste løb i valgt sæson/division/pulje — hubbens hovedindhold. */}
              {latestRaces.length === 0 ? (
                <EmptyState
                  icon={<FlagIcon size={32} aria-hidden="true" />}
                  title={t("latest.empty")}
                  description={t("latest.emptyBody")}
                />
              ) : (
                <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-3">
                  {latestRaces.map(race => (
                    <RaceResultCard
                      key={race.id}
                      race={race}
                      podium={podiumFor(race, latestResults)}
                      playedAtMs={raceScheduleMs.get(race.id)}
                      t={t}
                    />
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

              {/* #3102 etape 3: den fulde liste af afsluttede løb + klik-til-
                  top-10-panelet, flyttet med fra /races' kalender-fane da ruten
                  blev opløst. Kortene ovenover viser podiet for de 9 nyeste;
                  denne flade er hele sæsonens liste med alle klassementer. */}
              <CompletedRacesExplorer />

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
          holdudtagelses-boardet. Etape 3: verdens-kataloget fulgte med ind
          under Arkiv da /races blev opløst — samme kigge-flade-argument. */}
      {tab === "archive" && (
        <div className="space-y-[14px]">
          <RaceArchiveTable />
          <WorldCatalog />
        </div>
      )}
      {tab === "points" && <div className="-mt-2"><RacePointsPage /></div>}
    </div>
  );
}

// Ét afsluttet løb: navn + dato/klasse som meta, podiet, og vejen videre til
// hele resultatet (RaceDetailPage). Kortet er ikke helrække-klikbart — podiets
// rytternavne er selv links, og et link i et link er ikke tilgængeligt.
function RaceResultCard({ race, podium, playedAtMs, t }) {
  // #3197 — race_pool.date_text (den tidligere meta-dato) er en rå "dd/mm"-dato
  // importeret fra et real-world løbskalender-regneark til navngivning/sortering
  // (racePoolImport.js) — den har intet årstal og ingen forbindelse til hvornår
  // løbet faktisk blev afviklet i spillet. Ejeren flaggede den som uforklarlig
  // (Discord #feedback-from-dolmer 31/7: "Disse datoer giver ingen mening").
  // playedAtMs er i stedet løbets faktiske afviklingstidspunkt (seneste etapes
  // scheduled_at, se lib/raceCompletionDate.js), vist som dansk kalenderdato.
  const playedText = playedAtMs
    ? formatDate(new Date(playedAtMs), "medium", { timeZone: "Europe/Copenhagen" })
    : null;
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
        meta={[playedText, typeText].filter(Boolean).join(" · ")}
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
