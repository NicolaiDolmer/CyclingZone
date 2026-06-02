import test from "node:test";
import assert from "node:assert/strict";

import {
  getLoanAgreementAcceptedStatus,
  getLoanBuyoutRiderUpdate,
  getLoanBuyoutStatus,
  getWindowPendingLoanFlushStatus,
  PARKED_LOAN_STATUSES,
} from "./loanAgreementWindowing.js";

test("#19 loans: accept is active in open window and window_pending in closed window", () => {
  assert.equal(getLoanAgreementAcceptedStatus({ windowOpen: true }), "active");
  assert.equal(getLoanAgreementAcceptedStatus({ windowOpen: false }), "window_pending");
});

test("#19 loans: buyout parks rider ownership while the window is closed", () => {
  assert.deepEqual(
    getLoanBuyoutRiderUpdate({ windowOpen: false, borrowerTeamId: "borrower", timestamp: "2026-06-01T00:00:00.000Z" }),
    { pending_team_id: "borrower" }
  );

  assert.deepEqual(
    getLoanBuyoutRiderUpdate({ windowOpen: true, borrowerTeamId: "borrower", timestamp: "2026-06-01T00:00:00.000Z" }),
    { team_id: "borrower", pending_team_id: null, acquired_at: "2026-06-01T00:00:00.000Z" }
  );
});

test("#19 audit: closed-window buyout uses a DISTINCT 'buyout_pending' status", () => {
  // Regression for the squad-cap double-count + flush-misclassification: a parked
  // buyout must NOT reuse 'window_pending' (that status is for parked accepts).
  assert.equal(getLoanBuyoutStatus({ windowOpen: true }), "buyout");
  assert.equal(getLoanBuyoutStatus({ windowOpen: false }), "buyout_pending");
});

test("#19 audit: flush classifies off persisted loan status, not mutated rider.team_id", () => {
  // Finding #2: a partial rider-flush failure must not downgrade a paid buyout to
  // a plain loan. Classification is driven purely by loan.status now.
  assert.equal(getWindowPendingLoanFlushStatus({ status: "buyout_pending" }), "buyout");
  assert.equal(getWindowPendingLoanFlushStatus({ status: "window_pending" }), "active");
  // Even if rider state looks "moved", a window_pending (accept) loan stays active.
  assert.equal(
    getWindowPendingLoanFlushStatus({ status: "window_pending", to_team_id: "borrower", rider: { team_id: "borrower" } }),
    "active"
  );
  // And a buyout_pending loan stays a buyout even if the rider move did NOT land.
  assert.equal(
    getWindowPendingLoanFlushStatus({ status: "buyout_pending", to_team_id: "borrower", rider: { team_id: "lender" } }),
    "buyout"
  );
});

test("#19 audit: PARKED_LOAN_STATUSES covers both parked accept and parked buyout", () => {
  assert.deepEqual(PARKED_LOAN_STATUSES, ["window_pending", "buyout_pending"]);
});
