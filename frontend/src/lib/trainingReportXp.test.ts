import test from "node:test";
import assert from "node:assert/strict";
import {
  barSegments, buildMonthView, buildTodayView, filterMonthRiders, filterTodayRiders, hasXpFields,
  raceShare, stripWindow, xpBySource, xpDays, xpOfPrice, TIRED_FATIGUE,
  type XpActivity, type XpReceipt, type XpRiderReceipt,
} from "./trainingReportXp.ts";
import { buildXpReportFixture, XP_FIXTURE_LAST_DATE } from "../components/training/reportXp/xpReportFixture.ts";
import { readFileSync } from "node:fs";
import { aggregateTrainingRuns, type TrainingRun } from "./trainingDailyReceipt.ts";

const slot = (over: Partial<XpActivity>): XpActivity => ({ rider_id: "a", game_day: 0, ...over });
function rider(id: string, activities: XpActivity[], over: Partial<XpRiderReceipt> = {}): XpRiderReceipt {
  return {
    rider_id: id, name: id, activities, receipt_status: "complete", gains: {}, gains_detail: {}, gain_percent: {},
    progress_before: {}, trained_now: null, form_before: 50, fatigue_before: 10, form: 52, fatigue: 14, ...over,
  };
}
const receipt = (date: string, riders: XpRiderReceipt[]): XpReceipt => ({
  tick_date: date, receipt_status: "complete", game_days: [0, 1, 2, 3, 4], expected_game_days: null, trained_now_slots: [],
  report: { riders, condition_settled: true },
});

test("hasXpFields is false for today's payload and true once a slot carries xp", () => {
  assert.equal(hasXpFields([{ report: { riders: [{ activities: [slot({ gains: { sprint: 1 } })] }] } }]), false);
  assert.equal(hasXpFields([]), false);
  assert.equal(hasXpFields(null), false);
  assert.equal(hasXpFields([{ report: { riders: [{ activities: [slot({ xp: { sprint: 3 } })] }] } }]), true);
});

test("xpBySource splits XP by the kind of slot and ignores junk", () => {
  const split = xpBySource([
    slot({ xp: { sprint: 4, flat: 2 } }),
    slot({ race_day: true, xp: { sprint: 3, endurance: 5 } }),
    slot({ xp: { sprint: -2, flat: Number.NaN } }),
  ]);
  assert.deepEqual(split, { sprint: { training: 4, race: 3 }, flat: { training: 2, race: 0 }, endurance: { training: 0, race: 5 } });
});

test("raceShare never rounds a source away and is null without a race", () => {
  assert.equal(raceShare(10, 0), null);
  assert.equal(raceShare(0, 0), null);
  assert.equal(raceShare(0, 7), 100);
  assert.equal(raceShare(1000, 1), 1);
  assert.equal(raceShare(1, 1000), 99);
  assert.equal(raceShare(20, 80), 80);
});

test("barSegments: before today, training and race as shares of the price", () => {
  // No point bought: 10 of 40 XP now, 6 of them today (4 training, 2 race).
  assert.deepEqual(barSegments({ xp: 10, price: 40 }, 4, 2), { before: 4 / 40, training: 4 / 40, race: 2 / 40 });
  // A point bought with today's XP: saved XP is spent first, only today's remainder shows.
  const bought = barSegments({ xp: 3, price: 30 }, 0, 9)!;
  assert.equal(bought.before, 0);
  assert.equal(bought.training, 0);
  assert.equal(bought.race, 3 / 30);
  // Rest day with a point paid out from the bar: what is left is older XP, never "today".
  assert.deepEqual(barSegments({ xp: 12, price: 40 }, 0, 0), { before: 12 / 40, training: 0, race: 0 });
  assert.equal(barSegments(null, 1, 1), null);
  assert.equal(barSegments({ xp: 1, price: 0 }, 1, 1), null);
});

