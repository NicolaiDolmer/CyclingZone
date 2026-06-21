import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTransitionPlan,
  closePrevTransferWindow,
  computeSeasonUuid,
  computeTransferWindowUuid,
  insertTransferWindowIfMissing,
  resolveTransitionSourceSeason,
  transitionToNextSeason,
} from "./seasonTransition.js";

// ─── UUID helper tests (pure functions) ───────────────────────────────────────

test("computeSeasonUuid — sæson 0 maps to all-zero UUID", () => {
  assert.equal(computeSeasonUuid(0), "00000000-0000-0000-0000-000000000000");
});

test("computeSeasonUuid — sæson 1, 2, 16 use deterministic hex pattern", () => {
  assert.equal(computeSeasonUuid(1), "00000000-0000-0000-0000-000000000001");
  assert.equal(computeSeasonUuid(2), "00000000-0000-0000-0000-000000000002");
  assert.equal(computeSeasonUuid(16), "00000000-0000-0000-0000-000000000010");
});

test("computeSeasonUuid — rejects negative and non-integer input", () => {
  assert.throws(() => computeSeasonUuid(-1));
  assert.throws(() => computeSeasonUuid(1.5));
  assert.throws(() => computeSeasonUuid("1"));
});

test("computeTransferWindowUuid — sæson 0 → ...00000000aaaa", () => {
  assert.equal(computeTransferWindowUuid(0), "00000000-0000-0000-0000-00000000aaaa");
  assert.equal(computeTransferWindowUuid(1), "00000000-0000-0000-0000-00000001aaaa");
  assert.equal(computeTransferWindowUuid(16), "00000000-0000-0000-0000-00000010aaaa");
});

// ─── Mock Supabase factory ────────────────────────────────────────────────────

