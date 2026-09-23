// [epic #4592 del 2] Parkering af inaktive menneske-hold ved sæsonskifte
// (bag season_signup_enabled — flaget flippes IKKE her, og intet køres mod prod).
//
// Ejer-design 2/9: ved cutoveren parkeres hold hvis manager har været væk i
// 30+ dage (managerActivity.isDormantManager) OG som ikke selv har meldt sig
// tilbage via "Tilmeld dig næste sæson"-knappen (#452,
// teams.next_season_signup_at). Holdet er URØRT ud over parked_at +
// league_division_id — ingen ryttere/balance/andet nulstilles eller slettes,
// jf. epic-beslutningen "det giver D3 plads til nye spillere" (frigør kun
// puljepladsen, rører intet andet).
//
// Sweepen ved sæsonskiftet (runParkingSweep) har tre trin, i denne rækkefølge:
//   1. parkér inaktive hold (parkDormantTeams) — aldrig et hold med et aktivt
//      abonnement (#4592-audit 3/9: en betalende kunde må ikke parkeres)
//   2. genindplacér parkerede hold hvis manager har tilmeldt sig igen
//      (unparkSignedUpTeams) — samme placeringsregel som et nyt hold
//      (teamProfileEngine.pickDivisionForNewTeam), ingen kopi
//   3. nulstil next_season_signup_at (resetSeasonSignups): tilmeldingen gælder
//      ÉN sæson, og sweepen har nu brugt den
//
// ØKONOMI MENS PARKERET (ejer-valg (b) = A med løn, 23/9, #4592): et parkeret
// hold står økonomisk stille. isParkedTeam nedenfor er den ene definition, og
// economyEngine bruger den to steder:
//   - processSeasonStart: ingen sponsor (heller ikke faldskærm eller
//     divisions-tillæg, som begge er sponsor-indtægt) og ingen nye
//     bestyrelsesplaner/mål.
//   - processTeamSeasonEnd: ingen bestyrelsesdom, ingen konsekvenser, intet
//     mandat/årsmøde.
// Payroll (løn, renter, drift) filtrerer BEVIDST ikke på parkering: lønnen
// betales så længe rytterne er på kontrakt. Genindplaceres holdet
// (unparkSignedUpTeams), kører økonomien normalt igen fra næste sæsonstart.
//
// Udvælgelsen er REN (selectTeamsToPark/selectTeamsToUnpark/
// selectActiveSubscriptionTeamIds) — ingen DB, letter unit-test og genbrug i
// scripts/parkingDryRun.js (read-only) uden duplikeret udvælgelseslogik.

import { isDormantManager } from "./managerActivity.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { captureException } from "./sentry.js";
import { computeIsPro } from "./entitlement.js";
import { pickDivisionForNewTeam } from "./teamProfileEngine.js";
import { reconcileAiTeamsForPool } from "./aiTeamGenerator.js";

// Holdfelterne sweepen, CLI'en og dry-run'et læser. Samlet ét sted, så de tre
// indgange altid ser det samme grundlag.
// schema-columns-ok: parked_at/next_season_signup_at tilføjes af
// database/2026-09-03-4592-team-parked-at.sql og 2026-09-03-4592-next-
// season-signup.sql (applied post-merge under #2642).
export const PARKING_TEAM_COLUMNS =
  "id, name, division, league_division_id, user_id, is_ai, is_bank, is_test_account, is_frozen, parked_at, next_season_signup_at";

// Abonnementsfelterne isSubscriptionProtectingTeam læser (samme som
// entitlement.computeIsPro).
export const PARKING_SUBSCRIPTION_COLUMNS = "id, team_id, status, current_period_end, last_event_at";

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
 * Er holdet parkeret? Den ene definition, som både sweepen og økonomien
 * (economyEngine.processSeasonStart/processTeamSeasonEnd) bruger. Et felt der
 * mangler (fx en select uden parked_at), tæller som ikke parkeret, så en
 * glemt kolonne aldrig stopper sponsor eller bestyrelse for et aktivt hold.
 *
 * @param {{ parked_at?: string|null }|null|undefined} team
 * @returns {boolean}
 */
export function isParkedTeam(team) {
  return team?.parked_at != null;
}

function toIdSet(ids) {
  if (ids instanceof Set) return ids;
  return new Set(ids || []);
}

