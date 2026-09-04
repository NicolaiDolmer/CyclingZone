// #1099 spec §8.1 + §9: READ-ONLY afspilning af hele historikken gennem
// omdømme-motoren. Delt af backfill-scriptet (som SKRIVER det den finder, når
// ejeren giver go) og kalibrerings-harnessen (som aldrig skriver). Én
// afspilning, ét resultat: hvis de to nogensinde er uenige, er det en bug i
// den ene af dem — ikke to konkurrerende definitioner af "hvad ville motoren
// have gjort".
//
// Hvorfor kun et UDSNIT af race_results hentes:
//   Tabellen har 1,26 mio. rækker (4/9 2026), men kun rækker der KAN blive en
//   hændelse er interessante: top-10 i gc/stage/points/mountain/young, plus
//   rank 1 i leader. Det er 42.486 rækker — 3 % af tabellen. Filteret ligger i
//   PostgREST, ikke i JS, så vi hverken betaler for eller holder resten i
//   hukommelsen. Motoren ser præcis de samme rækker som ved live-afvikling:
//   de udeladte rækker (rank > 10, team/team_day/*_day) giver pr. konstruktion
//   nul hændelser (reputationEngine.outcomeForRank / de ignorerede
//   result_types).
//
// Pagineringen er keyset (fetchAllRowsKeyset) — offset ville betale for alt
// den springer over på en tabel af denne størrelse (#4010).

import { fetchAllRows, fetchAllRowsKeyset } from "./supabasePagination.js";
import { eventsFromResultRows } from "./reputationEngine.js";

// Resultattyper der KAN give en hændelse med rank 1-10.
export const RANKED_RESULT_TYPES = Object.freeze(["gc", "stage", "points", "mountain", "young"]);
export const MAX_RELEVANT_RANK = 10;

const RACE_COLUMNS = "id, season_id, race_type, race_class, stages, status";
const RESULT_COLUMNS = "id, race_id, stage_number, result_type, rank, rider_id, team_id";

export async function loadCompletedRaces(supabase) {
  return fetchAllRowsKeyset((after) => {
    let query = supabase
      .from("races").select(RACE_COLUMNS).eq("status", "completed").order("id", { ascending: true });
    if (after) query = query.gt("id", after);
    return query;
  }, { keyColumn: "id" });
}

export async function loadRelevantResults(supabase) {
  const ranked = await fetchAllRowsKeyset((after) => {
    let query = supabase
      .from("race_results").select(RESULT_COLUMNS)
      .in("result_type", RANKED_RESULT_TYPES)
      .gte("rank", 1)
      .lte("rank", MAX_RELEVANT_RANK)
      .order("id", { ascending: true });
    if (after) query = query.gt("id", after);
    return query;
  }, { keyColumn: "id" });

  const leaderDays = await fetchAllRowsKeyset((after) => {
    let query = supabase
      .from("race_results").select(RESULT_COLUMNS)
      .eq("result_type", "leader")
      .eq("rank", 1)
      .order("id", { ascending: true });
    if (after) query = query.gt("id", after);
    return query;
  }, { keyColumn: "id" });

  return [...ranked, ...leaderDays];
}

export async function loadSeasons(supabase) {
  return fetchAllRows(() => supabase
    .from("seasons").select("id, number, status").order("number", { ascending: true }));
}

/**
 * REN afspilning (ingen I/O): kør hvert afsluttet løbs resultatrækker gennem
 * motoren og saml hændelserne.
 *
 * @returns {{events:Array, byRider:Map, perSeasonClass:Array, racesWithEvents:number,
 *            skippedResults:number, unknownRaceIds:Set<string>}}
 */
export function replayEvents({ races = [], results = [], seasons = [] } = {}) {
  const raceById = new Map(races.map((r) => [r.id, r]));
  const seasonNumberById = new Map(seasons.map((s) => [s.id, Number(s.number)]));

  const resultsByRace = new Map();
  const unknownRaceIds = new Set();
  let skippedResults = 0;
  // Dækningstal, ikke en fejl: 42 % af de relevante resultatrækker i S1-S2 har
  // rider_id = NULL (ryttere der er slettet siden, fx sammen med nedlagte
  // AI-hold). Motoren kan pr. definition ikke give omdømme for dem. Tallet
  // SKAL stå i kalibrerings-rapporten — uden det ser en lav Stjerne-andel ud
  // som en for lav vægt, i stedet for som manglende historik.
  const coverage = new Map();
  for (const row of results) {
    const seasonNumber = seasonNumberById.get(raceById.get(row.race_id)?.season_id) ?? null;
    const key = seasonNumber ?? "?";
    if (!coverage.has(key)) coverage.set(key, { season_number: seasonNumber, rows: 0, without_rider: 0 });
    const bucket = coverage.get(key);
    bucket.rows += 1;
    if (!row.rider_id) bucket.without_rider += 1;

    if (!raceById.has(row.race_id)) {
      // Resultater på et løb der ikke er 'completed' (afbrudt/gen-planlagt) —
      // tælles, aldrig gættes på.
      unknownRaceIds.add(row.race_id);
      skippedResults += 1;
      continue;
    }
    if (!resultsByRace.has(row.race_id)) resultsByRace.set(row.race_id, []);
    resultsByRace.get(row.race_id).push(row);
  }

  const events = [];
  const byRider = new Map();
  const perSeasonClass = new Map();
  let racesWithEvents = 0;

  // Deterministisk rækkefølge (race-id) — to kørsler skal give identisk output.
  for (const raceId of [...resultsByRace.keys()].sort()) {
    const race = raceById.get(raceId);
    const raceEvents = eventsFromResultRows({ race, resultRows: resultsByRace.get(raceId) });
    if (!raceEvents.length) continue;
    racesWithEvents += 1;
    for (const event of raceEvents) {
      const enriched = {
        ...event,
        season_number: seasonNumberById.get(event.season_id) ?? null,
      };
      events.push(enriched);
      if (!byRider.has(enriched.rider_id)) byRider.set(enriched.rider_id, []);
      byRider.get(enriched.rider_id).push(enriched);

      const key = `${enriched.season_number ?? "?"}|${enriched.race_class ?? "?"}`;
      if (!perSeasonClass.has(key)) {
        perSeasonClass.set(key, {
          season_number: enriched.season_number,
          race_class: enriched.race_class,
          events: 0,
          form_points: 0,
          floor_credit: 0,
        });
      }
      const bucket = perSeasonClass.get(key);
      bucket.events += 1;
      bucket.form_points += Number(enriched.form_points) || 0;
      bucket.floor_credit += Number(enriched.floor_credit) || 0;
    }
  }

  const perSeasonClassRows = [...perSeasonClass.values()].sort((a, b) =>
    (a.season_number ?? 0) - (b.season_number ?? 0) || String(a.race_class).localeCompare(String(b.race_class)));

  const coverageRows = [...coverage.values()].sort((a, b) => (a.season_number ?? 0) - (b.season_number ?? 0));

  return {
    events, byRider, perSeasonClass: perSeasonClassRows, racesWithEvents,
    skippedResults, unknownRaceIds, coverage: coverageRows,
  };
}

/** Hele afspilningen inkl. loads. READ-ONLY. */
export async function runReplay(supabase) {
  const [races, seasons] = await Promise.all([loadCompletedRaces(supabase), loadSeasons(supabase)]);
  const results = await loadRelevantResults(supabase);
  const replay = replayEvents({ races, results, seasons });
  const activeSeason = seasons.find((s) => s.status === "active")
    ?? seasons[seasons.length - 1]
    ?? null;
  return { ...replay, races, seasons, results, activeSeason };
}