function createMockSupabase(initialState = {}) {
  const state = {
    seasons: initialState.seasons ? [...initialState.seasons] : [],
    transfer_windows: initialState.transfer_windows ? [...initialState.transfer_windows] : [],
    teams: initialState.teams ? [...initialState.teams] : [],
    season_standings: initialState.season_standings ? [...initialState.season_standings] : [],
    admin_log: initialState.admin_log ? [...initialState.admin_log] : [],
    notifications: initialState.notifications ? [...initialState.notifications] : [],
    sponsor_contracts: initialState.sponsor_contracts ? [...initialState.sponsor_contracts] : [],
  };
  const calls = { inserts: [], updates: [] };

  function chain(table, filters = {}, orderBy = null, limit = null) {
    return {
      eq(col, val) {
        return chain(table, { ...filters, [col]: val }, orderBy, limit);
      },
      // gte er en no-op i mocken (created_at-vindue findes ikke for in-memory
      // rows) — dedup matcher derfor på user/type/title/message/related_id, hvilket
      // er nok til at teste notifyUser-stien fra emitSeasonStartedNotifications.
      gte() {
        return chain(table, filters, orderBy, limit);
      },
      is(col, val) {
        return chain(table, { ...filters, [col]: val }, orderBy, limit);
      },
      order(col, opts) {
        return chain(table, filters, { col, asc: opts?.ascending ?? true }, limit);
      },
      limit(n) {
        return chain(table, filters, orderBy, n);
      },
      contains(col, criteria) {
        return chain(table, { ...filters, __contains: { col, criteria } }, orderBy, limit);
      },
      maybeSingle() {
        const rows = state[table].filter((row) => matchesFilters(row, filters));
        const ordered = orderBy
          ? [...rows].sort((a, b) => {
              const av = a[orderBy.col]; const bv = b[orderBy.col];
              if (av === bv) return 0;
              return orderBy.asc ? (av > bv ? 1 : -1) : (av > bv ? -1 : 1);
            })
          : rows;
        const first = ordered[0] ?? null;
        return Promise.resolve({ data: first, error: null });
      },
      single() {
        const rows = state[table].filter((row) => matchesFilters(row, filters));
        if (rows.length !== 1) {
          return Promise.resolve({ data: null, error: { message: `Expected 1 row, got ${rows.length}` } });
        }
        return Promise.resolve({ data: rows[0], error: null });
      },
      then(resolve) {
        // Direct await without terminal — return all matching rows.
        return resolve({
          data: state[table].filter((row) => matchesFilters(row, filters)),
          error: null,
        });
      },
    };
  }

  function matchesFilters(row, filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (k === "__contains") {
        const inner = row[v.col] || {};
        for (const [ik, iv] of Object.entries(v.criteria)) {
          if (inner[ik] !== iv) return false;
        }
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  }

  return {
    __state: state,
    __calls: calls,
    from(table) {
      return {
        select(_cols) {
          return chain(table);
        },
        insert(payload) {
          const row = Array.isArray(payload) ? payload[0] : payload;
          state[table].push({ ...row });
          calls.inserts.push({ table, row });
          return {
            select() {
              return {
                single: () => Promise.resolve({ data: row, error: null }),
              };
            },
            then(resolve) {
              return resolve({ error: null });
            },
          };
        },
        update(payload) {
          return {
            eq(col, val) {
              const matched = state[table].filter((r) => r[col] === val);
              for (const row of matched) Object.assign(row, payload);
              calls.updates.push({ table, payload, eq: { col, val } });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

// ─── Plan-builder tests ───────────────────────────────────────────────────────

test("buildTransitionPlan — sæson 0 → 1 plan med 22 humans, sponsor 340K hver (D3 intro-skaleret, #1441 A6)", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active", start_date: "2026-05-08", end_date: null }],
    transfer_windows: [],
    teams: Array.from({ length: 22 }, (_, i) => ({
      id: `team-${i}`,
      name: `Team ${i}`,
      sponsor_income: 240000,
      division: 3,
      is_ai: false,
      is_bank: false,
      is_frozen: false,
    })),
  });

  const plan = await buildTransitionPlan({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
  });

  assert.equal(plan.from_season.number, 0);
  assert.equal(plan.to_season.number, 1);
  assert.equal(plan.to_season.id, "00000000-0000-0000-0000-000000000001");
  assert.equal(plan.to_season.transfer_window_id, "00000000-0000-0000-0000-00000001aaaa");
  assert.equal(plan.teams_affected, 22);
  assert.equal(plan.sponsor_base_total, 22 * 340000); // #1441 A6: D3 260k → 340k
  assert.equal(plan.already_transitioned, false);
});

test("buildTransitionPlan — sæson 1 → 2 preview viser variabel sponsor", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "season-1", number: 1, status: "active", start_date: "2026-05-15", end_date: null }],
    teams: [
      { id: "team-1", name: "Top Team", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false },
      { id: "team-2", name: "Mid Team", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false },
      { id: "team-3", name: "Bottom Team", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false },
    ],
    season_standings: [
      { season_id: "season-1", team_id: "team-1", division: 3, total_points: 180, rank_in_division: 1 },
      { season_id: "season-1", team_id: "team-2", division: 3, total_points: 120, rank_in_division: 2 },
      { season_id: "season-1", team_id: "team-3", division: 3, total_points: 60, rank_in_division: 3 },
    ],
  });

  const plan = await buildTransitionPlan({
    supabase,
    fromSeasonId: "season-1",
  });

  assert.equal(plan.to_season.number, 2);
  // Alle tre hold er i division 3 → base 340k (#1441 A6: 260k→340k) + performance-variabel.
  // Top (rank 1) = 340k + 150k; mid (rank 2) = 340k + 75k; bund (rank 3) = 340k + 0.
  assert.equal(plan.sponsor_breakdown[0].sponsor_base, 490_000);
  assert.equal(plan.sponsor_breakdown[0].sponsor_mode, "variable");
  assert.equal(plan.sponsor_breakdown[1].sponsor_base, 415_000);
  assert.equal(plan.sponsor_breakdown[2].sponsor_base, 340_000);
  assert.equal(plan.sponsor_base_total, 1_245_000);
});

test("buildTransitionPlan — already_transitioned=true når sæson 1 allerede eksisterer", async () => {
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active", start_date: "2026-05-08" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active", start_date: "2026-05-09" },
    ],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  const plan = await buildTransitionPlan({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
  });
  assert.equal(plan.already_transitioned, true);
});

test("buildTransitionPlan — kaster fejl hvis fromSeason ikke 'active'", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed" }],
  });

  await assert.rejects(
    () => buildTransitionPlan({ supabase, fromSeasonId: "00000000-0000-0000-0000-000000000000" }),
    /must be 'active'/
  );
});

