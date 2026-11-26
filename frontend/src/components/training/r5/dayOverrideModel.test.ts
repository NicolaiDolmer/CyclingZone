// #8592 · "Kun denne dag": den rene model bag dagsvælgerens valg.
import assert from "node:assert/strict";
import test from "node:test";
import { dayOverridesOf, hasDayOverrides, overrideReplaced, overrideSessionGroups, selectedRiderIds } from "./dayOverrideModel.ts";
import { futureFields } from "./dayPickerModel.ts";

test("datoens valg læses fra ugens svar; uden kontakten er der intet", () => {
  assert.deepEqual(dayOverridesOf({ date: "2026-11-27", weekday: "fri", available: true, races: [] }), {});
  assert.equal(hasDayOverrides(null), false);
  const day = { date: "2026-11-27", weekday: "fri", available: true, races: [], dayOverrides: { r1: { session: "rest" } } };
  assert.equal(hasDayOverrides(day), true);
  assert.deepEqual(dayOverridesOf(day).r1, { session: "rest" });
});

test("et løb vinder: alle felter taget = erstattet, nogle felter = løbet går forud (ejer punkt 4)", () => {
  assert.equal(overrideReplaced({ raceSlots: [], restSlots: [] }), null);
  assert.equal(overrideReplaced({ raceSlots: [2], restSlots: [] }), "some");
  assert.equal(overrideReplaced({ raceSlots: [0, 1, 2, 3, 4], restSlots: [] }), "all");
  assert.equal(overrideReplaced({ raceSlots: [], restSlots: [0, 1, 2, 3, 4] }), "rest");
  assert.equal(overrideReplaced({ raceSlots: [2], restSlots: [0, 1, 3, 4] }), "all");
});

test("valget vises i de frie felter, løbsfeltet bliver løb", () => {
  const fields = futureFields({ programSlot: () => "rest", planSession: "tempo", fields: { raceSlots: [2], restSlots: [] } });
  assert.equal(fields.length, 5);
  assert.equal(fields[0], "rest");
  assert.notEqual(fields[2], "rest");
});

test("flere ryttere og grupper giver hver rytter én gang, kun holdets egne (ejer punkt 6)", () => {
  const roster = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const groups = [{ id: "g", members: [{ riderId: "b" }, { riderId: "c" }, { riderId: "z" }] }];
  assert.deepEqual(selectedRiderIds({ riderIds: ["a", "b"], groupIds: ["g"], groups, roster }), ["a", "b", "c"]);
  assert.deepEqual(selectedRiderIds({ riderIds: [], groupIds: [], groups, roster }), []);
});

test("pas-listen har hele dage først, så færdighed og træning", () => {
  const groups = overrideSessionGroups({ skill: ["technique"], byLevel: { easy: ["endurance"], hard: ["sprint"] } });
  assert.deepEqual(groups.map((g) => g.key), ["wholeDay", "skill", "easy", "hard"]);
  assert.deepEqual(groups[0].sessions, ["rest", "recovery"]);
});
