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

import { settleTrainingDateCondition } from "./trainingDateCondition.js";
import { CONDITION_CONFIG, RACE_DAY_ENGINE_RECOVERY_CONFIG } from "./riderCondition.js";
import { raceConditionLoads } from "./raceFatigue.js";
import { resolveDayProgram, programSlotForRaceDay, weekDaysHaveSessions } from "./trainingPrograms.js";
import { resolveProgram } from "./dailyTraining.js";
import { isInjuredOnRaceDay } from "./injuryRaceDays.js";
import { copenhagenDateString, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { resolveDayCloseStatus } from "./trainingDayCloseTrigger.js";
import { isRaceDayEngineEnabled } from "./raceDayEngineFlag.js";
import { isTrainingConditionPerDateEnabled } from "./trainingDateConditionFlag.js";
import { isTrainingCellsEnabledForTeam } from "./trainingWeekPlanCellsFlag.js";

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
  injured = false, boundRestDate = false, planIntensity,
}) {
  if (receipt) {
    // Samme valg som motorens priorDateReports-linje.
    if (recordedLoad != null) return { intensity: "race", raceLoad: Number(recordedLoad) };
    return { intensity: receipt.report?.intensity ?? planIntensity, raceLoad: 0 };
  }
  if (recordedLoad != null) return { intensity: "race", raceLoad: Number(recordedLoad) };
  if (plannedStageProfile) {
    const [estimate] = raceConditionLoads([riderId], plannedStageProfile);
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
export function forecastRiderFatigue({ riderId, dateStr, opening, slots, recoveryAbility = 50, recoveryConfig = RACE_DAY_ENGINE_RECOVERY_CONFIG }) {
  if (!Array.isArray(slots) || slots.length !== FORECAST_SLOTS) return null;
  try {
    const settled = settleTrainingDateCondition({
      riderId, dateStr,
      condition: { fatigue: Number(opening?.fatigue ?? 0), form: Number(opening?.form ?? 50) },
      intensities: slots.map((slot) => slot.intensity),
      raceLoads: slots.map((slot) => (slot.intensity === "race" ? Number(slot.raceLoad ?? 0) : 0)),
      recoveryAbility,
      recoveryConfig,
    });
    return settled.fatigue;
  } catch {
    // Et felt med en ukendt intensitet (fx et ufaerdigt bevis) giver ingen
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
  cellsOn = false, raceDayEngineOn = true,
}) {
  const days = [...new Set((dateGameDays ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (days.length !== FORECAST_SLOTS) return {};
  const weekday = copenhagenWeekdayKey(tickDate);
  const recoveryConfig = raceDayEngineOn ? RACE_DAY_ENGINE_RECOVERY_CONFIG : {};
  const out = {};
  for (const rider of riders ?? []) {
    const cond = conditionByRider.get(rider.id) ?? { form: 50, fatigue: 0 };
    const opening = openingByRider.get(rider.id) ?? cond;
    const plan = planByRider.get(rider.id) ?? null;
    const program = resolveProgram(plan, rider.primary_type);
    const hasExplicitPlan = !!(plan?.focus && plan?.intensity);
    const riderReceipts = receipts.filter((row) => row.rider_id === rider.id);
    const firstReport = days.map((day) => riderReceipts.find((row) => row.game_day === day)).find(Boolean)?.report;
    const recoveryAbility = firstReport?.recovery_before_date ?? recoveryByRider.get(rider.id) ?? 50;
    const hasStageOnDate = plannedStages.some((row) => row.rider_id === rider.id)
      || recordedLoads.some((row) => row.rider_id === rider.id);
    const slots = days.map((day) => {
      const slotIndex = programSlotForRaceDay(day, days);
      const planIntensity = resolveDayProgram({
        weekday, slotIndex,
        riderOverrideDays: riderWeekDaysByRider.get(rider.id) ?? null,
        teamWeekDays, program, hasExplicitPlan, programsOn: cellsOn,
      }).intensity;
      const recorded = recordedLoads.find((row) => row.rider_id === rider.id && Number(row.game_day) === day && row.duplicate_of_race_id == null);
      const planned = plannedStages.find((row) => row.rider_id === rider.id && Number(row.game_day) === day);
      const bound = boundRiderIdsByGameDay.get(day)?.has(rider.id) ?? false;
      return forecastSlotActivity({
        riderId: rider.id,
        receipt: riderReceipts.find((row) => row.game_day === day) ?? null,
        recordedLoad: recorded ? recorded.load : null,
        plannedStageProfile: planned ? (planned.profile_type ?? "rolling") : null,
        injured: isInjuredOnRaceDay({ condition: cond, seasonId, gameDay: day, tickDate }),
        boundRestDate: bound && !hasStageOnDate,
        planIntensity,
      });
    });
    const fatigue = forecastRiderFatigue({ riderId: rider.id, dateStr: tickDate, opening, slots, recoveryAbility, recoveryConfig });
    if (fatigue == null) continue;
    // raceSlots: dagens felter der er laast af et loeb (regel A). Gitteret viser
    // dem som etape; de oevrige felter er traening.
    const raceSlots = slots.flatMap((slot, index) => (slot.intensity === "race" ? [index] : []));
    out[rider.id] = { fatigue, band: forecastBand(fatigue), raceSlots };
  }
  return out;
}

async function rows(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

// ── I/O: hele holdets prognose for i dag ─────────────────────────────────────
// Returnerer { available, reason?, tickDate, riders: { <id>: { fatigue, band } } }.
// `settled: true` naar datoen allerede er gjort op; saa er tallet aftenens
// faktiske traethed, ikke en prognose.
export async function loadTeamFatigueForecast({ supabase, team, seasonId, now = new Date() }) {
  const tickDate = copenhagenDateString(now);
  const base = { tickDate, riders: {} };
  if (!seasonId) return { ...base, available: false, reason: "no_active_season" };
  if (!team?.league_division_id) return { ...base, available: false, reason: "no_division" };
  if (!(await isTrainingConditionPerDateEnabled(supabase))) return { ...base, available: false, reason: "condition_per_date_off" };

  const close = await resolveDayCloseStatus({ supabase, seasonId, now, divisionId: team.league_division_id });
  const dateGameDays = [...new Set((close.gameDays ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (dateGameDays.length !== FORECAST_SLOTS) return { ...base, available: false, reason: "no_full_date" };

  // pagination-safe: one team roster (senior + academy), far below the 1000-row cap.
  const riders = await rows(supabase.from("riders").select("id, primary_type").eq("team_id", team.id).eq("is_retired", false), "forecast riders");
  const riderIds = riders.map((rider) => rider.id);
  if (!riderIds.length) return { ...base, available: true, riders: {} };

  const [conditions, abilities, plans, weekRows, receipts, loads, workRows, entryDays, raceDayEngineOn, cellsOn] = await Promise.all([
    rows(supabase.from("rider_condition").select("*").in("rider_id", riderIds), "forecast condition"),
    rows(supabase.from("rider_derived_abilities").select("rider_id, recovery").in("rider_id", riderIds), "forecast recovery"),
    rows(supabase.from("training_plans").select("rider_id, focus, intensity").eq("team_id", team.id).eq("season_id", seasonId), "forecast plans"),
    rows(supabase.from("training_week_plans").select("rider_id, days").eq("team_id", team.id), "forecast week plans"),
    // pagination-safe: roster x five game days.
    rows(supabase.from("training_rider_ticks").select("rider_id, game_day, tick_date, report").eq("season_id", seasonId).in("game_day", dateGameDays).in("rider_id", riderIds), "forecast receipts"),
    // pagination-safe: roster x five game days.
    rows(supabase.from("training_race_loads").select("*").eq("season_id", seasonId).eq("tick_date", tickDate).in("rider_id", riderIds), "forecast race loads"),
    rows(supabase.from("training_date_work").select("opening_conditions, status").eq("team_id", team.id).eq("season_id", seasonId).eq("tick_date", tickDate).limit(1), "forecast date work"),
    // pagination-safe: roster x five game days, UNIQUE (rider_id, season_id, game_day).
    rows(supabase.from("race_entry_days").select("rider_id, race_id, game_day").eq("season_id", seasonId).in("game_day", dateGameDays).in("rider_id", riderIds), "forecast bindings"),
    isRaceDayEngineEnabled(supabase),
    weekRowsHaveSessionsAsync(supabase, team.id),
  ]);

  const work = workRows[0] ?? null;
  const conditionByRider = new Map(conditions.map((row) => [row.rider_id, row]));
  const dateReceipts = receipts.filter((row) => row.tick_date === tickDate);
  const settled = work?.status === "complete" || riderIds.every((id) => dateGameDays.every((day) => dateReceipts.some((row) => row.rider_id === id && row.game_day === day)));
  if (settled) {
    const actual = {};
    for (const id of riderIds) {
      const fatigue = Number(conditionByRider.get(id)?.fatigue);
      if (Number.isFinite(fatigue)) actual[id] = { fatigue, band: forecastBand(fatigue) };
    }
    return { ...base, available: true, settled: true, riders: actual };
  }

  // Planlagte etaper: bindingens loeb har en etape paa netop den loebsdag.
  const raceIds = [...new Set(entryDays.map((row) => row.race_id).filter(Boolean))];
  const [schedule, profiles] = raceIds.length
    ? await Promise.all([
      // pagination-safe: a few bound races x five game days.
      rows(supabase.from("race_stage_schedule").select("race_id, stage_number, game_day").in("race_id", raceIds).in("game_day", dateGameDays), "forecast stage schedule"),
      // pagination-safe: a few bound races, at most 21 stages each.
      rows(supabase.from("race_stage_profiles").select("race_id, stage_number, profile_type").in("race_id", raceIds), "forecast stage profiles"),
    ])
    : [[], []];
  const plannedStages = [];
  for (const entry of entryDays) {
    const stage = schedule.find((row) => row.race_id === entry.race_id && Number(row.game_day) === Number(entry.game_day));
    if (!stage) continue;
    const profile = profiles.find((row) => row.race_id === stage.race_id && Number(row.stage_number) === Number(stage.stage_number));
    plannedStages.push({ rider_id: entry.rider_id, game_day: Number(entry.game_day), profile_type: profile?.profile_type ?? null });
  }
  const boundRiderIdsByGameDay = new Map();
  for (const entry of entryDays) {
    const day = Number(entry.game_day);
    if (!boundRiderIdsByGameDay.has(day)) boundRiderIdsByGameDay.set(day, new Set());
    boundRiderIdsByGameDay.get(day).add(entry.rider_id);
  }

  const forecast = buildTeamFatigueForecast({
    tickDate, seasonId, dateGameDays, riders,
    conditionByRider,
    openingByRider: new Map(Object.entries(work?.opening_conditions ?? {})),
    recoveryByRider: new Map(abilities.map((row) => [row.rider_id, row.recovery])),
    planByRider: new Map(plans.map((row) => [row.rider_id, row])),
    teamWeekDays: weekRows.find((row) => row.rider_id == null)?.days ?? null,
    riderWeekDaysByRider: new Map(weekRows.filter((row) => row.rider_id != null).map((row) => [row.rider_id, row.days])),
    receipts: dateReceipts,
    recordedLoads: loads,
    plannedStages,
    boundRiderIdsByGameDay,
    cellsOn: cellsOn && weekRows.some((row) => weekDaysHaveSessions(row.days)),
    raceDayEngineOn,
  });
  return { ...base, available: true, settled: false, riders: forecast };
}

// Motorens gate for programceller (samme svar som isTrainingCellsEnabledForTeam
// giver dailyTrainingEngine.js). Fejl → false: prognosen er en visning, ikke en
// skrivning, og en ukendt gate maa aldrig vaelte siden.
async function weekRowsHaveSessionsAsync(supabase, teamId) {
  try {
    return await isTrainingCellsEnabledForTeam(supabase, teamId);
  } catch {
    return false;
  }
}
