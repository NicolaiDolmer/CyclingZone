// #6329 (official_times_v2 only): the contact point of a physical catch lies
// inside the movement interval, computed from the same group clock as the
// times. Contact A (#6327, next checkpoint) stays the fallback wherever the
// interval endpoints cannot describe the catch.
import test from "node:test";
import assert from "node:assert/strict";
import { reconcileDescentCrossings } from "./descentCrossing.ts";
import { contactFractionInInterval } from "../groupClock.ts";
import { initRiderStates } from "../groups.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, EngineState, RaceGroup } from "../types.ts";

const keys: AbilityKey[] = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];
const group = (id: string, gap: number, kind: RaceGroup["kind"] = "peloton", origin?: RaceGroup["origin"], size = 3): RaceGroup =>
  ({ id, gap_seconds: gap, kind, cohesion: 1, rider_ids: Array.from({ length: size }, (_, i) => `${id}-${i}`), ...(origin ? { origin } : {}) });
function stateFor(groups: RaceGroup[]): EngineState {
  const entrants: Entrant[] = groups.flatMap((g) => g.rider_ids).map((rider_id) => ({ rider_id,
    abilities: Object.fromEntries(keys.map((k) => [k, 50])) as Entrant["abilities"], role: "free_role", effort: "normal", condition: 1 }));
  const riders = initRiderStates(entrants, RACE_V4_TUNING, "6329-pure");
  for (const g of groups) for (const id of g.rider_ids) riders[id].group_id = g.id;
  return { groups, riders, km: 0, virtual_gc: {} };
}
const moved = (before: RaceGroup[], gaps: Record<string, number>) => before.map((g) => ({ ...g, gap_seconds: gaps[g.id] ?? g.gap_seconds }));
const kmOf = (events: { type: string; km: number }[], type: string) => events.filter((e) => e.type === type).map((e) => e.km);

test("#6329: the contact fraction is where the linear arrival difference reaches zero", () => {
  assert.equal(contactFractionInInterval(30, -10), 0.75);
  assert.equal(contactFractionInInterval(20, 0), 1, "meeting exactly at the checkpoint");
  assert.equal(contactFractionInInterval(0, -10), null, "a chaser that was not behind at entry did not close");
  assert.equal(contactFractionInInterval(-5, -10), null);
  assert.equal(contactFractionInInterval(10, 5), null, "still behind at the checkpoint is not contact");
  assert.equal(contactFractionInInterval(Number.NaN, -1), null);
  for (const [d0, d1] of [[1, -1e6], [1e6, -1], [42, -0.5]]) {
    const f = contactFractionInInterval(d0, d1)!;
    assert.ok(f > 0 && f <= 1, `${d0}/${d1}`);
  }
});

test("#6329 e14: the field passes the descent attack inside the interval, not at the next checkpoint", () => {
  // Same shape as the e14 reproduction (#6327): the attack leads by 20 s at km
  // 71.4 and is 39.55 s behind the field at km 89.
  const before = [group("attack", 204.59, "breakaway", "descent", 4), group("field", 224.59)];
  const state = stateFor(moved(before, { attack: 243.29, field: 203.74 }));
  const a = reconcileDescentCrossings(before, state, 89, [], true);
  const b = reconcileDescentCrossings(before, state, 89, [], true, { fromKm: 71.4, entryGroups: before });
  assert.deepEqual(kmOf(a.events, "group_merged"), [89], "contact A without an interval");
  const [contact] = kmOf(b.events, "group_merged");
  const expected = Math.round((71.4 + (20 / 59.55) * (89 - 71.4)) * 100) / 100;
  assert.equal(contact, expected);
  assert.ok(contact > 71.4 && contact < 89);
  assert.deepEqual(kmOf(b.events, "breakaway_caught"), [contact], "the catch and the merge share the contact point");
  assert.deepEqual(b.state, a.state, "the contact point changes the film, never times or membership");
});

test("#6329: several contacts in one interval each get their own point, earlier contact first", () => {
  const before = [group("a", 10, "breakaway", "descent"), group("b", 20, "breakaway", "descent"), group("field", 30)];
  const state = stateFor(moved(before, { a: 40, b: 50, field: 0 }));
  const out = reconcileDescentCrossings(before, state, 50, [], true, { fromKm: 40, entryGroups: before });
  const merges = out.events.filter((e) => e.type === "group_merged").map((e) => [e.params.group_id, e.km]);
  const kmA = merges.find(([id]) => id === "a")![1] as number;
  const kmB = merges.find(([id]) => id === "b")![1] as number;
  assert.equal(kmB, Math.round((40 + (10 / 60) * 10) * 100) / 100, "b: 10 s behind at entry, 50 s ahead at the checkpoint");
  assert.equal(kmA, Math.round((40 + (20 / 60) * 10) * 100) / 100, "a: 20 s behind at entry, 40 s ahead at the checkpoint");
  assert.ok(kmA > kmB, "the line further ahead is reached later");
  assert.ok(kmA <= 50 && kmB > 40);
});

test("#6329: an attack born inside the interval keeps the checkpoint (no defined entry)", () => {
  const entry = [group("field", 0)];
  const before = [group("attack", 5, "breakaway", "descent", 2), group("field", 0)];
  const state = stateFor(moved(before, { attack: 30, field: 0 }));
  const out = reconcileDescentCrossings(before, state, 60, [], true, { fromKm: 50, entryGroups: entry });
  for (const event of out.events) assert.equal(event.km, 60);
});

test("#6329: a chaser that was ahead at the interval start keeps the checkpoint", () => {
  const entry = [group("attack", 10, "breakaway", "descent"), group("field", 5)];
  const before = [group("attack", 10, "breakaway", "descent"), group("field", 20)];
  const state = stateFor(moved(before, { attack: 30, field: 0 }));
  const out = reconcileDescentCrossings(before, state, 60, [], true, { fromKm: 50, entryGroups: entry });
  assert.ok(out.events.length > 0);
  for (const event of out.events) assert.equal(event.km, 60);
});
