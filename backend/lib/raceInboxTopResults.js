// #7085 · Bedste placeringer i indbakke-beskeden efter et løb.
//
// "Race result is in / X has been run. View the result." fortalte ikke
// spilleren hvordan det gik (#6519: spillerne hoppede ud og ind for at se
// udfaldet). Dette modul udleder managerens bedste ryttere (op til 3, bedste
// placering først) fra løbets samlede resultat (result_type='gc' — også
// endagsløb pusher en 'gc'-række pr. rytter, jf. raceNarrativeNotification.js).
//
// Format: "Rider Name (#2), Other Rider (#5)". "#n" er bevidst sprog-neutralt,
// så SAMME streng kan indgå som parameter i både EN- og DA-beskeden
// (backendMessages: notif.raceResult.messageBest) uden en ordinal-regel pr.
// sprog.

import { captureException } from "./sentry.js";

export const TOP_RESULTS_LIMIT = 3;

/**
 * Reducér race_results-rækker til de bedste ryttere pr. menneske-manager.
 * Samme manager-diskriminator som resten af notifikationsmotoren
 * (is_ai=false, is_frozen=false).
 *
 * @param {Array<{rider_name?:string, rank?:number|null, team?:{user_id?:string, is_ai?:boolean, is_frozen?:boolean}}>} rows
 * @param {number} [limit]
 * @returns {Map<string, Array<{riderName:string, rank:number}>>}
 */
export function summarizeTopResultsByUser(rows, limit = TOP_RESULTS_LIMIT) {
  const byUser = new Map();
  for (const row of rows || []) {
    const userId = row?.team?.user_id;
    if (!userId || row.team?.is_ai || row.team?.is_frozen) continue;
    const rank = Number(row.rank);
    if (row.rank == null || !Number.isFinite(rank) || !row.rider_name) continue;
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId).push({ riderName: String(row.rider_name), rank });
  }
  for (const [userId, list] of byUser) {
    list.sort((a, b) => a.rank - b.rank);
    byUser.set(userId, list.slice(0, limit));
  }
  return byUser;
}

/**
 * "Name (#2), Name (#5)" — null hvis der ikke er noget at vise.
 * @param {Array<{riderName:string, rank:number}>|undefined} top
 */
export function formatTopResults(top) {
  if (!top?.length) return null;
  return top.map((r) => `${r.riderName} (#${r.rank})`).join(", ");
}

/**
 * Hent løbets samlede resultat og reducér til bedste ryttere pr. manager.
 * Best-effort: returnerer tomt Map ved enhver fejl, så kalderen degraderer til
 * den gamle besked i stedet for at tabe notifikationen.
 *
 * @returns {Promise<Map<string, Array<{riderName:string, rank:number}>>>}
 */
export async function fetchRaceTopResults({ supabase, race }) {
  if (!supabase?.from || !race?.id) return new Map();
  try {
    // pagination-safe: ét race_id + result_type='gc' = én række pr. deltagende
    // rytter (samme afgrænsning som raceNarrativeNotification.js).
    const { data, error } = await supabase
      .from("race_results")
      .select("rider_name, rank, team:team_id!inner(user_id, is_ai, is_frozen)")
      .eq("race_id", race.id)
      .eq("result_type", "gc");
    if (error) throw error;
    return summarizeTopResultsByUser(data);
  } catch (err) {
    console.error(`  ⚠️  top-resultater-opslag fejlede (race ${race?.id}) — falder tilbage til standard-copy:`, /** @type {any} */ (err)?.message || err);
    captureException(err, { tags: { flow: "notifications", stage: "race-result-top" }, raceId: race?.id });
    return new Map();
  }
}
