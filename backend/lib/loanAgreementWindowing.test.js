import test from "node:test";
import assert from "node:assert/strict";

import {
  getLoanAgreementAcceptedStatus,
  getLoanBuyoutRiderUpdate,
  getLoanBuyoutStatus,
  getWindowPendingLoanFlushStatus,
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

test("#19 loans: flush distinguishes pending activation from pending buyout", () => {
  assert.equal(
    getWindowPendingLoanFlushStatus({ to_team_id: "borrower", rider: { team_id: "lender" } }),
    "active"
  );
  assert.equal(
    getWindowPendingLoanFlushStatus({ to_team_id: "borrower", rider: { team_id: "borrower" } }),
    "buyout"
  );
});

test("#19 loans: buyout status mirrors transfer-window registration timing", () => {
  assert.equal(getLoanBuyoutStatus({ windowOpen: true }), "buyout");
  assert.equal(getLoanBuyoutStatus({ windowOpen: false }), "window_pending");
});
