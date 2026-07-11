import { test } from "node:test";
import assert from "node:assert/strict";
import { pickUpcomingRaces } from "./upcomingRaces.js";

function race(id, dateText) {
  return { id, pool_race: dateText == null ? null : { date_text: dateText } };
}

test("sorterer på ægte næste-etape-tid, ikke PCM-dato", () => {
  // "b" har en tidligere PCM-dato-tekst (5/1) end "a" (20/6), men "a"s ægte
  // næste etape kører FØR "b"s — a skal vises først (#2328).
  const races = [race("b", "5/1"), race("a", "20/6")];
  const nextStageMsById = { a: 1000, b: 5000 };
  const ids = pickUpcomingRaces(races, nextStageMsById).map((r) => r.id);
  assert.deepEqual(ids, ["a", "b"]);
});

test("kender alle dagens etaper er kørt → næste dags løb kommer efter (højere ms)", () => {
  const races = [race("today"), race("tomorrow")];
  const nextStageMsById = { today: 2000, tomorrow: 90000 };
  const ids = pickUpcomingRaces(races, nextStageMsById).map((r) => r.id);
  assert.deepEqual(ids, ["today", "tomorrow"]);
});

test("løb uden kendt ægte tid placeres sidst, uanset PCM-dato", () => {
  const races = [race("unknown", "1/1"), race("known", "31/12")];
  const nextStageMsById = { known: 500 };
  const ids = pickUpcomingRaces(races, nextStageMsById).map((r) => r.id);
  assert.deepEqual(ids, ["known", "unknown"]);
});

test("flere løb uden kendt tid falder tilbage til PCM-dato-sortering", () => {
  const races = [race("late", "20/6"), race("early", "5/1")];
  const ids = pickUpcomingRaces(races, {}).map((r) => r.id);
  assert.deepEqual(ids, ["early", "late"]);
});

test("respekterer limit", () => {
  const races = [race("a"), race("b"), race("c"), race("d")];
  const nextStageMsById = { a: 1, b: 2, c: 3, d: 4 };
  const ids = pickUpcomingRaces(races, nextStageMsById, 2).map((r) => r.id);
  assert.deepEqual(ids, ["a", "b"]);
});

test("muterer ikke input-arrayet", () => {
  const races = [race("b", "5/1"), race("a", "20/6")];
  const snapshot = races.map((r) => r.id);
  const sorted = pickUpcomingRaces(races, {});
  assert.deepEqual(races.map((r) => r.id), snapshot);
  assert.notEqual(sorted, races);
});

test("tom / ugyldig liste giver tom liste", () => {
  assert.deepEqual(pickUpcomingRaces([], {}), []);
  assert.deepEqual(pickUpcomingRaces(undefined, {}), []);
  assert.deepEqual(pickUpcomingRaces(null, {}), []);
});
