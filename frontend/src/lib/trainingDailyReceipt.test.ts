import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateTrainingRuns, averagePassScore, sortReceiptRiders } from "./trainingDailyReceipt.ts";
import type { TrainingActivity } from "./trainingDailyReceipt.ts";
import { seasonAbilityGains, riderHistoryFromRuns, abilityReceipt, abilityReceiptGainPct } from "./trainingReport.js";
import { selectTrainingMoment } from "./trainingMoment.js";

const date = "2026-09-29";
const run = (day: number, patch: Partial<TrainingActivity> = {}) => ({
  id: `run-${day}`, tick_date: date, season_id: "s4", squad: "senior",
  game_day: day, created_at: `2026-09-29T20:0${day}:00Z`,
  executed_by: "cron", bonus_applied: false,
  report: { condition_per_date: true, condition_settled: day === 4,
    date_game_days: [0, 1, 2, 3, 4],
    riders: [{ rider_id: "r1", name: "Hugo", game_day: day,
      focus: day === 4 ? null : "threshold", intensity: day === 4 ? "rest" : "normal",
      gains: (day === 1 || day === 3 ? { tempo: 1 } : {}) as Record<string, number>,
      gains_detail: (day === 1 ? { tempo: { from: 54, to: 55 } } : day === 3 ? { tempo: { from: 55, to: 56 } } : {}) as Record<string, { from: number; to: number }>,
      progress_before: { tempo: [0.8, 0.95, 0.1, 0.9, 0.2][day] },
      progress_after: { tempo: [0.95, 0.1, 0.9, 0.2, 0.2][day] },
      condition_before_date: { form: 52, fatigue: 11 },
      form: day === 4 ? 53 : 52, fatigue: day === 4 ? 19 : 11,
      fatigue_delta: day === 4 ? 8 : 0, settlement_status: "complete",
      status: "normal", ...patch }] },
});

test("five unordered slots yield one rider/date receipt with all gains and one condition settlement", () => {
  const input = [run(4), run(1), run(0), run(3), run(2)];
  const before = structuredClone(input);
  const days = aggregateTrainingRuns(input);
  assert.equal(days.length, 1);
  const day = days[0];
  assert.equal(day.receipt_status, "complete");
  assert.equal(day.report.riders.length, 1);
  const rider = day.report.riders[0];
  assert.deepEqual(rider.gains, { tempo: 2 });
  assert.deepEqual(rider.gains_detail, { tempo: { from: 54, to: 56 } });
  assert.equal(rider.gain_percent.tempo, 140);
  assert.equal(rider.fatigue_delta, 8);
  assert.equal(rider.fatigue_before, 11);
  assert.equal(rider.form_before, 52);
  assert.equal(rider.form, 53);
  assert.equal(rider.intensity, "normal", "a final rest slot must not hide the day's active training");
  assert.deepEqual(rider.activities.map(a => a.game_day), [0, 1, 2, 3, 4]);
  assert.deepEqual(input, before, "projection must not mutate stored evidence");
});

test("repeated response rows cannot duplicate gains or activities", () => {
  const day = aggregateTrainingRuns([run(0), run(1), run(1), run(2), run(3), run(4)])[0];
  assert.equal(day.report.riders[0].gains.tempo, 2);
  assert.equal(day.report.riders[0].activities.length, 5);
});

test("a missing middle slot is pending even with a final settlement marker", () => {
  const day = aggregateTrainingRuns([run(0), run(1), run(3), run(4)])[0];
  assert.equal(day.receipt_status, "pending");
  assert.equal(day.report.riders[0].receipt_status, "pending");
  assert.equal(day.report.riders[0].fatigue, null);
});

test("quarantined evidence remains reconciliation rather than a completed zero", () => {
  const day = aggregateTrainingRuns([0, 1, 2, 3, 4].map(i => run(i, i === 2 ? {
    settlement_status: "needs_reconciliation", status: "unknown_pending",
    missing_evidence: ["missing_result"],
  } : {})))[0];
  assert.equal(day.receipt_status, "reconciliation");
  assert.equal(day.report.riders[0].receipt_status, "reconciliation");
  assert.equal(day.report.riders[0].fatigue, null);
});