test("buildTransitionPlan — kaster fejl hvis fromSeason mangler", async () => {
  const supabase = createMockSupabase({ seasons: [] });
  await assert.rejects(
    () => buildTransitionPlan({ supabase, fromSeasonId: "missing-id" }),
    /not found/
  );
});

// ─── Dry-run tests ────────────────────────────────────────────────────────────

test("transitionToNextSeason — dry-run laver ingen writes", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    dryRun: true,
    deps: { processSeasonStart: async () => { throw new Error("dry-run må ikke kalde processSeasonStart"); } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.plan.from_season.number, 0);
  assert.equal(result.plan.to_season.number, 1);
  assert.equal(supabase.__calls.inserts.length, 0);
  assert.equal(supabase.__calls.updates.length, 0);
});

// ─── Real-run tests ───────────────────────────────────────────────────────────

test("transitionToNextSeason — real run udfører alle 6 faser", async () => {
  const sponsorCalls = [];
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    adminUserId: "admin-uuid",
    deps: {
      // #535: processSeasonStart returnerer nu { sponsor, payroll } i stedet
      // for ren sponsor-array. season_payroll-fase i return-log læser fra
      // payroll.summary.
      processSeasonStart: async (seasonId, _deps) => {
        sponsorCalls.push(seasonId);
        return {
          sponsor: [{ team: "T1", sponsor: 240000, recurring_loan_fees: 0, pullout_applied: false }],
          payroll: {
            results: [{ team: "T1", team_id: "t1", loan_interest: 0, salary: 0, emergency_loan_amount: 0, negative_balance_interest: 0 }],
            summary: {
              teams_processed: 1,
              loan_interest_count: 0,
              loan_interest_total: 0,
              salary_count: 0,
              salary_total: 0,
              emergency_loan_count: 0,
              emergency_loan_total: 0,
              negative_balance_interest_count: 0,
              negative_balance_interest_total: 0,
            },
          },
        };
      },
      notifySeasonEvent: async () => {},
      // #1663: kontrakt-fornyelse stubbet — egen unit-test dækker DB-laget.
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  // #535: 8 faser; #1357: +season_started_notifications; #1663: +sponsor_contracts_renewal = 10
  assert.equal(result.log.length, 10);
  assert.equal(result.log[0].phase, "insert_next_season");
  assert.equal(result.log[0].inserted, true);
  assert.equal(result.log[1].phase, "mark_previous_completed");
  assert.equal(result.log[1].updated, true);
  assert.equal(result.log[2].phase, "close_prev_transfer_window");
  assert.equal(result.log[2].updated, true);
  assert.equal(result.log[3].phase, "insert_next_transfer_window");
  assert.equal(result.log[3].inserted, true);
  assert.equal(result.log[4].phase, "sponsor_contracts_renewal");
  assert.equal(result.log[4].teams, 1);
  assert.equal(result.log[5].phase, "sponsor_payout");
  assert.equal(result.log[5].count, 1);
  assert.equal(result.log[6].phase, "season_payroll");
  assert.equal(result.log[6].teams_processed, 1);
  assert.equal(result.log[6].salary_count, 0);
  assert.equal(result.log[7].phase, "admin_log");
  assert.equal(result.log[7].inserted, true);
  assert.equal(result.log[8].phase, "discord_broadcast");
  assert.equal(result.log[8].sent, true);
  assert.equal(result.log[9].phase, "season_started_notifications");

  assert.deepEqual(sponsorCalls, ["00000000-0000-0000-0000-000000000001"]);

  const newSeason = supabase.__state.seasons.find((s) => s.number === 1);
  assert.ok(newSeason);
  assert.equal(newSeason.status, "active");
  assert.equal(newSeason.start_date, "2026-05-15T06:00:00.000Z");

  const oldSeason = supabase.__state.seasons.find((s) => s.number === 0);
  assert.equal(oldSeason.status, "completed");
  assert.equal(oldSeason.end_date, "2026-05-15T06:00:00.000Z");

  const newWindow = supabase.__state.transfer_windows.find((w) => w.id === "00000000-0000-0000-0000-00000001aaaa");
  assert.ok(newWindow);
  assert.equal(newWindow.status, "closed");

  const oldWindow = supabase.__state.transfer_windows.find((w) => w.id === "win-0");
  assert.equal(oldWindow.status, "closed");

  const adminEntry = supabase.__state.admin_log.find((e) => e.action_type === "season_transition");
  assert.ok(adminEntry);
  assert.equal(adminEntry.meta.from_season_number, 0);
  assert.equal(adminEntry.meta.to_season_number, 1);
});

// #1663 · Sponsor-kontrakter fornyes FØR sponsor-payout: hvert menneske-hold
// (is_ai=false, is_bank=false, is_frozen=false) får expireAndRenewContracts kaldt
// med den nye sæsons nummer + holdets id, og fasen kører før processSeasonStart.
test("transitionToNextSeason — fornyer sponsor-kontrakter før payout med nye sæsons nummer + menneske-hold", async () => {
  const order = [];
  let renewArgs = null;
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [
      { id: "human-1", name: "Human 1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false },
      { id: "human-2", name: "Human 2", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false },
      // Skal ekskluderes af samme diskriminator som processSeasonStart.
      { id: "ai-1", name: "AI", sponsor_income: 240000, division: 3, is_ai: true, is_bank: false, is_frozen: false },
      { id: "bank-1", name: "Bank", sponsor_income: 0, division: 3, is_ai: false, is_bank: true, is_frozen: false },
      { id: "frozen-1", name: "Frozen", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: true },
    ],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      expireAndRenewContracts: async (args) => { order.push("renew"); renewArgs = args; },
      processSeasonStart: async () => { order.push("seasonStart"); return { sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }; },
      notifySeasonEvent: async () => {},
    },
  });

  assert.equal(result.ok, true);
  // Fornyelse SKAL ske før season-start (ellers betaler payout en udløbet kontrakt).
  assert.deepEqual(order, ["renew", "seasonStart"]);
  assert.ok(renewArgs, "expireAndRenewContracts skal kaldes");
  assert.equal(renewArgs.newSeasonNumber, 1, "ny sæsons heltal = plan.to_season.number");
  assert.deepEqual(
    [...renewArgs.teamIds].sort(),
    ["human-1", "human-2"],
    "kun menneske-hold (ekskl. AI/bank/frozen)",
  );

  const renewalPhase = result.log.find((p) => p.phase === "sponsor_contracts_renewal");
  assert.ok(renewalPhase, "sponsor_contracts_renewal-fasen skal logges");
  assert.equal(renewalPhase.teams, 2);
});

