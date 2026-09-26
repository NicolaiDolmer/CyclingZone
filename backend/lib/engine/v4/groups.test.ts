// backend/lib/engine/v4/groups.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyGroupTimes,
  buildGroupSnapshot,
  INITIAL_GROUP_ID,
  initGroups,
  initRiderStates,
  isBreakawayWin,
  makeGroupId,
  mergedOrigin,
  mergeGroups,
  mergeGroupsDetailed,
  settleBreakawaySurvivedEvents,
  splitGroup,
} from "./groups.ts";
import type { FinaleGroupTrace } from "./groups.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, RaceGroup, StageResult, TimelineEvent } from "./types.ts";

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

// ── #5578: gruppe-oprindelse (origin) ────────────────────────────────────────

function group(id: string, kind: RaceGroup["kind"], riderIds: string[], gap: number, origin?: RaceGroup["origin"]): RaceGroup {
  return { id, kind, rider_ids: riderIds, gap_seconds: gap, cohesion: 1, ...(origin ? { origin } : {}) };
}

test("#5578 splitGroup: en split fra feltet uden origin faar INGEN origin-noegle (snapshot/fixtures uaendret)", () => {
  const next = splitGroup(initGroups(makeEntrants(4)), INITIAL_GROUP_ID, ["r1"], { id: "chase-1", kind: "chase", gapSecondsDelta: 10 });
  const split = next.find((g) => g.id === "chase-1");
  assert.ok(split);
  assert.equal("origin" in split, false);
});

test("#5578 splitGroup: eksplicit origin saettes, ellers arves kildens origin", () => {
  const formed = splitGroup(initGroups(makeEntrants(5)), INITIAL_GROUP_ID, ["r1", "r2"], {
    id: "breakaway-0", kind: "breakaway", gapSecondsDelta: -30, origin: "breakaway",
  });
  assert.equal(formed.find((g) => g.id === "breakaway-0")?.origin, "breakaway");
  const soloFromEscape = splitGroup(formed, "breakaway-0", ["r1"], { id: "solo-1", kind: "solo", gapSecondsDelta: -10 });
  assert.equal(soloFromEscape.find((g) => g.id === "solo-1")?.origin, "breakaway");
  assert.equal(soloFromEscape.find((g) => g.id === "breakaway-0")?.origin, "breakaway");
});

test("#5578 mergedOrigin: udbrud + felt = indhentet (felt), udbrud + udbrud = udbrud, felt + nedkoersel = felt", () => {
  const escape = group("b", "breakaway", ["a"], 0, "breakaway");
  const peloton = group("p", "peloton", ["b"], 5);
  const descent = group("d", "breakaway", ["c"], 0, "descent");
  assert.equal(mergedOrigin(escape, peloton), undefined);
  assert.equal(mergedOrigin(peloton, escape), undefined);
  assert.equal(mergedOrigin(escape, group("b2", "solo", ["x"], 1, "breakaway")), "breakaway");
  assert.equal(mergedOrigin(escape, descent), "descent");
  assert.equal(mergedOrigin(peloton, descent), undefined);
  assert.equal(mergedOrigin(descent, group("d2", "solo", ["y"], 1, "descent")), "descent");
});

test("#5578 mergeGroupsDetailed: et udbrud feltet henter mister oprindelsen, selv om id'et er udbruddets", () => {
  const { groups } = mergeGroupsDetailed([group("breakaway-0", "breakaway", ["a"], 0, "breakaway"), group("peloton-0", "peloton", ["b", "c"], 1)], 5);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "breakaway-0");
  assert.equal(groups[0].kind, "peloton");
  assert.equal("origin" in groups[0], false);
});

function trace(partial: Partial<FinaleGroupTrace>): FinaleGroupTrace {
  const escape = group("breakaway-0", "breakaway", ["e1", "e2"], 0, "breakaway");
  const peloton = group("peloton-0", "peloton", ["p1", "p2"], 60);
  return {
    entryGroups: [escape, peloton],
    preFinaleGroups: [escape, peloton],
    postFinaleGroups: [group("finale-winner-0", "solo", ["e1"], 0), group("finale-tier-1", "solo", ["e2"], 4), peloton],
    ...partial,
  };
}

test("#5578 isBreakawayWin: udbruddet holder hjem og goer finalen op alene = udbrudssejr", () => {
  assert.equal(isBreakawayWin(trace({}), "e1"), true);
});

test("#5578 isBreakawayWin: finalen hentede udbruddet (feltet i placerings-opgoeret) = ikke udbrudssejr, ogsaa naar en udbryder vinder", () => {
  const postFinaleGroups = [group("finale-winner-0", "solo", ["e1"], 0), group("finale-tier-1", "peloton", ["p1", "e2", "p2"], 4)];
  assert.equal(isBreakawayWin(trace({ postFinaleGroups }), "e1"), false);
});

test("#5578 isBreakawayWin: et nedkoerselsangreb ud af feltet taeller aldrig", () => {
  const descent = group("breakaway-2000", "breakaway", ["d1", "d2"], 0, "descent");
  const peloton = group("peloton-0", "peloton", ["p1"], 30);
  const t: FinaleGroupTrace = {
    entryGroups: [descent, peloton],
    preFinaleGroups: [descent, peloton],
    postFinaleGroups: [group("finale-winner-0", "solo", ["d1"], 0), group("finale-tier-1", "solo", ["d2"], 3), peloton],
  };
  assert.equal(isBreakawayWin(t, "d1"), false);
});

