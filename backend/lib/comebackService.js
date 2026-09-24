// #5643 (epik #4592, spor A4) · Hent et parkeret hold tilbage STRAKS ved tilmelding.
//
// Før: "Tilmeld dig næste sæson" (POST /api/season/signup) satte kun
// teams.next_season_signup_at, og holdet kom først tilbage ved næste sæsonskifte
// (managerParking.runParkingSweep). Ejer-beslutning 24/9: et parkeret hold der melder
// sig, er med igen med det samme, placeret efter Global Rank på en AI-plads, med
// forholdsmæssig sponsor for resten af sæsonen. Spec: docs/drafts/spec-s4-struktur-
// 2026-09-24.md afsnit A4.
//
// HVAD DENNE FIL GØR
//   1. Kræver at holdet er parkeret (parked_at != null) og at der er en aktiv sæson.
//   2. Rang → division → pulje (comebackPlacement.js, ren).
//   3. Flytter holdet: league_division_id, division, parked_at = null,
//      next_season_signup_at = null, comeback_season_id = den aktive sæson. Opdateringen
//      er en compare-and-swap på den parked_at-værdi vi læste, så to samtidige kald
//      ikke flytter holdet to gange.
//   4. Forholdsmæssig sponsor (se payComebackSponsor).
//   5. AI-fyld og kalender for mål-puljen, som når et nyt hold lander (teamProfileEngine).
//
// AI-PLADSEN BYGGES IKKE OM HER. Når league_division_id sættes, reserverer den
// eksisterende trigger trg_ai_pool_placement_reserve (database/2026-09-09-4753-ai-pool-
// retirement.sql) et overskydende AI-hold i puljen, og retire_ai_pool_team pensionerer
// det, når det ikke længere har løb i gang. Indtil da står puljen med ét hold for meget.
// reconcileAiTeamsForPool (samme opfølgning som unparkTeam og signup) er idempotent.
//
// comeback_season_id er markøren for spor A5 (ingen bestyrelsesdom i comeback-sæsonen).
// Den læses ikke her ud over genoptagelses-grenen nedenfor.

import { resolveComebackRank, tierForGlobalRank, pickComebackPool } from "./comebackPlacement.js";
import { proRataShare, proRataAmount, ensureMidSeasonSponsor } from "./midSeasonSponsor.js";
import { getActiveContract } from "./sponsorContractsService.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";
import { FINANCE_ACTOR_TYPE, FINANCE_REASON, FINANCE_RELATED_ENTITY } from "./economyConstants.js";
import { reconcileAiTeamsForPool } from "./aiTeamGenerator.js";
import { reconcilePoolCalendarOnActivation } from "./tierCalendarMaterializer.js";
import { loadSingleActiveSeason } from "./activeSeasonLookup.js";
import { fetchAllRows } from "./supabasePagination.js";
import { withSeniorSquadScope } from "./squads.js";
import { captureException } from "./sentry.js";

// Fejl med en HTTP-status, så route-filen kan oversætte uden at kende detaljerne.
export class ComebackError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.name = "ComebackError";
    this.code = code;
    this.status = status;
  }
}

// Idempotens-nøglen for comeback-sponsoren. Én pr. (sæson, hold).
export function comebackSponsorKey(seasonId, teamId) {
  return `comeback_sponsor:${seasonId}:${teamId}`;
}

// Sponsor-udbetalinger der allerede dækker sæsonen. Findes én af dem, betales der ikke
// igen: sæsonstartens sponsor (economyEngine.processSeasonStart) og midt-sæson-
// sponsoren for et nyt hold (midSeasonSponsor.ensureMidSeasonSponsor).
export function seasonSponsorKeys(seasonId, teamId) {
  return [
    `sponsor:${teamId}:${seasonId}`,
    `midseason_sponsor:${seasonId}:${teamId}`,
  ];
}

// Kolonnerne pickComebackPool læser pr. hold.
const PLACEMENT_TEAM_COLUMNS = "id, league_division_id, is_ai, is_bank, retired_at, pending_removal_at";

