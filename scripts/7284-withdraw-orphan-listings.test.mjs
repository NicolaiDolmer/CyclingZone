import test from "node:test";
import assert from "node:assert/strict";
import { findOrphanListings, run } from "./7284-withdraw-orphan-listings.mjs";

const riders = new Map([
  ["r-here", { team_id: "t1" }],
  ["r-free", { team_id: null }],
  ["r-moved", { team_id: "t2" }],
]);

test("findOrphanListings: kun aabne listings hvor rytteren ikke staar paa saelgerholdet", () => {
  const listings = [
    { id: "l1", rider_id: "r-here", seller_team_id: "t1", status: "open" },
    { id: "l2", rider_id: "r-free", seller_team_id: "t1", status: "open" },
    { id: "l3", rider_id: "r-moved", seller_team_id: "t1", status: "negotiating" },
    { id: "l4", rider_id: "r-free", seller_team_id: "t1", status: "withdrawn" },
    { id: "l5", rider_id: "r-unknown", seller_team_id: "t1", status: "open" },
  ];
  assert.deepEqual(findOrphanListings(listings, riders).map((l) => l.id), ["l2", "l3"]);
});

function fakeSupabase({ listings, riderRows }) {
  const writes = [];
  return {
    writes,
    from(table) {
      const b = {
        select() { return b; },
        range() { return b; },
        in() { return b; },
        update(patch) { writes.push({ table, patch }); return b; },
        then(resolve) {
          resolve({ data: table === "transfer_listings" ? listings : riderRows, error: null });
        },
      };
      return b;
    },
  };
}

test("run: dry-run (default) skriver intet", async () => {
  const sb = fakeSupabase({
    listings: [{ id: "l2", rider_id: "r-free", seller_team_id: "t1", status: "open" }],
    riderRows: [{ id: "r-free", team_id: null }],
  });
  const res = await run({ supabase: sb, log: () => {} });
  assert.equal(res.orphans.length, 1);
  assert.equal(res.applied, 0);
  assert.equal(sb.writes.length, 0);
});

test("run: --apply saetter withdrawn paa de forladte listings", async () => {
  const sb = fakeSupabase({
    listings: [{ id: "l2", rider_id: "r-free", seller_team_id: "t1", status: "open" }],
    riderRows: [{ id: "r-free", team_id: null }],
  });
  const res = await run({ supabase: sb, apply: true, log: () => {} });
  assert.equal(sb.writes.length, 1);
  assert.equal(sb.writes[0].patch.status, "withdrawn");
  assert.equal(res.applied, 1);
});