// #805 · Board-test-exit: når afgående sæson kørte board_test_mode, nulstilles
// board-data via resetBetaBoardProfiles FØR processSeasonStart, så test-perioden
// ikke bærer økonomisk spor ind i den nye sæson.
test("transitionToNextSeason — nulstiller board-data når afgående window er i test-mode", async () => {
  const order = [];
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08", board_test_mode: true }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    adminUserId: "admin-uuid",
    deps: {
      resetBetaBoardProfiles: async () => { order.push("reset"); return { reset: 1, created: 1 }; },
      processSeasonStart: async () => { order.push("seasonStart"); return { sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }; },
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  const resetPhase = result.log.find((p) => p.phase === "reset_board_test_data");
  assert.ok(resetPhase, "reset_board_test_data-fasen skal være kørt");
  assert.equal(resetPhase.reset, 1);
  // Reset SKAL ske før season-start (ellers anvendes ikke-nulstillede modifiers).
  assert.deepEqual(order, ["reset", "seasonStart"]);
});

test("transitionToNextSeason — springer board-reset over når window ikke er i test-mode", async () => {
  const order = [];
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08", board_test_mode: false }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      resetBetaBoardProfiles: async () => { order.push("reset"); return { reset: 1 }; },
      processSeasonStart: async () => ({ sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }),
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log.find((p) => p.phase === "reset_board_test_data"), undefined);
  assert.deepEqual(order, [], "resetBetaBoardProfiles må ikke kaldes uden test-mode");
});

test("transitionToNextSeason — re-run efter delvis fejl skipper allerede-gjort arbejde", async () => {
  // Simuler: sæson 1 er allerede insertet, men transfer_window mangler.
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active", start_date: "2026-05-15" },
    ],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: { processSeasonStart: async () => [], notifySeasonEvent: async () => {}, expireAndRenewContracts: async () => {} },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log[0].skipped, true);
  assert.match(result.log[0].reason, /already exists/);
  // Andre faser skal stadig køre
  assert.equal(result.log[3].inserted, true);
});

