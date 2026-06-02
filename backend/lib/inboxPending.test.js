import test from "node:test";
import assert from "node:assert/strict";

const { getPendingInboxItems, __testing } = await import("./inboxPending.js");
const { classifyTransferOfferRole, classifySwapOfferRole, emptyResult } = __testing;

const TEAM = "team-mine";
const OTHER = "team-other";

function createInboxSupabase({
  transferOffers = [],
  swapOffers = [],
  loanAgreements = [],
} = {}) {
  const tableData = {
    transfer_offers: transferOffers,
    swap_offers: swapOffers,
    loan_agreements: loanAgreements,
  };

  function buildQuery(table) {
    const filters = { or: [], in: null, eq: [] };
    const chain = {
      select() { return chain; },
      or(expr) { filters.or.push(expr); return chain; },
      in(column, values) { filters.in = { column, values }; return chain; },
      eq(column, value) { filters.eq.push({ column, value }); return chain; },
      order() {
        const rows = tableData[table].filter((row) => {
          if (filters.in && !filters.in.values.includes(row[filters.in.column])) {
            return false;
          }
          for (const { column, value } of filters.eq) {
            if (row[column] !== value) return false;
          }
          return true;
        });
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return chain;
  }

  return {
    from(table) {
      if (!(table in tableData)) {
        throw new Error(`Unexpected table: ${table}`);
      }
      return buildQuery(table);
    },
  };
}

test("getPendingInboxItems returns empty result when teamId is null", async () => {
  const result = await getPendingInboxItems({ supabase: null, teamId: null });
  assert.deepEqual(result, emptyResult());
});

test("classifyTransferOfferRole — pending received (seller decides)", () => {
  const role = classifyTransferOfferRole(
    { status: "pending", seller_team_id: TEAM, buyer_team_id: OTHER },
    TEAM
  );
  assert.equal(role, "seller_decide");
});

test("classifyTransferOfferRole — countered to buyer (buyer decides)", () => {
  const role = classifyTransferOfferRole(
    { status: "countered", seller_team_id: OTHER, buyer_team_id: TEAM },
    TEAM
  );
  assert.equal(role, "buyer_decide");
});

test("classifyTransferOfferRole — awaiting_confirmation, seller hasn't confirmed", () => {
  const role = classifyTransferOfferRole(
    {
      status: "awaiting_confirmation",
      seller_team_id: TEAM,
      buyer_team_id: OTHER,
      seller_confirmed: false,
      buyer_confirmed: true,
    },
    TEAM
  );
  assert.equal(role, "seller_confirm");
});

test("classifyTransferOfferRole — awaiting_confirmation, my side already confirmed → null", () => {
  const role = classifyTransferOfferRole(
    {
      status: "awaiting_confirmation",
      seller_team_id: TEAM,
      buyer_team_id: OTHER,
      seller_confirmed: true,
      buyer_confirmed: false,
    },
    TEAM
  );
  assert.equal(role, null);
});

test("classifyTransferOfferRole — pending sent by me (buyer waits) → null", () => {
  const role = classifyTransferOfferRole(
    { status: "pending", seller_team_id: OTHER, buyer_team_id: TEAM },
    TEAM
  );
  assert.equal(role, null);
});

test("classifySwapOfferRole — pending received by me", () => {
  const role = classifySwapOfferRole(
    { status: "pending", proposing_team_id: OTHER, receiving_team_id: TEAM },
    TEAM
  );
  assert.equal(role, "receiving_decide");
});

test("classifySwapOfferRole — awaiting_confirmation, my proposing side hasn't confirmed", () => {
  const role = classifySwapOfferRole(
    {
      status: "awaiting_confirmation",
      proposing_team_id: TEAM,
      receiving_team_id: OTHER,
      proposing_confirmed: false,
      receiving_confirmed: true,
    },
    TEAM
  );
  assert.equal(role, "proposing_confirm");
});

test("getPendingInboxItems aggregates transfer + swap + loan with correct counts", async () => {
  const supabase = createInboxSupabase({
    transferOffers: [
      {
        id: "to-1",
        status: "pending",
        offer_amount: 100000,
        counter_amount: null,
        buyer_team_id: OTHER,
        seller_team_id: TEAM,
        rider_id: "rider-1",
        buyer_confirmed: false,
        seller_confirmed: false,
        created_at: "2026-05-04T10:00:00Z",
        updated_at: "2026-05-04T10:00:00Z",
        rider: { id: "rider-1", firstname: "Tadej", lastname: "Pogačar" },
        buyer_team: { id: OTHER, name: "Other Team" },
        seller_team: { id: TEAM, name: "My Team" },
      },
      {
        id: "to-2",
        status: "pending",
        offer_amount: 50000,
        counter_amount: null,
        buyer_team_id: TEAM,
        seller_team_id: OTHER,
        rider_id: "rider-2",
        buyer_confirmed: false,
        seller_confirmed: false,
        created_at: "2026-05-04T11:00:00Z",
        updated_at: "2026-05-04T11:00:00Z",
        rider: { id: "rider-2", firstname: "Jonas", lastname: "Vingegaard" },
        buyer_team: { id: TEAM, name: "My Team" },
        seller_team: { id: OTHER, name: "Other Team" },
      },
    ],
    swapOffers: [
      {
        id: "swap-1",
        status: "pending",
        proposing_team_id: OTHER,
        receiving_team_id: TEAM,
        offered_rider_id: "rider-3",
        requested_rider_id: "rider-4",
        cash_adjustment: 25000,
        counter_cash: null,
        proposing_confirmed: false,
        receiving_confirmed: false,
        created_at: "2026-05-04T09:00:00Z",
        updated_at: "2026-05-04T09:00:00Z",
        offered_rider: { id: "rider-3", firstname: "Mathieu", lastname: "van der Poel" },
        requested_rider: { id: "rider-4", firstname: "Wout", lastname: "van Aert" },
        proposing_team: { id: OTHER, name: "Other Team" },
        receiving_team: { id: TEAM, name: "My Team" },
      },
    ],
    loanAgreements: [
      {
        id: "loan-1",
        status: "pending",
        loan_fee: 30000,
        start_season: 7,
        end_season: 7,
        buy_option_price: null,
        from_team_id: TEAM,
        to_team_id: OTHER,
        rider_id: "rider-5",
        created_at: "2026-05-04T08:00:00Z",
        updated_at: "2026-05-04T08:00:00Z",
        rider: { id: "rider-5", firstname: "Remco", lastname: "Evenepoel" },
        to_team: { id: OTHER, name: "Other Team" },
      },
    ],
  });

  const result = await getPendingInboxItems({ supabase, teamId: TEAM });

  assert.equal(result.counts.total, 3);
  assert.equal(result.counts.transfer_offers, 1);
  assert.equal(result.counts.swap_offers, 1);
  assert.equal(result.counts.loan_offers, 1);

  // to-1: I am seller of pending received offer
  assert.equal(result.transfer_offers[0].id, "to-1");
  assert.equal(result.transfer_offers[0].role, "seller_decide");
  assert.equal(result.transfer_offers[0].rider_name, "Tadej Pogačar");
  assert.equal(result.transfer_offers[0].counterparty_team_name, "Other Team");
  assert.equal(result.transfer_offers[0].price, 100000);

  // to-2: I am buyer of pending offer I sent → role=null → filtered out
  // (Only 1 transfer_offer should be in result)

  assert.equal(result.swap_offers[0].id, "swap-1");
  assert.equal(result.swap_offers[0].role, "receiving_decide");
  assert.equal(result.swap_offers[0].cash_adjustment, 25000);

  assert.equal(result.loan_offers[0].id, "loan-1");
  assert.equal(result.loan_offers[0].role, "lender_decide");
  assert.equal(result.loan_offers[0].counterparty_team_name, "Other Team");
  assert.equal(result.loan_offers[0].loan_fee, 30000);
});

test("getPendingInboxItems excludes awaiting_confirmation where my side already confirmed", async () => {
  const supabase = createInboxSupabase({
    transferOffers: [
      {
        id: "to-confirmed",
        status: "awaiting_confirmation",
        offer_amount: 100000,
        counter_amount: null,
        buyer_team_id: OTHER,
        seller_team_id: TEAM,
        rider_id: "rider-1",
        buyer_confirmed: false,
        seller_confirmed: true,  // I (seller) already confirmed
        created_at: "2026-05-04T10:00:00Z",
        updated_at: "2026-05-04T10:00:00Z",
        rider: { id: "rider-1", firstname: "Tadej", lastname: "Pogačar" },
        buyer_team: { id: OTHER, name: "Other Team" },
        seller_team: { id: TEAM, name: "My Team" },
      },
    ],
  });

  const result = await getPendingInboxItems({ supabase, teamId: TEAM });
  assert.equal(result.counts.total, 0);
});
