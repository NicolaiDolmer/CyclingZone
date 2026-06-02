// Privacy regression-tests for #105: pending/rejected/cancelled loan_agreements
// må ALDRIG eksponeres via offentlig rytter-historik.
// Verificerer også (test 3) at de samme private statuses STADIG når borrower's
// inbox via en uafhængig code-path (lib/inboxPending.js) — fixet må ikke regressere
// den private flow.

import test from "node:test";
import assert from "node:assert/strict";

const { buildRiderHistory, PUBLIC_LOAN_STATUSES } = await import("./riderHistory.js");
const { getPendingInboxItems } = await import("./inboxPending.js");

const RIDER = "rider-X";
const LENDER = "team-lender";
const BORROWER = "team-borrower";

function createRiderHistorySupabase({ loanAgreements = [] } = {}) {
  const tableData = {
    auctions: [],
    transfer_offers: [],
    swap_offers: [],
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

  return { from(table) { return buildQuery(table); } };
}

function loanRow({ id, status }) {
  return {
    id,
    status,
    loan_fee: 30000,
    start_season: 1,
    end_season: 1,
    rider_id: RIDER,
    from_team_id: LENDER,
    to_team_id: BORROWER,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    from_team: { id: LENDER, name: "Lender Team" },
    to_team: { id: BORROWER, name: "Borrower Team" },
  };
}

const ALL_LOAN_STATUSES = ["active", "window_pending", "buyout_pending", "completed", "buyout", "pending", "rejected", "cancelled"];

test("riderHistory — rejected loan_agreements ekskluderes fra public history (#105)", async () => {
  const supabase = createRiderHistorySupabase({
    loanAgreements: [
      loanRow({ id: "L-rejected", status: "rejected" }),
      loanRow({ id: "L-active", status: "active" }),
    ],
  });

  const events = await buildRiderHistory(supabase, RIDER);
  const loanIds = events.filter((e) => e.type === "loan").map((e) => e.id ?? e.status);

  assert.equal(events.filter((e) => e.type === "loan" && e.status === "rejected").length, 0,
    "rejected loan må ikke vises i public history");
  assert.ok(events.some((e) => e.type === "loan" && e.status === "active"),
    "active loan skal stadig vises");
});

test("riderHistory — pending og cancelled loan_agreements ekskluderes (#105)", async () => {
  const supabase = createRiderHistorySupabase({
    loanAgreements: [
      loanRow({ id: "L-pending", status: "pending" }),
      loanRow({ id: "L-cancelled", status: "cancelled" }),
      loanRow({ id: "L-active", status: "active" }),
    ],
  });

  const events = await buildRiderHistory(supabase, RIDER);
  const loanEvents = events.filter((e) => e.type === "loan");

  assert.equal(loanEvents.filter((e) => e.status === "pending").length, 0,
    "pending loan må ikke vises i public history");
  assert.equal(loanEvents.filter((e) => e.status === "cancelled").length, 0,
    "cancelled loan må ikke vises i public history");
  assert.equal(loanEvents.length, 1);
  assert.equal(loanEvents[0].status, "active");
});

test("riderHistory — pending loan er STADIG synlig for borrower i inboxPending (#105 regression-guard)", async () => {
  const inboxSupabase = (() => {
    const tableData = {
      transfer_offers: [],
      swap_offers: [],
      loan_agreements: [
        {
          ...loanRow({ id: "L-pending", status: "pending" }),
          buy_option_price: null,
          rider: { id: RIDER, firstname: "Test", lastname: "Rider" },
        },
      ],
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
            if (filters.in && !filters.in.values.includes(row[filters.in.column])) return false;
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
    return { from(table) { return buildQuery(table); } };
  })();

  const inbox = await getPendingInboxItems({ supabase: inboxSupabase, teamId: BORROWER });
  assert.equal(inbox.counts.loan_offers, 1, "borrower SKAL stadig se pending loan i inbox");
  assert.equal(inbox.loan_offers[0].id, "L-pending");
  assert.equal(inbox.loan_offers[0].role, "borrower_decide");
});

test("riderHistory — active, window_pending, buyout_pending, completed, buyout returneres", async () => {
  const supabase = createRiderHistorySupabase({
    loanAgreements: [
      loanRow({ id: "L-active", status: "active" }),
      loanRow({ id: "L-window-pending", status: "window_pending" }),
      loanRow({ id: "L-buyout-pending", status: "buyout_pending" }),
      loanRow({ id: "L-completed", status: "completed" }),
      loanRow({ id: "L-buyout", status: "buyout" }),
      loanRow({ id: "L-rejected", status: "rejected" }),
    ],
  });

  const events = await buildRiderHistory(supabase, RIDER);
  const loanStatuses = events.filter((e) => e.type === "loan").map((e) => e.status).sort();

  assert.deepEqual(loanStatuses, ["active", "buyout", "buyout_pending", "completed", "window_pending"]);
  assert.equal(events.filter((e) => e.type === "loan").length, 5);
});

test("riderHistory — PUBLIC_LOAN_STATUSES whitelist matcher kontrakten", () => {
  assert.deepEqual(
    [...PUBLIC_LOAN_STATUSES].sort(),
    ["active", "buyout", "buyout_pending", "completed", "window_pending"],
    "Whitelist må kun indeholde offentligt-synlige loan-statuses"
  );
  for (const privateStatus of ["pending", "rejected", "cancelled"]) {
    assert.ok(
      !PUBLIC_LOAN_STATUSES.includes(privateStatus),
      `${privateStatus} må aldrig være på public whitelist`
    );
  }
  for (const status of ALL_LOAN_STATUSES) {
    // Sanity: enum-coverage — fanger drift hvis en ny status tilføjes uden review
    assert.ok(
      PUBLIC_LOAN_STATUSES.includes(status) ||
        ["pending", "rejected", "cancelled"].includes(status),
      `Ukendt status ${status} — review om den er public eller privat`
    );
  }
});
