import test from "node:test";
import assert from "node:assert/strict";
import { teamWillStart, loadTeamsInStartedField } from "./raceStartOutlook.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";

test("teamWillStart: tre udtagne og ingen frie ryttere stiller ikke op (#5945)", () => {
  assert.deepEqual(teamWillStart({ entryCount: 3, freeEligibleCount: 0, stagesCompleted: 0 }), { starts: false, min: MIN_RACE_ENTRIES, reason: "below_min" });
});

test("teamWillStart: udtagne + frie ryttere der netop naar gulvet starter", () => {
  assert.deepEqual(teamWillStart({ entryCount: 3, freeEligibleCount: MIN_RACE_ENTRIES - 3 }), { starts: true, min: MIN_RACE_ENTRIES, reason: null });
  assert.equal(teamWillStart({ entryCount: 3, freeEligibleCount: MIN_RACE_ENTRIES - 4 }).starts, false);
});

test("teamWillStart: fuldt gulv starter uanset frie ryttere", () => {
  assert.equal(teamWillStart({ entryCount: MIN_RACE_ENTRIES, freeEligibleCount: 0 }).starts, true);
});

test("teamWillStart: nul udtagne afhaenger af at assistenten kan naa gulvet", () => {
  assert.equal(teamWillStart({ entryCount: 0, freeEligibleCount: MIN_RACE_ENTRIES }).starts, true);
  assert.equal(teamWillStart({ entryCount: 0, freeEligibleCount: MIN_RACE_ENTRIES - 1 }).starts, false);
});

test("teamWillStart: efter start afgoer det faktiske felt (#6740)", () => {
  // Ukendt felt (fx et opslag der fejlede) fejler mod "stiller op", som foer.
  assert.equal(teamWillStart({ entryCount: 2, freeEligibleCount: 0, stagesCompleted: 1 }).starts, true);
  assert.deepEqual(teamWillStart({ entryCount: 6, stagesCompleted: 1, inField: true }), { starts: true, min: MIN_RACE_ENTRIES, reason: null });
  // Lorraine Acier 16/10: seks entries, men fjernet ved start (gulvet) -> ikke i feltet.
  assert.deepEqual(teamWillStart({ entryCount: 6, stagesCompleted: 1, inField: false }), { starts: false, min: MIN_RACE_ENTRIES, reason: "did_not_start" });
});

test("teamWillStart: et afmeldt hold stiller ikke op, heller ikke med bevarede entries (#6740)", () => {
  assert.deepEqual(teamWillStart({ entryCount: 6, withdrawn: true }), { starts: false, min: MIN_RACE_ENTRIES, reason: "withdrawn" });
  assert.equal(teamWillStart({ entryCount: 6, stagesCompleted: 2, inField: true, withdrawn: true }).starts, false);
});

test("teamWillStart: manglende/ugyldige input kaster aldrig", () => {
  assert.deepEqual(teamWillStart(), { starts: false, min: MIN_RACE_ENTRIES, reason: "below_min" });
  assert.equal(teamWillStart({ entryCount: "x", freeEligibleCount: null, stagesCompleted: undefined }).starts, false);
  assert.equal(teamWillStart({ entryCount: -4, freeEligibleCount: NaN }).starts, false);
});

function resultsStub(rows, calls = []) {
  return {
    from(table) {
      const filters = { table };
      const q = {
        select() { return q; },
        eq(col, val) { filters[col] = val; return q; },
        in(col, vals) { filters[col] = vals; return q; },
        then(resolve) {
          calls.push(filters);
          const data = rows.filter((r) => r.team_id === filters.team_id && filters.race_id.includes(r.race_id)
            && r.stage_number === filters.stage_number && filters.result_type.includes(r.result_type));
          resolve({ data, error: null });
        },
      };
      return q;
    },
  };
}

test("loadTeamsInStartedField: rytterraekker paa etape 1 (stage/gc) afgoer feltet (#6740)", async () => {
  const calls = [];
  const supabase = resultsStub([
    { race_id: "stage-race", team_id: "t1", stage_number: 1, result_type: "stage" },
    { race_id: "one-day", team_id: "t1", stage_number: 1, result_type: "gc" },
    { race_id: "dropped", team_id: "t2", stage_number: 1, result_type: "stage" },
  ], calls);
  const out = await loadTeamsInStartedField({ supabase, raceIds: ["stage-race", "one-day", "dropped", "stage-race"], teamId: "t1" });
  assert.deepEqual([...out], [["stage-race", true], ["one-day", true], ["dropped", false]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, "race_results");
});

test("loadTeamsInStartedField: ingen loeb eller intet hold -> ingen DB-kald", async () => {
  const calls = [];
  const supabase = resultsStub([], calls);
  assert.equal((await loadTeamsInStartedField({ supabase, raceIds: [], teamId: "t1" })).size, 0);
  assert.deepEqual([...(await loadTeamsInStartedField({ supabase, raceIds: ["r"], teamId: null }))], [["r", false]]);
  assert.equal(calls.length, 0);
});

test("loadTeamsInStartedField: DB-fejl kastes (kalderne fejler selv mod 'stiller op')", async () => {
  const supabase = { from: () => { const q = { select: () => q, eq: () => q, in: () => q, then: (r) => r({ data: null, error: { message: "boom" } }) }; return q; } };
  await assert.rejects(() => loadTeamsInStartedField({ supabase, raceIds: ["r"], teamId: "t1" }), /started field\): boom/);
});
