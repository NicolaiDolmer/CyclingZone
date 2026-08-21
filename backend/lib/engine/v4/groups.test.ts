// backend/lib/engine/v4/groups.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyGroupTimes,
  buildGroupSnapshot,
  INITIAL_GROUP_ID,
  initGroups,
  initRiderStates,
  makeGroupId,
  mergeGroups,
  splitGroup,
} from "./groups.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, RaceGroup } from "./types.ts";

function abilities(): Record<AbilityKey, number> {
  return {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
}

function makeEntrants(n: number): Entrant[] {
  return Array.from({ length: n }, (_, i) => ({
    rider_id: `r${i}`,
    abilities: abilities(),
    role: "free_role",
    effort: "normal",
    condition: 1,
  }));
}

test("initGroups: alle ryttere i én peloton, gap 0", () => {
  const entrants = makeEntrants(5);
  const groups = initGroups(entrants);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, INITIAL_GROUP_ID);
  assert.equal(groups[0].kind, "peloton");
  assert.deepEqual(groups[0].rider_ids, entrants.map((e) => e.rider_id));
  assert.equal(groups[0].gap_seconds, 0);
});

test("initRiderStates: wprime = wprimeMax ved start, cp=0 (genberegnes segment for segment)", () => {
  const entrants = makeEntrants(3);
  const riders = initRiderStates(entrants, RACE_V4_TUNING, "seed-1");
  for (const e of entrants) {
    const r = riders[e.rider_id];
    assert.ok(r);
    assert.equal(r.wprime, r.wprimeMax);
    assert.equal(r.cp, 0);
    assert.equal(r.status, "racing");
    assert.equal(r.time_seconds, 0);
  }
});

test("initRiderStates: deterministisk pr. seed", () => {
  const entrants = makeEntrants(4);
  const a = initRiderStates(entrants, RACE_V4_TUNING, "seed-x");
  const b = initRiderStates(entrants, RACE_V4_TUNING, "seed-x");
  assert.deepEqual(a, b);
});

test("splitGroup: splittede ryttere havner i ny gruppe med kilde-gap + delta, kilden fortsaetter", () => {
  const groups: RaceGroup[] = [
    { id: "peloton-0", kind: "peloton", rider_ids: ["a", "b", "c", "d"], gap_seconds: 0, cohesion: 1 },
  ];
  const next = splitGroup(groups, "peloton-0", ["c", "d"], { id: makeGroupId("chase", 1), kind: "chase", gapSecondsDelta: 12 });
  assert.equal(next.length, 2);
  const front = next.find((g) => g.id === "peloton-0")!;
  const chase = next.find((g) => g.id === "chase-1")!;
  assert.deepEqual(front.rider_ids, ["a", "b"]);
  assert.equal(front.gap_seconds, 0);
  assert.deepEqual(chase.rider_ids, ["c", "d"]);
  assert.equal(chase.gap_seconds, 12);
  assert.equal(chase.kind, "chase");
});

test("splitGroup: kilde-gruppen fjernes hvis den toemmes helt", () => {
  const groups: RaceGroup[] = [{ id: "peloton-0", kind: "peloton", rider_ids: ["a", "b"], gap_seconds: 0, cohesion: 1 }];
  const next = splitGroup(groups, "peloton-0", ["a", "b"], { id: "solo-1", kind: "solo", gapSecondsDelta: -30 });
  assert.equal(next.length, 1);
  assert.equal(next[0].id, "solo-1");
  assert.equal(next[0].gap_seconds, -30);
});

test("splitGroup: tom splitRiderIds er en no-op", () => {
  const groups: RaceGroup[] = [{ id: "peloton-0", kind: "peloton", rider_ids: ["a"], gap_seconds: 0, cohesion: 1 }];
  const next = splitGroup(groups, "peloton-0", [], { id: "x", kind: "chase", gapSecondsDelta: 5 });
  assert.deepEqual(next, groups);
});

