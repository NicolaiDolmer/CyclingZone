// #6304: rytterhistorikken må ikke vise "X vandt af X". Et hold kan byde på sin
// egen AI/free-agent-auktion (#194-reglen), så sælger og vinder er samme hold —
// rækken markeres seller_is_buyer, så UI'et kan skjule "won from"-halvdelen.

import test from "node:test";
import assert from "node:assert/strict";

const { buildRiderHistory } = await import("./riderHistory.js");

const RIDER = "rider-X";

function makeSupabase(tableData) {
  function buildQuery(table) {
    const chain = {
      select() { return chain; },
      or() { return chain; },
      in() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      then(onResolve, onReject) {
        return Promise.resolve({ data: tableData[table] || [], error: null }).then(onResolve, onReject);
      },
    };
    return chain;
  }
  return { from(table) { return buildQuery(table); } };
}

function auction({ id, seller, winner, date }) {
  return {
    id,
    status: "completed",
    rider_id: RIDER,
    current_price: 1000,
    actual_end: date,
    created_at: date,
    is_guaranteed_sale: false,
    seller: seller ? { id: seller, name: `Team ${seller}`, is_ai: false } : null,
    winner: winner ? { id: winner, name: `Team ${winner}` } : null,
  };
}

test("riderHistory — sælger = vinder markeres seller_is_buyer (#6304)", async () => {
  const supabase = makeSupabase({
    auctions: [
      auction({ id: "A-self", seller: "team-a", winner: "team-a", date: "2026-10-01T10:00:00Z" }),
      auction({ id: "A-other", seller: "team-a", winner: "team-b", date: "2026-09-01T10:00:00Z" }),
      auction({ id: "A-free", seller: null, winner: "team-b", date: "2026-08-01T10:00:00Z" }),
    ],
    transfer_offers: [],
    swap_offers: [],
    rider_ownership_events: [],
  });

  const events = await buildRiderHistory(supabase, RIDER);
  const byDate = (d) => events.find((e) => e.date === d);

  const self = byDate("2026-10-01T10:00:00Z");
  assert.equal(self.seller_is_buyer, true, "samme hold på begge sider er et genkøb");
  assert.equal(self.no_sale, false, "genkøbet er stadig en reel handel med beløb");
  assert.equal(self.price, 1000);
  assert.equal(self.buyer.id, "team-a");

  assert.equal(byDate("2026-09-01T10:00:00Z").seller_is_buyer, false, "to forskellige hold er et normalt salg");
  assert.equal(byDate("2026-08-01T10:00:00Z").seller_is_buyer, false, "free-agent uden sælger er ikke et genkøb");
});
