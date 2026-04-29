import assert from "node:assert/strict";
import test from "node:test";

import { buildUciMenRacePointRows } from "./uciRacePointDefaults.js";

function pointFor(rows, raceClass, resultType, rank) {
  return rows.find(row =>
    row.race_class === raceClass &&
    row.result_type === resultType &&
    row.rank === rank
  )?.points;
}

test("UCI men race point defaults match core 2025 ranking scales", () => {
  const rows = buildUciMenRacePointRows();

  assert.equal(pointFor(rows, "TourFrance", "Klassement", 1), 1300);
  assert.equal(pointFor(rows, "GiroVuelta", "Klassement", 1), 1100);
  assert.equal(pointFor(rows, "Monuments", "Klassiker", 1), 800);
  assert.equal(pointFor(rows, "OtherWorldTourA", "Klassement", 1), 500);
  assert.equal(pointFor(rows, "OtherWorldTourB", "Klassiker", 1), 400);
  assert.equal(pointFor(rows, "OtherWorldTourC", "Klassiker", 1), 300);
  assert.equal(pointFor(rows, "ProSeries", "Klassement", 1), 200);
  assert.equal(pointFor(rows, "Class1", "Klassiker", 1), 125);
  assert.equal(pointFor(rows, "Class2", "Klassement", 1), 40);

  assert.equal(pointFor(rows, "TourFrance", "Etapeplacering", 1), 210);
  assert.equal(pointFor(rows, "GiroVuelta", "Bjergtroje", 3), 95);
  assert.equal(pointFor(rows, "OtherWorldTourC", "Forertroje", 1), 6);
  assert.equal(pointFor(rows, "Class2", "Etapeplacering", 3), 1);
});
