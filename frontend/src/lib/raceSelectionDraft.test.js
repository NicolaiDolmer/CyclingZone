// #5098 — udkastets kontrakt: ét slot, per-løb, og aldrig en trup/rolle der
// ikke findes i serverens svar.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rememberSelectionDraft,
  readSelectionDraft,
  forgetSelectionDraft,
  reconcileSelectionDraft,
} from "./raceSelectionDraft.js";

const DRAFT = {
  riderIds: ["r1", "r2", "r3"],
  captainId: "r1",
  sprintCaptainId: "r2",
  hunterId: "r3",
  freeRoleIds: ["r2"],
};

test("udkastet kan læses igen for samme løb (fane-skift-tilfældet)", () => {
  rememberSelectionDraft("race-a", DRAFT);
  assert.deepEqual(readSelectionDraft("race-a"), DRAFT);
  forgetSelectionDraft("race-a");
});

test("et udkast fra et andet løb svarer null", () => {
  rememberSelectionDraft("race-a", DRAFT);
  assert.equal(readSelectionDraft("race-b"), null);
  forgetSelectionDraft("race-a");
});

test("raceId sammenlignes som tekst — 42 og \"42\" er samme løb", () => {
  rememberSelectionDraft(42, DRAFT);
  assert.deepEqual(readSelectionDraft("42")?.riderIds, DRAFT.riderIds);
  forgetSelectionDraft(42);
  assert.equal(readSelectionDraft(42), null);
});

test("forget rører ikke et udkast der hører til et andet løb", () => {
  rememberSelectionDraft("race-a", DRAFT);
  forgetSelectionDraft("race-b");
  assert.notEqual(readSelectionDraft("race-a"), null);
  forgetSelectionDraft("race-a");
  assert.equal(readSelectionDraft("race-a"), null);
});

test("udkastet deler ikke reference med den der gemte det", () => {
  const live = { ...DRAFT, riderIds: [...DRAFT.riderIds] };
  rememberSelectionDraft("race-a", live);
  live.riderIds.push("r9");
  assert.deepEqual(readSelectionDraft("race-a").riderIds, ["r1", "r2", "r3"]);
  forgetSelectionDraft("race-a");
});

test("kun ét slot: et nyt løbs udkast overskriver det forrige", () => {
  rememberSelectionDraft("race-a", DRAFT);
  rememberSelectionDraft("race-b", { ...DRAFT, riderIds: ["r7"] });
  assert.equal(readSelectionDraft("race-a"), null);
  assert.deepEqual(readSelectionDraft("race-b").riderIds, ["r7"]);
  forgetSelectionDraft("race-b");
});

test("manglende raceId huskes ikke og læses ikke", () => {
  rememberSelectionDraft(null, DRAFT);
  assert.equal(readSelectionDraft(null), null);
});

test("reconcile fjerner ryttere der ikke længere er i svaret", () => {
  const out = reconcileSelectionDraft(DRAFT, [{ id: "r1" }, { id: "r3" }]);
  assert.deepEqual(out.riderIds, ["r1", "r3"]);
});

test("reconcile nulstiller en rolle hvis rytteren faldt ud", () => {
  const out = reconcileSelectionDraft(DRAFT, [{ id: "r1" }, { id: "r3" }]);
  assert.equal(out.captainId, "r1");
  assert.equal(out.sprintCaptainId, null); // r2 er væk
  assert.equal(out.hunterId, "r3");
  assert.deepEqual(out.freeRoleIds, []);
});

test("reconcile uden rytterliste kaster ikke managerens arbejde væk", () => {
  assert.deepEqual(reconcileSelectionDraft(DRAFT, null), DRAFT);
  assert.deepEqual(reconcileSelectionDraft(DRAFT, undefined), DRAFT);
});

test("reconcile af et tomt udkast giver den tomme udtagelse", () => {
  assert.deepEqual(reconcileSelectionDraft(null, [{ id: "r1" }]), {
    riderIds: [], captainId: null, sprintCaptainId: null, hunterId: null, freeRoleIds: [],
  });
});
