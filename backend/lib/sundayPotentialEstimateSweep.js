// #7685 (Udvikling 2.0 trin 5, spec §3.3 punkt 2): søndagskørslen af de gemte
// potentiale-skøn. Egne ryttere får skønnet opdateret, når holdet ved mere (flere
// afregnede datoer) eller det sande loft har flyttet sig; fremmede ryttere kun,
// når loftet har flyttet sig. Det følger #6403-reglen: værdier ændres kun søndag.
//
// SELV-GATED: søndag, fra samme time som værdierne, flag tændt og kalibrering sat.
// Vægur-planlægningen og boot-runnet i cron.js må derfor fyre når som helst.
//
// IDEMPOTENT uden claim-tabel: planEstimateWrite lader tallet stå, når viden og
// loft er uændret, så en ny kørsel samme søndag skriver intet. Fejler et hold, tager
// næste hele time det igen. En fejlfri kørsel husker datoen i processen, så de
// resterende timer ikke læser det hele igen; en genstart koster kun en ekstra læsning.

import { copenhagenDateString, copenhagenHour, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { SUNDAY_VALUE_FROM_HOUR } from "./economyConstants.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { captureException } from "./sentry.js";
import {
  ESTIMATE_RIDER_COLUMNS, POTENTIAL_ESTIMATES_TABLE, loadEstimateTeamIds, loadEstimateWriteConfig, writeTeamEstimates,
} from "./potentialEstimateWriter.js";

const processState = { cleanRunDate: null };

// `gte 1` frem for "not null": talent_ceiling har CHECK 1-99, og NULL falder fra.
async function loadOwnRiders(supabase, teamId) {
  // schema-columns-ok: talent_ceiling kommer fra 2026-11-04-6110-potential-estimates.sql, snapshottet er ældre
  return fetchAllRows(() => supabase
    .from("riders").select(ESTIMATE_RIDER_COLUMNS).eq("team_id", teamId).gte("talent_ceiling", 1).order("id"));
}

// Fremmede ryttere holdet ved noget om: en gemt række eller et kig. Kiggene er med,
// fordi et skøn der ikke blev skrevet ved selve kigget, ellers aldrig ville komme.
async function loadForeignRiders(supabase, teamId, ownIds) {
  const [stored, actions] = await Promise.all([
    fetchAllRows(() => supabase.from(POTENTIAL_ESTIMATES_TABLE).select("rider_id").eq("team_id", teamId).order("rider_id")),
    fetchAllRows(() => supabase.from("scout_actions").select("id, rider_id").eq("team_id", teamId).order("id")),
  ]);
  const ids = [...new Set([...stored, ...actions].map((row) => row.rider_id))].filter((id) => !ownIds.has(id));
  // schema-columns-ok: talent_ceiling kommer fra 2026-11-04-6110-potential-estimates.sql, snapshottet er ældre
  return fetchAllRowsChunkedIn(ids, (chunk) => supabase
    .from("riders").select(ESTIMATE_RIDER_COLUMNS).in("id", chunk).gte("talent_ceiling", 1).order("id"));
}

async function sweepTeam({ supabase, teamId, config, now }) {
  const own = await loadOwnRiders(supabase, teamId);
  const foreign = await loadForeignRiders(supabase, teamId, new Set(own.map((rider) => rider.id)));
  return writeTeamEstimates({ supabase, teamId, riders: [...own, ...foreign], trigger: "sunday", config, now });
}

/**
 * @returns {Promise<{ ran: boolean, runDate: string, skipped?: string, teams?: number,
 *   written?: number, changed?: number, kept?: number, failedTeams?: number, firstError?: string }>}
 */
export async function runSundayPotentialEstimateSweep({ supabase, now = new Date(), state = processState }) {
  const runDate = copenhagenDateString(now);
  if (copenhagenWeekdayKey(runDate) !== "sun") return { ran: false, runDate, skipped: "not_sunday" };
  if (copenhagenHour(now) < SUNDAY_VALUE_FROM_HOUR) return { ran: false, runDate, skipped: "before_window" };
  if (state.cleanRunDate === runDate) return { ran: false, runDate, skipped: "already_ran" };

  const config = await loadEstimateWriteConfig(supabase);
  if (!config.enabled) return { ran: false, runDate, skipped: config.reason };

  const teamIds = await loadEstimateTeamIds(supabase);
  const totals = { written: 0, changed: 0, kept: 0 };
  let failedTeams = 0;
  let firstError = null;
  for (const teamId of teamIds) {
    try {
      const counts = await sweepTeam({ supabase, teamId, config, now });
      totals.written += counts.written;
      totals.changed += counts.changed;
      totals.kept += counts.kept;
    } catch (err) {
      // best-effort: ét hold må ikke vælte resten; fejlen tælles og samles til
      // ét Sentry-event pr. kørsel i runSundayPotentialEstimateTick.
      failedTeams += 1;
      firstError ??= err.message;
      console.error(`  sunday potential estimates failed for team ${teamId}:`, err.message);
    }
  }
  if (!failedTeams) state.cleanRunDate = runDate;
  return { ran: true, runDate, teams: teamIds.length, ...totals, failedTeams, ...(firstError ? { firstError } : {}) };
}

/** Cron-indgangen: kørslen + log + samlet Sentry-event. Kaster kun ved total fejl. */
export async function runSundayPotentialEstimateTick({ supabase, now = new Date(), capture = captureException }) {
  const result = await runSundayPotentialEstimateSweep({ supabase, now });
  if (result.ran) {
    console.log(`Sunday potential estimates (${result.runDate}): ${result.teams} teams, ${result.written} written, ${result.changed} changed, ${result.kept} kept, ${result.failedTeams} failed`);
  }
  if (result.failedTeams > 0) {
    capture(new Error(`potential-estimate-sunday: ${result.failedTeams} teams failed: ${result.firstError}`), { tags: { cron: "potential-estimate-sunday" } });
  }
  if (result.skipped === "params_missing") {
    capture(new Error("potential-estimate-sunday: flag is on but the calibration is missing or invalid"), { tags: { cron: "potential-estimate-sunday" } });
  }
  return result;
}
