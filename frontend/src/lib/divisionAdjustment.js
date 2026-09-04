// Divisions-tillægget, frontend-projektion (#4376).
//
// Regel: docs/SPONSOR_RULES.md §3. Motoren regner det i backend/lib/divisionAdjustment.js;
// her projiceres det KUN til visning, så en manager kan se konsekvensen FØR han skriver
// under — det var spillerens eksplicitte forbehold da reglen blev valgt ("det skal man
// selvfølgelig vide på forhånd, når man underskriver").
//
// OPADGÅENDE REGEL — "GULV + 50 %" (ejer-beslutning 4/9, erstatter ren 50 % af hele
// forskellen): løft først til grundbeløbet for divisionen lige under den nuværende (gulvet),
// og læg derefter 50 % af resten op til egen divisions base oveni. Samme formel som
// backendens computeDivisionAdjustment — se den fil for det fulde eksempel og begrundelse.
// NEDADGÅENDE REGEL: uændret 0,5 × hele forskellen, bag samme tænd/sluk-flag som backend
// (default fra). Modalen viser altid en KOMMENDE sæson, så kalderen (SponsorOfferModal)
// beslutter selv om nedad skal vises for den sæson der forhandles om.
//
// Ingen konstanter kopieres: divisions-baserne og faktoren kommer fra RULES_NUMBERS, som
// rulesNumbers.test.js pinner til backendens egne exports. Ændres en base eller faktoren i
// backend, fejler den drift-guard indtil dette tal følger med — samme mønster som
// marketValues.js / salaryRateParity.test.js.
import { RULES_NUMBERS } from "./rulesNumbers.js";

const BASE_BY_DIVISION = {
  1: RULES_NUMBERS.sponsorD1,
  2: RULES_NUMBERS.sponsorD2,
  3: RULES_NUMBERS.sponsorD3,
  4: RULES_NUMBERS.sponsorD4,
};

export const DIVISION_ADJUSTMENT_FRACTION = RULES_NUMBERS.divisionAdjustmentPct / 100;

// Ejer-beslutning 4/9: nedad er ikke automatisk. Spejler backendens
// DOWNWARD_ADJUSTMENT_ENABLED — hold de to i sync manuelt, samme mønster som faktoren.
export const DOWNWARD_ADJUSTMENT_ENABLED = false;

function divisionBelowBase(targetDivision) {
  const below = Number(targetDivision) + 1;
  return Number.isFinite(BASE_BY_DIVISION[below]) ? BASE_BY_DIVISION[below] : null;
}

/**
 * Hvad tillægget ville være hvis holdet kører i `targetDivision` med en aftale prissat
 * i `signedDivision`. Før bestyrelsens modifier — præcis som resten af tilbuds-kortet.
 *
 * @returns {number} 0 når en division mangler, er ukendt, eller de to er ens.
 */
export function projectDivisionAdjustment({ targetDivision, signedDivision } = {}) {
  const target = BASE_BY_DIVISION[targetDivision];
  const signed = BASE_BY_DIVISION[signedDivision];
  if (!Number.isFinite(target) || !Number.isFinite(signed)) return 0;
  if (target === signed) return 0;

  if (signed < target) {
    const belowBase = divisionBelowBase(targetDivision);
    if (belowBase === null) return 0;
    const floor = Math.max(0, belowBase - signed);
    const halfStep = DIVISION_ADJUSTMENT_FRACTION * (target - belowBase);
    return Math.round(floor + halfStep);
  }

  if (!DOWNWARD_ADJUSTMENT_ENABLED) return 0;
  return Math.round(DIVISION_ADJUSTMENT_FRACTION * (target - signed));
}
