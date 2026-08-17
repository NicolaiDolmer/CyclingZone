import { test } from "node:test";
import assert from "node:assert/strict";
import { pickUpcomingRaces, filterTeamEnteredRaces } from "./upcomingRaces.js";

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

// #3751 — filterTeamEnteredRaces + pickUpcomingRaces sammen reproducerer det
// målte prod-scenarie (nyt hold "Jean-Luc", 14/8): tilmeldt i et igangværende
// etapeløb den ikke er en del af, men allerede tilmeldt hvert løb derefter.
// FØR fixet ville det igangværende løbs snarlige næste-etape-tid vinde
// sorteringen og vises øverst; kortet skal i stedet vise holdets EGET
// nærmeste løb.
test("nyt hold midt i et etapeløb: kortet viser holdets EGET nærmeste løb, ikke puljens igangværende løb (#3751)", () => {
  const races = [
    race("tour-du-jura"), // igangværende — holdet er IKKE tilmeldt (kom til midt i løbet)
    race("coppa-appenninica"),
    race("kempen"),
    race("cevennes"),
  ];
  const nextStageMsById = {
    "tour-du-jura": 1000, // næste etape om 1 time — vandt FØR fixet
    "coppa-appenninica": 90000,
    kempen: 96000,
    cevennes: 150000,
  };
  const enteredRaceIds = new Set(["coppa-appenninica", "kempen", "cevennes"]);

  const filtered = filterTeamEnteredRaces(races, enteredRaceIds);
  const ids = pickUpcomingRaces(filtered, nextStageMsById, 3).map((r) => r.id);

  assert.deepEqual(ids, ["coppa-appenninica", "kempen", "cevennes"]);
});

// Etableret hold — filteret er en no-op fordi holdet ER tilmeldt det
// igangværende løb (accept-kriterie: "et etableret hold ser præcis det
// samme som i dag").
test("etableret hold: filteret ændrer intet (holdet ER tilmeldt det igangværende løb)", () => {
  const races = [race("live-race"), race("next-race")];
  const nextStageMsById = { "live-race": 1000, "next-race": 90000 };
  const enteredRaceIds = new Set(["live-race", "next-race"]);

  const filtered = filterTeamEnteredRaces(races, enteredRaceIds);
  const ids = pickUpcomingRaces(filtered, nextStageMsById, 3).map((r) => r.id);

  assert.deepEqual(ids, ["live-race", "next-race"]);
});

test("filterTeamEnteredRaces: accepterer både Set og almindeligt array", () => {
  const races = [race("a"), race("b")];
  assert.deepEqual(filterTeamEnteredRaces(races, ["a"]).map((r) => r.id), ["a"]);
  assert.deepEqual(filterTeamEnteredRaces(races, new Set(["a"])).map((r) => r.id), ["a"]);
});

test("filterTeamEnteredRaces: tom/ugyldig liste giver tom liste", () => {
  assert.deepEqual(filterTeamEnteredRaces([], new Set(["a"])), []);
  assert.deepEqual(filterTeamEnteredRaces(undefined, new Set(["a"])), []);
  assert.deepEqual(filterTeamEnteredRaces(null, new Set(["a"])), []);
  assert.deepEqual(filterTeamEnteredRaces([race("a")], undefined), []);
});

test("filterTeamEnteredRaces: muterer ikke input-arrayet", () => {
  const races = [race("a"), race("b")];
  const snapshot = races.map((r) => r.id);
  const filtered = filterTeamEnteredRaces(races, new Set(["a"]));
  assert.deepEqual(races.map((r) => r.id), snapshot);
  assert.notEqual(filtered, races);
});