test("legacy days aggregate recorded slots without inventing settlement proof or fractional gains", () => {
  const rows = [run(0), run(1)];
  for (const row of rows) {
    delete (row.report as Record<string, unknown>).condition_per_date;
    delete (row.report as Record<string, unknown>).condition_settled;
    delete (row.report as Record<string, unknown>).date_game_days;
    delete (row.report.riders[0] as Record<string, unknown>).progress_after;
  }
  const day = aggregateTrainingRuns(rows)[0];
  assert.equal(day.receipt_status, "recorded");
  assert.equal(day.report.riders[0].gain_percent.tempo, null);
  assert.equal(day.report.riders[0].gains.tempo, 1);
});

test("old normalized reports need all five recorded slots before they can be complete", () => {
  const rows = [run(4)];
  delete (rows[0].report as Record<string, unknown>).date_game_days;
  assert.equal(aggregateTrainingRuns(rows)[0].receipt_status, "pending");
});

test("different riders/squads are included, and conflicting duplicate slots are explicit", () => {
  const rows = [0, 1, 2, 3, 4].map(i => run(i));
  const junior = run(4, { rider_id: "r2", name: "Junior" });
  junior.squad = "junior";
  junior.id = "junior-4";
  const conflict = run(1, { gains: { tempo: 5 } });
  conflict.id = "conflicting-r1-1";
  conflict.squad = "u23";
  const day = aggregateTrainingRuns([...rows, junior, conflict])[0];
  assert.equal(day.report.riders.length, 2);
  assert.equal(day.report.riders.find(r => r.rider_id === "r1")?.receipt_status, "reconciliation");
  assert.equal(day.report.riders.find(r => r.rider_id === "r2")?.receipt_status, "pending");
});

test("reconciliation cannot advertise arbitrary gains in season totals or rider logs", () => {
  const rows = [0,1,2,3,4].map(i=>run(i));
  const collision = run(1,{gains:{tempo:5}});
  collision.squad = "u23";
  const receipts = aggregateTrainingRuns([...rows,collision]);
  assert.equal(seasonAbilityGains(receipts,"r1","2026-09-01"),null);
  assert.equal(riderHistoryFromRuns(receipts,"r1")[0].row.receipt_status,"reconciliation");
  assert.deepEqual(receipts[0].report.riders[0].gains,{});
  assert.equal(receipts[0].report.riders[0].progress_after, undefined);
});

test("same-date seasons remain separate and active-season totals are scoped before aggregation", () => {
  const previous = run(139,{gains:{tempo:7}});
  previous.season_id="s3";
  previous.created_at="2026-09-29T18:00:00Z";
  const rows=[previous,...[0,1,2,3,4].map(i=>run(i))];
  const receipts = aggregateTrainingRuns(rows);
  assert.equal(receipts.length,2);
  const current=receipts.find(r=>r.season_id==="s4")!;
  assert.equal(current.receipt_status,"complete");
  assert.equal(current.report.riders[0].gains.tempo,2);
  assert.deepEqual(current.report.riders[0].activities.map(a=>a.game_day),[0,1,2,3,4]);
});

test("mixed cadence is reconciliation even when the final slot claims settlement", () => {
  const rows=[0,1,2,3,4].map(i=>run(i));
  for(const row of rows.slice(0,4)) delete (row.report as Record<string,unknown>).condition_per_date;
  assert.equal(aggregateTrainingRuns(rows)[0].receipt_status,"reconciliation");
});

test("pending-only receipts do not produce a completed-day quiet story", () => {
  const receipt=aggregateTrainingRuns([run(0),run(1)])[0];
  assert.equal(selectTrainingMoment(receipt,{},[]),null);
});

// #5915: 29/9 and 30/9 ticks were stored before `progress_after` existed.
const withoutAfter = (day: number, tickDate = date, patch: Partial<TrainingActivity> = {}) => {
  const r = run(day, patch);
  r.tick_date = tickDate;
  r.id = `${tickDate}-${day}`;
  r.created_at = `${tickDate}T20:0${day}:00Z`;
  delete (r.report.riders[0] as Record<string, unknown>).progress_after;
  return r;
};

