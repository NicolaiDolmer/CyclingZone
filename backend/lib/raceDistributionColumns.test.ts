import test from "node:test";
import assert from "node:assert/strict";
import { keepTeamDistributionColumns, teamDistributionColumns } from "./raceDistributionColumns.ts";

const NONE: ReadonlySet<string> = new Set();
const lockedStage = { id: "stage-race", lineup_locked: true };
const openRace = { id: "one-day", lineup_locked: false };

test("new team in the middle of a stage race: the locked race is not its column (#7553)", () => {
  const cols = keepTeamDistributionColumns({ columns: [lockedStage, openRace], enteredRaceIds: NONE, withdrawnIds: NONE });
  assert.deepEqual(cols.map((c) => c.id), ["one-day"]);
});

test("established team with a squad in a locked race keeps the column", () => {
  const cols = keepTeamDistributionColumns({ columns: [lockedStage], enteredRaceIds: new Set(["stage-race"]), withdrawnIds: NONE });
  assert.deepEqual(cols.map((c) => c.id), ["stage-race"]);
});

test("withdrawn team keeps the locked column (it shows as withdrawn)", () => {
  const cols = keepTeamDistributionColumns({ columns: [lockedStage], enteredRaceIds: NONE, withdrawnIds: new Set(["stage-race"]) });
  assert.deepEqual(cols.map((c) => c.id), ["stage-race"]);
});

test("did_not_start team keeps the locked column (it shows Did not start)", () => {
  // the route merges voluntary and did_not_start withdrawals into one set (withdrawnSet)
  const cols = keepTeamDistributionColumns({ columns: [lockedStage], enteredRaceIds: NONE, withdrawnIds: new Set(["stage-race"]) });
  assert.equal(cols.length, 1);
});

test("an unlocked race without entries is still shown so the team can select", () => {
  const cols = keepTeamDistributionColumns({ columns: [openRace, { id: "no-flag" }], enteredRaceIds: NONE, withdrawnIds: NONE });
  assert.deepEqual(cols.map((c) => c.id), ["one-day", "no-flag"]);
});

test("null columns give an empty list", () => {
  assert.deepEqual(keepTeamDistributionColumns({ columns: null, enteredRaceIds: NONE, withdrawnIds: NONE }), []);
});

function fakeSupabase(rows: Array<{ race_id: string }>, error: { message: string } | null = null) {
  const calls: Array<{ table: string; teamId: string; ids: string[] }> = [];
  const supabase = {
    from(table: string) {
      return {
        select() {
          return {
            eq(_col: string, teamId: string) {
              return {
                in(_c: string, ids: string[]) {
                  calls.push({ table, teamId, ids });
                  return Promise.resolve({ data: error ? null : rows.filter((r) => ids.includes(r.race_id)), error });
                },
              };
            },
          };
        },
      };
    },
  };
  return { supabase, calls };
}

test("loader reads entries only for locked, non-withdrawn columns and filters", async () => {
  const { supabase, calls } = fakeSupabase([{ race_id: "entered-locked" }]);
  const columns = [
    { id: "entered-locked", lineup_locked: true },
    { id: "foreign-locked", lineup_locked: true },
    { id: "withdrawn-locked", lineup_locked: true },
    { id: "open", lineup_locked: false },
  ];
  const cols = await teamDistributionColumns({ supabase, teamId: "team-a", columns, withdrawnIds: new Set(["withdrawn-locked"]) });
  assert.deepEqual(cols.map((c) => c.id), ["entered-locked", "withdrawn-locked", "open"]);
  assert.deepEqual(calls, [{ table: "race_entries", teamId: "team-a", ids: ["entered-locked", "foreign-locked"] }]);
});

test("loader skips the read when no column is locked", async () => {
  const { supabase, calls } = fakeSupabase([]);
  const cols = await teamDistributionColumns({ supabase, teamId: "team-a", columns: [openRace], withdrawnIds: NONE });
  assert.equal(cols.length, 1);
  assert.equal(calls.length, 0);
});

test("loader throws on a read error instead of showing a wrong column list", async () => {
  const { supabase } = fakeSupabase([], { message: "boom" });
  await assert.rejects(
    teamDistributionColumns({ supabase, teamId: "team-a", columns: [lockedStage], withdrawnIds: NONE }),
    /race_entries \(distribution columns\): boom/,
  );
});
