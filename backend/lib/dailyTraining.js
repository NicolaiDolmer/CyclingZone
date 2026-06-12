// Dagligt trænings-tick (#1305) — ren matematik, ingen DB.
// Genbruger L0'ens budget (growthFractionByAge) delt i daglige bidder med compounding:
// dag-rate = residual-gap × f(age)/daysPerSeason. Over en sæson ≈ gap×e^(−f) ~ L0's gap×(1−f).
// dailyBudgetBoost kalibreres i scripts/previewDailyTraining.js så peak rammer 27-28 (spec 5.2).
import { PROGRESSION_CONFIG, seededUnit } from "./riderProgression.js";
import { TRAINING_CONFIG, TRAINING_FOCUSES } from "./training.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

export const DAILY_TRAINING_CONFIG = Object.freeze({
  daysPerSeason: 28,        // budget-konvertering; kalibreres i sim (Task A10)
  dailyBudgetBoost: 1.0,    // kompenserer compounding-tabet; kalibreres i sim
  bonusMult: 1.25,          // aktivt manager-klik (spec 6.3)
  noiseSpan: 0.15,          // ±15 % dagsform-støj, seeded pr. (rytter, dato)
  intensities: Object.freeze(["rest", "easy", "normal", "hard"]),
  // Trætheds-belastning pr. intensitet (bruges af riderCondition.js, Task A5)
  fatigueLoad: Object.freeze({ rest: -14, easy: 4, normal: 9, hard: 16 }),
});

export const DEFAULT_PROGRAM = Object.freeze({ focus: "endurance", intensity: "normal" });

export function resolveProgram(plan) {
  if (!plan || !plan.focus || !plan.intensity) return DEFAULT_PROGRAM;
  return { focus: plan.focus, intensity: plan.intensity };
}

// Returnér vækst-fraktionen for en given alder fra L0's growthFractionByAge-tabel
// (array af { maxAge, frac } sorteret stigende på maxAge).
export function growthFractionForAge(age) {
  const table = PROGRESSION_CONFIG.growthFractionByAge;
  for (const row of table) {
    if (age <= row.maxAge) return row.frac;
  }
  return table[table.length - 1].frac;
}

// Multiplikator pr. evne: fokus-evner får intensitetens focusGrowthMult, resten offFocusMult.
// "rest" → 0 (ingen progress på hviledage).
function abilityMult(ability, program) {
  if (program.intensity === "rest") return 0;
  const focusAbilities = TRAINING_FOCUSES[program.focus] ?? [];
  return focusAbilities.includes(ability)
    ? (TRAINING_CONFIG.focusGrowthMult[program.intensity] ?? 1)
    : TRAINING_CONFIG.offFocusMult;
}

export function dailyAbilityDelta({ ability, current, cap, age, program, conditionMult, bonus, noise }) {
  const gap = Math.max(0, (cap ?? current) - current);
  if (gap === 0) return 0;
  const mult = abilityMult(ability, program);
  if (mult === 0) return 0;
  const cfg = DAILY_TRAINING_CONFIG;
  const base = (gap * growthFractionForAge(age) * cfg.dailyBudgetBoost) / cfg.daysPerSeason;
  return base * mult * conditionMult * (bonus ? cfg.bonusMult : 1) * noise;
}

// Ét dags-tick for én rytter. Muterer ikke input. Returnerer nye abilities/progress + rapportfelter.
export function applyDailyTick({ riderId, dateStr, age, abilities, caps, progress, program, conditionMult, bonus }) {
  const cfg = DAILY_TRAINING_CONFIG;
  const noise = 1 - cfg.noiseSpan + 2 * cfg.noiseSpan * seededUnit(`dtick:${riderId}:${dateStr}`);
  const nextAbilities = { ...abilities };
  const nextProgress = { ...(progress ?? {}) };
  const gains = {};
  let score = 0;

  for (const ability of VISIBLE_ABILITIES) {
    const current = Number(nextAbilities[ability] ?? 0);
    const delta = dailyAbilityDelta({
      ability, current, cap: caps?.[ability], age, program, conditionMult, bonus, noise,
    });
    if (delta <= 0) continue;
    score += delta;
    let bar = Number(nextProgress[ability] ?? 0) + delta;
    while (bar >= 1 && current + (gains[ability] ?? 0) < Math.min(99, caps?.[ability] ?? 99)) {
      bar -= 1;
      gains[ability] = (gains[ability] ?? 0) + 1;
    }
    if (gains[ability]) nextAbilities[ability] = current + gains[ability];
    nextProgress[ability] = Math.min(bar, 0.999);
  }

  return {
    abilities: nextAbilities,
    progress: nextProgress,
    gains,
    score: Math.round(score * 100) / 100,
    noise,
    status: noise > 1.05 ? "over" : noise < 0.95 ? "under" : "normal",
  };
}
