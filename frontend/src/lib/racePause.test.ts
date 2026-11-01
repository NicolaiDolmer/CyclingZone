import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRacePause,
  isRacePauseActive,
  withoutPausedUpcoming,
  isSchedulerSwitchedOff,
  resolveRacePause,
  shouldAnnounceRacePause,
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
const base = { notice: undefined, scheduler: "on", seasonInPlay: true, seasonChange: false };

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

test("resolveRacePause: pauset via kontakten = bjaelke uden starttid (ingen notice noedvendig)", () => {
  const p = resolveRacePause({ ...base, scheduler: "off" }, NOW);
  assert.deepEqual(p, { paused: true, newStartMs: null });
  assert.equal(shouldAnnounceRacePause(p), true);
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

test("resolveRacePause: saesonskifte = ingen pause-besked (egen blaa bjaelke), men pausen gaelder stadig", () => {
  for (const inputs of [
    { ...base, scheduler: "off", seasonChange: true },
    { ...base, notice: { paused: true }, seasonChange: true },
  ]) {
    const p = resolveRacePause(inputs, NOW);
    // Dashboardet skjuler fortsat de gamle starttider (Boolean(pause))...
    assert.ok(p);
    assert.equal(p.silent, true);
    // ...men ingen bjaelke/banner: samme besked maa ikke staa to gange.
    assert.equal(shouldAnnounceRacePause(p), false);
  }
});

test("resolveRacePause: kontakten slukket uden en saeson med uafsluttede loeb = ingen pause", () => {
  assert.equal(resolveRacePause({ ...base, scheduler: "off", seasonInPlay: false }, NOW), null);
  // En eksplicit notice gaelder uanset saesonen.
  assert.ok(resolveRacePause({ ...base, notice: { paused: true }, seasonInPlay: false }, NOW));
});

test("resolveRacePause: ingen pause = ingen bjaelke", () => {
  assert.equal(resolveRacePause(base, NOW), null);
  assert.equal(resolveRacePause({ ...base, scheduler: undefined }, NOW), null);
  assert.equal(resolveRacePause({ ...base, scheduler: "beta" }, NOW), null);
  assert.equal(resolveRacePause({ ...base, notice: { paused: false } }, NOW), null);
  assert.equal(resolveRacePause(null, NOW), null);
  assert.equal(shouldAnnounceRacePause(null), false);
});
