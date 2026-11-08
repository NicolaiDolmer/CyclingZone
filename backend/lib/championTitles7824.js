// #7824 · Mestertrøjer ved rytternavne: verdensmester, U23-verdensmester,
// kontinentmestre og nationale mestre.
//
// Låst af ejeren 6/11 (issue #7824):
//   · Verdensmester: flest point på verdensranglisten (rider_rankings_mv) sidste sæson.
//   · U23-verdensmester: flest point på sæsonens U23-rangliste (youth_rider_rankings_mv,
//     trup u23). Har ingen U23-rytter point dér, tæller verdensranglisten blandt
//     ryttere under 23 i stedet. Der er altid en U23-verdensmester.
//   · Kontinentmester: flest ranglistepoint blandt rytterne fra kontinentet
//     (countries.continent ud fra riders.nationality_code).
//   · National mester: flest ranglistepoint blandt rytterne fra nationen.
//   · Lighed: flest sejre, derefter bedste placering.
//   · Titlen gælder hele den efterfølgende sæson og skifter kun ved sæsonskifte.
//   · Titlerne regnes hver for sig: en rytter med en højere titel beholder også de
//     lavere, og titlen går ikke videre til nummer to.
//   · Alder efter sæsonår (ageForSeason) i den sæson, ranglisten gælder.
//
// Kun visning: motor, værdi, bestyrelse og økonomi læser ikke titlerne.
//
// Filen har to dele: den rene beregning (computeChampionTitles) og kørslen
// (runChampionTitlesTick), som finder den seneste afsluttede sæson, regner
// titlerne for sæsonen efter og skriver dem i rider_champion_titles
// (database/2026-11-07-7824-champion-titles.sql). Kørslen er idempotent: findes
// sæsonens titler allerede, sker intet. Den venter, til den nye sæson er startet,
// og til ranglisten er opdateret med alle resultater. Den kører hver time, så titlerne kommer
// kort efter et sæsonskifte, og første kørsel efter merge er engangsberegningen
// for den igangværende sæson.

import { ageForSeason } from "./riderSeasonAge.js";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { captureException } from "./sentry.js";
import { getRankingRefreshWorkState } from "./rankingRefreshWork.ts";

export const CHAMPION_JERSEYS_FLAG_KEY = "champion_jerseys_7824";

export const CHAMPION_TITLE = Object.freeze({
  WORLD: "world",
  U23_WORLD: "u23_world",
  CONTINENT: "continent",
  NATIONAL: "national",
});

/** Rækkefølgen fra højeste til laveste titel. Tabeller viser kun den første. */
export const CHAMPION_TITLE_ORDER = Object.freeze([
  CHAMPION_TITLE.WORLD,
  CHAMPION_TITLE.U23_WORLD,
  CHAMPION_TITLE.CONTINENT,
  CHAMPION_TITLE.NATIONAL,
]);

/** Hvilken rangliste U23-titlen blev afgjort på. */
export const U23_BASIS = Object.freeze({ U23_RANKING: "u23_ranking", WORLD_RANKING: "world_ranking" });

// "Under 23" efter sæsonår, samme grænse som U23-mærket (isU23ForSeason).
export const U23_MAX_AGE = 22;

const WIN_COLUMNS = ["stage_wins", "gc_wins", "classic_wins", "pts_wins", "mtn_wins", "young_wins"];

/** Sejre som i sæsonens hædersliste (rankingHonours.buildHonours). */
export function winsOf(row) {
  let wins = 0;
  for (const col of WIN_COLUMNS) wins += Number(row?.[col]) || 0;
  return wins;
}

function bestRankOf(map, riderId) {
  const rank = map?.get?.(riderId);
  return Number.isFinite(rank) && rank > 0 ? rank : Number.POSITIVE_INFINITY;
}

/**
 * Rækkefølgen inden for én titel: point, så sejre, så bedste placering, så id,
 * så resultatet aldrig afhænger af databasens svar.
 */
