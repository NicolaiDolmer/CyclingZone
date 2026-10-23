import test from "node:test";
import assert from "node:assert/strict";
import { parseRacePause, isRacePauseActive, withoutPausedUpcoming } from "./racePause.ts";

test("parseRacePause: objekt og JSON-streng med ny start", () => {
  const iso = "2026-10-23T14:00:00Z";
  assert.deepEqual(parseRacePause({ paused: true, new_start: iso }), { paused: true, newStartMs: Date.parse(iso) });
  assert.deepEqual(parseRacePause(JSON.stringify({ paused: true, new_start: iso })), { paused: true, newStartMs: Date.parse(iso) });
});

test("parseRacePause: ny start er valgfri og ugyldig dato giver null-start", () => {
  assert.deepEqual(parseRacePause({ paused: true }), { paused: true, newStartMs: null });
  assert.deepEqual(parseRacePause({ paused: true, new_start: "ikke en dato" }), { paused: true, newStartMs: null });
});

test("parseRacePause: ikke pauset, ukendt form eller defekt JSON = null", () => {
  assert.equal(parseRacePause(null), null);
  assert.equal(parseRacePause(undefined), null);
  assert.equal(parseRacePause({ paused: false }), null);
  assert.equal(parseRacePause({ paused: "true" }), null);
  assert.equal(parseRacePause("{broken"), null);
  assert.equal(parseRacePause(42), null);
});

test("isRacePauseActive: udloeber naar den nye start er naaet", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  assert.equal(isRacePauseActive(null, now), false);
  assert.equal(isRacePauseActive({ paused: true, newStartMs: null }, now), true);
  assert.equal(isRacePauseActive({ paused: true, newStartMs: now + 1 }, now), true);
  assert.equal(isRacePauseActive({ paused: true, newStartMs: now }, now), false);
  assert.equal(isRacePauseActive({ paused: true, newStartMs: now - 1000 }, now), false);
});

test("withoutPausedUpcoming: skjuler kun kommende kort mens pausen staar", () => {
  const stages = { loading: false, cards: [{ state: "upcoming" }, { state: "live" }, { state: "finished" }] };
  assert.deepEqual(withoutPausedUpcoming(stages, true).cards.map((c) => c.state), ["live", "finished"]);
  assert.equal(withoutPausedUpcoming(stages, false), stages);
  assert.equal(withoutPausedUpcoming(stages, true).loading, false);
});

test("withoutPausedUpcoming: forfalden etape uden resultat (LIVE) skjules, kørt etape i afspilningsvindue bevares", () => {
  const stages = { cards: [
    { state: "live", stageNumber: 1, stagesCompleted: 0 },
    { state: "live", stageNumber: 2, stagesCompleted: 2 },
    { state: "finished", stageNumber: 1, stagesCompleted: 1 },
  ] };
  assert.deepEqual(withoutPausedUpcoming(stages, true).cards.map((c) => c.stageNumber + c.state), ["2live", "1finished"]);
});
