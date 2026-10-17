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

function tablesStub(tables, calls = []) {
  return {
    from(table) {
      const filters = { table };
      const q = {
        select() { return q; },
        eq(col, val) { filters[col] = val; return q; },
        in(col, vals) { filters[col] = vals; return q; },
        then(resolve) {
          calls.push(filters);
          const rows = (tables[table] ?? []).filter((r) => Object.entries(filters).every(([col, val]) => col === "table"
            || (Array.isArray(val) ? val.includes(r[col]) : r[col] === val)));
          resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  };
}

test("loadTeamsInStartedField: det frosne startfelt afgoer, ogsaa naar alle udgik paa etape 1 (#6740)", async () => {
  const calls = [];
  const supabase = tablesStub({
    race_simulation_runs: [
      // Holdets ryttere stod i startfeltet, men har ingen resultatrække (udgik/OTL).
      { race_id: "all-abandoned", stage_number: 1, entrant_snapshot: ["a1", "x"] },
      // Lorraine/Léman 16/10: fjernet ved start, ingen af holdets ryttere i snapshottet.
      { race_id: "leman", stage_number: 1, entrant_snapshot: [{ rider_id: "x" }, { rider_id: "y" }] },
    ],
    race_entries: [
      { race_id: "all-abandoned", rider_id: "a1", team_id: "t1" },
      { race_id: "leman", rider_id: "l1", team_id: "t1" },
      { race_id: "legacy", rider_id: "g1", team_id: "t1" },
    ],
    race_results: [{ race_id: "legacy", team_id: "t1", stage_number: 1, result_type: "gc" }],
  }, calls);
  const out = await loadTeamsInStartedField({ supabase, raceIds: ["all-abandoned", "leman", "legacy"], teamId: "t1" });
  assert.deepEqual([...out], [["all-abandoned", true], ["leman", false], ["legacy", true]]);
  const resultsCall = calls.find((c) => c.table === "race_results");
  assert.deepEqual(resultsCall.race_id, ["legacy"], "race_results laeses kun for loeb uden snapshot");
});

test("loadTeamsInStartedField: ingen loeb eller intet hold -> ingen DB-kald", async () => {
  const calls = [];
  const supabase = tablesStub({}, calls);
  assert.equal((await loadTeamsInStartedField({ supabase, raceIds: [], teamId: "t1" })).size, 0);
  assert.deepEqual([...(await loadTeamsInStartedField({ supabase, raceIds: ["r"], teamId: null }))], [["r", false]]);
  assert.equal(calls.length, 0);
});

test("loadTeamsInStartedField: DB-fejl kastes (kalderne fejler selv mod 'stiller op')", async () => {
  const supabase = { from: () => { const q = { select: () => q, eq: () => q, in: () => q, then: (r) => r({ data: null, error: { message: "boom" } }) }; return q; } };
  await assert.rejects(() => loadTeamsInStartedField({ supabase, raceIds: ["r"], teamId: "t1" }), /started field\): boom/);
});

test("teamWillStart: regel B, skade efter udtagelsen holder holdet i loebet (#6740)", () => {
  // Friis/Léman: 6 udtaget, 1 skadet, ingen frie -> starter med 5.
  assert.deepEqual(teamWillStart({ entryCount: 5, injuredEntryCount: 1, freeEligibleCount: 0 }), { starts: true, min: MIN_RACE_ENTRIES, reason: null });
  // Havde aldrig gulvet: 4 raske + 1 skadet.
  assert.equal(teamWillStart({ entryCount: 4, injuredEntryCount: 1, freeEligibleCount: 0 }).starts, false);
  // Alle skadede, ingen frie: ingen at starte med.
  assert.equal(teamWillStart({ entryCount: 0, injuredEntryCount: 6, freeEligibleCount: 0 }).starts, false);
  // Alle skadede, 2 frie: assistenten fylder, holdet starter med 2.
  assert.equal(teamWillStart({ entryCount: 0, injuredEntryCount: 6, freeEligibleCount: 2 }).starts, true);
});