export function compareCandidates(a, b) {
  return b.points - a.points
    || b.wins - a.wins
    || a.bestRank - b.bestRank
    || String(a.rider_id).localeCompare(String(b.rider_id));
}

function toCandidate(row, bestRankMap) {
  return {
    rider_id: row.rider_id,
    points: Number(row.points) || 0,
    wins: winsOf(row),
    bestRank: bestRankOf(bestRankMap, row.rider_id),
  };
}

/**
 * Grupperne (én pr. titel og område) med kandidaterne sorteret. Ingen I/O.
 *
 * @param {object} input
 * @param {Array<object>} input.seniorRows  rider_rankings_mv-rækker for sæsonen
 * @param {Array<object>} [input.u23Rows]   youth_rider_rankings_mv-rækker (trup u23) for sæsonen
 * @param {Array<{ id: string, birthdate: string|null, nationality_code: string|null }>} input.riders
 * @param {Record<string, string>|Map<string, string>} input.continentByCountry  iso2 -> kontinent
 * @param {number} input.sourceSeasonNumber  sæsonen ranglisten gælder
 * @param {{ senior?: Map<string, number>, u23?: Map<string, number> }} [input.bestRank]
 */
export function championGroups({
  seniorRows = [],
  u23Rows = [],
  riders = [],
  continentByCountry = {},
  sourceSeasonNumber,
  bestRank = {},
}) {
  const riderById = new Map();
  for (const r of riders) if (r?.id) riderById.set(r.id, r);
  const continentOf = (code) => {
    if (!code) return null;
    const key = String(code).toUpperCase();
    return (continentByCountry instanceof Map ? continentByCountry.get(key) : continentByCountry[key]) || null;
  };
  const isU23 = (riderId) => {
    const age = ageForSeason(riderById.get(riderId)?.birthdate, sourceSeasonNumber);
    return age !== null && age <= U23_MAX_AGE;
  };

  const groups = [];
  const senior = seniorRows.filter((row) => row?.rider_id).map((row) => toCandidate(row, bestRank.senior));
  // Kun ryttere med point kan blive mestre på verdensranglisten.
  const scoring = senior.filter((c) => c.points > 0);

  groups.push({ title: CHAMPION_TITLE.WORLD, scope: "", basis: null, candidates: [...scoring].sort(compareCandidates) });

  // U23: sæsonens U23-rangliste først, ellers verdensranglisten blandt ryttere under 23.
  const u23Ranking = u23Rows
    .filter((row) => row?.rider_id && isU23(row.rider_id))
    .map((row) => toCandidate(row, bestRank.u23))
    .filter((c) => c.points > 0);
  if (u23Ranking.length > 0) {
    groups.push({ title: CHAMPION_TITLE.U23_WORLD, scope: "", basis: U23_BASIS.U23_RANKING, candidates: u23Ranking.sort(compareCandidates) });
  } else {
    const u23Senior = senior.filter((c) => isU23(c.rider_id));
    // "Der er altid en": har ingen under 23 point, afgør sejre og placering blandt dem på listen.
    const pool = u23Senior.some((c) => c.points > 0) ? u23Senior.filter((c) => c.points > 0) : u23Senior;
    groups.push({ title: CHAMPION_TITLE.U23_WORLD, scope: "", basis: U23_BASIS.WORLD_RANKING, candidates: pool.sort(compareCandidates) });
  }

  const byContinent = new Map();
  const byNation = new Map();
  for (const c of scoring) {
    const code = riderById.get(c.rider_id)?.nationality_code;
    if (!code) continue;
    const nation = String(code).toUpperCase();
    if (!byNation.has(nation)) byNation.set(nation, []);
    byNation.get(nation).push(c);
    const continent = continentOf(nation);
    if (!continent) continue;
    if (!byContinent.has(continent)) byContinent.set(continent, []);
    byContinent.get(continent).push(c);
  }
  for (const continent of [...byContinent.keys()].sort()) {
    groups.push({ title: CHAMPION_TITLE.CONTINENT, scope: continent, basis: null, candidates: byContinent.get(continent).sort(compareCandidates) });
  }
  for (const nation of [...byNation.keys()].sort()) {
    groups.push({ title: CHAMPION_TITLE.NATIONAL, scope: nation, basis: null, candidates: byNation.get(nation).sort(compareCandidates) });
  }
  return groups;
}

