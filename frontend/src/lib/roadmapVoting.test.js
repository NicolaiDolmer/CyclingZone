import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGINE_ORDER,
  SCALE,
  itemTitle,
  groupItemsByEngine,
  isValidScore,
  buildVotePayload,
  votesByItemId,
} from "./roadmapVoting.js";

test("SCALE is 1-6 with no neutral midpoint (even step count)", () => {
  assert.deepEqual(SCALE, [1, 2, 3, 4, 5, 6]);
  assert.equal(SCALE.length % 2, 0);
});

test("itemTitle picks DA for danish locales and EN otherwise", () => {
  const item = { title_en: "Deadline day", title_da: "Deadlineday" };
  assert.equal(itemTitle(item, "da"), "Deadlineday");
  assert.equal(itemTitle(item, "da-DK"), "Deadlineday");
  assert.equal(itemTitle(item, "en"), "Deadline day");
  assert.equal(itemTitle(item, undefined), "Deadline day");
});

test("groupItemsByEngine buckets by engine and sorts by sort_order", () => {
  const grouped = groupItemsByEngine([
    { engine: "market", sort_order: 2, title_en: "B" },
    { engine: "market", sort_order: 1, title_en: "A" },
    { engine: "races", sort_order: 1, title_en: "C" },
    { engine: "unknown-engine", sort_order: 1, title_en: "D" },
  ]);
  assert.deepEqual(Object.keys(grouped), ENGINE_ORDER);
  assert.deepEqual(grouped.market.map((i) => i.title_en), ["A", "B"]);
  assert.deepEqual(grouped.races.map((i) => i.title_en), ["C"]);
  assert.deepEqual(grouped.training, []);
  // Ukendte engines droppes frem for at vælte siden.
  assert.ok(!Object.values(grouped).flat().some((i) => i.title_en === "D"));
});

test("groupItemsByEngine tolerates null/undefined input", () => {
  assert.deepEqual(Object.keys(groupItemsByEngine(null)), ENGINE_ORDER);
  assert.deepEqual(groupItemsByEngine(undefined).races, []);
});

test("isValidScore accepts only integers 1-6", () => {
  for (const n of SCALE) assert.equal(isValidScore(n), true);
  for (const bad of [0, 7, 3.5, "4", null, undefined, NaN]) {
    assert.equal(isValidScore(bad), false, `expected ${String(bad)} to be invalid`);
  }
});

test("buildVotePayload maps to roadmap_votes columns", () => {
  const payload = buildVotePayload({
    itemId: "item-1",
    userId: "user-1",
    ideaScore: 5,
    importanceScore: 6,
  });
  assert.equal(payload.item_id, "item-1");
  assert.equal(payload.user_id, "user-1");
  assert.equal(payload.idea_score, 5);
  assert.equal(payload.importance_score, 6);
  assert.ok(typeof payload.updated_at === "string" && !Number.isNaN(Date.parse(payload.updated_at)));
});

test("buildVotePayload rejects missing ids and out-of-range scores", () => {
  assert.throws(() => buildVotePayload({ itemId: "", userId: "u", ideaScore: 3, importanceScore: 3 }));
  assert.throws(() => buildVotePayload({ itemId: "i", userId: null, ideaScore: 3, importanceScore: 3 }));
  assert.throws(() => buildVotePayload({ itemId: "i", userId: "u", ideaScore: 0, importanceScore: 3 }));
  assert.throws(() => buildVotePayload({ itemId: "i", userId: "u", ideaScore: 3, importanceScore: 9 }));
});

test("votesByItemId maps rows to a lookup", () => {
  const map = votesByItemId([
    { item_id: "a", idea_score: 2, importance_score: 3 },
    { item_id: "b", idea_score: 6, importance_score: 1 },
  ]);
  assert.equal(map.get("a").idea_score, 2);
  assert.equal(map.get("b").importance_score, 1);
  assert.equal(votesByItemId(null).size, 0);
});
