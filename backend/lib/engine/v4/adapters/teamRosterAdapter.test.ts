// backend/lib/engine/v4/adapters/teamRosterAdapter.test.ts
// M13-wiring (#3463/#2412, #3855): grupperingen af startlisten i holdopstillinger.

import { test } from "node:test";
import assert from "node:assert/strict";

import { teamRostersFromStartlist } from "./teamRosterAdapter.ts";
import type { AbilityKey, Entrant } from "../types.ts";

function abilities(): Record<AbilityKey, number> {
  return {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
}

function entrant(riderId: string, teamId?: string | null): Entrant {
  const e: Entrant = { rider_id: riderId, abilities: abilities(), role: "free_role", effort: "normal", condition: 1 };
  if (teamId !== undefined) e.team_id = teamId;
  return e;
}

test("startliste helt uden hold-id giver null (fallback til vejetape-vejen)", () => {
  assert.equal(teamRostersFromStartlist([entrant("a"), entrant("b")]), null);
  assert.equal(teamRostersFromStartlist([entrant("a", null), entrant("b", "")]), null);
  assert.equal(teamRostersFromStartlist([entrant("a", "   ")]), null);
  assert.equal(teamRostersFromStartlist([]), null);
});

test("ryttere grupperes paa hold-id", () => {
  const rosters = teamRostersFromStartlist([
    entrant("r3", "t2"), entrant("r1", "t1"), entrant("r2", "t1"), entrant("r4", "t2"),
  ]);
  assert.ok(rosters);
  assert.deepEqual(rosters.map((r) => r.team_id), ["t1", "t2"]);
  assert.deepEqual(rosters[0].riders.map((r) => r.rider_id), ["r1", "r2"]);
  assert.deepEqual(rosters[1].riders.map((r) => r.rider_id), ["r3", "r4"]);
});

test("determinisme: raekkefoelgen paa input aendrer ikke opstillingen", () => {
  const list = [entrant("r1", "t1"), entrant("r2", "t2"), entrant("r3", "t1")];
  const a = teamRostersFromStartlist(list);
  const b = teamRostersFromStartlist([...list].reverse());
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
});

test("en rytter uden hold bliver sit eget ét-mands-hold (invariant 6: ingen falder ud)", () => {
  const rosters = teamRostersFromStartlist([
    entrant("r1", "t1"), entrant("r2", "t1"), entrant("solo1"), entrant("solo2", null),
  ]);
  assert.ok(rosters);
  const riderIds = rosters.flatMap((r) => r.riders.map((x) => x.rider_id)).sort();
  assert.deepEqual(riderIds, ["r1", "r2", "solo1", "solo2"]);
  // ...og de to hold-loese ryttere er IKKE foldet sammen til ét fantomhold.
  const soloTeams = rosters.filter((r) => r.riders.some((x) => x.rider_id.startsWith("solo")));
  assert.equal(soloTeams.length, 2);
  for (const t of soloTeams) assert.equal(t.riders.length, 1);
});

test("holdet baerer de OPRINDELIGE entrants (ingen kopi/normalisering undervejs)", () => {
  const original = entrant("r1", "t1");
  const rosters = teamRostersFromStartlist([original]);
  assert.equal(rosters?.[0].riders[0], original);
});
