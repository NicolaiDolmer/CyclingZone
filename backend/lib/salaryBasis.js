/**
 * Løn-grundlag · markedsværdi-kurve (#3899 forecast-redesign, ejer-beslutning 19/8).
 *
 * Dette modul er den ENESTE kilde til markeds-baseret løn-matematik i repoet
 * pr. 19/8. Selve løn-OMLÆGNINGEN (kontrakt-seeding, sæsonstart-genberegning)
 * lever på den ikke-mergede #3393-branch (`rebase-3393`), som allerede har et
 * `backend/lib/salaryBasis.js` med SAMME funktions-mønster (marketBasisSalary/
 * resolveMarketBase/SALARY_MARKET_MODEL) men en ÆLDRE kalibrering
 * (anchorSalary 15.000, sat 5/8 mod dengang-population). Ejeren besluttede
 * 19/8 en ny kalibrering (anchorSalary 23.300) specifikt til S3-cutover.
 *
 * #3899 (forecast) skal projicere fremtidige sæsoner (S3+) med "sæson 3
 * lønsystemet" UANSET hvilket system der er aktivt lige nu (SALARY_BASIS_MODE
 * findes slet ikke på `main` endnu — kun på #3393). Da forecast ikke kan
 * importere fra en branch der ikke er mergeet, definerer denne fil kurven
 * lokalt med dagens kalibrering, i stedet for at hardkode formlen inline i
 * financeForecast.js (ejer-krav: "importér, hardkod ikke A").
 *
 * ⚠️ NÅR #3393 MERGER: dette bliver en fil-kollision (begge grene tilføjer
 * `backend/lib/salaryBasis.js`). Det er FORVENTET og korrekt — konsolidér til
 * ÉN fil på merge-tidspunktet og behold den nyeste kalibrering (23.300, denne
 * fil), da #3393's 15.000 var en tidligere kalibrering af samme kurve.
 */

// Sidste udvej hvis hverken market_value eller base_value er læselige.
export const MARKET_BASE_FALLBACK = 1000;

// market_value er en GENERATED kolonne (COALESCE(base_value, 1000)), så
// base_value er et sikkert sekundært felt for kaldesteder der kun har
// selectet det.
export function resolveMarketBase(rider = {}) {
  const mv = Number(rider?.market_value);
  if (Number.isFinite(mv) && mv > 0) return { base: mv, source: "market_value" };
  const bv = Number(rider?.base_value);
  if (Number.isFinite(bv) && bv > 0) return { base: bv, source: "base_value" };
  return { base: MARKET_BASE_FALLBACK, source: "fallback" };
}

// Sæson 3-lønsystemet (ejer-beslutning 19/8): løn = A × (markedsværdi / 100.000)^0,55,
// gulv 250, intet loft. Samme kurve-form som #3393's SALARY_MARKET_MODEL,
// genkalibreret til S3-cutover-populationen.
export const SALARY_MARKET_MODEL = Object.freeze({
  anchorValue: 100_000, // referenceværdi
  anchorSalary: 23_300,  // "A" — en rytter til præcis 100.000 CZ$ koster 23.300/sæson
  exponent: 0.55,
  floor: 250,
  ceiling: null,
});

// Kurven. `model` = { anchorValue, anchorSalary, exponent, floor, ceiling }.
export function marketBasisSalary(marketValue, model = SALARY_MARKET_MODEL) {
  const { anchorValue, anchorSalary, exponent, floor, ceiling } = model;
  const v = Number(marketValue);
  const base = Number.isFinite(v) && v > 0 ? v : MARKET_BASE_FALLBACK;
  const raw = Number(anchorSalary) * Math.pow(base / Number(anchorValue), Number(exponent));
  const rounded = Math.round(raw);
  const withFloor = Math.max(Number(floor) || 1, rounded);
  const cap = Number(ceiling);
  return Number.isFinite(cap) && cap > 0 ? Math.min(cap, withFloor) : withFloor;
}
