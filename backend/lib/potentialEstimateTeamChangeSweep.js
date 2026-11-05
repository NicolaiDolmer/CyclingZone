// #7685 (Udvikling 2.0 trin 5, spec §3.3 punkt 3): holdskifte. Når en rytter kommer
// til et nyt hold, får det hold sit eget skøn (eget seed) med den viden, det havde i
// forvejen.
//
// HVORFOR ET SWEEP: ejerskifte sker mange steder (auktion, transfer, swap, akademi,
// udløb, admin), og alle sætter riders.acquired_at. Ét lille sweep over den kolonne
// dækker dem alle, også fremtidige stier, uden hooks i pengeflowet.
//
// STATELESS OG IDEMPOTENT: et kort tilbageblik frem for en gemt markør.
// planEstimateWrite lader tallet stå, når viden og loft er uændret, så en rytter der
// ses flere gange i vinduet ikke skrives igen. Tilbageblikket er bevidst kort, for
// et loft der flytter sig i vinduet, læses som en del af holdskiftet. Er processen
// nede længere end vinduet, indhenter søndagskørslen alle egne ryttere.
//
// RYTTER TILBAGE TIL TIDLIGERE HOLD: sweepet ser på acquired_at, ikke på om en række
// mangler, så holdet får rækken opdateret, hvis loftet har flyttet sig imens. Den
// gemte viden står, og tidligere træning på holdet tæller med
// (potentialEstimateWriter.loadTrainingDates). Holdet rytteren forlod, beholder sin
// række: viden forfalder ikke (S19).

import { fetchAllRows } from "./supabasePagination.js";
import { captureException } from "./sentry.js";
import {
  ESTIMATE_RIDER_COLUMNS, loadEstimateTeamIds, loadEstimateWriteConfig, writeTeamEstimates,
} from "./potentialEstimateWriter.js";

export const TEAM_CHANGE_LOOKBACK_HOURS = 6;

/**
 * @returns {Promise<{ ran: boolean, skipped?: string, riders?: number, written?: number,
 *   changed?: number, kept?: number, failedTeams?: number, firstError?: string }>}
 */
export async function runPotentialEstimateTeamChangeSweep({ supabase, now = new Date(), lookbackHours = TEAM_CHANGE_LOOKBACK_HOURS }) {
  const config = await loadEstimateWriteConfig(supabase);
  if (!config.enabled) return { ran: false, skipped: config.reason };

  const since = new Date(now.getTime() - lookbackHours * 3600 * 1000).toISOString();
  // `gte 1` frem for "not null": talent_ceiling har CHECK 1-99, og NULL falder fra.
  // schema-columns-ok: talent_ceiling kommer fra 2026-11-04-6110-potential-estimates.sql, snapshottet er ældre
  const moved = await fetchAllRows(() => supabase
    .from("riders").select(ESTIMATE_RIDER_COLUMNS).gte("acquired_at", since).gte("talent_ceiling", 1).order("id"));
  const ridersByTeam = new Map();
  for (const rider of moved) {
    if (!rider.team_id) continue;
    if (!ridersByTeam.has(rider.team_id)) ridersByTeam.set(rider.team_id, []);
    ridersByTeam.get(rider.team_id).push(rider);
  }
  const totals = { riders: 0, written: 0, changed: 0, kept: 0 };
  if (!ridersByTeam.size) return { ran: true, ...totals, failedTeams: 0 };

  const estimateTeams = new Set(await loadEstimateTeamIds(supabase));
  let failedTeams = 0;
  let firstError = null;
  for (const [teamId, riders] of ridersByTeam) {
    if (!estimateTeams.has(teamId)) continue;
    totals.riders += riders.length;
    try {
      const counts = await writeTeamEstimates({ supabase, teamId, riders, trigger: "team_change", config, now });
      totals.written += counts.written;
      totals.changed += counts.changed;
      totals.kept += counts.kept;
    } catch (err) {
      // best-effort: ét hold må ikke vælte resten; fejlen tælles og samles til
      // ét Sentry-event pr. kørsel i runPotentialEstimateTeamChangeTick, og næste
      // kørsel tager holdet igen.
      failedTeams += 1;
      firstError ??= err.message;
      console.error(`  team change potential estimates failed for team ${teamId}:`, err.message);
    }
  }
  return { ran: true, ...totals, failedTeams, ...(firstError ? { firstError } : {}) };
}

/** Cron-indgangen: kørslen + log + samlet Sentry-event. Kaster kun ved total fejl. */
export async function runPotentialEstimateTeamChangeTick({ supabase, now = new Date(), capture = captureException }) {
  const result = await runPotentialEstimateTeamChangeSweep({ supabase, now });
  if (result.written > 0) {
    console.log(`Team change potential estimates: ${result.riders} riders, ${result.written} written, ${result.changed} changed`);
  }
  if (result.failedTeams > 0) {
    capture(new Error(`potential-estimate-team-change: ${result.failedTeams} teams failed: ${result.firstError}`), { tags: { cron: "potential-estimate-team-change" } });
  }
  return result;
}
