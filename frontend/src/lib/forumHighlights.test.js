import { test } from "node:test";
import assert from "node:assert/strict";
import { selectForumHighlights, threadActivityMs } from "./forumHighlights.js";

function thread(id, { created_at, last_reply_at = null } = {}) {
  return { id, created_at, last_reply_at, title: id };
}

test("selectForumHighlights: returnerer de 2 tråde med nyeste aktivitet på tværs af pinned + items", () => {
  const pinned = [thread("pinned-old", { created_at: "2026-01-01T00:00:00Z", last_reply_at: "2026-01-02T00:00:00Z" })];
  const items = [
    thread("recent-reply", { created_at: "2026-08-01T00:00:00Z", last_reply_at: "2026-08-20T00:00:00Z" }),
    thread("newer-post", { created_at: "2026-08-15T00:00:00Z" }),
    thread("oldest", { created_at: "2026-01-05T00:00:00Z" }),
  ];
  const out = selectForumHighlights(pinned, items, 2);
  assert.deepEqual(out.map((t) => t.id), ["recent-reply", "newer-post"]);
});

test("selectForumHighlights: en gammel PINNET tråd fortrænger IKKE en tråd med nyere aktivitet", () => {
  const pinned = [thread("pinned-stale", { created_at: "2020-01-01T00:00:00Z" })];
  const items = [thread("fresh", { created_at: "2026-08-20T00:00:00Z" })];
  const out = selectForumHighlights(pinned, items, 2);
  assert.equal(out[0].id, "fresh");
  assert.equal(out[1].id, "pinned-stale");
});

test("selectForumHighlights: respekterer limit", () => {
  const items = [1, 2, 3, 4].map((n) => thread(`t${n}`, { created_at: `2026-08-0${n}T00:00:00Z` }));
  assert.equal(selectForumHighlights([], items, 2).length, 2);
});

test("selectForumHighlights: tomme lister giver tom liste, ikke en fejl", () => {
  assert.deepEqual(selectForumHighlights([], [], 2), []);
  assert.deepEqual(selectForumHighlights(undefined, undefined, 2), []);
});

test("selectForumHighlights: last_reply_at vinder over created_at når begge findes", () => {
  const a = thread("a", { created_at: "2026-08-01T00:00:00Z", last_reply_at: "2026-08-10T00:00:00Z" });
  const b = thread("b", { created_at: "2026-08-05T00:00:00Z" }); // ingen svar endnu
  const out = selectForumHighlights([], [a, b], 2);
  assert.deepEqual(out.map((t) => t.id), ["a", "b"]);
});

test("threadActivityMs: ugyldig/manglende dato giver 0, aldrig NaN eller en kastet fejl", () => {
  assert.equal(threadActivityMs({}), 0);
  assert.equal(threadActivityMs({ created_at: "not-a-date" }), 0);
  assert.equal(threadActivityMs(null), 0);
});
