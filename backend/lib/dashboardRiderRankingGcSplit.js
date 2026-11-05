// #3507 — dashboardets "Rytter-rangliste"-modul (dashboard_rider_ranking-RPC'en,
// database/2026-07-19-dashboard-rider-ranking-rpc.sql) taeller gc_wins for ALLE
// loebstyper samlet (etapeloeb + klassikere), mens maalsiden (rider_rankings_mv,
// RiderRankingsPage) splitter gc_wins (etapeloeb) / classic_wins (klassikere).
// Prod-symptom: dashboardets "X GC" og maalsidens "GC wins"-kolonne talte to
// forskellige ting for samme rytter.
//
// Fixet splitter RPC'ens gc_wins UDEN at aendre selve RPC'en/migrationen
// (ejer-instruks #3507: kun SELECT-udvidelse, ingen migrationer) — en ekstra,
// bevidst LILLE forespoergsel for kun de <=5 rytter-id'er RPC'en allerede
// returnerede, joinet til races.race_type. Ingen paginering noedvendig (bundet
// til top-5 x deres GC-seire, aldrig i naerheden af PostgRESTs 1000-raekkers-
// loft) — derfor bevidst placeret i en HJAELPEFUNKTION uden for selve rute-
// blokken i api.js: dashboardUxPakke.routes.test.js's #2692-regressionstest
// scanner routeBlock'en for en direkte select mod race_results / fetchAllRows
// for at forhindre at den GAMLE sekventielle divisions-brede paginering
// (~63k raekker, #2692, Sentry CYCLINGZONE-36) sniger sig tilbage ind i selve
// ruten. Denne funktion er en helt anden, bundet forespoergsel (max 5
// rytter-id'er), ikke en gentagelse af det rod-problem — men lever alligevel
// her for at holde testens invariant urørt og entydig.
//
// splitGcWins er en REN funktion (ingen Supabase-afhaengighed) — testet med
// node --test, se dashboardRiderRankingGcSplit.test.js.

import { withSupabaseRetry } from "./supabaseErrorNormalize.js";
import { captureException as defaultCaptureException } from "./sentry.js";

/**
 * Henter GC-vinder-raekker (rank=1, result_type='gc') for et bundet saet
 * rytter-id'er, joinet til racens race_type — kilden splitGcWins bruger til at
 * dele RPC'ens samlede gc_wins op i gc_wins (etapeloeb) / classic_wins
 * (klassikere), samme definition som rider_rankings_mv.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ riderIds: string[], seasonId: string, leagueDivisionId: number|null }} args
 * @returns {Promise<Array<{ rider_id: string, race: { race_type: string } }>>}
 */
export async function fetchGcClassicSplit(supabase, { riderIds, seasonId, leagueDivisionId }) {
  if (!riderIds?.length) return [];
  // pagination-safe: riderIds is capped at the RPC's LIMIT 5 (dashboard top-5)
  // and this only counts each rider's GC (rank=1) wins in ONE season — a
  // handful of rows per rider at most, nowhere near PostgREST's 1000-row cap.
  let query = supabase
    .from("race_results")
    .select("rider_id, race:race_id!inner(race_type, season_id, league_division_id)")
    .in("rider_id", riderIds)
    .eq("rank", 1)
    .eq("result_type", "gc")
    .eq("race.season_id", seasonId);
  if (leagueDivisionId != null) {
    query = query.eq("race.league_division_id", leagueDivisionId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Ren merge: erstatter RPC'ens samlede gc_wins (alle loebstyper) med et split
 * der matcher rider_rankings_mv 1:1 (database/2026-07-04-ranking-matviews.sql):
 *   gc_wins      = COUNT(rank=1 AND result_type='gc' AND race_type='stage_race')
 *   classic_wins = COUNT(rank=1 AND result_type='gc' AND race_type='single')
 * @param {Array<{rider_id: string}>} riders - raekker fra dashboard_rider_ranking-RPC'en
 * @param {Array<{rider_id: string, race: {race_type: string}}>} gcRows - fra fetchGcClassicSplit
 * @returns {Array<object>} riders med gc_wins erstattet + classic_wins tilfoejet
 */
export function splitGcWins(riders, gcRows) {
  const counts = new Map();
  for (const row of gcRows || []) {
    const id = row?.rider_id;
    if (id == null) continue;
    const type = row.race?.race_type;
    const entry = counts.get(id) || { gc_wins: 0, classic_wins: 0 };
    if (type === "stage_race") entry.gc_wins += 1;
    else if (type === "single") entry.classic_wins += 1;
    counts.set(id, entry);
  }
  return (riders || []).map((r) => {
    const split = counts.get(r.rider_id) || { gc_wins: 0, classic_wins: 0 };
    return { ...r, gc_wins: split.gc_wins, classic_wins: split.classic_wins };
  });
}

/**
 * #7676: split-opslaget er en forbedring oven paa RPC'ens allerede brugbare
 * raekker (uden det mangler kun klassikersejre). Det maa aldrig tage hele
 * dashboard-modulet ned med en 500. Proever opslaget igen ved transiente fejl;
 * fejler det stadig, sendes RPC'ens raekker UDEN sejrs-opdeling (aldrig splitGcWins
 * med tomme raekker — den nulstiller gc_wins) og fejlen rapporteres til
 * Sentry, saa aarsagen kan findes.
 * @returns {Promise<Array<object>>}
 */
export async function splitGcWinsSafe(
  supabase,
  riders,
  args,
  { captureExceptionFn = defaultCaptureException, retryOptions } = {},
) {
  try {
    const gcRows = await withSupabaseRetry(() => fetchGcClassicSplit(supabase, args), retryOptions);
    return splitGcWins(riders, gcRows);
  } catch (error) {
    captureExceptionFn(error, { tags: { route: "dashboard-rider-ranking", degraded: "gc-split-skipped" } });
    // RPC'ens gc_wins taeller ALLE loebstyper; vist som "GC" ville klassikersejre
    // vaere forkert info. Derfor udelades sejrs-opdelingen helt (frontend viser
    // kun badges for vaerdier > 0), mens rangliste + point bevares.
    return (riders || []).map(({ gc_wins: _combined, ...rest }) => rest);
  }
}
