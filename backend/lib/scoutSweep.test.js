// Talentspejder Fase 3 (#2244) — scoutSweep: orkestrerer target-backstop
// (uændret kl.22-gate + team-dags-mutex) + mission-modning (#3997: ingen
// dags-gate, se scoutMissionMaturation.test.js for den dybe dækning af selve
// mission-claim-logikken). Denne fil tester SELVE ORKESTRERINGEN.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldSweepNow, runScoutSweep, defaultLoadCandidates } from "./scoutSweep.js";

describe("shouldSweepNow (#3997: gælder KUN target-backstoppet)", () => {
  it("sweep kun efter kl. 22 dansk tid", () => {
    assert.equal(shouldSweepNow(new Date("2026-06-20T19:59:00Z")), false);
    assert.equal(shouldSweepNow(new Date("2026-06-20T20:01:00Z")), true);
  });
});

it("defaultLoadCandidates re-eksporteres bagudkompatibelt (flyttet til scoutMissionMaturation.js, #3997)", () => {
  assert.equal(typeof defaultLoadCandidates, "function");
});

// Supabase-mock: understøtter chainable query-builders (.eq/.lte/.not) OG en
// betinget update-kæde (target-claim + mission-claim), separate insert()-mocks
// pr. tabel, samt scout_sweep_runs-mutex-tabellen (target-backstop, uændret).
function makeMockSupabase({
  assignments = [], scoutActions = [], sweepRuns = [], candidates = [], offeredIntake = [], seasons = [],
} = {}) {
  const state = {
    assignments: JSON.parse(JSON.stringify(assignments)),
    scoutActions: JSON.parse(JSON.stringify(scoutActions)),
    sweepRuns: JSON.parse(JSON.stringify(sweepRuns)),
    candidates,
    offeredIntake: JSON.parse(JSON.stringify(offeredIntake)),
    seasons: JSON.parse(JSON.stringify(seasons)), // #4058
    updates: [],
    inserts: { scout_actions: [], scout_sweep_runs: [] },
  };

  function selectBuilder(rows, { supportsLte = false } = {}) {
    const filters = [];
    const notNullFilters = [];
    let lteVal = null;
    const matched = () => {
      let out = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
      if (notNullFilters.length) out = out.filter((r) => notNullFilters.every((c) => r[c] != null));
      if (supportsLte && lteVal) out = out.filter((r) => r[lteVal[0]] != null && r[lteVal[0]] <= lteVal[1]);
      return out;
    };
    const b = {
      select() { return b; },
      eq(col, val) { filters.push([col, val]); return b; },
      is(col, val) { filters.push([col, val]); return b; },
      not(col, op, val) { if (op === "is" && val === null) notNullFilters.push(col); return b; },
      lte(col, val) { lteVal = [col, val]; return b; },
      // #4058: resolveSeasonNumber's seasons-opslag bruger .maybeSingle().
      maybeSingle() {
        const out = matched();
        return Promise.resolve({ data: out[0] ? JSON.parse(JSON.stringify(out[0])) : null, error: null });
      },
      then(resolve) {
        return Promise.resolve({ data: JSON.parse(JSON.stringify(matched())), error: null }).then(resolve);
      },
    };
    return b;
  }

  function updateBuilder(payload) {
    // Skal bære BÅDE target-backstoppets simple ".eq(id) → await" (completeTargetAssignment)
    // OG mission-claimets betingede ".eq(id).eq(status).select()" (claimAndCompleteMission).
    const filters = [];
    let wantSelect = false;
    const b = {
      eq(col, val) { filters.push([col, val]); return b; },
      select() { wantSelect = true; return b; },
      then(resolve) {
        const hit = state.assignments.filter((r) => filters.every(([c, v]) => r[c] === v));
        for (const row of hit) Object.assign(row, payload);
        state.updates.push({ filters: [...filters], payload, count: hit.length });
        return Promise.resolve({ data: wantSelect ? hit.map((r) => ({ id: r.id })) : null, error: null }).then(resolve);
      },
    };
    return b;
  }

  return {
    state,
    from(table) {
      if (table === "scout_assignments") {
        return {
          select: () => selectBuilder(state.assignments, { supportsLte: true }),
          update: (payload) => updateBuilder(payload),
        };
      }
      if (table === "scout_actions") {
        return {
          select: () => selectBuilder(state.scoutActions),
          insert(payload) {
            const rows = Array.isArray(payload) ? payload : [payload];
            for (const row of rows) {
              state.scoutActions.push({ ...row });
              state.inserts.scout_actions.push(row);
            }
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
        return { select: () => selectBuilder(state.candidates), not: () => selectBuilder(state.candidates) };
      }
      if (table === "academy_intake") {
        return { select: () => selectBuilder(state.offeredIntake) };
      }
      if (table === "seasons") {
        return { select: () => selectBuilder(state.seasons) }; // #4058
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

const afterWindow = new Date("2026-07-10T20:30:00Z"); // 22:30 CEST → target-backstop kører
const beforeWindow = new Date("2026-07-10T09:00:00Z"); // 11:00 CEST → target-backstop springes over

// Letvægts-scout-stub til mission-tests herunder — undgår at binde denne
// orkestrerings-test-fil til scoutAssignmentService.getScoutState's fulde
// (og langt tungere) kald-graf. Selve scout-opslaget er dækket dybt i
// scoutAssignmentService.test.js/scoutMissionMaturation.test.js.
const STUB_GET_SCOUT = async () => ({ overall: 40, roleSkills: { evaluation: 40, reach: 40 }, isDefault: true });

describe("runScoutSweep (#3997: mission uden dags-gate + target-backstop uændret)", () => {
  it("før kl. 22: missioner processeres STADIG (ingen dags-gate); target-backstop springes over", async () => {
    const supabase = makeMockSupabase({
      assignments: [{
        id: "m1", team_id: "team-1", kind: "mission", status: "active",
        mission_criteria: { scope: "division", value: "div-1" },
        created_at: new Date(beforeWindow.getTime() - 25 * 60 * 60 * 1000).toISOString(), // due
        season_id: "season-1",
      }],
      candidates: Array.from({ length: 5 }, (_, i) => ({
        id: `rider-${i}`, potentiale: 1 + i, divisionId: "div-1", country: "DK", age: 22, isNmEligible: true,
      })),
    });
    const result = await runScoutSweep({
      supabase, now: beforeWindow, loadCandidates: async () => supabase.state.candidates, getScout: STUB_GET_SCOUT,
    });
    assert.deepEqual(result, { swept: 1 });
    assert.equal(supabase.state.assignments[0].status, "completed");
  });

  it("swept=0 når intet er due, hverken før eller efter kl. 22", async () => {
    const supabase = makeMockSupabase({ assignments: [] });
    assert.deepEqual(await runScoutSweep({ supabase, now: beforeWindow }), { swept: 0 });
    assert.deepEqual(await runScoutSweep({ supabase, now: afterWindow }), { swept: 0 });
  });

  it("target-assignment: kun efter kl. 22 (backstop, uændret adfærd) — indsætter scout_actions + status→completed", async () => {
    const supabase = makeMockSupabase({
      assignments: [{
        id: "a1", team_id: "team-1", kind: "target", status: "active",
        rider_id: "rider-1", target_level: 2, ready_on: "2026-07-10", season_id: "season-1",
      }],
    });
    const tooEarly = await runScoutSweep({ supabase, now: beforeWindow });
    assert.deepEqual(tooEarly, { swept: 0 });
    assert.equal(supabase.state.assignments[0].status, "active");

    const result = await runScoutSweep({ supabase, now: afterWindow });
    assert.deepEqual(result, { swept: 1 });
    assert.equal(supabase.state.inserts.scout_actions.length, 2); // 0 → 2
    assert.equal(supabase.state.assignments[0].status, "completed");
    assert.deepEqual(supabase.state.assignments[0].result, { level: 2 });
  });

  it("mission-assignment: genererer shortlist + gratis L1-fund + status→completed", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `rider-${i}`, potentiale: 1 + i / 2, divisionId: "div-1", country: "DK", age: 22, isNmEligible: true,
    }));
    const supabase = makeMockSupabase({
      assignments: [{
        id: "m1", team_id: "team-1", kind: "mission", status: "active",
        mission_criteria: { scope: "division", value: "div-1" },
        created_at: "2026-07-08T09:00:00.000Z", season_id: "season-1",
      }],
      candidates,
    });
    const result = await runScoutSweep({ supabase, now: afterWindow, loadCandidates: async () => candidates, getScout: STUB_GET_SCOUT });
    assert.deepEqual(result, { swept: 1 });
    assert.equal(supabase.state.assignments[0].status, "completed");
    const res = supabase.state.assignments[0].result;
    assert.ok(res.shortlist.length >= 3 && res.shortlist.length <= 5);
    assert.equal(supabase.state.inserts.scout_actions.length, res.shortlist.length);
  });

  // #3997 kerne-fund: to missioner for SAMME hold, begge due samme dag —
  // FØR blokerede scout_sweep_runs' hold-dags-mutex den anden. Nu fuldføres begge,
  // OG target-backstoppets team-mutex (samme tabel, andet kind) er upåvirket.
  it("to missioner for samme hold samme dag fuldføres BEGGE (den gamle hold-dags-mutex ramte kun target-kind nu)", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `rider-${i}`, potentiale: 1 + i / 2, divisionId: "div-1", country: "DK", age: 22, isNmEligible: true,
    }));
    const supabase = makeMockSupabase({
      assignments: [
        {
          id: "m-a", team_id: "team-1", kind: "mission", status: "active",
          mission_criteria: { scope: "division", value: "div-1" }, created_at: "2026-07-08T06:00:00.000Z", season_id: "season-1",
        },
        {
          id: "m-b", team_id: "team-1", kind: "mission", status: "active",
          mission_criteria: { scope: "division", value: "div-1" }, created_at: "2026-07-08T08:00:00.000Z", season_id: "season-1",
        },
      ],
      candidates,
    });
    const result = await runScoutSweep({ supabase, now: afterWindow, loadCandidates: async () => candidates, getScout: STUB_GET_SCOUT });
    assert.deepEqual(result, { swept: 2 });
  });

  it("IDEMPOTENS (target-backstop): to kørsler samme dag for samme hold = én effekt (uændret mutex)", async () => {
    const supabase = makeMockSupabase({
      assignments: [{
        id: "a1", team_id: "team-1", kind: "target", status: "active",
        rider_id: "rider-1", target_level: 1, ready_on: "2026-07-10", season_id: "season-1",
      }],
    });
    const first = await runScoutSweep({ supabase, now: afterWindow });
    assert.deepEqual(first, { swept: 1 });

    supabase.state.assignments.push({
      id: "a2", team_id: "team-1", kind: "target", status: "active",
      rider_id: "rider-2", target_level: 1, ready_on: "2026-07-10", season_id: "season-1",
    });
    const second = await runScoutSweep({ supabase, now: afterWindow });
    assert.deepEqual(second, { swept: 0 }); // target-backstoppets mutex blokerer — a2 IKKE behandlet i dag
    assert.equal(supabase.state.assignments.find((a) => a.id === "a2").status, "active");
  });

  it("mission-kind rører IKKE target-backstoppets scout_sweep_runs-mutex (uafhængige stier)", async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      id: `rider-${i}`, potentiale: 1 + i, divisionId: "div-1", country: "DK", age: 22, isNmEligible: true,
    }));
    const supabase = makeMockSupabase({
      assignments: [
        {
          id: "m1", team_id: "team-1", kind: "mission", status: "active",
          mission_criteria: { scope: "division", value: "div-1" }, created_at: "2026-07-08T09:00:00.000Z", season_id: "season-1",
        },
        {
          id: "a1", team_id: "team-1", kind: "target", status: "active",
          rider_id: "rider-1", target_level: 1, ready_on: "2026-07-10", season_id: "season-1",
        },
      ],
      candidates,
    });
    const result = await runScoutSweep({ supabase, now: afterWindow, loadCandidates: async () => candidates, getScout: STUB_GET_SCOUT });
    // Begge modner — missionen tæller ikke som "swept i dag" over for target-mutexen.
    assert.deepEqual(result, { swept: 2 });
    assert.equal(supabase.state.assignments[0].status, "completed");
    assert.equal(supabase.state.assignments[1].status, "completed");
  });

  it("ét holds target-fejl stopper ikke et andet holds target-assignment (backstop, uændret)", async () => {
    const supabase = makeMockSupabase({
      assignments: [
        { id: "a1", team_id: "team-1", kind: "target", status: "active", rider_id: "rider-1", target_level: 1, ready_on: "2026-07-10", season_id: "season-1" },
        { id: "a2", team_id: "team-2", kind: "target", status: "active", rider_id: "rider-2", target_level: 1, ready_on: "2026-07-10", season_id: "season-1" },
      ],
    });
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

  it("#2945 target-assignment (backstop): kalder notify med den fuldførte assignment", async () => {
    const supabase = makeMockSupabase({
      assignments: [{
        id: "a1", team_id: "team-1", kind: "target", status: "active",
        rider_id: "rider-1", target_level: 2, ready_on: "2026-07-10", season_id: "season-1",
      }],
    });
    const calls = [];
    const notify = async (args) => { calls.push(args); return { delivered: true }; };
    const result = await runScoutSweep({ supabase, now: afterWindow, notify });
    assert.deepEqual(result, { swept: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].assignment.id, "a1");
    assert.equal(calls[0].assignment.status, "completed");
  });

  it("#2945 mission-assignment: kalder notify med den fuldførte assignment + result (shortlist)", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `rider-${i}`, potentiale: 1 + i / 2, divisionId: "div-1", country: "DK", age: 22, isNmEligible: true,
    }));
    const supabase = makeMockSupabase({
      assignments: [{
        id: "m1", team_id: "team-1", kind: "mission", status: "active",
        mission_criteria: { scope: "division", value: "div-1" }, created_at: "2026-07-08T09:00:00.000Z", season_id: "season-1",
      }],
      candidates,
    });
    const calls = [];
    const notify = async (args) => { calls.push(args); return { delivered: true }; };
    const result = await runScoutSweep({
      supabase, now: afterWindow, loadCandidates: async () => candidates, getScout: STUB_GET_SCOUT, notify,
    });
    assert.deepEqual(result, { swept: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].assignment.id, "m1");
    assert.equal(calls[0].assignment.status, "completed");
    assert.ok(calls[0].assignment.result.shortlist.length >= 3, "notify ser den fuldførte result med shortlist");
  });
});
