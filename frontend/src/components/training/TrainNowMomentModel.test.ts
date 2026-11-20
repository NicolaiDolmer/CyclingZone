import test from "node:test";
import assert from "node:assert/strict";
import {
  MOMENT_TOTAL_MS, buildMomentView, momentMode, momentWaitingIds, orderRiders, previewMoment, rowProgress, splitGains,
  withTrainedNow, xpAt, xpTier,
} from "./TrainNowMomentModel.ts";
import { buildXpReportFixture, XP_FIXTURE_LAST_DATE } from "./reportXp/xpReportFixture.ts";
import type { XpReceipt, XpRiderReceipt } from "../../lib/trainingReportXp.ts";

// Invented riders and numbers: a shape test, not game data.
function rider(id: string, name: string, xp: Record<string, number> | null, extra: Partial<XpRiderReceipt> = {}): XpRiderReceipt {
  return {
    rider_id: id, name, activities: [
      { rider_id: id, name, game_day: 0, race_day: false, focus: "tempo", intensity: "hard", gains: {}, ...(xp ? { xp } : {}) },
    ],
    gains: {}, gains_detail: {}, form_before: 50, fatigue_before: 10, form: 50, fatigue: 12,
    ...extra,
  } as unknown as XpRiderReceipt;
}
function receipt(date: string, riders: XpRiderReceipt[]): XpReceipt {
  return { tick_date: date, season_id: "s", receipt_status: "complete", game_days: [0], expected_game_days: [0], trained_now_slots: [],
    report: { riders, condition_settled: true } } as unknown as XpReceipt;
}

const DATE = "2026-11-19";
const runs = [receipt(DATE, [
  rider("a", "Anna Berg", { climbing: 40 }, { gains: { climbing: 1 }, gains_detail: { climbing: { from: 70, to: 71 } } } as Partial<XpRiderReceipt>),
  rider("b", "Bo Carlsen", { tempo: 12 }),
  rider("c", "Carl Dam", { sprint: 25 }),
  rider("d", "Dan Eriksen", null),
])];

test("off unless the switch is on AND the press's own date carries XP", () => {
  assert.equal(momentMode({ preview: false, flagOn: false, runs, date: DATE }), "off");
  assert.equal(momentMode({ preview: false, flagOn: true, runs, date: null }), "off");
  assert.equal(momentMode({ preview: false, flagOn: true, runs, date: "2026-11-18" }), "off");
  assert.equal(momentMode({ preview: false, flagOn: true, runs: [receipt(DATE, [rider("x", "X Y", null)])], date: DATE }), "off");
  assert.equal(momentMode({ preview: false, flagOn: true, runs, date: DATE }), "live");
  assert.equal(momentMode({ preview: true, flagOn: false, runs: [], date: null }), "fixture");
});

test("the preview override only exists on the preview build", () => {
  assert.equal(previewMoment(false, "?xp=1"), false);
  assert.equal(previewMoment(true, "?xp=1"), true);
  assert.equal(previewMoment(true, "?xpreport=on"), true);
  assert.equal(previewMoment(true, "?tab=today"), false);
});

test("rows follow the roster's fixed order, unknown riders last by last name", () => {
  const view = buildMomentView(runs, DATE, {
    roster: [{ id: "c", name: "Carl Dam", age: 24 }, { id: "a", name: "Anna Berg", age: 31 }],
  })!;
  assert.deepEqual(view.rows.map(r => r.id), ["c", "a", "b", "d"]);
  assert.equal(view.rows[0].age, 24);
  assert.equal(view.rows[2].age, null);
  assert.deepEqual(orderRiders([{ id: "x", name: "Zed Abel" }, { id: "y", name: "Al Zorn" }], []).map(r => r.id), ["x", "y"]);
});

test("the summary is the receipt's own numbers, and one gold row for the day's best", () => {
  const view = buildMomentView(runs, DATE)!;
  assert.equal(view.xp, 77);
  assert.equal(view.points, 1);
  assert.equal(view.riders, 4);
  assert.equal(view.bestId, "a");
  const byId = Object.fromEntries(view.rows.map(r => [r.id, r]));
  assert.equal(byId.a.tier, "best");
  assert.equal(byId.c.tier, "mid");
  assert.equal(byId.b.tier, "low");
  assert.equal(byId.d.xp, 0);
  assert.deepEqual(byId.a.gains, [{ key: "climbing", kind: "earned", from: 70, to: 71, points: 1 }]);
  assert.equal(byId.a.share, 1);
});

test("a tie with the best stays green: only one gold row", () => {
  const tie = [receipt(DATE, [rider("a", "A A", { tempo: 30 }), rider("b", "B B", { tempo: 30 })])];
  const view = buildMomentView(tie, DATE)!;
  assert.deepEqual(view.rows.map(r => r.tier).sort(), ["best", "mid"]);
});

test("a rider racing today waits for the stage instead of showing +0", () => {
  const view = buildMomentView(runs, DATE, {
    roster: [{ id: "d", name: "Dan Eriksen", age: 22 }, { id: "r", name: "Rasmus Ny", age: 27 }],
    waitingIds: ["d", "r", "ghost"],
  })!;
  const byId = Object.fromEntries(view.rows.map(r => [r.id, r]));
  assert.equal(byId.d.waiting, true);
  assert.equal(byId.r.waiting, true);
  assert.equal(byId.r.name, "Rasmus Ny");
  assert.equal(byId.ghost, undefined, "no row without a name to show");
  assert.equal(view.riders, 3, "waiting riders are not counted as trained");
});

