// #5950: validering af løbsdagens private rolle-params (private_config
// `race_day_role_yield_params`). Eget modul, så registret i privateConfig.ts kan
// bruge den uden en cirkulær import af raceDayRoleYield5950.js.

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Validerer de private params. Ugyldigt = null (fail-safe: dagens model).
 *   stageBonus  tillaeggets stoerrelse
 *   leadShare   hvor meget af rollens tillaeg der lander i `lead`-evnerne
 */
export function validateRaceDayRoleYieldParams(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { stageBonus, leadShare } = raw;
  if (!isFiniteNumber(stageBonus) || stageBonus < 0 || stageBonus > 5) return null;
  if (!isFiniteNumber(leadShare) || leadShare <= 0 || leadShare > 1) return null;
  return Object.freeze({ stageBonus, leadShare });
}
