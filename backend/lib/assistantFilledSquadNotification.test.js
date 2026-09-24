// backend/lib/assistantFilledSquadNotification.test.js
// #4759: enhedstests for selve builderen/wrapperen. De to reelle kaldesteders
// adfaerd (hvornaar den kaldes/ikke kaldes) er daekket i raceRunnerAutofill.test.js
// (sen redning) og raceEntryGenerator.test.js (late_fill/opt_in).
import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSISTANT_FILLED_SQUAD_TYPE,
  buildAssistantFilledSquadNotification,
  notifyAssistantFilledSquad,
} from "./assistantFilledSquadNotification.js";

test("buildAssistantFilledSquadNotification: EN-tekst + metadata-koder til DA-rendering", () => {
  const payload = buildAssistantFilledSquadNotification({ raceId: "race-1", raceName: "Paris-Roubaix" });
  assert.equal(payload.type, ASSISTANT_FILLED_SQUAD_TYPE);
  assert.equal(payload.type, "assistant_filled_squad");
  assert.match(payload.title, /Assistant filled your squad/);
  assert.match(payload.message, /Paris-Roubaix/);
  assert.match(payload.message, /no selection in/i);
  assert.equal(payload.relatedId, "race-1");
  assert.equal(payload.metadata.raceId, "race-1");
  assert.equal(payload.metadata.titleCode, "notif.assistantFilledSquad.title");
  assert.equal(payload.metadata.messageCode, "notif.assistantFilledSquad.message");
  assert.deepEqual(payload.metadata.messageParams, { race: "Paris-Roubaix" });
});

test("buildAssistantFilledSquadNotification: falder til 'your race' uden raceName", () => {
  const payload = buildAssistantFilledSquadNotification({ raceId: "race-1" });
  assert.match(payload.message, /your race/);
  assert.equal(payload.metadata.messageParams.race, "your race");
});

test("notifyAssistantFilledSquad: kalder injiceret notify med teamId + payload", async () => {
  const calls = [];
  const notify = async (args) => { calls.push(args); return { delivered: true }; };
  const res = await notifyAssistantFilledSquad({
    supabase: "SB", teamId: "t1", raceId: "r1", raceName: "Tour de Test", notify, now: new Date("2026-01-01"),
  });
  assert.equal(res.delivered, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].supabase, "SB");
  assert.equal(calls[0].teamId, "t1");
  assert.equal(calls[0].type, "assistant_filled_squad");
  assert.match(calls[0].message, /Tour de Test/);
});

test("notifyAssistantFilledSquad: manglende teamId eller raceId → intet kald, klar reason", async () => {
  const calls = [];
  const notify = async (args) => { calls.push(args); return { delivered: true }; };
  const res1 = await notifyAssistantFilledSquad({ supabase: "SB", teamId: null, raceId: "r1", notify });
  const res2 = await notifyAssistantFilledSquad({ supabase: "SB", teamId: "t1", raceId: null, notify });
  assert.equal(res1.reason, "missing_target");
  assert.equal(res2.reason, "missing_target");
  assert.deepEqual(calls, [], "notify kaldes ALDRIG uden begge id'er");
});
