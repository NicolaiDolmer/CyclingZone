import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDefaultSeason } from "./seasonEndDefault.js";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-08-04T12:00:00Z");

function iso(daysAgo) {
  return new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

test("pickDefaultSeason: empty list returns null", () => {
  assert.equal(pickDefaultSeason([], NOW), null);
});

test("pickDefaultSeason: no active season falls back to newest (seasons[0])", () => {
  const seasons = [
    { id: "s2", number: 2, status: "completed" },
    { id: "s1", number: 1, status: "completed" },
  ];
  assert.equal(pickDefaultSeason(seasons, NOW).id, "s2");
});

test("pickDefaultSeason: active season just started (within window) prefers latest completed", () => {
  const seasons = [
    { id: "s2", number: 2, status: "active", start_date: iso(2) },
    { id: "s1", number: 1, status: "completed" },
  ];
  assert.equal(pickDefaultSeason(seasons, NOW).id, "s1");
});

test("pickDefaultSeason: active season exactly at window boundary still prefers completed", () => {
  const seasons = [
    { id: "s2", number: 2, status: "active", start_date: iso(7) },
    { id: "s1", number: 1, status: "completed" },
  ];
  assert.equal(pickDefaultSeason(seasons, NOW).id, "s1");
});

test("pickDefaultSeason: active season well past window prefers the active season", () => {
  const seasons = [
    { id: "s2", number: 2, status: "active", start_date: iso(30) },
    { id: "s1", number: 1, status: "completed" },
  ];
  assert.equal(pickDefaultSeason(seasons, NOW).id, "s2");
});

test("pickDefaultSeason: active season with no completed season ever prefers active regardless of window", () => {
  const seasons = [{ id: "s1", number: 1, status: "active", start_date: iso(1) }];
  assert.equal(pickDefaultSeason(seasons, NOW).id, "s1");
});

test("pickDefaultSeason: missing start_date on active season fails open to active", () => {
  const seasons = [
    { id: "s2", number: 2, status: "active" },
    { id: "s1", number: 1, status: "completed" },
  ];
  assert.equal(pickDefaultSeason(seasons, NOW).id, "s2");
});

test("pickDefaultSeason: start_date in the future (data error) fails open to active", () => {
  const seasons = [
    { id: "s2", number: 2, status: "active", start_date: iso(-5) },
    { id: "s1", number: 1, status: "completed" },
  ];
  assert.equal(pickDefaultSeason(seasons, NOW).id, "s2");
});
