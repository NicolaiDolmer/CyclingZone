import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, readOnlyFetch, buildRows, renderTable } from "./dry-run-4860-sponsor-activation.js";

test("dry-run is the only mode; apply/live and unknown arguments are rejected", () => {
  assert.deepEqual(parseArgs([]), { seasonNumber: 4 });
  assert.deepEqual(parseArgs(["--dry-run", "--season=5"]), { seasonNumber: 5 });
  for (const arg of ["--apply", "--live", "--season=3", "--unknown"]) assert.throws(() => parseArgs([arg]));
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.throws(() => readOnlyFetch("https://example.invalid", { method }), /non-read/);
  }
});

test("audit compares selected and automatic renewal using the same final division without double adjustment", () => {
  const teams = [
    { id: "selected", name: "Selected | team", division: 1 },
    { id: "auto", name: "Automatic team", division: 1 },
    { id: "locked", name: "Existing multi-season", division: 1 },
  ];
  const contracts = [
    { team_id: "selected", status: "pending", start_season: 4, variant: "safe", guaranteed_fraction: 0.92, race_day_share: 0.08, guaranteed_base: 368000, signed_division: 2 },
    { team_id: "locked", status: "active", expires_after_season: 5 },
  ];
  const standings = teams.map((team) => ({ team_id: team.id, division: 2, total_points: 100, rank_in_division: 1 }));
  const rows = buildRows({ teams, contracts, standings, seasonNumber: 4 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].repricedBase, rows[1].repricedBase);
  assert.equal(rows[0].newTotal, rows[1].newTotal);
  for (const row of rows) {
    assert.ok(row.oldAdjustment > 0);
    assert.equal(row.newAdjustment, 0);
    assert.equal(row.totalDifference, row.newTotal - row.oldTotal);
  }
  const table = renderTable(rows);
  assert.match(table, /Selected \\\| team/);
  assert.match(table, /Sum \(2 hold\)/);
  assert.ok(table.includes(String(rows.reduce((sum, row) => sum + row.totalDifference, 0))));
});
