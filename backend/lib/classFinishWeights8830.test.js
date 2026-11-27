// #8830 (ejer 27/11 "Ret D1 nu"): klasse-vaegte for D1's World Tour-loeb og D3's ProSeries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { roadFinishWeightsFor, ROAD_FINISH_WEIGHTS, COBBLES_FINISH_WEIGHTS, CLASS_FINISH_WEIGHTS, FINISH_MATRIX } from "./stageProfileTypes.js";

test("klasse-vaegte: kun OtherWorldTourA og ProSeries, kun deres terraener, aldrig brosten", () => {
  assert.equal(roadFinishWeightsFor("rolling", "rolling", "OtherWorldTourA"), CLASS_FINISH_WEIGHTS.OtherWorldTourA.rolling);
  assert.equal(roadFinishWeightsFor("flat", "flat", "ProSeries"), CLASS_FINISH_WEIGHTS.ProSeries.flat);
  assert.equal(roadFinishWeightsFor("hilly", "hilly", "OtherWorldTourA"), ROAD_FINISH_WEIGHTS.hilly);
  assert.equal(roadFinishWeightsFor("rolling", "rolling", "ProSeries"), ROAD_FINISH_WEIGHTS.rolling);
  assert.equal(roadFinishWeightsFor("rolling", "cobbles", "OtherWorldTourA"), COBBLES_FINISH_WEIGHTS.rolling);
  assert.equal(roadFinishWeightsFor("flat", "flat", "Class1"), ROAD_FINISH_WEIGHTS.flat);
  assert.equal(roadFinishWeightsFor("flat", "flat"), ROAD_FINISH_WEIGHTS.flat);
});

test("klasse-vaegte ligger inden for FINISH_MATRIX for terraenet", () => {
  for (const table of Object.values(CLASS_FINISH_WEIGHTS)) {
    for (const [terrain, items] of Object.entries(table)) {
      for (const it of items) assert.ok(FINISH_MATRIX[terrain].includes(it.value), `${terrain}: ${it.value}`);
    }
  }
  // Flad: spurten er stadig den hyppigste afslutning, ogsaa i klasse-tabellerne.
  for (const table of Object.values(CLASS_FINISH_WEIGHTS)) {
    if (!table.flat) continue;
    const top = table.flat.reduce((a, b) => (b.weight > a.weight ? b : a));
    assert.equal(top.value, "flat_sprint");
  }
});
