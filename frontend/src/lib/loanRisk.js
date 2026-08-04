// #2815 — friction + transparency for large/high-debt loans on the Finance
// page's "Take out a loan" form.
//
// Context: a new team can walk straight to /finance and max out its
// division's debt ceiling within minutes of creation — 500,000 CZ$ starting
// balance + a maxed loan = 888,349 CZ$ in Division 4, 1,082,524 CZ$ in
// Division 3, with zero warning about what the debt costs afterwards. Prod
// evidence (read-only, 2026-08-05, ghwvkxzhsbbltzfnuhhz): of 5 real teams
// that took their first loan within 24h of signup, 3 went straight from 0%
// to 100% of their division's ceiling on that SINGLE loan, and all 3 are
// still sitting at 100% of ceiling today, one down to an 877 CZ$ balance.
// The one day-one borrower who came out fine (A-PEX VELO) took a loan that
// was only ~22% of the ceiling.
//
// The server-side hard gate for NEW accounts (age/race-days) already exists
// (#3134, PR #3228) and ships config-driven + disabled pending an owner
// threshold decision — this module does NOT duplicate that. This is the
// UX/transparency track #2815 explicitly kept: it never blocks a loan the
// server would accept, it only decides when to show the player the season
// cost before the money moves. Deliberately NOT gated on account age — the
// trigger is the resulting debt ratio, so a five-season veteran taking a
// reckless loan sees exactly the same confirmation as a day-one team. No
// player is treated differently for being new OR for being strong; the only
// input is "how much of the division's ceiling would this loan use up".

// 50%: below this ratio a loan reads as a normal financing tool (transfer
// top-up, a timing gap); at/above it we're in "large commitment" territory.
// Chosen from the live evidence above: the 3 bad day-one cases went 0%→100%
// in one loan, the 1 good case stopped at ~22%. 50% sits well clear of the
// good case and well below the bad ones, so it catches the "one big loan, no
// runway" pattern without nagging ordinary top-up borrowing. Easy to retune
// (single constant) if live data after ship suggests otherwise.
export const LOAN_CONFIRM_DEBT_RATIO = 0.5;

/**
 * Pure risk summary for a candidate loan, computed from numbers the Finance
 * page's loan form already has (server-sourced debt_ceiling/current debt +
 * the form's own principal/fee/interest for the selected loan type). Never
 * duplicates loanEngine.js's own ceiling check — this is purely a UX signal
 * for when to show a confirmation step, not a source of truth for what the
 * server will accept.
 *
 * @param {object} params
 * @param {number} params.principal - requested loan principal
 * @param {number} params.fee - origination fee for this principal
 * @param {number} params.interestRatePct - the loan type's per-season interest rate (0..1)
 * @param {number} params.currentDebt - team's total_debt BEFORE this loan
 * @param {number|null} params.debtCeiling - division's debt ceiling, or null/undefined if unconfigured
 * @returns {{
 *   totalOwed: number,
 *   newTotalDebt: number,
 *   ceilingPct: number,
 *   nextSeasonInterest: number,
 *   projectedDebtAfterInterest: number,
 *   exceedsCeilingNextSeason: boolean,
 *   isHighDebt: boolean,
 * }}
 */
export function computeLoanRiskSummary({ principal, fee, interestRatePct, currentDebt, debtCeiling }) {
  const totalOwed = (principal || 0) + (fee || 0);
  const newTotalDebt = (currentDebt || 0) + totalOwed;
  const hasCeiling = debtCeiling != null && debtCeiling > 0;
  const ceilingPct = hasCeiling ? newTotalDebt / debtCeiling : 0;

  // Mirrors processLoanInterest's own math (backend/lib/loanEngine.js):
  // Math.round(amount_remaining * interest_rate), capitalized on the WHOLE
  // remaining balance (principal + fee), not principal alone. Purely
  // illustrative here — the actual next-season charge depends on any
  // repayments made before then.
  const nextSeasonInterest = Math.round(newTotalDebt * (interestRatePct || 0));
  const projectedDebtAfterInterest = newTotalDebt + nextSeasonInterest;
  const exceedsCeilingNextSeason = hasCeiling && projectedDebtAfterInterest > debtCeiling;
  const isHighDebt = hasCeiling && ceilingPct >= LOAN_CONFIRM_DEBT_RATIO;

  return {
    totalOwed,
    newTotalDebt,
    ceilingPct,
    nextSeasonInterest,
    projectedDebtAfterInterest,
    exceedsCeilingNextSeason,
    isHighDebt,
  };
}