test("#5915: an old date without progress_after derives its end point from the next date's first tick", () => {
  const old = [0, 1, 2, 3, 4].map(i => withoutAfter(i));
  const next = withoutAfter(0, "2026-09-30", { progress_before: { tempo: 0.2 } });
  const receipts = aggregateTrainingRuns([...old, next]);
  const rider = receipts.find(r => r.tick_date === date)!.report.riders[0];
  assert.equal(rider.gain_percent.tempo, 140, "0.8 -> two whole points -> 0.2 = 140% of a point");
  assert.deepEqual(rider.progress_after, { tempo: 0.2 });
});

test("#5915: the newest old date with no later tick stays honestly unknown", () => {
  const receipts = aggregateTrainingRuns([0, 1, 2, 3, 4].map(i => withoutAfter(i)));
  assert.equal(receipts[0].report.riders[0].gain_percent.tempo, null);
});

test("#5915: a stored progress_after wins over the next date's start", () => {
  const stored = [0, 1, 2, 3, 4].map(i => run(i));
  const next = withoutAfter(0, "2026-09-30", { progress_before: { tempo: 0.7 } });
  const rider = aggregateTrainingRuns([...stored, next]).find(r => r.tick_date === date)!.report.riders[0];
  assert.equal(rider.gain_percent.tempo, 140);
});

test("#5915: chaining never crosses seasons and never shows negative progress as zero", () => {
  const old = [0, 1, 2, 3, 4].map(i => withoutAfter(i));
  const otherSeason = withoutAfter(0, "2026-09-30", { progress_before: { tempo: 0.2 } });
  otherSeason.season_id = "s5";
  assert.equal(aggregateTrainingRuns([...old, otherSeason]).find(r => r.season_id === "s4")!.report.riders[0].gain_percent.tempo, null);
  const noGain = [0, 1, 2, 3, 4].map(i => withoutAfter(i, date, { gains: {}, gains_detail: {} }));
  const lower = withoutAfter(0, "2026-09-30", { progress_before: { tempo: 0.5 } });
  assert.equal(aggregateTrainingRuns([...noGain, lower]).find(r => r.tick_date === date)!.report.riders[0].gain_percent.tempo, null);
});

test("#5915: the successor must be its date's first expected slot, unquarantined and unambiguous", () => {
  const old = () => [0, 1, 2, 3, 4].map(i => withoutAfter(i));
  const pct = (rows: ReturnType<typeof withoutAfter>[]) =>
    aggregateTrainingRuns(rows).find(r => r.tick_date === date)!.report.riders[0].gain_percent.tempo;
  // Only day 1 of the next date stored: its start already includes day 0's training.
  assert.equal(pct([...old(), withoutAfter(1, "2026-09-30", { progress_before: { tempo: 0.35 } })]), null);
  assert.equal(pct([...old(), withoutAfter(0, "2026-09-30", { progress_before: { tempo: 0.2 }, status: "unknown_pending",
    settlement_status: "needs_reconciliation", missing_evidence: ["missing_result"] })]), null);
  const a = withoutAfter(0, "2026-09-30", { progress_before: { tempo: 0.2 } });
  const b = withoutAfter(0, "2026-09-30", { progress_before: { tempo: 0.4 } });
  b.id = "conflict"; b.squad = "u23";
  assert.equal(pct([...old(), a, b]), null);
  const noDays = withoutAfter(0, "2026-09-30", { progress_before: { tempo: 0.2 } });
  delete (noDays.report as Record<string, unknown>).date_game_days;
  assert.equal(pct([...old(), noDays]), null);
});

