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
    seasonStandings: [...(initialState.seasonStandings || [])],
    transferWindows: [...(initialState.transferWindows || [])],
    transferListings: [...(initialState.transferListings || [])],
    seasons: [...(initialState.seasons || [])],
    financeTransactions: [],
    notifications: [],
    riderUpdates: [],
    teamUpdates: [],
    listingUpdates: [],
    emergencyLoans: [],
  };

  function teamById(id) {
    return state.teams.find(t => t.id === id);
  }

  function _ridersByTeamId(id) {
    return state.riders.filter(r => r.team_id === id);
  }

  function from(table) {
    if (table === "teams") return teamsTable();
    if (table === "riders") return ridersTable();
    if (table === "season_standings") return seasonStandingsTable();
    if (table === "transfer_windows") return transferWindowsTable();
    if (table === "transfer_listings") return transferListingsTable();
    if (table === "finance_transactions") return financeTransactionsTable();
    if (table === "notifications") return notificationsTable();
    if (table === "seasons") return seasonsTable();
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
                // #1308: is_academy defaults to false når feltet ikke er sat på test-ryttere
                const rVal = (k === "is_academy" && r[k] === undefined) ? false : r[k];
                if (rVal !== v) return false;
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
        // Filter-chain: .eq().is().or() — alle akkumuleres, anvendes ved .select() eller await.
        const filters = { eq: [], is: [], or: null };
        function apply() {
          let window = state.transferWindows.find(w => {
            for (const [col, val] of filters.eq) {
              if (w[col] !== val) return false;
            }
            for (const [col, val] of filters.is) {
              if (val === null && w[col] != null) return false;
              if (val !== null && w[col] !== val) return false;
            }
            if (filters.or) {
              // Parse "col.op.val,col.op.val" — OR mellem dem.
              const clauses = filters.or.split(",");
              let anyMatch = false;
              for (const clause of clauses) {
                const [col, op, ...valParts] = clause.split(".");
                const val = valParts.join(".");
                if (op === "is" && val === "null") {
                  if (w[col] == null) { anyMatch = true; break; }
                } else if (op === "lt") {
                  if (w[col] != null && w[col] < val) { anyMatch = true; break; }
                }
              }
              if (!anyMatch) return false;
            }
            return true;
          });
          if (!window) return [];
          Object.assign(window, payload);
          return [{ id: window.id }];
        }
        const builder = {
          eq(col, val) { filters.eq.push([col, val]); return builder; },
          is(col, val) { filters.is.push([col, val]); return builder; },
          or(condString) { filters.or = condString; return builder; },
          select() {
            return Promise.resolve({ data: apply(), error: null });
          },
          // Thenable: tillader await uden .select() (returnerer { error })
          then(resolve) {
            apply();
            resolve({ data: null, error: null });
          },
        };
        return builder;
      },
    };
  }

  // #776/#822: auto-salg lukker åbne transfer_listings via
  // update({status}).in("rider_id", [...]).in("status", ["open","negotiating"]).
  function transferListingsTable() {
    return {
      update(payload) {
        const filters = {};
        const builder = {
          in(col, vals) {
            filters[col] = vals;
            return builder;
          },
          then(resolve) {
            const riderIds = filters.rider_id || [];
            const statuses = filters.status || [];
            const matches = state.transferListings.filter(
              l => riderIds.includes(l.rider_id) && statuses.includes(l.status)
            );
            for (const listing of matches) Object.assign(listing, payload);
            state.listingUpdates.push({ payload, riderIds, statuses });
            resolve({ data: null, error: null });
          },
        };
        return builder;
      },
    };
  }

  // #1309: fetchActiveSeasonNumber bruger .select().eq().order().limit().maybeSingle()
  function seasonsTable() {
    const filters = {};
    const builder = {
      select(_cols) { return builder; },
      eq(col, val) { filters[col] = val; return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle: () => {
        const row = state.seasons.find(s => Object.entries(filters).every(([k, v]) => s[k] === v));
        return Promise.resolve({ data: row || null, error: null });
      },
    };
    return builder;
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
  // Simulerer uniq_finance_idempotency_key UNIQUE-constraint: hvis idempotency_key
  // findes i payload + en row med samme key allerede er i financeTransactions,
  // returneres { error: { code: '23505' } } svarende til Postgres unique-violation.
  function rpc(name, params) {
    if (name !== "increment_balance_with_audit") {
      throw new Error(`Unexpected rpc: ${name}`);
    }
    const idempotencyKey = params.p_finance_payload?.idempotency_key;
    if (idempotencyKey) {
      const existing = state.financeTransactions.find(
        t => t.idempotency_key === idempotencyKey
      );
      if (existing) {
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate idempotency_key" } });
      }
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
      market_value: 50_000, ai_team_id: null, acquired_at: null, created_at: "2026-01-01",
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
        market_value: 50_000, ai_team_id: null, acquired_at: null, created_at: "2026-01-01",
      })),
      // Fri agents — sorteres efter market_value ASC (#1205)
      { id: "fa1", firstname: "Cheap", lastname: "Filler1", team_id: null, market_value: 20_000, ai_team_id: null },
      { id: "fa2", firstname: "Cheap", lastname: "Filler2", team_id: null, market_value: 20_100, ai_team_id: null },
      { id: "fa3", firstname: "Cheap", lastname: "Filler3", team_id: null, market_value: 20_200, ai_team_id: null },
      { id: "fa4", firstname: "Skip", lastname: "Me", team_id: null, market_value: 60_000, ai_team_id: null },
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
    // Prod har min=0 (intet floor); injicér min>0 for at dække auto-køb-maskineriet.
    limitsOverride: { min: 8, max: 10 },
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
  // #666: EN strings, no thousands separator (frontend formatNumber adds locale-aware separator).
  assert.match(notifications[0].message, /Auto-purchased 3 riders/);
  assert.match(notifications[0].message, /300000 CZ\$/);
  assert.match(notifications[0].message, /600 points/);
});

