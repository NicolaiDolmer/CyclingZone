// #8853 · indbakkens løbsniveau-opslag: hvilke beskeder peger på et løb, og
// hvilke løb får et U23-/juniormærke.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateRaceId,
  collectNotificationRaceIds,
  notificationRaceId,
  youthSquadMap,
} from "./notificationRaceSquad.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

test("metadata.raceId er løbets id uanset beskedtype", () => {
  assert.equal(notificationRaceId({ type: "career_milestone", metadata: { raceId: A } }), A);
});

test("related_id tæller kun som løb på løbsbeskeder", () => {
  assert.equal(notificationRaceId({ type: "race_result", related_id: A }), A);
  assert.equal(notificationRaceId({ type: "auction_outbid", related_id: OTHER }), null);
});

test("ikke-uuid og manglende værdier giver null", () => {
  assert.equal(notificationRaceId({ type: "race_result", metadata: { raceId: "x" } }), null);
  assert.equal(notificationRaceId(null), null);
  assert.equal(notificationRaceId({ type: "race_result" }), null);
});

test("samlet bøtte: sample_metadata, så related_id, så første besked", () => {
  assert.equal(aggregateRaceId({ sample_metadata: { raceId: A }, related_id: B }), A);
  assert.equal(aggregateRaceId({ related_id: B }), B);
  assert.equal(aggregateRaceId({ items: [{ type: "stage_result", related_id: A }] }), A);
  assert.equal(aggregateRaceId(null), null);
});

test("collectNotificationRaceIds er unik og stabilt sorteret", () => {
  const ids = collectNotificationRaceIds([
    { type: "race_result", related_id: B },
    { type: "stage_result", metadata: { raceId: A } },
    { type: "race_result", related_id: B },
    { type: "auction_outbid", related_id: OTHER },
  ]);
  assert.deepEqual(ids, [A, B]);
});

test("youthSquadMap tager kun U23- og juniorløb med", () => {
  const map = youthSquadMap([
    { id: A, squad: "u23" },
    { id: B, squad: "junior" },
    { id: OTHER, squad: "senior" },
    { id: null, squad: "u23" },
  ]);
  assert.equal(map.get(A), "u23");
  assert.equal(map.get(B), "junior");
  assert.equal(map.has(OTHER), false);
  assert.equal(map.size, 2);
});
