// #6462: maalingen som gate. official_times_v5 maa KUN aendre togvalget i forhold
// til official_times_v4: ingen andre ordre-forskelle, ingen indsats-forskelle,
// samme motor. Flade etaper beholder toget; alle andre profiler mister standarden.
import { test } from "node:test";
import assert from "node:assert/strict";

import { runBench } from "./sprintTrainDefault6462.mjs";

test("#6462 bench: v5 aendrer kun togvalget (seed s1, alle proxy-etaper)", async () => {
  const rows = await runBench({ seeds: ["s1"] });
  for (const [group, r] of Object.entries(rows)) {
    if (!r.stages) continue;
    assert.equal(r.otherOrderDiffs, 0, `${group}: andre ordre-forskelle`);
    assert.equal(r.effortDiffs, 0, `${group}: indsats-forskelle`);
    assert.equal(r.engineDiffs, 0, `${group}: motor-forskelle`);
    if (group === "flat") {
      assert.ok(r.trainsBefore > 0, "flad: der koeres tog");
      assert.equal(r.trainsAfter, r.trainsBefore, "flad: samme tog");
      assert.equal(r.helpersAfter, r.helpersBefore, "flad: samme hjaelpere");
      assert.equal(r.resultChanged, 0, "flad: samme resultat");
    } else {
      assert.equal(r.trainsAfter, 0, `${group}: intet tog som standard`);
      assert.equal(r.helpersAfter, 0, `${group}: ingen hjaelpere i tog`);
    }
  }
});
