import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateAuctionSalary,
  finalizeExpiredAuctions,
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

function createExpiredAuctionsLookupSupabase({ data = [], error = null } = {}) {
  return {
    from(table) {
      assert.equal(table, "auctions");

      return {
        select(columns) {
          assert.equal(columns, "id");

          return {
            in(column, statuses) {
              assert.equal(column, "status");
              assert.deepEqual(statuses, ["active", "extended"]);

              return {
                lte(field, _value) {
                  assert.equal(field, "calculated_end");
                  return Promise.resolve({ data, error });
                },
              };
            },
          };
        },
      };
    },
  };
}

test("finalizeExpiredAuctions can no-op when there are no expired auctions", async () => {
  const results = await finalizeExpiredAuctions({
    supabase: createExpiredAuctionsLookupSupabase(),
    notifyTeamOwner: async () => {},
  });

  assert.deepEqual(results, []);
});

test("finalizeExpiredAuctions surfaces lookup errors before processing auctions", async () => {
  await assert.rejects(
    finalizeExpiredAuctions({
      supabase: createExpiredAuctionsLookupSupabase({
        error: { message: "auction lookup failed" },
      }),
      notifyTeamOwner: async () => {},
    }),
    /auction lookup failed/
  );
});
