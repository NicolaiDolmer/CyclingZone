// [epic #4592 del 2] Parkering af inaktive menneske-hold ved sæsonskifte
// (forberedelse — INGEN flip, INGEN kørsel mod prod i denne PR).
//
// Ejer-design 2/9: ved cutoveren (S4, 28/9) parkeres hold hvis manager har
// været væk i 30+ dage (managerActivity.isDormantManager) OG som ikke selv
// har meldt sig tilbage via "Tilmeld dig næste sæson"-knappen (#452,
// teams.next_season_signup_at). Holdet er URØRT ud over parked_at +
// league_division_id — ingen ryttere/balance/andet nulstilles eller slettes,
// jf. epic-beslutningen "det giver D3 plads til nye spillere" (frigør kun
// puljepladsen, rører intet andet).
//
// selectTeamsToPark er en REN funktion (samme snit som dormantTeamsReport.js'
// enriched-mapping) — ingen DB, letter unit-test og genbrug i
// scripts/parkingDryRun.js (read-only) uden duplikeret udvælgelseslogik.
// parkTeam er den eneste write-funktion og markerer KUN parked_at +
// league_division_id=null — aldrig andet.

import { isDormantManager } from "./managerActivity.js";

/**
 * @param {{ id:string, is_ai?:boolean, is_bank?:boolean, is_test_account?:boolean,
 *           is_frozen?:boolean, user_id?:string|null, parked_at?:string|null,
 *           next_season_signup_at?:string|null, league_division_id?:any,
 *           division?:number|null, name?:string }} team
 */
function isHumanTeam(team) {
  return team?.is_ai === false && !team?.is_bank && !team?.is_test_account;
}

/**
 * Ren udvælgelse: hvilke hold ville blive parkeret ved cutover, givet
 * `teams` + `users` (kun `id`/`last_seen` behøves pr. bruger) og `now`.
 *
 * Kriterier (alle skal være opfyldt, ejer-definition #4592/#4307):
 *   - menneskehold (is_ai=false, is_bank=false, is_test_account=false)
 *   - ikke allerede parkeret (parked_at == null — idempotent, en sweep der
 *     kører to gange re-vælger ikke et allerede parkeret hold)
 *   - ikke frosset (is_frozen == true betyder allerede en admin-beslutning;
 *     parkering er en ANDEN mekanisme og må ikke overlappe/dobbelt-ramme)
 *   - ikke tilmeldt via knappen (next_season_signup_at == null — en manager
 *     der eksplicit har meldt sig tilbage skal ALDRIG parkeres, uanset
 *     hvor længe hun har været væk)
 *   - inaktiv manager: isDormantManager(user, now) — 30 dage uden login
 *     (manglende bruger/last_seen tæller som inaktiv, samme fallback som
 *     managerActivity.js)
 *
 * @param {{ teams: object[], users: object[], now: Date, days?: number }} args
 * @returns {object[]} delmængde af `teams`, uændret objekt-shape
 */
export function selectTeamsToPark({ teams, users, now, days = 30 }) {
  const userById = new Map((users || []).map((u) => [u.id, u]));
  return (teams || []).filter((team) => {
    if (!isHumanTeam(team)) return false;
    if (team.parked_at != null) return false;
    if (team.is_frozen === true) return false;
    if (team.next_season_signup_at != null) return false;
    const user = team.user_id ? userById.get(team.user_id) ?? null : null;
    return isDormantManager(user, now, { days });
  });
}

/**
 * Markerer ÉT hold parkeret. KUN parked_at + league_division_id — intet
 * andet røres. league_division_id=null frigiver puljepladsen (samme
 * "occupancy tæller kun hold med league_division_id=pool.id"-mekanik som
 * #4183 rettede i pickDivisionForNewTeam/reconcileAiTeamsForPool), så en AI-
 * fyld-sweep efter cutoveren ser pladsen som ledig igen.
 *
 * Idempotent via .is("parked_at", null)-betingelsen: et allerede parkeret
 * hold rammes ikke igen (ingen overskrivning af det oprindelige
 * parkeringstidspunkt).
 *
 * @param {{ supabase: object, teamId: string, now?: Date }} args
 * @returns {Promise<boolean>} true hvis rækken blev opdateret
 */
export async function parkTeam({ supabase, teamId, now = new Date() }) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const { data, error } = await supabase
    .from("teams")
    .update({ parked_at: now.toISOString(), league_division_id: null })
    .eq("id", teamId)
    .is("parked_at", null)
    .select("id");
  if (error && error.code !== "42703") throw new Error(`teams (parkTeam ${teamId}): ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Orkestrerer parkerings-sweepen for ÉT cutover-kald: vælger kandidater
 * (selectTeamsToPark) og parkerer dem (parkTeam), ét hold ad gangen så en
 * enkelt fejlet write ikke vælter resten. Kaldes fra processSeasonEnd KUN
 * når season_signup_enabled='on' (economyEngine.js) — denne funktion har
 * INGEN egen flag-kontrol, den antager kalderen allerede har tjekket.
 *
 * @param {{ supabase: object, teams: object[], users: object[], now?: Date,
 *           days?: number }} args
 * @returns {Promise<{ candidates: number, parked: number, skipped: number,
 *           parkedTeamIds: string[] }>}
 */
export async function parkDormantTeams({ supabase, teams, users, now = new Date(), days = 30 }) {
  const candidates = selectTeamsToPark({ teams, users, now, days });
  const parkedTeamIds = [];
  let skipped = 0;
  for (const team of candidates) {
    try {
      const ok = await parkTeam({ supabase, teamId: team.id, now });
      if (ok) parkedTeamIds.push(team.id);
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      console.error(`  ❌ managerParking: kunne ikke parkere hold ${team.id}:`, err?.message || err);
    }
  }
  return { candidates: candidates.length, parked: parkedTeamIds.length, skipped, parkedTeamIds };
}
