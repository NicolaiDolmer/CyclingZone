import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateAuctionSalary,
  sellerOwnsAuctionRider,
} from "./auctionFinalization.js";

test("sellerOwnsAuctionRider is only true when the seller actually owned the rider", () => {
  assert.equal(
    sellerOwnsAuctionRider({
      seller_team_id: "team-1",
      rider: { team_id: "team-1" },
    }),
    true
  );

  assert.equal(
    sellerOwnsAuctionRider({
      seller_team_id: "team-1",
      rider: { team_id: null },
    }),
    false
  );

  assert.equal(
    sellerOwnsAuctionRider({
      seller_team_id: "team-1",
      rider: { team_id: "ai-team" },
    }),
    false
  );
});

test("calculateAuctionSalary keeps the 10 percent rule with a minimum salary of 1", () => {
  assert.equal(calculateAuctionSalary(1), 1);
  assert.equal(calculateAuctionSalary(9), 1);
  assert.equal(calculateAuctionSalary(10), 1);
  assert.equal(calculateAuctionSalary(11), 2);
});
