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

test("M4 på etape 2+ samme dato: lægen vurderer starttrætheden med datoens tidligere etaper (B2-løb)", async () => {
  const { ridersAtNextStageStart } = await import("./doctorReport.js");
  const mk = (revision) => ({ from(table) {
    const q = { select() { return q; }, eq() { return q; }, in() { return q; }, lt() { return q; }, is() { return q; }, order() { return q; },
      async maybeSingle() {
        if (table === "races") return { data: { engine_rules_revision: revision, stages_completed: 1 }, error: null };
        return { data: { game_day: 12, scheduled_at: "2026-11-01T14:00:00Z" }, error: null };
      },
      then(resolve) { resolve({ data: [{ rider_id: "a", game_day: 11, load: 30 }], error: null }); } };
    return q; } });
  const riders = [{ id: "a", fatigue: 45, abilities: { recovery: 50 } }];
  const race = { id: "r", race_type: "stage_race" };
  const b2 = await ridersAtNextStageStart({ supabase: mk("s5_profiles_v2"), race, riders, teamId: "t" });
  assert.ok(b2[0].fatigue > 45, `B2 ${b2[0].fatigue}`);
  assert.equal(riders[0].fatigue, 45, "input muteres ikke");
  const legacy = await ridersAtNextStageStart({ supabase: mk("s5_profiles_v1"), race, riders, teamId: "t" });
  assert.equal(legacy[0].fatigue, 45, "uden B2 = åbningen, som motoren");
  const { buildDoctorReport } = await import("./doctorReport.js");
  assert.notEqual(buildDoctorReport({ riders: b2, tier: 5 }).riders.a.assessment, buildDoctorReport({ riders, tier: 5 }).riders.a.assessment);
});
