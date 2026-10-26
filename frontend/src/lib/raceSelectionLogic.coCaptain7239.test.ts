// #7239: Race Hub tilfoejer ikke en kaptajn i stilhed, og den delte kaptajn (#5981)
// overlever et gem fra panelet og fra boardet.
import test from "node:test";
import assert from "node:assert/strict";
import * as logic from "./raceSelectionLogic.js";

// JS-modulet har null-defaults (TS udleder dem som null); testen kalder det løst typet.
type Fn<R> = (...args: unknown[]) => R;
const resolveBoardRoles = logic.resolveBoardRoles as unknown as Fn<Record<string, unknown>>;
const toggleRider = logic.toggleRider as unknown as Fn<Record<string, unknown>>;
const validateSelectionClient = logic.validateSelectionClient as unknown as Fn<string[]>;

const ids = ["a", "b", "c", "d", "e", "f"];
const suit: Record<string, number> = { a: 40, b: 90, c: 70, d: 60, e: 50, f: 30 };
const suitabilityOf = (id: string) => suit[id];

test("#7239: spurtkaptajn som eneste leder i et v3-loeb faar IKKE en kaptajn tilfoejet", () => {
  const out = resolveBoardRoles({ riderIds: ids, sprintCaptainId: "b", sprintLeaderAllowed: true, suitabilityOf });
  assert.equal(out.captain_id, null);
  assert.equal(out.sprint_captain_id, "b");
});

test("#7239: aeldre loeb (ingen sprint_leader_allowed) faar stadig en kaptajn efter fortjeneste", () => {
  const out = resolveBoardRoles({ riderIds: ids, sprintCaptainId: "b", suitabilityOf });
  assert.equal(out.captain_id, "c", "staerkeste rytter uden anden rolle");
  assert.equal(out.sprint_captain_id, "b");
});

test("#7239: uden nogen leder vaelges en kaptajn, ogsaa i v3-loeb", () => {
  const out = resolveBoardRoles({ riderIds: ids, sprintLeaderAllowed: true, suitabilityOf });
  assert.equal(out.captain_id, "b");
});

test("#7239: den delte kaptajn foelger med, og rykker op hvis kaptajnen forsvinder", () => {
  const kept = resolveBoardRoles({ riderIds: ids, captainId: "a", coCaptainId: "c", sprintLeaderAllowed: true, suitabilityOf });
  assert.equal(kept.captain_id, "a");
  assert.equal(kept.co_captain_id, "c");
  const promoted = resolveBoardRoles({ riderIds: ids, captainId: null, coCaptainId: "c", sprintCaptainId: "b", sprintLeaderAllowed: true, suitabilityOf });
  assert.equal(promoted.captain_id, "c");
  assert.equal(promoted.co_captain_id, null);
  assert.equal(promoted.sprint_captain_id, "b");
});

test("#7239: delt kaptajn droppes i aeldre loeb, uden for truppen og ved rolle-overlap", () => {
  assert.equal(resolveBoardRoles({ riderIds: ids, captainId: "a", coCaptainId: "c", suitabilityOf }).co_captain_id, null);
  assert.equal(resolveBoardRoles({ riderIds: ids, captainId: "a", coCaptainId: "z", sprintLeaderAllowed: true, suitabilityOf }).co_captain_id, null);
  assert.equal(resolveBoardRoles({ riderIds: ids, captainId: "a", hunterId: "c", coCaptainId: "c", sprintLeaderAllowed: true, suitabilityOf }).co_captain_id, null);
  const free = resolveBoardRoles({ riderIds: ids, captainId: "a", coCaptainId: "c", freeRoleIds: ["c", "d"], sprintLeaderAllowed: true, suitabilityOf });
  assert.deepEqual(free.free_role_ids, ["d"]);
});

test("#7239: et klik paa en rytter beholder free_role og delt kaptajn", () => {
  const s = { riderIds: ["a", "b", "c"], captainId: "a", sprintCaptainId: null, hunterId: null, freeRoleIds: ["b"], coCaptainId: "c" };
  const added = toggleRider(s, "d", 8);
  assert.deepEqual(added.freeRoleIds, ["b"]);
  assert.equal(added.coCaptainId, "c");
  const removed = toggleRider(s, "c", 8);
  assert.equal(removed.coCaptainId, null);
  assert.deepEqual(toggleRider(s, "b", 8).freeRoleIds, []);
});

test("#7239: klientens validering spejler serverens regler for delt kaptajn", () => {
  const base = { riderIds: ids, captainId: "a", sprintCaptainId: null, hunterId: null, size: { min: 6, max: 8 } };
  assert.deepEqual(validateSelectionClient({ ...base, coCaptainId: "b", sprintLeaderAllowed: true }), []);
  assert.deepEqual(validateSelectionClient({ ...base, coCaptainId: "b" }), ["selection_co_captain_not_available"]);
  assert.deepEqual(
    validateSelectionClient({ ...base, captainId: null, sprintCaptainId: "c", coCaptainId: "b", sprintLeaderAllowed: true }),
    ["selection_co_captain_requires_captain"],
  );
  assert.deepEqual(validateSelectionClient({ ...base, coCaptainId: "a", sprintLeaderAllowed: true }), ["selection_role_overlap"]);
});