test("enforceTeamSquadCompliance: D3 hold med 32 ryttere → auto-sælg 2 + 200K bøde + 400p fradrag", async () => {
  const supabase = createMockSupabase({
    teams: [{ id: "t1", name: "Test", balance: 1_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: Array.from({ length: 32 }, (_, i) => ({
      id: `r${i}`,
      firstname: "Rider",
      lastname: `${i}`,
      team_id: "t1",
      market_value: 100_000,
      ai_team_id: i < 30 ? null : "ai-team",
      // Stigende acquired_at — hver rytter har unikt timestamp; r30 og r31 er nyest
      acquired_at: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
      created_at: "2026-01-01",
    })),
    seasonStandings: [
      { id: "s1", season_id: "season-1", team_id: "t1", division: 3, total_points: 500, penalty_points: 50 },
    ],
    // #776/#822: r31 står til salg på transfermarkedet — auto-salget skal
    // lukke listingen, ellers bliver den en zombie ("til salg" uden ejer).
    transferListings: [
      { id: "tl-1", rider_id: "r31", seller_team_id: "t1", status: "open" },
      { id: "tl-2", rider_id: "r5", seller_team_id: "t1", status: "open" },
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
  // De nyeste (r30, r31) bliver solgt
  const soldIds = result.sales.map(s => s.riderId).sort();
  assert.deepEqual(soldIds, ["r30", "r31"]);
  assert.equal(result.fineAmount, 200_000);
  assert.equal(result.penaltyPoints, 400);

  // r30 og r31 har ai_team_id="ai-team" → returneret dér
  const r30 = supabase.state.riders.find(r => r.id === "r30");
  assert.equal(r30.team_id, "ai-team");

  // #776/#822: r31's åbne listing lukkes som 'sold'; r5 (ikke solgt) forbliver åben.
  assert.equal(supabase.state.transferListings.find(l => l.id === "tl-1").status, "sold");
  assert.equal(supabase.state.transferListings.find(l => l.id === "tl-2").status, "open");

  // Akkumuleret penalty (50 + 400 = 450)
  assert.equal(supabase.state.seasonStandings[0].penalty_points, 450);
});

test("enforceTeamSquadCompliance: utilstrækkelig balance → nødlån oprettes", async () => {
  const supabase = createMockSupabase({
    teams: [{ id: "t1", name: "Test", balance: 10_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `r${i}`, team_id: "t1", firstname: "F", lastname: `${i}`,
        market_value: 50_000, ai_team_id: null, acquired_at: null, created_at: "2026-01-01",
      })),
      { id: "fa1", firstname: "Filler", lastname: "Hi", team_id: null, market_value: 200_000, ai_team_id: null },
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
    // Prod har min=0 (intet floor); injicér min>0 for at dække nødlån-stien.
    limitsOverride: { min: 8, max: 10 },
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

test("enforceTeamSquadCompliance: prod-default (min=0) → tomt hold er no-op (ingen tvangskøb/bøde)", async () => {
  // Roster-floor fjernet 2026-06-05: uden limitsOverride bruges division-konfig
  // (min=0), så selv et hold med 0 ryttere er "inden for limits" — ingen auto-køb,
  // ingen bøde. Låser at floorّen reelt er væk på den sti cron'en kører i prod.
  const supabase = createMockSupabase({
    teams: [{ id: "t1", name: "Tom", balance: 5_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: [],
  });

  const result = await enforceTeamSquadCompliance({
    supabase,
    teamId: "t1",
    seasonId: "season-1",
    notifyTeamOwner: async () => { throw new Error("Should not notify — min=0, intet floor"); },
    createEmergencyLoanFn: async () => { throw new Error("Should not loan — min=0, intet floor"); },
    now: new Date("2026-05-04T12:00:00Z"),
    // limitsOverride bevidst udeladt → division-default (min=0).
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "within_limits");
  assert.equal(result.totalCount, 0);
  assert.equal(supabase.state.financeTransactions.length, 0);
  assert.equal(supabase.state.notifications.length, 0);
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
        market_value: 50_000, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
      })),
      // t2 har 5 ryttere — under min
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `t2-r${i}`, team_id: "t2", firstname: "F", lastname: `${i}`,
        market_value: 50_000, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
      })),
      // Fri agents til auto-køb
      { id: "fa1", firstname: "F1", lastname: "L", team_id: null, market_value: 20_000, ai_team_id: null },
      { id: "fa2", firstname: "F2", lastname: "L", team_id: null, market_value: 20_100, ai_team_id: null },
      { id: "fa3", firstname: "F3", lastname: "L", team_id: null, market_value: 20_200, ai_team_id: null },
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
    limitsOverride: { min: 8, max: 10 }, // prod min=0; injicér min>0 så t2 (5 ryttere) er afvigende
  });

  assert.equal(result.claimed, true);
  assert.equal(result.windowId, "w1");
  assert.equal(result.wasResume, false);
  assert.equal(result.enforced, 1); // kun t2 var afvigende

  // #606: begge claim-faser er sat efter normal flow
  assert.ok(supabase.state.transferWindows[0].squad_enforcement_started_at != null);
  assert.ok(supabase.state.transferWindows[0].squad_enforcement_completed_at != null);

  // 2. kald skal være no-op (claim allerede completed)
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
      market_value: 50_000, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
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

// ─── #606 partial-failure recovery tests ────────────────────────────────────

test("processSquadEnforcementCron: stale started_at + completed_at null → replay claim'er + completer", async () => {
  // Scenarie: 1. tick claim'ede started_at men crashede før completed_at.
  // 2. tick (15 min senere) ser stale claim → re-claim + replay loopen.
  // Per-team self-idempotency: t2 var allerede mid-purchase men ikke fået fine endnu;
  // replay ser t2 med 5 ryttere stadig → fortsætter purchase. Per-team idempotency_key
  // på fine'n sikrer at hvis t2 HAVDE fået fine, ville den ikke double-fine.
  const stalledStartedAt = "2026-05-04T11:45:00Z"; // 15 min før now → stale (>10min)
  const supabase = createMockSupabase({
    teams: [
      { id: "t2", name: "B", balance: 5_000_000, division: 3, user_id: "u2", is_ai: false, is_bank: false, is_frozen: false },
    ],
    riders: [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `t2-r${i}`, team_id: "t2", firstname: "F", lastname: `${i}`,
        market_value: 50_000, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
      })),
      { id: "fa1", firstname: "F1", lastname: "L", team_id: null, market_value: 20_000, ai_team_id: null },
      { id: "fa2", firstname: "F2", lastname: "L", team_id: null, market_value: 20_100, ai_team_id: null },
      { id: "fa3", firstname: "F3", lastname: "L", team_id: null, market_value: 20_200, ai_team_id: null },
    ],
    transferWindows: [
      {
        id: "w1", season_id: "season-1", status: "closed",
        closed_at: "2026-05-04T11:00:00Z",
        squad_enforcement_started_at: stalledStartedAt,
        squad_enforcement_completed_at: null,
        created_at: "2026-05-04",
      },
    ],
  });

  const result = await processSquadEnforcementCron({
    supabase,
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04T12:00:00Z"), // 15 min efter stalled start
    limitsOverride: { min: 8, max: 10 }, // prod min=0; injicér min>0 så t2 (5 ryttere) replay-enforces
  });

  assert.equal(result.claimed, true);
  assert.equal(result.wasResume, true, "wasResume skal være true når stale started_at overwrittes");
  assert.equal(result.enforced, 1);

  // Begge claim-faser er sat efter replay
  const w = supabase.state.transferWindows[0];
  assert.ok(w.squad_enforcement_started_at != null);
  assert.notEqual(w.squad_enforcement_started_at, stalledStartedAt, "started_at skal være overwritten med now");
  assert.ok(w.squad_enforcement_completed_at != null);
});

test("processSquadEnforcementCron: fresh started_at (ikke stale) → 2. tick får concurrent_claim skip", async () => {
  // 1. tick er midt i loop. 2. tick fyrer 5 min senere men started_at er stadig <10min.
  // 2. tick skal IKKE re-claim windowet — vi vil ikke double-up purchases under aktiv tick.
  const freshStartedAt = "2026-05-04T11:55:00Z"; // 5 min før now (ikke stale)
  const supabase = createMockSupabase({
    teams: [
      { id: "t2", name: "B", balance: 5_000_000, division: 3, user_id: "u2", is_ai: false, is_bank: false, is_frozen: false },
    ],
    riders: Array.from({ length: 5 }, (_, i) => ({
      id: `t2-r${i}`, team_id: "t2", firstname: "F", lastname: `${i}`,
      market_value: 50_000, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
    })),
    transferWindows: [
      {
        id: "w1", season_id: "season-1", status: "closed",
        closed_at: "2026-05-04T11:00:00Z",
        squad_enforcement_started_at: freshStartedAt,
        squad_enforcement_completed_at: null,
        created_at: "2026-05-04",
      },
    ],
  });

  const result = await processSquadEnforcementCron({
    supabase,
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04T12:00:00Z"),
  });

  assert.equal(result.claimed, false);
  assert.equal(result.reason, "concurrent_claim");
  assert.equal(result.enforced, 0);
  // started_at urørt — anden tick "vinder" som var den live
  assert.equal(supabase.state.transferWindows[0].squad_enforcement_started_at, freshStartedAt);
  assert.equal(supabase.state.transferWindows[0].squad_enforcement_completed_at, null);
});

test("enforceTeamSquadCompliance: fine får idempotency_key=squad_fine:${windowId}:${teamId}", async () => {
  // Bekræfter at windowId bobler korrekt ned til applyFinesAndPenalty og sættes som
  // idempotency_key på squad_violation_fine. Replay-safety verificeres end-to-end i
  // næste test (replay med samme windowId).
  const supabase = createMockSupabase({
    teams: [{ id: "t1", name: "Test", balance: 5_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `r${i}`, team_id: "t1", firstname: "F", lastname: `${i}`,
        market_value: 50_000, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
      })),
      { id: "fa1", firstname: "F1", lastname: "L", team_id: null, market_value: 20_000, ai_team_id: null },
      { id: "fa2", firstname: "F2", lastname: "L", team_id: null, market_value: 20_100, ai_team_id: null },
      { id: "fa3", firstname: "F3", lastname: "L", team_id: null, market_value: 20_200, ai_team_id: null },
    ],
    seasonStandings: [
      { id: "s1", season_id: "season-1", team_id: "t1", division: 3, total_points: 1000, penalty_points: 0 },
    ],
  });

  const result = await enforceTeamSquadCompliance({
    supabase,
    teamId: "t1",
    seasonId: "season-1",
    windowId: "w1",
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04T12:00:00Z"),
    limitsOverride: { min: 8, max: 10 }, // prod min=0; injicér min>0 for at trigge fine-stien
  });

  assert.equal(result.code, "auto_purchased");
  assert.equal(result.fineAmount, 300_000);

  const fineTx = supabase.state.financeTransactions.find(t => t.type === "squad_violation_fine");
  assert.ok(fineTx, "fine skal være registreret");
  assert.equal(fineTx.idempotency_key, "squad_fine:w1:t1");
});