/**
 * Ryttere hvor point og sejre ikke afgør en titel, så bedste placering skal
 * hentes. Delt op efter hvilken liste placeringen skal findes i.
 *
 * @returns {{ senior: string[], u23: string[] }}
 */
export function tiedRiderIds(input) {
  const senior = new Set();
  const u23 = new Set();
  for (const group of championGroups({ ...input, bestRank: {} })) {
    const [leader, ...rest] = group.candidates;
    if (!leader) continue;
    const tied = rest.filter((c) => c.points === leader.points && c.wins === leader.wins);
    if (tied.length === 0) continue;
    const target = group.basis === U23_BASIS.U23_RANKING ? u23 : senior;
    for (const c of [leader, ...tied]) target.add(c.rider_id);
  }
  return { senior: [...senior].sort(), u23: [...u23].sort() };
}

/**
 * Den rene beregning. Ingen I/O.
 *
 * @returns {Array<{ title: string, scope: string, rider_id: string, points: number, basis: string|null }>}
 *   Én række pr. titel og område.
 */
export function computeChampionTitles(input) {
  const titles = [];
  for (const group of championGroups(input)) {
    const leader = group.candidates[0];
    if (!leader) continue;
    titles.push({ title: group.title, scope: group.scope, rider_id: leader.rider_id, points: leader.points, basis: group.basis });
  }
  return titles;
}

/** En rytters titler fra højeste til laveste (profilen viser dem alle, tabeller den første). */
export function titlesForRider(titles, riderId) {
  return titles
    .filter((t) => t.rider_id === riderId)
    .sort((a, b) => CHAMPION_TITLE_ORDER.indexOf(a.title) - CHAMPION_TITLE_ORDER.indexOf(b.title));
}

// ── Kørslen ───────────────────────────────────────────────────────────────────

const RANKING_COLUMNS = `rider_id,points,${WIN_COLUMNS.join(",")}`;

async function loadLatestCompletedSeason(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("id, number").eq("status", "completed").gt("number", 0)
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`seasons: ${error.message}`);
  return data && Number.isFinite(data.number) ? data : null;
}

async function loadActiveSeasonNumber(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (error) throw new Error(`seasons (active): ${error.message}`);
  return data && Number.isFinite(data.number) ? data.number : null;
}

