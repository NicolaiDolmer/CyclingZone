// Daily condition settlement, separate from the five ability ticks.
import { DAILY_TRAINING_CONFIG } from './dailyTraining.js';
import { nextFatigue, nextForm, injuryRisk, rollInjury, RACE_DAY_ENGINE_RECOVERY_CONFIG } from './riderCondition.js';

// Historical recovery can acknowledge a second result against the original
// physical race-day load. All evidence stays in the ledger; only originals
// contribute to condition. Never rely on PostgREST's unspecified row order.
export function canonicalRaceLoads(rows) {
  const originals = rows.filter(row => row.duplicate_of_race_id == null);
  const bySlot = new Map();
  for (const row of originals) {
    const key = `${row.rider_id}:${row.game_day}`;
    if (bySlot.has(key)) throw new Error('Unapproved duplicate race-day load');
    bySlot.set(key, row);
  }
  for (const row of rows) {
    if (row.duplicate_of_race_id == null) continue;
    const original = bySlot.get(`${row.rider_id}:${row.game_day}`);
    if (!original || original.race_id !== row.duplicate_of_race_id ||
      Number(original.stage_number) !== Number(row.duplicate_of_stage_number)) {
      throw new Error('Historical race load alias has no matching original');
    }
  }
  return originals;
}

export function settleTrainingDateCondition({ riderId, dateStr, condition, intensities, raceLoads = [0, 0, 0, 0, 0], recoveryAbility = 50, recoveryConfig = RACE_DAY_ENGINE_RECOVERY_CONFIG }) {
  if (!Array.isArray(intensities) || intensities.length !== 5 || intensities.some((value) => value !== 'race' && value !== 'unknown_pending' && !DAILY_TRAINING_CONFIG.intensities.includes(value))) {
    throw new Error('Daily condition requires five valid activity intensities');
  }
  if (!Array.isArray(raceLoads) || raceLoads.length !== intensities.length || raceLoads.some((load, index) => !Number.isFinite(load) || load < 0 || (load > 0 && intensities[index] !== 'race'))) {
    throw new Error('Daily condition requires one valid race load per activity slot');
  }
  const preFatigue = Number(condition.fatigue ?? 0);
  const meanLoad = intensities.reduce((total, intensity, index) => total + (DAILY_TRAINING_CONFIG.fatigueLoad[intensity] ?? 0) + raceLoads[index], 0) / intensities.length;
  // Both training and recorded stage load occupy one of the five date slots.
  // Condition is the opening state: the race writer only records ledger rows.
  const fatigue = nextFatigue({ fatigue: preFatigue, intensity: 'race', raceLoad: meanLoad, recoveryAbility, ...recoveryConfig });
  const form = nextForm({ form: Number(condition.form ?? 50), fatigue });
  const risk = intensities.reduce((total, intensity) => total + injuryRisk({ intensity, fatigue: preFatigue }), 0) / intensities.length;
  return { fatigue, form, risk, injury: rollInjury({ riderId, dateStr, risk }) };
}
