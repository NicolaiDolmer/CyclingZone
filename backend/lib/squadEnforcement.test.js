import test from "node:test";
import assert from "node:assert/strict";

import {
  enforceTeamSquadCompliance,
  processSquadEnforcementCron,
  SQUAD_FINE_AMOUNT,
  SQUAD_PENALTY_POINTS,
  SQUAD_PURCHASE_MARKUP,
} from "./squadEnforcement.js";

// ─── Mock-fabrik ─────────────────────────────────────────────────────────────
//
// State-based mock: holder rider/team/standings i et lille in-memory store og
// returnerer matchende data efter from()/select()/update()-pattern. Keeper sig
// til de calls squadEnforcement faktisk laver.

function createMockSupabase(initialState) {
  const state = {
    teams: [...(initialState.teams || [])],
    riders: [...(initialState.riders || [])],
    loanAgreements: [...(initialState.loanAgreements || [])],
    seasonStandings: [...(initialState.seasonStandings || [])],
    transferWindows: [...(initialState.transferWindows || [])],
    financeTransactions: [],
    notifications: [],
    riderUpdates: [],
    teamUpdates: [],
    emergencyLoans: [],
  };

  function teamById(id) {
    return state.teams.find(t => t.id === id);
  }

  function ridersByTeamId(id) {
    return state.riders.filter(r => r.team_id === id);
  }

  function from(table) {
    if (table === "teams") return teamsTable();
    if (table === "riders") return ridersTable();
    if (table === "loan_agreements") return loanAgreementsTable();
    if (table === "season_standings") return seasonStandingsTable();
    if (table === "transfer_windows") return transferWindowsTable();
    if (table === "finance_transactions") return financeTransactionsTable();
    if (table === "notifications") return notificationsTable();
    throw new Error(`Unexpected table: ${table}`);
  }

  function teamsTable() {
    return {
      select(_cols) {
        const filters = {};
        const builder = {
          eq(col, val) {
            filters[col] = val;
            return {
              ...builder,
              single: () => {
                const team = state.teams.find(t => t[col] === val);
                return Promise.resolve({ data: team || null, error: null });
              },
              then: (resolve) => {
                const matches = state.teams.filter(t => Object.entries(filters).every(([k, v]) => t[k] === v));
                resolve({ data: matches, error: null });
              },
            };
          },
          not(col, _op, val) {
            filters[`!${col}`] = val;
            return {
              ...builder,
              eq(c2, v2) { filters[c2] = v2; return { ...builder }; },
              then: (resolve) => {
                const matches = state.teams.filter(t => {
                  for (const [k, v] of Object.entries(filters)) {
                    if (k.startsWith("!")) {
                      if (t[k.slice(1)] === v) return false;
                    } else if (t[k] !== v) {
                      return false;
                    }
                  }
                  return true;
                });
                resolve({ data: matches, error: null });
              },
            };
          },
        };
        return builder;
      },
      update(payload) {
        return {
          eq(col, val) {
            const team = state.teams.find(t => t[col] === val);
            if (team) {
              Object.assign(team, payload);
              state.teamUpdates.push({ id: team.id, payload });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
  }

  function ridersTable() {
    return {
      select(_cols, opts = {}) {
        const filters = {};
        const orderBy = { col: null, asc: true };
        let limitN = null;
        const builder = {
          eq(col, val) { filters[col] = val; return chain(); },
          is(col, val) { filters[`is:${col}`] = val; return chain(); },
          in(col, vals) { filters[`in:${col}`] = vals; return chain(); },
          order(col, opt = {}) { orderBy.col = col; orderBy.asc = opt.ascending !== false; return chain(); },
          limit(n) { limitN = n; return chain(); },
        };
        function chain() { return builder; }
        builder.then = (resolve) => {
          let rows = state.riders.filter(r => {
            for (const [k, v] of Object.entries(filters)) {
              if (k.startsWith("is:")) {
                const col = k.slice(3);
                if (v === null && r[col] != null) return false;
                if (v !== null && r[col] !== v) return false;
              } else if (k.startsWith("in:")) {
                const col = k.slice(3);
                if (!v.includes(r[col])) return false;
              } else {
                if (r[k] !== v) return false;
              }
            }
            return true;
          });
          if (orderBy.col) {
            rows.sort((a, b) => {
              const cmp = (a[orderBy.col] || 0) - (b[orderBy.col] || 0);
              return orderBy.asc ? cmp : -cmp;
            });
          }
          if (limitN != null) rows = rows.slice(0, limitN);
          if (opts.count === "exact") {
            resolve({ count: rows.length, data: null, error: null });
          } else {
            resolve({ data: rows, error: null });
          }
        };
        return builder;
      },
      update(payload) {
        return {
          eq(col, val) {
            const rider = state.riders.find(r => r[col] === val);
            if (rider) {
              Object.assign(rider, payload);
              state.riderUpdates.push({ id: rider.id, payload });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
  }

  function loanAgreementsTable() {
    return {
      select(_cols, opts = {}) {
        const filters = {};
        const builder = {
          eq(col, val) { filters[col] = val; return builder; },
        };
        builder.then = (resolve) => {
          const rows = state.loanAgreements.filter(l => Object.entries(filters).every(([k, v]) => l[k] === v));
          resolve({ data: rows, error: null });
        };
        return builder;
      },
    };
  }

  function seasonStandingsTable() {
    return {
      select() {
        const filters = {};
        const builder = {
          eq(col, val) { filters[col] = val; return builder; },
          in(col, vals) { filters[`in:${col}`] = vals; return builder; },
          maybeSingle: () => {
            const row = state.seasonStandings.find(s => Object.entries(filters).every(([k, v]) => {
              if (k.startsWith("in:")) return v.includes(s[k.slice(3)]);
              return s[k] === v;
            }));
            return Promise.resolve({ data: row || null, error: null });
          },
        };
        builder.then = (resolve) => {
          const rows = state.seasonStandings.filter(s => Object.entries(filters).every(([k, v]) => {
            if (k.startsWith("in:")) return v.includes(s[k.slice(3)]);
            return s[k] === v;
          }));
          resolve({ data: rows, error: null });
        };
        return builder;
      },
      update(payload) {
        return {
          eq(col, val) {
            const row = state.seasonStandings.find(s => s[col] === val);
            if (row) Object.assign(row, payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      insert(row) {
        state.seasonStandings.push({ id: `s-${state.seasonStandings.length + 1}`, penalty_points: 0, ...row });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function transferWindowsTable() {
    return {
      select() {
        const filters = {};
        const builder = {
          eq(col, val) { filters[col] = val; return builder; },
          is(col, val) { filters[`is:${col}`] = val; return builder; },
          // not("closed_at", "is", null) = "closed_at IS NOT NULL" i Supabase JS.
          not(col, _op, val) { filters[`not:${col}`] = val; return builder; },
          order() { return builder; },
          limit() { return builder; },
          maybeSingle: () => {
            const row = state.transferWindows.find(w => {
              for (const [k, v] of Object.entries(filters)) {
                if (k.startsWith("is:")) {
                  const col = k.slice(3);
                  if (v === null && w[col] != null) return false;
                  if (v !== null && w[col] !== v) return false;
                } else if (k.startsWith("not:")) {
                  const col = k.slice(4);
                  // not(col, "is", null) = col IS NOT NULL
                  if (v === null && w[col] == null) return false;
                } else if (w[k] !== v) {
                  return false;
                }
              }
              return true;
            });
            return Promise.resolve({ data: row || null, error: null });
          },
        };
        return builder;
      },
      update(payload) {
        return {
          eq(col1, val1) {
            return {
              is(col2, val2) {
                return {
                  select() {
                    const window = state.transferWindows.find(w => w[col1] === val1);
                    if (!window) return Promise.resolve({ data: [], error: null });
                    if (val2 === null && window[col2] != null) {
                      return Promise.resolve({ data: [], error: null });
                    }
                    Object.assign(window, payload);
                    return Promise.resolve({ data: [{ id: window.id }], error: null });
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  function financeTransactionsTable() {
    return {
      insert(row) {
        const rows = Array.isArray(row) ? row : [row];
        state.financeTransactions.push(...rows);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  function notificationsTable() {
    return {
      insert(row) {
        const rows = Array.isArray(row) ? row : [row];
        state.notifications.push(...rows);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  // Slice 07c: balance + finance_transactions atomic via RPC.
  function rpc(name, params) {
    if (name !== "increment_balance_with_audit") {
      throw new Error(`Unexpected rpc: ${name}`);
    }
    const team = teamById(params.p_team_id);
    if (team) {
      team.balance = (team.balance ?? 0) + params.p_delta;
      state.teamUpdates.push({ id: team.id, payload: { balance: team.balance } });
    }
    state.financeTransactions.push({
      team_id: params.p_team_id,
      ...params.p_finance_payload,
    });
    return Promise.resolve({ data: team?.balance ?? params.p_delta, error: null });
  }

  return {
    from,
    rpc,
    state,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("enforceTeamSquadCompliance: hold inden for limits → no-op", async () => {
  const supabase = createMockSupabase({
    teams: [{ id: "t1", name: "Test", balance: 500_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: Array.from({ length: 9 }, (_, i) => ({
      id: `r${i}`, firstname: "F", lastname: `L${i}`, team_id: "t1",
      market_value: 50_000, uci_points: 10, ai_team_id: null, acquired_at: null, created_at: "2026-01-01",
    })),
  });

  const result = await enforceTeamSquadCompliance({
    supabase,
    teamId: "t1",
    seasonId: null,
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "within_limits");
  assert.equal(result.totalCount, 9);
  assert.equal(supabase.state.financeTransactions.length, 0);
  assert.equal(supabase.state.notifications.length, 0);
});

test("enforceTeamSquadCompliance: D3 hold med 5 ryttere → auto-køb 3 + 300K bøde + 600p fradrag", async () => {
  const supabase = createMockSupabase({
    teams: [{ id: "t1", name: "Test", balance: 5_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `r${i}`, firstname: "Owned", lastname: `R${i}`, team_id: "t1",
        market_value: 50_000, uci_points: 10, ai_team_id: null, acquired_at: null, created_at: "2026-01-01",
      })),
      // Fri agents — sorteres efter uci_points ASC
      { id: "fa1", firstname: "Cheap", lastname: "Filler1", team_id: null, market_value: 20_000, uci_points: 1, ai_team_id: null },
      { id: "fa2", firstname: "Cheap", lastname: "Filler2", team_id: null, market_value: 20_000, uci_points: 2, ai_team_id: null },
      { id: "fa3", firstname: "Cheap", lastname: "Filler3", team_id: null, market_value: 20_000, uci_points: 3, ai_team_id: null },
      { id: "fa4", firstname: "Skip", lastname: "Me", team_id: null, market_value: 20_000, uci_points: 50, ai_team_id: null },
    ],
    seasonStandings: [
      { id: "s1", season_id: "season-1", team_id: "t1", division: 3, total_points: 1000, penalty_points: 0 },
    ],
  });

  const notifications = [];
  const result = await enforceTeamSquadCompliance({
    supabase,
    teamId: "t1",
    seasonId: "season-1",
    notifyTeamOwner: async (teamId, type, title, message) => {
      notifications.push({ teamId, type, title, message });
    },
    createEmergencyLoanFn: async () => { throw new Error("Should not be called — balance is sufficient"); },
    now: new Date("2026-05-04T12:00:00Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "auto_purchased");
  assert.equal(result.deviatingCount, 3);
  assert.equal(result.purchases.length, 3);
  assert.equal(result.purchases[0].riderName, "Cheap Filler1"); // cheapest first
  assert.equal(result.fineAmount, 300_000);
  assert.equal(result.penaltyPoints, 600);

  // Penalty points akkumuleret på standings-row
  assert.equal(supabase.state.seasonStandings[0].penalty_points, 600);

  // 3x auto_squad_purchase + 1x squad_violation_fine = 4 transactions
  const purchases = supabase.state.financeTransactions.filter(t => t.type === "auto_squad_purchase");
  const fines = supabase.state.financeTransactions.filter(t => t.type === "squad_violation_fine");
  assert.equal(purchases.length, 3);
  assert.equal(fines.length, 1);
  assert.equal(fines[0].amount, -300_000);

  // Hver købt rytter har team_id sat til t1 + acquired_at sat
  const boughtRiders = supabase.state.riders.filter(r => ["fa1", "fa2", "fa3"].includes(r.id));
  assert.ok(boughtRiders.every(r => r.team_id === "t1"));
  assert.ok(boughtRiders.every(r => r.acquired_at === "2026-05-04T12:00:00.000Z"));

  // En notifikation til manager
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "squad_enforced");
  assert.match(notifications[0].message, /Auto-købt 3 ryttere/);
  assert.match(notifications[0].message, /300\.000 CZ\$/);
  assert.match(notifications[0].message, /600 point/);
});

test("enforceTeamSquadCompliance: D3 hold med 12 ryttere → auto-sælg 2 + 200K bøde + 400p fradrag", async () => {
  const supabase = createMockSupabase({
    teams: [{ id: "t1", name: "Test", balance: 1_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      firstname: "Rider",
      lastname: `${i}`,
      team_id: "t1",
      market_value: 100_000,
      uci_points: 10,
      ai_team_id: i < 10 ? null : "ai-team",
      // Stigende acquired_at — hver rytter har unikt timestamp; r10 og r11 er nyest
      acquired_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      created_at: "2026-01-01",
    })),
    seasonStandings: [
      { id: "s1", season_id: "season-1", team_id: "t1", division: 3, total_points: 500, penalty_points: 50 },
    ],
  });

  const result = await enforceTeamSquadCompliance({
    supabase,
    teamId: "t1",
    seasonId: "season-1",
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04T12:00:00Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "auto_sold");
  assert.equal(result.deviatingCount, 2);
  assert.equal(result.sales.length, 2);
  // De nyeste (r10, r11) bliver solgt
  const soldIds = result.sales.map(s => s.riderId).sort();
  assert.deepEqual(soldIds, ["r10", "r11"]);
  assert.equal(result.fineAmount, 200_000);
  assert.equal(result.penaltyPoints, 400);

  // r10 og r11 har ai_team_id="ai-team" → returneret dér
  const r10 = supabase.state.riders.find(r => r.id === "r10");
  assert.equal(r10.team_id, "ai-team");

  // Akkumuleret penalty (50 + 400 = 450)
  assert.equal(supabase.state.seasonStandings[0].penalty_points, 450);
});

test("enforceTeamSquadCompliance: utilstrækkelig balance → nødlån oprettes", async () => {
  const supabase = createMockSupabase({
    teams: [{ id: "t1", name: "Test", balance: 10_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `r${i}`, team_id: "t1", firstname: "F", lastname: `${i}`,
        market_value: 50_000, uci_points: 10, ai_team_id: null, acquired_at: null, created_at: "2026-01-01",
      })),
      { id: "fa1", firstname: "Filler", lastname: "Hi", team_id: null, market_value: 200_000, uci_points: 1, ai_team_id: null },
    ],
  });

  const emergencyLoanCalls = [];
  const result = await enforceTeamSquadCompliance({
    supabase,
    teamId: "t1",
    seasonId: null,
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async (teamId, amount, _client, _seasonId) => {
      emergencyLoanCalls.push({ teamId, amount });
      // Simulér at lånet krediterer kontoen
      const team = supabase.state.teams.find(t => t.id === teamId);
      team.balance += amount;
    },
    now: new Date("2026-05-04T12:00:00Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "auto_purchased");
  // Pris = 200_000 * 1.5 = 300_000. Balance = 10_000. Shortfall = 290_000.
  assert.equal(emergencyLoanCalls.length, 1);
  assert.equal(emergencyLoanCalls[0].teamId, "t1");
  assert.equal(emergencyLoanCalls[0].amount, 290_000);
});

test("enforceTeamSquadCompliance: AI-hold skippes", async () => {
  const supabase = createMockSupabase({
    teams: [{ id: "ai1", name: "AI Team", balance: 0, division: 3, user_id: null, is_ai: true, is_bank: false }],
    riders: [],
  });

  const result = await enforceTeamSquadCompliance({
    supabase,
    teamId: "ai1",
    seasonId: null,
    notifyTeamOwner: async () => { throw new Error("Should not notify AI"); },
    createEmergencyLoanFn: async () => { throw new Error("Should not loan AI"); },
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "skipped_non_human");
});

test("enforceTeamSquadCompliance: frosset hold skippes (ingen auto-køb, ingen bøde)", async () => {
  // Reproducerer prod-scenarie 2026-05-21: 4 frosne hold (Inuit + 3 test-hold)
  // har 0 ryttere. Uden is_frozen-skip ville cron forsøge at auto-købe 8 ryttere
  // hver á 150% market value + 8 × 100K bøde — direkte i strid med v3.80
  // freeze-feature (admin har eksplicit ekskluderet dem fra sæson-flowet).
  const supabase = createMockSupabase({
    teams: [{
      id: "frozen1", name: "Inuit Cycling", balance: 800_000, division: 3,
      user_id: "u-inuit", is_ai: false, is_bank: false, is_frozen: true,
    }],
    riders: [], // 0 ryttere — ville udløse auto-køb hvis frozen ikke skippes
  });

  const result = await enforceTeamSquadCompliance({
    supabase,
    teamId: "frozen1",
    seasonId: "season-1",
    notifyTeamOwner: async () => { throw new Error("Should not notify frozen team"); },
    createEmergencyLoanFn: async () => { throw new Error("Should not loan frozen team"); },
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "skipped_frozen");
  assert.equal(supabase.state.financeTransactions.length, 0);
  assert.equal(supabase.state.notifications.length, 0);
  assert.equal(supabase.state.riderUpdates.length, 0);
});

test("processSquadEnforcementCron: atomic claim sætter completed_at + iter alle teams", async () => {
  const supabase = createMockSupabase({
    teams: [
      { id: "t1", name: "A", balance: 5_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false, is_frozen: false },
      { id: "t2", name: "B", balance: 5_000_000, division: 3, user_id: "u2", is_ai: false, is_bank: false, is_frozen: false },
      { id: "ai1", name: "AI", balance: 0, division: 3, user_id: null, is_ai: true, is_bank: false, is_frozen: false },
    ],
    riders: [
      // t1 har 9 ryttere — inden for limits
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `t1-r${i}`, team_id: "t1", firstname: "F", lastname: `${i}`,
        market_value: 50_000, uci_points: 10, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
      })),
      // t2 har 5 ryttere — under min
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `t2-r${i}`, team_id: "t2", firstname: "F", lastname: `${i}`,
        market_value: 50_000, uci_points: 10, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
      })),
      // Fri agents til auto-køb
      { id: "fa1", firstname: "F1", lastname: "L", team_id: null, market_value: 20_000, uci_points: 1, ai_team_id: null },
      { id: "fa2", firstname: "F2", lastname: "L", team_id: null, market_value: 20_000, uci_points: 2, ai_team_id: null },
      { id: "fa3", firstname: "F3", lastname: "L", team_id: null, market_value: 20_000, uci_points: 3, ai_team_id: null },
    ],
    transferWindows: [
      { id: "w1", season_id: "season-1", status: "closed", closed_at: "2026-05-04T11:00:00Z", squad_enforcement_completed_at: null, created_at: "2026-05-04" },
    ],
  });

  const result = await processSquadEnforcementCron({
    supabase,
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04T12:00:00Z"),
  });

  assert.equal(result.claimed, true);
  assert.equal(result.windowId, "w1");
  assert.equal(result.enforced, 1); // kun t2 var afvigende

  // Atomic claim er sat
  assert.ok(supabase.state.transferWindows[0].squad_enforcement_completed_at != null);

  // 2. kald skal være no-op (claim allerede sat)
  const second = await processSquadEnforcementCron({
    supabase,
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04T12:01:00Z"),
  });

  assert.equal(second.claimed, false);
  assert.equal(second.enforced, 0);
});

test("processSquadEnforcementCron: frosne hold inkluderes IKKE i load → ingen forced-purchases", async () => {
  // Forward-guard mod prod-scenarie 2026-05-21: cron-filter skal ekskludere
  // is_frozen=true så frosne hold (0 ryttere) ikke ender i loop'et i første sted.
  const supabase = createMockSupabase({
    teams: [
      { id: "active1", name: "Active", balance: 5_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false, is_frozen: false },
      { id: "frozen1", name: "Inuit", balance: 800_000, division: 3, user_id: "u-inuit", is_ai: false, is_bank: false, is_frozen: true },
      { id: "frozen2", name: "test-a", balance: 800_000, division: 3, user_id: "u-test", is_ai: false, is_bank: false, is_frozen: true },
    ],
    riders: Array.from({ length: 9 }, (_, i) => ({
      id: `r${i}`, team_id: "active1", firstname: "F", lastname: `${i}`,
      market_value: 50_000, uci_points: 10, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
    })),
    transferWindows: [
      { id: "w1", season_id: "season-1", status: "closed", closed_at: "2026-05-21T21:00:00Z", squad_enforcement_completed_at: null, created_at: "2026-05-21" },
    ],
  });

  const result = await processSquadEnforcementCron({
    supabase,
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-21T21:05:00Z"),
  });

  assert.equal(result.claimed, true);
  assert.equal(result.enforced, 0);
  // Vigtigst: hverken frosset hold blev tilgået for snapshot/notifikation/state-mutation
  assert.equal(supabase.state.financeTransactions.length, 0);
  assert.equal(supabase.state.notifications.length, 0);
  assert.equal(supabase.state.riderUpdates.length, 0);
});

test("processSquadEnforcementCron: racing-window (closed_at=null) springes over (regression: sæson-loop 2026-05-21)", async () => {
  // Racing-vindue: status='closed' fra fødslen, men closed_at=null fordi det aldrig
  // gennemgik fireAutoCloseIfDue. Cron'en MÅ IKKE claime eller enforce noget på det.
  const supabase = createMockSupabase({
    teams: [
      { id: "t1", name: "A", balance: 5_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false, is_frozen: false },
    ],
    riders: [],
    transferWindows: [
      // Racing-window: closed_at=null
      { id: "racing", season_id: "season-2", status: "closed", closed_at: null, squad_enforcement_completed_at: null, created_at: "2026-05-21T22:00:00Z" },
    ],
  });

  const result = await processSquadEnforcementCron({
    supabase,
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-21T22:05:00Z"),
  });

  assert.equal(result.claimed, false);
  assert.equal(result.enforced, 0);
  // squad_enforcement_completed_at MÅ IKKE være sat — racing-window er urørt
  assert.equal(supabase.state.transferWindows[0].squad_enforcement_completed_at, null);
});

test("konstanter matcher spec", () => {
  assert.equal(SQUAD_FINE_AMOUNT, 100_000);
  assert.equal(SQUAD_PENALTY_POINTS, 200);
  assert.equal(SQUAD_PURCHASE_MARKUP, 1.5);
});
