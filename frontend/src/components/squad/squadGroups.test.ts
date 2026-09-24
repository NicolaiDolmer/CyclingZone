import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_GROUPS_VISIBLE,
  countSquadGroups,
  shouldShowGroupFilter,
  squadGroupOf,
  squadGroupsFor,
  youthSplitFromPayload,
} from "./squadGroups.ts";

const PAYLOAD = { seasonNumber: 3, squads: { u23: { riderIds: ["a1", "a2"] }, junior: { riderIds: ["j1"] } } };
const ROSTER = [
  { id: "s1", is_academy: false },
  { id: "s2", is_academy: false },
  { id: "a1", is_academy: true },
  { id: "a2", is_academy: true },
  { id: "j1", is_academy: true },
  { id: "x9", is_academy: true }, // akademirytter serveren ikke placerede
];

test("uden serverens trup-opdeling er grupperne Seniors / Academy (dagens filter)", () => {
  assert.deepEqual(squadGroupsFor(null), ["senior", "academy"]);
  assert.equal(squadGroupOf({ id: "a1", is_academy: true }, null), "academy");
  assert.equal(squadGroupOf({ id: "s1", is_academy: false }, null), "senior");
});

test("med serverens opdeling: Senior / U23 / Junior, afgjort af id'erne og ikke af en alder", () => {
  const split = youthSplitFromPayload(PAYLOAD);
  assert.deepEqual(squadGroupsFor(split), ["senior", "u23", "junior"]);
  assert.equal(squadGroupOf({ id: "j1", is_academy: true }, split), "junior");
  assert.equal(squadGroupOf({ id: "a2", is_academy: true }, split), "u23");
  // En senior er senior, også hvis serveren (fejlagtigt) listede ham.
  assert.equal(squadGroupOf({ id: "j1", is_academy: false }, split), "senior");
  // Uplaceret akademirytter forsvinder ikke: han står under U23.
  assert.equal(squadGroupOf({ id: "x9", is_academy: true }, split), "u23");
});

test("countSquadGroups tæller pr. gruppe", () => {
  const split = youthSplitFromPayload(PAYLOAD);
  assert.deepEqual(countSquadGroups(ROSTER, split), { senior: 2, u23: 3, junior: 1, academy: 0 });
  assert.deepEqual(countSquadGroups(ROSTER, null), { senior: 2, u23: 0, junior: 0, academy: 4 });
});

test("filteret vises kun når der er ungdomsryttere, eller en gruppe med ryttere er skjult (#5075-reglen)", () => {
  const split = youthSplitFromPayload(PAYLOAD);
  const seniorsOnly = countSquadGroups([{ id: "s1", is_academy: false }], split);
  assert.equal(shouldShowGroupFilter(seniorsOnly, ALL_GROUPS_VISIBLE, split), false);
  assert.equal(shouldShowGroupFilter(seniorsOnly, { ...ALL_GROUPS_VISIBLE, senior: false }, split), true);
  assert.equal(shouldShowGroupFilter(countSquadGroups(ROSTER, split), ALL_GROUPS_VISIBLE, split), true);
  assert.equal(shouldShowGroupFilter(countSquadGroups(ROSTER, null), ALL_GROUPS_VISIBLE, null), true);
});

test("et uventet /api/youth-squads-svar giver tomme grupper, ingen exception", () => {
  const split = youthSplitFromPayload({ nope: true });
  assert.equal(split.u23.size, 0);
  assert.equal(split.junior.size, 0);
});
