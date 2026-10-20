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

test("et udgået styrt hvor medicinen undgik skaden giver ingen skaderække", async () => {
  const { incidentInjuryUpsertRows } = await import("./raceRunner.js");
  const many = Array.from({ length: 300 }, (_, i) => ({ rider_id: `r${i}`, stage_number: 4, kind: "crash", outcome: "abandon", injury_days: 6 }));
  const runs = [{ stage_number: 4, condition_load_snapshot: many.map((m) => ({ rider_id: m.rider_id, load: 10, medical_bonus: 0.33 })) }];
  const { incidents: out } = applyFrozenMedical({ race: { id: "r" }, runs, incidents: many, timelines: [] });
  const avoided = out.filter((i) => i.injury_avoided);
  assert.ok(avoided.length > 0, "nogle skader undgås");
  const rows = incidentInjuryUpsertRows({ incidents: out, todayStr: "2026-11-01" });
  assert.equal(rows.length, out.length - avoided.length);
  assert.ok(!rows.some((r) => avoided.some((a) => a.rider_id === r.rider_id)));
  assert.equal(incidentInjuryUpsertRows({ incidents: many, todayStr: "2026-11-01" }).length, many.length, "uden medicin uændret");
});