test("transitionToNextSeason — fuld idempotens: re-run med alt færdig giver alle skipped", async () => {
  // Resume-support (#578): re-run med fromSeason='completed' og toSeason eksisterende
  // SKAL ikke kaste — alle faser detekterer at arbejdet er gjort og skipper. Tidligere
  // asserterede denne test at re-run kastede 'must be active', hvilket var dokumentation
  // af et faktisk reliability-gap (cron kunne ikke genoptage efter partial failure
  // efter mark_previous_completed).
  const transitionAt = "2026-05-15T06:00:00.000Z";
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed", end_date: transitionAt },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active", start_date: transitionAt },
    ],
    transfer_windows: [
      { id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "closed", created_at: "2026-05-08" },
      { id: "00000000-0000-0000-0000-00000001aaaa", season_id: "00000000-0000-0000-0000-000000000001", status: "closed", created_at: transitionAt },
    ],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
    admin_log: [{
      id: "log-1",
      action_type: "season_transition",
      meta: {
        from_season_id: "00000000-0000-0000-0000-000000000000",
        to_season_id: "00000000-0000-0000-0000-000000000001",
      },
    }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    deps: {
      processSeasonStart: async () => ({
        sponsor: [],
        payroll: {
          results: [],
          summary: {
            teams_processed: 0,
            loan_interest_count: 0, loan_interest_total: 0,
            salary_count: 0, salary_total: 0,
            emergency_loan_count: 0, emergency_loan_total: 0,
            negative_balance_interest_count: 0, negative_balance_interest_total: 0,
          },
        },
      }),
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log[0].phase, "insert_next_season");
  assert.equal(result.log[0].skipped, true, "sæson 1 eksisterer → skipped");
  assert.equal(result.log[1].phase, "mark_previous_completed");
  assert.equal(result.log[1].skipped, true, "sæson 0 allerede completed → skipped");
  assert.equal(result.log[2].phase, "close_prev_transfer_window");
  assert.equal(result.log[2].skipped, true, "win-0 allerede closed → skipped");
  assert.equal(result.log[3].phase, "insert_next_transfer_window");
  assert.equal(result.log[3].skipped, true, "sæson 1's window eksisterer → skipped");
  const adminLog = result.log.find((p) => p.phase === "admin_log");
  assert.ok(adminLog, "admin_log-fasen skal logges");
  assert.equal(adminLog.skipped, true, "admin_log-entry eksisterer → skipped");
  // Discord broadcaster altid (fire-and-forget, bruger har godkendt 1 ekstra besked)
  assert.ok(result.log.find((p) => p.phase === "discord_broadcast"));
});

test("transitionToNextSeason — resume efter partial failure efter mark_previous_completed (#578)", async () => {
  // Reliability-gap: simuler at fase 3 (mark_previous_completed) gik igennem,
  // men fase 4-7 fejlede. fromSeason er 'completed', toSeason er 'active',
  // men win-0 er stadig 'open', sæson 1's transfer_window mangler, og admin_log
  // har ingen entry. Cron skal kunne re-køre og afslutte de manglende faser
  // uden manuel SQL-intervention.
  const transitionAt = "2026-05-15T06:00:00.000Z";
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed", end_date: transitionAt },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active", start_date: transitionAt },
    ],
    transfer_windows: [
      { id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" },
    ],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date(transitionAt),
    deps: {
      processSeasonStart: async () => ({
        sponsor: [],
        payroll: {
          results: [],
          summary: {
            teams_processed: 0,
            loan_interest_count: 0, loan_interest_total: 0,
            salary_count: 0, salary_total: 0,
            emergency_loan_count: 0, emergency_loan_total: 0,
            negative_balance_interest_count: 0, negative_balance_interest_total: 0,
          },
        },
      }),
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log[0].phase, "insert_next_season");
  assert.equal(result.log[0].skipped, true, "sæson 1 var allerede insertet");
  assert.equal(result.log[1].phase, "mark_previous_completed");
  assert.equal(result.log[1].skipped, true, "sæson 0 var allerede completed (resume-scenariet)");
  assert.equal(result.log[2].phase, "close_prev_transfer_window");
  assert.equal(result.log[2].updated, true, "win-0 var 'open' → lukkes nu (fase 4 fejlede tidligere)");
  assert.equal(result.log[3].phase, "insert_next_transfer_window");
  assert.equal(result.log[3].inserted, true, "sæson 1's window manglede → oprettet nu");
  const adminLogResume = result.log.find((p) => p.phase === "admin_log");
  assert.ok(adminLogResume, "admin_log-fasen skal logges");
  assert.equal(adminLogResume.inserted, true, "admin_log-entry manglede → oprettet nu");

  const sæson0 = supabase.__state.seasons.find((s) => s.number === 0);
  assert.equal(sæson0.status, "completed", "sæson 0 forbliver completed");

  const sæson1Window = supabase.__state.transfer_windows.find(
    (w) => w.id === "00000000-0000-0000-0000-00000001aaaa"
  );
  assert.ok(sæson1Window, "sæson 1's transfer_window blev oprettet ved resume");
  assert.equal(sæson1Window.status, "closed");
});