test("#5915: prod-shaped dates without date_game_days chain when game days continue exactly", () => {
  // Prod: 29/9 = game days 5-9, 30/9 = 10-14, 1/10 = 15-18; none stored date_game_days.
  const tick = (tickDate: string, day: number, before: number) => {
    const r = withoutAfter(0, tickDate, { game_day: day, progress_before: { tempo: before }, gains: {}, gains_detail: {} });
    r.id = `${tickDate}-${day}`; r.game_day = day; r.report.condition_settled = true;
    delete (r.report as Record<string, unknown>).date_game_days;
    return r;
  };
  const rows = [
    ...[5, 6, 7, 8, 9].map(d => tick("2026-09-29", d, 0.1)),
    ...[10, 11, 12, 13, 14].map(d => tick("2026-09-30", d, 0.3)),
    ...[15, 16, 17, 18].map(d => tick("2026-10-01", d, 0.6)),
  ];
  const pct = (input: typeof rows, tickDate: string) =>
    aggregateTrainingRuns(input).find(r => r.tick_date === tickDate)!.report.riders[0].gain_percent.tempo;
  assert.equal(pct(rows, "2026-09-29"), 20, "29/9 ends where 30/9 (game day 10) starts");
  assert.equal(pct(rows, "2026-09-30"), 30, "30/9 ends where 1/10 (game day 15) starts");
  // A gap (successor's first stored slot is not previous last + 1) stays unknown.
  const gap = rows.filter(r => !(r.tick_date === "2026-09-30" && r.game_day === 10));
  assert.equal(pct(gap, "2026-09-29"), null);
});

test("#5915: legacy (non per-date) days are never chained", () => {
  const legacy = [withoutAfter(0), withoutAfter(1)];
  const next = withoutAfter(0, "2026-09-30", { progress_before: { tempo: 0.2 } });
  for (const row of [...legacy, next]) delete (row.report as Record<string, unknown>).condition_per_date;
  assert.equal(aggregateTrainingRuns([...legacy, next]).find(r => r.tick_date === date)!.report.riders[0].gain_percent.tempo, null);
});

test("#5915: average session score covers only scored sessions, never counts a race day as 0", () => {
  const rider = aggregateTrainingRuns([0, 1, 2, 3, 4].map(i => run(i, i === 2 ? { race_day: true } : {})))[0].report.riders[0];
  const view = { sessions: [0, 1, 3].map((gameDay, i) => ({ date, seasonId: "s4", gameDay, score: [50, 61, 58][i] })) };
  assert.equal(averagePassScore(view, date, "s4", rider.activities), 56);
  assert.equal(averagePassScore(undefined, date, "s4", rider.activities), null);
});

test("#5915: riders sort by first name, last name or average score (unscored last)", () => {
  const riders = [{ rider_id: "a", name: "Hugo Zane" }, { rider_id: "b", name: "Anna Berg" }, { rider_id: "c", name: "Carl Ahl" }];
  const scores: Record<string, number | null> = { a: 61, b: null, c: 54 };
  assert.deepEqual(sortReceiptRiders(riders, "name").map(r => r.rider_id), ["b", "c", "a"]);
  assert.deepEqual(sortReceiptRiders(riders, "lastname").map(r => r.rider_id), ["c", "b", "a"]);
  assert.deepEqual(sortReceiptRiders(riders, "score", r => scores[r.rider_id]).map(r => r.rider_id), ["a", "c", "b"]);
  assert.deepEqual(riders.map(r => r.rider_id), ["a", "b", "c"], "sorting must not mutate the receipt");
});

test("ability receipts expose the full date contribution separately from the wrapped progress-bar segment", () => {
  const rows=abilityReceipt(["tempo"],{abilities:{tempo:56},progress:{tempo:0.2},
    progressBefore:{tempo:0.8},gainsToday:{tempo:2},gainPercentToday:{tempo:140}});
  assert.equal(rows[0].dailyGainPct,140);
  assert.equal(abilityReceiptGainPct(rows[0]),140);
  assert.equal(rows[0].yesterdayPct,20);
});

test("older ability receipts retain the legacy contribution when no stored final progress exists", () => {
  const rows=abilityReceipt(["tempo"],{abilities:{tempo:54},progress:{tempo:0.2},
    progressBefore:{tempo:0.1},gainsToday:{},gainPercentToday:{tempo:null}});
  assert.equal(abilityReceiptGainPct(rows[0]),10);
});