test("earned today vs paid out from the bar: rest day, change of focus and totals (Fable point 5)", () => {
  const restDay = rider("rest", [slot({ intensity: "rest" }), slot({ intensity: "rest", game_day: 1 })], {
    gains: { climbing: 1 }, gains_detail: { climbing: { from: 61, to: 62 } }, bar_paid: { climbing: 1 },
    xp_bar: { climbing: { xp: 5, price: 50 } },
  });
  const newFocus = rider("focus", [slot({ xp: { tempo: 9, recovery: 4 } }), slot({ game_day: 1, xp: { tempo: 30 } })], {
    gains: { climbing: 1, tempo: 1 }, bar_paid: { climbing: 1 },
  });
  const plain = rider("plain", [slot({ xp: { sprint: 40 } })], { gains: { sprint: 1 } });
  // A bad payload never shows more paid out than landed.
  const junk = rider("junk", [slot({ xp: { flat: 2 } })], { gains: { flat: 1 }, bar_paid: { flat: 3, sprint: 2 } });
  const day = buildTodayView([receipt("2026-11-15", [restDay, newFocus, plain, junk])], null)!;
  const byId = Object.fromEntries(day.riders.map(r => [r.id, r]));
  assert.deepEqual([byId.rest.xp, byId.rest.earned, byId.rest.paid, byId.rest.paidAbility], [0, 0, 1, "climbing"]);
  assert.deepEqual([byId.focus.earned, byId.focus.paid, byId.focus.pointAbility, byId.focus.paidAbility], [1, 1, "tempo", "climbing"]);
  assert.deepEqual([byId.plain.earned, byId.plain.paid], [1, 0]);
  assert.deepEqual([byId.junk.earned, byId.junk.paid], [0, 1]);
  const climbing = byId.rest.abilities.find(a => a.key === "climbing")!;
  assert.deepEqual([climbing.points, climbing.earned, climbing.paid, climbing.xp], [1, 0, 1, 0]);
  assert.deepEqual(climbing.segments, { before: 5 / 50, training: 0, race: 0 });
  assert.deepEqual([day.points, day.earned, day.paid, day.earnedRiders, day.paidRiders], [5, 2, 3, 2, 3]);
  // Without the field nothing is paid out: every point is earned (today's behaviour).
  const none = buildTodayView([receipt("2026-11-15", [rider("x", [slot({ xp: { sprint: 40 } })], { gains: { sprint: 2 } })])], null)!;
  assert.deepEqual([none.earned, none.paid], [2, 0]);
  const month = buildMonthView([receipt("2026-11-15", [restDay, newFocus]), receipt("2026-11-14", [rider("rest", [slot({ xp: { climbing: 70 } })], { gains: { climbing: 1 } })])])!;
  assert.deepEqual([month.points, month.earned, month.paid], [4, 2, 2]);
  assert.deepEqual([month.riders.find(r => r.id === "rest")!.earned, month.riders.find(r => r.id === "rest")!.paid], [1, 1]);
});

test("the preview fixture shows a rest-day payout and a change of focus on its last date", () => {
  const view = buildTodayView(buildXpReportFixture().receipts, null)!;
  const rest = view.riders.find(r => r.id === "fx-6")!;
  assert.ok(rest.sessions.every(s => s.kind === "rest"));
  assert.equal(rest.xp, 0);
  assert.ok(rest.paid > 0);
  const focus = view.riders.find(r => r.id === "fx-1")!;
  assert.ok(focus.paid > 0 && focus.xp > 0);
  assert.equal(focus.abilities.find(a => a.paid > 0)!.xp, 0, "the paid ability got no XP after the change of focus");
  assert.ok(view.paid > 0 && view.earned > 0);
});

test("xpOfPrice never rounds up to a point that has not landed", () => {
  assert.deepEqual(xpOfPrice({ xp: 29.9, price: 30 }), { xp: 29, price: 30 });
  assert.deepEqual(xpOfPrice({ xp: 12.4, price: 30.2 }), { xp: 12, price: 30 });
});

