// Talentspejder Fase 3 (#2244) — scoutAssignmentService: start/cancel + travel-debit.
// Mock-mønster spejler facilityService.test.js (in-memory state + rpc-mock af
// increment_balance_with_audit, som debitTeam rammer via balanceRpc).
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const {
  getScoutState, startTargetAssignment, startMission, cancelAssignment,
} = await import("./scoutAssignmentService.js");
const { DEFAULT_SCOUT, SCOUT_JOB_CONFIG } = await import("./scoutEngine.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createScoutSupabase({ team, staff = [], abilities = [], assignments = [], scoutActions = [] }) {
  const state = {
    team: clone(team),
    staff: clone(staff),
    abilities: clone(abilities),
    assignments: clone(assignments),
    scoutActions: clone(scoutActions),
    finance_transactions: [],
    updates: [],
  };

  return {
    state,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      assert.equal(params.p_team_id, state.team.id);
      state.team.balance = (state.team.balance ?? 0) + params.p_delta;
      state.finance_transactions.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: state.team.balance, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            assert.equal(columns, "balance");
            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, state.team.id);
                return { single: () => Promise.resolve({ data: { balance: state.team.balance }, error: null }) };
              },
            };
          },
        };
      }

      if (table === "team_staff") {
        return {
          select() {
            const filters = {};
            const chain = {
              eq(column, value) { filters[column] = value; return chain; },
              maybeSingle() {
                const row = state.staff.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) || null;
                return Promise.resolve({ data: row ? clone(row) : null, error: null });
              },
            };
            return chain;
          },
        };
      }

      if (table === "staff_derived_abilities") {
        return {
          select() {
            const filters = {};
            const chain = {
              eq(column, value) { filters[column] = value; return chain; },
              maybeSingle() {
                const row = state.abilities.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) || null;
                return Promise.resolve({ data: row ? clone(row) : null, error: null });
              },
            };
            return chain;
          },
        };
      }

      if (table === "scout_actions") {
        return {
          select() {
            const filters = {};
            const chain = {
              eq(column, value) { filters[column] = value; return chain; },
              then(resolve) {
                const rows = state.scoutActions.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
                return Promise.resolve({ data: clone(rows), error: null }).then(resolve);
              },
            };
            return chain;
          },
        };
      }

      if (table === "scout_assignments") {
        return {
          select(_columns) {
            const filters = {};
            let order = null;
            let limitN = null;
            const chain = {
              eq(column, value) { filters[column] = value; return chain; },
              order(column, opts) { order = { column, ...opts }; return chain; },
              limit(n) { limitN = n; return chain; },
              maybeSingle() {
                const row = state.assignments.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) || null;
                return Promise.resolve({ data: row ? clone(row) : null, error: null });
              },
              then(resolve) {
                let rows = state.assignments.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
                if (order) {
                  rows = [...rows].sort((a, b) => {
                    const av = a[order.column], bv = b[order.column];
                    return order.ascending === false ? (av < bv ? 1 : -1) : (av > bv ? 1 : -1);
                  });
                }
                if (limitN != null) rows = rows.slice(0, limitN);
                return Promise.resolve({ data: clone(rows), error: null }).then(resolve);
              },
            };
            return chain;
          },
          insert(payload) {
            const row = { id: `assign-${state.assignments.length + 1}`, status: "active", ...clone(payload) };
            state.assignments.push(row);
            return {
              error: null,
              then(resolve) { return resolve({ error: null }); },
              select() { return { single: () => Promise.resolve({ data: { id: row.id }, error: null }) }; },
            };
          },
          update(payload) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                const row = state.assignments.find((r) => r.id === value);
                assert.ok(row, `scout_assignments update: ukendt id ${value}`);
                Object.assign(row, payload);
                state.updates.push({ id: value, payload: clone(payload) });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

const NOW = new Date("2026-07-10T12:00:00Z");

// ─── getScoutState ────────────────────────────────────────────────────────────

test("getScoutState: no hired scout → DEFAULT_SCOUT + capacity 1", async () => {
  const supabase = createScoutSupabase({ team: { id: "team-1", balance: 100_000 } });
  const result = await getScoutState("team-1", supabase);
  assert.deepEqual(result.scout, DEFAULT_SCOUT);
  assert.equal(result.capacity, 1);
  assert.deepEqual(result.active, []);
  assert.deepEqual(result.completed, []);
});

test("getScoutState: exposes jobConfig (priser/varigheder) fra SCOUT_JOB_CONFIG", async () => {
  const supabase = createScoutSupabase({ team: { id: "team-1", balance: 100_000 } });
  const result = await getScoutState("team-1", supabase);
  assert.deepEqual(result.jobConfig, {
    targetDaysPerLevel: SCOUT_JOB_CONFIG.target.daysPerLevel,
    targetCostPerLevel: SCOUT_JOB_CONFIG.target.costPerLevel,
    missionDays: SCOUT_JOB_CONFIG.mission.days,
    missionCost: SCOUT_JOB_CONFIG.mission.cost,
  });
});

test("getScoutState: hired scouting-staff → real overall/roleSkills, capacity reflects overall", async () => {
  const supabase = createScoutSupabase({
    team: { id: "team-1", balance: 100_000 },
    staff: [{ id: "staff-1", team_id: "team-1", role: "scouting", status: "active", name: "Kim Andersen" }],
    abilities: [{ staff_id: "staff-1", overall: 85, role_skills: { evaluation: 80, reach: 90 } }],
  });
  const result = await getScoutState("team-1", supabase);
  assert.deepEqual(result.scout, {
    id: "staff-1", name: "Kim Andersen", overall: 85, roleSkills: { evaluation: 80, reach: 90 }, isDefault: false,
  });
  assert.equal(result.capacity, 2); // overall >= 80
});

test("getScoutState: fired scouting-staff does NOT count as hired", async () => {
  const supabase = createScoutSupabase({
    team: { id: "team-1", balance: 100_000 },
    staff: [{ id: "staff-1", team_id: "team-1", role: "scouting", status: "fired", name: "Kim" }],
  });
  const result = await getScoutState("team-1", supabase);
  assert.deepEqual(result.scout, DEFAULT_SCOUT);
});

test("getScoutState: returns active + completed (capped 20) assignments", async () => {
  const assignments = [
    { id: "a1", team_id: "team-1", status: "active", kind: "target" },
    { id: "a2", team_id: "team-1", status: "completed", kind: "target", completed_at: "2026-07-01T00:00:00Z" },
    { id: "a3", team_id: "team-1", status: "completed", kind: "mission", completed_at: "2026-07-05T00:00:00Z" },
    { id: "a4", team_id: "team-2", status: "active", kind: "target" }, // andet hold
  ];
  const supabase = createScoutSupabase({ team: { id: "team-1", balance: 100_000 }, assignments });
  const result = await getScoutState("team-1", supabase);
  assert.equal(result.active.length, 1);
  assert.equal(result.active[0].id, "a1");
  assert.deepEqual(result.completed.map((r) => r.id), ["a3", "a2"]); // nyeste først
});

// ─── startTargetAssignment ────────────────────────────────────────────────────

test("startTargetAssignment: happy path (level 0→1) inserts + debits travel cost", async () => {
  const supabase = createScoutSupabase({ team: { id: "team-1", balance: 100_000 } });
  const result = await startTargetAssignment(
    { teamId: "team-1", riderId: "rider-1", seasonId: "season-1" }, supabase, NOW
  );
  assert.equal(result.ok, true);
  assert.equal(result.assignment.targetLevel, 1);
  assert.equal(result.assignment.travelCost, SCOUT_JOB_CONFIG.target.costPerLevel);
  assert.equal(result.assignment.startedOn, "2026-07-10");
  assert.equal(result.assignment.readyOn, "2026-07-13"); // +3 dage
  assert.equal(supabase.state.team.balance, 100_000 - SCOUT_JOB_CONFIG.target.costPerLevel);
  assert.equal(supabase.state.finance_transactions.length, 1);
  const tx = supabase.state.finance_transactions[0];
  assert.equal(tx.type, "scout_travel");
  assert.equal(tx.idempotency_key, `scout_travel:team-1:${result.assignment.id}`);
  assert.equal(supabase.state.assignments[0].staff_id, null); // default-spejder
});

test("startTargetAssignment: existing scout_actions level advances fromLevel/toLevel + cost", async () => {
  const supabase = createScoutSupabase({
    team: { id: "team-1", balance: 100_000 },
    scoutActions: [
      { team_id: "team-1", rider_id: "rider-1" },
      { team_id: "team-1", rider_id: "rider-1" },
    ],
  });
  const result = await startTargetAssignment(
    { teamId: "team-1", riderId: "rider-1", seasonId: "season-1" }, supabase, NOW
  );
  assert.equal(result.ok, true);
  assert.equal(result.assignment.targetLevel, 3);
  assert.equal(result.assignment.travelCost, SCOUT_JOB_CONFIG.target.costPerLevel); // 1 step
  assert.equal(result.assignment.readyOn, "2026-07-13");
});

test("startTargetAssignment: already at maxLevel (3) → max_level, no insert/debit", async () => {
  const supabase = createScoutSupabase({
    team: { id: "team-1", balance: 100_000 },
    scoutActions: [
      { team_id: "team-1", rider_id: "rider-1" },
      { team_id: "team-1", rider_id: "rider-1" },
      { team_id: "team-1", rider_id: "rider-1" },
    ],
  });
  const result = await startTargetAssignment(
    { teamId: "team-1", riderId: "rider-1", seasonId: "season-1" }, supabase, NOW
  );
  assert.deepEqual(result, { ok: false, error: "max_level" });
  assert.equal(supabase.state.assignments.length, 0);
  assert.equal(supabase.state.finance_transactions.length, 0);
});

test("startTargetAssignment: at capacity (1 active, default scout) → capacity", async () => {
  const supabase = createScoutSupabase({
    team: { id: "team-1", balance: 100_000 },
    assignments: [{ id: "a1", team_id: "team-1", status: "active", kind: "target" }],
  });
  const result = await startTargetAssignment(
    { teamId: "team-1", riderId: "rider-1", seasonId: "season-1" }, supabase, NOW
  );
  assert.deepEqual(result, { ok: false, error: "capacity" });
  assert.equal(supabase.state.finance_transactions.length, 0);
});

test("startTargetAssignment: insufficient balance → insufficient_funds, no insert/debit", async () => {
  const supabase = createScoutSupabase({ team: { id: "team-1", balance: 100 } });
  const result = await startTargetAssignment(
    { teamId: "team-1", riderId: "rider-1", seasonId: "season-1" }, supabase, NOW
  );
  assert.deepEqual(result, { ok: false, error: "insufficient_funds" });
  assert.equal(supabase.state.assignments.length, 0);
});

test("startTargetAssignment: hired scout overall>=80 → capacity 2 allows second active job", async () => {
  const supabase = createScoutSupabase({
    team: { id: "team-1", balance: 100_000 },
    staff: [{ id: "staff-1", team_id: "team-1", role: "scouting", status: "active", name: "Top Scout" }],
    abilities: [{ staff_id: "staff-1", overall: 85, role_skills: { evaluation: 80, reach: 90 } }],
    assignments: [{ id: "a1", team_id: "team-1", status: "active", kind: "target" }],
  });
  const result = await startTargetAssignment(
    { teamId: "team-1", riderId: "rider-1", seasonId: "season-1" }, supabase, NOW
  );
  assert.equal(result.ok, true);
  assert.equal(supabase.state.assignments[1].staff_id, "staff-1");
});

// ─── startMission ─────────────────────────────────────────────────────────────

test("startMission: happy path inserts flat-cost mission + debits", async () => {
  const supabase = createScoutSupabase({ team: { id: "team-1", balance: 100_000 } });
  const criteria = { scope: "division", value: "div-1" };
  const result = await startMission({ teamId: "team-1", criteria, seasonId: "season-1" }, supabase, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.assignment.travelCost, SCOUT_JOB_CONFIG.mission.cost);
  assert.equal(result.assignment.readyOn, "2026-07-24"); // +14 dage
  assert.deepEqual(supabase.state.assignments[0].mission_criteria, criteria);
  assert.equal(supabase.state.team.balance, 100_000 - SCOUT_JOB_CONFIG.mission.cost);
});

test("startMission: insufficient balance → insufficient_funds", async () => {
  const supabase = createScoutSupabase({ team: { id: "team-1", balance: 100 } });
  const result = await startMission(
    { teamId: "team-1", criteria: { scope: "u23" }, seasonId: "season-1" }, supabase, NOW
  );
  assert.deepEqual(result, { ok: false, error: "insufficient_funds" });
});

// ─── idempotent-skip propagation ────────────────────────────────────────────

function makeRpcDuplicate(supabase) {
  supabase.rpc = () => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
}

test("startTargetAssignment: idempotent debit-skip → ok med skipped:true, assignment still inserted", async () => {
  const supabase = createScoutSupabase({ team: { id: "team-1", balance: 100_000 } });
  makeRpcDuplicate(supabase);
  const result = await startTargetAssignment(
    { teamId: "team-1", riderId: "rider-1", seasonId: "season-1" }, supabase, NOW
  );
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(supabase.state.assignments.length, 1);
});

// ─── cancelAssignment ─────────────────────────────────────────────────────────

test("cancelAssignment: active assignment → cancelled, no refund", async () => {
  const supabase = createScoutSupabase({
    team: { id: "team-1", balance: 100_000 },
    assignments: [{ id: "a1", team_id: "team-1", status: "active", kind: "target" }],
  });
  const result = await cancelAssignment({ teamId: "team-1", assignmentId: "a1" }, supabase);
  assert.deepEqual(result, { ok: true });
  assert.equal(supabase.state.assignments[0].status, "cancelled");
  assert.equal(supabase.state.finance_transactions.length, 0); // ingen refusion v1
});

test("cancelAssignment: unknown id → not_found", async () => {
  const supabase = createScoutSupabase({ team: { id: "team-1", balance: 100_000 } });
  const result = await cancelAssignment({ teamId: "team-1", assignmentId: "nope" }, supabase);
  assert.deepEqual(result, { ok: false, error: "not_found" });
});

test("cancelAssignment: other team's assignment → not_found (no cross-team cancel)", async () => {
  const supabase = createScoutSupabase({
    team: { id: "team-1", balance: 100_000 },
    assignments: [{ id: "a1", team_id: "team-2", status: "active", kind: "target" }],
  });
  const result = await cancelAssignment({ teamId: "team-1", assignmentId: "a1" }, supabase);
  assert.deepEqual(result, { ok: false, error: "not_found" });
});

test("cancelAssignment: already completed → not_found (can't cancel a finished job)", async () => {
  const supabase = createScoutSupabase({
    team: { id: "team-1", balance: 100_000 },
    assignments: [{ id: "a1", team_id: "team-1", status: "completed", kind: "target" }],
  });
  const result = await cancelAssignment({ teamId: "team-1", assignmentId: "a1" }, supabase);
  assert.deepEqual(result, { ok: false, error: "not_found" });
});
