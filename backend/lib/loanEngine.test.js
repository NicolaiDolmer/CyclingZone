import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-service-key";

const {
  computeLoanFee,
  computeMaxLoanPrincipal,
  createEmergencyLoan,
  createLoan,
  repayLoan,
  repayLoansFromForcedSale,
} = await import("./loanEngine.js");

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
      // B2: create_emergency_loan_atomic returnerer PGRST202 → tvinger JS-fallback.
      rpc(name, params) {
        if (name === "create_emergency_loan_atomic") {
          return Promise.resolve({ data: null, error: { code: "PGRST202", message: "function not exposed in mock" } });
        }
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
            // #2301 · app-guard: `.select("*").eq(team_id).eq(loan_type).eq(season_id).maybeSingle()`.
            // Default mock = ingen eksisterende lån (caller kan override via state.existingEmergencyLoan).
            select(columns) {
              if (columns === "*") {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          eq() {
                            return {
                              maybeSingle() {
                                return Promise.resolve({ data: state.existingEmergencyLoan || null, error: null });
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              }
              throw new Error(`Unexpected loans.select columns: ${columns}`);
            },
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
      // #2301: idempotency_key stamped når seasonId er kendt.
      idempotency_key: "emergency_loan:team-1:season-6",
      metadata: {
        code: "tx.emergencyLoan",
        params: { feeRate: 15, interestRate: 15 },
      },
    },
  ]);
});

// #2301 · App-guard: andet kald samme (team, season) er no-op — ingen ny loans-row,
// ingen ny balance-kreditering.
test("createEmergencyLoan er idempotent — andet kald samme sæson returnerer eksisterende lån uden ny kreditering", async () => {
  const supabase = createEmergencyLoanSupabase();
  supabase.state.existingEmergencyLoan = {
    id: "loan-existing",
    team_id: "team-1",
    loan_type: "emergency",
    season_id: "season-6",
    principal: 100,
    amount_remaining: 115,
    status: "active",
  };

  const loan = await createEmergencyLoan("team-1", 100, supabase.client, "season-6");

  assert.equal(loan.id, "loan-existing");
  assert.equal(supabase.state.balance, 10, "balance uændret — ingen ny kreditering");
  assert.equal(supabase.state.loans.length, 0, "ingen ny loans-row indsat");
  assert.equal(supabase.state.financeRows.length, 0, "ingen ny finance_transactions-row");
  assert.equal(supabase.state.notifications.length, 0, "ingen ny notifikation ved no-op");
});

