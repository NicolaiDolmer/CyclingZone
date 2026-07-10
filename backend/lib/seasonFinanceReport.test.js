import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateByReason,
  buildSeasonFinanceReport,
  computeHeroCashflow,
  REASON_LABEL,
  summarizeLoans,
  summarizePrizes,
  topTransactions,
} from "./seasonFinanceReport.js";

const tx = (overrides) => ({
  id: "tx-id",
  type: "transfer_out",
  amount: -100000,
  description: "test",
  reason_code: "auction_winner_payment",
  created_at: "2026-05-08T20:00:00Z",
  ...overrides,
});

test("computeHeroCashflow — sums positive and negative separately", () => {
  const result = computeHeroCashflow([
    tx({ amount: 240000, reason_code: "season_start_sponsor" }),
    tx({ amount: -50000 }),
    tx({ amount: -30000 }),
    tx({ amount: 20000, reason_code: "auction_seller_payout" }),
  ]);
  assert.equal(result.total_in, 260000);
  assert.equal(result.total_out, -80000);
  assert.equal(result.net, 180000);
  assert.equal(result.transaction_count, 4);
});

test("computeHeroCashflow — empty array returns zeroes", () => {
  const result = computeHeroCashflow([]);
  assert.deepEqual(result, { total_in: 0, total_out: 0, net: 0, transaction_count: 0 });
});

test("computeHeroCashflow — coerces string/null amounts safely", () => {
  const result = computeHeroCashflow([
    tx({ amount: "100" }),
    tx({ amount: null }),
    tx({ amount: undefined }),
    tx({ amount: -50 }),
  ]);
  assert.equal(result.total_in, 100);
  assert.equal(result.total_out, -50);
});

test("aggregateByReason — splits income and expense by reason_code", () => {
  const result = aggregateByReason([
    tx({ amount: 240000, reason_code: "season_start_sponsor" }),
    tx({ amount: 50000, reason_code: "auction_seller_payout" }),
    tx({ amount: -100000, reason_code: "auction_winner_payment" }),
    tx({ amount: -30000, reason_code: "auction_winner_payment" }),
    tx({ amount: -20000, reason_code: "season_end_salary" }),
  ]);
  assert.deepEqual(result.income, [
    { reason_code: "season_start_sponsor", label: "Sponsor", value: 240000 },
    { reason_code: "auction_seller_payout", label: "Auction sale", value: 50000 },
  ]);
  assert.deepEqual(result.expense, [
    { reason_code: "auction_winner_payment", label: "Auction purchase", value: 130000 },
    { reason_code: "season_end_salary", label: "Salaries", value: 20000 },
  ]);
});

test("aggregateByReason — sorts descending by absolute value", () => {
  const result = aggregateByReason([
    tx({ amount: -1000, reason_code: "season_end_salary" }),
    tx({ amount: -5000, reason_code: "auction_winner_payment" }),
    tx({ amount: -3000, reason_code: "loan_repayment" }),
  ]);
  assert.deepEqual(
    result.expense.map((e) => e.value),
    [5000, 3000, 1000]
  );
});

test("aggregateByReason — unknown reason_code falls back to 'Other'", () => {
  const result = aggregateByReason([tx({ amount: -1000, reason_code: null })]);
  assert.equal(result.expense[0].reason_code, "unknown");
  assert.equal(result.expense[0].label, "Other");
});

test("aggregateByReason — skips zero-amount rows", () => {
  const result = aggregateByReason([
    tx({ amount: 0, reason_code: "season_start_sponsor" }),
    tx({ amount: 100, reason_code: "season_start_sponsor" }),
  ]);
  assert.equal(result.income.length, 1);
  assert.equal(result.income[0].value, 100);
});

test("topTransactions — returns top 3 in/out by absolute value", () => {
  const transactions = [
    tx({ id: "a", amount: 240000 }),
    tx({ id: "b", amount: -325010 }),
    tx({ id: "c", amount: -50000 }),
    tx({ id: "d", amount: 50003 }),
    tx({ id: "e", amount: -187000 }),
    tx({ id: "f", amount: -100 }),
    tx({ id: "g", amount: 12 }),
  ];
  const result = topTransactions(transactions, 3);
  assert.deepEqual(
    result.top_in.map((t) => t.id),
    ["a", "d", "g"]
  );
  assert.deepEqual(
    result.top_out.map((t) => t.id),
    ["b", "e", "c"]
  );
});

test("topTransactions — handles fewer than n in either direction", () => {
  const result = topTransactions([tx({ amount: 100 }), tx({ amount: 200 })], 3);
  assert.equal(result.top_in.length, 2);
  assert.equal(result.top_out.length, 0);
});