test("stripWindow keeps the latest seven, or the seven ending at an older pick", () => {
  const days = Array.from({ length: 12 }, (_, i) => i);
  assert.deepEqual(stripWindow(days, 11), [5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(stripWindow(days, 7), [5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(stripWindow(days, 3), [0, 1, 2, 3]);
  assert.deepEqual(stripWindow([1, 2], 0), [1, 2]);
});

test("buildTodayView: totals, filters, a single point names its ability", () => {
  const runs = [
    receipt("2026-11-02", [
      rider("Ada", [slot({ xp: { sprint: 5 } }), slot({ race_day: true, xp: { sprint: 3, flat: 2 } })],
        { gains: { sprint: 1 }, gains_detail: { sprint: { from: 54, to: 55 } }, xp_bar: { sprint: { xp: 2, price: 40 }, flat: { xp: 9, price: 30 } } }),
      rider("Bo", [slot({ xp: { tempo: 4 } }), slot({ intensity: "rest" })]),
      rider("Cy", [slot({ race_day: true, xp: { flat: 6 } })], { gains: { flat: 2, tempo: 1 } }),
    ]),
    receipt("2026-11-01", [rider("Ada", [slot({ xp: { sprint: 10 } })])]),
  ];
  const view = buildTodayView(runs, null, { scoreOf: (_id, _d, a) => (a.race_day ? null : 60) })!;
  assert.equal(view.date, "2026-11-02");
  assert.equal(view.previous, "2026-11-01");
  assert.equal(view.next, null);
  assert.equal(view.xp, 20);
  assert.equal(view.race, 11);
  assert.equal(view.training, 9);
  assert.equal(view.xp30, 30);
  assert.equal(view.points, 4);
  assert.equal(view.pointRiders, 2);
  assert.equal(view.racePercent, raceShare(9, 11));
  assert.deepEqual(view.counts, { all: 3, gained: 2, raced: 2, notRaced: 1 });
  assert.deepEqual(view.riders.map(r => r.id), ["Cy", "Ada", "Bo"]);
  const ada = view.riders.find(r => r.id === "Ada")!;
  assert.equal(ada.pointAbility, "sprint");
  assert.equal(view.riders[0].pointAbility, null);
  assert.deepEqual(ada.sessions.map(s => s.kind), ["training", "race"]);
  assert.equal(ada.sessions[1].score, null);
  assert.equal(ada.sessionScore, 60);
  const sprint = ada.abilities[0];
  assert.equal(sprint.key, "sprint");
  assert.deepEqual([sprint.from, sprint.to, sprint.training, sprint.race], [54, 55, 5, 3]);
  assert.equal(sprint.segments!.before, 0);
  assert.deepEqual(filterTodayRiders(view.riders, "notRaced").map(r => r.id), ["Bo"]);
  assert.deepEqual(filterTodayRiders(view.riders, "gained").map(r => r.id), ["Cy", "Ada"]);
  const older = buildTodayView(runs, "2026-11-01")!;
  assert.equal(older.next, "2026-11-02");
  assert.equal(older.racePercent, null);
});

test("buildTodayView is null without receipts", () => {
  assert.equal(buildTodayView([], null), null);
  assert.equal(buildMonthView([]), null);
});

test("buildMonthView: per-day sums, the closest next point and tired riders", () => {
  const runs = [
    receipt("2026-11-02", [
      rider("Ada", [slot({ race_day: true, xp: { flat: 4 } })], { fatigue: TIRED_FATIGUE, xp_bar: { flat: { xp: 9, price: 10 }, sprint: { xp: 5, price: 50 } } }),
      rider("Bo", [slot({ xp: { tempo: 2 } })], { fatigue: 5, xp_bar: { tempo: { xp: 1, price: 30 } } }),
    ]),
    receipt("2026-11-01", [rider("Ada", [slot({ xp: { flat: 6 } })], { gains: { flat: 1 } })]),
  ];
  const view = buildMonthView(runs)!;
  assert.deepEqual(view.days.map(d => [d.date, d.training, d.race, d.points]), [["2026-11-01", 6, 0, 1], ["2026-11-02", 2, 4, 0]]);
  assert.equal(view.xp, 12);
  assert.equal(view.points, 1);
  assert.equal(view.tired, 1);
  const ada = view.riders.find(r => r.id === "Ada")!;
  assert.deepEqual(ada.spark, [6, 4]);
  assert.deepEqual(ada.next, { key: "flat", xp: 9, price: 10 });
  assert.equal(ada.fatigue, TIRED_FATIGUE);
  const bo = view.riders.find(r => r.id === "Bo")!;
  assert.deepEqual(bo.spark, [0, 2]);
  assert.deepEqual(filterMonthRiders(view.riders, "closest").map(r => r.id), ["Ada", "Bo"]);
  assert.deepEqual(filterMonthRiders(view.riders, "tired").map(r => r.id), ["Ada"]);
});

test("the month view never estimates days to the next point (H6b)", () => {
  const view = buildMonthView(buildXpReportFixture().receipts)!;
  for (const r of view.riders) assert.deepEqual(Object.keys(r.next ?? {}).sort(), r.next ? ["key", "price", "xp"] : []);
});

test("the preview fixture is deterministic and complete", () => {
  const a = buildXpReportFixture(), b = buildXpReportFixture();
  assert.deepEqual(a.receipts, b.receipts);
  assert.equal(a.receipts.length, 30);
  assert.equal(a.receipts[0].tick_date, XP_FIXTURE_LAST_DATE);
  assert.equal(hasXpFields(a.receipts), true);
  const days = xpDays(a.receipts);
  assert.ok(days.some(d => d.race > 0) && days.some(d => d.training > 0));
  const today = buildTodayView(a.receipts, null, { nations: a.nations })!;
  assert.ok(today.riders.every(r => typeof r.nation === "string"));
  assert.ok(today.riders.some(r => r.points > 0));
  // A bar holds a whole point or more only when the date's points already landed
  // (the rest waits for a later date); "x of y XP" never shows it as bought.
  for (const r of today.riders) for (const ab of r.abilities) {
    if (ab.bar && ab.bar.xp >= ab.bar.price) assert.ok(ab.points > 0, `${r.id} ${ab.key}`);
    if (ab.bar) assert.ok(xpOfPrice(ab.bar).xp < xpOfPrice(ab.bar).price, `${r.id} ${ab.key}`);
  }
});

test("live path: the page's receipts are aggregated once, and the report reads them as they are (Codex P2)", () => {
  // Five raw slots for one date, as the backend stores them.
  const raw = [0, 1, 2, 3, 4].map(day => ({
    tick_date: "2026-11-15", season_id: "s", created_at: `2026-11-15T0${day}:00:00Z`,
    report: { game_day: day, riders: [{ rider_id: "a", name: "A B", game_day: day, intensity: "hard", focus: "tempo",
      gains: day === 4 ? { tempo: 1 } : {}, xp: { tempo: 8 },
      ...(day === 4 ? { bar_paid: {}, xp_bar: { tempo: { xp: 3, price: 40 } } } : {}) }] },
  })) as unknown as TrainingRun[];
  // useTraining / useTrainingHistory aggregate once; that is what the page hands over.
  const receipts = aggregateTrainingRuns(raw) as unknown as XpReceipt[];
  const rider = buildTodayView(receipts, null)!.riders[0];
  assert.equal(rider.sessions.length, 5);
  assert.equal(rider.xp, 40);
  assert.deepEqual(rider.abilities[0].bar, { xp: 3, price: 40 });
  // A second aggregation would read each daily row as one slot and lose the day.
  const twice = buildTodayView(aggregateTrainingRuns(receipts as unknown as TrainingRun[]) as unknown as XpReceipt[], null)!.riders[0];
  assert.notEqual(twice.sessions.length, 5);
  // The surface never aggregates again.
  const src = readFileSync(new URL("../components/training/reportXp/TrainingReportXp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /aggregateTrainingRuns\(/);
});

test("bar_paid written on the date's first slot survives aggregation (review P2)", () => {
  // Rest day: the payout lands on slot 0, where the bar already covered a point.
  const raw = [0, 1, 2, 3, 4].map(day => ({
    tick_date: "2026-11-15", season_id: "s", created_at: `2026-11-15T0${day}:00:00Z`,
    report: { game_day: day, riders: [{ rider_id: "a", name: "A B", game_day: day, intensity: "rest",
      gains: day === 0 ? { climbing: 1 } : {}, ...(day === 0 ? { bar_paid: { climbing: 1 } } : {}) }] },
  })) as unknown as TrainingRun[];
  const rider = buildTodayView(aggregateTrainingRuns(raw) as unknown as XpReceipt[], null)!.riders[0];
  assert.deepEqual([rider.points, rider.earned, rider.paid, rider.paidAbility], [1, 0, 1, "climbing"]);
});

test("a picked date that is gone falls back to the latest day, not the oldest (review P3)", () => {
  const runs = [receipt("2026-11-15", [rider("a", [slot({ xp: { sprint: 1 } })])]), receipt("2026-11-14", [rider("a", [slot({ xp: { sprint: 1 } })])])];
  assert.equal(buildTodayView(runs, "2026-10-01")!.date, "2026-11-15");
  assert.equal(buildTodayView(runs, "2026-11-14")!.date, "2026-11-14");
});
