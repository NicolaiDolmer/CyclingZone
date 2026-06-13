// Kontrakt-seed (#1309) — frossen løn + længde + udløbssæson på ejede ryttere.
// Pure helpers er deterministiske/seeded → dry-run == apply. DB-wrapper
// (runContractSeed, Task 3) læser ejede ryttere + founder-hold og skriver felterne.
//
// Beslutninger (ejer 13/6): kontrakter kun på ejede ryttere (free agents = NULL);
// founders 2 sæsoner; andre ejede blandet 1-3.

export const CONTRACT = Object.freeze({
  FOUNDER_LENGTH: 2,          // founder-hold: stabil trup i 2 sæsoner
  DEFAULT_ACQUIRE_LENGTH: 2,  // auto-kontrakt ved erhvervelse (create-if-missing)
  MIN_LENGTH: 1,
  MAX_LENGTH: 3,
  SALARY_RATE: 0.10,          // = den gamle generated-formel
  BASE_VALUE_FALLBACK: 1000,  // spejler RIDER_BASE_VALUE_FALLBACK
});

// Spejler den gamle generated kolonne EKSAKT:
// GREATEST(1, ROUND((COALESCE(base_value,1000)+prize_earnings_bonus)*0.10))
export function computeFrozenSalary({ base_value, prize_earnings_bonus } = {}) {
  const base = Number(base_value) > 0 ? Number(base_value) : CONTRACT.BASE_VALUE_FALLBACK;
  const mv = base + (Number(prize_earnings_bonus) || 0);
  return Math.max(1, Math.round(mv * CONTRACT.SALARY_RATE));
}

// ~1/3 hver af 1,2,3. rng = makeRng(seed) fra fictionalRiderGenerator.
export function pickContractLength(rng) {
  return CONTRACT.MIN_LENGTH + Math.floor(rng() * (CONTRACT.MAX_LENGTH - CONTRACT.MIN_LENGTH + 1));
}

// Sidste aktive sæson = startSeason + length - 1.
export function computeContractEndSeason(startSeasonNumber, length) {
  return startSeasonNumber + length - 1;
}