test("mergeGroups: grupper med gap-delta under taerskel smelter sammen, front-id/gap vinder", () => {
  const groups: RaceGroup[] = [
    { id: "peloton-0", kind: "peloton", rider_ids: ["a", "b"], gap_seconds: 0, cohesion: 1 },
    { id: "chase-1", kind: "chase", rider_ids: ["c"], gap_seconds: 1, cohesion: 0.8 },
    { id: "gruppetto-1", kind: "gruppetto", rider_ids: ["d"], gap_seconds: 50, cohesion: 0.5 },
  ];
  const merged = mergeGroups(groups, 2);
  assert.equal(merged.length, 2, "chase-1 (delta 1 < taerskel 2) skal smelte ind i peloton-0");
  const front = merged.find((g) => g.id === "peloton-0")!;
  assert.deepEqual(new Set(front.rider_ids), new Set(["a", "b", "c"]));
  assert.equal(front.gap_seconds, 0);
  assert.equal(front.kind, "peloton");
  const rest = merged.find((g) => g.id === "gruppetto-1")!;
  assert.deepEqual(rest.rider_ids, ["d"]);
});

test("mergeGroups: raekkefolgen i input-arrayet paavirker ikke resultatet (determinisme)", () => {
  const groups: RaceGroup[] = [
    { id: "b", kind: "chase", rider_ids: ["x"], gap_seconds: 5, cohesion: 1 },
    { id: "a", kind: "peloton", rider_ids: ["y"], gap_seconds: 0, cohesion: 1 },
  ];
  const reversed = [...groups].reverse();
  assert.deepEqual(mergeGroups(groups, 100), mergeGroups(reversed, 100));
});

test("mergeGroups: under 2 grupper er identitet (kopieret, ikke muteret)", () => {
  const groups: RaceGroup[] = [{ id: "a", kind: "peloton", rider_ids: ["x"], gap_seconds: 0, cohesion: 1 }];
  const merged = mergeGroups(groups, 2);
  assert.deepEqual(merged, groups);
  assert.notEqual(merged[0], groups[0], "skal vaere en kopi, ikke samme reference");
});

test("applyGroupTimes: rent gruppe-princip - alle i samme gruppe faar praecis samme tid", () => {
  const groups: RaceGroup[] = [
    { id: "peloton-0", kind: "peloton", rider_ids: ["a", "b"], gap_seconds: 0, cohesion: 1 },
    { id: "chase-1", kind: "chase", rider_ids: ["c", "d"], gap_seconds: 15, cohesion: 1 },
  ];
  const entrants = makeEntrants(4).map((e, i) => ({ ...e, rider_id: ["a", "b", "c", "d"][i] }));
  const riders = initRiderStates(entrants, RACE_V4_TUNING, "seed-groups");
  const next = applyGroupTimes(groups, riders, 3600);
  assert.equal(next.a.time_seconds, 3600);
  assert.equal(next.b.time_seconds, 3600);
  assert.equal(next.a.time_seconds, next.b.time_seconds);
  assert.equal(next.c.time_seconds, 3615);
  assert.equal(next.d.time_seconds, 3615);
  assert.equal(next.c.time_seconds, next.d.time_seconds);
  assert.notEqual(next.a.time_seconds, next.c.time_seconds);
});

test("buildGroupSnapshot: km rundes til 2 decimaler, grupper mappes 1:1", () => {
  const groups: RaceGroup[] = [{ id: "peloton-0", kind: "peloton", rider_ids: ["a"], gap_seconds: 3.456, cohesion: 1 }];
  const snap = buildGroupSnapshot(12.3456, groups);
  assert.equal(snap.km, 12.35);
  assert.equal(snap.groups.length, 1);
  assert.equal(snap.groups[0].group_id, "peloton-0");
  assert.equal(snap.groups[0].gap_seconds, 3.456);
});
