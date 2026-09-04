import test from "node:test";
import assert from "node:assert/strict";
import { computeForumUnreadFold } from "./forumUnreadFold.js";

function reply(id, created_at) {
  return { id, created_at };
}

test("computeForumUnreadFold: første besøg (ingen previousReadAt) giver ingen fold", () => {
  const replies = [reply("r1", "2026-09-01T10:00:00Z"), reply("r2", "2026-09-01T11:00:00Z")];
  const result = computeForumUnreadFold({ replies, previousReadAt: null });
  assert.deepEqual(result, { hasFold: false, earlierReplies: [], unreadReplies: replies, firstUnreadId: null });
});

test("computeForumUnreadFold: ingen svar giver ingen fold uanset previousReadAt", () => {
  const result = computeForumUnreadFold({ replies: [], previousReadAt: "2026-09-01T10:00:00Z" });
  assert.deepEqual(result, { hasFold: false, earlierReplies: [], unreadReplies: [], firstUnreadId: null });
});

test("computeForumUnreadFold: ingen svar nyere end sidst læst giver ingen fold", () => {
  const replies = [reply("r1", "2026-09-01T09:00:00Z"), reply("r2", "2026-09-01T09:30:00Z")];
  const result = computeForumUnreadFold({ replies, previousReadAt: "2026-09-01T10:00:00Z" });
  assert.deepEqual(result, { hasFold: false, earlierReplies: [], unreadReplies: replies, firstUnreadId: null });
});

test("computeForumUnreadFold: alt ulæst (læst FØR første svar) foldes ikke, men markerer det første", () => {
  const replies = [reply("r1", "2026-09-01T11:00:00Z"), reply("r2", "2026-09-01T12:00:00Z")];
  const result = computeForumUnreadFold({ replies, previousReadAt: "2026-09-01T10:00:00Z" });
  assert.deepEqual(result, { hasFold: false, earlierReplies: [], unreadReplies: replies, firstUnreadId: "r1" });
});

test("computeForumUnreadFold: splitter ved første svar nyere end sidst læst", () => {
  const replies = [
    reply("r1", "2026-09-01T09:00:00Z"),
    reply("r2", "2026-09-01T09:30:00Z"),
    reply("r3", "2026-09-01T11:00:00Z"),
    reply("r4", "2026-09-01T12:00:00Z"),
  ];
  const result = computeForumUnreadFold({ replies, previousReadAt: "2026-09-01T10:00:00Z" });
  assert.equal(result.hasFold, true);
  assert.deepEqual(result.earlierReplies.map((r) => r.id), ["r1", "r2"]);
  assert.deepEqual(result.unreadReplies.map((r) => r.id), ["r3", "r4"]);
  assert.equal(result.firstUnreadId, "r3");
});

test("computeForumUnreadFold: et svar præcis på tidspunktet er IKKE ulæst (streng >, ikke >=)", () => {
  const replies = [reply("r1", "2026-09-01T10:00:00Z"), reply("r2", "2026-09-01T10:00:01Z")];
  const result = computeForumUnreadFold({ replies, previousReadAt: "2026-09-01T10:00:00Z" });
  // r1 er præcis på tidspunktet (ikke nyere) og er derfor stadig "læst" og
  // foldes; r2 er ét sekund efter og er det første ulæste.
  assert.equal(result.hasFold, true);
  assert.deepEqual(result.earlierReplies.map((r) => r.id), ["r1"]);
  assert.equal(result.firstUnreadId, "r2");
});

test("computeForumUnreadFold: ugyldig previousReadAt (NaN-dato) falder tilbage til ingen fold", () => {
  const replies = [reply("r1", "2026-09-01T10:00:00Z")];
  const result = computeForumUnreadFold({ replies, previousReadAt: "not-a-date" });
  assert.deepEqual(result, { hasFold: false, earlierReplies: [], unreadReplies: replies, firstUnreadId: null });
});
