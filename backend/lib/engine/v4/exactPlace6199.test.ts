// #6199 (PR #6330 follow-up, KUN official_times_v2): every event carries its
// exact place (exact_km, and exact_time where the event names riders), and a
// regroup inside the morning break is never reported as the breakaway caught.
import test from "node:test";
import assert from "node:assert/strict";
import { annotateExactPlaces, contactFraction, pursuitContactKm, separationFraction } from "./exactPlace.ts";
import { isMorningRegroupCatch } from "./mechanics/chaseGroup.ts";
import { DEFAULT_MECHANIC_HOOKS, runSegmentLoop } from "./segmentLoop.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import { validateTimelineEvents } from "./timeline.ts";
import { frozenField, frozenStageOutput, frozenStages } from "./testUtils/oldRevisionDigests6199.ts";
import type { AbilityKey, Entrant, EngineState, MechanicHooks, RaceGroup, RulesRevision, StageInput, TimelineEvent } from "./types.ts";

test("separationFraction: where a linear gap first reaches the visible size", () => {
  assert.equal(separationFraction(0, 20, 2), 0.1);
  assert.equal(separationFraction(0, -20, 2), 0.1, "an attack ahead is a separation too");
  assert.equal(separationFraction(1, 5, 2), 0.25);
  assert.equal(separationFraction(3, 20, 2), null, "already apart at the entry: no new separation inside");
  assert.equal(separationFraction(0, 1.5, 2), null, "never visibly apart: the checkpoint stays");
  assert.equal(separationFraction(Number.NaN, 5, 2), null);
});

test("contactFraction: where a linear gap reaches zero", () => {
  assert.equal(contactFraction(30, -10), 0.75);
  assert.equal(contactFraction(30, 0), 1, "lines that end together met at the checkpoint");
  assert.equal(contactFraction(-12, 4), 0.75, "a line catching up from ahead's side crosses too");
  assert.equal(contactFraction(30, 5), null, "still apart");
  assert.equal(contactFraction(0, 0), null, "together the whole interval: no contact inside");
});

test("pursuitContactKm: the chase meets the break where its closing reaches the separation", () => {
  // 20 chase km (the last 20 of a 50 km segment), no floor, 60 s closed in total, 30 s to close.
  assert.equal(pursuitContactKm({ toKm: 100, chaseKm: 20, floorKm: 0, netClosingSeconds: 60, floorClosingSeconds: 0, closingSeconds: 60, separationSeconds: 30 }), 90);
  // Net closing covers 20 of 40 s; the floor (last 5 km, 40 s) closes the rest.
  assert.equal(pursuitContactKm({ toKm: 100, chaseKm: 20, floorKm: 5, netClosingSeconds: 20, floorClosingSeconds: 40, closingSeconds: 60, separationSeconds: 40 }), 97.5);
  // A cap that binds scales both parts.
  assert.equal(pursuitContactKm({ toKm: 100, chaseKm: 20, floorKm: 0, netClosingSeconds: 120, floorClosingSeconds: 0, closingSeconds: 60, separationSeconds: 30 }), 90);
  assert.equal(pursuitContactKm({ toKm: 100, chaseKm: 20, floorKm: 0, netClosingSeconds: 20, floorClosingSeconds: 0, closingSeconds: 20, separationSeconds: 30 }), null, "not closed");
  assert.equal(pursuitContactKm({ toKm: 100, chaseKm: 20, floorKm: 0, netClosingSeconds: 20, floorClosingSeconds: 0, closingSeconds: 20, separationSeconds: 0 }), 80, "no separation left: contact at the chase start");
  assert.equal(pursuitContactKm({ toKm: 100, chaseKm: 0, floorKm: 0, netClosingSeconds: 20, floorClosingSeconds: 0, closingSeconds: 20, separationSeconds: 5 }), null);
});

const placeCtx = (entry: Record<string, number>, exit: Record<string, number>, entryGroups: Record<string, string[]>, exitGroups: Record<string, string[]>) => ({
  fromKm: 40, toKm: 50, entryTime: new Map(Object.entries(entry)), exitTime: new Map(Object.entries(exit)),
  entryGroups: new Map(Object.entries(entryGroups)), exitGroups: new Map(Object.entries(exitGroups)), visibleGapSeconds: 2,
});

