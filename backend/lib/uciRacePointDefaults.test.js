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

test("Bjerg + Point final classifications cover all stage-race classes", () => {
  const rows = buildUciMenRacePointRows();

  // UCI-real (Tour/Giro) — uændret
  assert.equal(pointFor(rows, "TourFrance", "Bjergtroje", 1), 210);
  assert.equal(pointFor(rows, "GiroVuelta", "Pointtroje", 2), 130);

  // Derived (non-Grand-Tour)
  assert.equal(pointFor(rows, "OtherWorldTourA", "Bjergtroje", 1), 80);
  assert.equal(pointFor(rows, "OtherWorldTourB", "Pointtroje", 2), 48);
  assert.equal(pointFor(rows, "OtherWorldTourC", "Bjergtroje", 3), 26);
  assert.equal(pointFor(rows, "ProSeries", "Pointtroje", 1), 32);
  assert.equal(pointFor(rows, "Class1", "Bjergtroje", 2), 15);
  assert.equal(pointFor(rows, "Class2", "Pointtroje", 1), 6);
});

test("Ungdoms final classifications cover all stage-race classes", () => {
  const rows = buildUciMenRacePointRows();

  assert.equal(pointFor(rows, "TourFrance", "Ungdomstroje", 1), 100);
  assert.equal(pointFor(rows, "GiroVuelta", "Ungdomstroje", 1), 80);
  assert.equal(pointFor(rows, "OtherWorldTourA", "Ungdomstroje", 1), 40);
  assert.equal(pointFor(rows, "OtherWorldTourB", "Ungdomstroje", 2), 20);
  assert.equal(pointFor(rows, "OtherWorldTourC", "Ungdomstroje", 3), 9);
  assert.equal(pointFor(rows, "ProSeries", "Ungdomstroje", 1), 16);
  assert.equal(pointFor(rows, "Class1", "Ungdomstroje", 1), 10);
  assert.equal(pointFor(rows, "Class2", "Ungdomstroje", 3), 1);
});

test("Per-day jerseys (Bjerg/Point/Ungdoms) cover all stage-race classes at rank 1", () => {
  const rows = buildUciMenRacePointRows();

  // TourFrance: 15 per day for alle tre secondary jerseys
  assert.equal(pointFor(rows, "TourFrance", "BjergtrojeDag", 1), 15);
  assert.equal(pointFor(rows, "TourFrance", "PointtrojeDag", 1), 15);
  assert.equal(pointFor(rows, "TourFrance", "UngdomstrojeDag", 1), 15);

  // GiroVuelta: 12 per day
  assert.equal(pointFor(rows, "GiroVuelta", "BjergtrojeDag", 1), 12);
  assert.equal(pointFor(rows, "GiroVuelta", "UngdomstrojeDag", 1), 12);

  // Andre tiers
  assert.equal(pointFor(rows, "OtherWorldTourA", "BjergtrojeDag", 1), 6);
  assert.equal(pointFor(rows, "OtherWorldTourB", "PointtrojeDag", 1), 5);
  assert.equal(pointFor(rows, "OtherWorldTourC", "UngdomstrojeDag", 1), 4);
  assert.equal(pointFor(rows, "ProSeries", "BjergtrojeDag", 1), 3);
  assert.equal(pointFor(rows, "Class1", "PointtrojeDag", 1), 2);
  assert.equal(pointFor(rows, "Class2", "UngdomstrojeDag", 1), 1);

  // Monuments er one-day → ingen per-day jerseys
  assert.equal(pointFor(rows, "Monuments", "BjergtrojeDag", 1), undefined);
});

test("Team classifications cover stage races (EtapelobHold) + one-day races (KlassikerHold)", () => {
  const rows = buildUciMenRacePointRows();

  // EtapelobHold — stage races
  assert.equal(pointFor(rows, "TourFrance", "EtapelobHold", 1), 65);
  assert.equal(pointFor(rows, "GiroVuelta", "EtapelobHold", 1), 55);
  assert.equal(pointFor(rows, "OtherWorldTourA", "EtapelobHold", 1), 25);
  assert.equal(pointFor(rows, "ProSeries", "EtapelobHold", 1), 10);
  assert.equal(pointFor(rows, "Class2", "EtapelobHold", 1), 2);

  // KlassikerHold — one-day races (inkl. Monuments)
  assert.equal(pointFor(rows, "Monuments", "KlassikerHold", 1), 40);
  assert.equal(pointFor(rows, "OtherWorldTourA", "KlassikerHold", 1), 25);
  assert.equal(pointFor(rows, "ProSeries", "KlassikerHold", 1), 10);
  assert.equal(pointFor(rows, "Class2", "KlassikerHold", 1), 2);

  // Monuments er one-day → ingen EtapelobHold
  assert.equal(pointFor(rows, "Monuments", "EtapelobHold", 1), undefined);
  // TourFrance er stage-race → ingen KlassikerHold (Grand Tours kører ikke som klassikere)
  assert.equal(pointFor(rows, "TourFrance", "KlassikerHold", 1), undefined);
});
