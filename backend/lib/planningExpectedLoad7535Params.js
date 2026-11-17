// #7535 / #8294: validering af graenserne bag belastningsordene let/mellem/haard paa
// planlaegningssiden (private_config `planning_expected_load_7535`). Eget modul, saa registret
// i privateConfig.ts kan bruge den uden en cirkulaer import af planningExpectedLoad7535.js.
//
// Graenserne er balance-tal og maa ikke staa i det offentlige repo (hard rule 17). Her staar kun
// formen, aldrig de rigtige vaerdier.

function isPositiveFinite(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Validerer graenserne. Ugyldigt = null (fail-safe: intet belastningsord).
 *   lightBelow  en samlet belastning under denne er "let"
 *   hardFrom    en samlet belastning paa eller over denne er "haard" (skal vaere over lightBelow)
 *   Ind imellem er "mellem".
 */
export function validatePlanningExpectedLoadThresholds(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { lightBelow, hardFrom } = raw;
  if (!isPositiveFinite(lightBelow) || !isPositiveFinite(hardFrom)) return null;
  if (!(lightBelow < hardFrom)) return null;
  return Object.freeze({ lightBelow, hardFrom });
}
