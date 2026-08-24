// backend/lib/emptyPoolPolicy.js
// P0 2/7 + #3038: fælles "pulje uden hold"-diskriminator.
//
// En pulje uden ét eneste hold (fx D4-puljer mellem kalender-materialisering og
// første manager/AI-fyld, eller S2's C-H-puljer efter #2851-reconcilen) har løb
// i kalenderen som aldrig kan afvikles. De skal IKKE give "No start list"-fejl
// hvert tick, og de må IKKE tælle som spærre for season-end/transition — men
// løbene BEVARES i kalenderen (en pulje kan aktiveres af nye signups).
//
// Definitionen boede før i tre kopier (stageScheduler.js, assessSeasonEndBlockers
// og — manglede helt — all_races_completed i assessTransitionReadiness, hvor et
// tomt-pulje-løb blokerede transitionen selvom season-end korrekt så bort fra
// det). Én kilde nu, så de tre gates ikke kan drive fra hinanden igen.
//
// Fail-open: returnerer teams-tabellen 0 rækker TOTALT (tom test-DB/mock)
// deaktiveres filteret i stedet for at undtage alle løb.
//
// Refs #3038 #2851 #4173-sessionen 24/8.

import { fetchAllRows } from "./supabasePagination.js";

/**
 * @param {{ supabase: object }} args
 * @returns {Promise<{ inEmptyPool: (race: {league_division_id?: string|null}) => boolean, poolFilterActive: boolean, teamsPerPool: Map<string, number> }>}
 */
export async function loadEmptyPoolFilter({ supabase }) {
  // Pagineringssikker (#2974-mønstret): teams nærmer sig PostgREST's 1000-cap,
  // og en trunkeret læsning ville stille en pulje "tom" og skippe ægte løb.
  let teamPools;
  try {
    teamPools = await fetchAllRows(() => supabase
      .from("teams")
      .select("id, league_division_id")
      .order("id", { ascending: true }));
  } catch (e) {
    throw new Error(`teams (empty-pool-filter): ${e.message || e}`);
  }

  const teamsPerPool = new Map();
  for (const t of teamPools || []) {
    if (t.league_division_id == null) continue;
    teamsPerPool.set(t.league_division_id, (teamsPerPool.get(t.league_division_id) || 0) + 1);
  }
  const poolFilterActive = (teamPools || []).length > 0;
  const inEmptyPool = (race) => (
    poolFilterActive
    && race.league_division_id != null
    && !(teamsPerPool.get(race.league_division_id) > 0)
  );
  return { inEmptyPool, poolFilterActive, teamsPerPool };
}
