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
//     Kører via demote_rider_to_academy-RPC'en under advisory-lås (loft pr. mål-
//     trup, #5432, + atomisk sletning af fremtidige race_entries). Løn OG kontrakt-TERM arves
//     UÆNDRET hvis rytteren allerede har en komplet kontrakt (#4589 — samme
//     #1309/#2881-invariant som promote() og contractOnAcquirePatch: en
//     akademi-flytning er ikke en kontrakt-fornyelse); kun en reelt kontraktløs
//     rytter får en frisk akademi-løn + -aftale (create-if-missing, #3620).
//
//   • moveRider(...) — flyt en rytter til en NAVNGIVET trup (junior / u23 /
//     senior, #5432). Opad frit, nedad kun inden for mål-truppens aldersloft;
//     altid kun med ledig plads, uden aktiv auktion og ikke midt i et etapeløb.
//     Til/fra senior går gennem promote()/demote() ovenfor (kontrakt- og løn-
//     reglerne bor dér); junior ↔ U23 går gennem move_academy_rider_squad-RPC'en.
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

import { notifyTeamOwner } from "./notificationService.js";
import { computeFrozenSalary, computeContractEndSeason, contractOnAcquirePatch } from "./contractSeed.js";
import { getTeamMarketState } from "./marketUtils.js";
import { ACADEMY } from "./academyFlag.js";
import { LAUNCH_REFERENCE_YEAR } from "./riderProgressionEngine.js";
import { countOngoingRaceEntries } from "./raceEntryCleanup.js";
import { findPendingGraduation } from "./academyGraduation.js";
import { ageForSeason } from "./riderSeasonAge.js";
import { ACTIVE_AUCTION_STATUSES } from "./auctionRules.js";
import { getRidersInActiveStageRace } from "./stageRaceTransferDefer.js";
import {
  SQUAD_MAX_AGE, DEFAULT_SQUAD, ACADEMY_SQUAD_WHEN_AGE_UNKNOWN,
  isSquad, isYouthSquad, squadForSeason, squadCapRpcArgs, effectiveSquad,
  fitsSquadAge, squadMoveDirection,
} from "./squads.js";

/**
 * Demote-løn (#2594): samme delte formel som al anden løn —
 * current_production_value × SALARY_RATE_PRODUCTION (computeFrozenSalary, #3989).
 * Ét fælles løn-system (#2083-princippet), nu på produktions-basen.
 *
 * Bruges KUN til at prissætte en FRISK akademi-kontrakt (reelt kontraktløs
 * rytter) — se resolveDemoteSalary for den regel demote() selv anvender.
 */
export function demoteSalary({ current_production_value } = {}) {
  return computeFrozenSalary({ current_production_value });
}

// #4589 (bug: "Loennen stiger ved holdskifte + akademi-placering", rapporteret
// af 3 spillere 1/9, ejer-bekræftet uønsket): demote() genberegnede TIDLIGERE
// altid lønnen ubetinget — også for en rytter der allerede havde en komplet
// kontrakt. Det brød den generelle #1309/#2881-invariant ("løn er FROSSEN ved
// signering", GAME_INVARIANTS.md + YOUTH_RULES.md §"Løn frosset ved signering
// | Uændret") og var asymmetrisk med promote() (arver ALTID en eksisterende
// kontrakt uændret, #2881). Rod-årsag til at spring var opad og ikke nedad:
// #3989 (20/8) hævede produktions-satsen til 0,35 — langt over den gamle
// signerings-sats (0,067 af market_value) — så en ung, spirende rytter (høj
// current_production_value relativt til sin oprindelige signeringsbasis)
// demotes til en HØJERE løn end den han allerede havde, i stedet for den
// ventede ungdoms-RABAT. Prod-måling 7/9 (SELECT, siden 28/8): 4 ryttere fik
// et hold-skifte (trade/swap) efterfulgt af akademi-demote inden for 2 dage —
// alle 4 endte med salary/current_production_value ≈ 0,30-0,35, dvs. netop
// nyligt genberegnet til produktionssatsen (heriblandt @thelambas rytter,
// 22.035 CZ$ — tallet fra issuet). Samme "arv uændret, kun kontraktløs får en
// frisk beregning"-mønster som contractOnAcquirePatch (contractSeed.js) og
// promote() ovenfor. Delt af demote() OG /riders/:id/academy-demote-quote
// (api.js) så preview og udførelse aldrig kan divergere (#3784-lektien).
// CodeRabbit (PR #4973): resolveDemoteSalary og demote() gentog uafhængigt af
// hinanden den samme "komplet kontrakt"-betingelse — udtrukket her så begge
// steder deler ÉT udtryk for #1309/#2881/#4589-invarianten (samme
// fejl-mønster som selve #3620/#4589-bugget denne fil retter).
export function hasCompleteContract(rider) {
  return rider?.salary != null
    && rider?.contract_end_season != null
    && rider?.contract_length != null;
}

