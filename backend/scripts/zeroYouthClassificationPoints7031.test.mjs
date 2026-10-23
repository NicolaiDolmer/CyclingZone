import test from "node:test";
import assert from "node:assert/strict";
import { projectStandings } from "./zeroYouthClassificationPoints7031.mjs";

test("#7031 projectStandings: placering ændres kun når fradraget vender rækkefølgen", () => {
  const standings = [
    { squad: "u23", league_division_id: 1, team_id: "a", total_points: 100, rank_in_pool: 1 },
    { squad: "u23", league_division_id: 1, team_id: "b", total_points: 95, rank_in_pool: 2 },
    { squad: "u23", league_division_id: 2, team_id: "c", total_points: 50, rank_in_pool: 1 },
  ];
  const delta = new Map([["u23|a", 10]]);
  const changes = projectStandings(standings, delta);
  assert.deepEqual(changes.map((c) => [c.team_id, c.from, c.to]).sort(), [["a", 1, 2], ["b", 2, 1]]);
  assert.deepEqual(projectStandings(standings, new Map()), []);
});
