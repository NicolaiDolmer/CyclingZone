import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRaceDayColumns,
  countsForRole,
  isSingleRaceDay,
  pacePerWeek,
  programGrid,
  riderShortName,
} from "./trainingMobileModel.ts";

// #3643 — mobilformen er tabel med dagens LOEBSDAGE som kolonner. Reglerne her
// er dem der goer formen sikker mod at loebsdags-modellen endnu ikke koerer i
// prod: aldrig nul kolonner, aldrig et haardkodet saeson-tal, og een kolonne
// naar flaget er OFF.

test("flag OFF (ingen loebsdags-tal) giver PRAECIS een kolonne", () => {
  const cols = buildRaceDayColumns();
  assert.equal(cols.length, 1);
  assert.equal(cols[0].index, 1);
  assert.equal(cols[0].state, "now");
  assert.equal(isSingleRaceDay(cols), true);
});

test("een kolonne er 'done' naar dagen er afregnet", () => {
  const [col] = buildRaceDayColumns({ settled: true });
  assert.equal(col.state, "done");
});

test("flag ON: een kolonne pr. loebsdag, med den aabne markeret", () => {
  const cols = buildRaceDayColumns({ raceDayCount: 4, currentIndex: 3 });
  assert.equal(cols.length, 4);
  assert.deepEqual(cols.map((c) => c.state), ["done", "done", "now", "upcoming"]);
  assert.equal(isSingleRaceDay(cols), false);
});

test("designet baerer 1-5 loebsdage og klamper derover", () => {
  assert.equal(buildRaceDayColumns({ raceDayCount: 1 }).length, 1);
  assert.equal(buildRaceDayColumns({ raceDayCount: 5 }).length, 5);
  // Flere end tabellen kan tegne uden vandret scroll paa 375 px: klampes, i
  // stedet for at skubbe kolonner ud over skaermkanten.
  assert.equal(buildRaceDayColumns({ raceDayCount: 9 }).length, 5);
});

test("vraevl fra serveren falder tilbage til een kolonne, aldrig nul", () => {
  for (const raceDayCount of [0, -3, Number.NaN, null, undefined]) {
    assert.equal(buildRaceDayColumns({ raceDayCount }).length, 1, String(raceDayCount));
  }
});

test("riderShortName forkorter fornavnet, ikke efternavnet", () => {
  assert.equal(riderShortName({ firstname: "Mathias", lastname: "Soerensen" }), "M. Soerensen");
  assert.equal(riderShortName({ firstname: "", lastname: "Bakker" }), "Bakker");
  assert.equal(riderShortName({ firstname: "Ada", lastname: "" }), "Ada");
  assert.equal(riderShortName(null), "");
});

test("countsForRole giver rollens evner, taettest-vejede foerst - og aldrig vaegtene", () => {
  const recipes = [{ key: "sprinter", weights: { sprint: 4, acceleration: 3, flat: 2, durability: 1 } }];
  const rows = countsForRole(recipes, "sprinter", { sprint: 71, acceleration: 58, flat: 66, durability: 44 }, ["durability"]);
  assert.deepEqual(rows.map((r) => r.ability), ["sprint", "acceleration", "flat", "durability"]);
  assert.deepEqual(rows.map((r) => r.value), [71, 58, 66, 44]);
  assert.deepEqual(rows.map((r) => r.atCap), [false, false, false, true]);
  for (const row of rows) assert.equal("weight" in row, false);
});

test("countsForRole er tom uden rolle eller uden opskrift", () => {
  assert.deepEqual(countsForRole([], null, {}, []), []);
  assert.deepEqual(countsForRole([{ key: "sprinter", weights: { sprint: 4 } }], "climber", {}, []), []);
});

test("en evne paa loftet kommer altid med, ogsaa uden for limit", () => {
  const recipes = [{ key: "sprinter", weights: { sprint: 4, acceleration: 3, positioning: 2, flat: 2, durability: 1 } }];
  const rows = countsForRole(recipes, "sprinter", { sprint: 71, durability: 44 }, ["durability"], 3);
  assert.deepEqual(rows.map((r) => r.ability), ["sprint", "acceleration", "positioning", "durability"]);
  assert.equal(rows[rows.length - 1].atCap, true);
  // Ingen dubletter naar den laaste evne allerede laa inden for limit.
  const inside = countsForRole(recipes, "sprinter", {}, ["sprint"], 3);
  assert.deepEqual(inside.map((r) => r.ability), ["sprint", "acceleration", "positioning"]);
});

test("countsForRole giver null-vaerdi naar evnen mangler paa raekken", () => {
  const rows = countsForRole([{ key: "tt", weights: { time_trial: 5 } }], "tt", {}, []);
  assert.equal(rows[0].value, null);
});

test("pacePerWeek er en hastighed, ikke en ankomsttid", () => {
  assert.equal(pacePerWeek({ gainedPoints: 7, daysElapsed: 14 }), 3.5);
  assert.equal(pacePerWeek({ gainedPoints: 2, daysElapsed: 21 }), 0.7);
});

test("pacePerWeek tier naar grundlaget er for tyndt", () => {
  assert.equal(pacePerWeek({ gainedPoints: 3, daysElapsed: 2 }), null);
  assert.equal(pacePerWeek({ gainedPoints: null, daysElapsed: 30 }), null);
  assert.equal(pacePerWeek({ gainedPoints: 5, daysElapsed: null }), null);
});

test("programGrid er N loebsdage x 7 ugedage", () => {
  const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const grid = programGrid(weekdays, buildRaceDayColumns({ raceDayCount: 4 }), () => "normal");
  assert.equal(grid.length, 4);
  for (const row of grid) assert.equal(row.length, 7);
  assert.equal(grid[2][0].raceDay, 3);
  assert.equal(grid[0][6].weekday, "sun");
});

test("programGrid falder tilbage til een raekke uden kolonner", () => {
  const grid = programGrid(["mon"], [], () => "easy");
  assert.equal(grid.length, 1);
  assert.equal(grid[0][0].intensity, "easy");
});