test("enforceTeamSquadCompliance: uden windowId → idempotency_key=null (backwards-kompatibel kald-path)", async () => {
  // Sikrer at non-cron callsites (admin tools, scripts, framework-tests) der kalder
  // enforceTeamSquadCompliance uden windowId stadig fungerer og bare ikke får
  // idempotency-håndhævelse. allowDuplicate=false så duplicate kald ville fejle.
  const supabase = createMockSupabase({
    teams: [{ id: "t1", balance: 5_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `r${i}`, team_id: "t1", firstname: "F", lastname: `${i}`,
        market_value: 50_000, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
      })),
      { id: "fa1", firstname: "F1", lastname: "L", team_id: null, market_value: 20_000, ai_team_id: null },
      { id: "fa2", firstname: "F2", lastname: "L", team_id: null, market_value: 20_100, ai_team_id: null },
      { id: "fa3", firstname: "F3", lastname: "L", team_id: null, market_value: 20_200, ai_team_id: null },
    ],
    seasonStandings: [
      { id: "s1", season_id: "season-1", team_id: "t1", division: 3, total_points: 1000, penalty_points: 0 },
    ],
  });

  const result = await enforceTeamSquadCompliance({
    supabase, teamId: "t1", seasonId: "season-1",
    notifyTeamOwner: async () => {}, createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04T12:00:00Z"),
    limitsOverride: { min: 8, max: 10 }, // prod min=0; injicér min>0 for at trigge fine-stien
  });

  assert.equal(result.code, "auto_purchased");
  const fineTx = supabase.state.financeTransactions.find(t => t.type === "squad_violation_fine");
  assert.ok(fineTx);
  assert.equal(fineTx.idempotency_key, null, "ingen windowId → ingen idempotency-håndhævelse");
});

