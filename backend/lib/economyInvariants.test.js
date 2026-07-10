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
const { createEmergencyLoan, processLoanInterest, computeMaxLoanPrincipal } = await import("./loanEngine.js");

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
        if (name === "create_loan_atomic" || name === "create_emergency_loan_atomic") {
          // Lad app-koden falde tilbage til JS-niveau clamp + INSERT.
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
            select(_columns) {
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
            // #2301 · app-guarden i createEmergencyLoan tilføjer en 3. eq() + .maybeSingle()
            // (team_id, loan_type, season_id) — genbruger samme filter-akkumulator som
            // getTotalDebt's `.select("amount_remaining").eq(team_id).eq(status)`.
            select(_columns) {
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
                maybeSingle() {
                  let rows = state.loans;
                  if (filters.team_id) rows = rows.filter((l) => l.team_id === filters.team_id);
                  if (filters.loan_type) rows = rows.filter((l) => l.loan_type === filters.loan_type);
                  if (filters.season_id) rows = rows.filter((l) => l.season_id === filters.season_id);
                  return Promise.resolve({ data: rows[0] || null, error: null });
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
            // #2304: processLoanInterest gør sin idempotency-UPDATE betinget
            // via .or(last_interest_season_id.is.null,...neq.<season>) og
            // læser affected-rows via .select(). Mocken simulerer samme WHERE
            // -logik i JS så idempotency-testen kan verificere 0-rows-skip.
            update(payload) {
              let eqFilters = {};
              let orFilter = null;
              const query = {
                eq(col, val) {
                  eqFilters[col] = val;
                  return query;
                },
                or(expr) {
                  orFilter = expr;
                  return query;
                },
                select() {
                  const loan = state.loans.find((l) => l.id === eqFilters.id);
                  if (!loan) return Promise.resolve({ data: [], error: null });
                  if (orFilter) {
                    const seasonMatch = orFilter.match(/neq\.(.+)$/);
                    const targetSeason = seasonMatch ? seasonMatch[1] : null;
                    const blocked = loan.last_interest_season_id != null
                      && loan.last_interest_season_id === targetSeason;
                    if (blocked) return Promise.resolve({ data: [], error: null });
                  }
                  Object.assign(loan, payload);
                  return Promise.resolve({ data: [{ id: loan.id }], error: null });
                },
              };
              return query;
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

        if (table === "sponsor_contracts") {
          // #1663: getActiveContract — ingen aktiv kontrakt (no-contract-sti).
          const query = {
            eq() { return query; },
            maybeSingle() { return Promise.resolve({ data: null, error: null }); },
          };
          return { select() { return query; } };
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
// 3. processLoanInterest — per (loan, season) idempotent (#2304 post-refactor)
//
// #2304 (finance-audit 10/7): processLoanInterest skriver IKKE længere en
// finance_transactions-row ved kapitalisering (den var kontant-lignende uden
// at debitere balancen, og talte renten dobbelt med repayment). Idempotency
// er nu en betinget UPDATE på loans.last_interest_season_id i stedet for et
// unique index på finance_transactions.
// ───────────────────────────────────────────────────────────────────────────────

test("processLoanInterest skriver INGEN finance_transactions-row ved kapitalisering", async () => {
  const loan = {
    id: "loan-7",
    team_id: "team-1",
    amount_remaining: 100_000,
    accrued_interest: 0,
    interest_rate: 0.10,
    seasons_remaining: 3,
    status: "active",
  };

  const supabase = createIdempotencySupabase({
    loans: [loan],
    teams: [{ id: "team-1", division: 3 }],
  });

  const result = await processLoanInterest("team-1", "season-1", supabase.client);

  assert.equal(
    supabase.state.insertedFinanceRows.length,
    0,
    "ingen finance_transactions-row må insertes ved rente-kapitalisering (#2304 — ikke-kontant)"
  );
  assert.equal(result.charged.length, 1);
  assert.equal(result.charged[0].skipped, false);
  assert.equal(result.charged[0].interest, 10_000);

  const updatedLoan = supabase.state.loans.find((l) => l.id === "loan-7");
  assert.equal(updatedLoan.amount_remaining, 110_000, "renten skal stadig kapitaliseres ind i amount_remaining");
  assert.equal(updatedLoan.accrued_interest, 10_000, "accrued_interest skal akkumulere den tilskrevne rente");
  assert.equal(updatedLoan.last_interest_season_id, "season-1");
});

test("processLoanInterest fanger dobbelt-charge per (loan, season) — betinget UPDATE rammer 0 rows", async () => {
  const loan = {
    id: "loan-1",
    team_id: "team-1",
    amount_remaining: 100_000,
    accrued_interest: 10_000,
    interest_rate: 0.10,
    seasons_remaining: 2,
    status: "active",
    // Renten er allerede tilskrevet for season-1 i en tidligere cron-kørsel.
    last_interest_season_id: "season-1",
  };

  const supabase = createIdempotencySupabase({
    loans: [loan],
    teams: [{ id: "team-1", division: 3 }],
  });

  const result = await processLoanInterest("team-1", "season-1", supabase.client);

  assert.equal(result.charged.length, 1);
  assert.equal(result.charged[0].skipped, true, "2. kørsel for samme sæson skal skippe stille");

  const updatedLoan = supabase.state.loans.find((l) => l.id === "loan-1");
  assert.equal(updatedLoan.amount_remaining, 100_000, "amount_remaining må ikke ændres ved dobbelt-charge");
  assert.equal(updatedLoan.accrued_interest, 10_000, "accrued_interest må ikke ændres ved dobbelt-charge");
});

// ───────────────────────────────────────────────────────────────────────────────
// 4. createEmergencyLoan — HARD clamp (B2, erstatter SOFT-tests fra 2026-05-07)
//
// SOFT-beslutningen fra 2026-05-07 er ophævet: lån clampes nu til det der
// passer under divisionsloftet. Clamp-not-throw fordi cron må ikke crashe.
// ───────────────────────────────────────────────────────────────────────────────

test("createEmergencyLoan HARD clamp: clamper principal og sender breach-notif (B2)", async () => {
  const config = {
    loan_type: "emergency",
    origination_fee_pct: 0.15,
    interest_rate_pct: 0.15,
    debt_ceiling: 600_000,
  };

  // Eksisterende debt 580K, headroom = 20K.
  // Max principal P: P + round(P*0.15) <= 20K → P=17391, fee=round(2608.65)=2609 → 19K... lad os sige
  // computeMaxLoanPrincipal({currentDebt:580000, debtCeiling:600000, originationFeePct:0.15})
  // Headroom=20000; P=floor(20000/1.15)=17391; 17391+round(17391*0.15)=17391+2609=20000 ✓
  const existingLoan = { id: "loan-old", team_id: "team-1", amount_remaining: 580_000, status: "active" };

  const supabase = createIdempotencySupabase({
    teams: [{ id: "team-1", balance: 0, division: 3, user_id: "user-1" }],
    loans: [existingLoan],
    loanConfig: config,
  });

  // Anmoder om 100K men kun ~17K passer under loftet.
  const loan = await createEmergencyLoan("team-1", 100_000, supabase.client, "season-1");

  // Lånet skal være oprettet — der er headroom.
  assert.ok(loan !== null, "loan skal returneres når der er headroom");

  const newLoan = supabase.state.loans.find((l) => l.id !== "loan-old");
  assert.ok(newLoan, "ny emergency-loan-row skal insertes");

  // Principal er clamped til præcis det maksimale der passer under loftet.
  // computeMaxLoanPrincipal({currentDebt:580000, debtCeiling:600000, originationFeePct:0.15})
  // => headroom=20000; P=floor(20000/1.15)=17391; fee=round(17391*0.15)=2609; total=20000 ✓
  const expectedPrincipal = computeMaxLoanPrincipal({ currentDebt: 580_000, debtCeiling: 600_000, originationFeePct: 0.15 }).principal;
  assert.equal(newLoan.principal, expectedPrincipal, `principal=${newLoan.principal} skal være præcis ${expectedPrincipal} (clamped til loft)`);
  assert.ok(
    580_000 + newLoan.amount_remaining <= 600_000,
    `total gæld ${580_000 + newLoan.amount_remaining} overstiger loft 600K`
  );

  // breach-notif sendes fordi residual > 0 (løn delvist udækket).
  const breachNotifs = supabase.state.insertedNotifications.filter(
    (n) => n.type === "emergency_loan_breach"
  );
  assert.ok(
    breachNotifs.length >= 1,
    `forventet emergency_loan_breach notif, fik: ${JSON.stringify(supabase.state.insertedNotifications.map((n) => n.type))}`
  );
});

test("createEmergencyLoan ingen breach-notif når fuld anmodning passer under loftet", async () => {
  const config = {
    loan_type: "emergency",
    origination_fee_pct: 0.15,
    interest_rate_pct: 0.15,
    debt_ceiling: 600_000,
  };

  // Ingen eksisterende gæld → 100K + 15K fee = 115K << 600K, ingen clamp.
  const supabase = createIdempotencySupabase({
    teams: [{ id: "team-1", balance: 0, division: 3, user_id: "user-1" }],
    loans: [],
    loanConfig: config,
  });

  await createEmergencyLoan("team-1", 100_000, supabase.client, "season-1");

  const breachNotifs = supabase.state.insertedNotifications.filter(
    (n) => n.type === "emergency_loan_breach"
  );
  assert.equal(breachNotifs.length, 0, "ingen breach-notif når fuld anmodning passer");
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
      // #1077 · processSeasonStart chainer nu is_ai.is_bank.is_frozen (3 eq) —
      // mocken understøtter vilkårlig længde via en self-chainende thenable.
      const teamsResult = {
        data: [{
          id: "team-1",
          name: "Test",
          balance: 0,
          sponsor_income: 240_000,
          board_profiles: [],
          is_frozen: false,
        }],
        error: null,
      };
      const makeTeamsChain = () => Object.assign(Promise.resolve(teamsResult), {
        eq() { return makeTeamsChain(); },
        single() {
          return Promise.resolve({ data: { balance: 0 }, error: null });
        },
      });
      return {
        select() {
          return { eq() { return makeTeamsChain(); } };
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
        // #1077 · is_ai.is_bank.is_frozen (3 eq) — self-chainende thenable.
        const teamsResult = {
          data: [{
            id: "team-1",
            name: "Variable Test",
            balance: 0,
            sponsor_income: 240_000,
            board_profiles: [],
            is_frozen: false,
          }],
          error: null,
        };
        const makeTeamsChain = () => Object.assign(Promise.resolve(teamsResult), {
          eq() { return makeTeamsChain(); },
        });
        return {
          select() {
            return { eq() { return makeTeamsChain(); } };
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
      if (table === "sponsor_contracts") {
        // #1663: getActiveContract — ingen aktiv kontrakt (no-contract-sti).
        const query = { eq() { return query; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); } };
        return { select() { return query; } };
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
  // team-1 er i division 3 (fra standings) → base 340k + variabel 75k = 415k.
  // #1441 A6: D3-base hævet 260k → 340k (kilde-re-tune, lukker D3-loopet mod den
  // friske 8-rytter-trups lønbyrde ≈ 316k). Variabel-komponenten er uændret (75k).
  assert.equal(financeRows[0].delta, 415_000);
  // #666: description er nu null; struktureret metadata.code + .params driver i18n.
  assert.equal(financeRows[0].description, null);
  assert.equal(financeRows[0].metadata?.code, "tx.sponsor.seasonStartVariable");
  assert.equal(financeRows[0].metadata?.params?.base, 340_000);
  assert.equal(financeRows[0].metadata?.params?.variable, 75_000);
  // #535: processSeasonStart returnerer nu { sponsor: [...], payroll: {...} }
  assert.equal(result.sponsor[0].sponsor, 415_000);
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
          // #1077 · is_ai.is_bank.is_frozen (3 eq) — self-chainende thenable.
          const teamsResult = {
            data: [{
              id: "team-1", name: "TestMode Team", balance: 0, sponsor_income: 240_000,
              board_profiles: [{ negotiation_status: "completed", budget_modifier: budgetModifier }],
              is_frozen: false,
            }],
            error: null,
          };
          const makeTeamsChain = () => Object.assign(Promise.resolve(teamsResult), {
            eq() { return makeTeamsChain(); },
          });
          return {
            select() { return { eq() { return makeTeamsChain(); } }; },
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
        if (table === "sponsor_contracts") {
          // #1663: getActiveContract — ingen aktiv kontrakt (no-contract-sti).
          const query = { eq() { return query; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); } };
          return { select() { return query; } };
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
        // #1077 · is_ai.is_bank.is_frozen (3 eq) — self-chainende thenable.
        const makeTeamsChain = () => Object.assign(Promise.resolve({ data: teams, error: null }), {
          eq() { return makeTeamsChain(); },
        });
        return {
          select() {
            return { eq() { return makeTeamsChain(); } };
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
      if (table === "sponsor_contracts") {
        // #1663: getActiveContract — ingen aktiv kontrakt (no-contract-sti).
        const query = { eq() { return query; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); } };
        return { select() { return query; } };
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
      if (table === "teams") {
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
      }
      if (table === "riders") {
        // Ingen akademi-ryttere i denne test → count=0
        return {
          select(_cols, opts) {
            if (opts && opts.count === "exact" && opts.head === true) {
              return {
                eq(_col, _val) {
                  return { eq(_c, _v) { return Promise.resolve({ count: 0, error: null }); } };
                },
              };
            }
            return { in(_col, _vals) { return Promise.resolve({ data: [], error: null }); } };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
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
      if (name === "create_emergency_loan_atomic" || name === "create_loan_atomic") {
        return Promise.resolve({ data: null, error: { code: "PGRST202", message: "function not exposed in mock" } });
      }
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
          update(_payload) {
            // B3: debt_breach_streak + transfer_frozen opdatering — ingen sideeffekt nødvendig i test.
            return { eq: (_col, _val) => Promise.resolve({ error: null }) };
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
          // #2301 · app-guarden i createEmergencyLoan: .select("*").eq(team_id).eq(loan_type).eq(season_id).maybeSingle()
          maybeSingle() {
            const rows = loans.filter((l) =>
              (!filters.team_id || l.team_id === filters.team_id) &&
              (!filters.loan_type || l.loan_type === filters.loan_type) &&
              (!filters.season_id || l.season_id === filters.season_id)
            );
            return Promise.resolve({ data: rows[0] || null, error: null });
          },
          update(payload) {
            // #2304: processLoanInterest's idempotency-UPDATE er betinget
            // (.eq("id", ...).or("last_interest_season_id.is.null,...").select("id")).
            // Mocken respekterer eq/or-filtrene, returnerer 0 rows hvis
            // last_interest_season_id allerede matcher target-sæsonen.
            let eqFilters = {};
            let orFilter = null;
            const updQuery = {
              eq(col, val) { eqFilters[col] = val; return updQuery; },
              or(expr) { orFilter = expr; return updQuery; },
              select() {
                const loan = loans.find((l) => l.id === eqFilters.id);
                if (!loan) return Promise.resolve({ data: [], error: null });
                if (orFilter) {
                  const seasonMatch = orFilter.match(/neq\.(.+)$/);
                  const targetSeason = seasonMatch ? seasonMatch[1] : null;
                  if (loan.last_interest_season_id != null && loan.last_interest_season_id === targetSeason) {
                    return Promise.resolve({ data: [], error: null });
                  }
                }
                Object.assign(loan, payload);
                return Promise.resolve({ data: [{ id: loan.id }], error: null });
              },
              // Ikke-#2304-callsites (fx B3 debt-breach-blok) bruger update().eq() uden .select().
              then(resolve, reject) {
                const loan = loans.find((l) => l.id === eqFilters.id);
                if (loan) Object.assign(loan, payload);
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return updQuery;
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
            // #2304: processLoanInterest skriver IKKE længere til
            // finance_transactions (renten er ikke-kontant, se loanEngine.js).
            // Denne insert-sti bruges nu kun af andre payroll-trin.
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
      if (table === "riders") {
        // Ingen akademi-ryttere i denne test → count=0
        return {
          select(_cols, opts) {
            if (opts && opts.count === "exact" && opts.head === true) {
              return {
                eq(_col, _val) {
                  return { eq(_c, _v) { return Promise.resolve({ count: 0, error: null }); } };
                },
              };
            }
            return { in(_col, _vals) { return Promise.resolve({ data: [], error: null }); } };
          },
        };
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

  // INVARIANT (post-#2304): loan_interest skriver IKKE længere en
  // finance_transactions-row (ikke-kontant kapitalisering) — summary
  // counts/totals verificeres i stedet direkte mod loans-state
  // (amount_remaining/accrued_interest), IKKE mod financeRows.
  const salaryRows = financeRows.filter((r) => r.type === "salary");
  const emergencyRows = financeRows.filter((r) => r.type === "emergency_loan");
  const negInterestRows = financeRows.filter((r) => r.type === "interest");

  assert.equal(financeRows.filter((r) => r.type === "loan_interest").length, 0,
    "loan_interest må ALDRIG skrive en finance_transactions-row (#2304 — ikke-kontant)");
  assert.equal(summary.salary_count, salaryRows.length,
    "summary.salary_count skal matche antal salary-rows skrevet");
  assert.equal(summary.emergency_loan_count, emergencyRows.length,
    "summary.emergency_loan_count skal matche antal emergency_loan-rows skrevet");
  assert.equal(summary.negative_balance_interest_count, negInterestRows.length,
    "summary.negative_balance_interest_count skal matche antal interest-rows skrevet (negativ-balance-rente)");

  // loan_interest_total verificeres mod loans-statens accrued_interest i stedet.
  const totalAccrued = loans.reduce((s, l) => s + (l.accrued_interest || 0), 0);
  assert.equal(summary.loan_interest_total, totalAccrued,
    "summary.loan_interest_total skal matche summen af accrued_interest på lånene");

  // INVARIANT: summary totals == abs(sum af amount) for samme type
  const sumAbs = (rows) => rows.reduce((s, r) => s + Math.abs(r.amount || 0), 0);
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
  // Cron-retry-scenarie (post-#2304): anden gang vi kører payroll for samme
  // sæson, rammer processLoanInterest's betingede UPDATE (WHERE
  // last_interest_season_id IS DISTINCT FROM p_season_id) 0 rows, fordi
  // loans.last_interest_season_id allerede er sat til season-1 af 1. kørsel.
  // Vi må IKKE tælle disse "skipped" i summary.count, ellers ville re-run
  // vise count=2 mens loans-state kun blev opdateret 1 gang → falsk-positive
  // divergens-alert.
  const financeRows = [];
  const team = { id: "team-1", name: "Retry", balance: 5000, riders: [{ id: "r1", salary: 100 }] };
  const loan = {
    id: "loan-1", team_id: "team-1", amount_remaining: 1000, accrued_interest: 0,
    interest_rate: 0.10, seasons_remaining: 2, status: "active", last_interest_season_id: null,
  };

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
        let eqFilters = {};
        let orFilter = null;
        const query = {
          select: () => query,
          eq(col, val) { eqFilters[col] = val; return query; },
          or(expr) { orFilter = expr; return query; },
          then: (r) => Promise.resolve({ data: [loan], error: null }).then(r),
          update(payload) {
            eqFilters = {};
            orFilter = null;
            return {
              eq(col, val) { eqFilters[col] = val; return this; },
              or(expr) { orFilter = expr; return this; },
              select() {
                if (eqFilters.id !== loan.id) return Promise.resolve({ data: [], error: null });
                if (orFilter) {
                  const seasonMatch = orFilter.match(/neq\.(.+)$/);
                  const targetSeason = seasonMatch ? seasonMatch[1] : null;
                  if (loan.last_interest_season_id != null && loan.last_interest_season_id === targetSeason) {
                    return Promise.resolve({ data: [], error: null });
                  }
                }
                Object.assign(loan, payload);
                return Promise.resolve({ data: [{ id: loan.id }], error: null });
              },
            };
          },
        };
        return query;
      }
      if (table === "finance_transactions") {
        return {
          insert(row) {
            // #2304: loan_interest skriver ikke længere en row her — andre
            // payroll-trin (fx salary) bruger ikke denne sti (går via RPC),
            // men behold insert-mock for defensiv robusthed.
            financeRows.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "riders") {
        // Ingen akademi-ryttere i denne test → count=0
        return {
          select(_cols, opts) {
            if (opts && opts.count === "exact" && opts.head === true) {
              return {
                eq(_col, _val) {
                  return { eq(_c, _v) { return Promise.resolve({ count: 0, error: null }); } };
                },
              };
            }
            return { in(_col, _vals) { return Promise.resolve({ data: [], error: null }); } };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const { processTeamSeasonPayroll: payrollFn } = await import("./economyEngine.js");

  // Første kørsel: loans-state opdateres, last_interest_season_id sættes.
  const first = await payrollFn(team, "season-1", { supabase: mockSupabase });
  assert.equal(first.loan_interest_count, 1, "første kørsel: 1 loan_interest tilskrevet");
  assert.equal(first.salary_count, 1, "første kørsel: 1 salary debiteret");
  assert.equal(loan.accrued_interest, 100, "accrued_interest akkumulerer den tilskrevne rente");
  assert.equal(loan.last_interest_season_id, "season-1");

  // Anden kørsel (cron-retry): betinget UPDATE rammer 0 rows → skip.
  const second = await payrollFn(team, "season-1", { supabase: mockSupabase });
  assert.equal(second.loan_interest_count, 0,
    "anden kørsel: 0 nye loan_interest tilskrevet (idempotency-guard skippede)");
  assert.equal(loan.accrued_interest, 100, "accrued_interest må ikke ændres ved dobbelt-charge");

  // INVARIANT (post-#2304): loan_interest skriver ALDRIG en finance_transactions-row.
  assert.equal(financeRows.filter((r) => r.type === "loan_interest").length, 0,
    "loan_interest må ALDRIG skrive en finance_transactions-row (#2304 — ikke-kontant)");
  // Kun 1 finance-row (salary) skrevet over begge kørsler (salary's RPC-idempotency
  // afviser 2. forsøg, men mocken pusher først når RPC lykkes).
  assert.equal(financeRows.length, 1, "kun salary-row skrevet — loan_interest er ikke-kontant");
});
