import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-service-key";

const { createEmergencyLoan, processLoanAgreementSeasonFees, shouldChargeLoanAgreementSeasonFee } = await import(
  "./loanEngine.js"
);

test("shouldChargeLoanAgreementSeasonFee only charges later covered seasons", () => {
  assert.equal(
    shouldChargeLoanAgreementSeasonFee(
      { status: "active", loan_fee: 40, start_season: 3, end_season: 4 },
      3
    ),
    false
  );

  assert.equal(
    shouldChargeLoanAgreementSeasonFee(
      { status: "active", loan_fee: 40, start_season: 3, end_season: 4 },
      4
    ),
    true
  );

  assert.equal(
    shouldChargeLoanAgreementSeasonFee(
      { status: "active", loan_fee: 40, start_season: 3, end_season: 4 },
      5
    ),
    false
  );
});

function createLoanAgreementSeasonFeeSupabase({
  teamId = "borrower-team",
  loans = [],
  balances = {},
} = {}) {
  const balanceMap = new Map(Object.entries(balances));
  const financeRows = [];

  return {
    balanceMap,
    financeRows,
    client: {
      from(table) {
        if (table === "loan_agreements") {
          return {
            select(columns) {
              assert.equal(
                columns,
                "id, from_team_id, to_team_id, loan_fee, start_season, end_season, status, rider:rider_id(firstname, lastname)"
              );

              return {
                eq(firstColumn, firstValue) {
                  assert.equal(firstColumn, "to_team_id");
                  assert.equal(firstValue, teamId);

                  return {
                    eq(secondColumn, secondValue) {
                      assert.equal(secondColumn, "status");
                      assert.equal(secondValue, "active");
                      return Promise.resolve({ data: loans, error: null });
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "teams") {
          return {
            select(columns) {
              assert.equal(columns, "balance");

              return {
                eq(column, value) {
                  assert.equal(column, "id");

                  return {
                    single() {
                      return Promise.resolve({
                        data: { balance: balanceMap.get(value) ?? 0 },
                        error: null,
                      });
                    },
                  };
                },
              };
            },
            update(payload) {
              return {
                eq(column, value) {
                  assert.equal(column, "id");
                  balanceMap.set(value, payload.balance);
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        }

        if (table === "finance_transactions") {
          return {
            insert(rows) {
              financeRows.push(...rows);
              return Promise.resolve({ error: null });
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

test("processLoanAgreementSeasonFees charges only continuing active rider loans", async () => {
  const supabase = createLoanAgreementSeasonFeeSupabase({
    loans: [
      {
        id: "loan-1",
        from_team_id: "lender-team",
        to_team_id: "borrower-team",
        loan_fee: 50,
        start_season: 3,
        end_season: 4,
        status: "active",
        rider: { firstname: "Anna", lastname: "Bjerg" },
      },
      {
        id: "loan-2",
        from_team_id: "lender-team",
        to_team_id: "borrower-team",
        loan_fee: 70,
        start_season: 4,
        end_season: 4,
        status: "active",
        rider: { firstname: "Bo", lastname: "Sprint" },
      },
    ],
    balances: {
      "borrower-team": 120,
      "lender-team": 10,
    },
  });

  const charged = await processLoanAgreementSeasonFees(
    "borrower-team",
    4,
    "season-4",
    supabase.client
  );

  assert.deepEqual(charged, [{ id: "loan-1", loan_fee: 50 }]);
  assert.equal(supabase.balanceMap.get("borrower-team"), 70);
  assert.equal(supabase.balanceMap.get("lender-team"), 60);
  assert.deepEqual(supabase.financeRows, [
    {
      team_id: "borrower-team",
      type: "transfer_out",
      amount: -50,
      description: "Lejegebyr: Anna Bjerg (sæson 4)",
      season_id: "season-4",
    },
    {
      team_id: "lender-team",
      type: "transfer_in",
      amount: 50,
      description: "Lejegebyr modtaget: Anna Bjerg (sæson 4)",
      season_id: "season-4",
    },
  ]);
});

function createEmergencyLoanSupabase({
  teamId = "team-1",
  balance = 10,
  config = {
    loan_type: "emergency",
    origination_fee_pct: 0.15,
    interest_rate_pct: 0.15,
  },
} = {}) {
  const state = {
    balance,
    loans: [],
    financeRows: [],
    notifications: [],
  };

  return {
    state,
    client: {
      from(table) {
        if (table === "teams") {
          return {
            select(columns) {
              assert.equal(["division", "balance", "user_id"].includes(columns), true);
              return {
                eq(column, value) {
                  assert.equal(column, "id");
                  assert.equal(value, teamId);
                  return {
                    single() {
                      if (columns === "division") {
                        return Promise.resolve({ data: { division: 3 }, error: null });
                      }
                      if (columns === "user_id") {
                        return Promise.resolve({ data: { user_id: "user-1" }, error: null });
                      }
                      return Promise.resolve({ data: { balance: state.balance }, error: null });
                    },
                  };
                },
              };
            },
            update(payload) {
              return {
                eq(column, value) {
                  assert.equal(column, "id");
                  assert.equal(value, teamId);
                  state.balance = payload.balance;
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        }

        if (table === "loan_config") {
          return {
            select(columns) {
              assert.equal(columns, "*");
              return {
                eq(column, value) {
                  assert.equal(column, "division");
                  assert.equal(value, 3);
                  return Promise.resolve({ data: [config], error: null });
                },
              };
            },
          };
        }

        if (table === "loans") {
          return {
            insert(row) {
              state.loans.push(row);
              return {
                select() {
                  return {
                    single() {
                      return Promise.resolve({ data: { id: "loan-1", ...row }, error: null });
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "finance_transactions") {
          return {
            insert(row) {
              state.financeRows.push(row);
              return Promise.resolve({ error: null });
            },
          };
        }

        if (table === "notifications") {
          return {
            select(columns) {
              assert.equal(columns, "id");
              const query = {
                eq() {
                  return query;
                },
                gte() {
                  return query;
                },
                order() {
                  return query;
                },
                is() {
                  return query;
                },
                limit() {
                  return Promise.resolve({ data: [], error: null });
                },
              };
              return query;
            },
            insert(row) {
              state.notifications.push(row);
              return Promise.resolve({ data: row, error: null });
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

test("createEmergencyLoan tags the finance transaction with the season id", async () => {
  const supabase = createEmergencyLoanSupabase();

  await createEmergencyLoan("team-1", 100, supabase.client, "season-6");

  assert.equal(supabase.state.balance, 110);
  assert.equal(supabase.state.loans[0].amount_remaining, 115);
  assert.deepEqual(supabase.state.financeRows, [
    {
      team_id: "team-1",
      type: "emergency_loan",
      amount: 100,
      description: "Nødlån oprettet automatisk (gebyr: 15 CZ$, rente: 15%/sæson)",
      season_id: "season-6",
    },
  ]);
});
