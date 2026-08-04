// #3102 etape 3 — afsluttede løb + resultat-panelet fra /races' kalender-fane,
// flyttet til Resultat-hubbens Seneste-fane som selvstændig komponent (samme
// mønster som RaceArchiveTable: komponenten ejer sin egen data-hentning).
// Seneste-kortene ovenover viser podiet for de 9 nyeste; denne flade er den
// fulde liste med klik-til-top-10 pr. klassement + forventet præmiesum.
// Ren flytning fra RacesPage.jsx (nedlagt) — queries og interaktion er uændret.
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { Link } from "react-router";
import RiderLink from "../RiderLink";
import { sortRacesByDateDesc } from "../../lib/raceCalendarSort";
import { racesForPool } from "../../lib/racesByPool";
import { raceHasReportableResults, raceIsInProgress } from "../../lib/raceResultVisibility.js";
import { computeExpectedRacePrize, formatExpectedPrize } from "../../lib/expectedPrizeCalculator";
import { hasRouteData, sharedYMax } from "../../lib/stageRouteProfile.js";
import StageProfileGraph from "./StageProfileGraph.jsx";
import {
  Card,
  EmptyState,
  FlagIcon,
  Section,
  SectionHeader,
  SkeletonLines,
} from "../ui";

// Labels resolves via t() ved render — se races-namespacet (resultType.*).
const RESULT_TYPES = [
  { key: "stage" },
  { key: "gc" },
  { key: "points" },
  { key: "mountain" },
  { key: "young" },
];

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

export default function CompletedRacesExplorer() {
  const { t } = useTranslation(["races", "results"]);

  const [races, setRaces] = useState([]);
  const [racePoints, setRacePoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRace, setSelectedRace] = useState(null);
  // #1715 — spillerens egen liga-pulje (teams.league_division_id), så de 7
  // puljers løb ikke blandes i én liste (gav dublet-lignende visning).
  const [myPoolId, setMyPoolId] = useState(null);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) { setLoading(false); return; }

    const [racesRes, racePointsRes, myTeamRes] = await Promise.all([
      // #1715: league_division_id med, så listen kan filtrere til spillerens pulje.
      // #3297: season:season_id(number) med, så sortRacesByDateDesc kan sortere
      // på sæson FØR dato — listen henter afsluttede løb på tværs af sæsoner,
      // og dato-nøglen alene (dd/mm uden årstal) blander S1- og S2-løb tilfældigt.
      supabase.from("races").select("*, league_division_id, results:race_results(id), pool_race:pool_race_id(date_text), season:season_id(number)").order("name"),
      supabase.from("race_points").select("race_class, result_type, rank, points"),
      supabase.from("teams").select("league_division_id").eq("user_id", user.id).maybeSingle(),
    ]);

    setRaces(racesRes.data || []);
    setRacePoints(racePointsRes.data || []);
    setMyPoolId(myTeamRes.data?.league_division_id ?? null);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

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

  const myRaces = useMemo(() => racesForPool(races, myPoolId), [races, myPoolId]);

  // #1930: afsluttede/igangværende løb vises nyeste-først (spejler kommende-
  // sorteringen men DESC). Memoized separat (#2448 Task 12) så profil-fetch-
  // effekten herunder kun genkører når selve løbslisten ændrer sig — ikke ved
  // hvert render (fx et klik der sætter selectedRace).
  // #3333 — raceHasReportableResults er DET delte prædikat med ResultaterPage's
  // Seneste-fane: et etapeløb beholder status='scheduled' hele afviklingen, så
  // det gamle `r.results?.length > 0 || r.status === "completed"` var uenigt med
  // Seneste-fanens (dengang strengere) filter om hvad "afsluttet" betyder.
  const completedRaces = useMemo(
    () => sortRacesByDateDesc(myRaces.filter(raceHasReportableResults)),
    [myRaces],
  );
  const completedRaceIds = useMemo(() => completedRaces.map(r => r.id), [completedRaces]);

  // #2448 (Task 12): rutedata KUN for de løb der faktisk renderes som kort —
  // ét .in()-kald, ikke hele kataloget. Gaten er målt mod prod (40 løb →
  // 60 ms / 89 kB, budget 150 ms / 250 kB) og PASSERER.
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
        // listen. Samme degradér-ærligt-mønster som passagesPromise i
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

  if (loading) return <SkeletonLines lines={4} className="py-4" />;
  // Ingen afsluttede løb endnu: Seneste-fanens egen tom-state ovenover dækker
  // den situation — en ekstra tom sektion her ville bare gentage beskeden.
  if (completedRaces.length === 0) return null;

  // Markup'en spejler den gamle kalender-fanes to-kolonne-grid 1:1 — kort-liste
  // til venstre, sticky resultat-panel til højre.
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Section>
        <SectionHeader title={t("calendar.completed")} />
        <div className="flex flex-col gap-2">
          {completedRaces.map(race => {
            // #3333 — igangværende etapeløb (status stadig 'scheduled', men
            // stages_completed>0) må ALDRIG bære "Completed"-badgen: viser i
            // stedet en "Live"-pille + kørt-status ("Etape 14 af 21") i stedet
            // for den ellers meningsløse "N results imported" for et løb der
            // stadig kører.
            const inProgress = raceIsInProgress(race);
            return (
              <Card key={race.id} interactive
                className={`p-4 cursor-pointer ${selectedRace?.id === race.id ? "border-cz-accent/40" : ""}`}
                onClick={() => handleRaceClick(race)}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-cz-1 font-medium text-sm">{race.name}</p>
                    <p className="text-cz-3 text-xs mt-0.5">
                      {inProgress
                        ? t("results:latest.stageProgress", { done: race.stages_completed ?? 0, total: race.stages })
                        : t("calendar.resultsImported", { count: race.results?.length || 0 })}
                    </p>
                  </div>
                  {inProgress ? (
                    <span className="text-3xs uppercase bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 px-2 py-0.5 rounded-full">
                      {t("status.live")}
                    </span>
                  ) : (
                    <span className="text-3xs uppercase bg-cz-success-bg text-cz-success border border-cz-success/30 px-2 py-0.5 rounded-full">
                      {t("status.completed")}
                    </span>
                  )}
                </div>
                <RaceCardRouteThumbnail race={race} profiles={stageProfilesByRace[race.id]} />
              </Card>
            );
          })}
        </div>
      </Section>

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
  );
}
