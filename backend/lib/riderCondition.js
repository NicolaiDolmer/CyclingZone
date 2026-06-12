// Form/Træthed-spine (#1306) — to tal 0-100, bruges af det daglige tick (#1305).
// Fuld CTL/ATL/TSB (#931) bygges post-launch OVEN PÅ disse to tal — ændr ikke semantikken.
// Alle konstanter kalibreres i sim-harnesset (Task A10/B4) før ship (spec afsnit 13).
import { seededUnit } from "./riderProgression.js";
import { DAILY_TRAINING_CONFIG } from "./dailyTraining.js";

export const CONDITION_CONFIG = Object.freeze({
  recoveryBase: 5,            // dagligt trætheds-fradrag alle får
  recoveryFromAbility: 4,     // + op til dette × recovery/99
  formSweetLo: 25, formSweetHi: 60,   // trætheds-zone hvor form bygges
  formGain: 3, formMildGain: 1, formOverloadLoss: 4, formHighLoss: 1,
  multFormSpan: 0.15,         // form 0↔100 flytter trænings-effekt ±15 %
  multFatiguePenaltyFrom: 70, // træthed over dette koster trænings-effekt
  injuryFatigueFloor: 70,     // skaderisiko kræver hård dag + træthed over dette
  injuryBaseRisk: 0.02, injuryRiskPerPoint: 0.004, // 2 % + 0,4 %/point over floor
  injuryMaxDays: 5,
});

export function nextFatigue({ fatigue, intensity, recoveryAbility = 50, raceLoad = 0 }) {
  const cfg = CONDITION_CONFIG;
  const load = DAILY_TRAINING_CONFIG.fatigueLoad[intensity] ?? 0;
  const recovery = cfg.recoveryBase + cfg.recoveryFromAbility * (Number(recoveryAbility) / 99);
  const next = Number(fatigue) + load + raceLoad - recovery;
  return Math.max(0, Math.min(100, Math.round(next)));
}

export function nextForm({ form, fatigue }) {
  const cfg = CONDITION_CONFIG;
  let delta;
  if (fatigue >= cfg.formSweetLo && fatigue <= cfg.formSweetHi) delta = cfg.formGain;
  else if (fatigue > 80) delta = -cfg.formOverloadLoss;
  else if (fatigue > cfg.formSweetHi) delta = -cfg.formHighLoss;
  else delta = cfg.formMildGain; // let belastning/hvile under sweet-zonen
  return Math.max(0, Math.min(100, Math.round(Number(form) + delta)));
}

// Ganges på dagens trænings-score (spec 6.4: form/træthed påvirker dagseffekt let).
export function conditionMultiplier({ form, fatigue }) {
  const cfg = CONDITION_CONFIG;
  const formFactor = 1 + ((Number(form) - 50) / 50) * cfg.multFormSpan;
  const fatiguePenalty = Math.max(0, Number(fatigue) - cfg.multFatiguePenaltyFrom) / 150;
  return Math.max(0.7, Math.min(1.2, formFactor * (1 - fatiguePenalty)));
}

// Synlig, forklarlig risiko (spec 6.5): KUN hård træning + høj træthed kan skade.
export function injuryRisk({ intensity, fatigue }) {
  const cfg = CONDITION_CONFIG;
  if (intensity !== "hard" || fatigue < cfg.injuryFatigueFloor) return 0;
  return cfg.injuryBaseRisk + (fatigue - cfg.injuryFatigueFloor) * cfg.injuryRiskPerPoint;
}

export function rollInjury({ riderId, dateStr, risk }) {
  if (risk <= 0) return { injured: false, days: 0 };
  const roll = seededUnit(`injury:${riderId}:${dateStr}`);
  if (roll >= risk) return { injured: false, days: 0 };
  const days = 1 + Math.floor(seededUnit(`injurydays:${riderId}:${dateStr}`) * CONDITION_CONFIG.injuryMaxDays);
  return { injured: true, days: Math.min(days, CONDITION_CONFIG.injuryMaxDays) };
}
