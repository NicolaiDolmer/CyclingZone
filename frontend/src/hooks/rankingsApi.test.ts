import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { pickResultsSeason } from "../lib/seasonReference.js";

function harness(name: string, apiRows: unknown[], fail = false) {
  const states: unknown[] = [];
  const tables: Record<string, unknown[]> = {
    seasons: [{ id: "season", number: 3, status: "active" }],
    riders: [{ id: "rider", firstname: "Ada", lastname: "Test", is_retired: false }],
    global_rank_weekly_snapshot: [{ team_id: "team", global_rank: 5 }],
    global_rank_season_start_snapshot: [{ team_id: "team", global_rank: 8 }],
  };
  const supabase = { from(table: string) {
    assert.ok(table in tables, `unexpected direct table read: ${table}`);
    const query = new Proxy({ table }, { get(target, key) {
      if (key === "table") return target.table;
      if (key === "then") return (resolve: (data: unknown) => unknown) => Promise.resolve(resolve({ data: tables[table] }));
      return () => query;
    } });
    return query;
  } };
  const fetchRows = async () => { if (fail) throw new Error("endpoint unavailable"); return apiRows; };
  const code = readFileSync(new URL(`./${name}.js`, import.meta.url), "utf8")
    .replace(/^import .*;\r?$/gm, "").replace("export function", "function");
  const hook = runInNewContext(`${code}\n${name}`, {
    useState: (initial: unknown) => { const index = states.length; states.push(initial); return [initial, (next: unknown) => { states[index] = next; }]; },
    useCallback: (fn: unknown) => fn, useEffect: () => {}, supabase, pickResultsSeason,
    fetchAllRows: (build: () => { table: string }) => Promise.resolve(tables[build().table]),
    fetchGlobalRanks: fetchRows, fetchRiderRankings: fetchRows,
  });
  return { hook: hook(), states };
}

test("global hook joins API aggregates with snapshots and hides inactive teams", async () => {
  const f = harness("useGlobalRank", [
    { team_id: "team", name: "Team", division: 1, global_rank: "2", global_points: "100", active_recent: true },
    { team_id: "inactive", active_recent: false },
  ]);
  await f.hook.reload();
  const rows = f.states[0] as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].global_rank, 2);
  assert.equal(rows[0].movement, 3);
  assert.equal(rows[0].places_gained, 6);
  assert.equal(f.states[3], false);
  assert.equal(f.states[4], null);
});

test("rider hook preserves numeric stats, names and wins from API data", async () => {
  const f = harness("useRiderRankings", [{ rider_id: "rider", points: "80", stage_wins: "2", gc_wins: "1" }]);
  await f.hook.reload();
  const rows = f.states[0] as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].firstname, "Ada");
  assert.equal(rows[0].points, 80);
  assert.equal(rows[0].total_wins, 3);
  assert.equal(f.states[2], false);
});

for (const name of ["useGlobalRank", "useRiderRankings"]) {
  test(`${name}: API failures clear results and finish loading`, async () => {
    const f = harness(name, [], true);
    await f.hook.reload();
    assert.equal((f.states[0] as unknown[]).length, 0);
    assert.match((f.states.at(-1) as Error).message, /endpoint unavailable/);
    assert.equal(f.states.at(-2), false);
  });
}
