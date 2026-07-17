/**
 * bulkPriceAdjust — pure computation for the transfer-market bulk price editor
 * (#2451). Given the currently selected listings and one adjustment spec, works
 * out the NEW asking_price per listing so the UI can preview it before the
 * player commits, and the same function feeds the actual PATCH-batch.
 *
 * Kept as a pure .js module (no React) so it is node --test-friendly and can be
 * unit-tested for the rounding/clamping edge cases without mounting a component.
 */

// asking_price is an INTEGER NOT NULL column (backend/routes/api.js #1185) with
// a positive-integer invariant (getListingPriceUpdateIssue) — mirror that here
// so a preview never proposes a price the backend would reject.
export const MIN_ASKING_PRICE = 1;

/**
 * @param {number} currentPrice
 * @param {{ mode: "percent" | "amount" | "set", value: number }} adjustment
 * @returns {number} new integer asking_price, clamped to >= MIN_ASKING_PRICE
 */
export function computeAdjustedPrice(currentPrice, adjustment) {
  const current = Number(currentPrice) || 0;
  const value = Number(adjustment?.value);
  if (!Number.isFinite(value)) return current;

  let next;
  switch (adjustment?.mode) {
    case "percent":
      // "+10% on all selected" — the feature that makes bulk faster than
      // editing riders one by one (#2451 owner directive).
      next = current * (1 + value / 100);
      break;
    case "amount":
      next = current + value;
      break;
    case "set":
      next = value;
      break;
    default:
      next = current;
  }
  return Math.max(MIN_ASKING_PRICE, Math.round(next));
}

/**
 * Builds the per-listing preview (+ the actual update payload) for a batch of
 * selected listings under one adjustment. Listings the caller doesn't own or
 * that aren't open/negotiating should already be excluded by the caller
 * (selection is only ever built from the player's own open listings), but we
 * still skip anything without a numeric asking_price defensively.
 *
 * @param {Array<{id: string, asking_price: number}>} listings
 * @param {{ mode: "percent" | "amount" | "set", value: number }} adjustment
 * @returns {Array<{id: string, from: number, to: number, changed: boolean}>}
 */
export function previewBulkPriceAdjust(listings, adjustment) {
  return (listings || [])
    .filter((l) => l && l.asking_price != null && Number.isFinite(Number(l.asking_price)))
    .map((l) => {
      const from = Number(l.asking_price);
      const to = computeAdjustedPrice(from, adjustment);
      return { id: l.id, from, to, changed: to !== from };
    });
}
