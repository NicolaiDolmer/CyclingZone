// Traethed i aften: ca. X (#5933, ejer-beslutning 7, 29/9).
//
// INVARIANT I5 (spec 2026-09-29-traen-nu-og-prognose-design.md): prognosen
// bruger SAMME funktioner som aftenopgoerelsen, ingen kopi af formlen.
// Derfor kalder denne fil `settleTrainingDateCondition` (trainingDateCondition.js),
// `raceConditionLoads` (raceFatigue.js, samme belastning som loebet skriver),
// `resolveDayProgram` + `programSlotForRaceDay` (trainingPrograms.js, samme stige
// og samme slot som motoren) og `isInjuredOnRaceDay` (injuryRaceDays.js). Den
// eneste nye logik er at SAMLE datoens fem felter, praecis som
// dailyTrainingEngine.js goer det ved datoens sidste trin:
//
//   · felt allerede afregnet (kvittering)  → kvitteringens intensitet, eller
//                                             'race' naar en loebsbelastning findes
//   · loebsbelastning registreret          → 'race' med den registrerede belastning
//   · udtaget til en etape paa loebsdagen  → 'race' med etapens profil-belastning
//                                             (indsats "normal": derfor "ca.")
//   · skadet paa loebsdagen                → 'rest'
//   · bundet i et etapeloeb uden etape paa
//     datoen (GT-hviledag)                 → 'rest'
//   · ellers                               → planens intensitet for feltet
//
// Ingen tal forlader serveren ud over prognosen selv og et farvebaand. Graenserne
// for baandet er de eksisterende konstanter i riderCondition.js (skadegraensen og
// formzonens top), ikke nye balance-tal.