test("annotateExactPlaces: a split opens inside the segment, a point event stays, a merge follows its catch", () => {
  const ctx = placeCtx({ a: 1000, b: 1000, c: 1000, d: 1100 }, { a: 1300, b: 1300, c: 1320, d: 1300 },
    { field: ["a", "b", "c"], late: ["d"] }, { field: ["a", "b", "d"], drop: ["c"] });
  const events: TimelineEvent[] = [
    { km: 50, type: "peloton_splits", params: { group_id: "drop", source_group_id: "field", rider_ids: ["c"], gap_seconds: 20 } },
    { km: 50, type: "breakaway_caught", params: { group_id: "late", rider_ids: ["d"], chase_group_id: "field", exact_km: 47.25 } },
    { km: 50, type: "group_merged", params: { group_id: "late", into_group_id: "field", rider_ids: ["d"] } },
    { km: 50, type: "gap_update", params: { group_id: "drop", gap_seconds: 20 } },
    { km: 44.5, type: "incident", params: { rider_id: "b", cause: "crash" } },
  ];
  const [split, caught, merged, gap, incident] = annotateExactPlaces(events, ctx);
  assert.equal(split.params.exact_km, 41, "2 s of a 20 s gap opened over the 10 km interval");
  assert.equal(split.params.exact_time, 1032, "the dropped rider's own arrival at that place");
  assert.equal(caught.params.exact_km, 47.25, "a catch point from the pursuit model is kept");
  assert.equal(merged.params.exact_km, 47.25, "the merge of the caught group agrees with its catch");
  assert.equal(gap.params.exact_km, 50);
  assert.equal(gap.params.exact_time, 1320);
  assert.equal(incident.params.exact_km, 44.5);
  assert.equal("exact_time" in incident.params, false, "an incident's own time includes its stop");
  assert.deepEqual(events[0].params, { group_id: "drop", source_group_id: "field", rider_ids: ["c"], gap_seconds: 20 }, "input is never mutated");
});

test("isMorningRegroupCatch: only escapees on both sides is a regroup, not a catch", () => {
  const morning = new Set(["a", "b", "c"]);
  const caught: TimelineEvent = { km: 50, type: "breakaway_caught", params: { group_id: "break", rider_ids: ["a"], chase_group_id: "lost" } };
  const groups = (lost: string[]): RaceGroup[] => [{ id: "break", kind: "breakaway", origin: "breakaway", rider_ids: ["a"], gap_seconds: 0, cohesion: 1 },
    { id: "lost", kind: "chase", rider_ids: lost, gap_seconds: 0, cohesion: 1 }];
  assert.equal(isMorningRegroupCatch(caught, groups(["b", "c"]), morning), true);
  assert.equal(isMorningRegroupCatch(caught, groups(["b", "x"]), morning), false, "a field rider in the catching group: a real catch");
  assert.equal(isMorningRegroupCatch(caught, [{ id: "lost", kind: "chase", rider_ids: ["a", "b"], gap_seconds: 0, cohesion: 1 }], morning), true, "after the join too");
  assert.equal(isMorningRegroupCatch(caught, groups(["b"]), new Set()), false, "no break formed: nothing to regroup");
  assert.equal(isMorningRegroupCatch({ ...caught, type: "group_merged" }, groups(["b"]), morning), false);
});

// ── Loop level: a dropped escapee closing back to his own break ────────────────
const keys: AbilityKey[] = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];
const riders: Entrant[] = ["a", "b", "c", "d", "e"].map((rider_id) => ({ rider_id, abilities: Object.fromEntries(keys.map((k) => [k, 55])) as Entrant["abilities"], role: "free_role", effort: "normal", condition: 1 }));

// reportCatch: the hook reports the catch itself (the pursuit path); otherwise
// the lost group only passes the break and the physical-contact reconciliation
// (descentCrossing.ts) finds the contact.
function regroupRun(revision: RulesRevision, lostRiders: string[], reportCatch = true) {
  const input: StageInput = {
    route: { distance_km: 60, profile_type: "flat", finale_type: "bunch_sprint", weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
      segments: [{ kind: "flat", from_km: 0, to_km: 20 }, { kind: "flat", from_km: 20, to_km: 40 }, { kind: "flat", from_km: 40, to_km: 60 }] },
    startlist: riders, orders: [], seed: "6199-regroup", tuning: RACE_V4_TUNING, rules_revision: revision,
  };
  const withGroups = (state: EngineState, groups: RaceGroup[]): EngineState => {
    const next = { ...state.riders };
    for (const g of groups) for (const id of g.rider_ids) next[id] = { ...next[id], group_id: g.id };
    return { ...state, groups, riders: next };
  };
  const field = riders.map((r) => r.rider_id).filter((id) => id !== "a" && id !== "b" && !lostRiders.includes(id));
  const hooks: MechanicHooks = { ...DEFAULT_MECHANIC_HOOKS, breakaway: (state, ctx) => {
    const gapOf = (id: string) => state.groups.find((g) => g.id === id)?.gap_seconds ?? 0;
    if (ctx.segmentIndex === 0) {
      return { state: withGroups(state, [{ id: "break", kind: "breakaway", origin: "breakaway", rider_ids: ["a", "b"], gap_seconds: -60, cohesion: 1 },
        { id: "peloton-0", kind: "peloton", rider_ids: riders.map((r) => r.rider_id).filter((id) => id !== "a" && id !== "b"), gap_seconds: 0, cohesion: 1 }]),
      events: [{ km: 12, type: "breakaway_formed", params: { group_id: "break", rider_ids: ["a", "b"] } }] };
    }
    if (ctx.segmentIndex === 1) {
      // b is dropped and rides in a group that has lost the breakaway origin (an earlier merge).
      return { state: withGroups(state, [{ id: "break", kind: "breakaway", origin: "breakaway", rider_ids: ["a"], gap_seconds: gapOf("break"), cohesion: 1 },
        { id: "lost", kind: "chase", rider_ids: ["b", ...lostRiders], gap_seconds: gapOf("break") + 20, cohesion: 1 },
        { id: "peloton-0", kind: "peloton", rider_ids: field, gap_seconds: gapOf("peloton-0"), cohesion: 1 }]), events: [] };
    }
    // Segment 2: the lost group closes back up to the break.
    const lost = state.groups.find((g) => g.id === "lost");
    if (!lost) return { state, events: [] };
    return { state: withGroups(state, state.groups.map((g) => g.id === "lost" ? { ...g, gap_seconds: gapOf("break") - (reportCatch ? 0 : 1) } : g)),
      events: reportCatch ? [{ km: 60, type: "breakaway_caught", params: { group_id: "break", rider_ids: ["a"], chase_group_id: "lost", chase_group_kind: "chase" } }] : [] };
  } };
  return runSegmentLoop(input, hooks);
}

