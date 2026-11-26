// #8604 Del 1: ingen egen rytter står uden tal.
//
// HVORFOR: et egen-rytter-skøn blev før kun skrevet ved et kig, ved holdskiftet (kun
// når holdet havde kigget på ham) og om søndagen efter grænsen for egne datoer. En
// købt eller hentet rytter uden kig, og et akademitalent der nåede grænsen midt i ugen,
// stod derfor helt uden potentiale og prognose til næste søndag, også uden Læres-teksten.
//
// HVAD DEN GØR: hver time og ved boot finder den egne ryttere på menneskeholdene uden en
// gemt række og skriver deres første skøn med årsagen "backfill". Den rører aldrig en
// gemt række (planEstimateWrite: backfill overskriver aldrig), så søndagsreglen for
// ændringer (#6403) står. En rytter holdet endnu intet ved om (akademitalent under
// grænsen) springes over og tages igen næste time.
//
// IDEMPOTENT og SELV-REPARERENDE: første kørsel efter deploy er datareparationen for
// ryttere, der allerede står uden tal; derefter lukker den hullet inden for en time.

import { fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { captureException } from "./sentry.js";
import {
  ESTIMATE_RIDER_COLUMNS, POTENTIAL_ESTIMATES_TABLE, loadEstimateTeamIds, loadEstimateWriteConfig, writeTeamEstimates,
} from "./potentialEstimateWriter.js";

/** Ren funktion: egne ryttere uden en gemt række for deres nuværende hold, grupperet pr. hold. */
export function missingOwnRidersByTeam(riders, storedPairs, teamIds) {
  const teams = new Set(teamIds);
  const stored = new Set((storedPairs ?? []).map((row) => `${row.rider_id}:${row.team_id}`));
  const byTeam = new Map();
  for (const rider of riders ?? []) {
    if (!rider?.team_id || !teams.has(rider.team_id) || rider.is_retired === true) continue;
    if (stored.has(`${rider.id}:${rider.team_id}`)) continue;
    if (!byTeam.has(rider.team_id)) byTeam.set(rider.team_id, []);
    byTeam.get(rider.team_id).push(rider);
  }
  return byTeam;
}

/**
 * @returns {Promise<{ ran: boolean, skipped?: string, teams?: number, riders?: number,
 *   written?: number, failedTeams?: number, firstError?: string }>}
 */
export async function runPotentialEstimateMissingSweep({ supabase, now = new Date() }) {
  const loaded = await loadEstimateWriteConfig(supabase, { now });
  if (!loaded.enabled) return { ran: false, skipped: loaded.reason };
  const config = { ...loaded, truthCache: new Map() };
  const teamIds = await loadEstimateTeamIds(supabase);
  if (!teamIds.length) return { ran: true, teams: 0, riders: 0, written: 0, failedTeams: 0 };

  // Under XP-modellen regner writeren selv det sande tal, så ryttere uden talent_ceiling
  // må ikke falde fra (samme regel som søndagskørslen).
  // schema-columns-ok: talent_ceiling kommer fra 2026-11-04-6110-potential-estimates.sql, snapshottet er ældre
  const riders = await fetchAllRowsChunkedIn(teamIds, (chunk) => {
    const query = supabase.from("riders").select(ESTIMATE_RIDER_COLUMNS).in("team_id", chunk);
    return (config.developmentXp ? query : query.gte("talent_ceiling", 1)).order("id");
  });
  const stored = await fetchAllRowsChunkedIn(teamIds, (chunk) => supabase
    .from(POTENTIAL_ESTIMATES_TABLE).select("rider_id, team_id").in("team_id", chunk).order("rider_id").order("team_id"));
  const byTeam = missingOwnRidersByTeam(riders, stored, teamIds);

  const totals = { teams: byTeam.size, riders: 0, written: 0 };
  let failedTeams = 0;
  let firstError = null;
  for (const [teamId, teamRiders] of byTeam) {
    totals.riders += teamRiders.length;
    try {
      const counts = await writeTeamEstimates({ supabase, teamId, riders: teamRiders, trigger: "backfill", config, now });
      totals.written += counts.written;
    } catch (err) {
      // best-effort: ét hold må ikke vælte resten; næste time tager holdet igen, og
      // fejlen samles til ét Sentry-event pr. kørsel i runPotentialEstimateMissingTick.
      failedTeams += 1;
      firstError ??= err.message;
      console.error(`  missing potential estimates failed for team ${teamId}:`, err.message);
    }
  }
  return { ran: true, ...totals, failedTeams, ...(firstError ? { firstError } : {}) };
}

/** Cron-indgangen: kørslen + log + samlet Sentry-event. */
export async function runPotentialEstimateMissingTick({ supabase, now = new Date(), capture = captureException }) {
  const result = await runPotentialEstimateMissingSweep({ supabase, now });
  if (result.written > 0) {
    console.log(`Missing potential estimates: ${result.riders} riders on ${result.teams} teams, ${result.written} written`);
  }
  if (result.failedTeams > 0) {
    capture(new Error(`potential-estimate-missing: ${result.failedTeams} teams failed: ${result.firstError}`), { tags: { cron: "potential-estimate-missing" } });
  }
  return result;
}