import { loadInstantConditions } from "./trainNowInstantCondition7737.js";
import { settleTrainingDateCondition } from "./trainingDateCondition.js";
import { CONDITION_CONFIG, RACE_DAY_ENGINE_RECOVERY_CONFIG, NEW_RIDER_START_CONDITION } from "./riderCondition.js";
import { raceConditionLoads } from "./raceFatigue.js";
import { resolveDayProgram, programSlotForRaceDay, weekDaysHaveSessions } from "./trainingPrograms.js";
import { loadRotationPlans, loadRotationReceipts, rotationProgram, rotationProgress, stampRotation } from "./trainingRotationProgress.js";
import { resolveProgram } from "./dailyTraining.js";
import { isInjuredOnRaceDay } from "./injuryRaceDays.js";
import { copenhagenDateString, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { fetchAllRows } from "./supabasePagination.js";
import { isTrainingDateTeam, stageEntrantSnapshotIds, trainingDateBounds } from "./trainingDateReadiness.js";
import { resolveDayCloseStatus } from "./trainingDayCloseTrigger.js";
import { isRaceDayEngineEnabled } from "./raceDayEngineFlag.js";
import { isTrainingConditionPerDateEnabled } from "./trainingDateConditionFlag.js";
import { isConditionModelV2Enabled, isRaceDateTrainingDayEnabled } from "./conditionModelV2Flag.js";
import { loadTeamMedicalBonus } from "./medicalEffects.js";
import { riderFatigueNow } from "./riderFatigueNow.js"; // #7801
import { isFatigueNow7801Enabled } from "./riderFatigueNowFlag.js";
import { isTrainingCellsEnabledForTeam } from "./trainingWeekPlanCellsFlag.js";
import { isTrainingCatalogV3EnabledForTeam } from "./trainingCatalogV3.js"; // #5319
import { loadRaceExitGameDays, dropBindingsAfterRaceExit, releaseNonStarters } from "./trainingRaceDayTick.js";
import { loadWithdrawnRaceIdsForTeam } from "./raceWithdrawal.js";
import { isTrainingSettleRaceSessionEnabled } from "./trainingSettleRaceSession7982.js"; // #7982
import { isTrainingEffortLevelsEnabled } from "./trainingEffortLevels.js"; // #7947
import { isTrainingWeekPriorityEnabledForTeam, weekPriorityPlacement, winningWeekEntry } from "./trainingWeekPriority.js"; // #8549
// #5932-integrationen: spillerens traethedsgraense (#4854) aendrer motorens pas
// efter resolveDayProgram. Prognosen kalder SAMME funktion (I5).
import {
  applyFatigueRules, loadTeamFatigueRules, loadRiderIdsWithStageOnDate, previousDateString,
} from "./trainingFatigueRules.ts";

export const FORECAST_SLOTS = 5;

// Farvebaand: groen / gul / roed over skadegraensen. Ingen nye konstanter.
export function forecastBand(fatigue) {
  if (fatigue == null) return null;
  const value = Number(fatigue);
  if (!Number.isFinite(value)) return null;
  if (value >= CONDITION_CONFIG.injuryFatigueFloor) return "risk";
  if (value > CONDITION_CONFIG.formSweetHi) return "warn";
  return "ok";
}

// ── Ren kerne: et felts aktivitet ───────────────────────────────────────────
// Returnerer { intensity, raceLoad } for ET af datoens fem felter.
export function forecastSlotActivity({
  riderId, receipt = null, recordedLoad = null, plannedStageProfile = null,
  injured = false, boundRestDate = false, planIntensity, conditionModelV2 = false, overdue = false,
}) {
  if (receipt) {
    // Samme valg som motorens priorDateReports-linje.
    if (recordedLoad != null) return { intensity: "race", raceLoad: Number(recordedLoad) };
    return { intensity: receipt.report?.intensity ?? planIntensity, raceLoad: 0 };
  }
  if (recordedLoad != null) return { intensity: "race", raceLoad: Number(recordedLoad) };
  if (overdue) return { intensity: "unknown_pending", raceLoad: 0 };
  if (plannedStageProfile) {
    // #6984: under v2 samme belastningsfunktion som loebet fryser; laengde og saesonens
    // loebsdage kendes ikke her, saa tallet er et "ca."-estimat (som indsatsen i dag).
    const [estimate] = raceConditionLoads([riderId], plannedStageProfile, null, null, null,
      conditionModelV2 ? { distanceKm: null, seasonRaceDaysByRider: new Map() } : null);
    return { intensity: "race", raceLoad: Number(estimate?.load ?? 0) };
  }
  if (injured) return { intensity: "rest", raceLoad: 0 };
  if (boundRestDate) return { intensity: "rest", raceLoad: 0 };
  return { intensity: planIntensity, raceLoad: 0 };
}

// ── Ren kerne: aftenens traethed for EN rytter ──────────────────────────────
// `slots` er datoens fem felter i loebsdags-orden (forecastSlotActivity).
// Kalder aftenopgoerelsens egen funktion; returnerer null hvis input ikke er
// en hel dato (opgoerelsen kraever praecis fem felter).
export function forecastRiderFatigue({ riderId, dateStr, opening, slots, recoveryAbility = 50, recoveryConfig = RACE_DAY_ENGINE_RECOVERY_CONFIG, conditionModelV2 = false, medicalBonus = 0, raceDateTrainingDay = false }) {
  if (!Array.isArray(slots) || slots.length !== FORECAST_SLOTS) return null;
  try {
    const settled = settleTrainingDateCondition({
      riderId, dateStr,
      condition: { fatigue: Number(opening?.fatigue ?? NEW_RIDER_START_CONDITION.fatigue), form: Number(opening?.form ?? NEW_RIDER_START_CONDITION.form) },
      intensities: slots.map((slot) => slot.intensity),
      raceLoads: slots.map((slot) => (slot.intensity === "race" ? Number(slot.raceLoad ?? 0) : 0)),
      recoveryAbility,
      recoveryConfig,
      modelV2: conditionModelV2,
      raceDateTrainingDay, // #7536: samme flag som aftenens opgoerelse (I5)
      medicalBonus,
    });
    return settled.fatigue;
  } catch {
    // best-effort: et felt med en ukendt intensitet (fx et ufaerdigt bevis) giver ingen
    // prognose frem for et gaet.
    return null;
  }
}

// ── Ren samling af hele holdet ───────────────────────────────────────────────
// Alle input er allerede hentet; funktionen er deterministisk og testbar.
export function buildTeamFatigueForecast({
  tickDate, seasonId, dateGameDays, riders, conditionByRider = new Map(), openingByRider = new Map(),
  recoveryByRider = new Map(), planByRider = new Map(), teamWeekDays = null, riderWeekDaysByRider = new Map(),
  receipts = [], recordedLoads = [], plannedStages = [], boundRiderIdsByGameDay = new Map(),
  cellsOn = false, raceDayEngineOn = true, conditionModelV2 = false, medicalBonus = 0, raceDateTrainingDay = false,
  catalogV3 = false, // #5319: samme katalog-gate som motoren
  // #4854: holdets regler (loadTeamFatigueRules) + hvem koerte etape i gaar.
  fatigueRules = null, stageYesterdayRiderIds = new Set(),
  fatigueNow = false, // #7801: reglen paa traetheden lige nu, samme tal som motoren (I5)
  ranSlots = false, // #7982: kun med training_settle_race_session on; slukket = feltet findes ikke
  effortLevels = false, // #7947: samme kontakt som motoren
  // #8549: Week blocks som motoren (I5). Off = kildefeltet er feltet (dagens prognose).
  weekPriority = false, teamWeekRow = null, riderWeekRowByRider = new Map(), overdueByRider = new Map(),
  rotationByRider = new Map(), rotationReceiptsByRider = new Map(), teamId = null,
}) {
  const days = [...new Set((dateGameDays ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (days.length !== FORECAST_SLOTS) return {};
  const weekday = copenhagenWeekdayKey(tickDate);
  const recoveryConfig = raceDayEngineOn ? RACE_DAY_ENGINE_RECOVERY_CONFIG : {};
  const out = {};
  for (const rider of riders ?? []) {
    // #8089: rytter uden tilstand regnes fra samme start, som databasen giver ham.
    const cond = conditionByRider.get(rider.id) ?? NEW_RIDER_START_CONDITION;
    const opening = openingByRider.get(rider.id) ?? cond;
    const plan = planByRider.get(rider.id) ?? null;
    const program = resolveProgram(plan, rider.primary_type);
    const hasExplicitPlan = !!(plan?.focus && plan?.intensity);
    const riderReceipts = receipts.filter((row) => row.rider_id === rider.id);
    const rotation = rotationByRider.get(rider.id);
    const previousRotationReceipts = rotationReceiptsByRider.get(rider.id);
    const rotationReceipts = rotation ? riderReceipts.filter((row) => teamId == null || row.team_id === teamId) : [];
    const firstReport = days.map((day) => riderReceipts.find((row) => row.game_day === day)).find(Boolean)?.report;
    const recoveryAbility = firstReport?.recovery_before_date ?? recoveryByRider.get(rider.id) ?? 50;
    const hasStageOnDate = plannedStages.some((row) => row.rider_id === rider.id)
      || recordedLoads.some((row) => row.rider_id === rider.id);
    const weekPlacementInput = weekPriority && !rotation ? {
      winning: winningWeekEntry({ weekday, riderRow: riderWeekRowByRider.get(rider.id) ?? null, teamRow: teamWeekRow, hasExplicitPlan }),
      dateDays: days,
      raceGameDays: [
        ...recordedLoads.filter((row) => row.rider_id === rider.id && row.duplicate_of_race_id == null).map((row) => Number(row.game_day)),
        ...plannedStages.filter((row) => row.rider_id === rider.id).map((row) => Number(row.game_day)),
      ],
      priorReports: riderReceipts,
      // #8549 regel B: samme skadede felter som motoren (isInjuredOnRaceDay pr. loebsdag).
      injuredGameDays: days.filter((day) => isInjuredOnRaceDay({ condition: cond, seasonId, gameDay: day, tickDate })),
    } : null;
    let placement = weekPlacementInput ? weekPriorityPlacement(weekPlacementInput) : null;
    const overdue = placement || rotation ? overdueByRider.get(rider.id) : null;
    const projectedReports = placement && overdue?.size ? [...riderReceipts] : null;
    const ruleLoads = []; // #7801: etaper i tidligere felter samme dato
    const slots = days.map((day) => {
      const slotIndex = programSlotForRaceDay(day, days);
      // #8549: samme omdirigering af kildefeltet som motoren; træthedsgrænsen bruger feltet selv.
      const sourceSlot = placement?.fieldSource[slotIndex] ?? slotIndex;
      const dayProgram = resolveDayProgram({
        weekday, slotIndex: sourceSlot,
        riderOverrideDays: riderWeekDaysByRider.get(rider.id) ?? null,
        teamWeekDays, program, hasExplicitPlan, programsOn: cellsOn, catalogV3, effortLevels,
      });
      // Samme raekkefoelge som dailyTrainingEngine.js: planens pas, derefter
      // spillerens regel vurderet paa traethed ved datoens start.
      const planned = {
        focus: dayProgram.source === "program" ? dayProgram.focus : program.focus,
        intensity: dayProgram.intensity,
      };
      const choice = rotationProgram({
        rotation, receipts: previousRotationReceipts, dateReceipts: rotationReceipts,
        previousFocus: planned.focus, catalogV3, effortLevels,
      });
      if (choice) Object.assign(planned, choice.program);
      const ruled = fatigueRules ? applyFatigueRules({
        program: planned, rule: fatigueRules.forRider(rider.id),
        fatigueAtDateStart: fatigueNow
          ? riderFatigueNow({ openingFatigue: Number(opening?.fatigue ?? 0), dateLoads: ruleLoads, recoveryAbility: Number(recoveryByRider.get(rider.id) ?? 50), medicalBonus })
          : Number(opening?.fatigue ?? 0),
        slotIndex, rodeStagePreviousDate: stageYesterdayRiderIds.has(rider.id),
      }) : null;
      const planIntensity = ruled?.stamp ? ruled.intensity : planned.intensity;
      const recorded = recordedLoads.find((row) => row.rider_id === rider.id && Number(row.game_day) === day && row.duplicate_of_race_id == null);
      const plannedStage = plannedStages.find((row) => row.rider_id === rider.id && Number(row.game_day) === day);
      const bound = boundRiderIdsByGameDay.get(day)?.has(rider.id) ?? false;
      const injured = isInjuredOnRaceDay({ condition: cond, seasonId, gameDay: day, tickDate });
      const boundRest = bound && !hasStageOnDate;
      const receipt = riderReceipts.find((row) => row.game_day === day) ?? null;
      const activity = forecastSlotActivity({
        riderId: rider.id,
        receipt,
        recordedLoad: recorded ? recorded.load : null,
        plannedStageProfile: plannedStage ? (plannedStage.profile_type ?? "rolling") : null,
        injured,
        boundRestDate: boundRest,
        planIntensity,
        conditionModelV2,
        overdue: overdue?.has(day),
      });
      if (projectedReports && !receipt) {
        // Match the sweep: earlier fields keep the source they would already have used
        // when a released stage is stamped as pending. Re-place only the remaining fields.
        const report = {
          intensity: activity.intensity,
          injured,
          ...(!injured && !boundRest && activity.intensity !== "unknown_pending" && activity.intensity !== "race"
            ? { source_slot: sourceSlot } : {}),
        };
        projectedReports.push({ game_day: day, report });
        if (activity.intensity === "unknown_pending") {
          placement = weekPriorityPlacement({ ...weekPlacementInput, priorReports: projectedReports });
        }
      }
      if (fatigueNow && activity.intensity === "race") ruleLoads.push(Number(activity.raceLoad ?? 0));
      const rested = receipt
        ? !Number.isInteger(receipt.report?.source_slot) && (receipt.report?.injured === true || boundRest)
        : injured || boundRest;
      if (placement && activity.intensity === "rest" && rested) activity.weekRest = true;
      if (rotation) {
        const stamp = receipt
          ? (teamId == null || receipt.team_id === teamId ? receipt.report?.rotation : null)
          : stampRotation({
            rotation, chosen: choice, raced: activity.intensity === "race", injured, boundRest,
            unknown: activity.intensity === "unknown_pending", fatigueRule: ruled?.stamp,
          });
        if (!receipt && stamp) rotationReceipts.push({ tick_date: tickDate, report: { rotation: stamp } });
        if (stamp?.advanced) activity.rotation = { ...stamp, intensity: activity.intensity };
        const replacement = receipt ? receipt.report?.fatigue_rule : ruled?.stamp;
        if (stamp && !stamp.advanced && replacement?.fallback === "recovery" && activity.intensity !== "race" && !injured && !boundRest) {
          activity.recovery = true;
        }
      }
      return { ...activity, selectedRace: !!plannedStage };
    });
    const fatigue = forecastRiderFatigue({ riderId: rider.id, dateStr: tickDate, opening, slots, recoveryAbility, recoveryConfig, conditionModelV2, medicalBonus, raceDateTrainingDay });
    if (fatigue == null && !placement && !rotation) continue;
    // raceSlots: dagens felter der er laast af et loeb (regel A). Gitteret viser
    // dem som etape; de oevrige felter er traening.
    const raceSlots = slots.flatMap((slot, index) => (
      slot.intensity === "unknown_pending" ? (slot.selectedRace ? [index] : []) :
      slot.intensity === "race" || (placement?.fieldSource[index] === null && !slot.weekRest) ? [index] : []
    ));
    out[rider.id] = { fatigue, band: forecastBand(fatigue), raceSlots };
    if (placement || rotation) {
      const pendingSlots = slots.flatMap((slot, index) => slot.intensity === "unknown_pending" ? [index] : []);
      if (pendingSlots.length) out[rider.id].pendingSlots = pendingSlots;
    }
    if (placement) {
      const restSlots = slots.flatMap((slot, index) => slot.weekRest ? [index] : []);
      const wholeDayRest = restSlots.length === days.length;
      Object.assign(out[rider.id], {
        fieldSource: placement.fieldSource.map((source, index) => slots[index].weekRest ? null : source),
        taken: wholeDayRest ? [] : placement.taken,
        lockMovedFrom: wholeDayRest ? null : placement.lockMovedFrom,
        restSlots,
      });
    }
    if (rotation) {
      out[rider.id].rotationSlots = slots.map((slot) => slot.rotation ?? null);
      out[rider.id].restSlots = slots.flatMap((slot, index) => !slot.rotation && slot.intensity === "rest" ? [index] : []);
      out[rider.id].recoverySlots = slots.flatMap((slot, index) => slot.recovery ? [index] : []);
      out[rider.id].nextRotationIndex = rotationProgress(rotation, previousRotationReceipts, rotationReceipts).index;
    }
    // #7982: felter med kvittering er koert (fx loebets session efter etapen) og kan ikke aendres.
    if (ranSlots) out[rider.id].ranSlots = days.flatMap((day, index) => (riderReceipts.some((row) => row.game_day === day) ? [index] : []));
  }
  return out;
}

// ── Ren kerne: bindinger + planlagte etaper fra race_entry_days ─────────────
// #5949: a rider who abandoned his race is bound up to and including his exit
// day, then follows the plan again (same rule as the engine's binding). Rows
// after the exit day are dropped BEFORE both outputs, so the forecast neither
// rests him nor plans a stage he will not ride.
export function forecastBindingsFromEntryDays({ entryDays = [], schedule = [], profiles = [], exits = new Map() }) {
  const active = dropBindingsAfterRaceExit(entryDays, exits);
  const plannedStages = [];
  for (const entry of active) {
    const stage = schedule.find((row) => row.race_id === entry.race_id && Number(row.game_day) === Number(entry.game_day));
    if (!stage) continue;
    const profile = profiles.find((row) => row.race_id === stage.race_id && Number(row.stage_number) === Number(stage.stage_number));
    plannedStages.push({ rider_id: entry.rider_id, game_day: Number(entry.game_day), profile_type: profile?.profile_type ?? null });
  }
  const boundRiderIdsByGameDay = new Map();
  for (const entry of active) {
    const day = Number(entry.game_day);
    if (!boundRiderIdsByGameDay.has(day)) boundRiderIdsByGameDay.set(day, new Set());
    boundRiderIdsByGameDay.get(day).add(entry.rider_id);
  }
  return { plannedStages, boundRiderIdsByGameDay };
}

async function rows(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

// Read the saved lineup just as date readiness does. A synthetic binding is
// limited to the stage itself: it must never create a stage-race rest day.
async function loadSelectedStageFields({ supabase, team, seasonId, tickDate, stages, dateGameDays, riderIds }) {
  const youthDivisions = [team.u23_league_division_id, team.junior_league_division_id]
    .filter((id) => id && id !== team.league_division_id);
  const { start, end } = trainingDateBounds(tickDate);
  // pagination-safe: one calendar date across at most two youth pools.
  const youthStages = youthDivisions.length ? await rows(supabase.from("race_stage_schedule")
    .select("race_id, stage_number, game_day, scheduled_at, races!inner(season_id, league_division_id)")
    .eq("races.season_id", seasonId).in("races.league_division_id", youthDivisions)
    .gte("scheduled_at", start.toISOString()).lt("scheduled_at", end.toISOString()), "forecast youth stages") : [];
  const dateDays = new Set(dateGameDays);
  const stagesByRace = new Map();
  for (const stage of [...stages, ...youthStages]) {
    if (!dateDays.has(Number(stage.game_day))) continue;
    if (!stagesByRace.has(stage.race_id)) stagesByRace.set(stage.race_id, []);
    stagesByRace.get(stage.race_id).push(stage);
  }
  if (!stagesByRace.size) return [];
  // pagination-safe: one team, one calendar date, at most a roster per stage.
  const selected = await rows(supabase.from("race_entries").select("race_id, rider_id")
    .eq("team_id", team.id).in("rider_id", riderIds).in("race_id", [...stagesByRace.keys()]), "forecast selected stages");
  return selected.flatMap((entry) => stagesByRace.get(entry.race_id).map((stage) => ({ ...entry, game_day: stage.game_day })));
}

function showRecordedFatigue(entry, condition) {
  const fatigue = condition?.fatigue;
  if (!Number.isFinite(fatigue)) return entry;
  return { ...entry, fatigue, band: forecastBand(fatigue), fatigueIsActual: true };
}

// Et opslags udfald som vaerdi: et opslag, der er sendt men ikke bruges, kan ikke vaelte noget.
const settle = (promise) => Promise.resolve(promise).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
const unwrap = (outcome) => {
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
};

// ── I/O: hele holdets prognose for i dag ─────────────────────────────────────
// Returnerer { available, reason?, tickDate, riders: { <id>: { fatigue, band } } }.
// `settled: true` naar datoen allerede er gjort op; saa er tallet aftenens
// faktiske traethed, ikke en prognose.
export async function loadTeamFatigueForecast({ supabase, team, seasonId, now = new Date() }) {
  const tickDate = copenhagenDateString(now);
  const previousDate = previousDateString(tickDate);
  const base = { tickDate, riders: {} };
  if (!seasonId) return { ...base, available: false, reason: "no_active_season" };
  if (!team?.league_division_id) return { ...base, available: false, reason: "no_division" };
  if (!(await isTrainingConditionPerDateEnabled(supabase))) return { ...base, available: false, reason: "condition_per_date_off" };

  // #7801 svartid: opslag, der ikke afhaenger af hinanden, sendes i samme runde. Hvert svar
  // gemmes som udfald (settle), saa et opslag, der ikke bruges, aldrig kan vaelte forecasten,
  // og saa en fejl rejses paa praecis samme sted og i samme raekkefoelge som foer (unwrap).
  const closeP = settle(resolveDayCloseStatus({ supabase, seasonId, now, divisionId: team.league_division_id, includeStages: true }));
  // pagination-safe: one team roster (senior + academy), far below the 1000-row cap.
  const ridersP = settle(rows(supabase.from("riders").select("id, primary_type").eq("team_id", team.id).eq("is_retired", false), "forecast riders"));
  const conditionModelV2P = settle(isConditionModelV2Enabled(supabase)); // #6984 (I5)

  const close = unwrap(await closeP);
  const dateGameDays = [...new Set((close.gameDays ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (dateGameDays.length !== FORECAST_SLOTS) return { ...base, available: false, reason: "no_full_date" };

  const riders = unwrap(await ridersP);
  const riderIds = riders.map((rider) => rider.id);
  if (!riderIds.length) return { ...base, available: true, riders: {} };

  // Modellens svar er kommet med i foerste runde. Lægeopslag og kontakter, der kun bruges under
  // modellen, sendes nu sammen med resten; er modellen slukket (eller kan ikke laeses), sendes de ikke.
  const modelOutcome = await conditionModelV2P;
  const modelOn = modelOutcome.ok && !!modelOutcome.value;
  const medicalBonusP = modelOn ? settle(loadTeamMedicalBonus(supabase, team.id)) : null;
  const raceDateTrainingDayP = modelOn ? settle(isRaceDateTrainingDayEnabled(supabase)) : null; // #7536
  const fatigueNowP = modelOn ? settle(isFatigueNow7801Enabled(supabase)) : null; // #7801, samme gate som motoren
  // Motorens regler og straks-tilstandene afhaenger kun af holdet og datoen: de sendes med.
  const rulesP = fatigueRulesForForecast(supabase, team.id, riderIds, tickDate);
  const instantP = settle(loadInstantConditions({ supabase, riderIds, tickDate, failOpenWhenOff: true }));
  const [conditions, abilities, plans, weekRows, receipts, loads, workRows, boundEntryDays, raceDayEngineOn, cellsOn, catalogV3, selectedStageFields] = await Promise.all([
    rows(supabase.from("rider_condition").select("*").in("rider_id", riderIds), "forecast condition"),
    rows(supabase.from("rider_derived_abilities").select("rider_id, recovery").in("rider_id", riderIds), "forecast recovery"),
    rows(supabase.from("training_plans").select("rider_id, focus, intensity").eq("team_id", team.id).eq("season_id", seasonId), "forecast plans"),
    // schema-columns-ok: plan_kind was added by the merged #8577 rotation migration.
    rows(supabase.from("training_week_plans").select("rider_id, days, plan_kind").eq("team_id", team.id), "forecast week plans"),
    // pagination-safe: roster x five game days.
    rows(supabase.from("training_rider_ticks").select("rider_id, game_day, tick_date, team_id, report").eq("season_id", seasonId).in("game_day", dateGameDays).in("rider_id", riderIds), "forecast receipts"),
    // pagination-safe: roster x five game days.
    rows(supabase.from("training_race_loads").select("*").eq("season_id", seasonId).eq("tick_date", tickDate).in("rider_id", riderIds), "forecast race loads"),
    rows(supabase.from("training_date_work").select("tick_date, opening_conditions, status, expected_rider_ids, updated_at").eq("team_id", team.id).eq("season_id", seasonId).in("tick_date", [previousDate, tickDate]), "forecast date work"),
    // pagination-safe: roster x five game days, UNIQUE (rider_id, season_id, game_day).
    rows(supabase.from("race_entry_days").select("rider_id, race_id, game_day").eq("season_id", seasonId).in("game_day", dateGameDays).in("rider_id", riderIds), "forecast bindings"),
    isRaceDayEngineEnabled(supabase),
    cellsGateForTeam(supabase, team.id),
    catalogV3GateForTeam(supabase, team.id),
    loadSelectedStageFields({ supabase, team, seasonId, tickDate, stages: close.stages ?? [], dateGameDays, riderIds }),
  ]);

  const instant = unwrap(await instantP);
  const work = workRows.find((row) => row.tick_date === tickDate);
  const previousWork = workRows.find((row) => row.tick_date === previousDate);
  // Switching civil dates alone does not publish a new number. Keep the last
  // result until today's motor work is visible. A late close stays on its
  // recorded result until today's training work starts.
  const dayStart = trainingDateBounds(tickDate).start;
  const showPrevious = previousWork &&
    (previousWork.status === "pending" || previousWork.status === "partial"
      || (!work && (!close.hasRecordedStage || Date.parse(previousWork.updated_at) >= dayStart.getTime())));
  // The first sweep can be late enough that yesterday has not registered work.
  // Only carry an unregistered date for a team the motor expected on that date.
  const unregisteredPrevious = !previousWork && !work && !close.hasRecordedStage && team.created_at
    && isTrainingDateTeam(team, new Set(), dayStart)
    && (await resolveDayCloseStatus({ supabase, seasonId, divisionId: team.league_division_id,
      now: new Date(dayStart.getTime() - 1) })).gameDays.length > 0;
  const previousRiders = new Set(unregisteredPrevious ? riderIds : showPrevious ? previousWork.expected_rider_ids ?? [] : []);
  const openingByRider = new Map(Object.entries(work?.opening_conditions ?? {}));
  for (const [id, opening] of instant.openingByRider) openingByRider.set(id, opening);
  const conditionByRider = new Map(conditions.map((row) => [row.rider_id, row]));
  const dateReceipts = receipts.filter((row) => row.tick_date === tickDate);
  const programCellsOn = cellsOn && weekRows.some((row) => weekDaysHaveSessions(row.days));
  const weekPriority = programCellsOn && weekRows.some((row) => row.plan_kind === "week")
    ? await weekPriorityGateForTeam(supabase, team.id)
    : false;
  const rotationByRider = await loadRotationPlans({ supabase, teamId: team.id, weekRows, riderIds, plans });
  const rotationReceiptsByRider = await loadRotationReceipts({ supabase, teamId: team.id, tickDate, rotationByRider, dateReceipts });
  // A completed current-team roster says nothing about an acquired rider's
  // still-open date under the original team's durable stamp.
  const hasUnsettledInstant = [...instant.keys()].some(id => !instant.settledRiderIds.has(id));
  const settled = !hasUnsettledInstant && (work?.status === "complete" || riderIds.every((id) => dateGameDays.every((day) => dateReceipts.some((row) => row.rider_id === id && row.game_day === day))));
  if (settled && !weekPriority && !rotationByRider.size) {
    const actual = {};
    for (const id of riderIds) {
      const fatigue = Number(conditionByRider.get(id)?.fatigue);
      if (Number.isFinite(fatigue)) actual[id] = { fatigue, band: forecastBand(fatigue) };
    }
    return { ...base, available: true, settled: true, riders: actual };
  }

  // #7982: kontakten laeses kun, naar en kvittering findes paa en aaben dato (ellers er intet
  // koert at vise), og samtidig med etapeopslagene, saa en almindelig dag er uaendret.
  const settleRaceSessionP = !settled && dateReceipts.length ? settle(isTrainingSettleRaceSessionEnabled(supabase)) : null;

  // Week blocks and Rotation use the engine's start field release. A known
  // non-starter's slots are available for training.
  const boundSlots = new Set(boundEntryDays.map((row) => `${row.rider_id}:${row.game_day}`));
  const unboundSelections = selectedStageFields.filter((row) => !boundSlots.has(`${row.rider_id}:${row.game_day}`));
  const [withdrawnRaceIds, keptSelections, keptBindings] = await Promise.all([
    loadWithdrawnRaceIdsForTeam({ supabase, teamId: team.id, raceIds: unboundSelections.map((row) => row.race_id) }),
    releaseForecastNonStarters(supabase, unboundSelections),
    weekPriority || rotationByRider.size
      ? releaseForecastNonStarters(supabase, boundEntryDays, weekPriority ? null : rotationByRider)
      : boundEntryDays,
  ]);
  const stillEntered = (row) => !withdrawnRaceIds.has(row.race_id);
  const entryDays = [...keptBindings, ...keptSelections.filter(stillEntered)];
  // Planlagte etaper: bindingens loeb har en etape paa netop den loebsdag.
  const raceIds = [...new Set(entryDays.map((row) => row.race_id).filter(Boolean))];
  // A later stage can still be pending after the first start field released the rider's binding.
  const pendingEntries = settled ? [] : [
    ...boundEntryDays.filter((row) => weekPriority || rotationByRider.has(row.rider_id)),
    ...unboundSelections.filter(stillEntered),
  ];
  const scheduledRaceIds = [...new Set([...raceIds, ...pendingEntries.map((row) => row.race_id).filter(Boolean)])];
  const divisionRaceIds = new Set(close.divisionRaceIds ?? []);
  const outsideDivision = scheduledRaceIds.filter((id) => !divisionRaceIds.has(id));
  const scheduledIds = new Set(scheduledRaceIds);
  const gameDays = new Set(dateGameDays);
  const divisionSchedule = (close.stages ?? []).filter((stage) =>
    scheduledIds.has(stage.race_id) && gameDays.has(Number(stage.game_day)));
  const [otherSchedule, profiles, exits] = scheduledRaceIds.length
    ? await Promise.all([
      // pagination-safe: a few bound races x five game days.
      outsideDivision.length ? rows(supabase.from("race_stage_schedule").select("race_id, stage_number, game_day, scheduled_at").in("race_id", outsideDivision).in("game_day", dateGameDays), "forecast stage schedule") : [],
      // pagination-safe: a few bound races, at most 21 stages each.
      raceIds.length ? rows(supabase.from("race_stage_profiles").select("race_id, stage_number, profile_type").in("race_id", raceIds), "forecast stage profiles") : [],
      // #5949: same exit lookup as the engine's binding (I5: no copy of the rule).
      loadRaceExitGameDays({ supabase, rows: entryDays }).then(({ data, error }) => {
        if (error) throw new Error(`forecast race exits: ${error.message ?? error}`);
        return data;
      }),
    ])
    : [[], [], new Map()];
  const schedule = [...divisionSchedule, ...otherSchedule];
  const { plannedStages, boundRiderIdsByGameDay } = forecastBindingsFromEntryDays({ entryDays, schedule, profiles, exits });
  const keptEntries = new Set(entryDays);
  const overdueByRider = pendingEntries.length ? await loadOverdueForecastStages({
    supabase, now, tickDate, schedule, entries: pendingEntries.filter((entry) => !keptEntries.has(entry) || plannedStages.some((stage) =>
      stage.rider_id === entry.rider_id && stage.game_day === Number(entry.game_day))),
  }) : new Map();

  const { fatigueRules, stageYesterdayRiderIds } = await rulesP;
  // #6984 (I5): prognosen regner med samme model som aftenens opgoerelse.
  const conditionModelV2 = unwrap(modelOutcome);
  const medicalBonus = conditionModelV2 ? unwrap(await medicalBonusP) : 0;
  const raceDateTrainingDay = conditionModelV2 ? unwrap(await raceDateTrainingDayP) : false; // #7536
  const fatigueNow = conditionModelV2 ? unwrap(await fatigueNowP) : false; // #7801, samme gate som motoren
  // Fejl i opslaget = slukket (readFlagStage giver null), som delkoerslen selv.
  const settleRaceSession = settleRaceSessionP ? (await settleRaceSessionP).value === true : false;
  // #7947: som motoren laeses kontakten kun, naar programcellerne laeses (fejl = slukket).
  const effortLevels = programCellsOn || rotationByRider.size ? await isTrainingEffortLevelsEnabled(supabase) : false;
  const forecast = buildTeamFatigueForecast({
    conditionModelV2,
    fatigueNow,
    medicalBonus,
    raceDateTrainingDay,
    fatigueRules,
    stageYesterdayRiderIds,
    tickDate, seasonId, dateGameDays, riders: riders.filter(r => !instant.incompleteRiderIds.has(r.id)),
    conditionByRider,
    openingByRider,
    recoveryByRider: new Map(abilities.map((row) => [row.rider_id, row.recovery])),
    planByRider: new Map(plans.map((row) => [row.rider_id, row])),
    teamWeekDays: weekRows.find((row) => row.rider_id == null)?.days ?? null,
    riderWeekDaysByRider: new Map(weekRows.filter((row) => row.rider_id != null).map((row) => [row.rider_id, row.days])),
    receipts: dateReceipts,
    recordedLoads: loads,
    plannedStages,
    boundRiderIdsByGameDay,
    cellsOn: programCellsOn,
    raceDayEngineOn,
    catalogV3,
    ranSlots: settleRaceSession,
    effortLevels,
    weekPriority,
    overdueByRider,
    teamWeekRow: weekRows.find((row) => row.rider_id == null) ?? null,
    riderWeekRowByRider: new Map(weekRows.filter((row) => row.rider_id != null).map((row) => [row.rider_id, row])),
    rotationByRider, rotationReceiptsByRider, teamId: team.id,
  });
  if (!settled) {
    for (const [id, entry] of Object.entries(forecast)) {
      if (previousRiders.has(id) || entry.pendingSlots?.length || overdueByRider.get(id)?.size) {
        forecast[id] = showRecordedFatigue(entry, conditionByRider.get(id));
      }
    }
  }
  if (settled) {
    for (const id of riderIds) {
      const fatigue = Number(conditionByRider.get(id)?.fatigue);
      if (!Number.isFinite(fatigue)) { delete forecast[id]; continue; }
      const fields = forecast[id]?.fieldSource || rotationByRider.has(id) ? forecast[id] : {};
      forecast[id] = { ...fields, fatigue, band: forecastBand(fatigue) };
    }
  }
  return {
    ...base, available: true, settled, riders: forecast,
    // #7982: skaermen ved, at loebets session afregnes efter etapen, og om traetheden lige nu viser loebet.
    ...(!settled && settleRaceSession ? { raceSessionSettle: { fatigueNow } } : {}),
  };
}

// Only this team's overdue scheduled fields are relevant. A saved start field
// overrides the binding, as in trainingDateReadiness, and a recorded result wins.
async function loadOverdueForecastStages({ supabase, now, tickDate, schedule, entries }) {
  const overdue = schedule.filter((stage) => {
    const scheduledAt = new Date(stage.scheduled_at ?? Number.NaN);
    return scheduledAt < now && copenhagenDateString(scheduledAt) === tickDate
      && entries.some((entry) => entry.race_id === stage.race_id && Number(entry.game_day) === Number(stage.game_day));
  });
  const out = new Map();
  if (!overdue.length) return out;
  // pagination-safe: one row per bound race, scoped to one team's overdue fields.
  const races = await rows(supabase.from("races").select("id, race_type, stages_completed")
    .in("id", [...new Set(overdue.map((stage) => stage.race_id))]), "forecast overdue races");
  const raceById = new Map(races.map((race) => [race.id, race]));
  const open = overdue.filter((stage) => {
    const race = raceById.get(stage.race_id);
    return race && Number(race.stages_completed) < Number(stage.stage_number);
  });
  if (!open.length) return out;
  const raceIds = [...new Set(open.map((stage) => stage.race_id))];
  const stageNumbers = [...new Set(open.map((stage) => stage.stage_number))];
  const riderIds = [...new Set(entries.filter((entry) => raceById.has(entry.race_id)).map((entry) => entry.rider_id))];
  const [runs, results] = await Promise.all([
    // pagination-safe: one run per race and stage, scoped to overdue stages of one team.
    rows(supabase.from("race_simulation_runs").select("race_id, stage_number, entrant_snapshot")
      .in("race_id", raceIds).in("stage_number", stageNumbers), "forecast overdue start fields"),
    fetchAllRows(() => supabase.from("race_results").select("race_id, stage_number, rider_id, result_type")
      .in("race_id", raceIds).in("stage_number", stageNumbers).in("rider_id", riderIds)
      .in("result_type", ["stage", "gc"]).order("id")),
  ]);
  for (const stage of open) {
    const sameStage = (row) => row.race_id === stage.race_id && Number(row.stage_number) === Number(stage.stage_number);
    const snapshot = stageEntrantSnapshotIds(runs.find(sameStage));
    const singleRace = raceById.get(stage.race_id).race_type === "single";
    for (const entry of entries) {
      if (entry.race_id !== stage.race_id || Number(entry.game_day) !== Number(stage.game_day)) continue;
      if (snapshot && !snapshot.includes(entry.rider_id)) continue;
      if (results.some((row) => sameStage(row) && row.rider_id === entry.rider_id
        && (row.result_type === "stage" || singleRace))) continue;
      if (!out.has(entry.rider_id)) out.set(entry.rider_id, new Set());
      out.get(entry.rider_id).add(Number(stage.game_day));
    }
  }
  return out;
}

// #8549 fund E: motorens startfelt-frigivelse (I5: ingen kopi af reglen). Som udgangen af loeb
// rejses en fejl her, saa prognosen aldrig viser en etape, motoren ikke regner med.
export async function releaseForecastNonStarters(supabase, entryDays, rotations = null) {
  const relevant = rotations ? entryDays.filter((row) => rotations.has(row.rider_id)) : entryDays;
  const { data, error } = await releaseNonStarters(supabase, relevant);
  if (error) throw new Error(`forecast start fields: ${error.message ?? error}`);
  return rotations ? [...data, ...entryDays.filter((row) => !rotations.has(row.rider_id))] : data;
}

// Motorens regler (samme loader som dailyTrainingEngine.js). Motoren kaster ved
// fejl; prognosen er kun en visning, saa en fejl giver "ingen regel" frem for
// en vaeltet side. Etape-opslaget koeres kun naar en rytter har reglen sat.
async function fatigueRulesForForecast(supabase, teamId, riderIds, tickDate) {
  try {
    const fatigueRules = await loadTeamFatigueRules(supabase, teamId);
    const stageYesterdayRiderIds = fatigueRules && fatigueRules.anyAfterStage(riderIds)
      ? await loadRiderIdsWithStageOnDate(supabase, { riderIds, previousDate: previousDateString(tickDate) })
      : new Set();
    return { fatigueRules, stageYesterdayRiderIds };
  } catch {
    // best-effort: prognosen er kun en visning; ukendte regler = planens pas.
    return { fatigueRules: null, stageYesterdayRiderIds: new Set() };
  }
}

// Motorens gate for programceller (samme svar som isTrainingCellsEnabledForTeam
// giver dailyTrainingEngine.js). Fejl → false: prognosen er en visning, ikke en
// skrivning, og en ukendt gate maa aldrig vaelte siden.
// #5319: motorens katalog-gate (isTrainingCatalogV3EnabledForTeam). Fejl → off,
// samme begrundelse som cellsGateForTeam nedenfor.
export async function catalogV3GateForTeam(supabase, teamId) {
  try {
    return await isTrainingCatalogV3EnabledForTeam(supabase, teamId);
  } catch {
    // best-effort: prognosen er kun en visning; ukendt gate = dagens katalog.
    return false;
  }
}

// #8549 fund C: motorens gate for Week blocks. Motoren kaster ved en fejl i beta-opslaget og
// proever datoen igen; prognosen er en visning, saa en fejl giver dagens felter.
async function weekPriorityGateForTeam(supabase, teamId) {
  try {
    return await isTrainingWeekPriorityEnabledForTeam(supabase, teamId);
  } catch {
    // best-effort: prognosen er kun en visning; ukendt gate = ugen uden Week blocks.
    return false;
  }
}

async function cellsGateForTeam(supabase, teamId) {
  try {
    return await isTrainingCellsEnabledForTeam(supabase, teamId);
  } catch {
    // best-effort: prognosen er kun en visning; ukendt gate = gamle intensiteter.
    return false;
  }
}