function createCeilingSupabase({
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

// ── B2: HARD nødlåns-clamp — gæld + principal + gebyr <= divisionsloft ────────

/**
 * Hjælper: multiple loan_config-rækker (short + long + emergency) så
 * createEmergencyLoan kan hente effectiveCeiling fra short/long-rækken.
 * create_emergency_loan_atomic returnerer PGRST202 → tvinger JS-fallback.
 * Eksisterende gæld simuleres via én aktiv loan-row.
 */
function createCeilingEmergencySupabase({
  _teamId = "t1",
  division = 3,
  existingDebt = 0,
  configs = [
    { loan_type: "short",     origination_fee_pct: 0.10, interest_rate_pct: 0.12, seasons: 2, debt_ceiling: 600_000 },
    { loan_type: "long",      origination_fee_pct: 0.05, interest_rate_pct: 0.10, seasons: 5, debt_ceiling: 600_000 },
    { loan_type: "emergency", origination_fee_pct: 0.15, interest_rate_pct: 0.15, seasons: 1, debt_ceiling: 600_000 },
  ],
} = {}) {
  const state = { balance: 0, loans: [], financeRows: [], notifications: [] };

  return {
    state,
    client: {
      rpc(name, params) {
        // Alle atomiske RPC'er returnerer PGRST202 → app-kode falder til JS-fallback.
        if (name === "create_emergency_loan_atomic" || name === "create_loan_atomic") {
          return Promise.resolve({ data: null, error: { code: "PGRST202", message: "function not exposed in mock" } });
        }
        if (name === "increment_balance_with_audit") {
          state.balance += params.p_delta;
          state.financeRows.push({ team_id: params.p_team_id, ...params.p_finance_payload });
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
            select() {
              return { eq() { return Promise.resolve({ data: configs, error: null }); } };
            },
          };
        }
        if (table === "loans") {
          return {
            // #2301 · to forskellige query-shapes rammer "loans": app-guardens
            // `.select("*").eq×3.maybeSingle()` og getTotalDebt's `.select("amount_remaining").eq×2`.
            select(columns) {
              if (columns === "*") {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          eq() {
                            return {
                              maybeSingle() {
                                return Promise.resolve({ data: state.existingEmergencyLoan || null, error: null });
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              }
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
              return {
                select() {
                  return {
                    single() {
                      return Promise.resolve({ data: { id: "loan-new", ...row }, error: null });
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "notifications") {
          const q = {
            eq() { return q; }, gte() { return q; }, order() { return q; },
            is() { return q; }, limit() { return Promise.resolve({ data: [], error: null }); },
          };
          return {
            select() { return q; },
            insert(row) { state.notifications.push(row); return Promise.resolve({ data: row, error: null }); },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

test("createEmergencyLoan HARD clamp: udsteder højst det der passer under divisionsloftet (B2)", async () => {
  // D3 ceiling 600K via short/long-config-rækker. Eksisterende gæld 550K.
  // Anmodning: 200K → ville give 550K + 200K*1.15 = 550K + 230K = 780K >> 600K.
  // Forventet: udstedt principal < 200K OG total aktiv gæld <= 600K.
  //
  // Headroom = 600K - 550K = 50K. Med 15% gebyr: max principal P hvor P + round(P*0.15) <= 50K.
  // computeMaxLoanPrincipal({currentDebt:550000, debtCeiling:600000, originationFeePct:0.15})
  // → P = 43478, fee = round(43478*0.15)=6522, total=50000 ≤ 50000. P+1=43479+6522=50001>50000.
  const supabase = createCeilingEmergencySupabase({ existingDebt: 550_000 });

  const loan = await createEmergencyLoan("t1", 200_000, supabase.client, "s5");

  // Lån udstedt (ikke null) — der er stadig headroom
  assert.ok(loan !== null, "loan skal returneres når der er headroom");

  // Principal skal være clamped til < 200K
  const issuedPrincipal = supabase.state.loans[0]?.principal ?? 0;
  assert.ok(issuedPrincipal < 200_000, `issuedPrincipal=${issuedPrincipal} skal være < 200000`);
  assert.ok(issuedPrincipal > 0, "issuedPrincipal skal være > 0 (der er headroom)");

  // Total aktiv gæld (eksisterende + issued amount_remaining) <= 600K
  const issuedAmountRemaining = supabase.state.loans[0]?.amount_remaining ?? 0;
  assert.ok(
    550_000 + issuedAmountRemaining <= 600_000,
    `total gæld ${550_000 + issuedAmountRemaining} overstiger loft 600K`
  );

  // incrementBalanceWithAudit krediterer den FAKTISK udstedte principal (ikke 200K)
  const creditedDelta = supabase.state.financeRows[0]?.amount ?? 0;
  assert.equal(creditedDelta, issuedPrincipal, "krediteret delta skal matche issued principal");
});

test("createEmergencyLoan HARD clamp: returnerer null når gæld allerede er fyldt op (B2)", async () => {
  // Eksisterende gæld = 600K = loftet. Ingen headroom → null returneres.
  const supabase = createCeilingEmergencySupabase({ existingDebt: 600_000 });

  const loan = await createEmergencyLoan("t1", 50_000, supabase.client, "s5");

  assert.equal(loan, null, "null når ingen headroom");
  assert.equal(supabase.state.loans.length, 0, "ingen loan-insert ved 0 headroom");
  assert.equal(supabase.state.financeRows.length, 0, "ingen financeRow ved 0 headroom");
});

// ── #2302: repayLoan — atomic repay_loan_atomic RPC ───────────────────────────
//
// Mock simulerer repay_loan_atomic-RPC'en (database/2026-07-10-repay-loan-
// atomic.sql): lås+valider+debitér balance+skriv ledger+opdatér loan sker som
// ÉT rpc()-kald i mocken, ligesom i den ægte DB-transaktion. Testene beviser
// at repayLoan (a) opdaterer balance+remaining+ledger konsistent ved succes,
// (b) afviser ved utilstrækkelig balance/for stort beløb, (c) sætter
// paid_off-status ved fuld indfrielse, og (d) bevarer den eksisterende
// fejl-kontrakt (message/errorCode) som API'et allerede afhænger af.
function createRepayLoanSupabase({
  teamId = "team-1",
  balance = 1000,
  loan = {
    id: "loan-1",
    team_id: "team-1",
    status: "active",
    amount_remaining: 500,
  },
  leadingAuctions = [],
  proxyBids = [],
  rpcErrorFor = null, // { message } — simuler at RPC'en selv afviser
  legacyRpcWithoutSplit = false, // #2326: simuler pre-migration RPC uden split-nøgler
} = {}) {
  const state = {
    balance,
    loan: { ...loan },
    financeRows: [],
    notifications: [],
    rpcCalls: [],
  };

  return {
    state,
    client: {
      rpc(name, params) {
        assert.equal(name, "repay_loan_atomic");
        state.rpcCalls.push(params);

        if (rpcErrorFor) {
          return Promise.resolve({ data: null, error: rpcErrorFor });
        }

        // Mirror repay_loan_atomic's server-side validation + mutation.
        if (!state.loan || state.loan.id !== params.p_loan_id || state.loan.team_id !== params.p_team_id) {
          return Promise.resolve({ data: null, error: { message: "Lån ikke fundet" } });
        }
        if (state.loan.status === "paid_off") {
          return Promise.resolve({ data: null, error: { message: "Lånet er allerede betalt" } });
        }

        const actualAmount = Math.min(params.p_amount, state.loan.amount_remaining);
        if (state.balance < actualAmount) {
          return Promise.resolve({ data: null, error: { message: "Ikke nok midler" } });
        }

        state.balance -= actualAmount;
        const newRemaining = state.loan.amount_remaining - actualAmount;
        const isPaidOff = newRemaining <= 0;
        state.loan.amount_remaining = isPaidOff ? 0 : newRemaining;
        state.loan.status = isPaidOff ? "paid_off" : "active";

        // #2326: interest-first split — spejler repay_loan_atomic (database/
        // 2026-07-11-repay-loan-interest-split-2326.sql).
        const interestPaid = Math.min(actualAmount, Math.max(state.loan.accrued_interest || 0, 0));
        const principalPaid = actualAmount - interestPaid;
        state.loan.accrued_interest = Math.max((state.loan.accrued_interest || 0) - interestPaid, 0);

        state.financeRows.push({
          team_id: params.p_team_id,
          type: "loan_repayment",
          amount: -actualAmount,
          related_loan_id: params.p_loan_id,
          split_metadata: legacyRpcWithoutSplit
            ? undefined
            : { interest_paid: interestPaid, principal_paid: principalPaid },
          ...params.p_finance_payload,
        });

        const data = {
          paid: actualAmount,
          remaining: isPaidOff ? 0 : newRemaining,
          paid_off: isPaidOff,
          balance: state.balance,
        };
        if (!legacyRpcWithoutSplit) {
          data.interest_paid = interestPaid;
          data.principal_paid = principalPaid;
        }
        return Promise.resolve({ data, error: null });
      },
      from(table) {
        if (table === "loans") {
          return {
            select(columns) {
              assert.equal(columns, "*");
              return {
                eq(column, value) {
                  assert.equal(column, "id");
                  return {
                    single() {
                      if (!state.loan || state.loan.id !== value) {
                        return Promise.resolve({ data: null, error: null });
                      }
                      return Promise.resolve({ data: { ...state.loan }, error: null });
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
              assert.equal(["balance", "user_id"].includes(columns), true);
              return {
                eq(column, value) {
                  assert.equal(column, "id");
                  assert.equal(value, teamId);
                  return {
                    single() {
                      if (columns === "user_id") {
                        return Promise.resolve({ data: { user_id: "user-1" }, error: null });
                      }
                      return Promise.resolve({ data: { balance: state.balance }, error: null });
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "auctions") {
          return {
            select() {
              return {
                in() {
                  return {
                    eq() {
                      return Promise.resolve({ data: leadingAuctions, error: null });
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "auction_proxy_bids") {
          return {
            select() {
              return {
                eq() {
                  return Promise.resolve({ data: proxyBids, error: null });
                },
              };
            },
          };
        }
        if (table === "seasons") {
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
        if (table === "notifications") {
          const q = {
            eq() { return q; }, gte() { return q; }, order() { return q; },
            is() { return q; }, limit() { return Promise.resolve({ data: [], error: null }); },
          };
          return {
            select() { return q; },
            insert(row) { state.notifications.push(row); return Promise.resolve({ data: row, error: null }); },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

test("repayLoan: succesfuld delvis repay opdaterer balance+remaining+ledger konsistent", async () => {
  const supabase = createRepayLoanSupabase({ balance: 1000, loan: { id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 500 } });

  const result = await repayLoan("loan-1", "team-1", 200, supabase.client);

  assert.deepEqual(result, { paid: 200, remaining: 300, paid_off: false, interest_paid: 0, principal_paid: 200 });
  assert.equal(supabase.state.balance, 800, "balance skal debiteres med det faktisk betalte beløb");
  assert.equal(supabase.state.loan.amount_remaining, 300);
  assert.equal(supabase.state.loan.status, "active");
  assert.equal(supabase.state.financeRows.length, 1, "ledger-post skal skrives atomisk med balance+loan-mutationen");
  assert.equal(supabase.state.financeRows[0].amount, -200);
  assert.equal(supabase.state.financeRows[0].type, "loan_repayment");
  assert.equal(supabase.state.financeRows[0].related_loan_id, "loan-1");
  assert.equal(supabase.state.notifications.length, 0, "ingen paid-off notifikation ved delvis repay");

  // Beviser at hele mutationen sker via ÉT repay_loan_atomic RPC-kald (atomicitet).
  assert.equal(supabase.state.rpcCalls.length, 1);
  assert.equal(supabase.state.rpcCalls[0].p_amount, 200);
});

test("repayLoan: fuld indfrielse sætter paid_off-status + trigger notifikation", async () => {
  const supabase = createRepayLoanSupabase({ balance: 1000, loan: { id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 500 } });

  const result = await repayLoan("loan-1", "team-1", 500, supabase.client);

  assert.deepEqual(result, { paid: 500, remaining: 0, paid_off: true, interest_paid: 0, principal_paid: 500 });
  assert.equal(supabase.state.balance, 500);
  assert.equal(supabase.state.loan.status, "paid_off");
  assert.equal(supabase.state.loan.amount_remaining, 0);
  assert.equal(supabase.state.notifications.length, 1, "paid-off notifikation skal sendes");
  assert.equal(supabase.state.financeRows[0].metadata?.code, undefined, "JS bygger ikke metadata længere — det gør RPC'en");
});

test("repayLoan: overbetaling klampes til amount_remaining (repay > gæld)", async () => {
  const supabase = createRepayLoanSupabase({ balance: 1000, loan: { id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 300 } });

  const result = await repayLoan("loan-1", "team-1", 500, supabase.client);

  assert.deepEqual(result, { paid: 300, remaining: 0, paid_off: true, interest_paid: 0, principal_paid: 300 });
  assert.equal(supabase.state.balance, 700, "kun de faktiske 300 debiteres, ikke de anmodede 500");
});

// ── #2326: interest-first rente/hovedstol-split ───────────────────────────────

test("repayLoan: interest-first split — betaling dækker accrued_interest før hovedstol", async () => {
  const supabase = createRepayLoanSupabase({
    balance: 1000,
    loan: { id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 500, accrued_interest: 150 },
  });

  const result = await repayLoan("loan-1", "team-1", 200, supabase.client);

  assert.equal(result.interest_paid, 150, "hele den påløbne rente dækkes først");
  assert.equal(result.principal_paid, 50, "resten af betalingen går til hovedstol");
  assert.equal(supabase.state.loan.accrued_interest, 0, "accrued_interest reduceres med interest_paid");
});

test("repayLoan: betaling mindre end accrued_interest — alt går til rente, resten står tilbage", async () => {
  const supabase = createRepayLoanSupabase({
    balance: 1000,
    loan: { id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 500, accrued_interest: 300 },
  });

  const result = await repayLoan("loan-1", "team-1", 100, supabase.client);

  assert.equal(result.interest_paid, 100);
  assert.equal(result.principal_paid, 0);
  assert.equal(supabase.state.loan.accrued_interest, 200, "resterende rente står tilbage på lånet");
});

test("repayLoan: backwards compat — pre-#2326 RPC uden split-nøgler giver undefined split (ingen crash)", async () => {
  const supabase = createRepayLoanSupabase({
    balance: 1000,
    loan: { id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 500 },
    legacyRpcWithoutSplit: true,
  });

  const result = await repayLoan("loan-1", "team-1", 200, supabase.client);

  assert.equal(result.paid, 200);
  assert.equal(result.interest_paid, undefined);
  assert.equal(result.principal_paid, undefined);
});

test("repayLoan: afviser ved utilstrækkelig balance (Ikke nok midler)", async () => {
  const supabase = createRepayLoanSupabase({ balance: 100, loan: { id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 500 } });

  await assert.rejects(
    () => repayLoan("loan-1", "team-1", 200, supabase.client),
    /Ikke nok midler/,
  );
  assert.equal(supabase.state.balance, 100, "balance uændret ved afvist repay");
  assert.equal(supabase.state.financeRows.length, 0, "ingen ledger-post ved afvist repay");
});

test("repayLoan: afviser når beløb overstiger tilgængeligt pga. bud-commitment (#44)", async () => {
  // balance 1000, leading auction med current_price 800 → kun 200 tilgængelig.
  const supabase = createRepayLoanSupabase({
    balance: 1000,
    loan: { id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 500 },
    leadingAuctions: [{ id: "auction-1", current_price: 800 }],
  });

  await assert.rejects(
    () => repayLoan("loan-1", "team-1", 300, supabase.client),
    (err) => {
      assert.equal(err.code, "error.repayInsufficient");
      assert.equal(err.params?.available, 200);
      return true;
    },
  );
  assert.equal(supabase.state.rpcCalls.length, 0, "RPC må ikke kaldes når commitment-checket afviser først");
});

test("repayLoan: kaster 'Lån ikke fundet' hvis loan tilhører andet team", async () => {
  const supabase = createRepayLoanSupabase({
    balance: 1000,
    loan: { id: "loan-1", team_id: "other-team", status: "active", amount_remaining: 500 },
  });

  await assert.rejects(
    () => repayLoan("loan-1", "team-1", 100, supabase.client),
    /Lån ikke fundet/,
  );
});

test("repayLoan: kaster 'Lånet er allerede betalt' for et paid_off lån", async () => {
  const supabase = createRepayLoanSupabase({
    balance: 1000,
    loan: { id: "loan-1", team_id: "team-1", status: "paid_off", amount_remaining: 0 },
  });

  await assert.rejects(
    () => repayLoan("loan-1", "team-1", 100, supabase.client),
    /allerede betalt/,
  );
});

test("repayLoan: RPC'ens 'Ikke nok midler'-afvisning propagerer som samme fejl-kontrakt", async () => {
  // Simulerer at et concurrent repay tømmer balancen MELLEM JS-pre-checket og
  // RPC-kaldet — den autoritative RPC-lås fanger det, JS skal bare forwarde
  // den samme fejlbesked som det gamle pre-RPC-check gav.
  const supabase = createRepayLoanSupabase({
    balance: 1000,
    loan: { id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 500 },
    rpcErrorFor: { message: "Ikke nok midler" },
  });

  await assert.rejects(
    () => repayLoan("loan-1", "team-1", 200, supabase.client),
    /Ikke nok midler/,
  );
});

// ── repayLoansFromForcedSale (#2303) ──────────────────────────────────────────

function createForcedSaleSupabase({ teamId = "team-1", loans = [] } = {}) {
  const state = {
    loans: loans.map((l) => ({ ...l })),
    rpcCalls: [],
  };

  return {
    state,
    client: {
      rpc(name, params) {
        assert.equal(name, "repay_loan_atomic");
        state.rpcCalls.push(params);

        const loan = state.loans.find((l) => l.id === params.p_loan_id && l.team_id === params.p_team_id);
        if (!loan) return Promise.resolve({ data: null, error: { message: "Lån ikke fundet" } });

        const actualAmount = Math.min(params.p_amount, loan.amount_remaining);
        const newRemaining = loan.amount_remaining - actualAmount;
        const isPaidOff = newRemaining <= 0;
        loan.amount_remaining = isPaidOff ? 0 : newRemaining;
        loan.status = isPaidOff ? "paid_off" : "active";

        return Promise.resolve({
          data: { paid: actualAmount, remaining: isPaidOff ? 0 : newRemaining, paid_off: isPaidOff },
          error: null,
        });
      },
      from(table) {
        assert.equal(table, "loans");
        return {
          select(_cols) {
            return {
              eq(col1, val1) {
                assert.equal(col1, "team_id");
                assert.equal(val1, teamId);
                return {
                  eq(col2, val2) {
                    assert.equal(col2, "status");
                    assert.equal(val2, "active");
                    return {
                      order(col3, opts) {
                        assert.equal(col3, "created_at");
                        assert.deepEqual(opts, { ascending: true });
                        return Promise.resolve({
                          data: state.loans.filter((l) => l.status === "active"),
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

test("repayLoansFromForcedSale: afdrager ældste lån først indtil provenuet er brugt", async () => {
  const supabase = createForcedSaleSupabase({
    loans: [
      { id: "loan-old", team_id: "team-1", status: "active", amount_remaining: 300_000 },
      { id: "loan-new", team_id: "team-1", status: "active", amount_remaining: 400_000 },
    ],
  });

  const result = await repayLoansFromForcedSale("team-1", 500_000, supabase.client, "season-1");

  // Ældste lån (loan-old) betales helt af først (300k), resten (200k) går til loan-new.
  assert.equal(supabase.state.loans[0].amount_remaining, 0, "ældste lån skal være fuldt afdraget");
  assert.equal(supabase.state.loans[0].status, "paid_off");
  assert.equal(supabase.state.loans[1].amount_remaining, 200_000, "yngre lån skal afdrages med det resterende provenu");
  assert.equal(result.totalRepaid, 500_000);
  assert.equal(result.loans.length, 2, "begge lån skal have fået et repay-kald");
});

test("repayLoansFromForcedSale: provenu større end samlet gæld — afdrager alt, resten forbliver i kassen", async () => {
  const supabase = createForcedSaleSupabase({
    loans: [{ id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 300_000 }],
  });

  const result = await repayLoansFromForcedSale("team-1", 900_000, supabase.client, "season-1");

  assert.equal(supabase.state.loans[0].amount_remaining, 0);
  assert.equal(supabase.state.loans[0].status, "paid_off");
  // Kun de faktiske 300k blev brugt til at afdrage gæld — resten (600k) er
  // allerede krediteret holdets balance af forced-sale-kaldet i economyEngine
  // (creditTeam sker FØR repayLoansFromForcedSale), så det forbliver i kassen.
  assert.equal(result.totalRepaid, 300_000, "kan ikke afdrage mere end den faktiske gæld");
});

test("repayLoansFromForcedSale: ingen aktive lån → no-op uden RPC-kald", async () => {
  const supabase = createForcedSaleSupabase({ loans: [] });

  const result = await repayLoansFromForcedSale("team-1", 500_000, supabase.client, "season-1");

  assert.deepEqual(result, { totalRepaid: 0, loans: [] });
  assert.equal(supabase.state.rpcCalls.length, 0);
});

test("repayLoansFromForcedSale: 0 eller negativt provenu → no-op uden DB-kald", async () => {
  const supabase = createForcedSaleSupabase({
    loans: [{ id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 300_000 }],
  });

  const result = await repayLoansFromForcedSale("team-1", 0, supabase.client, "season-1");

  assert.deepEqual(result, { totalRepaid: 0, loans: [] });
  assert.equal(supabase.state.rpcCalls.length, 0, "loans-tabellen skal ikke engang forespørges");
});

test("repayLoansFromForcedSale: stempler metadata_code_final/remaining + FORCED_DEBT_REPAYMENT reason_code (spiller-historik #2303)", async () => {
  const supabase = createForcedSaleSupabase({
    loans: [{ id: "loan-1", team_id: "team-1", status: "active", amount_remaining: 300_000 }],
  });

  await repayLoansFromForcedSale("team-1", 100_000, supabase.client, "season-1");

  assert.equal(supabase.state.rpcCalls.length, 1);
  const payload = supabase.state.rpcCalls[0].p_finance_payload;
  assert.equal(payload.metadata_code_final, "tx.forcedDebtRepaymentFinal");
  assert.equal(payload.metadata_code_remaining, "tx.forcedDebtRepaymentRemaining");
  assert.equal(payload.reason_code, "forced_debt_repayment");
  assert.equal(payload.source_path, "loanEngine.repayLoansFromForcedSale");
  assert.equal(payload.season_id, "season-1");
});
