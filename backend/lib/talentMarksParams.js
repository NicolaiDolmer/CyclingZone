// #7879: validering af talentmærkernes private params (private_config
// `talent_marks_params`). Eget modul, så registret i privateConfig.ts kan bruge
// den uden en cirkulær import af talentMarks7879.js.
//
// Tærskler og vægte er balance-tal og må ikke stå i det offentlige repo (hard
// rule 17). Her står kun formen og de ydre grænser, aldrig de rigtige værdier.

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Validerer de private params. Ugyldigt = null (fail-safe: mærkerne beregnes ikke).
 *   topTalentShare  andel af hver ryttertype (0 < x <= 1)
 *   nextGenShare    andel af juniorerne (0 < x <= 1)
 *   windowDays      længden af fremgangsvinduet i hele dage
 *   recentDays      længden af det nyeste delvindue i hele dage (højst windowDays)
 *   recentWeight    ekstra vægt på det nyeste delvindue (>= 0)
 */
export function validateTalentMarksParams(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { topTalentShare, nextGenShare, windowDays, recentDays, recentWeight } = raw;
  if (!isFiniteNumber(topTalentShare) || topTalentShare <= 0 || topTalentShare > 1) return null;
  if (!isFiniteNumber(nextGenShare) || nextGenShare <= 0 || nextGenShare > 1) return null;
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) return null;
  if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > windowDays) return null;
  if (!isFiniteNumber(recentWeight) || recentWeight < 0 || recentWeight > 10) return null;
  return Object.freeze({ topTalentShare, nextGenShare, windowDays, recentDays, recentWeight });
}
