import test from "node:test";
import assert from "node:assert/strict";

import { classifyListings, run } from "./repair-4211-auction-transfer-double.mjs";

test("classifyListings: dobbeltlistning og forladt pause skilles ad", () => {
  const { doubleListed, orphanPaused } = classifyListings({
    activeAuctions: [{ rider_id: "r1" }, { rider_id: "r3" }],
    listings: [
      { id: "l1", rider_id: "r1", status: "open" },
      { id: "l2", rider_id: "r2", status: "open" },
      { id: "l3", rider_id: "r3", status: "paused" },
      { id: "l4", rider_id: "r4", status: "paused" },
      { id: "l5", rider_id: "r1", status: "withdrawn" },
    ],
  });
  assert.deepEqual(doubleListed.map((l) => l.id), ["l1"]);
  assert.deepEqual(orphanPaused.map((l) => l.id), ["l4"]);
});

// Laese-fake: range/in/eq/select. Registrerer om der blev skrevet.
function makeReadOnlyFake(tables) {
  let writes = 0;
  return {
    get writes() { return writes; },
    from(table) {
      const filters = [];
      const b = {
        select() { return b; },
        range() { return b; },
        in(col, vals) { filters.push((r) => vals.includes(r[col])); return b; },
        eq(col, val) { filters.push((r) => r[col] === val); return b; },
        update() { writes += 1; return b; },
        then(resolve) {
          resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
        },
      };
      return b;
    },
  };
}

test("run: dry-run er default og skriver intet", async () => {
  const fake = makeReadOnlyFake({
    auctions: [{ rider_id: "r1", status: "active" }],
    transfer_listings: [{ id: "l1", rider_id: "r1", seller_team_id: "t1", status: "open" }],
  });
  const lines = [];
  const res = await run({ supabase: fake, log: (l) => lines.push(l) });
  assert.equal(res.doubleListed.length, 1);
  assert.equal(res.paused, 0);
  assert.equal(fake.writes, 0);
  assert.ok(lines.some((l) => l.includes("dry-run")));
});
