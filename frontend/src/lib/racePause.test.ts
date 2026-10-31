import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRacePause,
  isRacePauseActive,
  withoutPausedUpcoming,
  isSchedulerSwitchedOff,
  isSeasonInPlay,
  resolveRacePause,
} from "./racePause.ts";

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

// ── #7335: pausen udledes automatisk af kontakten ────────────────────────────
const NOW = Date.parse("2026-10-28T12:00:00Z");
const ACTIVE = { status: "active", race_days_completed: 4, race_days_total: 32 };
const base = { notice: undefined, scheduler: "on", season: ACTIVE, seasonChange: false };

test("isSchedulerSwitchedOff: kun eksplicit off/false er pausebevis", () => {
  assert.equal(isSchedulerSwitchedOff("off"), true);
  assert.equal(isSchedulerSwitchedOff(" OFF "), true);
  assert.equal(isSchedulerSwitchedOff("\"off\""), true);
  assert.equal(isSchedulerSwitchedOff(false), true);
  assert.equal(isSchedulerSwitchedOff("false"), true);
  for (const v of ["on", "beta", true, undefined, null, "", 0, "noget andet"]) {
    assert.equal(isSchedulerSwitchedOff(v), false, `${String(v)} maa ikke give en pause`);
  }
});

test("isSeasonInPlay: aktiv saeson med loebsdage tilbage", () => {
  assert.equal(isSeasonInPlay(ACTIVE), true);
  assert.equal(isSeasonInPlay({ status: "active", race_days_completed: 0, race_days_total: 32 }), true);
  assert.equal(isSeasonInPlay({ status: "active", race_days_completed: null, race_days_total: null }), true);
  assert.equal(isSeasonInPlay({ status: "active", race_days_completed: 32, race_days_total: 32 }), false);
  assert.equal(isSeasonInPlay({ status: "upcoming", race_days_completed: 0, race_days_total: 32 }), false);
  assert.equal(isSeasonInPlay({ status: "completed", race_days_completed: 28, race_days_total: 28 }), false);
  assert.equal(isSeasonInPlay(null), false);
});

test("resolveRacePause: pauset via kontakten = bjaelke uden starttid (ingen notice noedvendig)", () => {
  assert.deepEqual(resolveRacePause({ ...base, scheduler: "off" }, NOW), { paused: true, newStartMs: null });
  assert.deepEqual(resolveRacePause({ ...base, scheduler: false }, NOW), { paused: true, newStartMs: null });
});

test("resolveRacePause: pauset via notice = bjaelke med ny starttid, ogsaa naar kontakten er taendt", () => {
  const iso = "2026-10-28T14:00:00Z";
  assert.deepEqual(
    resolveRacePause({ ...base, notice: { paused: true, new_start: iso } }, NOW),
    { paused: true, newStartMs: Date.parse(iso) },
  );
  // Kontakten slukket + notice: noticens starttid vinder.
  assert.deepEqual(
    resolveRacePause({ ...base, scheduler: "off", notice: { paused: true, new_start: iso } }, NOW),
    { paused: true, newStartMs: Date.parse(iso) },
  );
});

test("resolveRacePause: udloebet notice + kontakten stadig slukket = pausen staar videre uden tid", () => {
  const past = { paused: true, new_start: "2026-10-28T11:00:00Z" };
  assert.deepEqual(resolveRacePause({ ...base, scheduler: "off", notice: past }, NOW), { paused: true, newStartMs: null });
  assert.equal(resolveRacePause({ ...base, scheduler: "on", notice: past }, NOW), null);
});

test("resolveRacePause: saesonpause/saesonskifte = ingen bjaelke (egen blaa bjaelke)", () => {
  assert.equal(resolveRacePause({ ...base, scheduler: "off", seasonChange: true }, NOW), null);
  assert.equal(resolveRacePause({ ...base, notice: { paused: true }, seasonChange: true }, NOW), null);
  // Afsluttet saeson (venter paa skiftet) eller ingen aktiv saeson: kontakten slukket er ikke en loebspause.
  assert.equal(resolveRacePause({ ...base, scheduler: "off", season: { status: "active", race_days_completed: 32, race_days_total: 32 } }, NOW), null);
  assert.equal(resolveRacePause({ ...base, scheduler: "off", season: null }, NOW), null);
});

test("resolveRacePause: ingen pause = ingen bjaelke", () => {
  assert.equal(resolveRacePause(base, NOW), null);
  assert.equal(resolveRacePause({ ...base, scheduler: undefined }, NOW), null);
  assert.equal(resolveRacePause({ ...base, scheduler: "beta" }, NOW), null);
  assert.equal(resolveRacePause({ ...base, notice: { paused: false } }, NOW), null);
  assert.equal(resolveRacePause(null, NOW), null);
});
