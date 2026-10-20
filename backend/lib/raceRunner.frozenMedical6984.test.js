// #6984 M2+M3: medicinen på etapens skadeudfald læser den frosne bonus fra
// belastnings-snapshottet, så et genoptaget enrichment-trin giver samme udfald.
import test from "node:test";
import assert from "node:assert/strict";
import { applyFrozenMedical } from "./raceRunner.js";

const incidents = [{ rider_id: "a", stage_number: 4, kind: "crash", outcome: "abandon", injury_days: 10 }];
const timelines = [{ stage_number: 4, events: [{ km: 1, type: "incident", params: { rider_id: "a", injury_days: 10 } }] }];

test("uden frosset bonus er output uændret (flag off / hold uden afdeling)", () => {
  const runs = [{ stage_number: 4, condition_load_snapshot: [{ rider_id: "a", load: 12 }] }];
  const out = applyFrozenMedical({ race: { id: "r" }, runs, incidents, timelines });
  assert.equal(out.incidents, incidents);
  assert.equal(out.timelines, timelines);
});

test("frosset bonus giver samme udfald ved genoptagelse, og tidslinjen følger hændelsen", () => {
  const runs = [{ stage_number: 4, condition_load_snapshot: [{ rider_id: "a", load: 12, medical_bonus: 0.3 }] }];
  const first = applyFrozenMedical({ race: { id: "r" }, runs, incidents, timelines });
  const resumed = applyFrozenMedical({ race: { id: "r" }, runs, incidents, timelines });
  assert.deepEqual(resumed, first);
  assert.equal(first.timelines[0].events[0].params.injury_days, first.incidents[0].injury_days);
  assert.notEqual(first.incidents[0].injury_days, 10);
});
