// #7801 PR 2: faste, syntetiske scenarier for de træningsfunktioner, kontakten fatigue_now_7801
// rører (aftenens opgørelse inkl. skaderisiko, og prognosen med spillerens træthedsregler).
// Samme fil køres i merge-basen (før kontakten fandtes) og i den nye kode med kontakten
// slukket; kun hashes forlader modulet (hard rule 17). Ingen prod-data, ingen rng uden frø.
//
// Kør i merge-basen for at skrive facit:
//   node backend/lib/__fixtures__/fatigueNow7801FlagOffScenarios.js <sti-til-json>
// Genereres ALDRIG med den nye kode.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { settleTrainingDateCondition } from "../trainingDateCondition.js";
import { buildTeamFatigueForecast } from "../trainingWeekPlanForecast.js";

const SETTLE_COUNT = 500;
const FORECAST_COUNT = 300;
const TICK_DATE = "2026-11-04";
const GAME_DAYS = [41, 42, 43, 44, 45];

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
const pick = (next, values) => values[Math.floor(next() * values.length)];

const TRAINING = ["rest", "recovery", "easy", "normal", "hard"];
const FATIGUES = [0, 12, 33, 49, 58, 66, 71, 77, 84, 91, 99, 100];
const LOADS = [3, 7.5, 12, 18.25, 26, 39];
const RECOVERIES = [undefined, 30, 50, 64, 88];
const MEDICAL = [0, 1, 3, 5];
const FOCUSES = ["endurance", "vo2max", "sprint", "threshold", "recovery"];

function slotsFor(next) {
  const intensities = [];
  const raceLoads = [];
  for (let i = 0; i < 5; i++) {
    const race = next() < 0.3;
    intensities.push(race ? "race" : pick(next, TRAINING));
    raceLoads.push(race ? pick(next, LOADS) : 0);
  }
  return { intensities, raceLoads };
}

function settleScenario(seed) {
  const next = rng(seed);
  const { intensities, raceLoads } = slotsFor(next);
  return {
    riderId: `r-${seed}`, dateStr: TICK_DATE,
    condition: { fatigue: pick(next, FATIGUES), form: Math.floor(next() * 100) },
    intensities, raceLoads,
    recoveryAbility: pick(next, RECOVERIES) ?? 50,
    modelV2: next() < 0.7,
    medicalBonus: pick(next, MEDICAL),
    raceDateTrainingDay: next() < 0.5,
  };
}

function forecastScenario(seed) {
  const next = rng(seed * 7 + 3);
  const riders = Array.from({ length: 2 + Math.floor(next() * 4) }, (_, i) => ({ id: `r${i}`, primary_type: pick(next, ["climber", "sprinter", "rouleur", null]) }));
  const conditionByRider = new Map();
  const recoveryByRider = new Map();
  const planByRider = new Map();
  const recordedLoads = [];
  const plannedStages = [];
  const rules = new Map();
  const stageYesterdayRiderIds = new Set();
  for (const r of riders) {
    conditionByRider.set(r.id, { fatigue: pick(next, FATIGUES), form: 50, injured_until: null });
    recoveryByRider.set(r.id, pick(next, RECOVERIES) ?? 50);
    if (next() < 0.6) planByRider.set(r.id, { focus: pick(next, FOCUSES), intensity: pick(next, TRAINING) });
    for (const day of GAME_DAYS) {
      const roll = next();
      if (roll < 0.15) recordedLoads.push({ rider_id: r.id, game_day: day, load: pick(next, LOADS), duplicate_of_race_id: null });
      else if (roll < 0.25) plannedStages.push({ rider_id: r.id, game_day: day, profile_type: pick(next, ["flat", "hilly", "mountain", null]) });
    }
    if (next() < 0.7) {
      rules.set(r.id, {
        threshold: next() < 0.8 ? pick(next, [40, 55, 60, 70, 80]) : null,
        fallback: pick(next, ["light", "recovery", "rest"]),
        recoveryAfterStage: next() < 0.4,
      });
    }
    if (next() < 0.3) stageYesterdayRiderIds.add(r.id);
  }
  const conditionModelV2 = next() < 0.7;
  return {
    tickDate: TICK_DATE, seasonId: "s9", dateGameDays: GAME_DAYS, riders,
    conditionByRider, recoveryByRider, planByRider, recordedLoads, plannedStages,
    fatigueRules: next() < 0.85 ? { forRider: (id) => rules.get(id) ?? null, anyAfterStage: () => true } : null,
    stageYesterdayRiderIds, conditionModelV2,
    medicalBonus: conditionModelV2 ? pick(next, MEDICAL) : 0,
    raceDateTrainingDay: next() < 0.4,
  };
}

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function capture(fn) {
  try {
    return { ok: fn() };
  } catch (err) {
    // catch-ok: fejlteksten er en del af facit (samme fejl i begge kodebaser).
    return { error: String(err?.message ?? err) };
  }
}

/**
 * Digest pr. familie over alle scenarier i fast rækkefølge. `onArgs` bruges kun af testen til
 * at vise, at scenarierne rammer de grene, kontakten ændrer (merge-basen kender dem ikke).
 */
export function runScenarios({ onArgs = null } = {}) {
  const settle = [];
  for (let seed = 1; seed <= SETTLE_COUNT; seed++) {
    const args = settleScenario(seed);
    settle.push(capture(() => settleTrainingDateCondition(onArgs ? { ...args, ...onArgs.settle(args) } : args)));
  }
  const forecast = [];
  for (let seed = 1; seed <= FORECAST_COUNT; seed++) {
    const args = forecastScenario(seed);
    forecast.push(capture(() => buildTeamFatigueForecast(onArgs ? { ...args, ...onArgs.forecast } : args)));
  }
  return {
    settleCount: SETTLE_COUNT, settle: hash(settle),
    forecastCount: FORECAST_COUNT, forecast: hash(forecast),
    // Kvalitativ kontrol af at scenarierne rammer de grene, kontakten ændrer.
    settleWithRisk: settle.filter((s) => s.ok && s.ok.risk > 0).length > 0,
    forecastWithRuleHit: forecast.some((f) => f.ok && Object.keys(f.ok).length > 0),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: fatigueNow7801FlagOffScenarios.js <out.json>");
  writeFileSync(out, `${JSON.stringify(runScenarios(), null, 2)}\n`);
}