test("buildTransitionPlan — completed UDEN toSeason kaster stadig (faktisk fejl, ikke resume)", async () => {
  // Resume-support skal kun aktiveres når toSeason eksisterer. En lone 'completed'
  // fromSeason uden toSeason er sandsynligvis manuel DB-corruption eller en
  // anden bug — operatør skal undersøge, ikke blindly retry.
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed", end_date: "2026-05-15" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  await assert.rejects(
    () => buildTransitionPlan({ supabase, fromSeasonId: "00000000-0000-0000-0000-000000000000" }),
    /must be 'active' or 'completed' with existing next season/
  );
});

// ─── resolveTransitionSourceSeason (#1166 — endpoint-resume) ──────────────────

test("resolveTransitionSourceSeason — returnerer nyeste aktive sæson når en findes", async () => {
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active" },
    ],
  });
  const season = await resolveTransitionSourceSeason({ supabase });
  assert.equal(season.number, 1);
  assert.equal(season.status, "active");
});

test("resolveTransitionSourceSeason — falder tilbage til seneste completed når ingen active (post season-end)", async () => {
  // #1166-scenariet: season-end er kørt FØR transition (korrekt rækkefølge),
  // så sæson 1 er 'completed' og sæson 2 'upcoming' — ingen 'active' findes.
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "completed" },
      { id: "00000000-0000-0000-0000-000000000002", number: 2, status: "upcoming" },
    ],
  });
  const season = await resolveTransitionSourceSeason({ supabase });
  assert.equal(season.number, 1, "seneste completed sæson (ikke sæson 0, ikke upcoming sæson 2)");
  assert.equal(season.id, "00000000-0000-0000-0000-000000000001");
});

test("resolveTransitionSourceSeason — returnerer null når hverken active eller completed findes", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000002", number: 2, status: "upcoming" }],
  });
  assert.equal(await resolveTransitionSourceSeason({ supabase }), null);
});

test("resolveTransitionSourceSeason → transitionToNextSeason — fuld resume fra completed sæson (#1166)", async () => {
  // End-to-end for admin-knappens flow efter season-end: resolveren finder
  // den completed sæson 1, engine'ns resume-sti (#578) accepterer den fordi
  // sæson 2 eksisterer, og 'upcoming' promoveres til 'active'.
  const transitionAt = "2026-06-09T06:00:00.000Z";
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "completed", end_date: transitionAt },
      { id: "00000000-0000-0000-0000-000000000002", number: 2, status: "upcoming", start_date: null },
    ],
    transfer_windows: [
      { id: "win-1", season_id: "00000000-0000-0000-0000-000000000001", status: "open", created_at: "2026-05-20" },
    ],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  const fromSeason = await resolveTransitionSourceSeason({ supabase });
  assert.equal(fromSeason.number, 1);

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: fromSeason.id,
    transitionAt: new Date(transitionAt),
    deps: {
      processSeasonStart: async () => ({ sponsor: [], payroll: null }),
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log[0].phase, "insert_next_season");
  assert.equal(result.log[0].updated, true, "sæson 2 promoveres upcoming → active");
  assert.equal(result.log[1].phase, "mark_previous_completed");
  assert.equal(result.log[1].skipped, true, "sæson 1 var allerede completed via season-end");

  const sæson2 = supabase.__state.seasons.find((s) => s.number === 2);
  assert.equal(sæson2.status, "active");
  const sæson1Window = supabase.__state.transfer_windows.find((w) => w.id === "win-1");
  assert.equal(sæson1Window.status, "closed", "sæson 1's window lukkes ved resume");
});

test("resolveTransitionSourceSeason — kaster uden supabase-client", async () => {
  await assert.rejects(() => resolveTransitionSourceSeason({}), /Supabase client required/);
});