test("#6199 official_times_v2: an escapee closing back to his own break is a regroup, not the breakaway caught", () => {
  for (const reportCatch of [true, false]) {
    const run = regroupRun("official_times_v2", [], reportCatch);
    const types = run.timeline.map((e) => e.type);
    assert.equal(types.includes("breakaway_caught"), false, `no breakaway_caught for a regroup inside the break (reported by hook: ${reportCatch})`);
    assert.ok(run.timeline.some((e) => e.type === "group_merged" && [e.params.group_id, e.params.into_group_id].includes("break")), "the regroup is still reported as a merge");
    const control = regroupRun("official_times_v2", ["c"], reportCatch);
    assert.ok(control.timeline.some((e) => e.type === "breakaway_caught" && e.params.group_id === "break"), `a field rider in the catching group: a real catch (reported by hook: ${reportCatch})`);
  }
  const v3 = regroupRun("orders_gc_v3", []);
  assert.ok(v3.timeline.some((e) => e.type === "breakaway_caught"), "older revisions are unchanged");
  assert.ok(v3.timeline.every((e) => !("exact_km" in e.params)), "older revisions carry no exact place");
});

// ── Whole stages: every event placed, inside its segment, validators green ────
test("#6199 official_times_v2: every event of a whole stage carries an exact place inside its own segment", () => {
  let inside = 0;
  let separationsInside = 0;
  for (const row of frozenStages()) {
    const out = frozenStageOutput(row, "6199-frozen-a", "official_times_v2");
    const segments = (out.groupSnapshots.map((s) => s.km));
    const knownRiderIds = new Set(frozenField().map((r) => r.rider_id));
    const distanceKm = segments[segments.length - 1];
    // The persistence guard (raceEngineV4Bridge.safeV4Timeline) runs exactly this validator.
    assert.deepEqual(validateTimelineEvents(out.timeline.events, { distanceKm, knownRiderIds }), [], `${row.profile_type}#${row.stage_number}`);
    for (const event of out.timeline.events) {
      const exact = event.params.exact_km;
      assert.equal(typeof exact, "number", `${event.type} at km ${event.km} has an exact place`);
      const checkpointIndex = segments.findIndex((km) => km >= event.km - 1e-9);
      const segmentStart = checkpointIndex > 0 ? segments[checkpointIndex - 1] : 0;
      assert.ok((exact as number) <= event.km + 1e-9 && (exact as number) >= Math.min(segmentStart, event.km) - 1e-9,
        `${event.type}: exact km ${exact} inside (${segmentStart}, ${event.km}]`);
      if ("exact_time" in event.params) assert.ok(Number.isFinite(event.params.exact_time) && (event.params.exact_time as number) >= 0);
      if ((exact as number) < event.km - 1e-9) {
        inside++;
        if (event.type === "peloton_splits" || event.type === "breakaway_dropped" || event.type === "finale_attack") separationsInside++;
      }
    }
  }
  assert.ok(inside > 50, `events placed inside their segment (${inside})`);
  assert.ok(separationsInside > 20, `separations placed where the gap opened (${separationsInside})`);
  for (const revision of ["legacy", "orders_gc_v3", "official_times_v1"]) {
    const out = frozenStageOutput(frozenStages()[4], "6199-frozen-a", revision);
    assert.ok(out.timeline.events.every((e) => !("exact_km" in e.params) && !("exact_time" in e.params)), `${revision} carries no exact place`);
  }
});

test("#6199 official_times_v2: catches by the pursuit model sit where the chase met the break", () => {
  let pursuitCatches = 0;
  for (const row of frozenStages()) {
    for (const seed of ["6199-frozen-a", "6199-frozen-b"]) {
      const out = frozenStageOutput(row, seed, "official_times_v2");
      for (const event of out.timeline.events) {
        if (event.type !== "breakaway_caught" || typeof event.params.chasing_team_ids === "undefined") continue;
        pursuitCatches++;
        const merged = out.timeline.events.find((e) => e.type === "group_merged" && e.params.group_id === event.params.group_id && Math.abs(e.km - event.km) < 1e-9);
        if (merged) assert.equal(merged.params.exact_km, event.params.exact_km, "the merge agrees with its catch");
      }
    }
  }
  assert.ok(pursuitCatches > 0, "the fixture exercises the pursuit model");
});
