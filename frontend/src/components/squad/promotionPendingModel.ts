// #6710: rene hjælpere til trupsidens "Afventer oprykning"-panel
// (PromotionPendingPanel.tsx). Holdt fri af React, så node --test dækker dem.

export type PromotionTarget = "u23" | "senior";

export interface PendingRider {
  id: string;
  firstname: string;
  lastname: string;
  to: PromotionTarget;
  canPromote: boolean;
}

// Fejlkoder fra POST /api/riders/:id/promote-pending (promotionPendingAction.js)
// der har deres egen tekst. Alt andet viser den generiske fejl.
const KNOWN_ERRORS = new Set(["squad_full", "rider_on_market", "rider_in_stage_race"]);

/** i18n-nøgle (namespace "team") for en afvist "Ryk op". */
export function promotionErrorKey(code: unknown): string {
  return typeof code === "string" && KNOWN_ERRORS.has(code)
    ? `promotionPending.error.${code}`
    : "promotionPending.error.generic";
}

/**
 * Normalisér GET /api/team/promotion-pending. Flag off, fejl eller et
 * uventet svar giver en tom liste, så panelet bare ikke vises.
 */
export function pendingRidersFromResponse(res: { ok?: boolean; data?: unknown } | null | undefined): PendingRider[] {
  const data = res?.data as { enabled?: unknown; riders?: unknown } | null | undefined;
  if (!res?.ok || data?.enabled !== true || !Array.isArray(data.riders)) return [];
  return data.riders.filter((r): r is PendingRider =>
    !!r && typeof r === "object"
    && typeof (r as PendingRider).id === "string" && (r as PendingRider).id.length > 0
    && ((r as PendingRider).to === "u23" || (r as PendingRider).to === "senior"));
}
