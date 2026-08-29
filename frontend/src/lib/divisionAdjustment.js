// Divisions-tillægget, frontend-projektion (#4376).
//
// Regel + de fem ejer-valg: docs/SPONSOR_RULES.md §3. Motoren regner det i
// backend/lib/divisionAdjustment.js; her projiceres det KUN til visning, så en manager
// kan se konsekvensen FØR han skriver under — det var spillerens eksplicitte forbehold
// da reglen blev valgt ("det skal man selvfølgelig vide på forhånd, når man underskriver").
//
// Ingen konstanter kopieres: både divisions-baserne og faktoren kommer fra RULES_NUMBERS,
// som rulesNumbers.test.js pinner til backendens egne exports. Ændres en base eller
// faktoren i backend, fejler den drift-guard indtil dette tal følger med — samme mønster
// som marketValues.js / salaryRateParity.test.js.
import { RULES_NUMBERS } from "./rulesNumbers.js";

const BASE_BY_DIVISION = {
  1: RULES_NUMBERS.sponsorD1,
  2: RULES_NUMBERS.sponsorD2,
  3: RULES_NUMBERS.sponsorD3,
  4: RULES_NUMBERS.sponsorD4,
};

export const DIVISION_ADJUSTMENT_FRACTION = RULES_NUMBERS.divisionAdjustmentPct / 100;

/**
 * Hvad tillægget ville være hvis holdet kører i `targetDivision` med en aftale prissat
 * i `signedDivision`. Før bestyrelsens modifier — præcis som resten af tilbuds-kortet.
 *
 * Spejler backendens computeDivisionAdjustment for den OPADGÅENDE retning og for
 * nedadgående fra sæson 4. Overgangsreglen (kun opad i sæson 3) håndteres af kalderen,
 * fordi modalen altid viser en KOMMENDE sæson.
 *
 * @returns {number} 0 når en division mangler, er ukendt, eller de to er ens.
 */
export function projectDivisionAdjustment({ targetDivision, signedDivision } = {}) {
  const target = BASE_BY_DIVISION[targetDivision];
  const signed = BASE_BY_DIVISION[signedDivision];
  if (!Number.isFinite(target) || !Number.isFinite(signed)) return 0;
  if (target === signed) return 0;
  return Math.round(DIVISION_ADJUSTMENT_FRACTION * (target - signed));
}
