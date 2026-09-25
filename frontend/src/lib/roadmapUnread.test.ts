import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isRoadmapUnread,
  isRoadmapItemNew,
  latestRoadmapCreatedAt,
  LAST_SEEN_KEY,
} from "./roadmapUnread.ts";

test("isRoadmapUnread er true ved første besøg (ingen lastSeen) — #5673 B: intet seed nødvendigt", () => {
  assert.equal(isRoadmapUnread("2026-09-24T10:00:00Z", null), true);
  assert.equal(isRoadmapUnread("2026-09-24T10:00:00Z", undefined), true);
});

test("isRoadmapUnread er true når nyeste created_at er efter lastSeen", () => {
  assert.equal(isRoadmapUnread("2026-09-24T10:00:00Z", "2026-09-20T00:00:00Z"), true);
});

test("isRoadmapUnread er false når lastSeen er samme tidspunkt eller nyere", () => {
  assert.equal(isRoadmapUnread("2026-09-24T10:00:00Z", "2026-09-24T10:00:00Z"), false);
  assert.equal(isRoadmapUnread("2026-09-20T00:00:00Z", "2026-09-24T10:00:00Z"), false);
});

test("isRoadmapUnread er false uden et kendt nyeste tidspunkt", () => {
  assert.equal(isRoadmapUnread(null, null), false);
  assert.equal(isRoadmapUnread(undefined, "2026-09-20T00:00:00Z"), false);
});

test("isRoadmapItemNew genbruger samme sammenligning som isRoadmapUnread", () => {
  assert.equal(isRoadmapItemNew("2026-09-24T10:00:00Z", null), true);
  assert.equal(isRoadmapItemNew("2026-09-20T00:00:00Z", "2026-09-24T10:00:00Z"), false);
});

test("latestRoadmapCreatedAt finder det nyeste created_at i en liste", () => {
  const items = [
    { created_at: "2026-09-20T00:00:00Z" },
    { created_at: "2026-09-24T10:00:00Z" },
    { created_at: "2026-09-22T00:00:00Z" },
  ];
  assert.equal(latestRoadmapCreatedAt(items), "2026-09-24T10:00:00Z");
});

test("latestRoadmapCreatedAt returnerer null for tom/manglende liste", () => {
  assert.equal(latestRoadmapCreatedAt([]), null);
  assert.equal(latestRoadmapCreatedAt(null), null);
  assert.equal(latestRoadmapCreatedAt(undefined), null);
});

test("latestRoadmapCreatedAt springer punkter uden created_at over", () => {
  const items = [{ created_at: null }, { created_at: "2026-09-24T10:00:00Z" }, {}];
  assert.equal(latestRoadmapCreatedAt(items), "2026-09-24T10:00:00Z");
});

test("LAST_SEEN_KEY er en egen nøgle, adskilt fra patch notes' cz_patchnotes_last_seen", () => {
  assert.equal(LAST_SEEN_KEY, "cz_roadmap_last_seen");
});
