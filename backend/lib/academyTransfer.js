// Akademi op/ned (#932 · S7 race-hub). To manuelle manager-handlinger uden for
// graduerings-vinduet:
//
//   • promote(...)  — flyt en akademi-rytter OP i senior-truppen (cap-guard +
//     #1309-kontrakt-invariant: kun kontraktløse ryttere får en ny standard-
//     kontrakt, en eksisterende kontrakt arves uændret — #2881). Resolver en
//     evt. pending academy_graduation-row så sweepet ikke dobbelt-kører.
//     Kalder IKKE resolveGraduation direkte (den kræver en pending grad-row;
//     promote skal virke for enhver akademi-rytter, også de der endnu ikke er
//     gradueret).
//
//   • demote(...)   — flyt en U23-senior-rytter NED i akademiet (D5-berettigelse).
//     Kører via demote_rider_to_academy-RPC'en under advisory-lås (akademi-8-cap +
//     atomisk sletning af fremtidige race_entries). HELE kontrakten — løn OG term —
//     arves uændret hvis rytteren allerede har en komplet kontrakt (#3620 for
//     termen, #4582 for lønnen) — kun en kontraktløs rytter får akademi-aftalen.
//
// Spec: docs/superpowers/specs/2026-06-25-race-hub-program-design.md §5 S7 + D5.
//
// #3620 (14/8) — begge retninger tabte kontrakt-sæsoner, af TO forskellige grunde:
//   1) promote(): SELECTen hentede aldrig contract_end_season. Så længe guarden i
//      contractOnAcquirePatch kun så på salary (#2929) var det harmløst; da #2902
//      tilføjede `contract_end_season != null` til guarden, blev den permanent
//      falsk her (`undefined != null` === false) og promote regenererede DERFOR
//      hver eneste kontrakt: længde 3 → 2, udløb → aktiv sæson + 1.
//   2) demote(): skrev ubetinget en frisk akademi-kontrakt forankret i den
//      aktuelle sæson og forkortede dermed enhver kontrakt med udløb længere ude.
//
// #4582 (4/9, ejer-beslutning) — sidste halvdel af den samme asymmetri: #3620
// fredede kontrakt-TERMEN ved demote, men lod lønnen gen-beregne fra
// current_production_value. Promote arvede hele kontrakten, demote kun halvdelen,
// og fordi CPV vokser hen over sæsonen betød en tur ned i akademiet en STIGNING
// (3 spillere rapporterede 17k → 22k, 1/9). Ejer-reglen til spillerne er
// "when you buy a rider, you also buy the contract, until you renew it" — derfor
// arver demote nu HELE kontrakten (løn + længde + udløb), præcis som promote.
// Én betingelse, ét sted: demoteContractPatch() nedenfor, brugt af BÅDE demote()
// og quote-routen (#3784-læringen: preview og udførelse må aldrig regne hver for sig).

import { notifyTeamOwner } from "./notificationService.js";
import { computeFrozenSalary, computeContractEndSeason, contractOnAcquirePatch } from "./contractSeed.js";
import { getTeamMarketState } from "./marketUtils.js";
import { ACADEMY } from "./academyFlag.js";
import { LAUNCH_REFERENCE_YEAR } from "./riderProgressionEngine.js";
import { countOngoingRaceEntries } from "./raceEntryCleanup.js";
import { findPendingGraduation } from "./academyGraduation.js";

/**
 * Demote-løn (#2594): samme delte formel som al anden løn —
 * current_production_value × SALARY_RATE_PRODUCTION (computeFrozenSalary, #3989).
 * Ét fælles løn-system (#2083-princippet), nu på produktions-basen.
 */
export function demoteSalary({ current_production_value } = {}) {
  return computeFrozenSalary({ current_production_value });
}

