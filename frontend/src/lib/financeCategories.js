// #2306 Finance-historik UX-pakke: kategori-grupper til transaktionsliste-filteret.
// Konsistent med backend/lib/seasonFinanceReport.js's REASON_LABEL-mapning, men
// grupperet i 6 spiller-venlige overkategorier i stedet for ét reason_code pr. label.
//
// Legacy-rows (før reason_code-migrationen) har reason_code=null men et gammelt
// `type`-felt (se frontend/src/lib/legacyFinanceMessage.js) — LEGACY_TYPE_GROUPS
// bruges KUN som fallback for rows uden reason_code, så query-filteret stadig
// rammer ældre historik korrekt.

export const FINANCE_CATEGORIES = ["salary", "prizes", "loans", "transfers", "sponsor", "other"];

export const REASON_CODE_GROUPS = Object.freeze({
  salary: ["season_end_salary", "season_start_staff_salary"],
  prizes: ["race_prize_payout", "admin_force_prize", "board_bonus_accepted", "season_end_division_bonus"],
  loans: [
    "loan_fee_paid", "loan_fee_received", "loan_fee_refunded",
    "loan_principal_received", "loan_repayment", "loan_buyout",
    "loan_origination_fee", "emergency_loan_received", "season_end_loan_interest",
  ],
  transfers: [
    "auction_winner_payment", "auction_seller_payout", "auction_guaranteed_bank_sale",
    "transfer_purchase", "transfer_sale", "swap_cash_delta", "rider_release_buyout",
    "squad_auto_purchase", "squad_auto_sale", "squad_violation_fine",
  ],
  sponsor: ["season_start_sponsor", "sponsor_race_day"],
  other: [
    "season_start_upkeep", "season_start_academy_drift", "season_start_facility_upkeep",
    "season_end_negative_interest", "starting_budget", "admin_balance_adjustment", "admin_beta_reset",
  ],
});

// Fallback for legacy rows uden reason_code (pre-migration), holdt til den samme
// gruppe som deres nuværende reason_code-modstykke ville have givet.
export const LEGACY_TYPE_GROUPS = Object.freeze({
  salary: ["salary"],
  prizes: ["prize", "bonus"],
  loans: ["loan_received", "loan_repayment", "loan_interest", "emergency_loan"],
  transfers: ["transfer_out", "transfer_in", "academy_signing"],
  sponsor: ["sponsor"],
  other: ["admin_adjustment", "interest"],
});

/**
 * Client-side kategori-lookup til visning (fx badge på en enkelt række).
 * reason_code har forrang; falder tilbage til legacy type.
 */
export function categoryFor(tx) {
  const code = tx?.reason_code;
  if (code) {
    for (const cat of FINANCE_CATEGORIES) {
      if (REASON_CODE_GROUPS[cat].includes(code)) return cat;
    }
  }
  const type = tx?.type;
  if (type) {
    for (const cat of FINANCE_CATEGORIES) {
      if (LEGACY_TYPE_GROUPS[cat].includes(type)) return cat;
    }
  }
  return "other";
}

/**
 * Supabase PostgREST .or()-filterstreng for én kategori: matcher rows hvor
 * reason_code er i gruppen, ELLER (reason_code mangler OG legacy-type er i
 * gruppen) — dækker både post- og pre-reason_code-migration rows.
 */
export function buildCategoryOrFilter(category) {
  const codes = REASON_CODE_GROUPS[category] || [];
  const types = LEGACY_TYPE_GROUPS[category] || [];
  const parts = [];
  if (codes.length) parts.push(`reason_code.in.(${codes.join(",")})`);
  if (types.length) parts.push(`and(reason_code.is.null,type.in.(${types.join(",")}))`);
  return parts.join(",");
}