test("waiting = racing riders the press did not train now", () => {
  assert.deepEqual(momentWaitingIds(null), []);
  assert.deepEqual(momentWaitingIds({ afterRaceRiderIds: ["r1", "r2"] }), ["r1", "r2"]);
  assert.deepEqual(momentWaitingIds({ afterRaceRiderIds: ["r1", "r2"], instantRiderIds: ["r1"] }), ["r2"]);
});

test("a pending date shows what the press already trained (trained_now), on a copy", () => {
  const pending = [receipt(DATE, [rider("p", "Per Holm", { tempo: 40 }, {
    receipt_status: "pending", gains: {}, gains_detail: {},
    trained_now: { gains: { tempo: 1 }, gains_detail: { tempo: { from: 54, to: 55 } }, gain_percent: {} },
  } as Partial<XpRiderReceipt>)])];
  const view = buildMomentView(pending, DATE)!;
  assert.equal(view.points, 1);
  assert.deepEqual(view.rows[0].gains, [{ key: "tempo", kind: "earned", from: 54, to: 55, points: 1 }]);
  assert.deepEqual(pending[0].report.riders[0].gains, {}, "the stored receipt is not changed");
  // A settled date keeps its own gains; trained_now is never read there.
  const settled = withTrainedNow([receipt(DATE, [rider("q", "Q", { tempo: 5 }, { receipt_status: "complete", gains: {},
    trained_now: { gains: { tempo: 1 }, gains_detail: {}, gain_percent: {} } } as Partial<XpRiderReceipt>)])], DATE);
  assert.deepEqual(settled[0].report.riders[0].gains, {});
});

test("points paid out from the bar are never shown as today's training", () => {
  const paidRuns = [receipt(DATE, [
    // Rest day: no XP today, one climbing point paid out from saved XP.
    rider("r", "Rest Rider", null, { gains: { climbing: 1 }, gains_detail: { climbing: { from: 75, to: 76 } }, bar_paid: { climbing: 1 } } as Partial<XpRiderReceipt>),
    // Both kinds on one ability: one paid first, then one earned.
    rider("m", "Mixed Rider", { climbing: 50 }, { gains: { climbing: 2 }, gains_detail: { climbing: { from: 60, to: 62 } }, bar_paid: { climbing: 1 } } as Partial<XpRiderReceipt>),
  ])];
  const view = buildMomentView(paidRuns, DATE)!;
  const byId = Object.fromEntries(view.rows.map(r => [r.id, r]));
  assert.deepEqual(byId.r.gains, [{ key: "climbing", kind: "paid", from: 75, to: 76, points: 1 }]);
  assert.equal(byId.r.points, 0);
  assert.deepEqual(byId.m.gains, [
    { key: "climbing", kind: "paid", from: 60, to: 61, points: 1 },
    { key: "climbing", kind: "earned", from: 61, to: 62, points: 1 },
  ]);
  assert.equal(view.points, 1, "earned today");
  assert.equal(view.paid, 2, "paid out from the bar, its own figure");
  assert.deepEqual(splitGains({ key: "x", from: null, to: null, earned: 1, paid: 1 }).map(g => [g.kind, g.from, g.to]), [["paid", null, null], ["earned", null, null]]);
});

test("the moment never shows another date's receipt", () => {
  assert.equal(buildMomentView(runs, "2026-11-20"), null);
});

test("every team size plays inside the six seconds and ends complete", () => {
  assert.ok(MOMENT_TOTAL_MS < 6000);
  for (const count of [1, 2, 12, 30, 60]) {
    assert.equal(rowProgress(1, count - 1, count), 1);
    assert.equal(rowProgress(0, 0, count), 0);
    // Several rows run at once: the first is not done when the second starts.
    if (count > 1) assert.ok(rowProgress(0.2, 1, count) > 0 || rowProgress(0.2, 0, count) < 1);
    for (let i = 0; i < count; i += 1) assert.equal(rowProgress(1, i, count), 1);
  }
  assert.equal(rowProgress(0.5, 3, 0), 1);
});

test("the count lands exactly on the receipt's number", () => {
  assert.equal(xpAt(470, 1), 470);
  assert.equal(xpAt(470, 0), 0);
  assert.ok(xpAt(470, 0.5) > 0 && xpAt(470, 0.5) < 470);
});

test("tiers are relative to the day's best", () => {
  assert.equal(xpTier(0, 100), "low");
  assert.equal(xpTier(100, 100), "best");
  assert.equal(xpTier(60, 100), "mid");
  assert.equal(xpTier(20, 100), "low");
  assert.equal(xpTier(10, 0), "low");
});

test("the preview fixture plays its last date", () => {
  const fx = buildXpReportFixture();
  const view = buildMomentView(fx.receipts, XP_FIXTURE_LAST_DATE, { options: { types: fx.types } })!;
  assert.ok(view.rows.length > 0);
  assert.equal(view.rows.filter(r => r.tier === "best").length, 1);
  assert.ok(view.rows.every(r => r.type));
});