test("transitionToNextSeason — kaster fejl hvis fromSeasonId mangler", async () => {
  const supabase = createMockSupabase({});
  await assert.rejects(
    () => transitionToNextSeason({ supabase }),
    /fromSeasonId required/
  );
});

test("transitionToNextSeason — promoterer pre-created sæson 1 fra 'upcoming' til 'active'", async () => {
  // Realistic 2026-05-21 setup: sæson 1 er allerede oprettet via legacy
  // POST /admin/seasons med status='upcoming' (race-katalog seedet). Engine
  // skal aktivere den i stedet for at skip den.
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active", start_date: "2026-05-08" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "upcoming", start_date: null, end_date: null },
    ],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-21T21:00:00Z"),
    deps: { processSeasonStart: async () => [], notifySeasonEvent: async () => {}, expireAndRenewContracts: async () => {} },
  });

  // Fase 1 skal nu rapportere updated=true (ikke skipped, ikke inserted)
  assert.equal(result.log[0].phase, "insert_next_season");
  assert.equal(result.log[0].updated, true, "skal promotere upcoming → active");
  assert.match(result.log[0].reason, /promoted upcoming/);

  const sæson1 = supabase.__state.seasons.find((s) => s.number === 1);
  assert.equal(sæson1.status, "active");
  assert.equal(sæson1.start_date, "2026-05-21T21:00:00.000Z");

  // Sæson 0 skal stadig markeres completed
  const sæson0 = supabase.__state.seasons.find((s) => s.number === 0);
  assert.equal(sæson0.status, "completed");
});

test("transitionToNextSeason — bevarer eksisterende start_date hvis sæson 1 allerede har en", async () => {
  // Edge: admin har sat start_date manuelt via legacy endpoint. Engine må ikke
  // overskrive den.
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "upcoming", start_date: "2026-05-20" },
    ],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-21T21:00:00Z"),
    deps: { processSeasonStart: async () => [], notifySeasonEvent: async () => {}, expireAndRenewContracts: async () => {} },
  });

  const sæson1 = supabase.__state.seasons.find((s) => s.number === 1);
  assert.equal(sæson1.start_date, "2026-05-20", "bevarer admin-sat start_date");
});

test("transitionToNextSeason — Discord-broadcast: notifySeasonEvent kaldes nøjagtigt 1 gang per transition", async () => {
  // Pre-incident 2026-05-21 var cron-fyrede transitions silent — bruger spotted
  // først loopen efter 30 min. Discord-broadcast er nu en phase i engine'n så
  // både cron + /admin/season-transition broadcaster ens.
  const notifyCalls = [];
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      processSeasonStart: async () => [],
      notifySeasonEvent: async (payload) => { notifyCalls.push(payload); },
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(notifyCalls.length, 1, "notifySeasonEvent skal kaldes nøjagtigt 1 gang");
  assert.equal(notifyCalls[0].type, "season_started");
  assert.equal(notifyCalls[0].seasonNumber, 1);
  const broadcastLog = result.log.find((entry) => entry.phase === "discord_broadcast");
  assert.ok(broadcastLog, "discord_broadcast phase skal logges");
  assert.equal(broadcastLog.sent, true);
});

test("transitionToNextSeason — Discord-broadcast: webhook-fejl må aldrig blokere transition", async () => {
  // Discord-webhook kan fejle (5xx, rate-limit, netværk). Engine'n skal stadig
  // returnere ok: true så cron'en kan markere transition fuldført.
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    deps: {
      processSeasonStart: async () => [],
      notifySeasonEvent: async () => { throw new Error("Discord 503"); },
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  const broadcastLog = result.log.find((entry) => entry.phase === "discord_broadcast");
  assert.equal(broadcastLog.sent, false);
  assert.match(broadcastLog.error, /Discord 503/);
});

test("transitionToNextSeason — sæson 1's transfer_window oprettes som 'closed' (ikke open)", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false }],
  });

  await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    deps: { processSeasonStart: async () => [], notifySeasonEvent: async () => {}, expireAndRenewContracts: async () => {} },
  });

  const sæson1Window = supabase.__state.transfer_windows.find(
    (w) => w.season_id === "00000000-0000-0000-0000-000000000001"
  );
  assert.ok(sæson1Window, "Sæson 1's transfer_window skal oprettes");
  assert.equal(sæson1Window.status, "closed", "Racing-sæson har lukket transfervindue");
});

