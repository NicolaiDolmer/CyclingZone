// #3449/#3750 · Niveau-korrektionens NEUTRALITETS-BUNDT — rene, testbare
// formler. Ejer-beslutning 19/8: korrektionen (ny_værdi = current_value × c)
// bundles med to modsatrettede justeringer, så SELVE PRISSEDLEN er det eneste
// der flytter sig:
//
//  (a) DRÆN-NEUTRAL bankrate. Bankens ungdomsauktioner starter på
//      start_pris = rate × værdi (YOUTH_AUCTION_START_RATE,
//      backend/lib/youthMarket.js). Efter korrektionen er værdi_ny = c ×
//      værdi_gammel — for at holde start_pris i kroner UÆNDRET (bevare
//      drænet) skal rate_ny = rate_gammel / c:
//        start_pris_ny = (rate/c) × (c×værdi) = rate×værdi = start_pris_gammel.
//
//  (b) LØN-NEUTRAL A. Design-session 17/8 (#3757, beslutning 4+5): lønnens
//      grundlag bliver Ankerværdien via formlen løn = A × (anker/100.000)^0,55
//      (#3393-reformen — IKKE endnu live, se marketValueLevelCorrectionApply.js's
//      header for hvorfor denne formel er FORWARD-LOOKING kode indtil #3393
//      shipper sin egen A-konfigurationsnøgle). Med anker_ny = c × anker_gammel:
//        løn_ny = A × (c×anker/100.000)^0,55 = A × c^0,55 × (anker/100.000)^0,55.
//      For at holde lønnen i kroner UÆNDRET: A_ny = A_gammel × c^(-0,55).
//
// Begge er rene multiplikative inverser — ingen DB, ingen sideeffekter.
// Se scratchpad-måle-noten 19/8, afsnit 4, for de eksakte tal disse formler
// er verificeret mod (c=0,6918: rate 0,25→0,3614, A 23.300→28.534, 5
// eksempel-ryttere med identisk løn før/efter).

export const WAGE_ANCHOR_EXPONENT = 0.55;

/**
 * Dræn-neutral bankrate: rate_ny = rate_gammel / c.
 * @param {number} oldRate — nuværende YOUTH_AUCTION_START_RATE
 * @param {number} c — den målte niveau-korrektions-faktor
 */
export function computeDrainNeutralRate(oldRate, c) {
  if (!Number.isFinite(oldRate) || oldRate <= 0) throw new Error("computeDrainNeutralRate: oldRate skal være > 0");
  if (!Number.isFinite(c) || c <= 0) throw new Error("computeDrainNeutralRate: c skal være > 0");
  return oldRate / c;
}

/**
 * Løn-neutral A: A_ny = A_gammel × c^(-0,55).
 * @param {number} oldA — nuværende løn-konstant A
 * @param {number} c — den målte niveau-korrektions-faktor
 */
export function computeWageNeutralA(oldA, c) {
  if (!Number.isFinite(oldA) || oldA <= 0) throw new Error("computeWageNeutralA: oldA skal være > 0");
  if (!Number.isFinite(c) || c <= 0) throw new Error("computeWageNeutralA: c skal være > 0");
  return oldA * Math.pow(c, -WAGE_ANCHOR_EXPONENT);
}

/**
 * Sanity-tjek: løn i kroner FØR (gammel A, gammel anker) skal matche løn i
 * kroner EFTER (ny A, ny anker = c×gammel anker), op til afrunding. Bruges af
 * dry-run-rapporten til at vise eksempel-ryttere (samme form som scratchpad-
 * noten 19/8 afsnit 4c) — `Math.max(250, Math.round(...))` spejler den
 * dokumenterede lønformels gulv.
 */
export function projectedAnchorWage(anchorValue, A, { floor = 250 } = {}) {
  if (!Number.isFinite(anchorValue) || anchorValue <= 0) return floor;
  const raw = A * Math.pow(anchorValue / 100_000, WAGE_ANCHOR_EXPONENT);
  return Math.max(floor, Math.round(raw));
}