async function loadRank(supabase, teamId) {
  const { data: row, error } = await supabase
    .from("global_rank_mv")
    .select("team_id, global_rank, global_points")
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) throw new Error(`global_rank_mv: ${error.message}`);

  const globalRank = row?.global_rank ?? null;
  const globalPoints = row?.global_points ?? null;
  let humansAbove = null;
  // Kun når rangen mangler: tæl menneskehold med flere point (viewet er kun
  // menneskehold, #2792). Ingen point → ingen tælling, holdet går til bunden.
  if (globalRank == null && Number(globalPoints) > 0) {
    const above = await fetchAllRows(() => supabase
      .from("global_rank_mv")
      .select("team_id")
      .gt("global_points", Number(globalPoints))
      .order("team_id", { ascending: true }));
    humansAbove = above.length;
  }
  return {
    globalRank,
    globalPoints,
    rank: resolveComebackRank({ globalRank, globalPoints, humansAbove }),
  };
}

async function loadPlacementInputs(supabase) {
  // select("*"): league_divisions.retired_at (spor A2) findes måske ikke i alle miljøer
  // endnu; en manglende kolonne skal læses som "aktiv pulje". Kun seniorpuljer (#5517):
  // et comeback lander aldrig i en ungdomspulje. pickComebackPool filtrerer også selv.
  const { data: pools, error: poolsError } = await withSeniorSquadScope((senior) =>
    senior(supabase.from("league_divisions").select("*")));
  if (poolsError) throw new Error(`league_divisions: ${poolsError.message}`);
  const teams = await fetchAllRows(() => supabase
    .from("teams")
    .select(PLACEMENT_TEAM_COLUMNS)
    .order("id", { ascending: true }));
  return { pools: pools || [], teams: teams.filter((t) => t.league_division_id != null) };
}

/**
 * Forholdsmæssig sponsor for resten af sæsonen.
 *
 * - Har holdet allerede fået sæsonens sponsor (sæsonstart eller midt-sæson), betales
 *   intet: ingen dobbelt sponsor.
 * - Har holdet en aktiv kontrakt (det typiske for et parkeret hold), betales
 *   proRataAmount af kontraktens garanterede base, med nøglen comeback_sponsor:<sæson>:<hold>.
 *   ensureMidSeasonSponsor kan ikke bruges her: den springer over, når en kontrakt findes.
 * - Har holdet ingen kontrakt, gør vi som for et nyt hold: ensureMidSeasonSponsor opretter
 *   kontrakten og betaler den forholdsmæssige base med sin egen nøgle.
 *
 * Idempotent: et gentaget kald ser nøglen (DB'ens unikke indeks på idempotency_key) og
 * betaler ikke igen.
 */
export async function payComebackSponsor({
  supabase,
  team,
  season,
  getActiveContractFn = getActiveContract,
  ensureMidSeasonSponsorFn = ensureMidSeasonSponsor,
  creditFn = incrementBalanceWithAudit,
}) {
  const { data: prior, error: priorError } = await supabase
    .from("finance_transactions")
    .select("idempotency_key")
    .eq("team_id", team.id)
    .in("idempotency_key", seasonSponsorKeys(season.id, team.id))
    // pagination-safe: idempotency_key er unik (uniq_finance_idempotency_key), og vi spørger om to nøgler.
    .limit(2);
  if (priorError) throw new Error(`finance_transactions: ${priorError.message}`);
  if ((prior || []).length > 0) return { skipped: "already_paid_this_season", paid: false, amount: 0 };

  const share = proRataShare({
    raceDaysTotal: season.race_days_total,
    raceDaysCompleted: season.race_days_completed,
  });
  if (share <= 0) return { skipped: "season_over", paid: false, amount: 0 };

  const contract = await getActiveContractFn({ supabase, teamId: team.id });
  if (!contract) {
    const result = await ensureMidSeasonSponsorFn({ supabase, team });
    return { via: "mid_season_sponsor", ...result, paid: Boolean(result?.paid), amount: result?.amount ?? 0 };
  }

  const amount = proRataAmount({ guaranteedBase: contract.guaranteed_base, share });
  if (amount <= 0) return { skipped: "no_guaranteed_base", paid: false, amount: 0, share };

  const pct = Math.round(share * 100);
  const sponsorName = contract.sponsor_name || "Sponsor";
  const { skipped } = await creditFn(
    supabase,
    {
      teamId: team.id,
      delta: amount,
      payload: {
        type: "sponsor",
        amount,
        description: `Sponsor — pro-rata for the rest of the season (${sponsorName}, ${pct} %)`,
        // Samme i18n-kode som midt-sæson-sponsoren: teksten ("resten af sæsonen") er den
        // samme for et comeback, så finansoversigten behøver ingen ny oversættelse.
        metadata: {
          code: "tx.sponsor.midSeasonProRata",
          params: { sponsorName, percent: pct },
        },
        actor_type: FINANCE_ACTOR_TYPE.SYSTEM,
        actor_id: null,
        source_path: "comebackService.payComebackSponsor",
        reason_code: FINANCE_REASON.MIDSEASON_SPONSOR_PRORATA,
        related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
        related_entity_id: season.id,
        idempotency_key: comebackSponsorKey(season.id, team.id),
      },
    },
    { allowDuplicate: true },
  );
  return { via: "active_contract", contractId: contract.id, amount, share, paid: !skipped };
}

