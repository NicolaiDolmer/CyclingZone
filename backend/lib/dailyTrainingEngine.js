import { trainingDateRpc } from "./trainingDateRpc.js";
// Daglig trænings-orchestrator (#1305) — eksekverer ÉN trænings-dag for ÉT hold.
//
// Idempotent via et unique-index i training_day_runs: reservation-first strategi
// bruger en pending-row som mutex. Postgres 23505 unique-violation ved INSERT
// → alreadyRan=true uden videre DB-skriv, medmindre raekken er en reservation som en
// anden koersel holder lige nu: saa en retryable held-fejl (#6759 gammel sti, #6827
// loebsdags-stien).
//
// #4846/#4847: HVILKET index der er mutexen afgoeres af `training_tick_per_race_day`:
//   flag off → UNIQUE(team_id, tick_date)                                   WHERE game_day IS NULL
//   flag on  → UNIQUE(team_id, season_id, COALESCE(squad,'senior'), game_day) WHERE game_day IS NOT NULL
// De to lever side om side (database/2026-09-14-4846-training-tick-game-day.sql +
// database/2026-09-15-4847-training-day-close-trigger.sql), og flag off er bit-identisk
// med foer: hverken season_id, game_day eller squad skrives.
//
// Spejler riderProgressionEngine.js: DI-supabase, loft genberegnet pr. tick
// (buildCapsForRider, #2471 — ikke lazy-initeret), batched writes (runBatched),
// ageForSeason-helper genbrugt herfra.
//
// #4847 "Train now" (design 29/9): POST /api/training/train-now kalder SAMME motor
// via trainNow.js for datoens loebsdage undtagen den sidste (I4: kun aftenens commit
// skriver traethed/form), med samme laaste opening-condition som sweepen (I1).
// Kaldes af: POST /api/training/run-today (manager) + cron-sweeps (assistant):
// trainingSweep.js paa den gamle kalenderdags-sti, trainingDayCloseTrigger.js paa
// loebsdags-stien (#4847). BONUS: `bonus` er true KUN paa den gamle sti — loebsdags-
// stien har ingen bonus (ejer 15/9, TRAINING_RULES.md §13.3 beslutning 3). Ingen
// nondeterminisme udover `now`-default + updated_at-timestamps.

import { randomUUID } from "node:crypto";
import { copenhagenDateString, copenhagenWeekdayKey, copenhagenMidnightUTC } from "./copenhagenTime.js";
import { resolveProgram, applyDailyTick } from "./dailyTraining.js";
// #4850 spor C2 (ejer 24/9): loebsdagen er et mellem-pas paa etapens profil-evner,
// koert gennem applyDailyTick. `applyRaceDevelopmentTick` (dailyTraining.js) bliver
// staaende til variant B (dagens intention, #4632), men motoren kalder den ikke mere.
import { raceDayProgram, RACE_DAY_FALLBACK_PROFILE } from "./raceDayYield.js";
import { loadRaceDayStagesByRider, loadRiderIdsWithStageOnGameDays } from "./raceDayStageLookup.js";
// #4629: programmer pr. loebsdag laeses gennem SAMME stige (resolveDayProgram
// kalder resolveDayIntensity); flaget off = den gamle linje, bit for bit.
import { resolveDayProgram, programSlotForRaceDay, weekDaysHaveSessions } from "./trainingPrograms.js";
// #5932: felterne har eget flag (training_program_cells), med training_programs som fallback.
import { isTrainingCellsEnabledForTeam } from "./trainingWeekPlanCellsFlag.js";
import { applyTrainingCatalog, isTrainingCatalogV3EnabledForTeam, v3SmartDefaultFocus } from "./trainingCatalogV3.js"; // #5319
import {
  loadTeamFatigueRules, loadRiderIdsWithStageOnDate, previousDateString, applyFatigueRules,
} from "./trainingFatigueRules.ts"; // #4854/#5620
import { nextFatigue, nextForm, conditionMultiplier, injuryRisk, rollInjury, RACE_DAY_ENGINE_RECOVERY_CONFIG, NEW_RIDER_START_CONDITION } from "./riderCondition.js";
import { buildCapsForRider, sameCaps } from "./riderProgression.js";
import { ageForSeason } from "./riderProgressionEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { loadTrainingStaffContext } from "./trainingStaffContext.js";
import { captureException } from "./sentry.js";
import { riderLevelBand } from "./staffAbilityConstants.js";
import { isRaceDayEngineEnabled } from "./raceDayEngineFlag.js";
import { isRaceDayDevelopmentEnabled } from "./raceDayDevelopmentFlag.js";
import { isTrainingTickPerRaceDayEnabled } from "./trainingTickRaceDayFlag.js";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { isTrainingConditionPerDateEnabled, readConditionWriterFlag } from './trainingDateConditionFlag.js';
import { isConditionModelV2Enabled, isRaceDateTrainingDayEnabled } from './conditionModelV2Flag.js';
import { loadTeamMedicalBonus } from './medicalEffects.js';
import { fatigueNowBeforeGameDay, slotFatiguesNow } from './riderFatigueNow.js'; // #7801
import { isFatigueNow7801Enabled } from './riderFatigueNowFlag.js';
import { settleTrainingDateCondition, canonicalRaceLoads } from './trainingDateCondition.js';
import {
  TRAINING_RACE_DAY_CONFIG, resolveRaceDayBudgetDivisor, raceDaySeedKey, resolveTeamRaceDay,
  loadBoundRiderIdsForRaceDay,
} from "./trainingRaceDayTick.js";
// #5462 (ejer-laast 15/9, TRAINING_RULES §13.3 pkt. 7): skadens VARIGHED regnes i
// LOEBSDAGE naar loebsdagen er tick-enheden. Datamodellen og dens trade-off staar i
// headeren paa injuryRaceDays.js.
import {
  injuryEndGameDay, injuryRaceDaysLeft, isInjuredOnRaceDay, resolveInjuryEndDates,
} from "./injuryRaceDays.js";
import { notifyTrainingInjuries } from "./raceAvailabilityNotifications.js"; // #7086
import { loadDevelopmentCurveB } from "./developmentCurveBFlag.ts"; // #3564 kurve B
import { ensureCurveBIgnition, curveBTransitionForDate, loadCurveBTransitionRoster } from "./developmentCurveBTransition7382.ts"; // #7382 blød overgang
import { loadRaceDayEffortByRider, raceDayIntentionYieldMultiplier } from "./raceDayIntentionYield.js"; // #6641 variant B
import { loadRaceDayRoleYield, loadRaceDayRoleByRider } from "./raceDayRoleYield5950.js"; // #5950 haard dag + rolle (kaldes via withRaceDayRoleYieldXp)
import { loadDevelopmentScoreB, developmentTickArgs } from "./developmentScoreWiring.js"; // #6950 Udviklingsscore B
import { loadDevelopmentXp, withRaceDayRoleYieldXp } from "./developmentXpFlag.ts"; // #6110 XP-modellen (slukket)
import { loadTrainNowBonusRiderIds } from './trainNowBonus7737.ts';
import { loadRaceCatchUp } from "./raceCatchUpWiring.js"; // #6950 catch-up via loeb
import { assessIllness } from "./conditionIllness.js"; // #6938 sygdom af langvarig ekstrem traethed
import { CURRENT_RACE_RULES_REVISION, isS5ProfilesV3OrLater } from "./raceEngineRulesRevision.ts";
import { loadTrainNowInstantRiderIds } from "./trainNowLock.js"; // #7737
import { watchReads } from "./trainNowPressMemory.js"; // #7982 trin 4a

// #4847: standard-truppen paa training_day_runs.squad. Kolonnen har DEFAULT 'senior'
// i skemaet (database/2026-09-15-4847-training-day-close-trigger.sql); konstanten her
// findes for at sweepens noegle-strenge og motorens INSERT kan dele ÉN sandhed.
export const TRAINING_DAY_RUN_DEFAULT_SQUAD = "senior";
// #6596: oprydning af en reservation efter en phase-1-fejl proeves et par gange,
// fordi sletningen typisk rammer samme forbigaaende nedbrud som selve fejlen.
const RESERVATION_CLEANUP_ATTEMPTS = 3;
const RESERVATION_CLEANUP_BACKOFF_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── #6759: selvrettende reservation paa den gamle kalenderdags-sti ─────────────
// Fejler baade phase 1 OG oprydningen (samme nedbrud), bliver en pending-raekke
// staaende og ville blokere holdet resten af dagen. Reservationen baerer derfor sit
// stadie i rapporten:
//   "loading" = kun laesninger/beregning, intet skrevet. En forældet "loading"-raekke
//               er ledig: naeste koersel sletter den betinget og reserverer forfra.
//   "writing" = phase 2 er i gang (eller fejlede midt i writes). ALDRIG ledig: en
//               blokeret dag er sikrere end et dobbelt-tick efter delvise ability-writes.
// `token` binder stadie-skiftet og oprydningen til PRAECIS denne reservation: en
// koersel der selv blev overtaget, finder ikke sin token ved skiftet til "writing",
// kaster foer writes og sletter aldrig den nye ejers raekke. Derfor er det sikkert
// at taerskelen er kort.
// Raekker uden stadie (skrevet foer #6759) behandles konservativt som optaget.
export const LEGACY_RESERVATION_STAGE_LOADING = "loading";
export const LEGACY_RESERVATION_STAGE_WRITING = "writing";
// Taerskel = én sweep-cyklus: begge traenings-crons (training sweep + training
// day-close) tikker hvert 5. minut (cron.js). En levende reservation lever kun
// under ét holds phase 1 (sekunder), saa en "loading"-raekke aeldre end ét cron-
// interval er efterladt, og en overtagelse af en langsom levende koersel er
// ufarlig (token, se ovenfor).
export const STALE_LEGACY_RESERVATION_MS = 5 * 60 * 1000;

/**
 * #6759: er en legacy-reservation forældet og dermed ledig? Kun en "loading"-raekke
 * aeldre end taerskelen. `created_at` er databasens egen tid ved INSERT.
 * @param {{stage?:string|null, report?:{stage?:string}|null, created_at?:string|null}} row
 * @param {Date} now
 */
export function isReclaimableLegacyReservation(row, now) {
  if (!isLegacyLoadingReservation(row)) return false;
  const createdAt = Date.parse(row.created_at ?? "");
  return Number.isFinite(createdAt) && createdAt < now.getTime() - STALE_LEGACY_RESERVATION_MS;
}

/** #6759: en uafregnet "loading"-reservation (frisk eller forældet). */
export function isLegacyLoadingReservation(row) {
  return (row?.stage ?? row?.report?.stage) === LEGACY_RESERVATION_STAGE_LOADING;
}

// #6759: noeglen er optaget paa den gamle sti. Tre udfald:
//   "settled"   — afregnet, "writing" eller gammelt format: alreadyRan som foer.
//   "reclaimed" — forældet "loading": slettet betinget, kalderen reserverer forfra.
//   kast        — frisk "loading": en anden koersel er i gang ELLER oprydningen
//                 fejlede for nylig. Holdet er IKKE afregnet: sweepene taeller
//                 kastet som en fejl (datoen forbliver aaben) og proever igen, og
//                 Train now svarer 409 (se isTrainingReservationHeldError); efter
//                 taerskelen frigives raekken. Intet er skrevet.
// Sletningen er compare-and-delete paa stadie + alder: to samtidige koersler kan
// ikke begge slette (Postgres laaser raekken, den anden ser 0 raekker), og en frisk
// reservation (created_at = nu) matcher aldrig. Taber en koersel sletningen eller det
// nye INSERT, kaster den samme retryable fejl som ved en frisk reservation (vinderen
// kan stadig fejle i phase 1), saa holdet afregnes hoejst én gang og aldrig tabes.
async function resolveTakenLegacyReservation({ supabase, teamId, tickDate, now }) {
  const { data: rows, error } = await supabase.from("training_day_runs")
    .select("id, created_at, report")
    .eq("team_id", teamId).eq("tick_date", tickDate)
    .eq("report->>stage", LEGACY_RESERVATION_STAGE_LOADING);
  if (error) throw new Error(`training_day_runs reservation lookup: ${error.message}`);
  const held = (rows ?? []).filter(isLegacyLoadingReservation);
  if (!held.length) return "settled";
  if (!held.every((row) => isReclaimableLegacyReservation(row, now))) throw reservationHeldError(teamId, tickDate);
  const cutoff = new Date(now.getTime() - STALE_LEGACY_RESERVATION_MS).toISOString();
  const { data: released, error: deleteError } = await supabase.from("training_day_runs").delete()
    .eq("team_id", teamId).eq("tick_date", tickDate)
    .eq("report->>stage", LEGACY_RESERVATION_STAGE_LOADING)
    .lt("created_at", cutoff)
    .select("id");
  if (deleteError) throw new Error(`training_day_runs stale reservation: ${deleteError.message}`);
  // En samtidig koersel kom foerst og er maaske stadig i phase 1: ikke afregnet endnu.
  if (!(released ?? []).length) throw reservationHeldError(teamId, tickDate);
  console.warn(`  ♻️ training_day_runs: stale reservation for team ${teamId} (${tickDate}) released`);
  return "reclaimed";
}

// #6759: holdet er ikke afregnet, men en anden koersel ejer noeglen lige nu.
// Sweepene ser bare et kast: de taeller en fejl og tager holdet igen (datoen
// forbliver aaben). `retryable` + `code` laeses af Train now-routen (#6798), der
// svarer 409 "proev igen om lidt" i stedet for 500 + Sentry.
export const TRAINING_RESERVATION_HELD = "training_reservation_held";

function reservationHeldError(teamId, tickDate) {
  const err = new Error(`training_day_runs: reservation for team ${teamId} (${tickDate}) is held by an unfinished run`);
  err.retryable = true;
  err.code = TRAINING_RESERVATION_HELD;
  return err;
}

/**
 * #6798: en anden koersel holder holdets reservation lige nu (intet er skrevet).
 * Kun denne retryable fejl er "traening i gang"; andre retryable fejl (fx en
 * forbigaaende gateway-fejl i staff-konteksten) er stadig rigtige fejl.
 * @param {unknown} err
 */
export function isTrainingReservationHeldError(err) {
  return err?.retryable === true && err?.code === TRAINING_RESERVATION_HELD;
}

// ── #6827: holdt reservation paa loebsdags-stien ─────────────────────────────
// Loebsdags-raekken staar som `{ pending: true }` fra reservationen til den sidste
// rapport-update, altsaa gennem baade phase 1 og phase 2. En optaget noegle betyder
// derfor ikke noedvendigvis "allerede koert": en sweep kan vaere midt i samme
// loebsdag. Train now maa ikke svare already_trained_today og gaa videre til
// senere loebsdage, mens det tidligere tick stadig skriver (409, se routen).
//   afregnet (ingen pending)       → alreadyRan som foer.
//   frisk pending (< taerskelen)   → retryable held-fejl; intet er skrevet.
//   forældet pending               → alreadyRan som foer: en efterladt raekke (fx
//                                    nedbrud i phase 2) er en blokeret loebsdag,
//                                    aldrig en ledig (ingen overtagelse her).
//   ingen raekke (frigivet imens)  → retryable held-fejl: den anden koersel
//                                    fejlede i phase 1, proev igen om lidt.
// Samme taerskel som den gamle sti (STALE_LEGACY_RESERVATION_MS); et tick for ét
// hold tager sekunder, saa en levende koersel er altid frisk.
/**
 * @param {{pending?:string|boolean|null, report?:{pending?:boolean}|null, created_at?:string|null}} row
 * @param {Date} now
 */
export function isHeldRaceDayReservation(row, now) {
  if (String(row?.pending ?? row?.report?.pending) !== "true") return false;
  const createdAt = Date.parse(row.created_at ?? "");
  // Ukendt alder behandles konservativt som en levende koersel.
  return !Number.isFinite(createdAt) || createdAt >= now.getTime() - STALE_LEGACY_RESERVATION_MS;
}

async function assertRaceDayReservationSettled({ supabase, runRowFilter, teamId, tickDate, now }) {
  const { data: rows, error } = await runRowFilter(
    supabase.from("training_day_runs").select("created_at, pending:report->>pending"),
  );
  if (error) throw new Error(`training_day_runs reservation lookup: ${error.message}`);
  if (!(rows ?? []).length || rows.some((row) => isHeldRaceDayReservation(row, now))) {
    throw reservationHeldError(teamId, tickDate);
  }
}

// ── #6500 (Udvikling 2.0 del 1, D6): daglig udvikling kun paa managerhold ─────
// AI-, bank- og testhold (og hold uden manager) koerer stadig det daglige tick:
// form, traethed, skade og traeningsscore er uaendrede. Men evnegevinsterne,
// ability_progress og de to historik-raekker droppes. En rytter der skifter til
// et managerhold, udvikler sig derfor fra foerste tick paa det nye hold.
//
// Bag `development_v2_aging_enabled` (slukket = bit-identisk med foer, ogsaa i
// DB-kaldene: holdets raekke hentes kun naar flaget er taendt). Kun "on"/true
// taender motoren: "beta" er IKKE en motor-skrivning her, fordi der ingen
// skyggedata er at bygge — det er en live balance-aendring for hele ligaen.
// Siden #6499 er dette flagets eneste laeser i motoren: saesonskiftet koerer
// altid den nye aldring, og developmentV2Flag.js er fjernet.
export const DEVELOPMENT_V2_AGING_FLAG_KEY = "development_v2_aging_enabled";

// #6210/#7075: maks +1 pr. evne pr. DATO (paa tvaers af datoens loebsdage og stier).
// Leveres med Udvikling 2.0 (ejer 23/10) og taendes samme soendag som resten.
// Slukket (default, fail-safe) = bit-identisk med foer, ogsaa i DB-kaldene: datoens
// andre rapporter hentes kun naar flaget er taendt. Kun "on" taender (beta = off).
export const ABILITY_CAP_PER_DATE_FLAG_KEY = "ability_cap_per_date_enabled";

async function isAbilityCapPerDateEnabled(supabase, { strict = false } = {}) {
  if (strict) return readConditionWriterFlag(supabase, ABILITY_CAP_PER_DATE_FLAG_KEY);
  return evaluateFlagStage(await readFlagStage(supabase, ABILITY_CAP_PER_DATE_FLAG_KEY));
}

async function isDevelopmentV2AgingEnabled(supabase, { strict = false } = {}) {
  // strict = loebsdags-datoens atomare sti: en fejlet laesning kaster (som de
  // oevrige flag der laeses dér), i stedet for at blive tolket som "off".
  if (strict) return readConditionWriterFlag(supabase, DEVELOPMENT_V2_AGING_FLAG_KEY);
  return evaluateFlagStage(await readFlagStage(supabase, DEVELOPMENT_V2_AGING_FLAG_KEY));
}

/**
 * #6500: er holdet et managerhold? Ikke-managerhold = AI, bank, testkonto eller
 * ingen manager (user_id null). `is_frozen` er bevidst ikke med: frosne hold
 * traenes ikke af sweepen i forvejen, og issuets afgraensning naevner det ikke.
 * @param {{user_id?:string|null,is_ai?:boolean|null,is_bank?:boolean|null,is_test_account?:boolean|null}} team
 */
