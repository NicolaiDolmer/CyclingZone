import test from "node:test";
import assert from "node:assert/strict";

import { computeDivisionRoleUpdate, DIVISION_ROLE_MAP } from "./discordRoleSync.js";

const R = DIVISION_ROLE_MAP; // ld → role_id
const OTHER = "999999999999999999"; // en ikke-division-rolle (fx @Founder)

test("ingen roller endnu → tilføj mål, fjern intet", () => {
  const { toAdd, toRemove } = computeDivisionRoleUpdate({ memberRoleIds: [], targetLeagueDivisionId: 4 });
  assert.equal(toAdd, R[4]);
  assert.deepEqual(toRemove, []);
});

test("allerede korrekt rolle → ingen ændring", () => {
  const { toAdd, toRemove } = computeDivisionRoleUpdate({ memberRoleIds: [R[4], OTHER], targetLeagueDivisionId: 4 });
  assert.equal(toAdd, null);
  assert.deepEqual(toRemove, []);
});

test("oprykning (Div 3-A → Div 2-A): fjern gammel, tilføj ny", () => {
  const { toAdd, toRemove } = computeDivisionRoleUpdate({ memberRoleIds: [R[4]], targetLeagueDivisionId: 2 });
  assert.equal(toAdd, R[2]);
  assert.deepEqual(toRemove, [R[4]]);
});

test("rører ALDRIG ikke-division-roller (fx @Founder)", () => {
  const { toAdd, toRemove } = computeDivisionRoleUpdate({ memberRoleIds: [OTHER, R[5]], targetLeagueDivisionId: 5 });
  assert.equal(toAdd, null);
  assert.deepEqual(toRemove, []); // OTHER bevares, R[5] er allerede korrekt
});

test("flere gamle division-roller (data-drift) → fjern alle undtagen målet", () => {
  const { toAdd, toRemove } = computeDivisionRoleUpdate({ memberRoleIds: [R[4], R[5], R[6]], targetLeagueDivisionId: 6 });
  assert.equal(toAdd, null); // R[6] haves allerede
  assert.deepEqual(new Set(toRemove), new Set([R[4], R[5]]));
});

test("ukendt/ingen mål-division → fjern alle division-roller, tilføj intet", () => {
  const { toAdd, toRemove } = computeDivisionRoleUpdate({ memberRoleIds: [R[4], OTHER], targetLeagueDivisionId: null });
  assert.equal(toAdd, null);
  assert.deepEqual(toRemove, [R[4]]);
});

test("mål-division uden rolle i mappet (fx 99) → behandl som intet mål", () => {
  const { toAdd, toRemove } = computeDivisionRoleUpdate({ memberRoleIds: [R[7]], targetLeagueDivisionId: 99 });
  assert.equal(toAdd, null);
  assert.deepEqual(toRemove, [R[7]]);
});