test("#5578 isBreakawayWin: udbrud dannet FOERST paa finale-segmentet taeller ikke (ikke i udbruddet ved indgangen)", () => {
  const entryGroups = [group("peloton-0", "peloton", ["e1", "e2", "p1", "p2"], 0)];
  assert.equal(isBreakawayWin(trace({ entryGroups }), "e1"), false);
});

test("#5578 isBreakawayWin: feltets rytter vinder = ikke udbrudssejr; ingen vinder = ikke udbrudssejr", () => {
  const postFinaleGroups = [group("finale-winner-0", "solo", ["p1"], 0), group("finale-tier-1", "peloton", ["p2", "e1", "e2"], 4)];
  assert.equal(isBreakawayWin(trace({ postFinaleGroups }), "p1"), false);
  assert.equal(isBreakawayWin(trace({}), null), false);
});

// ── #5515: udbruddets udfald goeres op efter finalen ────────────────────────
function survivedEvent(groupId: string, riderIds: string[]): TimelineEvent {
  return { km: 150, type: "breakaway_survived", params: { group_id: groupId, rider_ids: riderIds, gap_seconds: 40 } };
}

function finished(order: string[]): StageResult[] {
  return order.map((riderId, i) => ({ rider_id: riderId, rank: i + 1, time_seconds: 1000 + i, group_id: "g", status: "finished" }));
}

test("#5515 settleBreakawaySurvivedEvents: udbruddet hentet i finalen = breakaway_caught paa samme km, samme gruppe og ryttere", () => {
  const events: TimelineEvent[] = [{ km: 10, type: "breakaway_formed", params: {} }, survivedEvent("breakaway-0", ["e1", "e2"])];
  const settled = settleBreakawaySurvivedEvents(events, { breakawayWin: false, trace: trace({}), results: finished(["p1", "e1", "p2", "e2"]) });
  assert.equal(settled[0], events[0]);
  assert.deepEqual(settled[1], { km: 150, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["e1", "e2"] } });
  assert.equal(events[1].type, "breakaway_survived", "input muteres ikke");
});

test("#5515 settleBreakawaySurvivedEvents: en udbryder vinder, men feltet var med i opgoeret = hentet (motorens dom)", () => {
  const events = [survivedEvent("breakaway-0", ["e1", "e2"])];
  const settled = settleBreakawaySurvivedEvents(events, { breakawayWin: false, trace: trace({}), results: finished(["e1", "p1", "e2", "p2"]) });
  assert.equal(settled[0].type, "breakaway_caught");
});

test("#5515 settleBreakawaySurvivedEvents: udbruddet vandt = breakaway_survived bliver staaende uaendret", () => {
  const events = [survivedEvent("breakaway-0", ["e1", "e2"])];
  const settled = settleBreakawaySurvivedEvents(events, { breakawayWin: true, trace: trace({}), results: finished(["e1", "e2", "p1", "p2"]) });
  assert.equal(settled[0], events[0]);
});

test("#5515 settleBreakawaySurvivedEvents: udbruddet vandt, men et andet stykke af det blev passeret af feltet = kun det stykke er hentet", () => {
  const front = group("breakaway-0", "breakaway", ["e1"], 0, "breakaway");
  const rear = group("breakaway-1", "solo", ["e2"], 50, "breakaway");
  const peloton = group("peloton-0", "peloton", ["p1", "p2"], 30);
  const t = trace({ entryGroups: [front, peloton, rear], preFinaleGroups: [front, peloton, rear] });
  const events = [survivedEvent("breakaway-0", ["e1"]), survivedEvent("breakaway-1", ["e2"])];
  const settled = settleBreakawaySurvivedEvents(events, { breakawayWin: true, trace: t, results: finished(["e1", "p1", "p2", "e2"]) });
  assert.deepEqual(settled.map((e) => e.type), ["breakaway_survived", "breakaway_caught"]);
});

test("#5515 settleBreakawaySurvivedEvents: en gruppe hvor alle er udgaaet, faar intet udfald; intet survived-event = samme array", () => {
  const results: StageResult[] = [
    ...finished(["e1", "p1"]),
    { rider_id: "e2", rank: 3, time_seconds: 0, group_id: "g", status: "abandoned" },
  ];
  const rear = group("breakaway-1", "solo", ["e2"], 50, "breakaway");
  const t = trace({ preFinaleGroups: [group("breakaway-0", "breakaway", ["e1"], 0, "breakaway"), group("peloton-0", "peloton", ["p1"], 30), rear] });
  const settled = settleBreakawaySurvivedEvents([survivedEvent("breakaway-1", ["e2"])], { breakawayWin: true, trace: t, results });
  assert.deepEqual(settled, []);

  // Én udgaaet og én hentet: kun den hentede staar i breakaway_caught.
  const mixed = settleBreakawaySurvivedEvents([survivedEvent("breakaway-0", ["e2", "e1"])], {
    breakawayWin: false,
    trace: t,
    results: [...finished(["p1", "e1"]), { rider_id: "e2", rank: 3, time_seconds: 0, group_id: "g", status: "abandoned" }],
  });
  assert.deepEqual(mixed[0].params.rider_ids, ["e1"]);

  const none: TimelineEvent[] = [{ km: 10, type: "breakaway_formed", params: {} }];
  assert.equal(settleBreakawaySurvivedEvents(none, { breakawayWin: false, trace: null, results: [] }), none);
});
