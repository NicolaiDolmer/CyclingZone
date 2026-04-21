import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-service-key";

const { processLoanAgreementSeasonFees, shouldChargeLoanAgreementSeasonFee } = await import(
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
