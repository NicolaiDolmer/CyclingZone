import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-service-key";

const {
  computeLoanFee,
  computeMaxLoanPrincipal,
  createEmergencyLoan,
  createLoan,
  processLoanAgreementSeasonFees,
  shouldChargeLoanAgreementSeasonFee,
} = await import("./loanEngine.js");

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
      // Slice 07c: balance + finance_transactions går nu via RPC. Mock simulerer
      // den atomic UPDATE+INSERT i én operation.
      rpc(name, params) {
        assert.equal(name, "increment_balance_with_audit");
        const before = balanceMap.get(params.p_team_id) ?? 0;
        const after = before + params.p_delta;
        balanceMap.set(params.p_team_id, after);
        financeRows.push({
          team_id: params.p_team_id,
          ...params.p_finance_payload,
        });
        return Promise.resolve({ data: after, error: null });
      },
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
      // #666: description null for nye rows; metadata.code+params driver i18n.
      description: null,
      season_id: "season-4",
      actor_type: "cron",
      actor_id: null,
      source_path: "loanEngine.processLoanAgreementSeasonFees.payer",
      reason_code: "loan_fee_paid",
      related_entity_type: "loan",
      related_entity_id: "loan-1",
      idempotency_key: "loan_fee_paid:loan-1:season-4",
      metadata: { code: "tx.loanFeePaid", params: { riderName: "Anna Bjerg", season: 4 } },
    },
    {
      team_id: "lender-team",
      type: "transfer_in",
      amount: 50,
      description: null,
      season_id: "season-4",
      actor_type: "cron",
      actor_id: null,
      source_path: "loanEngine.processLoanAgreementSeasonFees.receiver",
      reason_code: "loan_fee_received",
      related_entity_type: "loan",
      related_entity_id: "loan-1",
      idempotency_key: "loan_fee_received:loan-1:season-4",
      metadata: { code: "tx.loanFeeReceived", params: { riderName: "Anna Bjerg", season: 4 } },
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
      // Slice 07c: balance + finance_transactions atomic via RPC.
      rpc(name, params) {
        assert.equal(name, "increment_balance_with_audit");
        assert.equal(params.p_team_id, teamId);
        state.balance = state.balance + params.p_delta;
        state.financeRows.push({
          team_id: params.p_team_id,
          ...params.p_finance_payload,
        });
        return Promise.resolve({ data: state.balance, error: null });
      },
      from(table) {
        if (table === "teams") {
          return {
            select(columns) {
              assert.equal(["division", "user_id"].includes(columns), true);
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
                      throw new Error(`Unexpected teams.select columns: ${columns}`);
                    },
                  };
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
      // #666: description nu null for nye tx; rendering kommer fra metadata.code+params.
      description: null,
      season_id: "season-6",
      actor_type: "cron",
      actor_id: null,
      source_path: "loanEngine.createEmergencyLoan",
      reason_code: "emergency_loan_received",
      related_entity_type: "loan",
      related_entity_id: "loan-1",
      metadata: {
        code: "tx.emergencyLoan",
        params: { feeRate: 15, interestRate: 15 },
      },
    },
  ]);
});