/**
 * Demote-kontrakt (#4582) — create-if-missing / inherit-if-present, SAMME
 * invariant som contractOnAcquirePatch (#1309) og promote (#2881):
 *
 *   • Har rytteren en KOMPLET kontrakt (salary + contract_length +
 *     contract_end_season) → hele kontrakten arves UÆNDRET. Lønnen gen-beregnes
 *     ALDRIG. "When you buy a rider, you also buy the contract, until you renew
 *     it" (ejer-beslutning 4/9, #4582).
 *   • Er rytteren reelt kontraktløs → akademi-aftalen oprettes
 *     (demoteSalary + ACADEMY.CONTRACT_LENGTH forankret i den aktive sæson).
 *
 * Ren funktion, ingen DB. Brugt af BÅDE demote() og GET
 * /riders/:id/academy-demote-quote, så dialogen og selve flyttet aldrig kan
 * regne forskelligt (#3784).
 *
 * #3620-guarden gentages her: er `salary` sat, men kolonnen
 * `contract_end_season` slet ikke hentet af kalderens SELECT, kan vi ikke
 * skelne "ingen kontrakt" fra "kolonnen mangler" — det er en programmeringsfejl
 * hos kalderen, og vi kaster i stedet for at gætte (og dermed regenerere en
 * kontrakt vi skulle have arvet).
 *
 * @returns {{salary:number, contract_length:number, contract_end_season:number, keepsContract:boolean}}
 */
export function demoteContractPatch(rider, seasonNumber) {
  if (rider && rider.salary != null && !("contract_end_season" in rider)) {
    throw new Error(
      "demoteContractPatch: rider mangler feltet contract_end_season — " +
      "tilføj kolonnen til kalderens SELECT (ellers gen-beregnes en eksisterende kontrakt, #3620/#4582)"
    );
  }
  const keepsContract = rider?.salary != null
    && rider?.contract_end_season != null
    && rider?.contract_length != null;

  if (keepsContract) {
    return {
      salary: rider.salary,
      contract_length: rider.contract_length,
      contract_end_season: rider.contract_end_season,
      keepsContract: true,
    };
  }
  return {
    salary: demoteSalary(rider ?? {}),
    contract_length: ACADEMY.CONTRACT_LENGTH,
    contract_end_season: computeContractEndSeason(seasonNumber, ACADEMY.CONTRACT_LENGTH),
    keepsContract: false,
  };
}

/**
 * Promovér en akademi-rytter til senior-truppen.
 *
 * - cap-guard via getTeamMarketState (future_count + 1 > squad_limits.max →
 *   'squad_cap_violation').
 * - kontrakt/løn: #1309-invarianten — genbruger contractOnAcquirePatch, SAMME
 *   gate som auktion/transfer/swap. Rytteren er allerede "ejet" (kun akademi-
 *   flaget skifter), så en EKSISTERENDE kontrakt (salary != null) arves
 *   UÆNDRET (#2881: promote må aldrig forkorte/overskrive en kontrakt der
 *   fulgte med fra før akademi-ophold). Kun en reelt kontraktløs rytter
 *   (salary == null) får en frisk standard-kontrakt (DEFAULT_ACQUIRE_LENGTH).
 * - is_academy=false.
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

  // #3620: contract_length + contract_end_season SKAL med i SELECTen. Uden
  // contract_end_season ser contractOnAcquirePatch en `undefined` og kan ikke
  // skelne "ingen kontrakt" fra "kolonnen blev ikke hentet" — det var præcis
  // regressionen der genopstod da #2902 udvidede guarden (se filens header).
  const { data: rider } = await supabase.from("riders")
    .select("id, team_id, firstname, lastname, is_academy, base_value, prize_earnings_bonus, current_production_value, salary, contract_length, contract_end_season")
    .eq("id", riderId).maybeSingle();
  if (!rider) throw new Error("rider_not_found");
  if (rider.team_id !== teamId) throw new Error("not_owned");
  if (!rider.is_academy) throw new Error("not_academy");

  // Cap-guard: en promotion må ikke bringe future_count over division-cap'en.
  const state = await getMarketState(supabase, teamId);
  const cap = state?.squad_limits?.max ?? 30;
  const future = state?.future_count ?? state?.rider_count ?? 0;
  if (future + 1 > cap) throw new Error("squad_cap_violation");

  // #2881/#1309: kun kontraktløse ryttere (salary == null) får en ny kontrakt;
  // en eksisterende kontrakt (fx overlevet fra før et akademi-ophold) arves
  // UÆNDRET — regenerér ALDRIG. {} hvis rider.salary != null.
  const contractPatch = contractOnAcquirePatch(rider, seasonNumber);
  const { error } = await supabase.from("riders").update({
    is_academy: false,
    ...contractPatch,
  }).eq("id", riderId);
  if (error) throw new Error(`promote update: ${error.message}`);

  // Resolver en evt. pending graduerings-row så sweepet ikke kører den igen.
  // #4484: opslaget SKAL scopes til den pending række (findPendingGraduation),
  // og opdateringen ramme netop dens id — en rytter med akademi-ophold over to
  // sæsoner har flere rækker, og det gamle team_id+rider_id-update ville have
  // stemplet BEGGE sæsoners rækker som 'promoted'.
  const grad = await findPendingGraduation(supabase, { teamId, riderId });
  if (grad) {
    const { error: gradErr } = await supabase.from("academy_graduation")
      .update({ status: "promoted", resolved_at: now.toISOString() })
      .eq("id", grad.id);
    if (gradErr) throw new Error(`promote grad resolve: ${gradErr.message}`);
  }

  const salary = contractPatch.salary ?? rider.salary;

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
 * - kontrakt: demoteContractPatch(rider, seasonNumber) — en komplet kontrakt
 *   (løn + længde + udløb) arves UÆNDRET (#4582); kun en kontraktløs rytter får
 *   akademi-aftalen (demoteSalary + ACADEMY.CONTRACT_LENGTH), efter samme delte
 *   formel som alle andre erhvervelses-stier (#2083-princippet: ét fælles løn-system).
 * - p_season_start_year = LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) (spejler
 *   ageForSeason, så RPC'ens alders-gate matcher motoren).
 * - kalder demote_rider_to_academy-RPC'en (advisory-lås + akademi-cap + atomisk
 *   sletning af fremtidige race_entries).
 * - ok=false → kast named error; ok=true → notify 'academy_demoted'.
 *
 * @throws 'rider_not_found' | 'not_owned' | 'already_academy' | 'not_u23'
 *         | 'rider_on_market' | 'rider_listed' | 'academy_full'
 * @returns {Promise<{riderId:string, action:'demoted', newSalary:number, racesCleared:number, racesOngoing:number}>}
 */