test("topTransactions — public output strips audit internals", () => {
  const result = topTransactions(
    [
      tx({
        id: "x",
        amount: 100,
        // simulate audit fields the helper should NOT leak
        actor_id: "secret-uuid",
        before_balance: 999999,
        after_balance: 1000099,
        idempotency_key: "secret-key",
      }),
    ],
    1
  );
  const row = result.top_in[0];
  assert.equal(row.id, "x");
  assert.equal(row.amount, 100);
  assert.ok(!("actor_id" in row));
  assert.ok(!("before_balance" in row));
  assert.ok(!("after_balance" in row));
  assert.ok(!("idempotency_key" in row));
});

test("summarizeLoans — only active loans + computes next-season interest", () => {
  const result = summarizeLoans([
    {
      id: "l1",
      status: "active",
      loan_type: "regular",
      principal: 200000,
      amount_remaining: 150000,
      interest_rate: 0.08,
      seasons_remaining: 3,
    },
    { id: "l2", status: "settled", amount_remaining: 0, interest_rate: 0.08 },
    { id: "l3", status: "pending", amount_remaining: 100000, interest_rate: 0.05 },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "l1");
  assert.equal(result[0].next_season_interest, 12000); // 150000 × 0.08
});

test("summarizeLoans — handles missing/null fields", () => {
  const result = summarizeLoans([
    { id: "l1", status: "active", amount_remaining: null, interest_rate: null },
  ]);
  assert.equal(result[0].next_season_interest, 0);
  assert.equal(result[0].amount_remaining, 0);
});

test("summarizeLoans — empty/null input returns []", () => {
  assert.deepEqual(summarizeLoans([]), []);
  assert.deepEqual(summarizeLoans(null), []);
  assert.deepEqual(summarizeLoans(undefined), []);
});

test("buildSeasonFinanceReport — combines all sections", () => {
  const report = buildSeasonFinanceReport({
    transactions: [
      tx({ amount: 240000, reason_code: "season_start_sponsor" }),
      tx({ amount: -100000, reason_code: "auction_winner_payment" }),
    ],
    loans: [
      {
        id: "l1",
        status: "active",
        amount_remaining: 50000,
        interest_rate: 0.1,
        seasons_remaining: 2,
      },
    ],
  });
  assert.equal(report.hero.total_in, 240000);
  assert.equal(report.hero.net, 140000);
  assert.equal(report.donuts.income[0].label, "Sponsor");
  assert.equal(report.donuts.expense[0].label, "Auction purchase");
  assert.equal(report.top.top_in.length, 1);
  assert.equal(report.top.top_out.length, 1);
  assert.equal(report.loans.length, 1);
  assert.equal(report.loans[0].next_season_interest, 5000);
});

test("summarizePrizes — season total, race count, all-time total og race_name-mapping", () => {
  const result = summarizePrizes(
    [
      { id: "p1", amount: 50000, race_id: "r1", description: "Prize", created_at: "2026-07-01T10:00:00Z", race: { name: "GP Copenhagen" } },
      { id: "p2", amount: 20000, race_id: "r1", description: "Bonus", created_at: "2026-07-01T10:00:00Z", race: { name: "GP Copenhagen" } },
      { id: "p3", amount: 10000, race_id: "r2", description: "Prize", created_at: "2026-07-02T10:00:00Z", race: { name: "Vuelta Zone" } },
      { id: "p4", amount: 5000, race_id: null, description: "Divisionsbonus", created_at: "2026-07-03T10:00:00Z" },
    ],
    [{ amount: 50000 }, { amount: 20000 }, { amount: 10000 }, { amount: 5000 }, { amount: 99000 }],
  );
  assert.equal(result.season_total, 85000);
  // r1 tæller én gang, r2 én gang, race-løs bonus én gang
  assert.equal(result.race_count, 3);
  assert.equal(result.all_time_total, 184000);
  assert.equal(result.rows.length, 4);
  assert.equal(result.rows[0].race_name, "GP Copenhagen");
  assert.equal(result.rows[3].race_name, null);
  assert.equal(result.rows[3].race_id, null);
});

test("summarizePrizes — tomme input giver nul-resumé", () => {
  const result = summarizePrizes([], []);
  assert.deepEqual(result, { season_total: 0, race_count: 0, all_time_total: 0, rows: [] });
  const defaulted = summarizePrizes();
  assert.deepEqual(defaulted, { season_total: 0, race_count: 0, all_time_total: 0, rows: [] });
});

test("summarizePrizes — ikke-numeriske amounts tæller som 0", () => {
  const result = summarizePrizes(
    [{ id: "p1", amount: "not-a-number", race_id: "r1", created_at: "2026-07-01T10:00:00Z" }],
    [{ amount: null }, { amount: "abc" }, { amount: 7 }],
  );
  assert.equal(result.season_total, 0);
  assert.equal(result.all_time_total, 7);
});

test("REASON_LABEL — every FINANCE_REASON value has a Danish label", async () => {
  const { FINANCE_REASON } = await import("./economyConstants.js");
  for (const code of Object.values(FINANCE_REASON)) {
    assert.ok(
      typeof REASON_LABEL[code] === "string" && REASON_LABEL[code].length > 0,
      `Mangler label for reason_code: ${code}`
    );
  }
});
