// frontend/src/lib/raceLatestWindow.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { capLatestRaces } from "./raceLatestWindow.js";

function race(id, race_type) {
  return { id, race_type, name: id };
}

test("capLatestRaces: under grænsen → uændret, ny array (ikke samme reference)", () => {
  const races = [race("a", "single"), race("b", "stage_race")];
  const out = capLatestRaces(races, 9);
  assert.deepEqual(out, races);
  assert.notEqual(out, races);
});

test("capLatestRaces: over grænsen uden manglende type → ren slice", () => {
  const races = Array.from({ length: 12 }, (_, i) => race(`r${i}`, "single"));
  const out = capLatestRaces(races, 9);
  assert.equal(out.length, 9);
  assert.deepEqual(out.map((r) => r.id), races.slice(0, 9).map((r) => r.id));
});

test("capLatestRaces: en løbstype skubbes helt ud → byttes ind på den ældste plads (#3333)", () => {
  // 9 etapeløb (nyest-først) + 1 endagsløb HELT nederst (index 9, uden for top-9).
  const stageRaces = Array.from({ length: 9 }, (_, i) => race(`stage${i}`, "stage_race"));
  const oneDay = race("oneday-old", "single");
  const races = [...stageRaces, oneDay];

  const out = capLatestRaces(races, 9);
  assert.equal(out.length, 9); // vinduets størrelse er uændret
  assert.ok(out.some((r) => r.race_type === "single"), "endagsløbet skal være repræsenteret");
  assert.deepEqual(out.map((r) => r.id).slice(0, -1), stageRaces.slice(0, -1).map((r) => r.id)); // de 8 nyeste bevaret
  assert.equal(out[out.length - 1].id, "oneday-old"); // kun den ældste plads ofret
});

test("capLatestRaces: flere manglende typer end ledige pladser → bytter så mange som muligt uden crash", () => {
  // limit=1, to typer repræsenteret i fuld liste — kun plads til én reddet type.
  const races = [race("a", "stage_race"), race("b", "single"), race("c", "single")];
  const out = capLatestRaces(races, 1);
  assert.equal(out.length, 1);
});

test("capLatestRaces: begge typer allerede i vinduet → ingen ombytning", () => {
  const races = [
    race("a", "stage_race"), race("b", "single"), race("c", "stage_race"),
    race("d", "single"), race("e", "stage_race"), race("f", "single"),
    race("g", "stage_race"), race("h", "single"), race("i", "stage_race"),
    race("j", "single"),
  ];
  const out = capLatestRaces(races, 9);
  assert.deepEqual(out.map((r) => r.id), races.slice(0, 9).map((r) => r.id));
});

test("capLatestRaces: muterer ikke input-arrayet", () => {
  const races = Array.from({ length: 10 }, (_, i) => race(`r${i}`, i === 9 ? "single" : "stage_race"));
  const snapshot = races.map((r) => r.id);
  capLatestRaces(races, 9);
  assert.deepEqual(races.map((r) => r.id), snapshot);
});

test("capLatestRaces: defensiv på ikke-array + ugyldig limit", () => {
  assert.deepEqual(capLatestRaces(null, 9), []);
  assert.deepEqual(capLatestRaces(undefined, 9), []);
  assert.deepEqual(capLatestRaces([race("a", "single")], 0), []);
  assert.deepEqual(capLatestRaces([race("a", "single")], -1), []);
});
