// #5933 · "Traethed i aften: ca. X". Invariant I5: prognosen er aftenopgoerelsens
// egen beregning, ikke en kopi. Testene beviser at en UAENDRET plan giver
// praecis det tal settleTrainingDateCondition (aftenopgoerelsen) skriver.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTeamFatigueForecast, forecastBand, forecastRiderFatigue, forecastSlotActivity,
} from "./trainingWeekPlanForecast.js";
import { settleTrainingDateCondition } from "./trainingDateCondition.js";
import { CONDITION_CONFIG, RACE_DAY_ENGINE_RECOVERY_CONFIG } from "./riderCondition.js";
import { raceConditionLoads } from "./raceFatigue.js";
import { programWeekDaysFor, setProgramCell, intensityForSession } from "./trainingPrograms.js";

const TICK_DATE = "2026-10-01"; // torsdag
const DAYS = [41, 42, 43, 44, 45];
const SEASON = "s4";

function base(overrides = {}) {
  return {
    tickDate: TICK_DATE, seasonId: SEASON, dateGameDays: DAYS,
    riders: [{ id: "r1", primary_type: "sprinter" }],
    conditionByRider: new Map([["r1", { fatigue: 55, form: 50 }]]),
    recoveryByRider: new Map([["r1", 60]]),
    cellsOn: true,
    ...overrides,
  };
}

function settle(intensities, raceLoads = [0, 0, 0, 0, 0], opening = { fatigue: 55, form: 50 }) {
  return settleTrainingDateCondition({
    riderId: "r1", dateStr: TICK_DATE, condition: opening, intensities, raceLoads,
    recoveryAbility: 60, recoveryConfig: RACE_DAY_ENGINE_RECOVERY_CONFIG,
  }).fatigue;
}

test("I5: uaendret plan uden loeb == aftenopgoerelsens traethed", () => {
  const days = programWeekDaysFor("sprinter");
  const thu = intensityForSession(days.thu.session);
  const out = buildTeamFatigueForecast(base({ riderWeekDaysByRider: new Map([["r1", days]]) }));
  assert.equal(out.r1.fatigue, settle([thu, thu, thu, thu, thu]));
});

test("I5: afregnede felter + registreret etape + planlagt etape == aftenopgoerelsen", () => {
  const days = programWeekDaysFor("sprinter");
  const thu = intensityForSession(days.thu.session);
  const plannedLoad = raceConditionLoads(["r1"], "mountain")[0].load;
  const receipts = [
    { rider_id: "r1", game_day: 41, tick_date: TICK_DATE, report: { intensity: "easy", recovery_before_date: 60 } },
    { rider_id: "r1", game_day: 42, tick_date: TICK_DATE, report: { intensity: "race" } },
  ];
  const out = buildTeamFatigueForecast(base({
    riderWeekDaysByRider: new Map([["r1", days]]),
    receipts,
    recordedLoads: [{ rider_id: "r1", game_day: 42, load: 14, duplicate_of_race_id: null }],
    plannedStages: [{ rider_id: "r1", game_day: 44, profile_type: "mountain" }],
    boundRiderIdsByGameDay: new Map([[44, new Set(["r1"])]]),
  }));
  assert.equal(out.r1.fatigue, settle(["easy", "race", thu, "race", thu], [0, 14, 0, plannedLoad, 0]));
});

test("live: et felt sat til restitution saenker prognosen, kun for den rytter", () => {
  const days = programWeekDaysFor("hard_block");
  const before = buildTeamFatigueForecast(base({ riderWeekDaysByRider: new Map([["r1", days]]) })).r1.fatigue;
  // torsdagens felt 2 og 4 = restitution (spillerens "2 felter restitution").
  let edited = setProgramCell(days, { weekday: "thu", slotIndex: 1, session: "recovery" });
  edited = setProgramCell(edited, { weekday: "thu", slotIndex: 3, session: "recovery" });
  const after = buildTeamFatigueForecast(base({ riderWeekDaysByRider: new Map([["r1", edited]]) })).r1.fatigue;
  assert.ok(after < before, `${after} < ${before}`);
});

