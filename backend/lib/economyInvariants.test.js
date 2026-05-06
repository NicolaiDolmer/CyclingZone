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

const { payDivisionBonuses, processSeasonStart } = await import("./economyEngine.js");
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
  await processSeasonStart("season-1", { supabase: supabase.client });

  const sponsorRows = supabase.state.insertedFinanceRows.filter((r) => r.type === "sponsor");
  assert.equal(sponsorRows.length, 0, "ingen sponsor-row inserted ved unique_violation");
});
