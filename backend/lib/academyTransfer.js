// Akademi op/ned (#932 · S7 race-hub). To manuelle manager-handlinger uden for
// graduerings-vinduet:
//
//   • promote(...)  — flyt en akademi-rytter OP i senior-truppen (cap-guard +
//     frossen senior-løn + senior-kontrakt). Resolver en evt. pending
//     academy_graduation-row så sweepet ikke dobbelt-kører. Kalder IKKE
//     resolveGraduation direkte (den kræver en pending grad-row; promote skal
//     virke for enhver akademi-rytter, også de der endnu ikke er gradueret).
//
//   • demote(...)   — flyt en U23-senior-rytter NED i akademiet (D5-berettigelse).
//     Kører via demote_rider_to_academy-RPC'en under advisory-lås (akademi-8-cap +
//     atomisk sletning af fremtidige race_entries). Løn gen-beregnes til ungdomsrate.
//
// Spec: docs/superpowers/specs/2026-06-25-race-hub-program-design.md §5 S7 + D5.

import { notifyTeamOwner } from "./notificationService.js";
import { computeFrozenSalary, computeContractEndSeason, CONTRACT } from "./contractSeed.js";
import { getTeamMarketState } from "./marketUtils.js";
import { ACADEMY } from "./academyFlag.js";
import { LAUNCH_REFERENCE_YEAR } from "./riderProgressionEngine.js";

/**
 * Demote-løn = ACADEMY.SALARY_RATE (0.10) × base_value, gulvet på 1 (ejer-beslutning
 * D5: ignorér prize-bonus, gen-beregn ned til ren ungdomsrate). Bevidst en ANDEN sats
 * end computeFrozenSalary (senior 0.067) — en demote skal koste ungdomsrate, ikke den
 * frosne seniorløn.
 */
export function demoteSalary({ base_value } = {}) {
  const base = Number(base_value) > 0 ? Number(base_value) : 0;
  return Math.max(1, Math.round(base * ACADEMY.SALARY_RATE));
}

/**
 * Promovér en akademi-rytter til senior-truppen.
 *
 * - cap-guard via getTeamMarketState (future_count + 1 > squad_limits.max →
 *   'squad_cap_violation').
 * - salary = computeFrozenSalary(rider) (ny senior-løn, overskriver akademi-løn).
 * - is_academy=false + senior-kontrakt (DEFAULT_ACQUIRE_LENGTH).
 * - resolver en evt. pending academy_graduation-row → 'promoted' (så
 *   academyGraduationSweep ikke auto-resolver den bagefter).
 * - notify 'academy_promoted'.
 *
 * @throws 'rider_not_found' | 'not_owned' | 'not_academy' | 'squad_cap_violation'
 * @returns {Promise<{riderId:string, action:'promoted', salary:number}>}
 */