export function isManagerTeamForDevelopment(team) {
  if (!team) return false;
  return team.user_id != null && team.is_ai !== true && team.is_bank !== true && team.is_test_account !== true;
}

/**
 * #7982 trin 3: a group of reads that do not depend on each other. With `together`
 * (only the train-now press) every read is sent at once, the group waits for all of
 * them, and the first failed read in list order is thrown: nothing after the group
 * (no write) runs, and no promise is left without an owner. Without it (the evening
 * run and plain training) the reads run one by one in list order, exactly as before.
 * A read that needs an earlier one in the same group awaits `earlier(i)`.
 * @template T
 * @param {boolean} together
 * @param {Array<(earlier: (i: number) => Promise<any>) => (T | Promise<T>)>} reads
 * @returns {Promise<T[]>}
 */
export async function readTogether(together, reads) {
  /** @type {Promise<any>[]} */
  const started = [];
  const earlier = (/** @type {number} */ i) => started[i];
  if (!together) {
    for (const read of reads) started.push(Promise.resolve(await read(earlier)));
    return Promise.all(started);
  }
  for (const read of reads) started.push((async () => read(earlier))());
  const settled = await Promise.allSettled(started);
  const failed = settled.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  return settled.map((result) => /** @type {PromiseFulfilledResult<any>} */ (result).value);
}

