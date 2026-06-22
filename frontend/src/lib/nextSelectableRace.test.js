import { test } from "node:test";
import assert from "node:assert/strict";
import { pickNextSelectableRace, selectableRaces } from "./nextSelectableRace.js";

// #1681 — discoverability for holdudtagelse. Den rene logik "hvilket kommende løb
// kan jeg udtage hold til lige nu" skal være enhedstestet, så dashboard-CTA'en
// og nav-genvejen peger på det rigtige løb uafhængigt af UI-render.

function race(id, status, dateText) {
  return { id, status, pool_race: dateText ? { date_text: dateText } : null };
}

test("selectableRaces beholder kun scheduled-løb", () => {
  const races = [
    race("a", "scheduled", "5/7"),
    race("b", "completed", "1/7"),
    race("c", "active", "3/7"),
    race("d", "scheduled", "8/7"),
  ];
  const ids = selectableRaces(races).map((r) => r.id);
  assert.deepEqual(ids, ["a", "d"]);
});

test("pickNextSelectableRace vælger det tidligste scheduled-løb efter dato", () => {
  const races = [
    race("late", "scheduled", "20/7"),
    race("soon", "scheduled", "2/7"),
    race("done", "completed", "1/7"),
  ];
  assert.equal(pickNextSelectableRace(races)?.id, "soon");
});

test("pickNextSelectableRace ignorerer active/completed selv hvis de er tidligst", () => {
  const races = [
    race("active-first", "active", "1/7"),
    race("done-first", "completed", "1/6"),
    race("scheduled-later", "scheduled", "10/7"),
  ];
  assert.equal(pickNextSelectableRace(races)?.id, "scheduled-later");
});

test("pickNextSelectableRace returnerer null når intet løb er scheduled", () => {
  const races = [race("a", "active", "1/7"), race("b", "completed", "2/7")];
  assert.equal(pickNextSelectableRace(races), null);
});

test("pickNextSelectableRace håndterer tom/undefined liste", () => {
  assert.equal(pickNextSelectableRace([]), null);
  assert.equal(pickNextSelectableRace(undefined), null);
  assert.equal(pickNextSelectableRace(null), null);
});

test("løb uden dato sorteres sidst men vælges hvis det er det eneste scheduled", () => {
  const withDate = race("dated", "scheduled", "9/7");
  const noDate = race("undated", "scheduled", null);
  // Med dato vinder over uden dato.
  assert.equal(pickNextSelectableRace([noDate, withDate])?.id, "dated");
  // Uden dato er stadig udtageligt hvis det står alene.
  assert.equal(pickNextSelectableRace([noDate])?.id, "undated");
});

test("uændret input-array (ingen mutation)", () => {
  const races = [race("late", "scheduled", "20/7"), race("soon", "scheduled", "2/7")];
  const snapshot = races.map((r) => r.id);
  pickNextSelectableRace(races);
  assert.deepEqual(races.map((r) => r.id), snapshot);
});
