import test from "node:test";
import assert from "node:assert/strict";
import * as notices from "./retirementNotice.js";

const noWrites = { from() { throw new Error("display must not touch an outstanding retirement promise"); } };
const promised = { id: "fixture-rider", birthdate: "1992-06-01", is_retired: false, retirement_notice_season: 4, retirement_notice_after_season: 4, retirement_notice_given_at: "2026-09-27T18:00:00.000Z" };

test("display keeps the promised final season after the active season advances", async () => {
  const result = await notices.resolveRetirementNoticeForDisplay(noWrites, promised, 5);
  assert.equal(result.announced, true);
  assert.equal(result.season, 4);
  assert.equal(result.shouldFreeze, false);
});

test("display does not turn a frozen previous-season no into an old promise", async () => {
  const result = await notices.resolveRetirementNoticeForDisplay(null, { ...promised, retirement_notice_after_season: null }, 5);
  assert.equal(result.season, 5);
});

test("guaranteed retirement without a stored roll stays with the completed season", async () => {
  const result = await notices.resolveRetirementNoticeForDisplay(noWrites, { id: "guaranteed", birthdate: "1900-06-01", is_retired: false }, 5);
  assert.equal(result.announced, true);
  assert.equal(result.season, 4);
  assert.equal(result.shouldFreeze, false);
});

test("already retired riders do not receive a new final-season promise", async () => {
  const result = await notices.resolveRetirementNoticeForDisplay(noWrites, { ...promised, is_retired: true }, 5);
  assert.equal(result.announced, false);
  assert.equal(result.season, null);
});

test("a current-season frozen promise keeps its existing answer", async () => {
  const result = await notices.resolveRetirementNoticeForDisplay(noWrites, promised, 4);
  assert.equal(result.announced, true);
  assert.equal(result.season, 4);
  assert.equal(result.frozen, true);
});

test("an outstanding older frozen promise is not overwritten by a newer season", async () => {
  const result = await notices.resolveRetirementNoticeForDisplay(noWrites, { ...promised, retirement_notice_season: 3, retirement_notice_after_season: 3 }, 5);
  assert.equal(result.season, 3);
  assert.equal(result.announced, true);
});
