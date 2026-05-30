import test from "node:test";
import assert from "node:assert/strict";

import { getSeasonPrizePreview } from "./prizePayoutEngine.js";

// Mock-query-builder: thenable (for kæder der afsluttes uden .range(), fx races/
// teams) OG med .range() der pager (for fetchAllRows på race_results/finance_tx).
// Håndhæver PostgREST's 1000-row-loft pr. side via slice, så manglende paginering
// fanges af testen.
function queryFor(rows) {
  const obj = {
    select: () => obj,
    eq: () => obj,
    in: () => obj,
    gt: () => obj,
    order: () => obj,
    range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
    then: (resolve) => resolve({ data: rows, error: null }),
  };
  return obj;
}

function makeSupabase({ races = [], results = [], transactions = [], teams = [] }) {
  return {
    from(table) {
      if (table === "races") return queryFor(races);
      if (table === "race_results") return queryFor(results);
      if (table === "finance_transactions") return queryFor(transactions);
      if (table === "teams") return queryFor(teams);
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

test("getSeasonPrizePreview paginerer race_results forbi 1000-row-loftet", async () => {
  // 2500 præmie-rækker (10 CZ$ hver) for ét hold i ét ubetalt løb. Uden
  // paginering ville kun de første 1000 tælle → 10.000 i stedet for 25.000.
  const results = [];
  for (let i = 0; i < 2500; i += 1) {
    results.push({ race_id: "r1", team_id: "t1", prize_money: 10 });
  }
  const supabase = makeSupabase({
    races: [{ id: "r1", name: "Race 1", prize_paid_at: null, status: "completed" }],
    results,
    teams: [{ id: "t1", name: "Team 1" }],
  });

  const preview = await getSeasonPrizePreview("season-1", supabase);

  assert.equal(preview.pending_payment.length, 1);
  assert.equal(preview.pending_payment[0].total_prize, 25000); // alle 2500 sider talt
  assert.equal(preview.total_pending, 25000);
});

test("getSeasonPrizePreview splitter betalte og udestående løb", async () => {
  const supabase = makeSupabase({
    races: [
      { id: "paid", name: "Betalt", prize_paid_at: "2026-05-30T00:00:00Z", status: "completed" },
      { id: "pending", name: "Udestående", prize_paid_at: null, status: "completed" },
    ],
    results: [
      { race_id: "pending", team_id: "t1", prize_money: 500 },
      { race_id: "pending", team_id: "t2", prize_money: 300 },
      // 0-præmie-rækker filtreres af .gt("prize_money", 0) i prod; mock returnerer
      // kun det query'et ville — så vi udelader dem her.
    ],
    transactions: [
      { race_id: "paid", team_id: "t1", amount: 800 },
    ],
    teams: [{ id: "t1", name: "Team 1" }, { id: "t2", name: "Team 2" }],
  });

  const preview = await getSeasonPrizePreview("season-1", supabase);

  assert.equal(preview.already_paid.length, 1);
  assert.equal(preview.already_paid[0].total_paid, 800);
  assert.equal(preview.pending_payment.length, 1);
  assert.equal(preview.pending_payment[0].total_prize, 800);
  assert.equal(preview.total_pending, 800);
  // team-navne resolves
  assert.equal(preview.pending_payment[0].by_team.find(t => t.team_id === "t1").team_name, "Team 1");
});

test("getSeasonPrizePreview returnerer tomt ved ingen løb", async () => {
  const preview = await getSeasonPrizePreview("season-1", makeSupabase({ races: [] }));
  assert.deepEqual(preview, { already_paid: [], pending_payment: [], total_pending: 0 });
});