test("regel A: bundet rytter med etape paa datoen traener de frie felter; GT-hviledag = hvile", () => {
  const days = programWeekDaysFor("sprinter");
  const thu = intensityForSession(days.thu.session);
  const plannedLoad = raceConditionLoads(["r1"], "flat")[0].load;
  const bound = new Map(DAYS.map((d) => [d, new Set(["r1"])]));
  const withStage = buildTeamFatigueForecast(base({
    riderWeekDaysByRider: new Map([["r1", days]]),
    plannedStages: [{ rider_id: "r1", game_day: 43, profile_type: "flat" }],
    boundRiderIdsByGameDay: bound,
  }));
  assert.equal(withStage.r1.fatigue, settle([thu, thu, "race", thu, thu], [0, 0, plannedLoad, 0, 0]));
  const restDay = buildTeamFatigueForecast(base({
    riderWeekDaysByRider: new Map([["r1", days]]),
    boundRiderIdsByGameDay: bound,
  }));
  assert.equal(restDay.r1.fatigue, settle(["rest", "rest", "rest", "rest", "rest"]));
});

test("skadet rytter hviler; ufuldstaendig dato giver ingen prognose", () => {
  const injured = buildTeamFatigueForecast(base({
    conditionByRider: new Map([["r1", { fatigue: 55, form: 50, injured_until: "2026-10-03" }]]),
  }));
  assert.equal(injured.r1.fatigue, settle(["rest", "rest", "rest", "rest", "rest"]));
  assert.deepEqual(buildTeamFatigueForecast(base({ dateGameDays: [41, 42] })), {});
  assert.equal(forecastRiderFatigue({ riderId: "r1", dateStr: TICK_DATE, opening: {}, slots: [] }), null);
});

test("aabningstilstanden fra datoens registrering vinder over den aktuelle", () => {
  const out = buildTeamFatigueForecast(base({
    openingByRider: new Map([["r1", { fatigue: 30, form: 50 }]]),
    riderWeekDaysByRider: new Map([["r1", programWeekDaysFor("recovery_week")]]),
  }));
  const thu = intensityForSession(programWeekDaysFor("recovery_week").thu.session);
  assert.equal(out.r1.fatigue, settle([thu, thu, thu, thu, thu], undefined, { fatigue: 30, form: 50 }));
});

test("felt-gate off: programfelter ignoreres, den gamle intensitet bruges (som motoren)", () => {
  const days = programWeekDaysFor("hard_block");
  const off = buildTeamFatigueForecast(base({ cellsOn: false, riderWeekDaysByRider: new Map([["r1", days]]) }));
  const intensity = days.thu.intensity; // raekken baerer ogsaa sin afledte intensitet
  assert.equal(off.r1.fatigue, settle([intensity, intensity, intensity, intensity, intensity]));
});

test("farvebaand foelger de eksisterende graenser (formzonens top, skadegraensen)", () => {
  assert.equal(forecastBand(CONDITION_CONFIG.formSweetHi), "ok");
  assert.equal(forecastBand(CONDITION_CONFIG.formSweetHi + 1), "warn");
  assert.equal(forecastBand(CONDITION_CONFIG.injuryFatigueFloor), "risk");
  assert.equal(forecastBand(null), null);
});

test("forecastSlotActivity: kvittering > registreret belastning > planlagt etape > skade > hviledag > plan", () => {
  assert.deepEqual(forecastSlotActivity({ riderId: "r1", receipt: { report: { intensity: "hard" } }, planIntensity: "easy" }), { intensity: "hard", raceLoad: 0 });
  assert.deepEqual(forecastSlotActivity({ riderId: "r1", recordedLoad: 9, injured: true, planIntensity: "easy" }), { intensity: "race", raceLoad: 9 });
  assert.equal(forecastSlotActivity({ riderId: "r1", plannedStageProfile: "flat", injured: true, planIntensity: "easy" }).intensity, "race");
  assert.equal(forecastSlotActivity({ riderId: "r1", injured: true, planIntensity: "hard" }).intensity, "rest");
  assert.equal(forecastSlotActivity({ riderId: "r1", boundRestDate: true, planIntensity: "hard" }).intensity, "rest");
  assert.equal(forecastSlotActivity({ riderId: "r1", planIntensity: "normal" }).intensity, "normal");
});