test("processSquadEnforcementCron: replay med samme windowId → fines er idempotente via 23505", async () => {
  // Sætter scenariet op manuelt: et team som STADIG er afvigende selv efter første tick
  // (fx purchase fejlede så fine'n blev applied men ridercount ikke ændret). Replay vil
  // forsøge applyFinesAndPenalty igen og skal få 23505 fra idempotency_key.
  const supabase = createMockSupabase({
    teams: [{ id: "t1", balance: 5_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false, is_frozen: false }],
    riders: Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`, team_id: "t1", firstname: "F", lastname: `${i}`,
      market_value: 50_000, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
    })),
    seasonStandings: [
      { id: "s1", season_id: "season-1", team_id: "t1", division: 3, total_points: 1000, penalty_points: 0 },
    ],
    transferWindows: [
      {
        id: "w1", season_id: "season-1", status: "closed",
        closed_at: "2026-05-04T11:00:00Z",
        squad_enforcement_started_at: "2026-05-04T11:45:00Z", // stale (>10 min)
        squad_enforcement_completed_at: null,
        created_at: "2026-05-04",
      },
    ],
  });

  // Pre-seed: simulér at fine ALLEREDE var applied i en tidligere stalled tick
  supabase.state.financeTransactions.push({
    team_id: "t1",
    type: "squad_violation_fine",
    amount: -300_000,
    idempotency_key: "squad_fine:w1:t1",
  });
  // Penalty_points fra første tick — replay skal IKKE add 600 mere
  supabase.state.seasonStandings[0].penalty_points = 600;

  const result = await processSquadEnforcementCron({
    supabase,
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04T12:00:00Z"), // 15 min efter stale
    limitsOverride: { min: 8, max: 10 }, // prod min=0; injicér min>0 så t1 (5 ryttere) rammer fine-replay-stien
  });

  assert.equal(result.claimed, true);
  assert.equal(result.wasResume, true);

  // Fine'n må ikke være duplikeret
  const fines = supabase.state.financeTransactions.filter(t => t.type === "squad_violation_fine");
  assert.equal(fines.length, 1, "kun én squad_violation_fine row (idempotency_key blokerede duplicate)");

  // Penalty_points må ikke være double-incremented
  assert.equal(supabase.state.seasonStandings[0].penalty_points, 600, "penalty_points må ikke double-incremente ved replay");
});

// ─── #1309 kontrakt-on-acquire regression tests ──────────────────────────────

test("#1309: auto-køb af kontraktløs free agent sætter kontrakt (salary, contract_length, contract_end_season)", async () => {
  // Reproducerer den fundne gap: cron auto-køber en free agent der har salary=null
  // (efter relaunch). Invarianten "ejede ryttere har altid salary != null" skal holde.
  const supabase = createMockSupabase({
    teams: [{ id: "t1", name: "Test", balance: 5_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `r${i}`, firstname: "Owned", lastname: `R${i}`, team_id: "t1",
        market_value: 50_000, ai_team_id: null, acquired_at: null, created_at: "2026-01-01",
        salary: 100, base_value: 1000, prize_earnings_bonus: 0,
      })),
      // Free agent: kontraktløs (salary=null) — post-relaunch state
      {
        id: "fa1", firstname: "Free", lastname: "Agent", team_id: null,
        market_value: 20_000, ai_team_id: null,
        salary: null, base_value: 5000, prize_earnings_bonus: 200,
      },
    ],
    seasons: [{ id: "season-1", number: 3, status: "active" }],
    seasonStandings: [
      { id: "s1", season_id: "season-1", team_id: "t1", division: 3, total_points: 1000, penalty_points: 0 },
    ],
  });

  const result = await enforceTeamSquadCompliance({
    supabase,
    teamId: "t1",
    seasonId: "season-1",
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04T12:00:00Z"),
    limitsOverride: { min: 8, max: 10 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "auto_purchased");
  assert.equal(result.purchases.length, 1);

  const fa1 = supabase.state.riders.find(r => r.id === "fa1");
  assert.equal(fa1.team_id, "t1", "free agent skal have fået nyt team_id");

  // Kontrakt-invarianten: salary != null efter auto-køb
  assert.ok(fa1.salary != null, "salary må ikke være null efter auto-køb");

  // computeFrozenSalary({ base_value: 5000, prize_earnings_bonus: 200 })
  // = Math.max(1, Math.round((5000 + 200) * 0.067)) = Math.max(1, 348) = 348
  assert.equal(fa1.salary, 348, "salary = computeFrozenSalary(base_value=5000, prize_earnings_bonus=200)");
  assert.equal(fa1.contract_length, 2, "DEFAULT_ACQUIRE_LENGTH = 2");
  // contract_end_season = startSeason + length - 1 = 3 + 2 - 1 = 4
  assert.equal(fa1.contract_end_season, 4, "contract_end_season = activeSeasonNumber(3) + length(2) - 1 = 4");
});

test("#1309: auto-køb af allerede-kontrakteret rytter (AI-ejet) arver eksisterende kontrakt uændret", async () => {
  // Rytter ejet af et AI-hold med eksisterende kontrakt: contractOnAcquirePatch({salary != null})
  // returnerer {} → ingen kontrakt-override.
  const supabase = createMockSupabase({
    teams: [
      { id: "t1", name: "Human", balance: 5_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false },
      { id: "ai-team", name: "AI", balance: 0, division: 3, user_id: null, is_ai: true, is_bank: false },
    ],
    riders: [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `r${i}`, firstname: "Owned", lastname: `R${i}`, team_id: "t1",
        market_value: 50_000, ai_team_id: null, acquired_at: null, created_at: "2026-01-01",
        salary: 100, base_value: 1000, prize_earnings_bonus: 0,
      })),
      // AI-ejet rytter med eksisterende kontrakt
      {
        id: "ai-rider", firstname: "AI", lastname: "Rider", team_id: "ai-team",
        ai_team_id: "ai-team", market_value: 20_000,
        salary: 999, base_value: 9000, prize_earnings_bonus: 900,
        contract_length: 3, contract_end_season: 7,
      },
    ],
    seasons: [{ id: "season-1", number: 3, status: "active" }],
    seasonStandings: [
      { id: "s1", season_id: "season-1", team_id: "t1", division: 3, total_points: 1000, penalty_points: 0 },
    ],
  });

  await enforceTeamSquadCompliance({
    supabase,
    teamId: "t1",
    seasonId: "season-1",
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04T12:00:00Z"),
    limitsOverride: { min: 8, max: 10 },
  });

  const aiRider = supabase.state.riders.find(r => r.id === "ai-rider");
  assert.equal(aiRider.team_id, "t1", "AI-ejet rytter skal have fået nyt team_id");
  // Eksisterende kontrakt arves uændret (contractOnAcquirePatch returnerer {} ved salary != null)
  assert.equal(aiRider.salary, 999, "eksisterende salary arves uændret");
  assert.equal(aiRider.contract_length, 3, "eksisterende contract_length arves uændret");
  assert.equal(aiRider.contract_end_season, 7, "eksisterende contract_end_season arves uændret");
});

test("#1309: auto-køb fallback til sæson 1 hvis ingen aktiv sæson", async () => {
  // Edge-case: ingen aktiv sæson i DB → fetchActiveSeasonNumber returnerer 1 som default.
  const supabase = createMockSupabase({
    teams: [{ id: "t1", name: "Test", balance: 5_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `r${i}`, firstname: "Owned", lastname: `R${i}`, team_id: "t1",
        market_value: 50_000, ai_team_id: null, acquired_at: null, created_at: "2026-01-01",
        salary: 100, base_value: 1000, prize_earnings_bonus: 0,
      })),
      {
        id: "fa1", firstname: "Free", lastname: "Agent", team_id: null,
        market_value: 20_000, ai_team_id: null,
        salary: null, base_value: 1000, prize_earnings_bonus: 0,
      },
    ],
    seasons: [], // ingen aktiv sæson
    seasonStandings: [
      { id: "s1", season_id: "season-1", team_id: "t1", division: 3, total_points: 1000, penalty_points: 0 },
    ],
  });

  const result = await enforceTeamSquadCompliance({
    supabase,
    teamId: "t1",
    seasonId: "season-1",
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-05-04T12:00:00Z"),
    limitsOverride: { min: 8, max: 10 },
  });

  assert.equal(result.ok, true);
  const fa1 = supabase.state.riders.find(r => r.id === "fa1");
  assert.ok(fa1.salary != null, "salary sættes selv uden aktiv sæson");
  // contract_end_season = 1 (fallback) + 2 - 1 = 2
  assert.equal(fa1.contract_end_season, 2, "fallback sæson 1 → contract_end_season = 2");
});

// #1308: akademiryttere må ALDRIG auto-sælges ved transfervindue-luk.
// Scenarie: hold har 30 senior-ryttere + 3 akademiryttere → 33 i alt.
// Senior-cap = 30, så effectiveCount = 30 (akademiryttere er ekskluderet).
// Resultat: code = "within_limits", 0 auto-salg, 0 bøder.
test("#1308: akademiryttere tæller ikke mod senior-cap (0 auto-salg ved 30 senior + 3 akademi)", async () => {
  const supabase = createMockSupabase({
    teams: [{ id: "t1", name: "Senior+Akademi", balance: 1_000_000, division: 3, user_id: "u1", is_ai: false, is_bank: false }],
    riders: [
      // 30 senior-ryttere (is_academy udeladt = defaults til false via mock)
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `senior-${i}`,
        firstname: "Senior",
        lastname: `R${i}`,
        team_id: "t1",
        market_value: 100_000,
        ai_team_id: null,
        acquired_at: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
        created_at: "2026-01-01",
        // is_academy ikke sat → defaults til false i mock (#1308)
      })),
      // 3 akademiryttere
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `academy-${i}`,
        firstname: "Akademi",
        lastname: `Y${i}`,
        team_id: "t1",
        market_value: 30_000,
        ai_team_id: null,
        acquired_at: "2026-06-01T00:00:00Z",
        created_at: "2026-06-01",
        is_academy: true,
      })),
    ],
  });

  const result = await enforceTeamSquadCompliance({
    supabase,
    teamId: "t1",
    seasonId: null,
    notifyTeamOwner: async () => { throw new Error("Ingen notifikation forventet — holdet er inden for limits"); },
    createEmergencyLoanFn: async () => {},
    now: new Date("2026-06-13T12:00:00Z"),
    // ingen limitsOverride → division-default (max=30, min=0)
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "within_limits",
    "hold med 30 senior + 3 akademi skal være within_limits (akademi tæller ikke)");
  assert.equal(result.totalCount, 30,
    "effectiveCount = 30 (kun seniorer tæller)");
  assert.equal(supabase.state.riderUpdates.length, 0, "ingen akademiryttere må auto-sælges");
  assert.equal(supabase.state.financeTransactions.length, 0, "ingen bøde");

  // Forward-guard: ingen af de tre akademiryttere har fået ændret team_id
  for (let i = 0; i < 3; i++) {
    const academyRider = supabase.state.riders.find(r => r.id === `academy-${i}`);
    assert.equal(academyRider.team_id, "t1",
      `akademiryetter academy-${i} må ikke flyttes ved squad-enforcement`);
  }
});

test("processSquadEnforcementCron: per-team fail kalder captureExceptionFn med teamId+windowId+seasonId (Refs #614 P2-A)", async () => {
  // Hvis enforceTeamSquadCompliance throws (fx Supabase 503 mid-loop), skal Sentry-capture
  // fyres så ops ser fejlen i dashboardet — top-level trackedTick wrapper fanger kun den
  // FØRSTE fejl per tick.
  const supabase = createMockSupabase({
    teams: [
      { id: "t-ok", name: "OK", balance: 5_000_000, division: 3, user_id: "u-ok", is_ai: false, is_bank: false, is_frozen: false },
      { id: "t-fail", name: "Fail", balance: 5_000_000, division: 3, user_id: "u-fail", is_ai: false, is_bank: false, is_frozen: false },
    ],
    riders: Array.from({ length: 9 }, (_, i) => ({
      id: `t-ok-r${i}`, team_id: "t-ok", firstname: "F", lastname: `${i}`,
      market_value: 50_000, ai_team_id: null, acquired_at: "2026-01-01", created_at: "2026-01-01",
    })),
    transferWindows: [
      { id: "w-sentry", season_id: "season-1", status: "closed", closed_at: "2026-05-04T11:00:00Z", squad_enforcement_completed_at: null, created_at: "2026-05-04" },
    ],
  });

  // Wrap riders-table for at fejle på snapshot-load for t-fail
  const origFrom = supabase.from;
  supabase.from = (table) => {
    const t = origFrom(table);
    if (table === "teams") {
      const origSelect = t.select.bind(t);
      t.select = (cols) => {
        const builder = origSelect(cols);
        const origEq = builder.eq.bind(builder);
        builder.eq = (col, val) => {
          const chain = origEq(col, val);
          const origSingle = chain.single?.bind(chain);
          if (origSingle && col === "id" && val === "t-fail") {
            chain.single = () => Promise.reject(new Error("simulated Supabase 503 for t-fail"));
          }
          return chain;
        };
        return builder;
      };
    }
    return t;
  };

  const captureCalls = [];
  const result = await processSquadEnforcementCron({
    supabase,
    notifyTeamOwner: async () => {},
    createEmergencyLoanFn: async () => {},
    captureExceptionFn: (err, ctx) => { captureCalls.push({ err, ctx }); },
    now: new Date("2026-05-04T12:00:00Z"),
  });

  assert.equal(result.claimed, true);
  assert.equal(captureCalls.length, 1, "captureExceptionFn skal kaldes præcis én gang for den fejlende team");
  assert.equal(captureCalls[0].ctx.tags.cron, "squad-enforcement");
  assert.equal(captureCalls[0].ctx.extra.teamId, "t-fail");
  assert.equal(captureCalls[0].ctx.extra.windowId, "w-sentry");
  assert.equal(captureCalls[0].ctx.extra.seasonId, "season-1");
  // Window skal stadig completes selv om en team fejlede
  assert.ok(supabase.state.transferWindows[0].squad_enforcement_completed_at != null);
});
