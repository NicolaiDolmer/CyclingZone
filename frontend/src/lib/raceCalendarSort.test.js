import { test } from "node:test";
import assert from "node:assert/strict";
import { sortRacesByDateDesc, raceDayOfYear } from "./raceCalendarSort.js";

// #1930 — Afsluttede løb skal som standard vises nyeste-først. Sorteringen spejler
// kommende-listens dato-nøgle (dateTextToDayOfYear) men faldende. Den rene logik
// enhedstestes, så rækkefølgen er korrekt uafhængigt af UI-render.

function race(id, dateText) {
  return { id, pool_race: dateText == null ? null : { date_text: dateText } };
}

test("sorterer nyeste (seneste dato) øverst", () => {
  const races = [
    race("mar", "10/3"),
    race("jul", "5/7"),
    race("jan", "2/1"),
  ];
  const ids = sortRacesByDateDesc(races).map((r) => r.id);
  assert.deepEqual(ids, ["jul", "mar", "jan"]);
});

test("dag skiller inden for samme måned (nyeste dag først)", () => {
  const races = [
    race("early", "1/6"),
    race("late", "28/6"),
    race("mid", "15/6"),
  ];
  const ids = sortRacesByDateDesc(races).map((r) => r.id);
  assert.deepEqual(ids, ["late", "mid", "early"]);
});

test("løb uden gyldig dato placeres nederst", () => {
  const races = [
    race("nodate", null),
    race("jul", "5/7"),
    race("jan", "2/1"),
  ];
  const ids = sortRacesByDateDesc(races).map((r) => r.id);
  assert.deepEqual(ids, ["jul", "jan", "nodate"]);
});

test("flere daterede løb sorteres, udaterede bevarer stabil rækkefølge nederst", () => {
  const races = [
    race("nd1", null),
    race("aug", "1/8"),
    race("nd2", ""),
    race("feb", "20/2"),
  ];
  const ids = sortRacesByDateDesc(races).map((r) => r.id);
  assert.deepEqual(ids, ["aug", "feb", "nd1", "nd2"]);
});

test("samme dato bevarer stabil (input-)rækkefølge", () => {
  const races = [
    race("a", "5/7"),
    race("b", "5/7"),
    race("c", "5/7"),
  ];
  const ids = sortRacesByDateDesc(races).map((r) => r.id);
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("muterer ikke input-arrayet", () => {
  const races = [race("jan", "2/1"), race("jul", "5/7")];
  const snapshot = races.map((r) => r.id);
  const sorted = sortRacesByDateDesc(races);
  assert.deepEqual(races.map((r) => r.id), snapshot); // input uændret
  assert.notEqual(sorted, races); // ny array
});

test("tom / ugyldig liste giver tom liste", () => {
  assert.deepEqual(sortRacesByDateDesc([]), []);
  assert.deepEqual(sortRacesByDateDesc(undefined), []);
  assert.deepEqual(sortRacesByDateDesc(null), []);
});

test("raceDayOfYear læser pool_race.date_text og håndterer manglende dato", () => {
  assert.equal(raceDayOfYear(race("x", "5/7")), 7 * 32 + 5);
  assert.equal(raceDayOfYear(race("x", null)), Infinity);
  assert.equal(raceDayOfYear({}), Infinity);
  assert.equal(raceDayOfYear(undefined), Infinity);
});
