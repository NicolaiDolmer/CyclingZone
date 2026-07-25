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

// #2945 — notify()-wiring: begge modnings-stier (lazy = hovedsti #2644, sweep =
// backstop) skal fortælle spilleren rapporten er klar, EFTER status er sat.
describe("scout-report-ready-notifikation wiring (#2945)", () => {
  it("lazyCompleteDueTargetAssignments: kalder notify med den FULDFØRTE assignment (status='completed')", async () => {
    const { supabase } = makeMock({ assignments: [targetAssignment()] });
    const calls = [];
    const notify = async (args) => { calls.push(args); return { delivered: true, deduped: false }; };

    const result = await lazyCompleteDueTargetAssignments({ supabase, teamId: "team-1", now: NOW, notify });

    assert.equal(result.completed, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].assignment.id, "as-1");
    assert.equal(calls[0].assignment.status, "completed", "notify ser den ALLEREDE fuldførte status");
    assert.equal(calls[0].assignment.target_level, 2);
    assert.equal(calls[0].now, NOW);
  });

  it("lazyCompleteDueTargetAssignments: kalder IKKE notify når intet er due (no-op)", async () => {
    const { supabase } = makeMock({ assignments: [targetAssignment({ created_at: T5_MIN_AGO })] });
    const calls = [];
    const notify = async (args) => { calls.push(args); return { delivered: true }; };
    await lazyCompleteDueTargetAssignments({ supabase, teamId: "team-1", now: NOW, notify });
    assert.equal(calls.length, 0);
  });

  it("lazyCompleteDueTargetAssignments: en tabt claim (race) kalder IKKE notify for den række", async () => {
    const { supabase, state } = makeMock({ assignments: [targetAssignment()] });
    state.assignments[0].status = "completed"; // allerede fuldført af et andet kald
    const calls = [];
    const notify = async (args) => { calls.push(args); return { delivered: true }; };
    await lazyCompleteDueTargetAssignments({ supabase, teamId: "team-1", now: NOW, notify });
    assert.equal(calls.length, 0);
  });

  it("completeTargetAssignment: kalder notify EFTER scout_assignments-updaten er bekræftet", async () => {
    const { supabase, state } = makeMock({ assignments: [targetAssignment({ target_level: 1 })] });
    let statusSeenByNotify = null;
    const notify = async ({ assignment }) => { statusSeenByNotify = assignment.status; return { delivered: true }; };

    await completeTargetAssignment({ supabase, assignment: state.assignments[0], notify });

    assert.equal(statusSeenByNotify, "completed");
    assert.equal(state.assignments[0].status, "completed", "selve fuldførelsen sker uanset notify");
  });

  it("dedup mellem lazy og sweep-backstop for SAMME assignment: 2. notify-kald dedup'er (delt related_id = assignment.id)", async () => {
    // Simulerer det faktiske race #2644 beskytter imod: lazy-stien vinder claimet,
    // men et efterfølgende sweep-tick for samme assignment (fx en genkørt tick før
    // completed-status er synlig alle steder) må IKKE give en ekstra notifikation.
    // notifyScoutReportReady/notifyUser's (type,title,message,related_id)-dedup
    // (24t) er selve garantien — her bevises blot at BEGGE call-sites sender samme
    // related_id, så det defensive lag rent faktisk kan fange en dublet.
    const { supabase } = makeMock({ assignments: [targetAssignment()] });
    const relatedIds = [];
    const notify = async ({ assignment }) => { relatedIds.push(assignment.id); return { delivered: true }; };

    await lazyCompleteDueTargetAssignments({ supabase, teamId: "team-1", now: NOW, notify });
    await completeTargetAssignment({ supabase, assignment: { ...targetAssignment(), status: "completed" }, notify });

    assert.deepEqual(relatedIds, ["as-1", "as-1"], "begge stier sender SAMME related_id for samme assignment-id");
  });
});
