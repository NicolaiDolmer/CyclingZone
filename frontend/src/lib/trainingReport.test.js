import { test } from "node:test";
import assert from "node:assert/strict";
import {
  focusProgress, isBreakthrough, daySummary, breakthroughJumps, riderHistoryFromRuns,
  PEAK_FORM_THRESHOLD, NEAR_BREAKTHROUGH,
} from "./trainingReport.js";

test("focusProgress: vælger fokus-evnen tættest på gennembrud", () => {
  // vo2max = climbing/punch/tempo. tempo er højest → vælges.
  const res = focusProgress("vo2max", { climbing: 0.2, punch: 0.5, tempo: 0.91 });
  assert.deepEqual(res, { ability: "tempo", pct: 91 });
});

test("focusProgress: null uden fokus eller uden data", () => {
  assert.equal(focusProgress(null, { climbing: 0.5 }), null);
  assert.equal(focusProgress("vo2max", null), null);
  assert.equal(focusProgress("vo2max", { sprint: 0.5 }), null); // ingen vo2max-evne i mappet
});

test("focusProgress: clamps og afrunder", () => {
  assert.deepEqual(focusProgress("sprint", { sprint: 0.005, acceleration: 0 }), { ability: "sprint", pct: 1 });
});

test("isBreakthrough: sandt når mindst én gevinst > 0", () => {
  assert.equal(isBreakthrough({ gains: { climbing: 1 } }), true);
  assert.equal(isBreakthrough({ gains: { climbing: 0 } }), false);
  assert.equal(isBreakthrough({ gains: {} }), false);
  assert.equal(isBreakthrough({}), false);
});

test("daySummary: tæller trænede, gennembrud, topform", () => {
  const rows = [
    { intensity: "normal", injured: false, gains: { climbing: 1 }, form: 75 }, // trænet + gennembrud + topform
    { intensity: "rest", injured: false, gains: {}, form: 80 },                // ikke trænet (rest), topform
    { intensity: "hard", injured: true, gains: {}, form: 40 },                 // skadet → ikke trænet
    { intensity: "easy", injured: false, gains: { sprint: 0 }, form: 70 },     // trænet, topform (=70)
  ];
  assert.deepEqual(daySummary(rows), { trained: 2, breakthroughs: 1, peakForm: 3, total: 4 });
});

test("daySummary: tomt input", () => {
  assert.deepEqual(daySummary(null), { trained: 0, breakthroughs: 0, peakForm: 0, total: 0 });
});

test("breakthroughJumps: bruger gains_detail når til stede", () => {
  const jumps = breakthroughJumps({ gains: { climbing: 1 }, gains_detail: { climbing: { from: 71, to: 72 } } });
  assert.deepEqual(jumps, [{ ability: "climbing", n: 1, from: 71, to: 72 }]);
});

test("breakthroughJumps: fallback til null from/to uden gains_detail", () => {
  const jumps = breakthroughJumps({ gains: { sprint: 2 } });
  assert.deepEqual(jumps, [{ ability: "sprint", n: 2, from: null, to: null }]);
});

test("konstanter eksporteret", () => {
  assert.equal(PEAK_FORM_THRESHOLD, 70);
  assert.equal(NEAR_BREAKTHROUGH, 0.9);
});

test("riderHistoryFromRuns: plukker rytterens linje pr. dag + bevarer metadata", () => {
  const runs = [
    {
      tick_date: "2026-06-20", executed_by: "manager", bonus_applied: true,
      report: { riders: [
        { rider_id: "r1", focus: "vo2max", intensity: "hard", gains: { climbing: 1 } },
        { rider_id: "r2", focus: "sprint", intensity: "easy", gains: {} },
      ] },
    },
    {
      tick_date: "2026-06-19", executed_by: "assistant", bonus_applied: false,
      report: { riders: [
        { rider_id: "r1", focus: "vo2max", intensity: "normal", gains: {} },
      ] },
    },
  ];
  const out = riderHistoryFromRuns(runs, "r1");
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    tick_date: "2026-06-20", executed_by: "manager", bonus_applied: true,
    row: { rider_id: "r1", focus: "vo2max", intensity: "hard", gains: { climbing: 1 } },
  });
  assert.equal(out[1].tick_date, "2026-06-19");
  assert.equal(out[1].row.intensity, "normal");
});

test("riderHistoryFromRuns: springer dage over hvor rytteren ikke indgik", () => {
  const runs = [
    { tick_date: "2026-06-20", executed_by: "manager", bonus_applied: false, report: { riders: [{ rider_id: "r2" }] } },
    { tick_date: "2026-06-19", executed_by: "manager", bonus_applied: false, report: { riders: [{ rider_id: "r1" }] } },
  ];
  const out = riderHistoryFromRuns(runs, "r1");
  assert.equal(out.length, 1);
  assert.equal(out[0].tick_date, "2026-06-19");
});

test("riderHistoryFromRuns: robust mod tomt/uvelformet input", () => {
  assert.deepEqual(riderHistoryFromRuns(null, "r1"), []);
  assert.deepEqual(riderHistoryFromRuns([], "r1"), []);
  assert.deepEqual(riderHistoryFromRuns([{ tick_date: "x", report: null }], "r1"), []);
  assert.deepEqual(riderHistoryFromRuns([{ tick_date: "x", report: { riders: [{ rider_id: "r1" }] } }], null), []);
});
