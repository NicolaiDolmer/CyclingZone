// #6000 · trainingGroupsModel: "Plan for"-vaelgerens sektioner, gruppens
// traethed i aften (mest traette rytter) og regel A i gruppens gitter.
import assert from "node:assert/strict";
import test from "node:test";
import {
  planForWithGroups, groupNameByRider, groupForecastEntry, groupLockedSlots, riderTypesInSquad,
  isGroupValue, groupIdOf, groupValue, NEW_GROUP_VALUE, type TrainingGroup,
} from "./trainingGroupsModel.ts";

const group = (id: string, name: string, members: Array<[string, boolean]>): TrainingGroup => ({
  id, name, days: null, isSeed: true, programKey: null, fatigue: null,
  members: members.map(([riderId, followsGroup]) => ({ riderId, followsGroup })),
});

test("Plan for: Hold, saa Groups med '+ New group' nederst, saa ryttere (pin 1)", () => {
  const options = [
    { value: "team", label: "Team · 3 riders" },
    { value: "r1", label: "A Rossi · Own plan" },
    { value: "r2", label: "B Berg" },
  ];
  const groups = [group("g1", "Climbers", [["r1", true], ["r2", false]])];
  const names = groupNameByRider(groups);
  const out = planForWithGroups(options, groups, {
    count: (n) => `${n} riders`,
    newGroup: "+ New group",
    followerLabel: (id) => (names.has(id) ? `${id} · ${names.get(id)}` : null),
  });
  assert.deepEqual(out.map((o) => [o.value, o.label, o.section]), [
    ["team", "Team · 3 riders", undefined],
    [groupValue("g1"), "Climbers · 2 riders", "groups"],
    [NEW_GROUP_VALUE, "+ New group", "groups"],
    ["r1", "r1 · Climbers", "riders"],
    ["r2", "B Berg", "riders"],
  ]);
});

test("vaerdier: group:<id> er en gruppe, '+ New group' er ikke", () => {
  assert.equal(isGroupValue(groupValue("g1")), true);
  assert.equal(groupIdOf(groupValue("g1")), "g1");
  assert.equal(isGroupValue(NEW_GROUP_VALUE), false);
  assert.equal(groupIdOf("team"), null);
});

test("Fatigue tonight for en gruppe = gruppens mest traette rytter (pin 2)", () => {
  const riders = {
    r1: { fatigue: 40, band: "ok" },
    r2: { fatigue: 58, band: "warn" },
    r3: { fatigue: 90, band: "risk" },
  };
  assert.deepEqual(groupForecastEntry(riders, ["r1", "r2"]), { fatigue: 58, band: "warn" });
  assert.equal(groupForecastEntry(riders, []), null);
  assert.equal(groupForecastEntry(null, ["r1"]), null);
});

test("regel A: et felt er 'Stage' i gruppens gitter kun naar alle har etape i det (pin 3)", () => {
  assert.deepEqual([...groupLockedSlots([new Set([1, 2]), new Set([2])])], [2]);
  assert.deepEqual([...groupLockedSlots([new Set([1]), new Set()])], []);
  assert.deepEqual([...groupLockedSlots([])], []);
});

test("Start from: rytter-typerne i truppen, uden dubletter (pin 4)", () => {
  assert.deepEqual(riderTypesInSquad([{ type: "climber" }, { type: null }, { type: "sprinter" }, { type: "climber" }]), ["climber", "sprinter"]);
});
