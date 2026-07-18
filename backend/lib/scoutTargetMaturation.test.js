// #2644: tests der låser 30-min-modningen af enkelt-rytter-undersøgelser.
// Ejer-beslutning 18/7: "Sæt det til 30 minutter, at man får svaret fra sin
// scout" — lazy-finalisering ved visning, claim-først så samtidige kald
// (dobbelt boot, dashboard+central parallelt) aldrig dobbelt-indsætter actions.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lazyCompleteDueTargetAssignments, completeTargetAssignment } from "./scoutTargetMaturation.js";

// Minimal thenable query-mock: ægte filtrering over rækkerne, så testene
// beviser query-formen (eq/lte-kæderne), ikke bare stubbede svar.
function makeMock({ assignments = [], actions = [] } = {}) {
  const state = {
    assignments: assignments.map((a) => ({ ...a })),
    actions: actions.map((a) => ({ ...a })),
    insertedActions: [],
    claims: [],
  };

  function query(table) {
    const q = {
      _table: table,
      _filters: [],
      _update: null,
      _wantSelectAfterUpdate: false,
      select() { if (this._update) this._wantSelectAfterUpdate = true; return this; },
      insert(row) {
        if (table === "scout_actions") {
          state.actions.push(row);
          state.insertedActions.push(row);
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ error: null });
      },
      update(payload) { this._update = payload; return this; },
      eq(col, val) { this._filters.push((r) => r[col] === val); return this; },
      lte(col, val) { this._filters.push((r) => r[col] <= val); return this; },
      _rows() {
        const src = table === "scout_assignments" ? state.assignments : state.actions;
        return src.filter((r) => this._filters.every((f) => f(r)));
      },
      then(resolve) {
        if (this._update) {
          const hit = this._rows();
          for (const row of hit) Object.assign(row, this._update);
          state.claims.push({ table, count: hit.length });
          return resolve({ data: this._wantSelectAfterUpdate ? hit.map((r) => ({ id: r.id })) : null, error: null });
        }
        return resolve({ data: this._rows(), error: null });
      },
    };
    return q;
  }

  return { supabase: { from: query }, state };
}

const NOW = new Date("2026-07-18T12:00:00Z");
const T35_MIN_AGO = "2026-07-18T11:25:00.000Z";
const T5_MIN_AGO = "2026-07-18T11:55:00.000Z";

function targetAssignment(overrides = {}) {
  return {
    id: "as-1", team_id: "team-1", rider_id: "r-1", kind: "target",
    status: "active", target_level: 2, season_id: "s-1", created_at: T35_MIN_AGO,
    ...overrides,
  };
}

describe("lazyCompleteDueTargetAssignments (#2644, 30-min-modning)", () => {
  it("modner en due undersøgelse: claim + scout_actions op til target_level", async () => {
    const { supabase, state } = makeMock({ assignments: [targetAssignment()] });
    const result = await lazyCompleteDueTargetAssignments({ supabase, teamId: "team-1", now: NOW });
    assert.equal(result.completed, 1);
    assert.equal(state.assignments[0].status, "completed");
    assert.equal(state.insertedActions.length, 2); // target_level 2, 0 eksisterende
  });

  it("rører IKKE en undersøgelse startet for <30 min siden", async () => {
    const { supabase, state } = makeMock({ assignments: [targetAssignment({ created_at: T5_MIN_AGO })] });
    const result = await lazyCompleteDueTargetAssignments({ supabase, teamId: "team-1", now: NOW });
    assert.equal(result.completed, 0);
    assert.equal(state.assignments[0].status, "active");
    assert.equal(state.insertedActions.length, 0);
  });

  it("rører IKKE mission-assignments (kun kind='target')", async () => {
    const { supabase, state } = makeMock({ assignments: [targetAssignment({ kind: "mission" })] });
    const result = await lazyCompleteDueTargetAssignments({ supabase, teamId: "team-1", now: NOW });
    assert.equal(result.completed, 0);
    assert.equal(state.assignments[0].status, "active");
  });

  it("tabt claim (allerede completed af andet kald) → ingen action-inserts", async () => {
    // Simulér taberen i racet: rækken er allerede flippet til completed
    // mellem select og claim — status-conditional update rammer 0 rækker.
    const { supabase, state } = makeMock({ assignments: [targetAssignment()] });
    state.assignments[0].status = "completed";
    // select'en (status='active') finder intet → helt no-op
    const result = await lazyCompleteDueTargetAssignments({ supabase, teamId: "team-1", now: NOW });
    assert.equal(result.completed, 0);
    assert.equal(state.insertedActions.length, 0);
  });

  it("dobbeltkald i træk indsætter kun actions én gang (claim-idempotens)", async () => {
    const { supabase, state } = makeMock({ assignments: [targetAssignment()] });
    await lazyCompleteDueTargetAssignments({ supabase, teamId: "team-1", now: NOW });
    await lazyCompleteDueTargetAssignments({ supabase, teamId: "team-1", now: NOW });
    assert.equal(state.insertedActions.length, 2); // stadig kun target_level=2 rækker
  });
});

describe("completeTargetAssignment (sweep-backstop, flyttet fra scoutSweep)", () => {
  it("indsætter kun det manglende antal actions (eksisterende trækkes fra)", async () => {
    const { supabase, state } = makeMock({
      assignments: [targetAssignment({ target_level: 3 })],
      actions: [{ team_id: "team-1", rider_id: "r-1" }], // level 1 findes allerede
    });
    await completeTargetAssignment({ supabase, assignment: state.assignments[0] });
    assert.equal(state.insertedActions.length, 2); // 3 - 1
    assert.equal(state.assignments[0].status, "completed");
  });
});