// AI-fyld og kalender for mål-puljen. Begge BEVIDST ikke-fatale, samme mønster som
// teamProfileEngine for et nyt hold: holdet ER placeret, og begge kald er idempotente,
// så en senere kørsel retter en sprunget.
async function followUpPool({ supabase, teamId, poolId, reconcileAiTeamsFn, reconcilePoolCalendarFn, captureExceptionFn }) {
  const followUp = { aiReconcile: null, calendar: null };
  try {
    followUp.aiReconcile = await reconcileAiTeamsFn({ supabase, poolId });
  } catch (err) {
    followUp.aiReconcile = { error: err?.message || String(err) };
    console.error(`[comeback] AI-reconcile for pulje ${poolId} fejlede (ikke-fatal):`, err?.message || err);
    captureExceptionFn(err, { tags: { flow: "season_comeback", stage: "ai_reconcile" }, extra: { teamId, poolId } });
  }
  try {
    followUp.calendar = await reconcilePoolCalendarFn({ supabase, poolId });
  } catch (err) {
    followUp.calendar = { error: err?.message || String(err) };
    console.error(`[comeback] kalender-reconcile for pulje ${poolId} fejlede (ikke-fatal):`, err?.message || err);
    captureExceptionFn(err, { tags: { flow: "season_comeback", stage: "pool_calendar" }, extra: { teamId, poolId } });
  }
  return followUp;
}

async function paySponsorSafely({ supabase, team, season, deps, captureExceptionFn }) {
  try {
    return await payComebackSponsor({ supabase, team, season, ...deps });
  } catch (err) {
    // Holdet er placeret. En fejlet udbetaling kan køres igen: et nyt kald rammer
    // genoptagelses-grenen, og nøglen forhindrer dobbelt betaling.
    console.error(`[comeback] sponsor for hold ${team.id} fejlede (ikke-fatal):`, err?.message || err);
    captureExceptionFn(err, { tags: { flow: "season_comeback", stage: "sponsor" }, extra: { teamId: team.id, seasonId: season.id } });
    return { error: err?.message || String(err), paid: false, amount: 0 };
  }
}

/**
 * Hent et parkeret hold tilbage i ligaen nu.
 *
 * @param {{ supabase: object, teamId: string, now?: Date, deps?: object }} args
 *   deps (tests): getActiveContractFn, ensureMidSeasonSponsorFn, creditFn,
 *   reconcileAiTeamsFn, reconcilePoolCalendarFn, captureExceptionFn
 * @returns {Promise<{ returned: boolean, alreadyReturned: boolean, teamId: string,
 *   seasonId: any, seasonNumber: number, rank: number|null, tier: number,
 *   division: number, leagueDivisionId: any, poolLabel: string|null,
 *   placementReason: string|null, sponsor: object, followUp: object }>}
 * @throws {ComebackError} team_not_found (404), not_parked (409),
 *   no_active_season (409), no_pool_available (409)
 */