// ─── #532 — exported transfer-window helpers (manual admin flow) ─────────────
//
// Disse helpers var tidligere private til transitionToNextSeason. De er
// eksporteret som del af #532 så `POST /admin/seasons/:id/start` kan opnå samme
// transfer_window-plumbing som engine-flowet. Unit-tests her verificerer at
// helperne fungerer korrekt når de kaldes standalone fra api.js.

test("closePrevTransferWindow — lukker eksisterende open window for prev season", async () => {
  const supabase = createMockSupabase({
    transfer_windows: [
      { id: "win-prev", season_id: "season-prev", status: "open", created_at: "2026-05-01T00:00:00Z" },
    ],
  });

  const result = await closePrevTransferWindow(supabase, "season-prev", "2026-05-26T00:00:00Z");

  assert.equal(result.updated, true);
  assert.equal(result.window_id, "win-prev");
  const updated = supabase.__state.transfer_windows.find((w) => w.id === "win-prev");
  assert.equal(updated.status, "closed");
  assert.equal(updated.closed_at, "2026-05-26T00:00:00Z");
});

test("closePrevTransferWindow — idempotent: skipper hvis window allerede lukket", async () => {
  const supabase = createMockSupabase({
    transfer_windows: [
      { id: "win-prev", season_id: "season-prev", status: "closed", created_at: "2026-05-01T00:00:00Z" },
    ],
  });

  const result = await closePrevTransferWindow(supabase, "season-prev", "2026-05-26T00:00:00Z");

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already closed");
  assert.equal(result.window_id, "win-prev");
});

test("closePrevTransferWindow — skipper hvis intet window findes (e.g. sæson 0 først)", async () => {
  const supabase = createMockSupabase({ transfer_windows: [] });

  const result = await closePrevTransferWindow(supabase, "season-prev", "2026-05-26T00:00:00Z");

  assert.equal(result.skipped, true);
  assert.match(result.reason, /no transfer_window/);
});

test("insertTransferWindowIfMissing — opretter nyt closed window når ikke til stede", async () => {
  const supabase = createMockSupabase({ transfer_windows: [] });

  const result = await insertTransferWindowIfMissing(
    supabase,
    "00000000-0000-0000-0000-00000002aaaa",
    "season-2",
    "2026-05-26T00:00:00Z",
  );

  assert.equal(result.inserted, true);
  assert.equal(result.window_id, "00000000-0000-0000-0000-00000002aaaa");
  const inserted = supabase.__state.transfer_windows[0];
  assert.equal(inserted.id, "00000000-0000-0000-0000-00000002aaaa");
  assert.equal(inserted.season_id, "season-2");
  assert.equal(inserted.status, "closed", "Racing-sæson har lukket window from start");
  assert.equal(inserted.created_at, "2026-05-26T00:00:00Z");
});

test("insertTransferWindowIfMissing — idempotent: skipper hvis window allerede eksisterer", async () => {
  const supabase = createMockSupabase({
    transfer_windows: [
      { id: "00000000-0000-0000-0000-00000002aaaa", season_id: "season-2", status: "open", created_at: "2026-05-26T00:00:00Z" },
    ],
  });

  const result = await insertTransferWindowIfMissing(
    supabase,
    "00000000-0000-0000-0000-00000002aaaa",
    "season-2",
    "2026-05-27T00:00:00Z",
  );

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "window already exists");
  assert.equal(result.status, "open", "rapporterer eksisterende status så caller kan reagere");
  assert.equal(supabase.__state.transfer_windows.length, 1, "ingen ny row indsat");
});

test("insertTransferWindowIfMissing — manual flow på sæson 1 matcher engine's deterministiske UUID", async () => {
  const supabase = createMockSupabase({ transfer_windows: [] });

  // Simulér api.js manual flow: kalder helperen med computeTransferWindowUuid(1)
  await insertTransferWindowIfMissing(
    supabase,
    computeTransferWindowUuid(1),
    "00000000-0000-0000-0000-000000000001",
    "2026-05-26T00:00:00Z",
  );

  const window = supabase.__state.transfer_windows[0];
  assert.equal(window.id, "00000000-0000-0000-0000-00000001aaaa", "matcher engine's UUID-mønster");
});

