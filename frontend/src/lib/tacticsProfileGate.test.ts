// #7317: vej-ordrer skjules og strippes paa tidskoersel; indsats beroeres ikke.
import test from "node:test";
import assert from "node:assert/strict";
import { isTimeTrialStage, roadOrdersAvailable, withoutRoadOrders } from "./tacticsProfileGate.ts";

const order = {
  breakaway_stance: "chase",
  riders: [
    { rider_id: "r1", effort: "save", try_break: true, leadout: false },
    { rider_id: "r2", effort: "all_out", try_break: false, leadout: true },
  ],
};

test("itt, itt_hilly og ttt er tidskoersler; vej-profiler og ukendt er ikke", () => {
  for (const p of ["itt", "itt_hilly", "ttt"]) {
    assert.equal(isTimeTrialStage(p), true, p);
    assert.equal(roadOrdersAvailable(p), false, p);
  }
  for (const p of ["flat", "hilly", "mountain", "cobbled", "", null, undefined, 3]) {
    assert.equal(isTimeTrialStage(p), false, String(p));
    assert.equal(roadOrdersAvailable(p), true, String(p));
  }
});

test("withoutRoadOrders: neutral holdning, intet udbrud/tog, indsats og rytter uaendret", () => {
  for (const p of ["itt", "itt_hilly", "ttt"]) {
    const out = withoutRoadOrders(order, p);
    assert.equal(out.breakaway_stance, "neutral");
    assert.deepEqual(out.riders.map((r) => [r.rider_id, r.effort, r.try_break, r.leadout]), [
      ["r1", "save", false, false],
      ["r2", "all_out", false, false],
    ]);
  }
  assert.equal(order.breakaway_stance, "chase", "input muteres ikke");
  assert.equal(order.riders[0].try_break, true, "input muteres ikke");
});

test("withoutRoadOrders: vej-etaper returnerer samme objekt", () => {
  assert.equal(withoutRoadOrders(order, "flat"), order);
  assert.equal(withoutRoadOrders(order, null), order);
});
