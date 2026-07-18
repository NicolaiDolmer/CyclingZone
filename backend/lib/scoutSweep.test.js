// Talentspejder Fase 3 (#2244) — scoutSweep: mirror af trainingSweep.test.js.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldSweepNow, runScoutSweep, defaultLoadCandidates } from "./scoutSweep.js";

describe("shouldSweepNow", () => {
  it("sweep kun efter kl. 22 dansk tid", () => {
    assert.equal(shouldSweepNow(new Date("2026-06-20T19:59:00Z")), false);
    assert.equal(shouldSweepNow(new Date("2026-06-20T20:01:00Z")), true);
  });
});

// Supabase-mock: understøtter både chainable query-builders (.eq/.lte/.not) OG
// direkte await (thenable) + separate insert()-mocks pr. tabel.
function makeMockSupabase({
  assignments = [], scoutActions = [], sweepRuns = [], candidates = [], offeredIntake = [],
  scoutState = { scout: { overall: 40, roleSkills: { evaluation: 40, reach: 40 }, isDefault: true } },
} = {}) {
  const state = {
    assignments: JSON.parse(JSON.stringify(assignments)),
    scoutActions: JSON.parse(JSON.stringify(scoutActions)),
    sweepRuns: JSON.parse(JSON.stringify(sweepRuns)),
    candidates,
    // #2581: 'offered' akademi-intake-rækker — defaultLoadCandidates ekskluderer
    // disse rider_ids (globalt usøgbare via riders-RLS så længe tilbuddet står åbent).
    offeredIntake: JSON.parse(JSON.stringify(offeredIntake)),
    updates: [],
    inserts: { scout_actions: [], scout_sweep_runs: [] },
  };

  function queryBuilder(rows, { supportsLte = false } = {}) {
    const filters = [];
    const notNullFilters = [];
    let lteVal = null;
    const b = {
      select() { return b; },
      eq(col, val) { filters.push([col, val]); return b; },
      is(col, val) { filters.push([col, val]); return b; }, // .is(col, null) — samme null-lighed som .eq i mocken
      lte(col, val) { lteVal = [col, val]; return b; },
      // .not(col, "is", null) → reel IS NOT NULL (#2644 del 2: skal kunne skelne
      // free_agents/other_teams i defaultLoadCandidates-testene nedenfor).
      // Andre .not()-kald (fx potentiale) forbliver no-op — fixtures er pre-filtreret.
      not(col, op, val) { if (op === "is" && val === null) notNullFilters.push(col); return b; },
      order() { return b; },
      limit() { return b; },
      then(resolve) {
        let out = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
        if (notNullFilters.length) out = out.filter((r) => notNullFilters.every((c) => r[c] != null));
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
      if (table === "academy_intake") {
        return { select: () => queryBuilder(state.offeredIntake) };
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

// #2581: to hold rapporterede rytternavne fra en mission-shortlist de ikke kunne
// søge frem. Prod-audit (17/7) fandt 0 ægte orphans, men 17/46 (37%) af nogensinde
// shortlistede ryttere er "offered"-akademi-intake-kandidater — globalt usøgbare
// via riders-RLS-policyen indtil det tilbudte hold accepterer/afviser. Se
// scoutSweep.js' defaultLoadCandidates-kommentar for den fulde diagnose.
describe("defaultLoadCandidates (#2581)", () => {
  const riderRow = (overrides) => ({
    id: "r1", potentiale: 3, birthdate: "2000-01-01", nationality_code: "DK",
    team_id: null, pending_team_id: null, is_retired: false, team: null, ...overrides,
  });

  it("ekskluderer ryttere med et uafklaret ('offered') akademi-intake-tilbud", async () => {
    const supabase = makeMockSupabase({
      candidates: [riderRow({ id: "r1" }), riderRow({ id: "r2" })],
      offeredIntake: [{ rider_id: "r1", status: "offered" }],
    });
    const candidates = await defaultLoadCandidates(supabase);
    assert.deepEqual(candidates.map((c) => c.id), ["r2"]);
  });

  it("inkluderer ryttere hvis intake-tilbud allerede er afklaret (status != 'offered')", async () => {
    const supabase = makeMockSupabase({
      candidates: [riderRow({ id: "r1" })],
      // 'accepted'-raekken matcher IKKE academy_intake-queryens .eq('status','offered')
      // → r1 er ikke længere skjult, må optræde i kandidat-poolen.
      offeredIntake: [{ rider_id: "r1", status: "accepted" }],
    });
    const candidates = await defaultLoadCandidates(supabase);
    assert.deepEqual(candidates.map((c) => c.id), ["r1"]);
  });

  // #2644 (ejer-beslutning 18/7): free_agents (default targetPool) — en rytter
  // med team_id sat forlader kandidat-poolen helt (query-niveau filter, ikke
  // kun scoutMission's own-rider-udelukkelse).
  it("free_agents (default): ekskluderer ryttere med et team_id sat", async () => {
    const supabase = makeMockSupabase({
      candidates: [riderRow({ id: "r1", team_id: "team-9" }), riderRow({ id: "r2", team_id: null })],
      offeredIntake: [],
    });
    const candidates = await defaultLoadCandidates(supabase);
    assert.deepEqual(candidates.map((c) => c.id), ["r2"]);
    assert.equal(candidates.find((c) => c.id === "r2").ownerTeamId, null);
  });

  it("ekskluderer ryttere med pending_team_id sat (midt i et handelsflow, #2644)", async () => {
    const supabase = makeMockSupabase({
      candidates: [riderRow({ id: "r1", pending_team_id: "team-9" }), riderRow({ id: "r2", pending_team_id: null })],
      offeredIntake: [],
    });
    const candidates = await defaultLoadCandidates(supabase);
    assert.deepEqual(candidates.map((c) => c.id), ["r2"]);
  });

  // #2644 del 2 (ejer-go 18/7): other_teams-targeting — spejlvendt filter af
  // free_agents. Samme guards (pending_team_id, offered-intake) gælder uændret.
  it("other_teams: inkluderer KUN ryttere MED team_id sat, ownerTeamId = rytterens faktiske hold", async () => {
    const supabase = makeMockSupabase({
      candidates: [riderRow({ id: "r1", team_id: "team-9" }), riderRow({ id: "r2", team_id: null })],
      offeredIntake: [],
    });
    const candidates = await defaultLoadCandidates(supabase, "other_teams");
    assert.deepEqual(candidates.map((c) => c.id), ["r1"]);
    assert.equal(candidates.find((c) => c.id === "r1").ownerTeamId, "team-9");
  });

  it("other_teams: ekskluderer stadig ryttere med pending_team_id sat (midt i handelsflow)", async () => {
    const supabase = makeMockSupabase({
      candidates: [
        riderRow({ id: "r1", team_id: "team-9", pending_team_id: "team-42" }),
        riderRow({ id: "r2", team_id: "team-9", pending_team_id: null }),
      ],
      offeredIntake: [],
    });
    const candidates = await defaultLoadCandidates(supabase, "other_teams");
    assert.deepEqual(candidates.map((c) => c.id), ["r2"]);
  });

  it("other_teams: ekskluderer stadig ryttere med uafklaret ('offered') akademi-intake-tilbud", async () => {
    const supabase = makeMockSupabase({
      candidates: [riderRow({ id: "r1", team_id: "team-9" }), riderRow({ id: "r2", team_id: "team-9" })],
      offeredIntake: [{ rider_id: "r1", status: "offered" }],
    });
    const candidates = await defaultLoadCandidates(supabase, "other_teams");
    assert.deepEqual(candidates.map((c) => c.id), ["r2"]);
  });
});

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

  // #2644 del 2: sweepen bruger IKKE en injiceret loadCandidates her — den
  // rigtige defaultLoadCandidates skal selv læse targetPool fra assignmentens
  // mission_criteria og filtrere kandidat-poolen derefter.
  it("mission-assignment: sweepen læser targetPool fra mission_criteria (other_teams)", async () => {
    const candidates = [
      {
        id: "free-1", potentiale: 3, birthdate: "2000-01-01", nationality_code: "DK",
        team_id: null, pending_team_id: null, is_retired: false, team: null,
      },
      {
        id: "owned-1", potentiale: 4, birthdate: "1999-01-01", nationality_code: "DK",
        team_id: "team-9", pending_team_id: null, is_retired: false, team: { league_division_id: "div-1" },
      },
    ];
    const supabase = makeMockSupabase({
      assignments: [{
        id: "m1", team_id: "team-1", kind: "mission", status: "active",
        mission_criteria: { scope: "division", value: "div-1", targetPool: "other_teams" },
        ready_on: "2026-07-10", season_id: "season-1",
      }],
      candidates,
    });
    const result = await runScoutSweep({ supabase, now: afterWindow });
    assert.deepEqual(result, { swept: 1 });
    const res = supabase.state.assignments[0].result;
    // Kun owned-1 kvalificerer i other_teams-scope (free-1 er kontraktfri → udelades).
    assert.deepEqual(res.shortlist, ["owned-1"]);
    assert.equal(res.top_rider_id, "owned-1");
  });

  // Bagudkompatibilitet: en assignment startet FØR #2644 del 2 (ingen targetPool
  // gemt på mission_criteria) skal opføre sig som free_agents — ikke fejle eller
  // pludselig targete andre holds ryttere.
  it("mission-assignment: mangler targetPool på mission_criteria (gammel assignment) → free_agents-default", async () => {
    const candidates = [
      {
        id: "free-1", potentiale: 3, birthdate: "2000-01-01", nationality_code: "DK",
        team_id: null, pending_team_id: null, is_retired: false, team: { league_division_id: "div-1" },
      },
      {
        id: "owned-1", potentiale: 4, birthdate: "1999-01-01", nationality_code: "DK",
        team_id: "team-9", pending_team_id: null, is_retired: false, team: { league_division_id: "div-1" },
      },
    ];
    const supabase = makeMockSupabase({
      assignments: [{
        id: "m1", team_id: "team-1", kind: "mission", status: "active",
        mission_criteria: { scope: "division", value: "div-1" }, // ingen targetPool
        ready_on: "2026-07-10", season_id: "season-1",
      }],
      candidates,
    });
    const result = await runScoutSweep({ supabase, now: afterWindow });
    assert.deepEqual(result, { swept: 1 });
    const res = supabase.state.assignments[0].result;
    assert.deepEqual(res.shortlist, ["free-1"]);
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