export function resolveDemoteSalary(rider) {
  return hasCompleteContract(rider) ? rider.salary : demoteSalary(rider);
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
  // #4619: squad og is_academy skrives ALTID sammen — is_academy er afledt af
  // squad i overgangsperioden (spec §3.2), og en sti der kun rører det ene felt
  // efterlader rytteren i en tilstand hvor de to kolonner er uenige.
  const { error } = await supabase.from("riders").update({
    squad: "senior",
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
  "not_owned", "already_academy", "not_u23", "too_old_for_squad", "rider_on_market",
  "rider_listed", "academy_full", "invalid_squad",
]);

/**
 * Mål-truppen for en nedrykning: den trup kalderen har valgt (moveRider), ellers
 * den trup rytterens sæsonalder hører til.
 *
 * Er rytteren for gammel til enhver ungdomstrup, eller er alderen ukendt, sendes
 * 'u23' — den ældste ungdomstrup — så RPC'ens aldersgate afviser med 'not_u23'
 * præcis som før #5432. Aldersreglen håndhæves dermed ÉT sted (SQL, under låsen)
 * i stedet for at blive gentaget her.
 *
 * @param {{birthdate?:string|null}} rider
 * @param {number} seasonNumber
 * @param {string|undefined} requestedSquad
 * @returns {"junior"|"u23"}
 */
function demoteTargetSquad(rider, seasonNumber, requestedSquad) {
  if (requestedSquad !== undefined) return requestedSquad;
  const ageSquad = squadForSeason(rider.birthdate, seasonNumber);
  return isYouthSquad(ageSquad) ? ageSquad : "u23";
}

/**
 * Demote en U23-senior-rytter ned i akademiet (D5).
 *
 * - newSalary = resolveDemoteSalary(rider): en rytter med en komplet kontrakt
 *   beholder sin frosne løn UÆNDRET (#4589/#1309/#2881); kun en reelt
 *   kontraktløs rytter får en frisk akademi-løn via demoteSalary() = max(1,
 *   round(current_production_value × SALARY_RATE_PRODUCTION)).
 * - p_season_start_year = LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) (spejler
 *   ageForSeason, så RPC'ens alders-gate matcher motoren).
 * - kalder demote_rider_to_academy-RPC'en (advisory-lås + loft pr. mål-trup +
 *   aldersloft + squad/is_academy i ÉN skrivning + atomisk sletning af
 *   fremtidige race_entries). Loftet og aldersloftet kommer fra squads.js.
 * - ok=false → kast named error; ok=true → notify 'academy_demoted'.
 *
 * @param {object} supabase
 * @param {{teamId:string, riderId:string, seasonNumber:number, targetSquad?:"junior"|"u23", notify?:Function}} args
 *   targetSquad: kun moveRider sætter den; uden den afgør sæsonalderen truppen.
 * @throws 'rider_not_found' | 'not_owned' | 'already_academy' | 'not_u23'
 *         | 'too_old_for_squad' | 'rider_on_market' | 'rider_listed'
 *         | 'academy_full' | 'invalid_squad'
 * @returns {Promise<{riderId:string, action:'demoted', squad:string, newSalary:number, racesCleared:number, racesOngoing:number}>}
 */
export async function demote(supabase, {
  teamId, riderId, seasonNumber, targetSquad: requestedSquad, notify = notifyTeamOwner,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { data: rider } = await supabase.from("riders")
    .select("id, team_id, firstname, lastname, is_academy, base_value, current_production_value, birthdate, salary, contract_length, contract_end_season")
    .eq("id", riderId).maybeSingle();
  if (!rider) throw new Error("rider_not_found");

  // ── #5432: loft PR. MÅL-TRUP, håndhævet inde i RPC'en ────────────────────
  // Før (#4619 slice 1) lå trup-gaten her i JS, uden for låsen, mens RPC'en
  // bagefter håndhævede sin egen flade cap på alle akademiryttere under ét. Nu
  // tæller RPC'en selv pr. mål-trup under advisory-låsen, med loftet fra
  // squads.js som argument (squadCapRpcArgs). Fejlkoden for en fuld trup er
  // stadig 'academy_full': frontend læser netop den streng.
  const targetSquad = demoteTargetSquad(rider, seasonNumber, requestedSquad);
  const squadArgs = squadCapRpcArgs(targetSquad);

  // #3989: løn-satsen er global, så demote behøver ikke holdets division længere.
  const seasonStartYear = LAUNCH_REFERENCE_YEAR + (Number(seasonNumber) - 1);

  // #3620/#4589: KONTRAKT-TERMEN og LØNNEN følger rytteren uændret ned i
  // akademiet, hvis han allerede har en komplet kontrakt. Før skrev demote
  // ubetinget en frisk 3-sæsoners akademi-aftale forankret i den AKTUELLE sæson
  // — så en rytter manageren havde forlænget til sæson 5 kom ud af akademiet med
  // udløb i sæson 4 (rapporteret i prod 10/8, #3620) — OG genberegnede lønnen
  // ubetinget mod produktions-satsen, hvilket sendte en spirende ung rytters løn
  // OPAD i stedet for den ventede ungdoms-rabat (rapporteret i prod 1/9, #4589).
  // Samme create-if-missing/inherit-if-present-invariant som
  // contractOnAcquirePatch og promote(): kun en rytter UDEN komplet kontrakt får
  // akademi-aftalen (løn + term). Dermed er promote/demote hinandens inverse,
  // og en tur gennem akademiet kan hverken forkorte/forlænge en kontrakt eller
  // ændre lønnen.
  const hasContract = hasCompleteContract(rider);
  const newSalary = resolveDemoteSalary(rider);
  const contractLength = hasContract ? rider.contract_length : ACADEMY.CONTRACT_LENGTH;
  const contractEnd = hasContract
    ? rider.contract_end_season
    : computeContractEndSeason(seasonNumber, ACADEMY.CONTRACT_LENGTH);

  const { data, error } = await supabase.rpc("demote_rider_to_academy", {
    p_team_id: teamId,
    p_rider_id: riderId,
    p_new_salary: newSalary,
    p_contract_length: contractLength,
    p_contract_end: contractEnd,
    p_season_start_year: seasonStartYear,
    ...squadArgs,
    p_squad_max_age: SQUAD_MAX_AGE[targetSquad],
  });
  if (error) throw new Error(`demote rpc: ${error.message}`);

  if (!data || data.ok !== true) {
    const code = data?.code;
    if (DEMOTE_ERROR_CODES.has(code)) throw new Error(code);
    throw new Error(`demote failed${code ? `: ${code}` : ""}`);
  }

  // #5432: squad skrives nu af RPC'en i SAMME række-skrivning som is_academy
  // (før: en separat, ikke-atomisk UPDATE herfra efter RPC-kaldet).

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
    squad: data.squad ?? targetSquad,
    newSalary: data.new_salary ?? newSalary,
    racesCleared: data.rows_deleted ?? 0,
    racesOngoing,
  };
}

// ── moveRider: junior ↔ U23 ↔ senior (#5432) ────────────────────────────────

// RPC ok=false-koder fra move_academy_rider_squad → named errors.
const MOVE_RPC_ERROR_CODES = new Set([
  "not_owned", "not_academy", "same_squad", "rider_on_market", "rider_in_stage_race",
  "squad_full", "invalid_squad",
]);

// De delegerede stier (promote/demote) har hver deres historiske kode for "fuld"
// og "for gammel" — frontend læser dem på de eksisterende knapper og de ændres
// derfor ikke dér. moveRider giver én kontrakt for alle tre retninger.
const MOVE_ERROR_ALIASES = Object.freeze({
  academy_full: "squad_full",        // demote: mål-truppen er fuld
  squad_cap_violation: "squad_full", // promote: seniortruppens division-cap
  not_u23: "too_old_for_squad",      // demote: for gammel til U23
});

function normalizeMoveError(err) {
  const alias = MOVE_ERROR_ALIASES[err?.message];
  return alias ? new Error(alias, { cause: err }) : err;
}

/**
 * Rytterens NUVÆRENDE trup. effectiveSquad (squads.js) klarer overgangs-
 * perioden før #4619-backfill'en; kun en akademirytter uden brugbar fødselsdato
 * falder igennem, og han står i akademiets nederste trin (samme regel som
 * backfill'en).
 */
function currentSquadOf(rider, seasonAge) {
  return effectiveSquad(rider, seasonAge)
    ?? (rider?.is_academy === true ? ACADEMY_SQUAD_WHEN_AGE_UNKNOWN : DEFAULT_SQUAD);
}

async function hasActiveAuction(supabase, riderId) {
  const { data, error } = await supabase.from("auctions")
    .select("id")
    .eq("rider_id", riderId)
    .in("status", ACTIVE_AUCTION_STATUSES)
    .limit(1);
  if (error) throw new Error(`moveRider auction lookup: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * junior ↔ U23 inden for akademiet: kun truppen skifter (is_academy, løn og
 * kontrakt er uændrede). Loft, auktion og etapeløb tjekkes igen af RPC'en under
 * holdets advisory-lås, så to samtidige flytninger ikke kan fylde samme plads.
 */
async function moveWithinAcademy(supabase, { teamId, riderId, fromSquad, targetSquad, direction, now }) {
  const { data, error } = await supabase.rpc("move_academy_rider_squad", {
    p_team_id: teamId,
    p_rider_id: riderId,
    ...squadCapRpcArgs(targetSquad),
  });
  if (error) throw new Error(`move rpc: ${error.message}`);
  if (!data || data.ok !== true) {
    const code = data?.code;
    if (MOVE_RPC_ERROR_CODES.has(code)) throw new Error(code);
    throw new Error(`move failed${code ? `: ${code}` : ""}`);
  }

  // Op fra junior til U23: en ventende junior → U23-overgang (Graduation Day) er
  // dermed gennemført af manageren selv. Samme oprydning som promote() laver for
  // U23 → senior, ellers ville sweepet køre overgangen igen bagefter. En ventende
  // række mod en ANDEN trup (fx senior) røres ikke.
  if (direction === "up") {
    const grad = await findPendingGraduation(supabase, { teamId, riderId });
    if (grad && grad.to_squad === targetSquad) {
      const { error: gradErr } = await supabase.from("academy_graduation")
        .update({ status: "promoted", resolved_at: now.toISOString() })
        .eq("id", grad.id);
      if (gradErr) throw new Error(`move grad resolve: ${gradErr.message}`);
    }
  }

  return { riderId, action: "moved", from: fromSquad, to: targetSquad, squadCount: data.squad_count ?? null };
}

/**
 * Flyt en rytter til en navngiven trup: junior, u23 eller senior (#5432).
 *
 * Regler (YOUTH_RULES §2.1/§2.2, issue #5432):
 *   • OPAD frit: ingen aldersgrænse på vej mod senior.
 *   • NEDAD kun inden for mål-truppens aldersloft (squads.fitsSquadAge).
 *   • Altid: ledig plads i mål-truppen, ingen aktiv auktion, ikke midt i et
 *     etapeløb (samme afgrænsning som #1995/#4423: race_type='stage_race',
 *     ikke completed, stages_completed > 0).
 *
 * Retningen afgør stien, så kontrakt- og løn-reglerne kun findes ét sted:
 *   → senior          promote()  (division-cap, #1309/#2881-kontrakt, grad-oprydning)
 *   senior → ungdom   demote()   (RPC: loft pr. trup, #4589-løn, race_entries)
 *   junior ↔ U23      move_academy_rider_squad-RPC'en
 *
 * Fejlkoderne er én kontrakt for alle tre retninger: 'squad_full' og
 * 'too_old_for_squad' dækker også de delegerede stiers historiske koder.
 *
 * @param {object} supabase
 * @param {{teamId:string, riderId:string, targetSquad:string, seasonNumber:number,
 *   now?:Date, getMarketState?:Function, notify?:Function, ridersInActiveStageRace?:Function}} args
 * @throws 'invalid_squad' | 'rider_not_found' | 'not_owned' | 'same_squad'
 *   | 'too_old_for_squad' | 'rider_on_market' | 'rider_listed'
 *   | 'rider_in_stage_race' | 'squad_full' | 'not_academy' | 'already_academy'
 * @returns {Promise<{riderId:string, action:'promoted'|'demoted'|'moved', from:string, to:string}>}
 */
export async function moveRider(supabase, {
  teamId, riderId, targetSquad, seasonNumber, now = new Date(),
  getMarketState = getTeamMarketState, notify = notifyTeamOwner,
  ridersInActiveStageRace = getRidersInActiveStageRace,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!isSquad(targetSquad)) throw new Error("invalid_squad");

  const { data: rider, error } = await supabase.from("riders")
    .select("id, team_id, is_academy, squad, birthdate")
    .eq("id", riderId).maybeSingle();
  if (error) throw new Error(`moveRider rider lookup: ${error.message}`);
  if (!rider) throw new Error("rider_not_found");
  if (rider.team_id !== teamId) throw new Error("not_owned");

  const seasonAge = ageForSeason(rider.birthdate, seasonNumber);
  const fromSquad = currentSquadOf(rider, seasonAge);
  const direction = squadMoveDirection(fromSquad, targetSquad);
  if (direction === "none") throw new Error("same_squad");
  if (direction === "down" && !fitsSquadAge({ squad: targetSquad, seasonAge })) {
    throw new Error("too_old_for_squad");
  }

  // Dagens gates, for ALLE retninger. RPC'erne gentager dem under låsen hvor de
  // har dem; promote() har dem ikke, så de skal stå her.
  if (await hasActiveAuction(supabase, riderId)) throw new Error("rider_on_market");
  const racing = await ridersInActiveStageRace(supabase, [riderId]);
  if (racing.includes(riderId)) throw new Error("rider_in_stage_race");

  try {
    if (targetSquad === DEFAULT_SQUAD) {
      const res = await promote(supabase, { teamId, riderId, seasonNumber, now, getMarketState, notify });
      return { ...res, from: fromSquad, to: targetSquad };
    }
    if (fromSquad === DEFAULT_SQUAD) {
      const res = await demote(supabase, { teamId, riderId, seasonNumber, targetSquad, notify });
      return { ...res, from: fromSquad, to: targetSquad };
    }
    return await moveWithinAcademy(supabase, { teamId, riderId, fromSquad, targetSquad, direction, now });
  } catch (err) {
    throw normalizeMoveError(err);
  }
}

