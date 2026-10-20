import test from "node:test";
import assert from "node:assert/strict";
import { replayRider, summarize, v1NormalLoad } from "./conditionModelV2Harness6984.mjs";

const gtDate = (tickDate, n) => ({
  tickDate, recovery: 50,
  slots: [
    ...Array.from({ length: n }, (_, i) => ({ intensity: "race", stage: { recordedLoad: v1NormalLoad({ profileType: "mountain", stageNumber: i + 1, rulesRevision: "official_times_v3" }), profileType: "mountain", distanceKm: 180, stageNumber: i + 1, rulesRevision: "official_times_v3" } })),
    ...Array.from({ length: 5 - n }, () => ({ intensity: "rest" })),
  ],
});

test("harness: en GT er langt hårdere i v2 end i v1, og v1 genskaber prod-mønstret", () => {
  const trace = replayRider({ riderId: "r", opening: { fatigue: 20, form: 80 }, dates: [gtDate("2026-11-01", 4), gtDate("2026-11-02", 3), gtDate("2026-11-03", 4)] });
  assert.equal(trace.length, 3);
  assert.ok(trace[2].v1.fatigue < 35, `v1 ${trace[2].v1.fatigue}`);
  assert.ok(trace[2].v2.fatigue > trace[2].v1.fatigue + 10, `v2 ${trace[2].v2.fatigue}`);
});

test("harness: datoer uden fem pladser springes over", () => {
  const trace = replayRider({ riderId: "r", opening: { fatigue: 0, form: 50 }, dates: [{ tickDate: "d", slots: [{ intensity: "rest" }] }] });
  assert.deepEqual(trace, []);
});

test("harness: summarize giver gates pr. dato og pr. GT", () => {
  const riders = [
    { riderId: "a", ai: false, trace: replayRider({ riderId: "a", opening: { fatigue: 20, form: 80 }, dates: [gtDate("2026-11-01", 4)] }) },
    { riderId: "b", ai: true, trace: replayRider({ riderId: "b", opening: { fatigue: 20, form: 80 }, dates: [gtDate("2026-11-01", 1)] }) },
  ];
  const s = summarize({ riders, grandTours: [{ name: "GT", riderIds: new Set(["a"]), first: "2026-11-01", last: "2026-11-01" }] });
  assert.equal(s.perDate.length, 1);
  assert.equal(s.perDate[0].human_v1.n, 1);
  assert.equal(s.perDate[0].ai_v2.n, 1);
  assert.equal(s.grandTours[0].human_v2.n, 1);
  assert.equal(s.grandTours[0].ai_v2.n, 0);
});