async function titlesExist(supabase, seasonNumber) {
  // schema-columns-ok: rider_champion_titles kommer fra 2026-11-07-7824-champion-titles.sql
  const { data, error } = await supabase
    .from("rider_champion_titles").select("title").eq("season_number", seasonNumber).limit(1);
  if (error) throw new Error(`rider_champion_titles: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

async function loadBestRanks(supabase, riderIds, seasonId, squad) {
  const best = new Map();
  if (riderIds.length === 0) return best;
  const rows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("race_results")
    .select("rider_id, rank, races!inner(season_id, squad)")
    .in("rider_id", chunk)
    .in("result_type", ["stage", "gc"])
    .eq("races.season_id", seasonId)
    .eq("races.squad", squad)
    .order("id"));
  for (const row of rows) {
    const rank = Number(row.rank);
    if (!Number.isFinite(rank) || rank <= 0) continue;
    const prev = best.get(row.rider_id);
    if (prev === undefined || rank < prev) best.set(row.rider_id, rank);
  }
  return best;
}

/**
 * Regn og skriv titlerne for sæsonen efter den seneste afsluttede sæson.
 * Kører kun når kontakten ikke er off, og kun hvis sæsonens titler mangler.
 *
 * @returns {Promise<{ ran: boolean, skipped?: string, seasonNumber?: number, titles?: number }>}
 */
export async function runChampionTitles({ supabase }) {
  const stage = await readFlagStage(supabase, CHAMPION_JERSEYS_FLAG_KEY);
  if (!evaluateFlagStage(stage, { engineWrite: true })) return { ran: false, skipped: "flag_off" };

  const source = await loadLatestCompletedSeason(supabase);
  if (!source) return { ran: false, skipped: "no_completed_season" };
  const seasonNumber = source.number + 1;
  // Sæsonafslutning og sæsonstart er to adskilte trin. Titlerne skrives først, når
  // sæsonen de bæres i faktisk er startet, så en ny trøje aldrig vises for tidligt.
  if (await loadActiveSeasonNumber(supabase) !== seasonNumber) return { ran: false, skipped: "next_season_not_started", seasonNumber };
  if (await titlesExist(supabase, seasonNumber)) return { ran: false, skipped: "already_computed" };
  // Titlerne skrives én gang og regnes aldrig om, så ranglisten skal være opdateret
  // med alle resultater først. Venter en opdatering, prøver næste time igen.
  const refresh = await getRankingRefreshWorkState(supabase, new Date());
  if (refresh.pending) return { ran: false, skipped: "ranking_refresh_pending", seasonNumber };

  const [seniorRows, u23Rows, countries] = await Promise.all([
    fetchAllRows(() => supabase.from("rider_rankings_mv").select(RANKING_COLUMNS)
      .eq("season_id", source.id).order("rider_id")),
    fetchAllRows(() => supabase.from("youth_rider_rankings_mv").select(RANKING_COLUMNS)
      .eq("season_id", source.id).eq("squad", "u23").order("rider_id")),
    fetchAllRows(() => supabase.from("countries").select("iso2, continent").order("iso2")),
  ]);
  const riderIds = [...new Set([...seniorRows, ...u23Rows].map((r) => r.rider_id).filter(Boolean))].sort();
  const riders = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("riders").select("id, birthdate, nationality_code").in("id", chunk).order("id"));
  const continentByCountry = new Map(countries.filter((c) => c.iso2 && c.continent).map((c) => [String(c.iso2).toUpperCase(), c.continent]));

  const input = { seniorRows, u23Rows, riders, continentByCountry, sourceSeasonNumber: source.number };
  const tied = tiedRiderIds(input);
  const bestRank = {
    senior: await loadBestRanks(supabase, tied.senior, source.id, "senior"),
    u23: await loadBestRanks(supabase, tied.u23, source.id, "u23"),
  };
  const titles = computeChampionTitles({ ...input, bestRank });
  if (titles.length === 0) return { ran: false, skipped: "no_titles", seasonNumber };

  const rows = titles.map((t) => ({ ...t, season_number: seasonNumber, source_season_id: source.id }));
  // Én skrivning: sæsonens titler står enten alle eller slet ikke.
  // schema-columns-ok: rider_champion_titles kommer fra 2026-11-07-7824-champion-titles.sql
  const { error } = await supabase.from("rider_champion_titles")
    .upsert(rows, { onConflict: "season_number,title,scope" });
  if (error) throw new Error(`rider_champion_titles upsert: ${error.message}`);
  return { ran: true, seasonNumber, titles: rows.length };
}

/** Cron-indgangen: kørsel + log. En fejl når Sentry; næste time prøver igen. */
export async function runChampionTitlesTick({ supabase }) {
  try {
    const result = await runChampionTitles({ supabase });
    if (result.ran) console.log(`Champion titles: ${result.titles} titles for season ${result.seasonNumber}`);
    return result;
  } catch (err) {
    console.error("  champion titles failed:", err.message);
    captureException(err, { tags: { cron: "champion-titles" } });
    return { ran: false, skipped: "error" };
  }
}
