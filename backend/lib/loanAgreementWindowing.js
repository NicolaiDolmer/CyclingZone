export function getLoanAgreementAcceptedStatus({ windowOpen }) {
  return windowOpen ? "active" : "window_pending";
}

export function getLoanBuyoutStatus({ windowOpen }) {
  return windowOpen ? "buyout" : "window_pending";
}

export function getLoanBuyoutRiderUpdate({ windowOpen, borrowerTeamId, timestamp }) {
  if (windowOpen) {
    return { team_id: borrowerTeamId, pending_team_id: null, acquired_at: timestamp };
  }
  return { pending_team_id: borrowerTeamId };
}

export function getWindowPendingLoanFlushStatus(loan) {
  return loan?.rider?.team_id === loan?.to_team_id ? "buyout" : "active";
}
