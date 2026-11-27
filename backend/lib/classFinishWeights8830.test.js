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

test("grandTourQuotaTypes + orderGrandTourS5: junior-mini-GT har een enkeltstart, og den er sidste etape", async () => {
  const { grandTourQuotaTypes, orderGrandTourS5 } = await import("./raceStageProfileGenerator.js");
  const { makeRng } = await import("./fictionalRiderGenerator.js");
  const { types } = grandTourQuotaTypes("giro", 4, { maxTimeTrials: 1 });
  assert.equal(types.filter((t) => t === "itt" || t === "ttt").length, 1);
  for (let seed = 1; seed <= 20; seed++) {
    const ordered = orderGrandTourS5(makeRng(seed), types, { s6: true, lastTtOnly: true });
    assert.equal(ordered.length, 4);
    assert.equal(ordered[3], "itt", `seed ${seed}: ${ordered.join(",")}`);
    assert.ok(!ordered.slice(0, 3).includes("itt"));
  }
  assert.equal(grandTourQuotaTypes("giro", 4).types.filter((t) => t === "itt").length, 2, "uden loft: uaendret");
});