export async function demote(supabase, {
  teamId, riderId, seasonNumber, notify = notifyTeamOwner,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { data: rider } = await supabase.from("riders")
    .select("id, team_id, firstname, lastname, is_academy, base_value, current_production_value, birthdate, salary, contract_length, contract_end_season")
    .eq("id", riderId).maybeSingle();
  if (!rider) throw new Error("rider_not_found");

  const seasonStartYear = LAUNCH_REFERENCE_YEAR + (Number(seasonNumber) - 1);

  // #3620 + #4582: HELE kontrakten følger rytteren ned i akademiet. Før skrev
  // demote ubetinget en frisk 3-sæsoners akademi-aftale forankret i den AKTUELLE
  // sæson (#3620: udløb sæson 5 → sæson 4, rapporteret i prod 10/8) og
  // gen-beregnede lønnen fra current_production_value (#4582: 17k → 22k,
  // rapporteret af 3 spillere 1/9). Samme create-if-missing /
  // inherit-if-present-invariant som contractOnAcquirePatch og promote(): kun en
  // rytter UDEN komplet kontrakt får akademi-aftalen. Dermed er promote/demote
  // hinandens inverse på HELE kontrakten, og en tur gennem akademiet kan hverken
  // forkorte, forlænge eller om-prise den.
  const {
    salary: newSalary,
    contract_length: contractLength,
    contract_end_season: contractEnd,
  } = demoteContractPatch(rider, seasonNumber);

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

  // #3805: races.status='scheduled'+stages_completed=0-entries er lige blevet
  // ryddet af RPC'en (rows_deleted); IGANGVÆRENDE løb (stages_completed>0)
  // rører RPC'en aldrig, men rytteren er nu is_academy=true og dermed ikke
  // løbsberettiget (riderEligibility.js) — så han falder reelt ud af dem.
  // SAMME funktion (countOngoingRaceEntries) bruges af academy-demote-quote-
  // routen til at vise tallet FØR bekræftelse — se raceEntryCleanup.js.
  const racesOngoing = await countOngoingRaceEntries(supabase, riderId);

  return {
    riderId,
    action: "demoted",
    newSalary: data.new_salary ?? newSalary,
    racesCleared: data.rows_deleted ?? 0,
    racesOngoing,
  };
}
