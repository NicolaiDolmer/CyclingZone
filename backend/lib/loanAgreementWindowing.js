// Loan-windowing status helpers. A loan accepted or bought out while the
// transfer window is CLOSED is "parked" until the window opens and the flush
// registers it. Parked accepts and parked buyouts use DISTINCT statuses so
// downstream counts and the flush never conflate them (#19 audit):
//   - accept parked → "window_pending"  (rider stays on lender; loan record only)
//   - buyout parked → "buyout_pending"  (rider.pending_team_id = borrower)
// Keeping them distinct fixes the squad-cap double-count (a buyout-parked rider
// was counted both via rider.pending_team_id AND via its window_pending loan)
// and lets the flush classify off the loan's persisted intent instead of
// deriving it from separately-mutated rider state.

export const PARKED_LOAN_STATUSES = ["window_pending", "buyout_pending"];

export function getLoanAgreementAcceptedStatus({ windowOpen }) {
  return windowOpen ? "active" : "window_pending";
}

export function getLoanBuyoutStatus({ windowOpen }) {
  return windowOpen ? "buyout" : "buyout_pending";
}

export function getLoanBuyoutRiderUpdate({ windowOpen, borrowerTeamId, timestamp }) {
  if (windowOpen) {
    return { team_id: borrowerTeamId, pending_team_id: null, acquired_at: timestamp };
  }
  return { pending_team_id: borrowerTeamId };
}

export function getWindowPendingLoanFlushStatus(loan) {
  // Classify off the loan's persisted status, NOT the (separately mutated)
  // rider.team_id — a partial rider-flush failure must never silently downgrade
  // a paid buyout to a plain loan (#19 audit, finding #2).
  return loan?.status === "buyout_pending" ? "buyout" : "active";
}