export async function returnParkedTeam({ supabase, teamId, now = new Date(), deps = {} } = {}) {
  if (!supabase?.from) throw new Error("returnParkedTeam: a Supabase client is required");
  if (!teamId) throw new Error("returnParkedTeam: teamId is required");
  const {
    reconcileAiTeamsFn = reconcileAiTeamsForPool,
    reconcilePoolCalendarFn = reconcilePoolCalendarOnActivation,
    captureExceptionFn = captureException,
    ...sponsorDeps
  } = deps;

  // select("*"): comeback_season_id tilføjes af database/2026-09-25-4592-team-comeback-season.sql.
  const { data: team, error: teamError } = await supabase.from("teams").select("*").eq("id", teamId).maybeSingle();
  if (teamError) throw new Error(`teams: ${teamError.message}`);
  if (!team) throw new ComebackError("team_not_found", 404);

  const season = await loadSingleActiveSeason(supabase, {
    select: "id, number, race_days_total, race_days_completed",
    tag: "season-comeback",
    captureExceptionFn,
  });
  if (!season) throw new ComebackError("no_active_season", 409);

  // Genoptagelse: holdet kom allerede tilbage i denne sæson (fx et gentaget klik, eller
  // en tidligere kørsel hvor sponsoren fejlede). Ingen ny placering; sponsor og pulje-
  // opfølgning køres igen, og begge er idempotente.
  if (team.parked_at == null) {
    if (team.comeback_season_id != null && String(team.comeback_season_id) === String(season.id)) {
      const sponsor = await paySponsorSafely({ supabase, team, season, deps: sponsorDeps, captureExceptionFn });
      return {
        returned: true,
        alreadyReturned: true,
        teamId: team.id,
        seasonId: season.id,
        seasonNumber: season.number,
        rank: null,
        tier: Number(team.division),
        division: Number(team.division),
        leagueDivisionId: team.league_division_id,
        poolLabel: null,
        placementReason: null,
        sponsor,
        followUp: null,
      };
    }
    throw new ComebackError("not_parked", 409);
  }

  const { rank } = await loadRank(supabase, team.id);
  const tier = tierForGlobalRank(rank);
  const { pools, teams } = await loadPlacementInputs(supabase);
  const placement = pickComebackPool({ tier, pools, teams });
  if (!placement) throw new ComebackError("no_pool_available", 409);

  const { data: moved, error: moveError } = await supabase
    .from("teams")
    .update({
      league_division_id: placement.poolId,
      division: placement.tier,
      parked_at: null,
      next_season_signup_at: null,
      comeback_season_id: season.id,
    })
    .eq("id", team.id)
    // Compare-and-swap: kun hvis holdet stadig er parkeret med præcis den værdi vi læste.
    .eq("parked_at", team.parked_at)
    .select("id");
  if (moveError) throw new Error(`teams (comeback ${team.id}): ${moveError.message}`);
  if (!Array.isArray(moved) || moved.length === 0) {
    // Et samtidigt kald nåede først, og holdet er ikke længere parkeret. Intet flyttes
    // igen; et nyt kald rammer genoptagelses-grenen ovenfor.
    throw new ComebackError("not_parked", 409);
  }

  const placedTeam = { ...team, league_division_id: placement.poolId, division: placement.tier, parked_at: null };
  const sponsor = await paySponsorSafely({ supabase, team: placedTeam, season, deps: sponsorDeps, captureExceptionFn });
  const followUp = await followUpPool({
    supabase,
    teamId: team.id,
    poolId: placement.poolId,
    reconcileAiTeamsFn,
    reconcilePoolCalendarFn,
    captureExceptionFn,
  });

  console.log(
    `[comeback] hold ${team.id} tilbage i division ${placement.tier} (pulje ${placement.poolId}, ${placement.reason}) ${now.toISOString()}`,
  );

  return {
    returned: true,
    alreadyReturned: false,
    teamId: team.id,
    seasonId: season.id,
    seasonNumber: season.number,
    rank,
    tier,
    division: placement.tier,
    leagueDivisionId: placement.poolId,
    poolLabel: placement.label,
    placementReason: placement.reason,
    sponsor,
    followUp,
  };
}