// Batched async-runner (samme hjælper som riderProgressionEngine.js).
async function runBatched(items, concurrency, fn) {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

// Beregn injured_until-dato: tickDate (YYYY-MM-DD) + days → YYYY-MM-DD.
// Noon UTC undgår DST-kanttilfælde ved dato-aritmetik.
/**
 * #6938: rytternes traethed de seneste afregnede dage foer `tickDate`, nyeste foerst, pr. rytter.
 * Kun afregnede dage (status complete); en manglende dag bryder stimen (conditionIllness).
 */
export async function loadIllnessFatigueHistory(supabase, riderIds, tickDate) {
  if (!riderIds?.length) return new Map();
  const from = addDaysToDate(tickDate, -ILLNESS_HISTORY_DAYS);
  // Paa rytter-id (primaernoeglen rider_id, season_id, tick_date): tabellen har intet index paa team_id.
  const { data, error } = await supabase
    .from("training_condition_settlements")
    .select("rider_id, tick_date, fatigue:applied_condition->>fatigue")
    .in("rider_id", riderIds)
    .eq("status", "complete")
    .gte("tick_date", from)
    .lt("tick_date", tickDate)
    .order("tick_date", { ascending: false });
  if (error) throw new Error(`training_condition_settlements (illness history): ${error.message}`);
  const byRider = new Map();
  const lastDate = new Map();
  for (const row of data ?? []) {
    const prev = lastDate.get(row.rider_id) ?? tickDate;
    // Kun dage i traek: en dag mangler -> stimen stopper der.
    if (addDaysToDate(row.tick_date, 1) !== prev) continue;
    byRider.set(row.rider_id, [...(byRider.get(row.rider_id) ?? []), Number(row.fatigue)]);
    lastDate.set(row.rider_id, row.tick_date);
  }
  return byRider;
}
const ILLNESS_HISTORY_DAYS = 14;

function addDaysToDate(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// #6210 (doktrin, MASTERPLAN): maks +1 pr. evne pr. rytter pr. DATO. En dato baerer
// flere loebsdage, og hvert loebsdags-tick har sit eget +1-loft (#4801), saa to
// stier samme dato (Train now om morgenen, aftenens sweep, en loebsdag som tick)
// kunne hver give et point i samme evne. Vaernet sidder HER, i den ene funktion
// alle tre stier gaar igennem (runTeamTrainingDay), lige foer skrivningen.
export const ABILITY_GAIN_CAP_PER_DATE = 1;

/** PURE: summer allerede krediterede hele point pr. evne fra datoens tidligere rapporter. */
export function sumDateGains(reportRows = []) {
  const used = {};
  for (const row of reportRows) {
    for (const [ability, n] of Object.entries(row?.gains ?? {})) {
      const points = Number(n);
      if (Number.isFinite(points) && points > 0) used[ability] = (used[ability] ?? 0) + points;
    }
  }
  return used;
}

/**
 * PURE: klip et ticks gevinster saa evnen hoejst stiger ABILITY_GAIN_CAP_PER_DATE
 * paa datoen. Et klippet point gaar ikke tabt: det laegges tilbage paa fremdrifts-
 * baren og baeres til naeste dato, samme carry-over som loebsdags-loftet (#4750).
 * Muterer ikke input. Uden klip returneres samme objekt.
 */
export function capTickGainsPerDate({ tickResult, abilities, usedGains = {}, cap = ABILITY_GAIN_CAP_PER_DATE }) {
  if (!tickResult?.gains) return tickResult;
  let next = null;
  for (const [ability, n] of Object.entries(tickResult.gains)) {
    const gained = Number(n) || 0;
    const allowance = Math.max(0, cap - (Number(usedGains[ability]) || 0));
    if (gained <= allowance) continue;
    next ??= {
      ...tickResult,
      abilities: { ...tickResult.abilities },
      progress: { ...tickResult.progress },
      gains: { ...tickResult.gains },
      capped_by_date: {},
    };
    const excess = gained - allowance;
    next.abilities[ability] = Number(abilities?.[ability] ?? 0) + allowance;
    next.progress[ability] = Number(next.progress[ability] ?? 0) + excess;
    if (allowance > 0) next.gains[ability] = allowance;
    else delete next.gains[ability];
    next.capped_by_date[ability] = excess;
  }
  return next ?? tickResult;
}

// #6009: matcher etape-opslagets etape den kanoniske belastning for loebsdagen?
// Etape-opslaget (raceDayStageLookup) vaelger den FOERSTE etape, hvis en rytter
// har to resultater paa samme loebsdag (dobbeltbooking, brud paa #4209). Ledgeren
// har da én kanonisk raekke og en godkendt alias-raekke (duplicate_of_race_id/
// duplicate_of_stage_number peger paa den kanoniske; canonicalRaceLoads har
// allerede verificeret parret). Peger opslaget paa aliasset, afregnes rytteren
// paa den kanoniske belastning. Alt andet (ingen ledger-raekke for etapen, eller
// et alias der ikke peger paa den kanoniske) er stadig en uafklaret dato.
export function stageMatchesCanonicalLoad(stage, canonical, ledgerRows = []) {
  if (!stage || !canonical) return false;
  const same = (raceId, stageNumber) => raceId === stage.raceId && Number(stageNumber) === Number(stage.stageNumber);
  if (same(canonical.race_id, canonical.stage_number)) return true;
  return ledgerRows.some(row => row.rider_id === canonical.rider_id
    && Number(row.game_day) === Number(canonical.game_day)
    && row.duplicate_of_race_id === canonical.race_id
    && Number(row.duplicate_of_stage_number) === Number(canonical.stage_number)
    && same(row.race_id, row.stage_number));
}

// #3459 D1: batch-lookup "hvilke af holdets ryttere racede i dag" — race_results
// (result_type='stage') med imported_at i tickDate's danske kalenderdøgn, filtreret
// på holdets rider_ids. Fail-safe by construction: ALDRIG throw — en query-fejl
// resolver som { data: null, error } så kald-stedet kan falde tilbage til "ingen
// løbsdag antaget" (log warning) i stedet for at vælte hele trænings-dagen for et
// helt hold pga. én best-effort-berigelse. Kun kaldt når raceDayDevelopmentOn
// (#4277; kald-stedet sender Promise.resolve({data:[],error:null}) når flag off —
// ingen ekstra DB-belastning for en slukket feature).
// #3459 D2: select udvidet med race_id + stage_number — koblingspunktet til
// race_stage_profiles (profil-typen) der driver RACE_PROFILE_ABILITY_MAP nedenfor.
async function loadRacedRiderIdsToday(supabase, riderIds, now, tickDate) {
  try {
    const dayStart = copenhagenMidnightUTC(now);
    const dayEnd = copenhagenMidnightUTC(new Date(`${addDaysToDate(tickDate, 1)}T12:00:00Z`));
    // pagination-safe: .in("rider_id", riderIds) bounds this to ÉT holds egen
    // rytter-trup (typisk < 30, langt under PostgREST's 1000-rækkers-loft) —
    // samme størrelsesorden som de øvrige team-scopede loads i denne fil (fx
    // abilities/condition ovenfor), ikke en tabel-bred/ubegrænset select.
    const { data, error } = await supabase
      .from("race_results")
      .select("rider_id, race_id, stage_number")
      .eq("result_type", "stage")
      .in("rider_id", riderIds)
      .gte("imported_at", dayStart.toISOString())
      .lt("imported_at", dayEnd.toISOString());
    if (error) return { data: null, error };
    return { data: data ?? [], error: null };
  } catch (err) {
    // best-effort: en synkron/netværks-fejl her må ALDRIG vælte hele holdets
    // trænings-dag pga. én best-effort-berigelse — kald-stedet logger en warning
    // og falder tilbage til "ingen løbsdag antaget" (samme fail-safe-kontrakt
    // som error-grenen ovenfor).
    return { data: null, error: err };
  }
}

// #3459 D2: batch-lookup profil-type pr. (race_id, stage_number) for dagens
// racede ryttere. race_stage_profiles er den RENESTE sti fra race_results til
// RACE_PROFILE_ABILITY_MAP — races/race_stage_schedule har INGEN profil-kolonne
// (kun stage_schedule's scheduled_at, races' race_type/race_class). Fail-safe
// (samme kontrakt som loadRacedRiderIdsToday ovenfor): query-fejl → { data: null,
// error } så kald-stedet falder tilbage til raceFatigueLoad's samme 'rolling'-
// ukendt-profil-fallback i stedet for at vælte trænings-dagen.
async function loadRaceStageProfiles(supabase, raceIds) {
  if (!raceIds.length) return { data: [], error: null };
  try {
    const { data, error } = await supabase
      .from("race_stage_profiles")
      .select("race_id, stage_number, profile_type")
      // pagination-safe: raceIds er dedupet fra ÉT holds dagens racede ryttere
      // (typisk 0-1 løb pr. hold pr. dag, langt under PostgREST's 1000-rækkers-
      // loft) — samme størrelsesorden som race_results-loaded ovenfor, ikke en
      // tabel-bred/ubegrænset select.
      .in("race_id", raceIds);
    if (error) return { data: null, error };
    return { data: data ?? [], error: null };
  } catch (err) {
    // best-effort: en synkron/netværks-fejl her må ALDRIG vælte hele holdets
    // trænings-dag pga. én best-effort-berigelse — kald-stedet falder tilbage
    // til 'rolling'-profilen (samme fail-safe-kontrakt som ovenfor).
    return { data: null, error: err };
  }
}

// ── #7982 trin 4a: the rules of one day field, shared by every path ─────────────────────────
// The engine runs one day field in three parts: "hent" (fetch everything the day field needs),
// "regn" (computeTrainingDayTick, pure) and "gem" (commitTrainingDateTick). The evening run and
// plain training fetch every day field from the database, as before. The train-now press fetches
// its first day field the same way and remembers it (trainNowPressMemory.js); its later day fields
// are fetched from that memory. The helpers below hold the rules both ways of fetching use, so a
// rule lives in one place and the two ways can only differ in where the numbers come from.

/** PURE: the per-race-day keys of a day field (which slot, which seed, does it close the date). */
export function raceDayFrame({ useRaceDayKey, conditionPerDate, raceDay, dateDays, dateGameDays, seasonId, tickDate }) {
  // Loebsdags-stoej/skade-seed (A3). null paa den gamle sti ⇒ dailyTraining.js falder
  // tilbage til dato-seed + cfg.daysPerSeason.
  const tickSeedKey = useRaceDayKey ? raceDaySeedKey({ seasonId, gameDay: raceDay }) : null;
  return {
    lastSlotSettles: conditionPerDate && raceDay === dateDays.at(-1),
    tickSeedKey,
    seedScope: tickSeedKey ?? tickDate,
    // Loebsdagens plads blandt holdets loebsdage paa datoen (0-4), samme liste som
    // gitterets kolonner. Kalenderdags-ticket = slot 0 ("I dag").
    programSlot: useRaceDayKey ? programSlotForRaceDay(raceDay, dateGameDays) : 0,
  };
}

/** PURE: riders of the frozen roster that cannot train safely (released, retired, no opening state). */
export function unsafeDateRiderIds({ dateWork, riders }) {
  return dateWork.expected_rider_ids.filter(id=>{
    const rider=riders.find(row=>row.id===id);
    // #6439: a rider who changed team after the date opened stays in this frozen
    // roster (training follows the rider); only a released rider is unsafe here.
    return !(dateWork.quarantined_rider_ids??[]).includes(id)&&(!rider||rider.team_id==null||rider.is_retired===true||!dateWork.opening_conditions?.[id]);
  });
}

/** PURE: the riders this call may train: asked for, on the frozen roster, not quarantined. */
export function eligibleDateRiders({ riders, dateWork, eligibleRiderIds }) {
  const eligible=new Set(eligibleRiderIds??dateWork.expected_rider_ids);
  return riders.filter(rider=>eligible.has(rider.id)&&dateWork.expected_rider_ids.includes(rider.id)&&!(dateWork.quarantined_rider_ids??[]).includes(rider.id));
}

/** #7737: every bonus rider must also be stamped, or the press that chose the bonus did not finish. */
export function assertBonusPublished({ instantRiderIds, trainNowBonusRiderIds }) {
  if ([...trainNowBonusRiderIds].some(id => !instantRiderIds.has(id))) {
    throw new Error('Train-now bonus publication incomplete; retry the original press');
  }
}

/** PURE (#7737): before the deadline a rider with an open race slot waits, unless stamped and free on this race day. */
export function notWaitingRiders({ riders, instantRiderIds, unresolvedSlotsByRider, deadlineReached, raceDay }) {
  if (deadlineReached) return riders;
  return riders.filter(rider=>{
    const open=(unresolvedSlotsByRider instanceof Map ? unresolvedSlotsByRider.get(rider.id) : unresolvedSlotsByRider[rider.id]);
    if(!open?.length) return true;
    return instantRiderIds.has(rider.id)&&!open.some(slot=>slot?.gameDay==null||Number(slot.gameDay)===raceDay);
  });
}

/** PURE: a rider with a receipt for this race day already has it. */
export function untickedRiders({ riders, dateReceipts, raceDay }) {
  return riders.filter(rider=>!dateReceipts.some(receipt=>receipt.rider_id===rider.id&&receipt.game_day===raceDay));
}

/** The date's race-load ledger must belong to the open date. */
function assertRaceLoadsOpen(raceLoadRows, dateDays) {
  if (raceLoadRows.some(row => !dateDays.includes(row.game_day) || row.consumed_at != null)) {
    throw new Error('Race condition ledger does not match unsettled date');
  }
}

/**
 * Race-day axis: who is bound, who rode, and the profile they rode. Throws when the binding or the
 * stage lookup has no answer (a rule gate, never a guess); a missing profile falls back.
 */
export function raceDayFactsFrom({ teamId, raceDay, raceDayResult, boundRidersResult }) {
  // ── #4847: loebsdags-BINDINGEN (ejer-regel 2+3, 18/9) ───────────────────────
  // KASTER bevidst, i modsaetning til loebsdags-BERIGELSEN nedenfor. Bindingen
  // afgoer om rytteren overhovedet maa traene i dag; et gaet er enten traening oven
  // i et loeb (regel 2 brudt) eller en taget dag for hele truppen. Tick'et er
  // idempotent og sweepens dags-claim saettes kun ved `failed === 0`, saa den
  // rigtige adfaerd er at fejle holdet og lade naeste 5-min-tick proeve igen.
  // ASCII-only besked (#i18n-leak-guard): intern ops-fejl, ikke spiller-synlig.
  if (boundRidersResult.error) {
    throw new Error(
      `race-day binding load (team ${teamId}, game day ${raceDay}): ${boundRidersResult.error.message ?? boundRidersResult.error} - refusing to tick, retry on next sweep`,
    );
  }
  const boundRiderIds = boundRidersResult.data ?? new Set();
  // #4850 C2: etape-opslaget er en REGEL-GATE paa loebsdags-aksen (samme kontrakt
  // som bindingen ovenfor): svaret afgoer om rytteren maa traene i dag. Et gaet
  // ved fejl er enten traening oven i et loeb (regel 2 brudt) eller en taget dag.
  // Derfor kastes der, og naeste sweep proever igen. ASCII-only besked.
  if (raceDayResult.error) {
    throw new Error(
      `race-day stage lookup (team ${teamId}, game day ${raceDay}): ${raceDayResult.error.message ?? raceDayResult.error} - refusing to tick, retry on next sweep`,
    );
  }
  // Profilen er derimod en BERIGELSE: mangler den, traener loebsdagen 'rolling'.
  if (raceDayResult.profileError) {
    console.warn(`  ⚠️ race-stage-profile lookup failed for team ${teamId} (game day ${raceDay}): ${raceDayResult.profileError.message ?? raceDayResult.profileError} - falling back to '${RACE_DAY_FALLBACK_PROFILE}' (fail-safe)`);
  }
  // #3459 D2: rider_id → profil-type for dagens løb (fallback 'rolling', sat eksplicit her).
  const racedRiderIds = new Set();
  const racedRiderProfileByRider = new Map();
  for (const [riderId, stage] of raceDayResult.data ?? new Map()) {
    racedRiderIds.add(riderId);
    racedRiderProfileByRider.set(riderId, stage.profileType ?? RACE_DAY_FALLBACK_PROFILE);
  }
  return { boundRiderIds, racedRiderIds, racedRiderProfileByRider };
}

/** #6641 variant B + #5950: the manager's intention and role on the stage (fail-safe lookups). */
async function readRaceDayIntentions({ supabase, raceDayDevelopmentOn, raceRoleYield, raceDayResult, racedRiderIds }) {
  let raceDayEffortByRider = new Map();
  let raceDayRoleByRiderMap = new Map();
  // #6641 variant B: managerens intention for etapen skalerer loebsdagens udbytte (ingen intention = 1,0).
  if (raceDayDevelopmentOn && racedRiderIds.size > 0) {
    raceDayEffortByRider = await loadRaceDayEffortByRider({ supabase, stageByRider: raceDayResult.data });
  }
  if (raceDayDevelopmentOn && raceRoleYield && racedRiderIds.size > 0) raceDayRoleByRiderMap = await loadRaceDayRoleByRider({ supabase, stageByRider: raceDayResult.data }); // #5950
  return { raceDayEffortByRider, raceDayRoleByRiderMap };
}

/**
 * #5267 A (ejer-valg 28/9): hvem koerte en etape paa EN AF datoens loebsdage?
 * En bundet rytter med en etape paa datoen traener paa datoens frie loebsdage;
 * kun hele datoer uden etape i loebets spaend er hvile. Uden datoens liste
 * (dateGameDays null) forbliver bindingen hvile, som foer. Opslaget koeres kun
 * naar mindst én rytter er bundet uden at have koert paa loebsdagen, saa
 * aftensweepens kapacitet (G6) ikke betaler for hold uden etapeloeb.
 */
async function readStageOnDateRiderIds({ supabase, teamId, seasonId, raceDay, dateGameDays, useRaceDayKey, boundRiderIds, racedRiderIds }) {
  const boundNotRidden = [...boundRiderIds].filter((id) => !racedRiderIds.has(id));
  if (!(useRaceDayKey && boundNotRidden.length && Array.isArray(dateGameDays) && dateGameDays.length)) return new Set();
  const stageOnDateResult = await loadRiderIdsWithStageOnGameDays({
    supabase, teamId, seasonId, gameDays: dateGameDays, riderIds: boundNotRidden,
  });
  // Samme regel-gate som bindingen, saa samme kontrakt: ukendt svar kaster.
  if (stageOnDateResult.error) {
    throw new Error(
      `race-day stage-on-date lookup (team ${teamId}, game day ${raceDay}): ${stageOnDateResult.error.message ?? stageOnDateResult.error} - refusing to tick, retry on next sweep`,
    );
  }
  return stageOnDateResult.data ?? new Set();
}

/** #7982 trin 4a: every race lookup of one race day, in the order a day field makes them. */
async function readRaceDayFacts({ supabase, teamId, seasonId, raceDay, riderIds, dateGameDays, conditionPerDate, raceDayDevelopmentOn, raceRoleYield }) {
  const [raceDayResult, boundRidersResult] = await Promise.all([
    loadRaceDayStagesByRider({ supabase, teamId, seasonId, gameDay: raceDay, riderIds, withProfiles: raceDayDevelopmentOn }),
    loadBoundRiderIdsForRaceDay({ supabase, riderIds, seasonId, gameDay: raceDay, releaseDns: conditionPerDate }),
  ]);
  const facts = raceDayFactsFrom({ teamId, raceDay, raceDayResult, boundRidersResult });
  const intentions = await readRaceDayIntentions({ supabase, raceDayDevelopmentOn, raceRoleYield, raceDayResult, racedRiderIds: facts.racedRiderIds });
  const stageOnDateRiderIds = await readStageOnDateRiderIds({
    supabase, teamId, seasonId, raceDay, dateGameDays, useRaceDayKey: true, boundRiderIds: facts.boundRiderIds, racedRiderIds: facts.racedRiderIds,
  });
  return { raceDayResult, ...facts, ...intentions, stageOnDateRiderIds };
}

/**
 * ── #5462: udled `injured_until` af slut-LOEBSDAGEN ──────────────────────────
 * ÉT batch-opslag for hele holdets tick, efter loekken — ikke ét pr. skadet rytter.
 * Datoen er den foerste loebsdag >= slut-loebsdagen der rent faktisk har en etape
 * i divisionens kalender (en tom loebsdag har ingen raekke, CALENDAR_RULES §1e-b),
 * og derfor siger UI'et "ca. <dato>".
 *
 * FAIL-SAFE: svarer opslaget ikke (ingen division, tom kalender, DB-fejl), BLIVER
 * kalenderdagens fallback staaende paa `injured_until`. Skaden bliver altid skrevet;
 * loebsdags-felterne baerer stadig den praecise sandhed, og motorens egen
 * raskmelding laeser dem — kun gatens dato er saa et skoen.
 */
async function resolveConditionInjuryDates({ supabase, teamId, seasonId, useRaceDayKey, conditionUpserts }) {
  if (!useRaceDayKey) return;
  const needDates = conditionUpserts.filter((row) => row.injury_end_game_day != null);
  if (!needDates.length) return;
  const { divisionId, raceIds } = await loadInjuryCalendarRaces({ supabase, teamId, seasonId });
  const dateByGameDay = await resolveInjuryEndDates({
    supabase,
    seasonId,
    divisionId,
    endGameDays: needDates.map((row) => row.injury_end_game_day),
    raceIds,
  });
  for (const row of needDates) {
    const dateStr = dateByGameDay.get(row.injury_end_game_day) ?? null;
    if (dateStr) row.injured_until = dateStr;
  }
}

/**
 * #5462 + #7982 trin 4a: the team's division and that division's races for the injury calendar.
 * Asked with the same two queries as the race-day lookup (raceDayStageLookup.js, team row and
 * season races), so a press answers them from what it already read; the answer is the same as
 * loadTeamDivisionId plus the division's races. A team with youth divisions gets `raceIds: null`
 * (the race-day query also holds their races), and resolveInjuryEndDates reads them as before.
 * Fail-safe as before: without an answer the injury keeps its calendar-day date.
 */
async function loadInjuryCalendarRaces({ supabase, teamId, seasonId }) {
  let team = null;
  try {
    const { data, error } = await supabase
      .from("teams")
      .select("league_division_id, u23_league_division_id, junior_league_division_id")
      .eq("id", teamId).maybeSingle();
    if (!error) team = data ?? null;
  } catch {
    // best-effort: as loadTeamDivisionId, the division only serves the injury's approximate
    // date; without it the injury is still written with its calendar-day date.
    team = null;
  }
  const divisionId = team?.league_division_id ?? null;
  if (divisionId == null || team.u23_league_division_id != null || team.junior_league_division_id != null) {
    return { divisionId, raceIds: null };
  }
  try {
    const { data: races, error } = await supabase
      .from("races").select("id, race_type").eq("season_id", seasonId).in("league_division_id", [divisionId]);
    // As resolveInjuryEndDates: a failed races read means no calendar dates (empty list).
    return { divisionId, raceIds: error ? [] : (races ?? []).map((race) => race.id).filter(Boolean) };
  } catch (err) {
    // best-effort: same fallback as resolveInjuryEndDates when its own races read throws.
    console.warn(`  ⚠️ injury race-day calendar lookup threw (#5462, season ${seasonId}): ${err?.message ?? err} - injured_until falls back to calendar days`);
    return { divisionId, raceIds: [] };
  }
}

/**
 * #7982 trin 4a, "gem": the day field's one save on the date path (commit_training_date_tick),
 * the same for every path. The press then tells its memory what the database now holds.
 * A refusal or a held date is an error, as before: nothing is retried or guessed.
 */
async function commitTrainingDateTick({
  supabase, teamId, seasonId, squadKey, raceDay, tickDate, dateDays, executedBy, bonus, lastSlotSettles,
  deadlineReached, now, instantRiderIds, raceLoadRows, settlingRiderIds, tick, pressMemory = null,
}) {
  const { abilityUpdates, conditionUpserts, reportRiders, historyRows, raceDayHistoryRows, scoreRows } = tick;
  if(lastSlotSettles && raceLoadRows.some(load=>!instantRiderIds.has(load.rider_id)&&!conditionUpserts.some(condition=>condition.rider_id===load.rider_id))) {
    throw new Error('Date race loads include a rider without a condition settlement');
  }
  const report = { riders: reportRiders, bonus_applied: bonus, executed_by: executedBy,
    tick_date: tickDate, game_day: raceDay, date_game_days: dateDays, condition_per_date: true,
    condition_settled: lastSlotSettles };
  const args = {
    p_team_id: teamId, p_season_id: seasonId, p_squad: squadKey,
    p_game_day: raceDay, p_tick_date: tickDate, p_date_game_days: dateDays,
    p_executed_by: executedBy, p_report: report,
    p_abilities: abilityUpdates, p_conditions: conditionUpserts,
    p_history: historyRows, p_race_history: raceDayHistoryRows, p_scores: scoreRows,
    // #7737: with stamped riders in the batch, only the riders closing their date now.
    p_race_loads: instantRiderIds.size ? raceLoadRows.filter(load => settlingRiderIds.has(load.rider_id)) : lastSlotSettles ? raceLoadRows : [],
    p_deadline_reached:deadlineReached,p_now:now.toISOString(),
  };
  const { data, error } = await trainingDateRpc(supabase, 'commit_training_date_tick', args, executedBy === 'manager');
  if (error) throw new Error(`daily condition commit: ${error.message}`);
  if (data?.held === true) throw reservationHeldError(teamId, tickDate);
  pressMemory?.afterCommit({ args, data });
  // #7086: kun et tick der faktisk blev afregnet nu; kaster aldrig.
  if (data?.already_ran !== true) await notifyTrainingInjuries({ supabase, teamId, reportRiders, conditionUpserts, now });
  return { alreadyRan: data?.already_ran === true, tickDate, gameDay: raceDay, squad: squadKey, report:data?.report??report,workStatus:data?.work_status??null };
}

/**
 * #7982 trin 4a: which riders a later day field of the press trains, from what the press holds.
 * The same selection steps as a day field that reads (eligible, not waiting, no receipt yet).
 * Returns null when the press does not hold every rider this day field needs at every step, or
 * when a rider's condition or ledger has been saved since it was read: then the day field reads.
 */
export function planPressDay(selection, { raceDay, eligibleRiderIds, unresolvedSlotsByRider, deadlineReached, dirtyRiderIds = new Set() }) {
  const within = (rows, ids) => { const held = new Set(ids); return rows.every((row) => held.has(row.id)); };
  const { rosterRows, dateWork, eligibleIds, waitingIds, riderIds, instantRiderIds, trainNowBonusRiderIds, dateReceipts } = selection;
  // The frozen roster as a day field reads it again (a departed rider has left it).
  const roster = rosterRows.filter((row) => dateWork.expected_rider_ids.includes(row.id));
  if (unsafeDateRiderIds({ dateWork, riders: roster }).length) return null;
  const eligible = eligibleDateRiders({ riders: roster, dateWork, eligibleRiderIds });
  if (!within(eligible, eligibleIds)) return null;
  const ids = new Set(eligible.map((rider) => rider.id));
  const instant = new Set([...instantRiderIds].filter((id) => ids.has(id)));
  const bonus = new Set([...trainNowBonusRiderIds].filter((id) => ids.has(id)));
  assertBonusPublished({ instantRiderIds: instant, trainNowBonusRiderIds: bonus });
  const waiting = notWaitingRiders({ riders: eligible, instantRiderIds: instant, unresolvedSlotsByRider, deadlineReached, raceDay });
  if (!within(waiting, waitingIds)) return null;
  const waitingSet = new Set(waiting.map((rider) => rider.id));
  const receipts = dateReceipts.filter((row) => waitingSet.has(row.rider_id));
  const riders = untickedRiders({ riders: waiting, dateReceipts: receipts, raceDay });
  if (!riders.length || !within(riders, riderIds) || riders.some((rider) => dirtyRiderIds.has(rider.id))) return null;
  return { riders, dateWork, instantRiderIds: instant, trainNowBonusRiderIds: bonus, dateReceipts: receipts };
}

/**
 * #7982 trin 4a: before its first save the press sends the race lookups of its later race days,
 * all at once (they are in tables a press never writes). A day the press cannot plan from what
 * it holds is left out; that day field reads as before. Waits for every lookup; the first
 * failure, in race-day order, stops the press before anything is saved.
 */
async function prefetchPressRaceDays({
  supabase, teamId, seasonId, raceDay, dateGameDays, conditionPerDate, raceDayDevelopmentOn, raceRoleYield, pressRuns,
  selection, unresolvedSlotsByRider, deadlineReached,
}) {
  const later = [];
  for (const run of pressRuns ?? []) {
    const day = Number(run?.gameDay);
    if (!Number.isInteger(day) || day <= raceDay) continue;
    const plan = planPressDay(selection, { raceDay: day, eligibleRiderIds: run.riderIds, unresolvedSlotsByRider, deadlineReached });
    if (plan) later.push({ day, riderIds: plan.riders.map((rider) => rider.id) });
  }
  const facts = await readTogether(true, later.map(({ day, riderIds }) => () => readRaceDayFacts({
    supabase, teamId, seasonId, raceDay: day, riderIds, dateGameDays, conditionPerDate, raceDayDevelopmentOn, raceRoleYield,
  })));
  return new Map(later.map(({ day, riderIds }, i) => [day, { key: riderIds.join(","), facts: facts[i] }]));
}

/**
 * #7982 trin 4a: a later day field of the press. Fetch from the press's memory (and the race
 * lookups it fetched ahead, or the same lookups now if it could not), compute with the same
 * function as every other day field, save with the same function. Returns null, before any
 * database call, when the memory does not hold this day field; the caller then reads.
 */
async function runPressDayFromMemory({
  supabase, teamId, seasonId, seasonNumber, executedBy, now, gameDay, dateGameDays, tickDate, squadKey,
  eligibleRiderIds, unresolvedSlotsByRider, deadlineReached, instantPress, pressMemory, pressTimer,
}) {
  const held = pressMemory.dayInput();
  const raceDay = Number(gameDay);
  const dateDays = [...new Set(dateGameDays ?? [])].sort((a, b) => a - b);
  if (!held || held.teamId !== teamId || held.seasonId !== seasonId || held.seasonNumber !== seasonNumber
    || held.tickDate !== tickDate || held.executedBy !== executedBy || held.deadlineReached !== deadlineReached
    || held.instantPress !== instantPress || !Number.isInteger(raceDay) || !dateDays.includes(raceDay)
    || dateDays.join() !== held.dateDays.join()) return null;
  const plan = planPressDay(pressMemory.selection, { raceDay, eligibleRiderIds, unresolvedSlotsByRider, deadlineReached, dirtyRiderIds: pressMemory.dirtyRiderIds });
  if (!plan) return null;
  const frame = raceDayFrame({ useRaceDayKey: true, conditionPerDate: true, raceDay, dateDays, dateGameDays, seasonId, tickDate });
  const riderIds = plan.riders.map((rider) => rider.id);
  // #4854: "the day after a stage" is read on the date's first race day only; such a day reads.
  if (held.fatigueRules && frame.programSlot === 0 && held.fatigueRules.anyAfterStage(riderIds)) return null;
  const ids = new Set(riderIds);
  const raceLoadRows = held.raceLoadRows.filter((row) => ids.has(row.rider_id));
  assertRaceLoadsOpen(raceLoadRows, dateDays);
  const ahead = pressMemory.raceFacts.get(raceDay);
  const race = ahead?.key === riderIds.join(",") ? ahead.facts : await readRaceDayFacts({
    supabase, teamId, seasonId, raceDay, riderIds, dateGameDays, conditionPerDate: true,
    raceDayDevelopmentOn: held.raceDayDevelopmentOn, raceRoleYield: held.raceRoleYield,
  });
  const input = {
    ...held, ...frame, raceDay, now, unresolvedSlotsByRider,
    riders: plan.riders, dateWork: plan.dateWork, dateReceipts: plan.dateReceipts,
    instantRiderIds: plan.instantRiderIds, trainNowBonusRiderIds: plan.trainNowBonusRiderIds,
    abilityRows: held.abilityRows.filter((row) => ids.has(row.rider_id)),
    conditionRows: held.conditionRows.filter((row) => ids.has(row.rider_id)),
    raceLoadRows, canonicalLoadRows: canonicalRaceLoads(raceLoadRows),
    raceDayResult: race.raceDayResult, boundRiderIds: race.boundRiderIds, racedRiderIds: race.racedRiderIds,
    racedRiderProfileByRider: race.racedRiderProfileByRider, raceDayEffortByRider: race.raceDayEffortByRider,
    raceDayRoleByRiderMap: race.raceDayRoleByRiderMap, stageOnDateRiderIds: race.stageOnDateRiderIds,
    stageYesterdayRiderIds: new Set(),
  };
  pressTimer?.lap("load");
  const tick = computeTrainingDayTick(input);
  pressTimer?.lap("compute");
  await resolveConditionInjuryDates({ supabase, teamId, seasonId, useRaceDayKey: true, conditionUpserts: tick.conditionUpserts });
  const saved = await commitTrainingDateTick({
    supabase, teamId, seasonId, squadKey, raceDay, tickDate, dateDays, executedBy, bonus: input.bonus,
    lastSlotSettles: input.lastSlotSettles, deadlineReached, now, instantRiderIds: input.instantRiderIds,
    raceLoadRows, settlingRiderIds: tick.settlingRiderIds, tick, pressMemory,
  });
  pressTimer?.lap("save");
  return saved;
}

/**
 * Eksekvér ét dagligt trænings-tick for ét hold.
 *
 * @param {object}  args
 * @param {object}  args.supabase       — service-role client
 * @param {string}  args.teamId         — UUID på holdet
 * @param {string}  args.seasonId       — UUID på aktiv sæson
 * @param {number}  args.seasonNumber   — sæson-nummer (til alder + seed)
 * @param {string}  args.executedBy     — "manager" | "assistant"
 * @param {Date}    [args.now]          — referencetid (default new Date())
 * @param {number}  [args.gameDay]      — #4846: eksplicit loebsdag. SEAM til fase B4
 *   (udloeseren "loebsdagen lukker" kender selv dagen og skal ikke slaa den op igen).
 *   Udeladt + flag on ⇒ resolveTeamRaceDay. Ignoreret naar flaget er off.
 * @param {string}  [args.squad]        — #4847: hvilken loebsdags-akse ticket hoerer til
 *   ("senior" | "u23" | "junior"). Default "senior". Indgaar i mutexens noegle paa
 *   loebsdags-stien, saa #4620's tre akser pr. hold ikke kolliderer. Ignoreret naar
 *   flaget er off (den gamle noegle er (team_id, tick_date)).
 * @returns {Promise<{ alreadyRan: boolean, tickDate: string, gameDay: number|null, squad: string, report?: object }>}
 */
export async function runTeamTrainingDay({
  supabase, teamId, seasonId, seasonNumber, executedBy, now = new Date(), gameDay = null,
  squad = TRAINING_DAY_RUN_DEFAULT_SQUAD,
  // #4629: holdets loebsdage paa datoen (sweepens spaend / knappens gameDays).
  // Kun til programslottet; null ⇒ slot 0.
  dateGameDays = null,
  tickDateOverride = null, eligibleRiderIds = null, unresolvedSlotsByRider = {},
  deadlineAt = null, deadlineReached = false,
  // #7737: this call is a press with training_train_now_instant on (provisional condition).
  instantPress = false,
  // #7982 trin 3: only the train-now press sends its independent reads at once (readTogether).
  pressReads = false,
  // #7982 trin 4a: only the train-now press passes these. `pressMemory` is what the press
  // remembers between its day fields (trainNowPressMemory.js); `pressRuns` is its plan, so the
  // first day field can fetch the later race days' lookups at once; `pressTimer` times the parts.
  pressMemory = null, pressRuns = null, pressTimer = null,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!teamId) throw new Error("teamId required");
  if (!seasonId) throw new Error("seasonId required");
  if (!Number.isFinite(seasonNumber)) throw new Error("seasonNumber required");
  if (executedBy !== "manager" && executedBy !== "assistant") {
    throw new Error(`executedBy must be 'manager' or 'assistant', got: ${executedBy}`);
  }

  const tickDate = tickDateOverride ?? copenhagenDateString(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tickDate) || new Date(`${tickDate}T12:00:00Z`).toISOString().slice(0,10)!==tickDate) throw new Error('Valid logical training date required');
  const squadKey = typeof squad === "string" && squad.trim() ? squad.trim() : TRAINING_DAY_RUN_DEFAULT_SQUAD;
  // ── #4847: truppen er KLAR I NOEGLEN, men ikke i rytter-udvaelgelsen ─────────
  // Migrationen (database/2026-09-15-4847-*.sql) lader et hold have én raekke pr.
  // (saeson, trup, loebsdag), saa #4620's tre loebsdags-akser ikke kolliderer.
  // Rytter-queryet nedenfor vaelger derimod STADIG `team_id = X AND is_retired =
  // false` — der findes ingen trup-tilhoersforhold paa `riders` endnu.
  //
  // Et "u23"-tick ville derfor traene HELE truppen EN GANG TIL under en anden
  // noegle: dobbelt-kredit, ikke en U23-session. Motoren afviser derfor alt andet
  // end senior indtil #4620 tilfoejer et verificerbart trup-felt og dette query
  // filtrerer paa det. Noeglen er bygget foerst med vilje (skemaet skal ligge klar
  // foer cutover); grænsen her er det der goer den sikker at have liggende.
  if (squadKey !== TRAINING_DAY_RUN_DEFAULT_SQUAD) {
    throw new Error(
      `squad '${squadKey}' not supported yet: rider selection is not squad-scoped (see #4620). Only '${TRAINING_DAY_RUN_DEFAULT_SQUAD}' is accepted.`,
    );
  }

  // #7982 trin 4a: a later day field of the press is counted from what the press already
  // fetched (hent), with the same rules as every other day field (regn), and saved with the
  // same database function (gem). If the press does not hold everything this day field
  // needs, it is read below exactly as before.
  if (pressMemory?.ready) {
    const fromMemory = await runPressDayFromMemory({
      supabase, teamId, seasonId, seasonNumber, executedBy, now, gameDay, dateGameDays, tickDate, squadKey,
      eligibleRiderIds, unresolvedSlotsByRider, deadlineReached, instantPress, pressMemory, pressTimer,
    });
    if (fromMemory) return fromMemory;
  }
  // #7982 trin 4a: a press only remembers a fetch in which every read answered (watchReads).
  const readWatch = pressMemory ? watchReads(supabase) : null;
  if (readWatch) supabase = readWatch.client;

  // ── 0) #4846: hvilken noegle er mutexen i dag? ───────────────────────────────
  // Flaget SKAL laeses FOER reservationen, fordi noeglen ER laasen. `engineWrite`
  // fordi et cron-sweep ingen viewer har (featureStage.js' skrive-gate).
  //
  // Fail-safe-kaskade: flag off, hold uden division, eller en loebsdag der ikke kan
  // slaas op ⇒ `useRaceDayKey = false` ⇒ PRAECIS den gamle kalenderdags-sti. Et hold
  // stopper aldrig stille med at udvikle sig fordi kalenderen mangler et svar.
  const conditionDateFlagOn = await isTrainingConditionPerDateEnabled(supabase);
  const raceDayTickOn = conditionDateFlagOn || await isTrainingTickPerRaceDayEnabled(supabase, { engineWrite: true, strict: true });
  let raceDay = null;
  if (raceDayTickOn) {
    raceDay = Number.isFinite(gameDay)
      ? Number(gameDay)
      : (await resolveTeamRaceDay({ supabase, teamId, seasonId, now })).gameDay;
  }
  const useRaceDayKey = raceDayTickOn && Number.isFinite(raceDay);
  const conditionPerDate = useRaceDayKey && conditionDateFlagOn;
  let dateReceipts = [];
  let dateWork = null;
  let dateDays = [];
  if (conditionPerDate) dateDays = [...new Set(dateGameDays ?? [])].sort((a, b) => a - b);
  // #7982 trin 3: one group (readTogether); the evening run reads them one by one in this order.
  const [conditionModelV2On, raceDateTrainingDayOn, fatigueNowOn] = await readTogether(pressReads, [
  // #6984: v2 laeses kun naar dato-modellen ejer tilstanden (ellers ingen ekstra read).
  () => (conditionPerDate ? isConditionModelV2Enabled(supabase) : false),
  async (earlier) => ((await earlier(0)) ? isRaceDateTrainingDayEnabled(supabase) : false), // #7536
  // #7801: reglerne og skaderisikoen på trætheden lige nu. Kun under v2 (ellers ingen read).
  async (earlier) => ((await earlier(0)) ? isFatigueNow7801Enabled(supabase) : false),
  async () => {
  if(conditionPerDate && eligibleRiderIds==null) throw new Error('Normalized training requires an explicit ready-rider list');
  if (conditionPerDate) {
    if (dateDays.length !== 5 || !dateDays.every(Number.isInteger) || !dateDays.includes(raceDay)) {
      throw new Error('Daily condition requires the complete five-game-day date');
    }
    const { data: dateRuns, error } = await supabase.from('training_day_runs')
      .select('game_day, tick_date, report').eq('team_id', teamId).eq('season_id', seasonId)
      .eq('squad', squadKey).in('game_day', dateDays);
    if (error) throw new Error(`daily condition reports: ${error.message}`);
    if((dateRuns??[]).some(row=>row.report?.condition_per_date!==true)) throw new Error('Cannot switch condition cadence during a partially executed date');
  }
  },
  async () => {
  if (conditionPerDate) {
    // Full (team_id,season_id,tick_date) primary key: at most one row. Read as a
    // capped list so a second row can never be silently ignored.
    const {data:workRows,error:workError}=await supabase.from('training_date_work').select('*')
      .eq('team_id',teamId).eq('season_id',seasonId).eq('tick_date',tickDate).limit(2);
    if(workError) throw new Error(`training date work: ${workError.message}`);
    if((workRows??[]).length>1) throw new Error('training date work: duplicate primary key rows');
    dateWork=workRows?.[0] ?? null;
  }
  },
  ]);
  const { lastSlotSettles, tickSeedKey, seedScope, programSlot } = raceDayFrame({ useRaceDayKey, conditionPerDate, raceDay, dateDays, dateGameDays, seasonId, tickDate });
  // ── #4847 (ejer-beslutning 15/9, §13.3 beslutning 3): INGEN BONUS paa loebsdags-
  // stien. Den frivillige knap "Koer dagens traening nu" giver kun utaalmodighed, ikke
  // fordel — beslutning 2 (6/9) fjerner de 25 %. Bonussen lever videre PRAECIS saa
  // laenge den gamle kalenderdags-sti goer (flag off = bit-identisk med i dag); den
  // sidste rest af `bonusMult`/`bonus_applied` ryddes ved cutover, ikke her, fordi
  // #4847 skal kunne merges uden at aendre live-balance mens flaget er slukket.
  const bonus = executedBy === "manager" && !useRaceDayKey;
  // Loebsdags-stoej/skade-seed (A3) og den G1-kalibrerede budget-deler: se raceDayFrame.
  // #4847 punkt 5: deleren kalibreres mod det maal kalenderpakkeren faktisk pakker
  // efter (calendarRaceDayTargets.js' SEASON_RACE_DAY_TARGET, 140 fra S4) i stedet
  // for et duplikeret tal. Synkron siden #4846 (statisk import); await'en er harmloes.
  const budgetDivisor = useRaceDayKey
    ? await resolveRaceDayBudgetDivisor({ seasonNumber })
    : null;
  // #4801: "+1 pr. evne pr. dag" betyder pr. LOEBSDAG naar loebsdagen er tick-enheden.
  // Roret (hardDailyCap) har altid vaeret der, men blev aldrig sendt — reglen er ny.
  const hardDailyCap = useRaceDayKey ? TRAINING_RACE_DAY_CONFIG.abilityGainCapPerRaceDay : undefined;

  // Raekke-filter for de senere update/delete-kald: samme noegle som reservationen,
  // ellers ville en update paa (team_id, tick_date) ramme ALLE loebsdage samme dato.
  // #4847: truppen er en del af noeglen paa loebsdags-stien — uden den ville et
  // U23-tick's update ramme senior-raekken paa samme (team, season, game_day).
  const runRowFilter = (query) => (useRaceDayKey
    ? query.eq("team_id", teamId).eq("season_id", seasonId).eq("squad", squadKey).eq("game_day", raceDay)
    : query.eq("team_id", teamId).eq("tick_date", tickDate));

  // ── 1) Reservation: INSERT pending-row; 23505 → alreadyRan ───────────────────
  // #6759: kun den gamle sti baerer stadie + token (se headeren ved
  // STALE_LEGACY_RESERVATION_MS); loebsdags-stiens raekke er uaendret.
  const reservationToken = useRaceDayKey ? null : randomUUID();
  const reserve = () => supabase
    .from("training_day_runs")
    .insert({
      team_id: teamId,
      tick_date: tickDate,
      executed_by: executedBy,
      bonus_applied: bonus,
      report: useRaceDayKey
        ? { pending: true }
        : { pending: true, stage: LEGACY_RESERVATION_STAGE_LOADING, token: reservationToken },
      // Bart INSERT uden ON CONFLICT: det PARTIELLE unique-index paa
      // (team_id, season_id, game_day) WHERE game_day IS NOT NULL rejser 23505
      // praecis som tabel-constrainten gjorde. Udelades felterne, falder raekken
      // tilbage under (team_id, tick_date) WHERE game_day IS NULL.
      // #4847: `squad` sendes KUN paa loebsdags-stien. Den gamle sti lader kolonnens
      // DEFAULT 'senior' staa, saa raekken er bit-identisk med foer.
      ...(useRaceDayKey ? { season_id: seasonId, game_day: raceDay, squad: squadKey } : {}),
    });
  let { error: insertError } = conditionPerDate ? { error: null } : await reserve();
  // #6759: optaget noegle paa den gamle sti → er det en forældet "loading"-reservation,
  // slettes den betinget og der reserveres forfra (hoejst ét forsoeg).
  if (insertError?.code === "23505" && !useRaceDayKey
    && await resolveTakenLegacyReservation({ supabase, teamId, tickDate, now }) === "reclaimed") {
    ({ error: insertError } = await reserve());
    // Taber vi INSERT'et efter frigivelsen, ejer en samtidig koersel noeglen og er
    // maaske stadig i phase 1 — ikke "alreadyRan", men proev igen senere.
    if (insertError?.code === "23505") throw reservationHeldError(teamId, tickDate);
  }
  // #6827: paa loebsdags-stien kaster en holdt raekke; kun en afregnet giver alreadyRan.
  if (insertError?.code === "23505" && useRaceDayKey) {
    await assertRaceDayReservationSettled({ supabase, runRowFilter, teamId, tickDate, now });
  }

  if (insertError) {
    if (insertError.code === "23505") {
      return { alreadyRan: true, tickDate, gameDay: useRaceDayKey ? raceDay : null, squad: squadKey };
    }
    throw new Error(`training_day_runs insert: ${insertError.message}`);
  }

  // ── Phase 1: Loads + ren beregning (ingen writes) ────────────────────────────
  // Ved fejl her slettes reservationen, så holdet kan retrye samme dag.
  let abilityUpdates, conditionUpserts, reportRiders, historyRows, raceDayHistoryRows, scoreRows;
  let raceLoadRows = [];
  let canonicalLoadRows = [];
  // #7737: riders stamped by an instant press, and who closes his date on this tick.
  let instantRiderIds = new Set();
  let trainNowBonusRiderIds = new Set();
  let settlingRiderIds = new Set();
  // #7982 trin 4a: the date's roster rows and the riders left after each selection step.
  let rosterRows = [], eligibleIds = [], waitingIds = [];
  try {
  // ── 2) Load riders (ikke-pensionerede, dette hold) ──────────────────────────
  const riderColumns = "id, primary_type, secondary_type, potentiale, birthdate, firstname, lastname, team_id, is_academy, is_retired";
  const loadRiders = async (query) => {
    const {data,error}=await query;
    if (error) throw new Error(`riders load: ${error.message}`);
    if(conditionPerDate && data==null) throw new Error('Frozen training date requires a verified roster');
    return data ?? [];
  };
  // An opened date is read once, after registration (below). Only the opening
  // call needs the team's current roster to freeze it.
  let riders = dateWork
    ? []
    : await loadRiders(supabase.from("riders").select(riderColumns).eq('team_id',teamId).eq('is_retired',false));
  if(conditionPerDate) {
    const {data:work,error}=await trainingDateRpc(supabase, 'register_training_date_work',{
      p_team_id:teamId,p_season_id:seasonId,p_tick_date:tickDate,p_game_days:dateDays,
      p_expected_rider_ids:dateWork?.expected_rider_ids ?? riders.map(rider=>rider.id),p_deadline_at:deadlineAt,p_registered_at:now.toISOString(),
    }, executedBy === 'manager');
    if(error) throw new Error(`register training date: ${error.message}`);
    if(work?.held === true) throw reservationHeldError(teamId, tickDate);
    dateWork=work;
    // #7489: read the frozen roster again right before the check. The sweep calls
    // this once per race day of the date with the sweep's start time as `now`, so a
    // release minutes into the sweep shows up here as team_id null, stamped with
    // the earlier start time.
    // pagination-safe: én række pr. id i datoens frosne trup (ét holds trup, bounded af rostergrænsen)
    riders = await loadRiders(supabase.from("riders").select(riderColumns).in('id',dateWork.expected_rider_ids));
    rosterRows = riders;
    const unsafe=unsafeDateRiderIds({ dateWork, riders });
    // #7489: a rider released after the date opened has left the team. As in the
    // evening close (#6504), he is departed: he stays out of training, but he is
    // no reconciliation finding. The RPC re-checks team_id server-side; anyone it
    // does not accept, and every other unsafe rider, is quarantined as before.
    // Bank, frozen and test teams keep the alarm (#6504 contract). The sweep never
    // calls this with riders for a historical season (it quarantines them first).
    const leftTeam = unsafe.filter(id => riders.some(row => row.id === id && row.team_id == null));
    let departed = [];
    if (leftTeam.length) {
      const {data:teamRows,error:teamError}=await supabase.from('teams').select('id, is_bank, is_frozen, is_test_account').eq('id',teamId);
      if (teamError) throw new Error(`training date team load: ${teamError.message}`);
      const team = teamRows?.[0];
      if (team && !team.is_bank && !team.is_frozen && !team.is_test_account) {
        const {data:departure,error:departError}=await supabase.rpc('depart_training_date_riders',{p_team_id:teamId,p_season_id:seasonId,p_tick_date:tickDate,p_rider_ids:leftTeam,p_now:now.toISOString()});
        // Same fallback as trainingDateClose.js (TRAINING_RULES #6504): without the
        // function nobody is departed and the rider is quarantined as before.
        const missingRpc = departError?.code === 'PGRST202' || departError?.code === '42883';
        if (departError && !missingRpc) throw new Error(`depart released riders from training date: ${departError.message}`);
        departed = missingRpc ? [] : (departure?.departed_rider_ids ?? []);
        if (departed.length) dateWork = departure.work;
      }
    }
    const toQuarantine = unsafe.filter(id => !departed.includes(id));
    if(toQuarantine.length){
      const {data:quarantine,error:quarantineError}=await supabase.rpc('quarantine_training_date_riders',{p_team_id:teamId,p_season_id:seasonId,p_tick_date:tickDate,p_rider_ids:toQuarantine,p_reason:'unsafe_roster_or_missing_opening',p_now:now.toISOString()});
      if(quarantineError) throw new Error(`training date quarantine: ${quarantineError.message}`);
      dateWork=quarantine.work;
    }
    riders=eligibleDateRiders({ riders, dateWork, eligibleRiderIds });
    eligibleIds = riders.map(rider=>rider.id);
    [instantRiderIds, trainNowBonusRiderIds] = await readTogether(pressReads, [
      () => loadTrainNowInstantRiderIds({ supabase, tickDate, riderIds: riders.map(rider=>rider.id) }),
      () => loadTrainNowBonusRiderIds({ supabase, teamId, seasonId, tickDate, riderIds: riders.map(rider => rider.id) }),
    ]);
    assertBonusPublished({ instantRiderIds, trainNowBonusRiderIds });
    // #7737: a stamped rider only waits on the race day his open slot sits on.
    riders=notWaitingRiders({ riders, instantRiderIds, unresolvedSlotsByRider, deadlineReached, raceDay });
    waitingIds = riders.map(rider=>rider.id);
    const {data:receipts,error:receiptError}=await supabase.from('training_rider_ticks').select('*')
      .eq('season_id',seasonId).in('game_day',dateDays).in('rider_id',riders.map(rider=>rider.id));
    if(receiptError) throw new Error(`training rider receipts: ${receiptError.message}`);
    dateReceipts=receipts??[];
    riders=untickedRiders({ riders, dateReceipts, raceDay });
    if(!riders.length) return {alreadyRan:true,tickDate,gameDay:raceDay,squad:squadKey,report:{riders:[],condition_per_date:true,partial:dateWork.status!=='complete'}};
  }
  if (!riders || riders.length === 0) {
    const emptyReport = {
      riders: [], bonus_applied: bonus, executed_by: executedBy, tick_date: tickDate,
      game_day: useRaceDayKey ? raceDay : null,
    };
    if (conditionPerDate) {
      emptyReport.condition_per_date = true;
      emptyReport.condition_settled = lastSlotSettles;
      const { data, error } = await trainingDateRpc(supabase, 'commit_training_date_tick', {
        p_team_id: teamId, p_season_id: seasonId, p_squad: squadKey,
        p_game_day: raceDay, p_tick_date: tickDate, p_date_game_days: dateDays,
        p_executed_by: executedBy, p_report: emptyReport, p_abilities: [], p_conditions: [],
        p_history: [], p_race_history: [], p_scores: [],
      }, executedBy === 'manager');
      if (error) throw new Error(`daily condition commit: ${error.message}`);
      if (data?.held === true) throw reservationHeldError(teamId, tickDate);
    } else if (useRaceDayKey) await runRowFilter(supabase.from("training_day_runs").update({ report: emptyReport }));
    else {
      // #6759: samme ejerskabs-bevis som skiftet til "writing" (token), saa en
      // overtaget koersel aldrig overskriver den nye ejers raekke.
      const { data: written, error } = await runRowFilter(supabase.from("training_day_runs").update({ report: emptyReport }))
        .eq("report->>token", reservationToken).select("id");
      if (error) throw new Error(`training_day_runs empty report: ${error.message}`);
      if ((written ?? []).length !== 1) throw new Error("training_day_runs empty report: reservation no longer held");
    }
    return { alreadyRan: false, tickDate, gameDay: useRaceDayKey ? raceDay : null, squad: squadKey, report: emptyReport };
  }

  const riderIds = riders.map((r) => r.id);
  // #6210: datoens andre rapporter. Et kalenderdags-tick (game_day NULL, fx fail-
  // safe-faldet uden division) taeller altid med. Datoens andre loebsdage taeller
  // herfra kun uden dato-kvitteringer; med conditionPerDate er kilden kvitteringerne
  // (dateReceipts, rytter-noeglet), saa de ikke taelles to gange.
  // #6210: datoens tidligere gevinster. Opslaget er hold-scopet (indekset leder med team_id;
  // aftenafregningen kalder dette pr. hold pr. loebsdag, saa en scanning paa tvaers af hold er
  // for dyr, Codex P1 paa #7075). Et holdskifte samme dato daekkes paa live-stien af
  // dato-kvitteringerne (training_rider_ticks, rytter-noeglet, laest paa tvaers af hold).
  // Kalenderdags-stien (useRaceDayKey=false: rollback eller fallback) laeser ogsaa.
  let sameDateRunReports = [];
  // #7982 trin 3: one group (readTogether); the evening run reads them one by one in this order.
  const [capPerDateOn, , , [raceDayEngineOn, raceDayDevelopmentOn, developmentV2On, curveB]] = await readTogether(pressReads, [
  () => isAbilityCapPerDateEnabled(supabase, { strict: conditionPerDate }),
  async (earlier) => {
  if (await earlier(0)) {
    let query = supabase.from("training_day_runs").select("game_day, season_id, squad, report")
      .eq("team_id", teamId).eq("tick_date", tickDate);
    // Med dato-kvitteringer kommer loebsdagene derfra; kun kalenderdags-raekker her.
    if (conditionPerDate) query = query.is("game_day", null);
    const { data, error } = await query;
    if (error) throw new Error(`same-date training reports: ${error.message}`);
    const isThisRun = (row) => (useRaceDayKey
      ? Number(row.game_day) === raceDay && (row.squad ?? TRAINING_DAY_RUN_DEFAULT_SQUAD) === squadKey
      : row.game_day == null);
    sameDateRunReports = (data ?? []).filter((row) => !isThisRun(row) && (row.game_day == null
      || (!conditionPerDate && row.season_id === seasonId)))
      .flatMap((row) => row.report?.riders ?? []);
  }
  },
  async () => {
  if (conditionPerDate) {
    const { data, error } = await supabase.from('training_race_loads')
      // Full ledger records keep this reader compatible before the recovery
      // columns migrate, and retain every original/alias in the atomic receipt.
      .select('*')
      .eq('season_id', seasonId).eq('tick_date', tickDate).in('rider_id', riderIds);
    if (error) throw new Error(`race condition ledger load: ${error.message}`);
    raceLoadRows = data ?? [];
    canonicalLoadRows = canonicalRaceLoads(raceLoadRows);
    assertRaceLoadsOpen(raceLoadRows, dateDays);
  }
  },
  // #3459 D1 / #4277: flagene afgør om løbsdags-lookuppet overhovedet skal køre —
  // læst FØR batch-Promise.all'et så den betingede query kan indgå i samme batch
  // (kodemap-kravet: "i samme Promise.all som øvrige hold-inputs") uden at spilde
  // en query på en slukket feature.
  //
  // #4277: de to flag er UAFHÆNGIGE. `raceDayEngineOn` styrer nu KUN D3
  // (recovery-konstanterne nedenfor); D1+D2 — lookuppet, "race"-intensiteten og
  // udviklings-tick'et — hænger på `raceDayDevelopmentOn`. Læses parallelt: to
  // uafhængige app_config-opslag uden indbyrdes rækkefølge.
  // #3564: kurve B (development_curve_b + private params fra miljoeet). null =
  // dagens model, bit-identisk; ogsaa naar flaget er on men params mangler.
  () => Promise.all([
    conditionPerDate ? readConditionWriterFlag(supabase, 'race_day_engine_enabled') : isRaceDayEngineEnabled(supabase),
    conditionPerDate ? readConditionWriterFlag(supabase, 'race_day_development_enabled') : isRaceDayDevelopmentEnabled(supabase),
    isDevelopmentV2AgingEnabled(supabase, { strict: conditionPerDate }),
    loadDevelopmentCurveB({ supabase, strict: conditionPerDate }),
  ]),
  ]);
  // #7382: de første dage kurve B koerer, glider evner over det bloede loft ind i kurven.
  // Foerste gang kurven er aktiv: eet oejebliksbillede af alle managerhold + stempel (dagens dato); flag off = intet opslag.
  const curveBTransition = curveB
    ? curveBTransitionForDate({ ignitedOn: await ensureCurveBIgnition(supabase, { now, curveB, seasonNumber, isManagerTeam: isManagerTeamForDevelopment, strict: conditionPerDate }), tickDate })
    : null;
  // Hvem der er med, staar i oejebliksbilledet (en raekke pr. rytter); kun inde i vinduet.
  const curveBRoster = curveBTransition ? await loadCurveBTransitionRoster(supabase, { transition: curveBTransition, riderIds, strict: conditionPerDate }) : null;
  // #7982 trin 3: one group (readTogether) from here to the illness history. A read that
  // needs an earlier one awaits it; the evening run reads them one by one in this order.
  let developmentScoreB, raceCatchUp, raceRoleYield, developmentXp;
  let developmentAllowed = true;
  let abilityRows, planRows, conditionRows, weekPlanRow, raceDayResult;
  let boundRiderIds = new Set();
  let racedRiderIds = new Set();
  // #3459 D2: rider_id → profil-type for dagens løb (RACE_PROFILE_ABILITY_MAP-nøgle).
  // Fallback pr. rytter = 'rolling' (samme ukendt-profil-fallback som raceFatigueLoad)
  // — sat eksplicit nedenfor, IKKE først inde i applyRaceDevelopmentTick, så en
  // manglende race_stage_profiles-række aldrig kan give en udefineret evneliste.
  let racedRiderProfileByRider = new Map();
  let raceDayEffortByRider = new Map(); // #6641 variant B: rider_id -> managerens intention paa dagens etape
  let raceDayRoleByRiderMap = new Map(); // #5950: rider_id -> rolle paa dagens etape (tom = fri rolle)
  let programsOn = false, catalogV3On = false, stageOnDateRiderIds = new Set();
  let fatigueRules = null, stageYesterdayRiderIds = new Set();
  let trainingFacilityTier, trainingStaff, teamMedicalBonus = 0, illnessHistoryByRider = new Map();
  // #6938: sygdom af langvarig ekstrem traethed. Kun under condition_model_v2 OG naar
  // loebsmotoren koerer s5_profiles_v3 (taendes med v3). Ellers ingen read (bit-identisk).
  const illnessOn = conditionModelV2On && isS5ProfilesV3OrLater(CURRENT_RACE_RULES_REVISION);
  // #7982 trin 4a: only the press remembers its day fields, and only before its first save does
  // it fetch ahead (after a save, a read must stay where it was).
  const capturePress = Boolean(pressMemory && conditionPerDate && useRaceDayKey);
  const prefetchRaces = capturePress && pressReads && !pressMemory.committed && Array.isArray(pressRuns);
  let prefetchedRaceFacts = new Map();
  await readTogether(pressReads, [
  async () => {
  // #6950: Udviklingsscore B + catch-up via loeb. null = dagens model; kraever #7075's dato-loft.
  [developmentScoreB, raceCatchUp] = await Promise.all([
    loadDevelopmentScoreB({ supabase, strict: conditionPerDate, capPerDateOn }),
    loadRaceCatchUp({ supabase, strict: conditionPerDate, capPerDateOn }),
  ]);
  },
  async () => {
  // #5950: loebsdag = haard dag + rolle-vaegtet tillaeg. null = dagens loebsdag, bit-identisk.
  raceRoleYield = await loadRaceDayRoleYield({ supabase, strict: conditionPerDate });
  },
  async (earlier) => {
  await earlier(0);
  // #6110: XP-modellen for tick-datoen. null = dagens model, bit-identisk; kaster sammen med Score B/catch-up.
  developmentXp = await loadDevelopmentXp({ supabase, tickDate, strict: conditionPerDate, developmentScoreB, raceCatchUp, now: () => +now });

  // #6500: holdets raekke hentes ÉN gang, og kun naar flaget er taendt. Regel-gate,
  // ikke berigelse: et gaet ville enten give et AI-hold udvikling eller tage den
  // fra en manager. Derfor kastes der (reservationen slettes i catch'en nedenfor),
  // og naeste sweep proever igen. ASCII-only besked (intern ops-fejl).
  // #6950: D6 gaelder ogsaa naar Udviklingsscore B eller catch-up er taendt. #6110: og under XP.
  if (developmentV2On || developmentScoreB || raceCatchUp || developmentXp) {
    const { data: teamRow, error: teamError } = await supabase
      .from("teams")
      .select("id, user_id, is_ai, is_bank, is_test_account")
      .eq("id", teamId)
      .maybeSingle();
    if (teamError) throw new Error(`team load (team ${teamId}): ${teamError.message ?? teamError} - refusing to tick, retry on next sweep`);
    if (!teamRow) throw new Error(`team load (team ${teamId}): team row not found - refusing to tick`);
    developmentAllowed = isManagerTeamForDevelopment(teamRow);
  }
  },
  async (earlier) => {
  // ── 3) Load abilities, training plans + condition i parallell ─────────────────
  let abilityError, planError, conditionError, weekPlanError, boundRidersResult;
  [
    { data: abilityRows, error: abilityError },
    { data: planRows, error: planError },
    { data: conditionRows, error: conditionError },
    { data: weekPlanRow, error: weekPlanError },
    raceDayResult,
    boundRidersResult,
  ] = await Promise.all([
    supabase.from("rider_derived_abilities").select("*").in("rider_id", riderIds),
    supabase.from("training_plans")
      .select("rider_id, focus, intensity")
      .eq("team_id", teamId)
      .eq("season_id", seasonId),
    supabase.from("rider_condition").select("*").in("rider_id", riderIds),
    // #1895: holdets ugentlige rytme (rider_id IS NULL) OG pr-rytter-overrides
    // (rider_id sat) hentes i ÉT kald — begge lever i samme tabel, splittes i JS.
    // PR 1 hentede kun team-rowet; PR 2 tilføjer rytter-override-laget.
    supabase.from("training_week_plans")
      .select("rider_id, days")
      .eq("team_id", teamId),
    // #3459 D1 / #4277: kun query'et når UDVIKLINGS-flagget er on — off giver en
    // no-op-promise (bit-identisk med før #3459, ingen ekstra DB-kald). Bevidst
    // `raceDayDevelopmentOn`, ikke `raceDayEngineOn`: uden D2 har lookuppet ingen
    // aftager, og så er det ren spildt query pr. hold pr. dag.
    // #4847: ogsaa paa loebsdags-aksen, ikke kun naar UDVIKLINGEN er taendt.
    // Bindingen (nedenfor) siger hvem der er OPTAGET; dette siger hvem der
    // faktisk KOERTE. Forskellen er GT-hviledagen, og den skal vaere synlig paa
    // traeningsscoren ("loeb" vs. ingen raekke) uanset udviklings-flaget.
    //
    // #4850 C2: paa loebsdags-aksen er kilden det PRAECISE etape-opslag pr. loebsdag
    // (race_results ⋈ race_stage_schedule paa (race_id, stage_number) hvor game_day =
    // loebsdagen, raceDayStageLookup.js). Det kender ingen binding, saa et afsluttet
    // loeb (bindingen slettet af race_entry_days_rebuild) svarer stadig "koerte".
    // Profilen hentes kun naar udviklingen er taendt: uden den bruges maengden
    // udelukkende til at skelne "koerte" fra "hviledag". Den gamle kalenderdags-sti
    // beholder sit imported_at-opslag uroert.
    useRaceDayKey
      ? loadRaceDayStagesByRider({
        supabase, teamId, seasonId, gameDay: raceDay, riderIds, withProfiles: raceDayDevelopmentOn,
      })
      : raceDayDevelopmentOn
        ? loadRacedRiderIdsToday(supabase, riderIds, now, tickDate)
        : Promise.resolve({ data: [], error: null }),
    // #4847 (ejer-regel 2+3, 18/9): hvem er BUNDET paa denne loebsdag? Kun paa
    // loebsdags-aksen — den gamle kalenderdags-sti har ingen loebsdag at binde paa
    // og er bit-identisk med i dag (ingen ekstra DB-kald naar flaget er off).
    useRaceDayKey
        ? loadBoundRiderIdsForRaceDay({ supabase, riderIds, seasonId, gameDay: raceDay, releaseDns: conditionPerDate })
      : Promise.resolve({ data: null, error: null }),
  ]);
  await earlier(1); // the role read below needs raceRoleYield

  if (abilityError) throw new Error(`abilities load: ${abilityError.message}`);
  if (planError) throw new Error(`plans load: ${planError.message}`);
  if (conditionError) throw new Error(`condition load: ${conditionError.message}`);
  if (weekPlanError) throw new Error(`week plan load: ${weekPlanError.message}`);

  // #4847/#4850 C2: binding and stage lookup on the race-day axis (raceDayFactsFrom), then
  // the manager's intention and role on the stage (readRaceDayIntentions).
  if (useRaceDayKey) {
    ({ boundRiderIds, racedRiderIds, racedRiderProfileByRider } = raceDayFactsFrom({ teamId, raceDay, raceDayResult, boundRidersResult }));
    ({ raceDayEffortByRider, raceDayRoleByRiderMap } = await readRaceDayIntentions({ supabase, raceDayDevelopmentOn, raceRoleYield, raceDayResult, racedRiderIds }));
  } else {
  // Tom mængde paa den gamle sti — ingen loebsdag, ingen binding.
  boundRiderIds = boundRidersResult.data ?? new Set();
  // #3459 D1 fail-safe: query-fejl → tom mængde (INGEN løbsdag antaget), log warning.
  // Kaster ALDRIG — en fejlet best-effort-berigelse må ikke vælte hele holdets
  // trænings-dag (samme filosofi som Plan B's facilitets-load, #1441).
  if (raceDayDevelopmentOn) {
    if (raceDayResult.error) {
      // ASCII-only besked (#i18n-leak-guard, BACKEND_CONTEXT matcher error/message-linjer med
      // æ/ø/å) — dette er intern ops-logging, ikke en spiller-synlig API-fejl.
      console.warn(`  ⚠️ race-day lookup failed for team ${teamId} (${tickDate}): ${raceDayResult.error.message} - assuming no race day (fail-safe)`);
    } else {
      const racedRows = raceDayResult.data ?? [];
      racedRiderIds = new Set(racedRows.map((r) => r.rider_id));

      // #3459 D2: hent profil-typen for de racede etaper — kun de race_id'er der
      // rent faktisk optræder i dagens racede rækker (typisk 0-1 pr. hold pr. dag).
      // #4847: KUN naar udviklingen er taendt. Profil-typen har én aftager,
      // applyRaceDevelopmentTick; er udviklingen slukket, bruger vi mængden
      // udelukkende til at skelne "koerte" fra "hviledag", og saa er opslaget
      // spildt arbejde pr. hold pr. tick.
      const raceIds = raceDayDevelopmentOn
        ? [...new Set(racedRows.map((r) => r.race_id).filter(Boolean))]
        : [];
      const stageProfilesResult = raceIds.length
        ? await loadRaceStageProfiles(supabase, raceIds)
        : { data: [], error: null };
      const profileByRaceStage = new Map();
      if (stageProfilesResult.error) {
        console.warn(`  ⚠️ race-stage-profile lookup failed for team ${teamId} (${tickDate}): ${stageProfilesResult.error.message} - falling back to 'rolling' (fail-safe)`);
      } else {
        for (const row of stageProfilesResult.data ?? []) {
          profileByRaceStage.set(`${row.race_id}:${row.stage_number}`, row.profile_type);
        }
      }
      for (const row of racedRows) {
        const key = `${row.race_id}:${row.stage_number}`;
        racedRiderProfileByRider.set(row.rider_id, profileByRaceStage.get(key) ?? "rolling");
      }
      // #5950: samme rolle-opslag som loebsdags-stien, bygget af dagens racede raekker
      // (sidste raekke vinder, som profilen ovenfor). Kun naar tillaegget er aktivt:
      // slukket = intet ekstra opslag, bit-identisk.
      if (raceRoleYield && racedRows.length > 0) {
        const stageByRider = new Map();
        for (const row of racedRows) {
          if (row.race_id) stageByRider.set(row.rider_id, { raceId: row.race_id, stageNumber: row.stage_number });
        }
        raceDayRoleByRiderMap = await loadRaceDayRoleByRider({ supabase, stageByRider });
      }
    }
  }
  }
  // #4629: programcellerne laeses KUN naar holdet har programdata OG flaget er
  // on for holdet (beta: holdets ejer er beta-tester). Uden programdata er der
  // intet ekstra opslag, og stien er bit-identisk med foer.
  programsOn = (Array.isArray(weekPlanRow) ? weekPlanRow : []).some((r) => weekDaysHaveSessions(r.days))
    ? await isTrainingCellsEnabledForTeam(supabase, teamId)
    : false;
  },
  async () => {
  // #5319: traeningskatalog v3 (beta: holdets ejer er beta-tester). Off = programmet uroert.
  catalogV3On = await isTrainingCatalogV3EnabledForTeam(supabase, teamId);
  },
  async (earlier) => {
  await earlier(3);
  // #5267 A: who rode a stage on one of the date's race days (readStageOnDateRiderIds).
  stageOnDateRiderIds = await readStageOnDateRiderIds({ supabase, teamId, seasonId, raceDay, dateGameDays, useRaceDayKey, boundRiderIds, racedRiderIds });
  },
  async () => {
  // #4854/#5620: spillerens EGNE regler (traethedsgraense + dagen efter en etape).
  // Al logik bor i trainingFatigueRules.ts; hold uden regler = null = uaendret sti.
  fatigueRules = await loadTeamFatigueRules(supabase, teamId);
  stageYesterdayRiderIds = fatigueRules && programSlot === 0 && fatigueRules.anyAfterStage(riderIds)
    ? await loadRiderIdsWithStageOnDate(supabase, { riderIds, previousDate: previousDateString(tickDate) })
    : new Set();
  },
  async (earlier) => {
  // The staff and facility reads tolerate a lasting failure (warning + Sentry). They start
  // only when every read before them has answered, so they run exactly when they ran before.
  await Promise.all([0, 1, 2, 3, 4, 5, 6].map(earlier));
  // ── 3b) Plan B (#1441): trænings-facilitet + chef (én load pr. hold pr. dag) ──
  // Data-drevet: hold uden faciliteter/chef → { 0, null } → multiplikator præcis 1.0
  // (nul regression). Vedvarende fejl: neutral i loaderen. #6596: forbigaaende fejl
  // KASTER, saa catch'en nedenfor sletter reservationen og naeste sweep proever igen.
  ({ facilityTier: trainingFacilityTier, staff: trainingStaff } =
    await loadTrainingStaffContext(supabase, teamId, { retryOnTransient: true }));
  },
  async (earlier) => {
  await earlier(7); // same reader as the staff context, so it also waits for it
  // #6984 M1-M3: medicinsk afdeling, kun under condition_model_v2 (ellers ingen read).
  teamMedicalBonus = conditionModelV2On ? await loadTeamMedicalBonus(supabase, teamId, { retryOnTransient: true }) : 0;
  },
  async () => {
  illnessHistoryByRider = illnessOn ? await loadIllnessFatigueHistory(supabase, riders.map((r) => r.id), tickDate) : new Map();
  },
  // #7982 trin 4a: the press's first day field also sends the race lookups of the date's later
  // race days, all at once. They are in tables a press never writes, so they may move ahead of
  // the first save; they are the same lookups those day fields made before. Last in the list:
  // a failed read of this day field is still the one that is thrown.
  ...(prefetchRaces ? [async (earlier) => {
    await earlier(1); // the role lookup needs raceRoleYield
    prefetchedRaceFacts = await prefetchPressRaceDays({
      supabase, teamId, seasonId, raceDay, dateGameDays, conditionPerDate, raceDayDevelopmentOn, raceRoleYield, pressRuns,
      selection: { rosterRows, dateWork, eligibleIds, waitingIds, riderIds, instantRiderIds, trainNowBonusRiderIds, dateReceipts },
      unresolvedSlotsByRider, deadlineReached,
    });
  }] : []),
  ]);

  // #7982 trin 4a, "regn": the day field is counted by computeTrainingDayTick, the same
  // function for the evening run, plain training and every day field of the press.
  const dayInput = {
    teamId, seasonId, seasonNumber, tickDate, now, raceDay, dateDays, useRaceDayKey, conditionPerDate,
    lastSlotSettles, bonus, tickSeedKey, seedScope, budgetDivisor, hardDailyCap, programSlot, riders, dateWork,
    dateReceipts, instantRiderIds, trainNowBonusRiderIds, unresolvedSlotsByRider, deadlineReached,
    instantPress, sameDateRunReports, raceLoadRows, canonicalLoadRows, conditionModelV2On,
    raceDateTrainingDayOn, fatigueNowOn, capPerDateOn, raceDayEngineOn, raceDayDevelopmentOn, curveB,
    curveBRoster, developmentScoreB, raceCatchUp, raceRoleYield, developmentXp, developmentAllowed,
    abilityRows, planRows, conditionRows, weekPlanRow, raceDayResult, boundRiderIds, racedRiderIds,
    racedRiderProfileByRider, raceDayEffortByRider, raceDayRoleByRiderMap, programsOn, catalogV3On,
    stageOnDateRiderIds, fatigueRules, stageYesterdayRiderIds, trainingFacilityTier, trainingStaff,
    teamMedicalBonus, illnessOn, illnessHistoryByRider,
    // Not read by computeTrainingDayTick; the press checks a later day field is the same call.
    executedBy,
  };
  if (capturePress && !readWatch.failed) {
    pressMemory.capture({ input: dayInput, selection: { rosterRows, dateWork, eligibleIds, waitingIds, riderIds, instantRiderIds, trainNowBonusRiderIds, dateReceipts }, raceFacts: prefetchedRaceFacts });
  } else pressMemory?.forget();
  pressTimer?.lap("load");
  ({ abilityUpdates, conditionUpserts, reportRiders, historyRows, raceDayHistoryRows, scoreRows, settlingRiderIds } = computeTrainingDayTick(dayInput));
  pressTimer?.lap("compute");

  // #5462: `injured_until` from the injury's last race day (resolveConditionInjuryDates).
  await resolveConditionInjuryDates({ supabase, teamId, seasonId, useRaceDayKey, conditionUpserts });

  // #6759: sidste skridt foer writes paa den gamle sti — reservationen skifter til
  // "writing" og kan derefter aldrig overtages som forældet. Token-filteret beviser
  // at vi stadig ejer den; fejler skiftet, er intet skrevet, og catch'en rydder op.
  if (!useRaceDayKey) {
    const { data: marked, error: markError } = await supabase.from("training_day_runs")
      .update({ report: { pending: true, stage: LEGACY_RESERVATION_STAGE_WRITING, token: reservationToken } })
      .eq("team_id", teamId).eq("tick_date", tickDate).eq("report->>token", reservationToken)
      .select("id");
    if (markError) throw new Error(`training_day_runs write stage: ${markError.message}`);
    if ((marked ?? []).length !== 1) throw new Error("training_day_runs write stage: reservation no longer held");
  }

  } catch (phase1Err) {
    // Load/beregnings-fejl: slet reservationen så holdet kan retrye samme dag.
    // #6596 (Codex-fund): under samme nedbrud kan sletningen også fejle, og en
    // efterladt pending-række ville give alreadyRan resten af dagen. Derfor
    // tjekkes svaret og prøves igen; lykkes det stadig ikke, meldes det højt, og
    // #6759 frigiver den forældede "loading"-raekke ved en senere koersel.
    // Paa den gamle sti slettes kun VORES reservation (token), aldrig en overtagers.
    if (!conditionPerDate) {
      let cleanupError = null;
      const ownRow = (query) => (useRaceDayKey ? runRowFilter(query) : runRowFilter(query).eq("report->>token", reservationToken));
      for (let attempt = 1; attempt <= RESERVATION_CLEANUP_ATTEMPTS; attempt += 1) {
        try {
          const { error } = await ownRow(supabase.from("training_day_runs").delete());
          cleanupError = error ?? null;
        } catch (err) {
          cleanupError = err;
        }
        if (!cleanupError) break;
        if (attempt < RESERVATION_CLEANUP_ATTEMPTS) await sleep(RESERVATION_CLEANUP_BACKOFF_MS * attempt);
      }
      if (cleanupError) {
        console.error(`  ⚠️ training_day_runs reservation cleanup failed for team ${teamId} (${tickDate}): ${cleanupError?.message ?? cleanupError}`);
        captureException(cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError?.message ?? cleanupError)), {
          tags: { lib: "dailyTrainingEngine", step: "reservation_cleanup" },
          extra: { teamId, tickDate, originalError: phase1Err?.message ?? String(phase1Err) },
        });
      }
    }
    throw phase1Err;
  }

  // ── Phase 2: Writes ───────────────────────────────────────────────────────────
  if (conditionPerDate) {
    // #7982 trin 4a, "gem": the same save for every path (commitTrainingDateTick).
    const saved = await commitTrainingDateTick({
      supabase, teamId, seasonId, squadKey, raceDay, tickDate, dateDays, executedBy, bonus, lastSlotSettles,
      deadlineReached, now, instantRiderIds, raceLoadRows, settlingRiderIds,
      tick: { abilityUpdates, conditionUpserts, reportRiders, historyRows, raceDayHistoryRows, scoreRows },
      pressMemory,
    });
    pressTimer?.lap("save");
    return saved;
  }
  // Fra dette punkt er writes i gang: ved fejl bevares reservationen BEVIDST (blokeret dag er
  // sikrere end dobbelt-tick efter delvise ability-writes). Manuel recovery: slet rækken.
  // #6759: raekken staar her som stage "writing" og frigives derfor aldrig automatisk.

  // ── 5) Persistér ─────────────────────────────────────────────────────────────
  // Ability-updates (gains + progress + evt. caps).
  await runBatched(abilityUpdates, 25, ({ riderId, patch }) =>
    supabase.from("rider_derived_abilities")
      .update(patch)
      .eq("rider_id", riderId)
      .then(({ error }) => {
        if (error) throw new Error(`abilities update ${riderId}: ${error.message}`);
      }));

  // #2000 Udvikling-fane: best-effort historik-snapshot EFTER abilities er persisteret.
  // En fejl her må ALDRIG kaste/rulle træningsdagen tilbage (afledt visning, ikke
  // spil-state) → fang + log. Idempotent via UNIQUE(rider_id,snapshot_date,source).
  if (historyRows.length > 0) {
    try {
      for (let i = 0; i < historyRows.length; i += 500) {
        const { error } = await supabase
          .from("rider_derived_ability_history")
          .upsert(historyRows.slice(i, i + 500), { onConflict: "rider_id,snapshot_date,source", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }
    } catch (histErr) {
      console.error(`  ⚠️ ability-history snapshot (daily) fejlede for hold ${teamId}:`, histErr.message);
    }
  }

  // #4846: loebsdags-snapshottet. Samme best-effort-kontrakt som ovenfor — en fejl
  // her maa ALDRIG kaste (afledt visning, ikke spil-state). Idempotent via
  // UNIQUE(rider_id, season_id, game_day, source).
  if (raceDayHistoryRows.length > 0) {
    try {
      for (let i = 0; i < raceDayHistoryRows.length; i += 500) {
        const { error } = await supabase
          .from("rider_ability_race_day_history")
          .upsert(raceDayHistoryRows.slice(i, i + 500), {
            onConflict: "rider_id,season_id,game_day,source", ignoreDuplicates: true,
          });
        if (error) throw new Error(error.message);
      }
    } catch (histErr) {
      // best-effort: loebsdags-snapshottet er AFLEDT visning, ikke spil-state. Et
      // kast her ville vaelte en traeningsdag hvis evne-writes allerede er landet
      // (Phase 2 bevarer reservationen med vilje) — samme kontrakt som
      // kalenderdags-historikken ovenfor. Fejlen logges, dagen staar.
      console.error(`  ⚠️ ability-history snapshot (race day) fejlede for hold ${teamId}:`, histErr.message);
    }
  }

  // #4851: traeningsscoren. Samme best-effort-kontrakt som historik-snapshottene
  // ovenfor — scoren er AFLEDT visning (+ en kvittering paa dagens kvalitet),
  // ikke spil-state, og et kast her ville vaelte en traeningsdag hvis
  // evne-writes allerede er landet. Bart INSERT: de to partielle unikke indexe
  // (database/2026-09-15-4851-rider-training-scores.sql) rejser 23505 hvis
  // raekken allerede findes, og en gentagelse er praecis det
  // training_day_runs-reservationen i forvejen forhindrer.
  if (scoreRows.length > 0) {
    try {
      for (let i = 0; i < scoreRows.length; i += 500) {
        const batch = scoreRows.slice(i, i + 500);
        const { error } = await supabase.from("rider_training_scores").insert(batch);
        if (!error) continue;
        if (error.code !== "23505") throw new Error(error.message);
        // 23505 paa et MULTI-row INSERT afbryder HELE saetningen: de raekker der
        // IKKE var dubletter ville gaa tavst tabt hvis vi bare gik videre. Det
        // kan ske selv med training_day_runs-reservationen, fordi score-noeglen
        // ikke indeholder team_id — en rytter der er skiftet hold beholder sine
        // gamle raekker. Vi falder derfor tilbage til raekke-for-raekke og
        // sluger kun den enkelte dublet.
        for (const row of batch) {
          const { error: rowError } = await supabase.from("rider_training_scores").insert(row);
          if (rowError && rowError.code !== "23505") throw new Error(rowError.message);
        }
      }
    } catch (scoreErr) {
      // best-effort: scoren er AFLEDT visning (+ en kvittering paa dagens
      // kvalitet), ikke spil-state. Et kast her ville vaelte en traeningsdag
      // hvis evne-writes allerede er landet (Phase 2 bevarer reservationen med
      // vilje) — samme kontrakt som historik-snapshottene ovenfor. Fejlen
      // logges, dagen staar, og naeste tick skriver videre.
      console.error(`  ⚠️ training-score write fejlede for hold ${teamId}:`, scoreErr.message);
    }
  }

  // Condition upserts.
  if (conditionUpserts.length) {
    for (let i = 0; i < conditionUpserts.length; i += 500) {
      const { error } = await supabase
        .from("rider_condition")
        .upsert(conditionUpserts.slice(i, i + 500), { onConflict: "rider_id" });
      if (error) throw new Error(`condition upsert: ${error.message}`);
    }
  }

  // Opdatér training_day_runs-row med det rigtige rapport-indhold.
  const report = {
    riders: reportRiders,
    bonus_applied: bonus,
    executed_by: executedBy,
    tick_date: tickDate,
    game_day: useRaceDayKey ? raceDay : null,
  };
  const { error: updateError } = await runRowFilter(
    supabase.from("training_day_runs").update({ report }),
  );
  if (updateError) throw new Error(`training_day_runs update: ${updateError.message}`);

  // #7086: efter writes; en genkørsel returnerede alreadyRan ved reservationen. Kaster aldrig.
  await notifyTrainingInjuries({ supabase, teamId, reportRiders, conditionUpserts, now });
  return { alreadyRan: false, tickDate, gameDay: useRaceDayKey ? raceDay : null, squad: squadKey, report };
}

/**
 * #7982 trin 4a, "regn": one day field for one team, counted from what was fetched. PURE: no
 * database call. The evening run, plain training and every day field of the press call this same
 * function; the only difference between them is where `input` comes from (a read, or the press's
 * memory of what it read and saved). Same rules, same order, same output as before the move.
 * @param {object} input
 */
export function computeTrainingDayTick(input) {
  const {
    teamId, seasonId, seasonNumber, tickDate, now, raceDay, dateDays, useRaceDayKey, conditionPerDate,
    lastSlotSettles, bonus, tickSeedKey, seedScope, budgetDivisor, hardDailyCap, programSlot, riders, dateWork,
    dateReceipts, instantRiderIds, trainNowBonusRiderIds, unresolvedSlotsByRider, deadlineReached,
    instantPress, sameDateRunReports, raceLoadRows, canonicalLoadRows, conditionModelV2On,
    raceDateTrainingDayOn, fatigueNowOn, capPerDateOn, raceDayEngineOn, raceDayDevelopmentOn, curveB,
    curveBRoster, developmentScoreB, raceCatchUp, raceRoleYield, developmentXp, developmentAllowed,
    abilityRows, planRows, conditionRows, weekPlanRow, raceDayResult, boundRiderIds, racedRiderIds,
    racedRiderProfileByRider, raceDayEffortByRider, raceDayRoleByRiderMap, programsOn, catalogV3On,
    stageOnDateRiderIds, fatigueRules, stageYesterdayRiderIds, trainingFacilityTier, trainingStaff,
    teamMedicalBonus, illnessOn, illnessHistoryByRider,
  } = input;
  const settlingRiderIds = new Set();
  const abilityByRider = new Map((abilityRows ?? []).map((a) => [a.rider_id, a]));
  const planByRider = new Map((planRows ?? []).map((p) => [p.rider_id, p]));
  const condByRider = new Map((conditionRows ?? []).map((c) => [c.rider_id, c]));
  const weekPlanRows = Array.isArray(weekPlanRow) ? weekPlanRow : [];
  const teamWeekDays = weekPlanRows.find((r) => r.rider_id == null)?.days ?? null;
  // #1895 PR 2: rytter-override-rows → Map(rider_id → days). Rider-override vinder
  // over holdrytmen i resolveDayIntensity (se training.js).
  const riderOverrideByRider = new Map(
    weekPlanRows.filter((r) => r.rider_id != null).map((r) => [r.rider_id, r.days]),
  );
  const weekday = copenhagenWeekdayKey(tickDate);

  // ── 4) Tick pr. rytter ────────────────────────────────────────────────────────
  const abilityUpdates = []; // { riderId, patch }
  const conditionUpserts = []; // { rider_id, form, fatigue, injured_until, injury_cause, updated_at }
  const reportRiders = [];
  const historyRows = []; // { rider_id, snapshot_date, source, season_number, abilities } — #2000 Udvikling-fane
  // #4846: soester-raekker paa loebsdags-aksen. Tom naar flaget er off.
  const raceDayHistoryRows = [];
  // #4851: traeningsscoren pr. rytter pr. pas. Skrives UANSET
  // training_score_visible — flaget gater kun visningen, og uden historik ville
  // den foerste sparkline vaere ét punkt den dag flaget taendes.
  const scoreRows = [];

  for (const rider of riders) {
    // #7737: a stamped rider fills his race days out of order, so his date reports are
    // whatever is already on the date, and he closes it on his last missing race day.
    const instantRider=conditionPerDate&&instantRiderIds.has(rider.id);
    const dateReceiptOn=(day)=>dateReceipts.find(row=>row.rider_id===rider.id&&row.game_day===day);
    const priorDateReports=conditionPerDate ? (instantRider ? dateDays.filter(day=>day!==raceDay&&dateReceiptOn(day)).map(day=>{
      if(dateReceiptOn(day).tick_date!==tickDate) throw new Error('Daily condition receipt belongs to another date');
      return dateReceiptOn(day).report;
    }) : dateDays.filter(day=>day<raceDay).map(day=>{
      const receipt=dateReceipts.find(row=>row.rider_id===rider.id&&row.game_day===day);
      if(!receipt||receipt.tick_date!==tickDate) throw new Error('Daily condition requires completed earlier game days in order for each rider');
      return receipt.report;
    })) : [];
    const settlesCondition=instantRider ? priorDateReports.length===dateDays.length-1 : lastSlotSettles;
    // #7737: his date closes on the race day the evening run would have closed it on, so
    // the injury horizon and the seeds do not depend on when he pressed (I1).
    const settleGameDay=instantRider ? dateDays.at(-1) : raceDay;
    const abRow = abilityByRider.get(rider.id);
    if (!abRow) {
      // Ingen abilities-række: spring over stille (spec: same guard as L0).
      continue;
    }

    const age = ageForSeason(rider.birthdate, seasonNumber);
    const cond = condByRider.get(rider.id) ?? { ...NEW_RIDER_START_CONDITION, injured_until: null, injury_cause: null };
    const conditionBeforeDate = conditionPerDate
      ? dateWork.opening_conditions[rider.id]
      : { ...cond, form: Number(cond.form ?? NEW_RIDER_START_CONDITION.form), fatigue: Number(cond.fatigue ?? NEW_RIDER_START_CONDITION.fatigue) };
    if (conditionPerDate && !conditionBeforeDate) throw new Error('Daily condition roster changed during settlement');
    const plan = planByRider.get(rider.id) ?? null;
    const program = resolveProgram(plan, rider.primary_type);
    // #1895/#2438: lagdelt ugerytme-opløsning — rører KUN intensitet, aldrig
    // program.focus. Prioritet: rytterens EGEN pr-dag-override (individuel
    // ugeplan) > rytterens EGEN eksplicitte plan (training_plans, hasExplicitPlan)
    // > holdets ugerytme (kun DEFAULT for ryttere uden egen override) >
    // sæson-intensiteten (resolveDayIntensity). #2438 — ejerens præcedens: en
    // individuel rytter-indstilling overtrumfer den ugentlige rutine.
    const hasExplicitPlan = !!(plan?.focus && plan?.intensity);
    // #5319: uden gemt plan er fokus assistentens; under v3 træner tt/gc dér itt_long, ikke Tærskel.
    if (!hasExplicitPlan) program.focus = v3SmartDefaultFocus(program.focus, rider, { v3: catalogV3On });
    // #4629: med programsOn kan en programcelle ogsaa saette SESSIONEN (fokus);
    // uden er det praecis den gamle `program.intensity = resolveDayIntensity(...)`.
    // Loeb er loeb (ejer-valg 2): en rytter der koerer/er bundet i dag rammer
    // racedToday/boundRestToday nedenfor, og programmets session springes over.
    const dayProgram = resolveDayProgram({
      weekday,
      slotIndex: programSlot,
      riderOverrideDays: riderOverrideByRider.get(rider.id) ?? null,
      teamWeekDays,
      program,
      hasExplicitPlan,
      programsOn,
      catalogV3: catalogV3On,
    });
    if (dayProgram.source === "program") program.focus = dayProgram.focus;
    program.intensity = dayProgram.intensity;
    // #4854: reglen vurderes paa traethed ved DATOENS START og retter aldrig planen.
    // #7801: med kontakten paa trætheden lige nu (aabningen plus datoens koerte etaper).
    const fatigueRuleResult = fatigueRules ? applyFatigueRules({
      program, rule: fatigueRules.forRider(rider.id),
      fatigueAtDateStart: fatigueNowOn ? fatigueNowBeforeGameDay({
        openingFatigue: Number(conditionBeforeDate.fatigue ?? 0), loadRows: canonicalLoadRows, riderId: rider.id,
        beforeGameDay: raceDay, recoveryAbility: Number(abRow.recovery ?? 50), medicalBonus: teamMedicalBonus,
      }) : Number(conditionBeforeDate.fatigue ?? 0),
      slotIndex: programSlot, rodeStagePreviousDate: stageYesterdayRiderIds.has(rider.id),
    }) : null;
    if (fatigueRuleResult?.stamp) {
      program.focus = fatigueRuleResult.focus;
      program.intensity = fatigueRuleResult.intensity;
    }
    applyTrainingCatalog(program, { v3: catalogV3On }); // #5319: v3-evner/-vaegte, off = uroert

    // Byg abilities-objekt kun fra VISIBLE_ABILITIES (ikke formula_version etc.)
    const abilities = {};
    for (const k of VISIBLE_ABILITIES) {
      if (abRow[k] != null) abilities[k] = Number(abRow[k]);
    }
    const recoveryBeforeDate=priorDateReports[0]?.recovery_before_date ?? abilities.recovery ?? 50;

    // Livstidsloftet GENBEREGNES hver tick — det er en ren funktion af potentiale,
    // anlæg og nuværende evne, så en forkert persisteret værdi kan ikke overleve.
    // Tidligere lazy-initede vi ("skriv kun når ability_caps er NULL") med den
    // baseline-bundne voksen-formel uanset alder, mens backfill-stien brugte den
    // afkoblede ungdoms-formel. Hvilken semantik en rytter endte med var derfor et
    // møntkast afgjort af hvilken kodesti der ramte ham først (#2001-mønsteret), og
    // feltet blev aldrig genopbygget. Se buildCapsForRider for den samlede model.
    // age medsendes (#2472, 16/7) så buildCapsForRider kan aftrappe det absolutte
    // loft efter peakAge — uden den ville post-peak-ryttere ikke aldres (blocker-fund).
    const caps = buildCapsForRider(abilities, { ...rider, age }, rider.primary_type, rider.secondary_type);
    const capsChanged = !sameCaps(abRow.ability_caps, caps);

    // #2437's interim-knapper er FJERNET i #3709 trin 5 — se sharedTickArgs
    // nedenfor for hvorfor (kort: de bremsede en model der maettede, og trin 4
    // fjerner maetningen ved roden). tickCaps = livstids-loftet for ALLE aldre,
    // uaendret siden #2437; det er nu den eneste semantik der findes.
    const tickCaps = caps;
    // #7382: rytterens raekke i taendingens oejebliksbillede (ingen raekke = kurve B fuldt).
    const riderCurveBTransition = developmentAllowed ? curveBRoster?.forRider(rider.id) ?? null : null;

    // Er rytteren skadet i dag?
    // #5462: paa loebsdags-aksen spoerges der paa LOEBSDAGEN, ikke paa datoen — en
    // kalenderdato baerer fra S4 fem loebsdage, saa en dato-sammenligning ville holde
    // rytteren ude resten af dagen efter at hans sidste skadede loebsdag var gaaet.
    // Uden loebsdags-felterne (skade skrevet foer flippet, eller flag off) falder
    // `isInjuredOnRaceDay` tilbage til praecis det gamle udtryk.
    const injuredToday = useRaceDayKey
      ? isInjuredOnRaceDay({ condition: cond, seasonId, gameDay: raceDay, tickDate })
      : !!(cond.injured_until && cond.injured_until >= tickDate);

    // #3459 D1 / #4277: racede rytteren i dag (udviklings-flag on)? injuredToday
    // har forrang (kan i praksis ikke ske samtidig — en skadet rytter stilles ikke
    // til start — men defensivt konsistent med resten af grenen).
    //
    // #4277: `raceDayDevelopmentOn` er den eneste gate her. Med udviklingen off
    // er `racedRiderIds` altid tom (lookuppet kørte ikke), så gaten er teknisk
    // redundant — den bliver stående fordi den gør intentionen læsbar dér hvor
    // grenen vælges, i stedet for at hvile på en tom mængde langt oppe i filen.
    //
    // #4847 (ejer-regel 2, 18/9): paa loebsdags-aksen SKAERES `racedRiderIds` med
    // bindingen. `racedRiderIds` er noeglet paa KALENDERDAGEN (race_results.
    // imported_at), og en kalenderdag baerer flere loebsdage — uden skaeringen ville
    // en rytter der koerte paa loebsdag N ogsaa taelle som "racede" paa loebsdag N+1
    // (samme dato) og faa en udviklings-dag han ikke har koert for. Bindingen er
    // loebsdags-noeglet og er derfor den praecise mængde.
    //
    // #4850 C2: paa loebsdags-aksen er `racedRiderIds` nu selv loebsdags-noeglet
    // (etape-opslaget), saa skaeringen med bindingen er ikke laengere noedvendig —
    // og den ville vaere FORKERT: bindingen forsvinder naar loebet er afsluttet
    // (race_entry_days_rebuild ved status `completed`, spec risiko 1), og saa fik
    // en rytter i et afsluttet endagsloeb eller paa sidste etape almindelig
    // traening oven i loebet. "Koerte" goer ham derfor ogsaa BUNDET: loeb ELLER
    // traening, uanset om bindings-raekken stadig findes.
    // KOERTE han en etape i dag? (uafhaengigt af om udviklingen er taendt)
    const rodeToday = racedRiderIds.has(rider.id);
    const raceLoadToday = conditionPerDate ? canonicalLoadRows.find(row => row.rider_id === rider.id && row.game_day === raceDay) : null;
    const unresolvedSlots=(unresolvedSlotsByRider instanceof Map ? unresolvedSlotsByRider.get(rider.id) : unresolvedSlotsByRider[rider.id])??[];
    const unresolvedOnThisSlot=conditionPerDate&&deadlineReached?unresolvedSlots.filter(slot=>Number(slot.gameDay)===raceDay):[];
    const unknownSlot=!raceLoadToday&&unresolvedOnThisSlot.length>0;
    const missingEvidence=[...new Map([...priorDateReports.flatMap(report=>report.missing_evidence??[]),...unresolvedOnThisSlot]
      .map(slot=>[`${slot.raceId}:${slot.stageNumber}:${slot.gameDay}`,slot])).values()];
    if (conditionPerDate && rodeToday && !unknownSlot) {
      const stage = raceDayResult.data.get(rider.id);
      if (!raceLoadToday || !stageMatchesCanonicalLoad(stage, raceLoadToday, raceLoadRows)) {
        throw new Error('Missing recorded race load; cannot settle a partially activated date');
      }
    }
    const boundToday = useRaceDayKey && (boundRiderIds.has(rider.id) || rodeToday || !!raceLoadToday);
    const racedToday = !injuredToday && raceDayDevelopmentOn && rodeToday;

    // #4847 (ejer-regel 2+3, 18/9): BUNDET, men ikke paa en udviklings-loebsdag.
    // To tilfaelde ender her, og begge skal vaere HVILE, ikke traening:
    //   · GT-hviledagen — rytteren er inde i et etapeloeb og koerer ikke i dag
    //     (regel 3: "saa skal han jo bare sove om natten og koere loeb igen").
    //   · Rytteren KOERTE i dag, men `race_day_development_enabled` er slukket.
    //     Foer denne aendring gav praecis den tilstand traening oven i loebet —
    //     regel 2 brudt, og den bug ejeren fandt 18/9 i denne PR.
    // Resultatet er det samme som en skadet rytters: intet tick, ingen score-raekke,
    // ingen historik — kun condition/restitution. "Loeb ELLER traening, aldrig begge."
    // #5267 A (ejer-valg 28/9): bundet, men koerte ikke PAA DENNE loebsdag, og har en
    // etape paa en anden af datoens loebsdage ⇒ datoens frie loebsdag er traening.
    // Koerte han paa denne loebsdag (rodeToday), gaelder reglen ovenfor uaendret.
    // #7737: at a press his stage has not run yet, so an open slot on the date counts too.
    const freeSlotOnStageDate = !rodeToday && !raceLoadToday && (stageOnDateRiderIds.has(rider.id) || (instantRider && unresolvedSlots.length > 0));
    const boundRestToday = !injuredToday && !racedToday && boundToday && !freeSlotOnStageDate;

    // Pre-tick træthed til skaderisiko-beregning (brug den aktuelle, ikke den næste).
    // #7737: for a stamped rider rider_condition is provisional, the opening state is the source.
    const preFatigue = instantRider ? Number(conditionBeforeDate.fatigue ?? 0) : Number(cond.fatigue ?? 0);
    const preForm = instantRider ? Number(conditionBeforeDate.form ?? 50) : Number(cond.form ?? 50);
    // #3924 trin 2: pre-tick fremdrift, snapshottet FØR tickResult muterer den —
    // rapport-linjen bærer den videre (progress_before) så frontend kan udlede
    // hvor meget af DAGENS bar der kom fra netop dette pas (mørkere segment på
    // "på vej mod næste point"-baren). Samme kilde som sharedTickArgs.progress
    // nedenfor, ét sted, så de to aldrig kan divergere.
    const preProgress = abRow.ability_progress ?? {};
    // D1: "race" er bevidst IKKE en gyldig DAILY_TRAINING_CONFIG.intensities-nøgle —
    // DAILY_TRAINING_CONFIG.fatigueLoad["race"] er undefined → nextFatigue's
    // `?? 0`-fallback giver PRÆCIS D1-semantikken (intet trænings-load, IKKE
    // rest-intensitetens -14). Samme "??0"-mekanisme injuryRisk() læner sig på
    // nedenfor (intensity !== "hard" → 0 risiko — ingen trænings-skaderisiko på
    // løbsdage, se "Åbne designbeslutninger" i PR-body).
    // #4847: `boundRestToday` faar "rest" — den rigtige restitutions-semantik for en
    // hviledag inde i et etapeloeb (og for en loebsdag hvor udviklingen er slukket).
    const effectiveIntensity = raceLoadToday ? 'race' : unknownSlot ? 'unknown_pending' : injuredToday
      ? "rest"
      : racedToday
        ? "race"
        : boundRestToday
          ? "rest"
          : program.intensity;

    // Daglig tick: raske ryttere får ENTEN en normal træningsdag ELLER (racede i
    // dag) en race-udviklings-dag — GENSIDIGT UDELUKKENDE grene i samme if/else,
    // så dobbelt-kredit er umulig by construction (#3459 D2). Skadede ryttere får
    // ingen af delene (no gains, program.intensity/training_plans RØRES ALDRIG —
    // G5-invarianten).
    // #4847: `boundRestToday` er den TREDJE gren — samme udfald som skadet (intet
    // tick), men en anden grund. Den staar i betingelsen og ikke som en tom
    // tick-type, saa "loeb ELLER traening" er umuligt at bryde by construction.
    let tickResult = null;
    if (!injuredToday && !boundRestToday && !unknownSlot && age != null) {
      const condMult = conditionMultiplier(conditionPerDate ? conditionBeforeDate : { form: Number(cond.form ?? 50), fatigue: preFatigue });
      // Fælles parametre for begge tick-typer — samme program/condition/staff/
      // facility/academy-kæde uanset kilde (design-krav: skrivestien er blind
      // for kilden, se applyRaceDevelopmentTick's docblok).
      const sharedTickArgs = {
        riderId: rider.id,
        dateStr: tickDate,
        age,
        abilities,
        caps: tickCaps,
        progress: preProgress,
        program,
        conditionMult: condMult,
        bonus,
        potentiale: rider.potentiale,
        // ── TRIN 5 (#3709, beslutning 13, ejer 14/8): ÉN MODEL ────────────────
        // `hardDailyCap` og `academyRateMult` er FJERNET. Begge fandtes kun for
        // at bremse en model der mættede: da hver evne nåede sit loft inden for
        // karrieren under alle indstillinger, var akademi-alderens høje rate en
        // spike der skulle dæmpes. Trin 4 fjerner mætningen ved roden — rolle-
        // raten gør at ryttere ikke længere NÅR deres lofter — og så bremser de
        // to knapper ikke længere en fejl, de bremser bare væksten.
        //
        // ATTRIBUTIONEN GØR DETTE BÆRENDE, IKKE OPRYDNING. Målt: beholdes
        // akademiets 1/3-dæmpning oven på trin 4, falder kandidatens
        // rating-median fra 28 til 22 — altså langt UNDER dagens 27, for alle.
        // Trin 4 og 5 er derfor ét ship; trin 5 kan ikke udskydes uden at ramme
        // spillerne med et midlertidigt fald.
        //
        // Akademiet adskiller sig herefter KUN ved `youthMultiplier` (1,50 ved
        // 16 år, aftagende til 1,00 ved 22) — som `dailyAbilityDelta` allerede
        // ganger ind selv. `computeAcademySeasonCeiling` var i forvejen ude af
        // produktionsstien (#2437 satte tickCaps = caps).
        // #3709 trin 4: anlægget sendes med, så rolle-raten kan slås op pr. evne.
        primaryType: rider.primary_type,
        secondaryType: rider.secondary_type,
        // Plan B (#1441): facilitets-magnitude + chef-specialisering. riderLevel
        // (u23/senior — #2529) styrer chefens niveau-affinitets-match pr. rytter.
        staff: trainingStaff,
        facilityTier: trainingFacilityTier,
        riderLevel: riderLevelBand({ is_academy: rider.is_academy, age }),
        // ── #4846 (fase B2) ──────────────────────────────────────────────────
        // Alle tre er null/undefined naar flaget er off ⇒ dailyTraining.js
        // falder tilbage til dato-seed, cfg.daysPerSeason og Infinity-loftet,
        // altsaa BIT-IDENTISK med foer.
        tickSeedKey,
        budgetDivisor,
        hardDailyCap,
        // #3564: baade traeningsdagen og loebsdagen (applyDailyTick nedenfor) faar kurven.
        curveB,
        curveBTransition: riderCurveBTransition, // #7382
        developmentXp, // #6110: null = dagens model
      };
      if (racedToday) {
        // #4850 variant A (ejer 24/9, S1 valgt efter simuleringen i #5640):
        // loebsdagen er et MELLEM-PAS paa etapens profil-evner, koert gennem den
        // samme applyDailyTick som en traeningsdag. Rytterens PLAN er ikke input
        // (ejer-dom 24/8): programmet bygges kun af profilen (raceDayProgram), saa
        // en hvile-plan giver stadig udvikling af at koere loeb. +1-loftet sendes
        // ALTID paa loebs-grenen, ogsaa paa den gamle kalenderdags-sti, hvor
        // hardDailyCap ellers er undefined. Profil-fallback 'rolling' er sat ovenfor.
        //
        // #6641 (variant B, ejer 24/9): dagens intention ganges sidst i kaeden via
        // applyDailyTick's ekstra multiplikator-led (default 1,0). Kun paa loebsdags-
        // aksen; ingen intention giver 1,0 = variant A.
        tickResult = applyDailyTick({
          ...sharedTickArgs,
          program: raceDayProgram(racedRiderProfileByRider.get(rider.id) ?? RACE_DAY_FALLBACK_PROFILE),
          hardDailyCap: TRAINING_RACE_DAY_CONFIG.abilityGainCapPerRaceDay,
          academyRateMult: raceDayIntentionYieldMultiplier(raceDayEffortByRider.get(rider.id)),
          ...withRaceDayRoleYieldXp(developmentXp, developmentTickArgs({ developmentScoreB, raceCatchUp, dayKey: seedScope, tickArgs: sharedTickArgs, racedToday: true, profileType: racedRiderProfileByRider.get(rider.id) }), // #6950
            { params: raceRoleYield, profileType: racedRiderProfileByRider.get(rider.id), role: raceDayRoleByRiderMap.get(rider.id) }), // #5950
        });
      } else {
        tickResult = applyDailyTick({ ...sharedTickArgs, ...developmentTickArgs({ developmentScoreB, raceCatchUp, dayKey: seedScope, tickArgs: sharedTickArgs }),
          ...(trainNowBonusRiderIds.has(rider.id) ? { trainNowBonus: true } : {}) }); // #6950
      }
      // #6500 D6: ikke-managerhold beholder tick'ets score, status og
      // traeningsscore-detalje, men evnerne og fremdriften staar stille. Ved at
      // nulstille DET HER (i stedet for at springe tick'et over) er form, traethed,
      // skade og scoren bit-identiske med et managerhold, og alle nedstroems
      // forbrugere (patch, historik, rapport) ser automatisk "ingen gevinst".
      // #6210: datoens tidligere gevinster for rytteren, paa tvaers af datoens loebsdage og
      // stier. Paa loebsdags-aksen ogsaa dato-kvitteringerne; kalenderdags-stien (flag slukket,
      // rollback eller loebsdags-fallback, Codex P1) kun datoens tidligere tick-rapporter.
      const dateUsedGains = () => sumDateGains([
        ...(useRaceDayKey && conditionPerDate ? dateReceipts.filter((row) => row.rider_id === rider.id
          && row.tick_date === tickDate && row.game_day !== raceDay).map((row) => row.report) : []),
        ...sameDateRunReports.filter((row) => row.rider_id === rider.id),
      ]);
      if (!developmentAllowed) {
        tickResult = { ...tickResult, abilities: { ...abilities }, gains: {}, progress: preProgress };
      } else if (developmentXp) {
        // #7739 (ejer 7/11): under XP er der intet +1-loft pr. evne pr. dato; kun prisen
        // bremser, og intet dato-loft betyder ingen kvittering for det. Gemt fremgang
        // udbetales helt paa én nat; der findes ingen dryp-regel (#6110 R10, ejer 12/11).
      } else if (!capPerDateOn) {
        // #6210-flaget slukket: ingen dato-loft (bit-identisk med foer #7075).
      } else {
        // #6210: maks +1 pr. evne pr. dato for dagens model og kurve B. Et ikke-managerhold
        // (ovenfor) faar ingen gevinst, saa vaernet er kun noedvendigt her.
        tickResult = capTickGainsPerDate({ tickResult, abilities, usedGains: dateUsedGains() });
      }
    }

    // Træthed + form for næste dag. #3459 D3: recoveryBase/recoveryFraction følger
    // race_day_engine_enabled — udeladt (flag off) = CONDITION_CONFIG's status quo
    // (bit-identisk); on = RACE_DAY_ENGINE_RECOVERY_CONFIG (4.5/0.15, empirisk valgt).
    //
    // #4277: BEVIDST `raceDayEngineOn`, ikke udviklings-flagget. Restitutions-
    // konstanterne er kalibreret mod HELE populationens træthedsfordeling (median
    // 57 mod 67 med de gamle tal), ikke mod løbsdags-udviklingen. At slukke
    // udviklingen må ikke rulle dem tilbage — det var netop koblingen der gjorde
    // "sluk udviklingen for S3" umulig før dette split.
    // #7737: on the last free race day of an instant press every missing race day is an open
    // race slot. His form and fatigue are then counted now, with the stage load still to come.
    const provisionalNow = instantRider && instantPress && !settlesCondition
      && dateDays.every(day => day === raceDay || dateReceiptOn(day) || unresolvedSlots.some(slot => Number(slot.gameDay) === day));
    const conditionCounted = settlesCondition || provisionalNow;
    const hasLoadOn = (day) => canonicalLoadRows.some(load=>load.rider_id===rider.id&&load.game_day===day);
    const settleIntensities = !conditionCounted ? null : instantRider
      ? dateDays.map(day => day === raceDay ? effectiveIntensity : hasLoadOn(day) ? 'race' : dateReceiptOn(day)?.report?.intensity ?? 'race')
      : [...priorDateReports.map(report=>canonicalLoadRows.some(load=>load.rider_id===rider.id&&load.game_day===report.game_day)?'race':report.intensity),effectiveIntensity];
    const settleRaceLoads = conditionCounted ? dateDays.map(day => Number(canonicalLoadRows.find(row => row.rider_id === rider.id && row.game_day === day)?.load ?? 0)) : null;
    // #7737 (ejer 10/11): et aabent loebsfelt i den foreloebige opgoerelse giver hverken
    // belastning eller restitution, foer loebet er koert. Aftenens opgoerelse har ingen aabne felter.
    const pendingRaceSlots = provisionalNow && !settlesCondition
      ? dateDays.map((day, i) => settleIntensities[i] === 'race' && day !== raceDay && !hasLoadOn(day))
      : null;
    const countedCondition = conditionCounted ? settleTrainingDateCondition({
      riderId: rider.id, dateStr: tickDate, condition: conditionBeforeDate,
      intensities: settleIntensities,
      raceLoads: settleRaceLoads,
      pendingRaceSlots,
      // #7801: skaderisikoen pr. felt paa trætheden lige nu foer feltet (kun med kontakten).
      riskFatigues: fatigueNowOn ? slotFatiguesNow({
        openingFatigue: Number(conditionBeforeDate.fatigue ?? 0), intensities: settleIntensities, raceLoads: settleRaceLoads,
        recoveryAbility: Number(abRow.recovery ?? 50), medicalBonus: teamMedicalBonus,
      }) : null,
      recoveryAbility: recoveryBeforeDate,
      recoveryConfig: raceDayEngineOn ? RACE_DAY_ENGINE_RECOVERY_CONFIG : {},
      modelV2: conditionModelV2On,
      medicalBonus: teamMedicalBonus,
      raceDateTrainingDay: raceDateTrainingDayOn,
    }) : null;
    // A provisional count carries only form and fatigue; its injury roll is never used.
    const dailyCondition = settlesCondition ? countedCondition : null;
    const provisionalCondition = provisionalNow ? countedCondition : null;
    const newFatigue = conditionPerDate ? (dailyCondition?.fatigue ?? preFatigue) : nextFatigue({
      fatigue: preFatigue,
      intensity: effectiveIntensity,
      recoveryAbility: abilities.recovery ?? 50,
      ...(raceDayEngineOn ? RACE_DAY_ENGINE_RECOVERY_CONFIG : {}),
    });
    const newForm = conditionPerDate ? (dailyCondition?.form ?? preForm) : nextForm({ form: Number(cond.form ?? 50), fatigue: newFatigue });

    // Ny skade? (kun for raske ryttere, baseret på PRE-tick træthed)
    let newInjuredUntil = cond.injured_until ?? null;
    let newInjuryCause = cond.injury_cause ?? null;
    let injuryDays = 0;
    let newlyInjured = false;
    // #5462: loebsdags-sandheden. Kun relevant paa loebsdags-aksen; paa den gamle sti
    // forlader ingen af de tre vaerdier denne blok (ingen kolonner skrives).
    let newInjuryEndGameDay = cond.injury_end_game_day ?? null;
    let newInjurySeasonId = cond.injury_season_id ?? null;
    // A previous season's coordinate cannot be looked up on the new axis.
    // Keep injured_until as the conservative calendar fallback.
    if (useRaceDayKey && newInjurySeasonId !== seasonId) {
      newInjuryEndGameDay = null;
      newInjurySeasonId = null;
    }

    // #7737: injury and illness are only rolled when the date closes, never at the press,
    // and from the race day the date closes on: a stamped rider's race slot can be earlier.
    const injuredAtSettlement = instantRider ? isInjuredOnRaceDay({ condition: cond, seasonId, gameDay: settleGameDay, tickDate }) : injuredToday;
    if (!injuredAtSettlement) {
      const risk = conditionPerDate ? (dailyCondition?.risk ?? 0) : injuryRisk({ intensity: effectiveIntensity, fatigue: preFatigue });
      if (risk > 0) {
        // #4846 A3: skade-rullet seedes paa SAMME scope som traenings-stoejen.
        // Med dato-seed ville to loebsdage samme kalenderdag give identisk
        // skade-udfald; rollInjury bruger `dateStr` udelukkende som seed-hale,
        // saa scopet kan skiftes her uden at roere riderCondition.js.
        // #5462 (ejer-laast 15/9, §13.3 pkt. 7): VARIGHEDEN er nu i LOEBSDAGE paa
        // loebsdags-aksen, skaleret med saesonens loebsdage pr. kalenderdato
        // (ejer-valg 22/9). De efterfoelgende skalerede ticks mistes.
        // `injured_until` udledes af den
        // efter loekken (ÉT batch-opslag for hele holdets nye skader); indtil da staar
        // kalenderdagen som fallback, saa en skade ALTID bliver skrevet, ogsaa hvis
        // kalenderopslaget ikke kan svare.
        const roll = conditionPerDate ? dailyCondition.injury : rollInjury({ riderId: rider.id, dateStr: seedScope, risk });
        if (roll.injured) {
          injuryDays = roll.days;
          newlyInjured = true;
          // Skaden starter EFTER dagens session (inkl. i morgen og frem).
          newInjuredUntil = addDaysToDate(tickDate, roll.days);
          newInjuryCause = "training_overload";
          if (useRaceDayKey) {
            newInjuryEndGameDay = injuryEndGameDay({ gameDay: settleGameDay, days: roll.days, seasonNumber });
            newInjurySeasonId = newInjuryEndGameDay == null ? null : seasonId;
          }
        }
      }
    }

    // Ryd skade når den er passeret.
    if (useRaceDayKey) {
      // #5462: paa loebsdags-aksen afgoeres raskmeldingen af LOEBSDAGEN naar den
      // findes — ellers af datoen, praecis som foer. En skade fra FOER flippet har
      // ingen loebsdag og loeber derfor faerdig paa kalenderdage (overgangs-reglen:
      // ingen igangvaerende skade skifter betydning tavst).
      //
      // `!newlyInjured` er med HER og bevidst IKKE paa den gamle sti nedenfor: en
      // rytter hvis skade udloeb i gaar, og som bliver skadet igen i dag, faar paa
      // den gamle sti sin friske skade nulstillet af dette led (fejl der er aeldre
      // end #5462 — se slutrapportens out-of-scope-fund). Flag off skal vaere
      // bit-identisk, saa den bliver staaende som den er.
      if (!newlyInjured && cond.injured_until
        && !isInjuredOnRaceDay({ condition: cond, seasonId, gameDay: settleGameDay, tickDate })) {
        newInjuredUntil = null;
        newInjuryCause = null;
        newInjuryEndGameDay = null;
        newInjurySeasonId = null;
      }
    } else if (cond.injured_until && cond.injured_until < tickDate) {
      newInjuredUntil = null;
      newInjuryCause = null;
    }

    // #6938: sygdom (efter oprydningen af en udloebet skade, saa den ikke nulstilles). Kun for en
    // rask rytter, der ikke blev skadet i dag. Stimen regnes paa de
    // afregnede dage foer i dag plus dagens traethed efter afregningen (conditionIllness.js).
    let illnessDays = 0;
    // Codex #7178: kun paa datoens afregnende tick (samme gate som conditionUpserts), ellers
    // skrives en sygdom i rapporten paa et tick hvor tilstanden ikke afregnes.
    if (illnessOn && (!conditionPerDate || settlesCondition) && !injuredAtSettlement && !newlyInjured) {
      const illness = assessIllness({ riderId: rider.id, dateStr: instantRider ? raceDaySeedKey({ seasonId, gameDay: settleGameDay }) : seedScope, fatigues: [newFatigue, ...(illnessHistoryByRider.get(rider.id) ?? [])], medicalBonus: teamMedicalBonus });
      if (illness.ill) {
        illnessDays = illness.days;
        newlyInjured = true;
        newInjuredUntil = addDaysToDate(tickDate, illness.days);
        newInjuryCause = "illness";
        if (useRaceDayKey) {
          newInjuryEndGameDay = injuryEndGameDay({ gameDay: settleGameDay, days: illness.days, seasonNumber });
          newInjurySeasonId = newInjuryEndGameDay == null ? null : seasonId;
        }
      }
    }

    // Saml ability-patch: gains fra tick + opdateret progress + evt. initierede caps.
    const abilityPatch = {};
    if (tickResult) {
      // Skriv de opdaterede abilities tilbage (kun dem der faktisk steg).
      for (const k of VISIBLE_ABILITIES) {
        if (tickResult.abilities[k] !== abilities[k]) {
          abilityPatch[k] = tickResult.abilities[k];
        }
      }
      // #6500: ikke-managerhold skriver ingen ability_progress (fremdriften er frosset).
      if (developmentAllowed) abilityPatch.ability_progress = tickResult.progress;
    }
    if (capsChanged) {
      abilityPatch.ability_caps = caps;
    }
    // #2437: season_budget_baseline/season_budget_season skrives IKKE længere —
    // sæson-loftet er fjernet (se blok-kommentaren ved tickCaps ovenfor). Kolonnerne
    // er droppet fra skemaet (#2590, database/2026-07-19-drop-season-budget-cols.sql).
    if (Object.keys(abilityPatch).length > 0) {
      abilityUpdates.push({ riderId: rider.id, patch: abilityPatch });
    }

    // #2000 Udvikling-fane: snapshot den fulde post-tick evnevektor de dage rytteren
    // FAKTISK fik en evne-gevinst (mindst én VISIBLE_ABILITIES-nøgle i patchen — ikke
    // bare progress/caps). Flade dage springes over; Recharts connectNulls + season-/
    // baseline-punkter holder kurven sammenhængende. Persisteres best-effort i Phase 2.
    if (tickResult && VISIBLE_ABILITIES.some((k) => k in abilityPatch)) {
      const snapshot = {};
      for (const k of VISIBLE_ABILITIES) snapshot[k] = tickResult.abilities[k];
      historyRows.push({
        rider_id: rider.id,
        snapshot_date: tickDate,
        source: "daily_training",
        season_number: seasonNumber,
        abilities: snapshot,
      });
      // #4846: paa loebsdags-aksen skrives snapshottet OGSAA til soesterbordet, som
      // har (rider_id, season_id, game_day, source) som noegle. Den gamle tabel
      // beholder sin kalenderdags-noegle — hele vaerditrend-/rating-laesesiden
      // (riderValueTrend, proRiderHistory, marketValueSundaySweep,
      // riderRatingTrajectory) haenger paa den, og en divisionsafhaengig takt dér
      // ville give systematisk forskellige kurver mellem D1 og D4 (spec §3.2).
      if (useRaceDayKey) {
        raceDayHistoryRows.push({
          rider_id: rider.id,
          season_id: seasonId,
          game_day: raceDay,
          source: racedToday ? "race_development" : "daily_training",
          season_number: seasonNumber,
          snapshot_date: tickDate,
          abilities: snapshot,
        });
      }
    }

    // ── #4851: traeningsscoren for dagens pas ────────────────────────────────
    // ÉN raekke pr. rytter pr. pas. Skrivningen sker i SAMME kald som tick'et
    // (Phase 2 nedenfor), bag samme reservation/mutex som resten af dagen, saa
    // en score aldrig kan staa uden det tick den beskriver.
    //
    // Tre tilstande, praecis som spec §4.4 kraever:
    //   hviledag / skadet   ⇒ INGEN raekke (der var intet pas at maale)
    //   loebsdag            ⇒ raekke med score NULL + was_race_day (fladen: "loeb")
    //   traeningsdag        ⇒ raekke med tallet 1-99 + de stoerste bidrag
    // `intention` er NULL i fase A: race_entries har ingen intentions-kolonne
    // endnu (#4632). Kolonnen findes for at den kan udfyldes uden migration.
    const scoreDetail = tickResult?.trainingScore ?? null;
    if (scoreDetail) {
      scoreRows.push({
        rider_id: rider.id,
        team_id: teamId,
        season_id: seasonId,
        tick_date: tickDate,
        game_day: useRaceDayKey ? raceDay : null,
        score: racedToday ? null : scoreDetail.score,
        session: scoreDetail.session,
        day_type: scoreDetail.dayType,
        was_race_day: racedToday,
        intention: null,
        contributions: racedToday ? null : scoreDetail.contributions,
      });
    } else if (boundRestToday && rodeToday) {
      // #4847: rytteren KOERTE en etape, men fik intet tick fordi udviklingen er
      // slukket. Uden denne raekke ville traeningsfladen vise et HUL netop paa de
      // dage hvor der skete mest — spec par. 4.4's tre tilstande kraever "loebsdag
      // ⇒ raekke med score NULL + was_race_day". `session`/`day_type` er NULL:
      // han koerte ikke et pas, og kolonnerne er nullable netop til det.
      // En GT-HVILEDAG (boundRestToday uden rodeToday) faar bevidst INGEN raekke —
      // det er "hviledag" i de tre tilstande, ikke "loebsdag".
      scoreRows.push({
        rider_id: rider.id,
        team_id: teamId,
        season_id: seasonId,
        tick_date: tickDate,
        game_day: raceDay,
        score: null,
        session: null,
        day_type: null,
        was_race_day: true,
        intention: null,
        contributions: null,
      });
    }

    // Gennembruds-detalje (#1305 polish): faktisk tal-spring pr. gevinst, så
    // rapporten kan vise "71 → 72" frem for flad "+1". from = pre-tick, to = post-tick.
    const gainsDetail = {};
    if (tickResult) {
      for (const [ability, n] of Object.entries(tickResult.gains)) {
        if (n > 0) {
          gainsDetail[ability] = { from: abilities[ability] ?? 0, to: tickResult.abilities[ability] };
        }
      }
    }

    // Condition upsert (altid — fatigue/form ændrer sig selv på hviledage).
    // #5462: de tre loebsdags-kolonner sendes KUN paa loebsdags-aksen. Flag off er
    // dermed bit-identisk helt ned i payloaden — upsert-stien roerer kun de kolonner
    // den faar med, saa en eksisterende raekkes loebsdags-felter er ogsaa urørte.
    if (conditionPerDate && settlesCondition) settlingRiderIds.add(rider.id);
    if (provisionalCondition) conditionUpserts.push({ rider_id: rider.id, form: provisionalCondition.form, fatigue: provisionalCondition.fatigue, provisional: true });
    if (!conditionPerDate || settlesCondition) conditionUpserts.push({
      rider_id: rider.id,
      form: newForm,
      fatigue: newFatigue,
      injured_until: newInjuredUntil,
      injury_cause: newInjuryCause,
      updated_at: now.toISOString(),
      ...(useRaceDayKey
        ? {
          injury_end_game_day: newInjuryEndGameDay,
          injury_season_id: newInjurySeasonId,
          // Denormaliseret rest, opfrisket ved HVERT tick fra den absolutte
          // sandhed (slut-loebsdagen). Et misset tick selvheler derfor paa det
          // naeste; feltet er aldrig en nedtaelling der kan drive.
          injury_race_days_left: newInjuryEndGameDay == null
            ? null
            : injuryRaceDaysLeft({ endGameDay: newInjuryEndGameDay, currentGameDay: settleGameDay }),
        }
        : {}),
    });

    // Rapport-linje pr. rytter.
    reportRiders.push({
      rider_id: rider.id,
      ...(trainNowBonusRiderIds.has(rider.id) ? { train_now_bonus: true } : {}),
      name: `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim(),
      ...(conditionPerDate ? { condition_before_date: conditionBeforeDate,condition_observed:cond,recovery_before_date:recoveryBeforeDate } : {}),
      ...(instantRider ? { expected_date_receipt_days: dateReceipts
        .filter(receipt => receipt.rider_id === rider.id && receipt.tick_date === tickDate && dateDays.includes(Number(receipt.game_day)))
        .map(receipt => Number(receipt.game_day)).sort((a, b) => a - b) } : {}),
      ...(conditionPerDate ? {missing_evidence:missingEvidence,settlement_status:missingEvidence.length?'needs_reconciliation':'complete'} : {}),
      score: tickResult?.score ?? 0,
      gains: tickResult?.gains ?? {},
      gains_detail: gainsDetail,
      // #6210: point udskudt til naeste dato af dato-loftet (kun naar det bandt).
      ...(tickResult?.capped_by_date ? { gains_deferred_by_date_cap: tickResult.capped_by_date } : {}),
      // #3924 trin 2: pre-tick fremdrift — kun til frontend-udledning af dagens
      // bidrag til "på vej mod næste point"-baren, aldrig til ny trænings-logik.
      progress_before: preProgress,
      progress_after: tickResult?.progress ?? preProgress,
      status: unknownSlot ? 'unknown_pending' : tickResult?.status ?? "rest",
      form: newForm,
      fatigue: newFatigue,
      fatigue_delta: newFatigue - preFatigue,
      injured: injuredToday || newlyInjured,
      injury_days: injuryDays,
      // #6938: syg i dag (loebsdage ude). Kun naar sygdom er taendt; 0 ellers.
      ...(illnessDays > 0 ? { illness_days: illnessDays } : {}),
      focus: program.focus,
      intensity: effectiveIntensity,
      focus_source: plan ? "plan" : "auto",
      // #3459 D1 — additivt rapport-felt (fremtidig UI, jf. spec V3 "Løbsdag —
      // dagens træning erstattes af løbet"). false når flag off (bit-identisk
      // datamodel, ingen eksisterende consumer læser feltet endnu).
      race_day: racedToday,
      // #4847 (ejer-regel 3): rytteren er BUNDET til et loeb paa denne loebsdag —
      // enten fordi han koerer, eller fordi han er inde i et etapeloebs spaend
      // (GT-hviledag). Additivt rapport-felt, altid false paa den gamle sti.
      bound_race_day: boundToday,
      // #4846: hvilken loebsdag ticket hoerer til. null paa den gamle sti.
      game_day: useRaceDayKey ? raceDay : null,
      // #4854: kun naar holdet har regler; stemplet kun naar programmet faktisk koertes.
      ...(fatigueRuleResult ? {
        fatigue_rule: fatigueRuleResult.stamp && !raceLoadToday && !unknownSlot && !injuredToday && !racedToday && !boundRestToday
          ? fatigueRuleResult.stamp : null,
      } : {}),
    });
  }
  return { abilityUpdates, conditionUpserts, reportRiders, historyRows, raceDayHistoryRows, scoreRows, settlingRiderIds };
}
