// #7296 — "Næste løb" peger på holdets næste løb, ikke kalenderens første.
import test from "node:test";
import assert from "node:assert/strict";
import { orderedTeamNextRaces, pickTeamNextRace } from "./dashboardNextRace.ts";

const race = (id: string, dateText: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "scheduled",
  stages: 1,
  stages_completed: 0,
  pool_race: { date_text: dateText },
  ...extra,
});

test("holdet tilmeldt et senere løb end kalenderens næste: det løb vælges", () => {
  const races = [race("cal-first", "1/7"), race("mid", "5/7"), race("own", "9/7")];
  assert.equal(pickTeamNextRace(races, new Set(["own"]))?.id, "own");
});

test("flere egne løb: det tidligste egne løb vinder, resten følger som fallback", () => {
  const races = [race("a", "1/7"), race("b", "5/7"), race("c", "9/7"), race("d", "12/7")];
  const ids = orderedTeamNextRaces(races, new Set(["d", "c"])).map((r) => r.id);
  assert.deepEqual(ids, ["c", "d", "a", "b"]);
});

test("intet tilmeldt: kalenderens næste løb (fallback)", () => {
  const races = [race("late", "9/7"), race("early", "1/7")];
  assert.equal(pickTeamNextRace(races, new Set())?.id, "early");
  assert.equal(pickTeamNextRace(races, null)?.id, "early");
  assert.equal(pickTeamNextRace(races, ["other-pool-race"])?.id, "early");
});

test("tilmeldt løb der allerede er kørt (completed) tæller ikke", () => {
  const races = [race("done", "1/7", { status: "completed" }), race("own", "5/7"), race("cal", "3/7")];
  assert.equal(pickTeamNextRace(races, new Set(["done", "own"]))?.id, "own");
});

test("etapeløb i gang er ikke udtageligt og springes over, også når holdet er tilmeldt", () => {
  const live = race("live", "1/7", { stages: 7, stages_completed: 3 });
  const races = [live, race("own-next", "9/7"), race("cal", "3/7")];
  assert.equal(pickTeamNextRace(races, new Set(["live", "own-next"]))?.id, "own-next");
  // holdet er kun tilmeldt det igangværende løb: fallback til kalenderens næste
  assert.equal(pickTeamNextRace(races, new Set(["live"]))?.id, "cal");
});

test("tom/ugyldig input giver null og muterer ikke", () => {
  assert.equal(pickTeamNextRace([], new Set(["x"])), null);
  assert.equal(pickTeamNextRace(null, null), null);
  const races = [race("b", "5/7"), race("a", "1/7")];
  const snapshot = JSON.stringify(races);
  orderedTeamNextRaces(races, new Set(["b"]));
  assert.equal(JSON.stringify(races), snapshot);
});
