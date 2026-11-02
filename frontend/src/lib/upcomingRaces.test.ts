import { test } from "node:test";
import assert from "node:assert/strict";
import { pickUpcomingRaces, filterTeamUpcomingRaces } from "./upcomingRaces.ts";

type TestRace = {
  id: string;
  status?: string;
  stages?: number;
  stages_completed?: number;
  pool_race: { date_text: string } | null;
};

function race(id: string, dateText?: string | null): TestRace {
  return { id, pool_race: dateText == null ? null : { date_text: dateText } };
}

// Løbsstatus som DashboardPage henter den (races-rækken): ikke startet = status
// scheduled med 0 etaper kørt; i gang = scheduled med 1+ etaper kørt.
function notStarted(id: string, stages = 3): TestRace {
  return { ...race(id), status: "scheduled", stages, stages_completed: 0 };
}
function inProgress(id: string, stages = 5, done = 2): TestRace {
  return { ...race(id), status: "scheduled", stages, stages_completed: done };
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

// #7539 — nyt hold uden gemt udtagelse (0 race_entries). Assistenten stiller
// hold i divisionens løb, når de køres, så kortet skal vise de næste løb i
// stedet for "Ingen planlagte løb".
test("nyt hold uden entries: kortet viser divisionens ikke-startede løb (#7539)", () => {
  const races = [notStarted("a"), notStarted("b"), notStarted("c"), notStarted("d")];
  const nextStageMsById = { a: 3000, b: 1000, c: 2000, d: 4000 };

  const filtered = filterTeamUpcomingRaces(races, new Set());
  const ids = pickUpcomingRaces(filtered, nextStageMsById, 3).map((r) => r.id);

  assert.deepEqual(ids, ["b", "c", "a"]);
});

// Etableret hold: tilmeldt det igangværende løb og de næste. Ingenting fjernes.
test("etableret hold: ser sit igangværende løb og de næste løb uændret", () => {
  const races = [inProgress("live-race"), notStarted("next-race"), notStarted("later-race")];
  const nextStageMsById = { "live-race": 1000, "next-race": 90000, "later-race": 150000 };
  const enteredRaceIds = new Set(["live-race", "next-race"]);

  const filtered = filterTeamUpcomingRaces(races, enteredRaceIds);
  const ids = pickUpcomingRaces(filtered, nextStageMsById, 3).map((r) => r.id);

  assert.deepEqual(ids, ["live-race", "next-race", "later-race"]);
});

// #3751 bevares — et løb i gang som holdet ikke deltager i, vises ikke, selvom
// dets næste etape kører før holdets eget næste løb.
test("løb i gang uden holdet vises ikke (#3751)", () => {
  const races = [inProgress("live-without-team"), notStarted("own-next"), notStarted("after")];
  const nextStageMsById = { "live-without-team": 1000, "own-next": 90000, after: 96000 };
  const enteredRaceIds = new Set(["own-next"]);

  const filtered = filterTeamUpcomingRaces(races, enteredRaceIds);
  const ids = pickUpcomingRaces(filtered, nextStageMsById, 3).map((r) => r.id);

  assert.deepEqual(ids, ["own-next", "after"]);
});

// #3751 bevares — et hold oprettet midt i et etapeløb har ingen entries i det
// løb (trup låst). Løbet var allerede startet, så det er ikke "ikke startet".
test("løb der startede før holdet fandtes vises ikke, heller ikke for et hold uden entries (#3751)", () => {
  const races = [inProgress("started-before-team", 7, 1), notStarted("next")];
  const nextStageMsById = { "started-before-team": 500, next: 80000 };

  const filtered = filterTeamUpcomingRaces(races, []);
  const ids = pickUpcomingRaces(filtered, nextStageMsById, 3).map((r) => r.id);

  assert.deepEqual(ids, ["next"]);
});

// Afsluttede løb filtreres fra i Dashboard-forespørgslen (status completed). Et
// løb med alle etaper kørt tæller heller ikke som "ikke startet".
test("afsluttede løb uden holdet tæller ikke som ikke-startede", () => {
  const races = [
    { ...race("done"), status: "completed", stages: 1, stages_completed: 1 },
    { ...race("all-stages-run"), status: "scheduled", stages: 3, stages_completed: 3 },
    notStarted("next"),
  ];
  const ids = filterTeamUpcomingRaces(races, new Set(["next"])).map((r) => r.id);
  assert.deepEqual(ids, ["next"]);
});

test("filterTeamUpcomingRaces: accepterer både Set og almindeligt array", () => {
  const races = [inProgress("a"), inProgress("b")];
  assert.deepEqual(filterTeamUpcomingRaces(races, ["a"]).map((r) => r.id), ["a"]);
  assert.deepEqual(filterTeamUpcomingRaces(races, new Set(["a"])).map((r) => r.id), ["a"]);
});

test("filterTeamUpcomingRaces: tom/ugyldig liste giver tom liste", () => {
  assert.deepEqual(filterTeamUpcomingRaces([], new Set(["a"])), []);
  assert.deepEqual(filterTeamUpcomingRaces(undefined, new Set(["a"])), []);
  assert.deepEqual(filterTeamUpcomingRaces(null, new Set(["a"])), []);
  assert.deepEqual(filterTeamUpcomingRaces([inProgress("a")], undefined), []);
});

test("filterTeamUpcomingRaces: muterer ikke input-arrayet", () => {
  const races = [inProgress("a"), notStarted("b")];
  const snapshot = races.map((r) => r.id);
  const filtered = filterTeamUpcomingRaces(races, new Set(["a"]));
  assert.deepEqual(races.map((r) => r.id), snapshot);
  assert.notEqual(filtered, races);
});
