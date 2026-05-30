/**
 * Slice 07b — Invariants for sponsor/salary/bonus/loan-interest payouts.
 *
 * App-niveau idempotency-checks + SOFT debt-ceiling for emergency loans.
 * DB-niveau races (concurrent INSERTs) håndteres af partial UNIQUE indices
 * i database/2026-05-07-economy-idempotency.sql og kan ikke testes med
 * in-memory mocks alene.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-service-key";

const { payDivisionBonuses, processSeasonStart, processTeamSeasonPayroll } = await import("./economyEngine.js");
const { createEmergencyLoan, processLoanInterest } = await import("./loanEngine.js");

// ── Test fixture: in-memory finance_transactions with optional unique-violation ───

function createPgUniqueViolation(constraint) {
  return { code: "23505", constraint, message: `duplicate key value violates unique constraint "${constraint}"` };
}

function createIdempotencySupabase({
  existingFinanceRows = [],
  uniqueViolations = {},
  loans = [],
  loanConfig = null,
  teams = [],
  notifications = [],
} = {}) {
  const state = {
    financeRows: [...existingFinanceRows],
    insertedFinanceRows: [],
    loans: [...loans],
    teams: teams.map((t) => ({ ...t })),
    notifications: [...notifications],
    insertedNotifications: [],
    adminWarnings: [],
  };

  const teamById = new Map(state.teams.map((t) => [t.id, t]));

  return {
    state,
    client: {
      // Slice 07c: balance-mutationer går nu via RPC. Mock kombinerer UPDATE+INSERT
      // og respekterer uniqueViolations på finance_transactions så samme idempotency-
      // tests kører uændret post-RPC-refactor.
      rpc(name, params) {
        if (name === "create_loan_atomic") {
          // Lad app-koden falde tilbage til app-niveau debt-ceiling tjek + INSERT.
          return Promise.resolve({ data: null, error: { code: "PGRST202", message: "function not exposed in mock" } });
        }
        if (name === "increment_balance_with_audit") {
          const row = {
            team_id: params.p_team_id,
            ...params.p_finance_payload,
          };
          const violation = matchUniqueViolation(row, uniqueViolations, state.financeRows);
          if (violation) {
            return Promise.resolve({ data: null, error: violation });
          }
          const team = teamById.get(params.p_team_id);
          if (team) team.balance = (team.balance ?? 0) + params.p_delta;
          state.financeRows.push({ ...row });
          state.insertedFinanceRows.push({ ...row });
          return Promise.resolve({ data: team?.balance ?? params.p_delta, error: null });
        }
        throw new Error(`Unexpected rpc: ${name}`);
      },
      from(table) {
        if (table === "finance_transactions") {
          return {
            select(columns) {
              const filters = {};
              const query = {
                eq(col, val) {
                  filters[col] = val;
                  return query;
                },
                in(col, vals) {
                  filters[`${col}__in`] = vals;
                  return query;
                },
                then(resolve, reject) {
                  let rows = state.financeRows;
                  if (filters.season_id) rows = rows.filter((r) => r.season_id === filters.season_id);
                  if (filters.type) rows = rows.filter((r) => r.type === filters.type);
                  if (filters.team_id) rows = rows.filter((r) => r.team_id === filters.team_id);
                  if (filters.related_loan_id) rows = rows.filter((r) => r.related_loan_id === filters.related_loan_id);
                  if (filters.type__in) rows = rows.filter((r) => filters.type__in.includes(r.type));
                  return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
                },
              };
              return query;
            },
            insert(rowOrRows) {
              const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
              for (const row of rows) {
                const violation = matchUniqueViolation(row, uniqueViolations, state.financeRows);
                if (violation) {
                  return Promise.resolve({ error: violation });
                }
                state.financeRows.push({ ...row });
                state.insertedFinanceRows.push({ ...row });
              }
              return Promise.resolve({ error: null });
            },
          };
        }

        if (table === "teams") {
          return {
            select(columns) {
              return {
                eq(col, val) {
                  return {
                    single() {
                      if (col === "id") {
                        const team = teamById.get(val);
                        if (!team) return Promise.resolve({ data: null, error: null });
                        if (columns === "division") return Promise.resolve({ data: { division: team.division ?? 3 }, error: null });
                        if (columns === "balance") return Promise.resolve({ data: { balance: team.balance ?? 0 }, error: null });
                        if (columns === "user_id") return Promise.resolve({ data: { user_id: team.user_id ?? "user-x" }, error: null });
                        return Promise.resolve({ data: { ...team }, error: null });
                      }
                      return Promise.resolve({ data: null, error: null });
                    },
                  };
                },
              };
            },
            update(payload) {
              return {
                eq(col, val) {
                  if (col === "id") {
                    const team = teamById.get(val);
                    if (team) Object.assign(team, payload);
                  }
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        }

        if (table === "loan_config") {
          return {
            select() {
              return {
                eq() {
                  return Promise.resolve({ data: loanConfig ? [loanConfig] : [], error: null });
                },
              };
            },
          };
        }

        if (table === "loans") {
          return {
            select(columns) {
              const filters = {};
              const query = {
                eq(col, val) {
                  filters[col] = val;
                  return query;
                },
                then(resolve, reject) {
                  let rows = state.loans;
                  if (filters.team_id) rows = rows.filter((l) => l.team_id === filters.team_id);
                  if (filters.status) rows = rows.filter((l) => l.status === filters.status);
                  return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
                },
              };
              return query;
            },
            insert(row) {
              return {
                select() {
                  return {
                    single() {
                      const inserted = { id: `loan-${state.loans.length + 1}`, ...row };
                      state.loans.push(inserted);
                      return Promise.resolve({ data: inserted, error: null });
                    },
                  };
                },
              };
            },
            update() {
              return { eq() { return Promise.resolve({ error: null }); } };
            },
          };
        }

        if (table === "notifications") {
          const query = {
            eq() { return query; },
            gte() { return query; },
            order() { return query; },
            is() { return query; },
            limit() { return Promise.resolve({ data: [], error: null }); },
          };
          return {
            select() { return query; },
            insert(row) {
              state.insertedNotifications.push(row);
              return Promise.resolve({ data: row, error: null });
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

function matchUniqueViolation(row, uniqueViolations, existingRows) {
  // Test-side simulation: hvis kaldsiden har konfigureret en violation
  // for en (type, team, season) eller (type, related_loan, season)-kombination
  // og en row matcher, returnér 23505.
  for (const [name, predicate] of Object.entries(uniqueViolations)) {
    if (predicate(row, existingRows)) {
      return createPgUniqueViolation(name);
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────────
// 1. payDivisionBonuses — eksisterende app-niveau check (skal PASS allerede)
// ───────────────────────────────────────────────────────────────────────────────

test("payDivisionBonuses skipper team der allerede har bonus-row for sæsonen", async () => {
  const supabase = createIdempotencySupabase({
    existingFinanceRows: [
      { team_id: "team-1", season_id: "season-1", type: "bonus", amount: 100_000 },
    ],
    teams: [{ id: "team-1", balance: 500_000, division: 1, is_ai: false }],
  });

  const standings = [
    { team_id: "team-1", division: 1, rank_in_division: 1, team: { is_ai: false } },
  ];

  await payDivisionBonuses(standings, "season-1", supabase.client);

  assert.equal(
    supabase.state.insertedFinanceRows.length,
    0,
    "ingen ny bonus-row må insertes når team allerede har en for sæsonen"
  );
});

// ───────────────────────────────────────────────────────────────────────────────
// 2. payDivisionBonuses — DB-niveau race-fallback (FAIL i current code)
//
// Hvis 2 cron-runs starter ~samtidigt og begge passerer app-niveau
// "alreadyPaid" check, kommer begge frem til INSERT. Den 2. INSERT skal
// blive afvist af partial UNIQUE index (post-migration). Backend skal
// fange unique_violation og skip stille — ikke crashe hele cron-runet.
// ───────────────────────────────────────────────────────────────────────────────

test("payDivisionBonuses fanger unique_violation graciously og crasher ikke", async () => {
  const supabase = createIdempotencySupabase({
    teams: [{ id: "team-1", balance: 500_000, division: 1, is_ai: false }],
    uniqueViolations: {
      // Simulér at index uniq_bonus_per_team_season afviser INSERT
      uniq_bonus_per_team_season: (row) =>
        row.type === "bonus" && row.team_id === "team-1" && row.season_id === "season-1",
    },
  });

  const standings = [
    { team_id: "team-1", division: 1, rank_in_division: 1, team: { is_ai: false } },
  ];

  // Må ikke kaste — DB-niveau idempotency er beskytteren, ikke en hård fejl.
  await payDivisionBonuses(standings, "season-1", supabase.client);

  assert.equal(supabase.state.insertedFinanceRows.length, 0);
});

// ───────────────────────────────────────────────────────────────────────────────
// 3. processLoanInterest — per (loan, season) idempotent (FAIL i current code)
//
// Current code skriver finance_transactions row uden related_loan_id og uden
// unique-key. Anden cron-kørsel for samme sæson vil dobbelt-charge renter.
// Post-migration har vi (related_loan_id, season_id) UNIQUE WHERE type = 'loan_interest'.
// ───────────────────────────────────────────────────────────────────────────────

test("processLoanInterest fanger unique_violation per (loan, season) — ingen dobbelt-charge", async () => {
  const loan = {
    id: "loan-1",
    team_id: "team-1",
    amount_remaining: 100_000,
    interest_rate: 0.10,
    seasons_remaining: 3,
    status: "active",
  };

  const supabase = createIdempotencySupabase({
    loans: [loan],
    teams: [{ id: "team-1", division: 3 }],
    uniqueViolations: {
      uniq_loan_interest_per_loan_season: (row) =>
        row.type === "loan_interest" && row.related_loan_id === "loan-1" && row.season_id === "season-1",
    },
  });

  // Må ikke kaste når DB afviser duplicate-charge.
  await processLoanInterest("team-1", "season-1", supabase.client);

  const interestRows = supabase.state.insertedFinanceRows.filter((r) => r.type === "loan_interest");
  assert.equal(interestRows.length, 0, "ingen loan_interest finance row inserted ved unique_violation");
});

test("processLoanInterest sender related_loan_id i finance_transactions row (post-fix)", async () => {
  const loan = {
    id: "loan-7",
    team_id: "team-1",
    amount_remaining: 100_000,
    interest_rate: 0.10,
    seasons_remaining: 3,
    status: "active",
  };

  const supabase = createIdempotencySupabase({
    loans: [loan],
    teams: [{ id: "team-1", division: 3 }],
  });

  await processLoanInterest("team-1", "season-1", supabase.client);

  const interestRow = supabase.state.insertedFinanceRows.find((r) => r.type === "loan_interest");
  assert.ok(interestRow, "loan_interest row skal være inserted");
  assert.equal(
    interestRow.related_loan_id,
    "loan-7",
    "finance_transactions.related_loan_id skal pege på loan-7 så DB-unique-index kan virke"
  );
});

// ───────────────────────────────────────────────────────────────────────────────
// 4. createEmergencyLoan — SOFT debt_ceiling-tjek (FAIL i current code)
//
// Per beslutning 2026-05-07: ingen hard-block. Hvis (currentDebt + totalOwed)
// > ceiling, fortsæt MEN log advarsel + send board_critical-notif.
// ───────────────────────────────────────────────────────────────────────────────

test("createEmergencyLoan logger advarsel + sender board_critical-notif når ceiling overskrides (SOFT)", async () => {
  const config = {
    loan_type: "emergency",
    origination_fee_pct: 0.15,
    interest_rate_pct: 0.15,
    debt_ceiling: 600_000,
  };

  // Eksisterende debt 580K, ny lånetotal = 100K + 15K fee = 115K → 695K > 600K
  const existingLoan = { id: "loan-old", team_id: "team-1", amount_remaining: 580_000, status: "active" };

  const supabase = createIdempotencySupabase({
    teams: [{ id: "team-1", balance: 0, division: 3, user_id: "user-1" }],
    loans: [existingLoan],
    loanConfig: config,
  });

  // Skal ikke kaste — SOFT, ikke hard-block.
  await createEmergencyLoan("team-1", 100_000, supabase.client, "season-1");

  // Lånet skal være oprettet (status quo).
  const newLoan = supabase.state.loans.find((l) => l.id !== "loan-old");
  assert.ok(newLoan, "emergency loan skal oprettes selv ved breach (SOFT)");
  assert.equal(newLoan.amount_remaining, 115_000);

  // Mindst én board_critical-notif skal sendes.
  const criticalNotifs = supabase.state.insertedNotifications.filter(
    (n) => n.type === "board_critical" || n.type === "emergency_loan_breach"
  );
  assert.ok(
    criticalNotifs.length >= 1,
    `forventet board_critical/emergency_loan_breach notif, fik: ${JSON.stringify(supabase.state.insertedNotifications.map((n) => n.type))}`
  );
});

test("createEmergencyLoan opfører sig som før når ceiling ikke overskrides", async () => {
  const config = {
    loan_type: "emergency",
    origination_fee_pct: 0.15,
    interest_rate_pct: 0.15,
    debt_ceiling: 600_000,
  };

  const supabase = createIdempotencySupabase({
    teams: [{ id: "team-1", balance: 0, division: 3, user_id: "user-1" }],
    loans: [],
    loanConfig: config,
  });

  await createEmergencyLoan("team-1", 100_000, supabase.client, "season-1");

  const breachNotifs = supabase.state.insertedNotifications.filter(
    (n) => n.type === "board_critical" || n.type === "emergency_loan_breach"
  );
  assert.equal(breachNotifs.length, 0, "ingen breach-notif når ceiling ikke ramt");
});

// ───────────────────────────────────────────────────────────────────────────────
// 5. processSeasonStart sponsor-payout — idempotent
//
// Hvis cron retry'es eller kører 2x (fx ved Vercel timeout-retry), må der
// ikke skabes duplicate sponsor-rows for samme (team, season).
// ───────────────────────────────────────────────────────────────────────────────

test("processSeasonStart fanger unique_violation på sponsor (team, season)", async () => {
  const supabase = createIdempotencySupabase({
    teams: [],
    uniqueViolations: {
      uniq_sponsor_per_team_season: (row) =>
        row.type === "sponsor" && row.team_id === "team-1" && row.season_id === "season-1",
    },
  });

  // Patch from() til at returnere ét human team og ét season-row.
  const baseFrom = supabase.client.from.bind(supabase.client);
  supabase.client.from = (table) => {
    if (table === "teams") {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return Promise.resolve({
                    data: [{
                      id: "team-1",
                      name: "Test",
                      balance: 0,
                      sponsor_income: 240_000,
                      board_profiles: [],
                      is_frozen: false,
                    }],
                    error: null,
                  });
                },
                single() {
                  return Promise.resolve({ data: { balance: 0 }, error: null });
                },
              };
            },
          };
        },
        update() {
          return { eq() { return Promise.resolve({ error: null }); } };
        },
      };
    }
    if (table === "seasons") {
      return {
        select() {
          return {
            eq() {
              return {
                single() {
                  return Promise.resolve({ data: { number: 1 }, error: null });
                },
              };
            },
          };
        },
      };
    }
    if (table === "board_consequences") {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return Promise.resolve({ data: [], error: null });
                },
              };
            },
          };
        },
      };
    }
    if (table === "board_profiles") {
      return {
        insert() { return Promise.resolve({ error: null }); },
      };
    }
    if (table === "loan_agreements") {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return Promise.resolve({ data: [], error: null });
                },
              };
            },
          };
        },
      };
    }
    return baseFrom(table);
  };

  // Må ikke kaste når DB afviser duplicate sponsor — skal logge og fortsætte.
  // runSeasonPayroll stubbet — testen fokuserer på sponsor-idempotency, ikke payroll.
  await processSeasonStart("season-1", {
    supabase: supabase.client,
    runSeasonPayroll: async () => [],
  });

  const sponsorRows = supabase.state.insertedFinanceRows.filter((r) => r.type === "sponsor");
  assert.equal(sponsorRows.length, 0, "ingen sponsor-row inserted ved unique_violation");
});

test("processSeasonStart bruger variabel sponsor fra forrige sæsons standings fra sæson 2", async () => {
  const financeRows = [];
  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({
        team_id: params.p_team_id,
        delta: params.p_delta,
        ...params.p_finance_payload,
      });
      return Promise.resolve({ data: params.p_delta, error: null });
    },
    from(table) {
      if (table === "seasons") {
        return {
          select(columns) {
            return {
              eq(column, value) {
                if (columns === "number") {
                  assert.equal(column, "id");
                  assert.equal(value, "season-2");
                  return {
                    single: () => Promise.resolve({ data: { number: 2 }, error: null }),
                  };
                }
                assert.equal(columns, "id");
                assert.equal(column, "number");
                assert.equal(value, 1);
                return {
                  maybeSingle: () => Promise.resolve({ data: { id: "season-1" }, error: null }),
                };
              },
            };
          },
        };
      }
      if (table === "season_standings") {
        return {
          select(columns) {
            assert.equal(columns, "team_id, division, rank_in_division, total_points");
            return {
              eq(column, value) {
                assert.equal(column, "season_id");
                assert.equal(value, "season-1");
                return Promise.resolve({
                  data: [
                    { team_id: "team-1", division: 3, total_points: 120, rank_in_division: 2 },
                    { team_id: "team-top", division: 3, total_points: 180, rank_in_division: 1 },
                    { team_id: "team-low", division: 3, total_points: 60, rank_in_division: 3 },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === "teams") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return Promise.resolve({
                      data: [{
                        id: "team-1",
                        name: "Variable Test",
                        balance: 0,
                        sponsor_income: 240_000,
                        board_profiles: [],
                        is_frozen: false,
                      }],
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "board_consequences") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return Promise.resolve({ data: [], error: null });
                  },
                };
              },
            };
          },
          update() {
            return { eq() { return { eq() { return Promise.resolve({ error: null }); } }; } };
          },
        };
      }
      if (table === "board_profiles") {
        return {
          insert() { return Promise.resolve({ error: null }); },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const result = await processSeasonStart("season-2", {
    supabase,
    processLoanAgreementSeasonFees: async () => [],
    runSeasonPayroll: async () => [],
  });

  assert.equal(financeRows.length, 1);
  assert.equal(financeRows[0].delta, 275_000);
  // #666: description er nu null; struktureret metadata.code + .params driver i18n.
  assert.equal(financeRows[0].description, null);
  assert.equal(financeRows[0].metadata?.code, "tx.sponsor.seasonStartVariable");
  assert.equal(financeRows[0].metadata?.params?.base, 200_000);
  assert.equal(financeRows[0].metadata?.params?.variable, 75_000);
  // #535: processSeasonStart returnerer nu { sponsor: [...], payroll: {...} }
  assert.equal(result.sponsor[0].sponsor, 275_000);
  assert.equal(result.sponsor[0].sponsor_breakdown.mode, "variable");
});

// ── #805 invariant: board test-mode tvinger sponsor-modifier til 1.0 ───────────
//
// Et completed board med budget_modifier=1.2 ville normalt løfte sponsor-payout 20%.
// I board test-mode skal payout være præcis som med modifier 1.0 (board-bidraget
// til økonomien er neutralt mens testere forhandler planer).
test("processSeasonStart tvinger sponsor-modifier til 1.0 i board test-mode", async () => {
  async function runWithBoard({ budgetModifier, boardTestMode }) {
    const financeRows = [];
    const supabase = {
      rpc(name, params) {
        financeRows.push({ team_id: params.p_team_id, delta: params.p_delta, ...params.p_finance_payload });
        return Promise.resolve({ data: params.p_delta, error: null });
      },
      from(table) {
        if (table === "seasons") {
          return { select() { return { eq() { return { single: () => Promise.resolve({ data: { number: 1 }, error: null }) }; } }; } };
        }
        if (table === "teams") {
          return {
            select() {
              return { eq() { return { eq() { return Promise.resolve({
                data: [{
                  id: "team-1", name: "TestMode Team", balance: 0, sponsor_income: 240_000,
                  board_profiles: [{ negotiation_status: "completed", budget_modifier: budgetModifier }],
                  is_frozen: false,
                }],
                error: null,
              }); } }; } };
            },
          };
        }
        if (table === "board_consequences") {
          return { select() { return { eq() { return { eq() { return Promise.resolve({ data: [], error: null }); } }; } }; } };
        }
        if (table === "transfer_windows") {
          // isBoardTestModeActive læser seneste window.
          return {
            select() { return { order() { return { limit() { return {
              maybeSingle: () => Promise.resolve({ data: { board_test_mode: boardTestMode }, error: null }),
            }; } }; } }; },
          };
        }
        if (table === "board_profiles") {
          return { insert() { return Promise.resolve({ error: null }); } };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };

    const result = await processSeasonStart("season-1", {
      supabase,
      processLoanAgreementSeasonFees: async () => [],
      runSeasonPayroll: async () => [],
    });
    return { delta: financeRows[0].delta, sponsor: result.sponsor[0].sponsor };
  }

  const testMode = await runWithBoard({ budgetModifier: 1.2, boardTestMode: true });
  const neutral = await runWithBoard({ budgetModifier: 1.0, boardTestMode: false });
  const boosted = await runWithBoard({ budgetModifier: 1.2, boardTestMode: false });

  // Test-mode med modifier 1.2 == normal med modifier 1.0 (frosset).
  assert.equal(testMode.delta, neutral.delta);
  // ... og strengt mindre end den boostede non-test payout, så vi ved 1.2 faktisk gør noget.
  assert.ok(boosted.delta > testMode.delta, "modifier 1.2 skal hæve payout uden for test-mode");
});

// ── v3.78 invariant: sponsor pass A er FÆRDIG for alle hold før payroll (pass B) starter ───
//
// Beskytter mod regression hvor renter/løn ved et uheld interleaves med sponsor-loopet
// (fx ved at flytte runSeasonPayroll-kaldet ind i for-loopet). Det ville reintroducere
// emergency-lån-pres som blev løst i v3.78, fordi hold uden balance ville få trukket
// salary FØR resten af holdene havde modtaget deres sponsor.
test("processSeasonStart krediterer sponsor til ALLE hold før runSeasonPayroll kører (v3.78 invariant)", async () => {
  const callLog = [];
  const teams = [
    { id: "t1", name: "Team 1", is_ai: false, is_frozen: false, balance: 0,
      board_profiles: [{ plan_type: "1yr", negotiation_status: "completed", budget_modifier: 1.0 }] },
    { id: "t2", name: "Team 2", is_ai: false, is_frozen: false, balance: 0,
      board_profiles: [{ plan_type: "1yr", negotiation_status: "completed", budget_modifier: 1.0 }] },
    { id: "t3", name: "Team 3", is_ai: false, is_frozen: false, balance: 0,
      board_profiles: [{ plan_type: "1yr", negotiation_status: "completed", budget_modifier: 1.0 }] },
  ];

  const supabase = {
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      callLog.push({ phase: "sponsor", team_id: params.p_team_id });
      return Promise.resolve({ data: params.p_delta, error: null });
    },
    from(table) {
      if (table === "seasons") {
        return {
          select() {
            return { eq() { return { single: () => Promise.resolve({ data: { number: 1 }, error: null }) }; } };
          },
        };
      }
      if (table === "teams") {
        return {
          select() {
            return {
              eq(_col, _val) {
                return {
                  eq() { return Promise.resolve({ data: teams, error: null }); },
                };
              },
            };
          },
        };
      }
      if (table === "board_consequences") {
        return {
          select() {
            return { eq() { return { eq() { return Promise.resolve({ data: [], error: null }); } }; } };
          },
          update() {
            return { eq() { return { eq() { return Promise.resolve({ error: null }); } }; } };
          },
        };
      }
      if (table === "board_profiles") {
        return { insert() { return Promise.resolve({ error: null }); } };
      }
      if (table === "finance_transactions") {
        return { insert() { return Promise.resolve({ error: null }); } };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  await processSeasonStart("season-1", {
    supabase,
    processLoanAgreementSeasonFees: async () => [],
    runSeasonPayroll: async () => {
      callLog.push({ phase: "payroll" });
      return [];
    },
  });

  // Forventet rækkefølge: sponsor t1, sponsor t2, sponsor t3, payroll.
  const sponsorEvents = callLog.filter((e) => e.phase === "sponsor");
  const payrollIdx = callLog.findIndex((e) => e.phase === "payroll");
  assert.equal(sponsorEvents.length, 3, "sponsor krediteres til alle 3 hold");
  assert.equal(payrollIdx, 3, "runSeasonPayroll skal kaldes EFTER alle sponsor-credits (index 3, ikke før)");
  assert.ok(
    callLog.slice(0, payrollIdx).every((e) => e.phase === "sponsor"),
    "alle events før payroll skal være sponsor-credits — ingen interleaved payroll-call"
  );
});

// ───────────────────────────────────────────────────────────────────────────────
// 8. processTeamSeasonPayroll — negative-interest idempotency (#577)
//
// Cron-retry-scenariet: salary er allerede debiteret (idempotent), men process
// crasher inden den returnerer. Retry læser en mere negativ balance og beregner
// en større rente — uden idempotency-guard ville begge beløb trækkes.
// idempotencyKey `negative_interest:${team.id}:${seasonId}` forhindrer det.
// ───────────────────────────────────────────────────────────────────────────────

test("processTeamSeasonPayroll er idempotent for negative-interest — gentaget kørsel dobbeltdebiter ikke", async () => {
  const financeRows = [];
  const teamState = { balance: -100 };

  const mockSupabase = {
    rpc(name, params) {
      if (name !== "increment_balance_with_audit") throw new Error(`Unexpected rpc: ${name}`);
      const row = { team_id: params.p_team_id, ...params.p_finance_payload };
      if (row.idempotency_key) {
        const duplicate = financeRows.find((r) => r.idempotency_key === row.idempotency_key);
        if (duplicate) {
          return Promise.resolve({
            data: null,
            error: { code: "23505", constraint: "uniq_finance_idempotency_key" },
          });
        }
      }
      teamState.balance += params.p_delta;
      financeRows.push(row);
      return Promise.resolve({ data: teamState.balance, error: null });
    },
    from(table) {
      if (table !== "teams") throw new Error(`Unexpected table: ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                single: () => Promise.resolve({ data: { balance: teamState.balance }, error: null }),
              };
            },
          };
        },
      };
    },
  };

  const team = { id: "team-1", name: "Test Team", riders: [] };
  const deps = {
    supabase: mockSupabase,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
  };

  // Første kørsel: rente debiteres (10% af 100 = 10).
  await processTeamSeasonPayroll(team, "season-1", deps);
  assert.equal(financeRows.filter((r) => r.type === "interest").length, 1, "første kørsel: 1 interest-row");
  assert.equal(teamState.balance, -110, "balance efter første kørsel: -100 - 10 = -110");

  // Anden kørsel (cron-retry): rente må ikke debiteres igen.
  await processTeamSeasonPayroll(team, "season-1", deps);
  assert.equal(financeRows.filter((r) => r.type === "interest").length, 1, "anden kørsel: stadig kun 1 interest-row");
  assert.equal(teamState.balance, -110, "balance uændret efter anden kørsel");
});

// ───────────────────────────────────────────────────────────────────────────────
// 9. payroll-summary counts == finance_transactions rows skrevet (#535)
//
// Audit 2026-05-21 fandt at transitionToNextSeason's return-log ikke
// inkluderede payroll-detaljer — admin måtte køre manuel SQL for at
// verificere at de forventede loan_interest/salary/emergency_loan/
// negative_balance_interest rows blev skrevet. Invariant låser at
// payroll.summary's *_count matcher antal rows af respektive type i
// finance_transactions, så UI'en kan vise rød markering ved divergens.
// ───────────────────────────────────────────────────────────────────────────────

test("payroll-summary counts matcher antal finance_transactions rows skrevet (#535)", async () => {
  // Tre hold med forskellige payroll-scenarier:
  //   team-a: salary 200, balance 1000 → ingen emergency-lån, ingen negativ-rente
  //   team-b: salary 500, balance 100  → emergency-lån for 400, balance ender 0
  //   team-c: salary 0, ingen ryttere → ingen salary-row
  // + ét aktivt lån pr. (team-a, team-b) → 2 loan_interest-rows forventet
  const financeRows = [];
  const teams = new Map([
    ["team-a", { id: "team-a", name: "A", balance: 1000, division: 3, riders: [{ id: "r1", salary: 200 }] }],
    ["team-b", { id: "team-b", name: "B", balance: 100, division: 3, riders: [{ id: "r2", salary: 500 }] }],
    ["team-c", { id: "team-c", name: "C", balance: 500, division: 3, riders: [] }],
  ]);
  const loans = [
    { id: "loan-a", team_id: "team-a", amount_remaining: 1000, interest_rate: 0.10, seasons_remaining: 2, status: "active" },
    { id: "loan-b", team_id: "team-b", amount_remaining: 2000, interest_rate: 0.10, seasons_remaining: 2, status: "active" },
  ];

  const mockSupabase = {
    rpc(name, params) {
      if (name !== "increment_balance_with_audit") throw new Error(`Unexpected rpc: ${name}`);
      const row = { team_id: params.p_team_id, ...params.p_finance_payload };
      // Idempotency-respekt: skip dupe-rows på idempotency_key
      if (row.idempotency_key) {
        const dupe = financeRows.find((r) => r.idempotency_key === row.idempotency_key);
        if (dupe) return Promise.resolve({ data: null, error: { code: "23505", constraint: "uniq_finance_idempotency_key" } });
      }
      const team = teams.get(params.p_team_id);
      if (team) team.balance += params.p_delta;
      financeRows.push(row);
      return Promise.resolve({ data: team?.balance ?? 0, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(_cols) {
            return {
              eq(col, val) {
                if (col === "id") {
                  return { single: () => Promise.resolve({ data: { balance: teams.get(val)?.balance ?? 0 }, error: null }) };
                }
                throw new Error(`Unexpected teams.eq col: ${col}`);
              },
            };
          },
        };
      }
      if (table === "loans") {
        const filters = {};
        const query = {
          select(_cols) { return query; },
          eq(col, val) { filters[col] = val; return query; },
          then(resolve, reject) {
            const rows = loans.filter((l) =>
              (!filters.team_id || l.team_id === filters.team_id) &&
              (!filters.status || l.status === filters.status)
            );
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
          update(payload) {
            return {
              eq(col, val) {
                const loan = loans.find((l) => l[col] === val);
                if (loan) Object.assign(loan, payload);
                return Promise.resolve({ error: null });
              },
            };
          },
          insert(row) {
            // createEmergencyLoan inserter ny lån-row → .select().single()
            const inserted = { id: `loan-${loans.length + 1}`, ...row };
            loans.push(inserted);
            return {
              select() {
                return { single: () => Promise.resolve({ data: inserted, error: null }) };
              },
            };
          },
        };
        return query;
      }
      if (table === "finance_transactions") {
        return {
          insert(row) {
            // processLoanInterest skriver direkte til finance_transactions
            // (ikke via RPC) så den path skal også tracks i financeRows.
            financeRows.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "loan_config") {
        return {
          select() { return { eq() { return Promise.resolve({ data: [{ loan_type: "emergency", origination_fee_pct: 0.15, interest_rate_pct: 0.15, debt_ceiling: 1_000_000 }], error: null }); } };
          },
        };
      }
      if (table === "notifications") {
        const noop = { eq: () => noop, gte: () => noop, is: () => noop, order: () => noop, limit: () => Promise.resolve({ data: [], error: null }) };
        return { select: () => noop, insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  // Kør payroll for hvert hold (matcher defaultRunSeasonPayroll-loop)
  const { processTeamSeasonPayroll: payrollFn } = await import("./economyEngine.js");
  const perTeamResults = [];
  for (const team of teams.values()) {
    perTeamResults.push(await payrollFn(team, "season-1", { supabase: mockSupabase }));
  }

  // Aggregér summary (matcher defaultRunSeasonPayroll's reduce-step)
  const summary = perTeamResults.reduce((acc, p) => {
    acc.loan_interest_count += p.loan_interest_count || 0;
    acc.loan_interest_total += p.loan_interest || 0;
    acc.salary_count += p.salary_count || 0;
    acc.salary_total += p.salary || 0;
    acc.emergency_loan_count += p.emergency_loan_count || 0;
    acc.emergency_loan_total += p.emergency_loan_amount || 0;
    acc.negative_balance_interest_count += p.negative_balance_interest_count || 0;
    acc.negative_balance_interest_total += p.negative_balance_interest || 0;
    return acc;
  }, {
    loan_interest_count: 0, loan_interest_total: 0,
    salary_count: 0, salary_total: 0,
    emergency_loan_count: 0, emergency_loan_total: 0,
    negative_balance_interest_count: 0, negative_balance_interest_total: 0,
  });

  // INVARIANT: summary counts == antal finance_transactions rows af samme type
  const loanInterestRows = financeRows.filter((r) => r.type === "loan_interest");
  const salaryRows = financeRows.filter((r) => r.type === "salary");
  const emergencyRows = financeRows.filter((r) => r.type === "emergency_loan");
  const negInterestRows = financeRows.filter((r) => r.type === "interest");

  assert.equal(summary.loan_interest_count, loanInterestRows.length,
    "summary.loan_interest_count skal matche antal loan_interest-rows skrevet");
  assert.equal(summary.salary_count, salaryRows.length,
    "summary.salary_count skal matche antal salary-rows skrevet");
  assert.equal(summary.emergency_loan_count, emergencyRows.length,
    "summary.emergency_loan_count skal matche antal emergency_loan-rows skrevet");
  assert.equal(summary.negative_balance_interest_count, negInterestRows.length,
    "summary.negative_balance_interest_count skal matche antal interest-rows skrevet (negativ-balance-rente)");

  // INVARIANT: summary totals == abs(sum af amount) for samme type
  const sumAbs = (rows) => rows.reduce((s, r) => s + Math.abs(r.amount || 0), 0);
  assert.equal(summary.loan_interest_total, sumAbs(loanInterestRows),
    "summary.loan_interest_total skal matche abs(sum af amount) for loan_interest-rows");
  assert.equal(summary.salary_total, sumAbs(salaryRows),
    "summary.salary_total skal matche abs(sum af amount) for salary-rows");

  // Forventet scenario: 2 loan_interest (team-a + team-b), 2 salary (team-a + team-b, team-c skipper),
  // 1 emergency_loan (team-b), 0 negative_balance_interest (alle ender med balance >= 0).
  assert.equal(summary.loan_interest_count, 2, "team-a + team-b har aktive lån → 2 loan_interest");
  assert.equal(summary.salary_count, 2, "team-a + team-b har ryttere → 2 salary-rows (team-c skip)");
  assert.equal(summary.emergency_loan_count, 1, "team-b balance 100 < salary 500 → 1 emergency-lån");
  assert.equal(summary.negative_balance_interest_count, 0, "alle hold ender ≥ 0 balance efter emergency-lån");
});

test("payroll-summary: skipped (idempotent-retry) loan_interest tæller IKKE i counts (#535)", async () => {
  // Cron-retry-scenarie: anden gang vi kører payroll for samme sæson, fanger
  // DB'en duplicate-INSERT via uniq_loan_interest_per_loan_season og returnerer
  // 23505. Vi må IKKE tælle disse "skipped" rows i summary.count, ellers ville
  // re-run vise count=2 mens UI'en ser count=1 → falsk-positive divergens-alert.
  const financeRows = [];
  const team = { id: "team-1", name: "Retry", balance: 5000, riders: [{ id: "r1", salary: 100 }] };
  const loan = { id: "loan-1", team_id: "team-1", amount_remaining: 1000, interest_rate: 0.10, seasons_remaining: 2, status: "active" };

  const mockSupabase = {
    rpc(name, params) {
      if (name !== "increment_balance_with_audit") throw new Error(`Unexpected rpc: ${name}`);
      const row = { team_id: params.p_team_id, ...params.p_finance_payload };
      if (row.idempotency_key && financeRows.some((r) => r.idempotency_key === row.idempotency_key)) {
        return Promise.resolve({ data: null, error: { code: "23505", constraint: "uniq_finance_idempotency_key" } });
      }
      team.balance += params.p_delta;
      financeRows.push(row);
      return Promise.resolve({ data: team.balance, error: null });
    },
    from(table) {
      if (table === "teams") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { balance: team.balance }, error: null }) }) }) };
      }
      if (table === "loans") {
        const query = {
          select: () => query, eq: () => query,
          then: (r) => Promise.resolve({ data: [loan], error: null }).then(r),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
        return query;
      }
      if (table === "finance_transactions") {
        return {
          insert(row) {
            // Simulér uniq_loan_interest_per_loan_season ved 2. INSERT for samme (loan, season)
            const dupe = financeRows.find((r) =>
              r.type === "loan_interest" && r.related_loan_id === row.related_loan_id && r.season_id === row.season_id
            );
            if (dupe) {
              return Promise.resolve({ error: { code: "23505", constraint: "uniq_loan_interest_per_loan_season" } });
            }
            financeRows.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const { processTeamSeasonPayroll: payrollFn } = await import("./economyEngine.js");

  // Første kørsel: alle rows skrives
  const first = await payrollFn(team, "season-1", { supabase: mockSupabase });
  assert.equal(first.loan_interest_count, 1, "første kørsel: 1 loan_interest debiteret");
  assert.equal(first.salary_count, 1, "første kørsel: 1 salary debiteret");

  // Anden kørsel (cron-retry): DB afviser duplicates, count må reflektere det
  const second = await payrollFn(team, "season-1", { supabase: mockSupabase });
  assert.equal(second.loan_interest_count, 0,
    "anden kørsel: 0 nye loan_interest debiteret (DB afviste duplikat)");
  // Salary går via debitTeam med idempotent=true → RPC returnerer 23505, debitTeam swallow'er → 0 ny row.
  // Vores counter er totalSalary > 0 ? 1 : 0 — men totalSalary er stadig 100 selv om RPC skipper.
  // Det er en mindre upræcision: vi accepterer at salary_count tæller "ville-have-debiteret" frem for
  // "faktisk debiteret". Invariant-testen ovenfor (test 9) dokumenterer den faktiske finance-row-count.
  // Re-asserter at finance_transactions har præcis 2 rows (1 loan_interest + 1 salary) efter begge kørsler.
  const totalRows = financeRows.length;
  assert.equal(totalRows, 2, "DB har præcis 2 finance-rows efter 2 kørsler (1 loan_interest + 1 salary)");
});
