import test from "node:test";
import assert from "node:assert/strict";
import { buildDoctorReport, seasonAdviceThresholds, isGrandTour, loadDoctorReportForSelection } from "./doctorReport.js";

const riders = [
  { id: "a", fatigue: 20 }, { id: "b", fatigue: 62 }, { id: "c", fatigue: 85 }, { id: "d", fatigue: 10, injured: true },
];

test("M4: ord pr. rytter, skarpere med højere niveau, aldrig tal", () => {
  const low = buildDoctorReport({ riders, tier: 0 });
  assert.equal(low.levels, 2);
  assert.deepEqual(Object.values(low.riders).map((r) => r.assessment), ["ready", "ready", "tired", "injured"]);
  const high = buildDoctorReport({ riders, tier: 5 });
  assert.equal(high.levels, 4);
  assert.deepEqual(Object.values(high.riders).map((r) => r.assessment), ["fresh", "tired", "rest", "injured"]);
  assert.ok(!JSON.stringify(high).match(/fatigue|\b(20|62|85)\b/), "ingen tal eller træthed i svaret");
});

test("M8: sæsonråd kun når der er sæsondata (Grand Tour)", () => {
  const noGt = buildDoctorReport({ riders, tier: 3 });
  assert.equal(noGt.riders.a.season, undefined);
  const days = new Map([["a", 5], ["b", 30], ["c", 10], ["d", 0]]);
  const gt = buildDoctorReport({ riders, tier: 3, seasonRaceDaysByRider: days, plannedGtRaceDays: 30 });
  assert.equal(gt.riders.a.season, "ready");
  assert.equal(gt.riders.b.season, "ready_but_spent_later");
  assert.equal(gt.riders.c.season, "rest_first");
  assert.equal(gt.riders.d.season, "injured");
  const t = seasonAdviceThresholds();
  assert.ok(t.seasonCapDays > t.seasonFreeDays);
});

test("isGrandTour", () => {
  assert.equal(isGrandTour({ stages: 17, race_type: "stage_race" }), true);
  assert.equal(isGrandTour({ stages: 7, race_type: "stage_race" }), false);
  assert.equal(isGrandTour({ stages: 1, race_type: "single" }), false);
});

test("loadDoctorReportForSelection: flag off = null; fejl = null (vælter aldrig udtagelsen)", async () => {
  const off = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: null }; } }; } };
  assert.equal(await loadDoctorReportForSelection({ supabase: off, race: { id: "r" }, teamId: "t", riders }), null);
  const broken = { from() { throw new Error("boom"); } };
  assert.equal(await loadDoctorReportForSelection({ supabase: broken, race: { id: "r" }, teamId: "t", riders }), null);
});
