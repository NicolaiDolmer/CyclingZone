// Dagligt trænings-tick (#1305) — ren matematik, ingen DB.
// Genbruger L0'ens budget (growthFractionByAge) delt i daglige bidder med compounding:
// dag-rate = residual-gap × f(age)/daysPerSeason. Over en sæson ≈ gap×e^(−f) ~ L0's gap×(1−f).
// dailyBudgetBoost kalibreres i scripts/previewDailyTraining.js så peak rammer 27-28 (spec 5.2).
import { PROGRESSION_CONFIG, seededUnit, youthRateForPotential } from "./riderProgression.js";
import { TRAINING_CONFIG, TRAINING_FOCUSES } from "./training.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { youthMultiplier } from "./academyFlag.js";
import { staffTrainingBonus, facilityTrainingMultiplier } from "./staffTrainingBonus.js";

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
  // "rest" er gyldig daglig intensitet, men indgår bevidst IKKE i training.js' sæson-validator
  // (sæson-stien kender kun easy/normal/hard; A7 håndterer API-validering).
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
export function abilityMult(ability, program) {
  if (program.intensity === "rest") return 0;
  const focusAbilities = TRAINING_FOCUSES[program.focus] ?? [];
  return focusAbilities.includes(ability)
    ? (TRAINING_CONFIG.focusGrowthMult[program.intensity] ?? 1)
    : TRAINING_CONFIG.offFocusMult;
}

// #2216 A4 (Task 7): staff/facilityTier/riderLevel er VALGFRIE med sikre defaults
// (staff=null → staffTrainingBonus=1.0). Eksisterende callers, der ikke sender dem,
// får et staffBonus på præcis 1.0 → bit-identisk output (nul regression, bevist i test).
export function dailyAbilityDelta({
  ability, current, cap, age, program, conditionMult, bonus, noise, potentiale,
  staff = null, facilityTier = null, riderLevel = null,
}) {
  const gap = Math.max(0, (cap ?? current) - current);
  if (gap === 0) return 0;
  const mult = abilityMult(ability, program);
  if (mult === 0) return 0;
  const cfg = DAILY_TRAINING_CONFIG;
  const base = (gap * growthFractionForAge(age) * cfg.dailyBudgetBoost) / cfg.daysPerSeason;
  // Staff-trænings-bonus (dimension×niveau): ét ekstra multiplikator-led SIDST i kæden,
  // efter manager-klik-bonussen (cfg.bonusMult) og noise. ≥ 1.0 og = 1.0 uden staff, så
  // rækkefølgen er ligegyldig for regression men dokumenteres eksplicit for læsbarhed.
  // Bonussen skalerer KUN denne daglige delta — cap-loopet i dailyTrainingEngine.js klipper
  // stadig hver evne ved ability_caps, så et cap kan ALDRIG udvides af bonussen.
  const staffBonus = staffTrainingBonus({ facilityTier, staff, ability, riderLevel });
  // Plan B (#1441): facilitets-MAGNITUDE (spec §2.1) — samme effectiveBonus som Klub-UI'et
  // viser. facilityTier null/0 → PRÆCIS 1.0 (nul regression for hold uden faciliteter).
  const facilityMult = facilityTrainingMultiplier({ facilityTier, staff });
  return base * mult * conditionMult * youthMultiplier(age) * youthRateForPotential(potentiale)
    * (bonus ? cfg.bonusMult : 1) * noise * staffBonus * facilityMult;
}

// #2082/#1938 (ejer-godkendt 5/7): sæson-budget-loft for akademi-alder — det EFFEKTIVE
// loft for daglige ticks i indeværende sæson, IKKE livstids-loftet direkte. Væksten
// mætter dermed ved sæsonens andel af gappet uanset hvor mange dage sæsonen varer
// (sæsonlængde er ikke en fast konstant, jf. issue-diskussion — S1 var stadig åben
// efter 57+ dage). seasonStartAbilities er en snapshot taget ved sæsonens første tick.
export function computeAcademySeasonCeiling({ seasonStartAbilities, lifetimeCaps, frac }) {
  const ceiling = {};
  for (const ability of VISIBLE_ABILITIES) {
    const cur = seasonStartAbilities?.[ability];
    if (cur == null) continue;
    const life = lifetimeCaps?.[ability] ?? cur;
    const gap = Math.max(0, life - cur);
    ceiling[ability] = cur + gap * frac;
  }
  return ceiling;
}

// Ét dags-tick for én rytter. Muterer ikke input. Returnerer nye abilities/progress + rapportfelter.
// caps er PÅKRÆVET: manglende evne-nøgle ⇒ nul vækst for den evne (konservativt, jf. L0's lazy-caps).
// hardDailyCap (valgfri, #2082/#1938): maks antal hele point én evne må stige pr. dag —
// sikkerhedsnet mod enkelt-dags-spikes. Udeladt/null = ingen ekstra grænse (uændret adfærd).
// #2216 A4 (Task 7): staff/facilityTier/riderLevel er VALGFRIE med sikre defaults, så
// eksisterende callers (uden staff) får bit-identisk adfærd. Trænings-motoren
// (dailyTrainingEngine.js) sender dem videre til dailyAbilityDelta pr. evne.
export function applyDailyTick({
  riderId, dateStr, age, abilities, caps, progress, program, conditionMult, bonus, potentiale, hardDailyCap,
  staff = null, facilityTier = null, riderLevel = null,
}) {
  const cfg = DAILY_TRAINING_CONFIG;
  const noise = 1 - cfg.noiseSpan + 2 * cfg.noiseSpan * seededUnit(`dtick:${riderId}:${dateStr}`);
  const nextAbilities = { ...abilities };
  const nextProgress = { ...(progress ?? {}) };
  const gains = {};
  let score = 0;

  for (const ability of VISIBLE_ABILITIES) {
    const current = Number(nextAbilities[ability] ?? 0);
    if (!Number.isFinite(current)) continue; // korrupt input må ikke forgifte score/progress
    const delta = dailyAbilityDelta({
      ability, current, cap: caps?.[ability], age, program, conditionMult, bonus, noise, potentiale,
      staff, facilityTier, riderLevel,
    });
    if (delta <= 0) continue;
    score += delta;
    let bar = Number(nextProgress[ability] ?? 0) + delta;
    const dailyCeiling = Number.isFinite(hardDailyCap) ? hardDailyCap : Infinity;
    while (
      bar >= 1
      && (gains[ability] ?? 0) < dailyCeiling
      && current + (gains[ability] ?? 0) < Math.min(99, caps?.[ability] ?? 99)
    ) {
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