export async function promote(supabase, {
  teamId, riderId, seasonNumber, now = new Date(),
  getMarketState = getTeamMarketState, notify = notifyTeamOwner,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { data: rider } = await supabase.from("riders")
    .select("id, team_id, firstname, lastname, is_academy, base_value, prize_earnings_bonus, salary")
    .eq("id", riderId).maybeSingle();
  if (!rider) throw new Error("rider_not_found");
  if (rider.team_id !== teamId) throw new Error("not_owned");
  if (!rider.is_academy) throw new Error("not_academy");

  // Cap-guard: en promotion må ikke bringe future_count over division-cap'en.
  const state = await getMarketState(supabase, teamId);
  const cap = state?.squad_limits?.max ?? 30;
  const future = state?.future_count ?? state?.rider_count ?? 0;
  if (future + 1 > cap) throw new Error("squad_cap_violation");

  const salary = computeFrozenSalary(rider);
  const length = CONTRACT.DEFAULT_ACQUIRE_LENGTH;
  const { error } = await supabase.from("riders").update({
    is_academy: false,
    salary,
    contract_length: length,
    contract_end_season: computeContractEndSeason(seasonNumber, length),
  }).eq("id", riderId);
  if (error) throw new Error(`promote update: ${error.message}`);

  // Resolver en evt. pending graduerings-row så sweepet ikke kører den igen.
  const { data: grad } = await supabase.from("academy_graduation")
    .select("id, status").eq("team_id", teamId).eq("rider_id", riderId).maybeSingle();
  if (grad && grad.status === "pending") {
    const { error: gradErr } = await supabase.from("academy_graduation")
      .update({ status: "promoted", resolved_at: now.toISOString() })
      .eq("team_id", teamId).eq("rider_id", riderId);
    if (gradErr) throw new Error(`promote grad resolve: ${gradErr.message}`);
  }

  const name = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
  await notify({
    supabase, teamId, type: "academy_promoted", relatedId: riderId,
    title: "Academy rider promoted",
    message: `${name} was promoted from your academy to the senior squad.`,
    metadata: {
      titleCode: "notif.academyPromoted.title",
      messageCode: "notif.academyPromoted.message",
      titleParams: { name },
      messageParams: { name },
    },
  });

  return { riderId, action: "promoted", salary };
}

// RPC ok=false-koder → named errors (kalderen i api.js maper til HTTP-status).
const DEMOTE_ERROR_CODES = new Set([
  "not_owned", "already_academy", "not_u23", "rider_on_market", "rider_listed", "academy_full",
]);

/**
 * Demote en U23-senior-rytter ned i akademiet (D5).
 *
 * - newSalary = max(1, round(base_value × ACADEMY.SALARY_RATE)) (ungdomsrate).
 * - p_season_start_year = LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) (spejler
 *   ageForSeason, så RPC'ens alders-gate matcher motoren).
 * - kalder demote_rider_to_academy-RPC'en (advisory-lås + akademi-cap + atomisk
 *   sletning af fremtidige race_entries).
 * - ok=false → kast named error; ok=true → notify 'academy_demoted'.
 *
 * @throws 'rider_not_found' | 'not_owned' | 'already_academy' | 'not_u23'
 *         | 'rider_on_market' | 'rider_listed' | 'academy_full'
 * @returns {Promise<{riderId:string, action:'demoted', newSalary:number, racesCleared:number}>}
 */
export async function demote(supabase, {
  teamId, riderId, seasonNumber, notify = notifyTeamOwner,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { data: rider } = await supabase.from("riders")
    .select("id, team_id, firstname, lastname, is_academy, base_value, birthdate")
    .eq("id", riderId).maybeSingle();
  if (!rider) throw new Error("rider_not_found");

  const newSalary = demoteSalary(rider);
  const seasonStartYear = LAUNCH_REFERENCE_YEAR + (Number(seasonNumber) - 1);
  const contractLength = ACADEMY.CONTRACT_LENGTH;
  const contractEnd = computeContractEndSeason(seasonNumber, contractLength);

  const { data, error } = await supabase.rpc("demote_rider_to_academy", {
    p_team_id: teamId,
    p_rider_id: riderId,
    p_new_salary: newSalary,
    p_contract_length: contractLength,
    p_contract_end: contractEnd,
    p_season_start_year: seasonStartYear,
  });
  if (error) throw new Error(`demote rpc: ${error.message}`);

  if (!data || data.ok !== true) {
    const code = data?.code;
    if (DEMOTE_ERROR_CODES.has(code)) throw new Error(code);
    throw new Error(`demote failed${code ? `: ${code}` : ""}`);
  }

  const name = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
  await notify({
    supabase, teamId, type: "academy_demoted", relatedId: riderId,
    title: "Senior rider moved to academy",
    message: `${name} was moved from your senior squad down to the academy.`,
    metadata: {
      titleCode: "notif.academyDemoted.title",
      messageCode: "notif.academyDemoted.message",
      titleParams: { name },
      messageParams: { name },
    },
  });

  return {
    riderId,
    action: "demoted",
    newSalary: data.new_salary ?? newSalary,
    racesCleared: data.rows_deleted ?? 0,
  };
}
