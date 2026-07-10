// Talentspejder Fase 3 (#2244) — scoutSweep: mirror af trainingSweep.test.js.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldSweepNow, runScoutSweep } from "./scoutSweep.js";

describe("shouldSweepNow", () => {
  it("sweep kun efter kl. 22 dansk tid", () => {
    assert.equal(shouldSweepNow(new Date("2026-06-20T19:59:00Z")), false);
    assert.equal(shouldSweepNow(new Date("2026-06-20T20:01:00Z")), true);
  });
});

// Supabase-mock: understøtter både chainable query-builders (.eq/.lte/.not) OG
// direkte await (thenable) + separate insert()-mocks pr. tabel.
function makeMockSupabase({
  assignments = [], scoutActions = [], sweepRuns = [], candidates = [], scoutState = { scout: { overall: 40, roleSkills: { evaluation: 40, reach: 40 }, isDefault: true } },
} = {}) {
  const state = {
    assignments: JSON.parse(JSON.stringify(assignments)),
    scoutActions: JSON.parse(JSON.stringify(scoutActions)),
    sweepRuns: JSON.parse(JSON.stringify(sweepRuns)),
    candidates,
    updates: [],
    inserts: { scout_actions: [], scout_sweep_runs: [] },
  };

  function queryBuilder(rows, { supportsLte = false } = {}) {
    const filters = [];
    let lteVal = null;
    const b = {
      select() { return b; },
      eq(col, val) { filters.push([col, val]); return b; },
      lte(col, val) { lteVal = [col, val]; return b; },
      not() { return b; }, // .not("potentiale", "is", null) — no-op in mock (candidates pre-filtered)
      order() { return b; },
      limit() { return b; },
      then(resolve) {
        let out = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
        if (supportsLte && lteVal) out = out.filter((r) => r[lteVal[0]] <= lteVal[1]);
        return Promise.resolve({ data: JSON.parse(JSON.stringify(out)), error: null }).then(resolve);
      },
    };
    return b;
  }

  return {
    state,
    from(table) {
      if (table === "scout_assignments") {
        return {
          select: () => queryBuilder(state.assignments, { supportsLte: true }),
          update(payload) {
            return {
              eq(_col, id) {
                const row = state.assignments.find((r) => r.id === id);
                assert.ok(row, `scout_assignments update: ukendt id ${id}`);
                Object.assign(row, payload);
                state.updates.push({ id, payload });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "scout_actions") {
        return {
          select: () => queryBuilder(state.scoutActions),
          insert(payload) {
            state.scoutActions.push({ ...payload });
            state.inserts.scout_actions.push(payload);
            return { then(resolve) { return resolve({ error: null }); } };
          },
        };
      }
      if (table === "scout_sweep_runs") {
        return {
          insert(payload) {
            const dup = state.sweepRuns.some((r) => r.team_id === payload.team_id && r.tick_date === payload.tick_date);
            if (dup) {
              return { then(resolve) { return resolve({ error: { code: "23505", message: "duplicate key" } }); } };
            }
            state.sweepRuns.push(payload);
            state.inserts.scout_sweep_runs.push(payload);
            return { then(resolve) { return resolve({ error: null }); } };
          },
        };
      }
      if (table === "riders") {
        return { select: () => queryBuilder(state.candidates), not: () => queryBuilder(state.candidates) };
      }
      if (table === "team_staff" || table === "staff_derived_abilities") {
        return {
          select: () => {
            const b = queryBuilder([]);
            b.maybeSingle = () => Promise.resolve({ data: null, error: null });
            return b;
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    __scoutState: scoutState,
  };
}

const afterWindow = new Date("2026-07-10T20:30:00Z"); // 22:30 CEST → tickDate 2026-07-10

describe("runScoutSweep", () => {
  it("before_window skip", async () => {
    const supabase = makeMockSupabase();
    const result = await runScoutSweep({ supabase, now: new Date("2026-07-10T19:00:00Z") });
    assert.deepEqual(result, { swept: 0, skipped: "before_window" });
  });

  it("swept=0 når ingen assignments er modnet", async () => {
    const supabase = makeMockSupabase({ assignments: [] });
    const result = await runScoutSweep({ supabase, now: afterWindow });
    assert.deepEqual(result, { swept: 0 });
  });

  it("target-assignment: indsætter scout_actions op til target_level + status→completed", async () => {
    const supabase = makeMockSupabase({
      assignments: [{
        id: "a1", team_id: "team-1", kind: "target", status: "active",
        rider_id: "rider-1", target_level: 2, ready_on: "2026-07-10", season_id: "season-1",
      }],
      scoutActions: [],
    });
    const result = await runScoutSweep({ supabase, now: afterWindow });
    assert.deepEqual(result, { swept: 1 });
    assert.equal(supabase.state.inserts.scout_actions.length, 2); // 0 → 2
    assert.equal(supabase.state.assignments[0].status, "completed");
    assert.deepEqual(supabase.state.assignments[0].result, { level: 2 });
  });

  it("target-assignment: kun manglende niveauer indsættes hvis rytteren allerede delvist scoutet", async () => {
    const supabase = makeMockSupabase({
      assignments: [{
        id: "a1", team_id: "team-1", kind: "target", status: "active",
        rider_id: "rider-1", target_level: 3, ready_on: "2026-07-10", season_id: "season-1",
      }],
      scoutActions: [
        { team_id: "team-1", rider_id: "rider-1" },
      ],
    });
    const result = await runScoutSweep({ supabase, now: afterWindow });
    assert.deepEqual(result, { swept: 1 });
    assert.equal(supabase.state.inserts.scout_actions.length, 2); // 1 → 3
  });

  it("mission-assignment: genererer shortlist + gratis L1-fund + status→completed", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `rider-${i}`, potentiale: 1 + i / 2, divisionId: "div-1", country: "DK", age: 22, isNmEligible: true,
    }));
    const supabase = makeMockSupabase({
      assignments: [{
        id: "m1", team_id: "team-1", kind: "mission", status: "active",
        mission_criteria: { scope: "division", value: "div-1" }, ready_on: "2026-07-10", season_id: "season-1",
      }],
      candidates,
    });
    const result = await runScoutSweep({ supabase, now: afterWindow, loadCandidates: async () => candidates });
    assert.deepEqual(result, { swept: 1 });
    assert.equal(supabase.state.assignments[0].status, "completed");
    const res = supabase.state.assignments[0].result;
    assert.ok(res.shortlist.length >= 3 && res.shortlist.length <= 5);
    assert.ok(res.shortlist.includes(res.top_rider_id));
    // Gratis L1-rapport: én scout_actions-række på topfundet.
    assert.equal(supabase.state.inserts.scout_actions.length, 1);
    assert.equal(supabase.state.inserts.scout_actions[0].rider_id, res.top_rider_id);
  });

  it("mission uden matchende kandidater: ingen top-find, stadig completed med tom shortlist", async () => {
    const supabase = makeMockSupabase({
      assignments: [{
        id: "m1", team_id: "team-1", kind: "mission", status: "active",
        mission_criteria: { scope: "division", value: "no-such-div" }, ready_on: "2026-07-10", season_id: "season-1",
      }],
      candidates: [],
    });
    const result = await runScoutSweep({ supabase, now: afterWindow });
    assert.deepEqual(result, { swept: 1 });
    assert.deepEqual(supabase.state.assignments[0].result, { shortlist: [], top_rider_id: null });
    assert.equal(supabase.state.inserts.scout_actions.length, 0);
  });

  it("IDEMPOTENS: to kørsler samme dag for samme hold = én effekt (mutex)", async () => {
    const supabase = makeMockSupabase({
      assignments: [{
        id: "a1", team_id: "team-1", kind: "target", status: "active",
        rider_id: "rider-1", target_level: 1, ready_on: "2026-07-10", season_id: "season-1",
      }],
    });
    const first = await runScoutSweep({ supabase, now: afterWindow });
    assert.deepEqual(first, { swept: 1 });

    // Anden kørsel samme dag: assignment er nu 'completed' så den matcher ikke
    // status='active'-filteret alligevel, MEN selv hvis en anden assignment for
    // samme hold blev tilføjet, blokerer sweep-mutexen en gentagen kørsel.
    supabase.state.assignments.push({
      id: "a2", team_id: "team-1", kind: "target", status: "active",
      rider_id: "rider-2", target_level: 1, ready_on: "2026-07-10", season_id: "season-1",
    });
    const second = await runScoutSweep({ supabase, now: afterWindow });
    assert.deepEqual(second, { swept: 0 }); // mutex blokerer — a2 IKKE behandlet i dag
    assert.equal(supabase.state.assignments.find((a) => a.id === "a2").status, "active");
  });

  it("ét holds fejl stopper ikke et andet holds assignment", async () => {
    const supabase = makeMockSupabase({
      assignments: [
        { id: "a1", team_id: "team-1", kind: "target", status: "active", rider_id: "rider-1", target_level: 1, ready_on: "2026-07-10", season_id: "season-1" },
        { id: "a2", team_id: "team-2", kind: "target", status: "active", rider_id: "rider-2", target_level: 1, ready_on: "2026-07-10", season_id: "season-1" },
      ],
    });
    // Tving team-1's update til at fejle (simulerer DB-fejl for netop dét hold).
    const originalFrom = supabase.from.bind(supabase);
    supabase.from = (table) => {
      const chain = originalFrom(table);
      if (table === "scout_assignments") {
        const originalUpdate = chain.update.bind(chain);
        chain.update = (payload) => {
          const wrapped = originalUpdate(payload);
          const originalEq = wrapped.eq.bind(wrapped);
          wrapped.eq = (col, id) => {
            if (id === "a1") return Promise.resolve({ error: { message: "boom" } }).then(() => { throw new Error("update boom"); });
            return originalEq(col, id);
          };
          return wrapped;
        };
      }
      return chain;
    };
    const result = await runScoutSweep({ supabase, now: afterWindow });
    assert.equal(result.swept, 1);
    assert.equal(result.failed, 1);
    assert.equal(supabase.state.assignments.find((a) => a.id === "a2").status, "completed");
  });
});
