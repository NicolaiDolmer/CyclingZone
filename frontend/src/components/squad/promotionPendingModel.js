// #6710: rene hjælpere til trupsidens "Afventer oprykning"-panel
// (PromotionPendingPanel.jsx). Holdt fri af React, så node --test dækker dem.

// Fejlkoder fra POST /api/riders/:id/promote-pending (promotionPendingAction.js)
// der har deres egen tekst. Alt andet viser den generiske fejl.
const KNOWN_ERRORS = new Set(["squad_full", "rider_on_market", "rider_in_stage_race"]);

/**
 * i18n-nøgle (namespace "team") for en afvist "Ryk op".
 * @param {string|null|undefined} code
 * @returns {string}
 */
export function promotionErrorKey(code) {
  return KNOWN_ERRORS.has(code) ? `promotionPending.error.${code}` : "promotionPending.error.generic";
}

/**
 * Normalisér GET /api/team/promotion-pending. Flag off, fejl eller et
 * uventet svar giver en tom liste, så panelet bare ikke vises.
 * @param {{ok?:boolean, data?:any}|null|undefined} res
 * @returns {Array<{id:string, firstname:string, lastname:string, to:string, canPromote:boolean}>}
 */
export function pendingRidersFromResponse(res) {
  if (!res?.ok || res.data?.enabled !== true || !Array.isArray(res.data?.riders)) return [];
  return res.data.riders.filter((r) => r && r.id && (r.to === "u23" || r.to === "senior"));
}
