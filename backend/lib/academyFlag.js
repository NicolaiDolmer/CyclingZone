// Akademi-flag + konstanter (#1308). Flag-mønster spejler dailyTrainingFlag.js
// (app_config, runtime-flip, fail-safe false). Konkrete beløb (DRIFT_PER_SEASON,
// SIGNING_FEE_RATE) kalibreres i sim-harness (academyEconomySimulation.js) og
// godkendes af ejer før flag-flip — placeholders her er sim-startpunkter.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { SALARY_RATE } from "./economyConstants.js";

export const ACADEMY = Object.freeze({
  FLAG_KEY: "academy_enabled",
  SLOTS: 8,                 // pladser pr. akademi (hård cap)
  MIN_AGE: 16,
  MAX_AGE: 21,
  INTAKE_MIN: 3,            // kandidater pr. kuld
  INTAKE_MAX: 5,
  SERIOUS_MIN: 1,           // "seriøse" (høj potentiale) pr. kuld
  SERIOUS_MAX: 3,
  YOUTH_MULT: 1.5,          // ungdoms-multiplikator ved MIN_AGE (aftager mod 1.0 ved 22)
  DRIFT_PER_SEASON: 5_000,  // pr. plads pr. sæson. EJER-GODKENDT 13/6 (Task 9-sim): youth-værdi
                            // er empirisk ~11k (base_value vægter kun current stats), så drift er
                            // den dominerende cost. 5k/plads → delvist akademi (3-4) trygt bæreligt
                            // i alle divisioner; fuldt 8-plads (~40k drift) = bevidst tung satsning.
  SIGNING_FEE_RATE: 0.25,   // signing-fee = rate × market_value (marginal ved lav youth-værdi)
  SALARY_RATE,              // #2083: ungdoms-/akademi-løn ensrettet til den delte senior-rate
                            // (economyConstants.SALARY_RATE = 0.067). Youth har ikke længere en
                            // separat rate — ét fælles løn-system for alle ryttere (ejer-valgt 3/7).
  CONTRACT_LENGTH: 3,       // akademi-kontrakt-længde (sæsoner)
});

export function isAcademyAge(age) {
  return Number.isFinite(age) && age >= ACADEMY.MIN_AGE && age <= ACADEMY.MAX_AGE;
}

// Lineær aftagning fra YOUTH_MULT (ved MIN_AGE) mod 1.0 (ved MAX_AGE+1=22).
// Uden for akademi-alder = 1.0 (ingen boost).
export function youthMultiplier(age) {
  if (!isAcademyAge(age)) return 1.0;
  const span = (ACADEMY.MAX_AGE + 1) - ACADEMY.MIN_AGE; // 22-16 = 6
  const t = (age - ACADEMY.MIN_AGE) / span;             // 0 ved 16 → 5/6 ved 21
  return ACADEMY.YOUTH_MULT - (ACADEMY.YOUTH_MULT - 1.0) * t;
}

export async function isAcademyEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, ACADEMY.FLAG_KEY), opts);
}