/**
 * Beskytter abonnementet holdet mod parkering? Ja når status er 'active', og
 * også når det stadig giver Pro-adgang efter entitlement-reglen (opsagt men
 * betalt til periodens slut, eller i rykker-respit) — en kunde der har betalt
 * for perioden, må ikke miste sin plads i den.
 *
 * @param {{ team_id?:string, status?:string, current_period_end?:string|null,
 *           last_event_at?:string|null }} subscription
 * @param {Date} now
 */
export function isSubscriptionProtectingTeam(subscription, now = new Date()) {
  if (!subscription?.team_id) return false;
  if (subscription.status === "active") return true;
  return computeIsPro(subscription, now.getTime());
}

/**
 * Ren: hvilke hold har et abonnement der beskytter mod parkering?
 *
 * @param {object[]} subscriptions  rækker fra `subscriptions`
 * @param {Date} now
 * @returns {Set<string>} team_id'er
 */
export function selectActiveSubscriptionTeamIds(subscriptions, now = new Date()) {
  return new Set(
    (subscriptions || [])
      .filter((sub) => isSubscriptionProtectingTeam(sub, now))
      .map((sub) => sub.team_id),
  );
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
 *   - intet beskyttende abonnement (activeSubscriptionTeamIds — se
 *     selectActiveSubscriptionTeamIds)
 *   - inaktiv manager: isDormantManager(user, now) — 30 dage uden login
 *     (manglende bruger/last_seen tæller som inaktiv, samme fallback som
 *     managerActivity.js)
 *
 * @param {{ teams: object[], users: object[], now: Date, days?: number,
 *           activeSubscriptionTeamIds?: Set<string>|string[] }} args
 * @returns {object[]} delmængde af `teams`, uændret objekt-shape
 */
export function selectTeamsToPark({ teams, users, now, days = 30, activeSubscriptionTeamIds }) {
  const userById = new Map((users || []).map((u) => [u.id, u]));
  const subscribed = toIdSet(activeSubscriptionTeamIds);
  return (teams || []).filter((team) => {
    if (!isHumanTeam(team)) return false;
    if (isParkedTeam(team)) return false;
    if (team.is_frozen === true) return false;
    if (team.next_season_signup_at != null) return false;
    if (subscribed.has(team.id)) return false;
    const user = team.user_id ? userById.get(team.user_id) ?? null : null;
    return isDormantManager(user, now, { days });
  });
}

/**
 * Ren udvælgelse: hvilke parkerede hold skal genindplaceres, fordi manageren
 * har tilmeldt sig næste sæson igen (parked_at != null OG
 * next_season_signup_at != null).
 *
 * @param {{ teams: object[] }} args
 * @returns {object[]} delmængde af `teams`, uændret objekt-shape
 */
export function selectTeamsToUnpark({ teams }) {
  return (teams || []).filter((team) => (
    isHumanTeam(team)
    && isParkedTeam(team)
    && team.next_season_signup_at != null
  ));
}

/**
 * Henter sweepens grundlag: menneskehold, deres brugeres last_seen og alle
 * abonnementer. Samme paginerede mønster + menneskehold-diskriminator som
 * dormantTeamsReport.js. Bruges af runParkingSweep, CLI'en og dry-run'et.
 *
 * @param {{ supabase: object }} args
 * @returns {Promise<{ teams: object[], users: object[], subscriptions: object[] }>}
 */
export async function loadParkingInputs({ supabase }) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const teams = await fetchAllRows(() => (
    supabase
      .from("teams")
      .select(PARKING_TEAM_COLUMNS)
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_test_account", false)
      .order("id")
  ));
  const users = await fetchAllRowsChunkedIn(
    [...new Set((teams || []).map((t) => t.user_id).filter(Boolean))],
    (chunk) => supabase.from("users").select("id, last_seen").in("id", chunk).order("id"),
  );
  // Fejler abonnements-opslaget, kaster vi: uden det kan vi ikke vide hvem der
  // betaler, og så parkerer vi hellere ingen end en betalende kunde.
  const subscriptions = await fetchAllRows(() => (
    supabase.from("subscriptions").select(PARKING_SUBSCRIPTION_COLUMNS).order("id")
  ));
  return { teams, users, subscriptions };
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
 * Parkerer alle kandidater (selectTeamsToPark), ét hold ad gangen så en enkelt
 * fejlet write ikke vælter resten. Ingen egen flag-kontrol — kalderen
 * (runParkingSweep ← processSeasonEnd) har allerede tjekket
 * season_signup_enabled.
 *
 * `teams`/`users`/`subscriptions` er OPTIONALE — udelades de, henter
 * funktionen dem selv (loadParkingInputs).
 *
 * @param {{ supabase: object, teams?: object[], users?: object[],
 *           subscriptions?: object[], now?: Date, days?: number }} args
 * @returns {Promise<{ candidates: number, parked: number, skipped: number,
 *           parkedTeamIds: string[], subscriptionProtectedTeamIds: string[] }>}
 */
export async function parkDormantTeams({ supabase, teams, users, subscriptions, now = new Date(), days = 30 }) {
  const loaded = (teams && users && subscriptions) ? null : await loadParkingInputs({ supabase });
  const resolvedTeams = teams ?? loaded.teams;
  const resolvedUsers = users ?? loaded.users;
  const resolvedSubscriptions = subscriptions ?? loaded.subscriptions;
  const activeSubscriptionTeamIds = selectActiveSubscriptionTeamIds(resolvedSubscriptions, now);
  const candidates = selectTeamsToPark({ teams: resolvedTeams, users: resolvedUsers, now, days, activeSubscriptionTeamIds });

  // Observerbarhed: hvem ville være parkeret, hvis ikke abonnementet stod i
  // vejen? Samme rene funktion uden abonnementsfiltret — ingen kopi af reglen.
  const candidateIds = new Set(candidates.map((t) => t.id));
  const subscriptionProtectedTeamIds = selectTeamsToPark({ teams: resolvedTeams, users: resolvedUsers, now, days })
    .map((t) => t.id)
    .filter((id) => !candidateIds.has(id));

  const parkedTeamIds = [];
  let skipped = 0;
  for (const team of candidates) {
    try {
      const ok = await parkTeam({ supabase, teamId: team.id, now });
      if (ok) parkedTeamIds.push(team.id);
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      // Ét holds fejlede parkering må ikke stoppe resten af sweepen (samme
      // fail-isolerende mønster som notifikations-loopene i economyEngine.js)
      // — men skal stadig være OBSERVERBAR, ellers opdager ingen at et hold
      // aldrig blev parkeret. console.error alene drukner i Railway-logs.
      console.error(`  ❌ managerParking: kunne ikke parkere hold ${team.id}:`, err?.message || err);
      captureException(err, { tags: { flow: "manager_parking", stage: "park_team" }, extra: { teamId: team.id } });
    }
  }
  return { candidates: candidates.length, parked: parkedTeamIds.length, skipped, parkedTeamIds, subscriptionProtectedTeamIds };
}

/**
 * Genindplacerer ÉT parkeret hold: parked_at=null + division/league_division_id
 * efter PRÆCIS samme regel som et nyt hold (pickDivisionForNewTeam: entry-
 * divisionen hvis der er plads efter occupancy, ellers overflow-divisionen).
 *
 * Bagefter reconciles AI-fyldet i den pulje holdet landede i — samme opfølgning
 * som signup-flowet (#1739), så puljen ikke vokser over målstørrelsen. Den er
 * ikke-fatal: holdet ER genindplaceret, og en senere reconcile retter en
 * sprunget kørsel (reconcileAiTeamsForPool er idempotent).
 *
 * Idempotent via .not("parked_at", "is", null): et hold der allerede er
 * genindplaceret, flyttes ikke igen.
 *
 * @param {{ supabase: object, teamId: string, pickDivision?: Function,
 *           reconcileAiTeams?: Function }} args
 * @returns {Promise<{ unparked: boolean, division: number, leagueDivisionId: any }>}
 */
export async function unparkTeam({
  supabase,
  teamId,
  pickDivision = pickDivisionForNewTeam,
  reconcileAiTeams = reconcileAiTeamsForPool,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const { division, leagueDivisionId } = await pickDivision(supabase);
  const { data, error } = await supabase
    .from("teams")
    .update({ parked_at: null, division, league_division_id: leagueDivisionId })
    .eq("id", teamId)
    .not("parked_at", "is", null)
    .select("id");
  if (error) throw new Error(`teams (unparkTeam ${teamId}): ${error.message}`);
  const unparked = Array.isArray(data) && data.length > 0;

  if (unparked && leagueDivisionId != null) {
    try {
      await reconcileAiTeams({ supabase, poolId: leagueDivisionId });
    } catch (err) {
      console.error(`  ⚠️  managerParking: AI-reconcile efter genindplacering af ${teamId} i pulje ${leagueDivisionId} fejlede (ikke-fatal):`, err?.message || err);
      captureException(err, { tags: { flow: "manager_parking", stage: "unpark_reconcile" }, extra: { teamId, poolId: leagueDivisionId } });
    }
  }
  return { unparked, division, leagueDivisionId };
}

/**
 * Genindplacerer alle parkerede hold hvis manager har tilmeldt sig igen
 * (selectTeamsToUnpark), ét ad gangen: pickDivisionForNewTeam læser occupancy
 * forfra hver gang, så to genindplaceringer i træk ikke lander på samme sidste
 * plads.
 *
 * @param {{ supabase: object, teams: object[], pickDivision?: Function,
 *           reconcileAiTeams?: Function }} args
 * @returns {Promise<{ candidates: number, unparked: number, skipped: number,
 *           failedTeamIds: string[], placements: Array<{ teamId: string,
 *           division: number, leagueDivisionId: any }> }>}
 */
export async function unparkSignedUpTeams({ supabase, teams, pickDivision, reconcileAiTeams }) {
  const candidates = selectTeamsToUnpark({ teams });
  const placements = [];
  const failedTeamIds = [];
  let skipped = 0;
  for (const team of candidates) {
    try {
      const result = await unparkTeam({ supabase, teamId: team.id, pickDivision, reconcileAiTeams });
      if (result.unparked) {
        placements.push({ teamId: team.id, division: result.division, leagueDivisionId: result.leagueDivisionId });
      } else {
        skipped += 1;
      }
    } catch (err) {
      skipped += 1;
      failedTeamIds.push(team.id);
      console.error(`  ❌ managerParking: kunne ikke genindplacere hold ${team.id}:`, err?.message || err);
      captureException(err, { tags: { flow: "manager_parking", stage: "unpark_team" }, extra: { teamId: team.id } });
    }
  }
  return { candidates: candidates.length, unparked: placements.length, skipped, failedTeamIds, placements };
}

/**
 * Nulstiller next_season_signup_at for alle hold, når sweepen har brugt feltet:
 * en tilmelding gælder ÉN sæsons skifte. Hold hvis genindplacering fejlede
 * (keepTeamIds) beholder tilmeldingen, så en genkørsel stadig kan hente dem ind.
 *
 * @param {{ supabase: object, keepTeamIds?: string[] }} args
 * @returns {Promise<number>} antal nulstillede hold
 */
export async function resetSeasonSignups({ supabase, keepTeamIds = [] }) {
  if (!supabase?.from) throw new Error("Supabase client required");
  let query = supabase
    .from("teams")
    .update({ next_season_signup_at: null })
    .not("next_season_signup_at", "is", null);
  if (keepTeamIds.length > 0) {
    query = query.not("id", "in", `(${keepTeamIds.join(",")})`);
  }
  const { data, error } = await query.select("id");
  if (error) throw new Error(`teams (resetSeasonSignups): ${error.message}`);
  return Array.isArray(data) ? data.length : 0;
}

// Idempotens pr. sæson: app_config-nøglen husker hvilken sæson sweepen sidst
// har kørt for. Uden den ville en genkørsel af processSeasonEnd (eller CLI'en)
// efter nulstillingen se en tilmeldt, inaktiv manager som utilmeldt og parkere
// holdet (CodeRabbit-fund på #4592).
export const PARKING_SWEEP_MARKER_KEY = "manager_parking_sweep_season_id";

async function readSweepMarker(supabase) {
  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", PARKING_SWEEP_MARKER_KEY)
    .maybeSingle();
  if (error) throw new Error(`app_config (${PARKING_SWEEP_MARKER_KEY}): ${error.message}`);
  return data?.value ?? null;
}

/**
 * Har sweepen allerede kørt for sæsonen? Kun sweepen skriver parked_at, så før
 * den har kørt, viser teams.parked_at præcis hvem der var parkeret i sæsonen.
 * Bagefter gør den ikke (genindplacerede hold har mistet deres parked_at,
 * nyparkerede har fået et). Bruges af repair-stien i economyEngine, som ellers
 * ville dømme sæsonen på den forkerte parkerings-tilstand. Kaster ved en
 * læsefejl: uden markøren ved vi det ikke.
 *
 * @param {{ supabase: object, seasonId: string }} args
 * @returns {Promise<boolean>}
 */
export async function hasParkingSweepRunForSeason({ supabase, seasonId }) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (seasonId == null) throw new Error("hasParkingSweepRunForSeason: seasonId required");
  return await readSweepMarker(supabase) === String(seasonId);
}

async function writeSweepMarker(supabase, seasonId, now) {
  const { error } = await supabase.from("app_config").upsert(
    {
      key: PARKING_SWEEP_MARKER_KEY,
      value: String(seasonId),
      description:
        "Sæsonen parkerings-sweepen (#4592) sidst har kørt for. Gør sweepen idempotent " +
        "pr. sæson, så en genkørsel ikke parkerer hold hvis tilmelding allerede er brugt.",
      updated_at: now.toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(`app_config (${PARKING_SWEEP_MARKER_KEY}): ${error.message}`);
}

/**
 * Hele sweepen ved sæsonskiftet: parkér → genindplacér → nulstil tilmeldinger.
 * Kaldes fra processSeasonEnd KUN når season_signup_enabled er 'on', og fra
 * scripts/parkInactiveTeams.mjs --apply. Ingen egen flag-kontrol.
 *
 * IDEMPOTENT PR. SÆSON (`seasonId` = den sæson der slutter, påkrævet): har
 * sweepen allerede kørt for sæsonen, gør den intet. Markøren skrives FØR
 * nulstillingen, og fejler den skrivning, springes nulstillingen over — så en
 * genkørsel altid enten springes over eller stadig ser tilmeldingerne.
 *
 * Grundlaget hentes ÉN gang før parkeringen. Et hold der parkeres i denne
 * kørsel, har ingen tilmelding (ellers var det ikke valgt), så det kan ikke
 * samtidig være en genindplaceringskandidat.
 *
 * @param {{ supabase: object, seasonId: string, now?: Date, days?: number,
 *           teams?: object[], users?: object[], subscriptions?: object[],
 *           pickDivision?: Function, reconcileAiTeams?: Function }} args
 */
export async function runParkingSweep({
  supabase,
  seasonId,
  now = new Date(),
  days = 30,
  teams,
  users,
  subscriptions,
  pickDivision,
  reconcileAiTeams,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (seasonId == null) throw new Error("runParkingSweep: seasonId required (idempotency per season)");

  // Kan vi ikke læse markøren, ved vi ikke om sweepen allerede har kørt — så
  // kaster vi hellere (kalderen logger) end at risikere en dobbelt-sweep.
  if (await readSweepMarker(supabase) === String(seasonId)) {
    return { alreadySwept: true, seasonId, park: null, unpark: null, signupsReset: null, signupsResetError: null };
  }

  const inputs = (teams && users && subscriptions)
    ? { teams, users, subscriptions }
    : await loadParkingInputs({ supabase });

  const park = await parkDormantTeams({ supabase, ...inputs, now, days });
  const unpark = await unparkSignedUpTeams({ supabase, teams: inputs.teams, pickDivision, reconcileAiTeams });

  let signupsReset = null;
  let signupsResetError = null;
  try {
    await writeSweepMarker(supabase, seasonId, now);
    signupsReset = await resetSeasonSignups({ supabase, keepTeamIds: unpark.failedTeamIds });
  } catch (err) {
    // Parkering og genindplacering ER sket; en hængende tilmelding beskytter
    // blot holdet ét skifte mere. Synlig, men ikke en grund til at vælte sweepen.
    signupsResetError = err?.message || String(err);
    console.error("  ❌ managerParking: nulstilling af tilmeldinger fejlede:", signupsResetError);
    captureException(err, { tags: { flow: "manager_parking", stage: "reset_signups" }, extra: { seasonId } });
  }

  return { alreadySwept: false, seasonId, park, unpark, signupsReset, signupsResetError };
}
