import test from "node:test";
import assert from "node:assert/strict";

import { summarizeTopResultsByUser, formatTopResults, fetchRaceTopResults } from "./raceInboxTopResults.js";
import { emitRaceResultNotifications } from "./notificationService.js";

const RACE = { id: "race-1", name: "Clásica de Prueba" };

const human = (userId) => ({ user_id: userId, is_ai: false, is_frozen: false });

test("summarizeTopResultsByUser: bedste 3 pr. manager, sorteret efter placering, AI/frosne udeladt", () => {
  const rows = [
    { rider_name: "A", rank: 9, team: human("u1") },
    { rider_name: "B", rank: 2, team: human("u1") },
    { rider_name: "C", rank: 14, team: human("u1") },
    { rider_name: "D", rank: 5, team: human("u1") },
    { rider_name: "E", rank: 1, team: { user_id: "ai", is_ai: true, is_frozen: false } },
    { rider_name: "F", rank: 3, team: { user_id: "u2", is_ai: false, is_frozen: true } },
    { rider_name: "G", rank: null, team: human("u3") },
  ];
  const out = summarizeTopResultsByUser(rows);
  assert.deepEqual(out.get("u1"), [
    { riderName: "B", rank: 2 },
    { riderName: "D", rank: 5 },
    { riderName: "A", rank: 9 },
  ]);
  assert.equal(out.has("ai"), false);
  assert.equal(out.has("u2"), false);
  assert.equal(out.has("u3"), false);
});

test("formatTopResults: sprogneutral '#n'-streng, null uden resultater", () => {
  assert.equal(formatTopResults([{ riderName: "B", rank: 2 }, { riderName: "D", rank: 5 }]), "B (#2), D (#5)");
  assert.equal(formatTopResults([]), null);
  assert.equal(formatTopResults(undefined), null);
});

test("fetchRaceTopResults: degraderer til tomt Map uden supabase.from og ved DB-fejl", async () => {
  assert.equal((await fetchRaceTopResults({ supabase: {}, race: RACE })).size, 0);
  const failing = {
    from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: null, error: new Error("boom") }) }) }) }),
  };
  assert.equal((await fetchRaceTopResults({ supabase: failing, race: RACE })).size, 0);
});

function recorder() {
  const calls = [];
  return { calls, notify: async (args) => { calls.push(args); return { delivered: true }; } };
}

const TOP = new Map([["u1", [{ riderName: "B", rank: 2 }, { riderName: "D", rank: 5 }]]]);

test("emitRaceResultNotifications: standard-besked viser bedste ryttere + i18n-kode med riders-param (#7085)", async () => {
  const { notify, calls } = recorder();
  await emitRaceResultNotifications({
    supabase: {}, race: RACE, notify,
    fetchParticipatingManagers: async () => ["u1"],
    fetchFirstTimeManagers: async () => new Set(),
    fetchRaceNarrative: async () => null,
    fetchTopResults: async () => TOP,
  });
  const call = calls[0];
  assert.equal(call.message, "Clásica de Prueba has been run. Your best: B (#2), D (#5).");
  assert.equal(call.metadata.messageCode, "notif.raceResult.messageBest");
  assert.deepEqual(call.metadata.messageParams, { race: "Clásica de Prueba", riders: "B (#2), D (#5)" });
  assert.equal(call.metadata.raceId, "race-1", "deep-link-metadata uændret");
});

test("emitRaceResultNotifications: første-løb-variant bruger firstRaceResult.messageBest", async () => {
  const { notify, calls } = recorder();
  await emitRaceResultNotifications({
    supabase: {}, race: RACE, notify,
    fetchParticipatingManagers: async () => ["u1"],
    fetchFirstTimeManagers: async () => new Set(["u1"]),
    fetchRaceNarrative: async () => null,
    fetchTopResults: async () => TOP,
  });
  assert.equal(calls[0].metadata.messageCode, "notif.firstRaceResult.messageBest");
  assert.equal(calls[0].title, "Your first race is in the books");
});

test("emitRaceResultNotifications: narrativ besked viser bedste ryttere i stedet for rene placeringer", async () => {
  const { notify, calls } = recorder();
  await emitRaceResultNotifications({
    supabase: {}, race: RACE, notify,
    fetchParticipatingManagers: async () => ["u1"],
    fetchFirstTimeManagers: async () => new Set(),
    fetchRaceNarrative: async () => ({
      headlineText: "B takes the sprint",
      ranksByUser: new Map([["u1", [2, 5]]]),
      riderIdsByUser: new Map([["u1", new Set(["r-b"])]]),
      headlineRiderIds: ["r-b"],
    }),
    fetchTopResults: async () => TOP,
  });
  assert.equal(calls[0].title, "B takes the sprint");
  assert.equal(calls[0].message, "Clásica de Prueba has been run. Your best: B (#2), D (#5).");
});

test("emitRaceResultNotifications: manager uden top-resultater faar uændret standard-copy", async () => {
  const { notify, calls } = recorder();
  await emitRaceResultNotifications({
    supabase: {}, race: RACE, notify,
    fetchParticipatingManagers: async () => ["u9"],
    fetchFirstTimeManagers: async () => new Set(),
    fetchRaceNarrative: async () => null,
    fetchTopResults: async () => TOP,
  });
  assert.equal(calls[0].message, "Clásica de Prueba has been run. View the result.");
  assert.equal(calls[0].metadata.messageCode, "notif.raceResult.message");
});
