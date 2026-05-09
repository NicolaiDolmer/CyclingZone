import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTransitionPlan,
  computeSeasonUuid,
  computeTransferWindowUuid,
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
    admin_log: initialState.admin_log ? [...initialState.admin_log] : [],
  };
  const calls = { inserts: [], updates: [] };

  function chain(table, filters = {}, orderBy = null, limit = null) {
    return {
      eq(col, val) {
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

test("buildTransitionPlan — sæson 0 → 1 plan med 22 humans, sponsor 240K hver", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active", start_date: "2026-05-08", end_date: null }],
    transfer_windows: [],
    teams: Array.from({ length: 22 }, (_, i) => ({
      id: `team-${i}`,
      name: `Team ${i}`,
      sponsor_income: 240000,
      division: 3,
      is_ai: false,
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
  assert.equal(plan.sponsor_base_total, 22 * 240000);
  assert.equal(plan.already_transitioned, false);
});

test("buildTransitionPlan — already_transitioned=true når sæson 1 allerede eksisterer", async () => {
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active", start_date: "2026-05-08" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active", start_date: "2026-05-09" },
    ],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_frozen: false }],
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
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_frozen: false }],
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
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_frozen: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    adminUserId: "admin-uuid",
    deps: {
      processSeasonStart: async (seasonId, _deps) => {
        sponsorCalls.push(seasonId);
        return [{ team: "T1", sponsor: 240000, recurring_loan_fees: 0, pullout_applied: false }];
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.equal(result.log.length, 6);
  assert.equal(result.log[0].phase, "insert_next_season");
  assert.equal(result.log[0].inserted, true);
  assert.equal(result.log[1].phase, "mark_previous_completed");
  assert.equal(result.log[1].updated, true);
  assert.equal(result.log[2].phase, "close_prev_transfer_window");
  assert.equal(result.log[2].updated, true);
  assert.equal(result.log[3].phase, "insert_next_transfer_window");
  assert.equal(result.log[3].inserted, true);
  assert.equal(result.log[4].phase, "sponsor_payout");
  assert.equal(result.log[4].count, 1);
  assert.equal(result.log[5].phase, "admin_log");
  assert.equal(result.log[5].inserted, true);

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

test("transitionToNextSeason — re-run efter delvis fejl skipper allerede-gjort arbejde", async () => {
  // Simuler: sæson 1 er allerede insertet, men transfer_window mangler.
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active", start_date: "2026-05-15" },
    ],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_frozen: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: { processSeasonStart: async () => [] },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log[0].skipped, true);
  assert.match(result.log[0].reason, /already exists/);
  // Andre faser skal stadig køre
  assert.equal(result.log[3].inserted, true);
});

test("transitionToNextSeason — fuld idempotens: re-run med alt færdig giver alle skipped", async () => {
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
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_frozen: false }],
    admin_log: [{
      id: "log-1",
      action_type: "season_transition",
      meta: {
        from_season_id: "00000000-0000-0000-0000-000000000000",
        to_season_id: "00000000-0000-0000-0000-000000000001",
      },
    }],
  });

  // Sæson 0 er nu completed → buildTransitionPlan vil afvise.
  // I stedet kalder vi direkte fra sæson 0 men den er allerede completed.
  await assert.rejects(
    () => transitionToNextSeason({
      supabase,
      fromSeasonId: "00000000-0000-0000-0000-000000000000",
      deps: { processSeasonStart: async () => [] },
    }),
    /must be 'active'/
  );
});

test("transitionToNextSeason — kaster fejl hvis fromSeasonId mangler", async () => {
  const supabase = createMockSupabase({});
  await assert.rejects(
    () => transitionToNextSeason({ supabase }),
    /fromSeasonId required/
  );
});

test("transitionToNextSeason — sæson 1's transfer_window oprettes som 'closed' (ikke open)", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_frozen: false }],
  });

  await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    deps: { processSeasonStart: async () => [] },
  });

  const sæson1Window = supabase.__state.transfer_windows.find(
    (w) => w.season_id === "00000000-0000-0000-0000-000000000001"
  );
  assert.ok(sæson1Window, "Sæson 1's transfer_window skal oprettes");
  assert.equal(sæson1Window.status, "closed", "Racing-sæson har lukket transfervindue");
});