function createCeilingSupabase({
  teamId = "team-1",
  division = 3,
  balance = 0,
  existingDebt = 0,
  config = {
    loan_type: "long",
    origination_fee_pct: 0.05,
    interest_rate_pct: 0.12,
    seasons: 5,
    debt_ceiling: 600000,
  },
} = {}) {
  const state = { balance, loans: [], financeRows: [], notifications: [] };
  return {
    state,
    client: {
      // Slice 07c: balance + finance_transactions atomic via RPC.
      rpc(name, params) {
        if (name === "create_loan_atomic") {
          // Mock create_loan_atomic ved at returnere PGRST202 så app falder
          // tilbage til app-niveau path (mirror af gammel test-mock-adfærd).
          return Promise.resolve({ data: null, error: { code: "PGRST202", message: "function not exposed in mock" } });
        }
        if (name === "increment_balance_with_audit") {
          state.balance = state.balance + params.p_delta;
          state.financeRows.push({
            team_id: params.p_team_id,
            ...params.p_finance_payload,
          });
          return Promise.resolve({ data: state.balance, error: null });
        }
        throw new Error(`Unexpected rpc: ${name}`);
      },
      from(table) {
        if (table === "teams") {
          return {
            select(columns) {
              return {
                eq() {
                  return {
                    single() {
                      if (columns === "division") return Promise.resolve({ data: { division }, error: null });
                      if (columns === "user_id") return Promise.resolve({ data: { user_id: "user-1" }, error: null });
                      throw new Error(`Unexpected teams.select columns: ${columns}`);
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "loan_config") {
          return {
            select() { return { eq() { return Promise.resolve({ data: [config], error: null }); } };
            },
          };
        }
        if (table === "loans") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return Promise.resolve({
                        data: existingDebt > 0 ? [{ amount_remaining: existingDebt }] : [],
                        error: null,
                      });
                    },
                  };
                },
              };
            },
            insert(row) {
              state.loans.push(row);
              return { select() { return { single() { return Promise.resolve({ data: { id: "loan-x", ...row }, error: null }); } }; } };
            },
          };
        }
        if (table === "notifications") {
          const query = { eq() { return query; }, gte() { return query; }, order() { return query; }, is() { return query; }, limit() { return Promise.resolve({ data: [], error: null }); } };
          return {
            select() { return query; },
            insert(row) { state.notifications.push(row); return Promise.resolve({ data: row, error: null }); },
          };
        }
        if (table === "seasons") {
          // 07d Fase B / #240: createLoan slår activeSeason op for season_id-stamping.
          return {
            select() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        limit() {
                          return {
                            maybeSingle() {
                              return Promise.resolve({ data: { id: "season-active-mock" }, error: null });
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

test("createLoan rejects when principal+fee would exceed debt ceiling (off-by-fee regression)", async () => {
  // D3 ceiling 600K, existing debt 598479, requesting 1500 principal + 75 fee = 1575
  // Pre-fix bug: 598479 + 1500 = 599979 ≤ 600000 → passed, but actual debt becomes 600054 (54 over)
  const supabase = createCeilingSupabase({ existingDebt: 598479 });

  // #666: error.message er nu EN ("Debt cap of ... reached"); assert i stedet
  // på den stabile err.code som frontend-i18n-mappet er nøglet på.
  await assert.rejects(
    () => createLoan("team-1", "long", 1500, supabase.client),
    (err) => {
      assert.equal(err.code, "error.debtCapReached");
      assert.equal(err.params?.ceiling, 600000);
      return true;
    },
  );
  assert.equal(supabase.state.loans.length, 0, "no loan should be inserted when ceiling+fee would be breached");
});

test("createLoan accepts when principal+fee fits exactly within remaining headroom", async () => {
  // Headroom = 1575. Loan of 1500 (+75 fee) = 1575 exactly hits ceiling, must be allowed.
  const supabase = createCeilingSupabase({ existingDebt: 600000 - 1575 });

  const loan = await createLoan("team-1", "long", 1500, supabase.client);
  assert.equal(loan.amount_remaining, 1575);
  assert.equal(supabase.state.loans.length, 1);
});

// ── #1012: max-lånbart (gebyr-inkl.) — delt formel med createLoan ─────────────

test("computeLoanFee matcher createLoans afrunding", () => {
  assert.equal(computeLoanFee(1500, 0.05), 75);
  assert.equal(computeLoanFee(1449, 0.05), 72); // 72.45 → 72
  assert.equal(computeLoanFee(1450, 0.05), 73); // 72.5 → 73 (Math.round half-up)
  assert.equal(computeLoanFee(100, 0), 0);
});

test("computeMaxLoanPrincipal finder største principal hvor gæld+principal+gebyr <= loft", () => {
  // Tomt loft-headroom: 600000, 5% gebyr → 571429 + round(28571.45)=28571 = 600000 præcist.
  const max = computeMaxLoanPrincipal({ currentDebt: 0, debtCeiling: 600000, originationFeePct: 0.05 });
  assert.equal(max.principal, 571429);
  assert.equal(max.fee, 28571);
  assert.equal(max.totalDebt, 600000);
  assert.equal(max.headroom, 600000);
  // +1 ville overskride loftet: 571430 + round(28571.5)=28572 = 600002 > 600000.
  assert.ok(571430 + computeLoanFee(571430, 0.05) > 600000);
});

test("computeMaxLoanPrincipal håndterer eksisterende gæld + afrundings-kanter", () => {
  // Headroom 1521: 1449 + round(72.45)=72 = 1521 ≤ 1521; 1450 + 73 = 1523 > 1521.
  const max = computeMaxLoanPrincipal({ currentDebt: 598479, debtCeiling: 600000, originationFeePct: 0.05 });
  assert.equal(max.principal, 1449);
  assert.equal(max.fee, 72);
  assert.equal(max.totalDebt, 1521);
});

test("computeMaxLoanPrincipal returnerer 0 ved fyldt loft og null uden loft", () => {
  const full = computeMaxLoanPrincipal({ currentDebt: 600000, debtCeiling: 600000, originationFeePct: 0.05 });
  assert.equal(full.principal, 0);
  assert.equal(full.fee, 0);
  assert.equal(full.totalDebt, 0);
  assert.equal(full.headroom, 0);

  const over = computeMaxLoanPrincipal({ currentDebt: 700000, debtCeiling: 600000, originationFeePct: 0.05 });
  assert.equal(over.principal, 0);
  assert.equal(over.headroom, 0);

  assert.equal(computeMaxLoanPrincipal({ currentDebt: 0, debtCeiling: null, originationFeePct: 0.05 }), null);
});

test("createLoan accepterer præcist computeMaxLoanPrincipal og afviser +1 (ingen formel-drift)", async () => {
  const existingDebt = 598479;
  const max = computeMaxLoanPrincipal({ currentDebt: existingDebt, debtCeiling: 600000, originationFeePct: 0.05 });

  // Max accepteres.
  const okSupabase = createCeilingSupabase({ existingDebt });
  const loan = await createLoan("team-1", "long", max.principal, okSupabase.client);
  assert.equal(loan.amount_remaining, max.totalDebt);

  // Max + 1 afvises af serverens loft-tjek.
  const rejectSupabase = createCeilingSupabase({ existingDebt });
  await assert.rejects(
    () => createLoan("team-1", "long", max.principal + 1, rejectSupabase.client),
    (err) => {
      assert.equal(err.code, "error.debtCapReached");
      return true;
    },
  );
  assert.equal(rejectSupabase.state.loans.length, 0);
});

test("createEmergencyLoan kaster hvis loan_config mangler emergency-row (DB-seed-fejl)", async () => {
  // Slice 07a: fail-fast i stedet for `?? 0.15` stale-fallback.
  const supabase = createEmergencyLoanSupabase({
    config: { loan_type: "long", origination_fee_pct: 0.05, interest_rate_pct: 0.12 },
  });

  await assert.rejects(
    () => createEmergencyLoan("team-1", 100, supabase.client, "season-6"),
    /loan_config mangler emergency-row/,
  );
  assert.equal(supabase.state.loans.length, 0);
  assert.equal(supabase.state.financeRows.length, 0);
});
