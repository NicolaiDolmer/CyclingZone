import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandText, barPct, buildDevelopmentRows, devSummary, nextSort, previewXpDevelopment, sortDevRows, topOf, topSortValue,
  xpDevelopmentMode, buildDevelopmentFixture, DEFAULT_SORT, DEV_FIXTURE_TODAY, MAX_ABILITIES, type DevRiderInput,
} from "./DevelopmentTabXpModel.ts";
import type { XpReceipt } from "../../lib/trainingReportXp.ts";

// Invented receipts: two dates, two riders. Numbers are test values, not the model's.
function receipt(date: string, status: XpReceipt["receipt_status"], riders: Array<{ id: string; xp: Record<string, number>; race?: boolean; gains?: Record<string, number>; bar?: Record<string, { xp: number; price: number }> }>): XpReceipt {
  return {
    tick_date: date, season_id: "s", receipt_status: status, game_days: [0], expected_game_days: [0], trained_now_slots: [],
    report: {
      condition_settled: status === "complete",
      riders: riders.map(r => ({
        rider_id: r.id, name: r.id.toUpperCase(), receipt_status: status, gains: r.gains ?? {}, gains_detail: {}, gain_percent: {},
        progress_before: {}, trained_now: null, form: 50, fatigue: 10, form_before: 50, fatigue_before: 10, fatigue_delta: 0,
        race_day: !!r.race, xp_bar: r.bar ?? null,
        activities: [{ rider_id: r.id, name: r.id, game_day: 0, race_day: !!r.race, focus: null, intensity: "hard", gains: r.gains ?? {}, xp: r.xp }],
      })) as never,
    },
  } as unknown as XpReceipt;
}

const rider = (id: string, extra: Partial<DevRiderInput> = {}): DevRiderInput => ({
  id, name: id.toUpperCase(), nation: "dk", type: { primary: "climber", secondary: null }, rating: 70,
  abilities: { climbing: 72, flat: 60 }, top: { kind: "none" }, racingToday: false, ...extra,
});

const RUNS = [
  receipt("2026-11-19", "complete", [
    { id: "a", xp: { climbing: 30 }, gains: { climbing: 1 }, bar: { climbing: { xp: 10, price: 40 }, flat: { xp: 35, price: 40 } } },
    { id: "b", xp: { flat: 20 }, race: true, bar: { flat: { xp: 0, price: 40 } } },
  ]),
  receipt("2026-11-18", "complete", [
    { id: "a", xp: { climbing: 50 } },
    { id: "b", xp: { flat: 15 } },
  ]),
];

test("barPct: share of the bar in whole percent, never 100", () => {
  assert.equal(barPct({ xp: 10, price: 40 }), 25);
  assert.equal(barPct({ xp: 40, price: 40 }), 99);
  assert.equal(barPct({ xp: -5, price: 40 }), 0);
  assert.equal(barPct({ xp: 5, price: 0 }), null);
  assert.equal(barPct(null), null);
});

test("expected top: the shared estimate when it is there, else the band without false precision", () => {
  const view = topOf({ potentialView: { hidden: false, value: 74, certainty: "fair" } });
  assert.equal(view.kind, "view");
  assert.equal(topSortValue(view), 74);
  const band = topOf({ prog: { lo: 66, hi: 66 } });
  assert.deepEqual(band, { kind: "band", lo: 66, hi: 66 });
  assert.equal(bandText(band as { lo: number; hi: number }), "66", "never an interval without width");
  assert.equal(bandText({ lo: 64, hi: 69 }), "64-69");
  assert.deepEqual(topOf(undefined), { kind: "none" });
  assert.equal(topSortValue({ kind: "none" }), null);
});

test("rows read XP today, 30 days, the next point and the season from the receipts", () => {
  const rows = buildDevelopmentRows({ runs: RUNS, riders: [rider("a"), rider("b")], todayKey: "2026-11-19", seasonGains: { a: { climbing: 3, flat: 0 }, b: null } });
  const a = rows.find(r => r.id === "a")!;
  assert.deepEqual(a.today, { state: "xp", xp: 30, point: "climbing" });
  assert.equal(a.xp30, 80);
  assert.deepEqual(a.spark, [50, 30]);
  assert.deepEqual(a.next, { key: "flat", pct: 87 });
  assert.equal(a.season, 3);
  assert.deepEqual(a.abilities.map(x => [x.key, x.now, x.season, x.pct]), [["climbing", 72, 3, 25], ["flat", 60, 0, 87]]);
  const b = rows.find(r => r.id === "b")!;
  assert.equal(b.season, null, "no season to count shows a dash, not +0");
  assert.equal(b.abilities[0].season, null);
});

test("a rider in a race today is locked until the date is settled", () => {
  const pending = [receipt("2026-11-19", "pending", [{ id: "a", xp: { climbing: 10 } }, { id: "b", xp: {}, race: true }]), RUNS[1]];
  const rows = buildDevelopmentRows({ runs: pending, riders: [rider("a"), rider("b", { racingToday: true })], todayKey: "2026-11-19", seasonGains: {} });
  assert.deepEqual(rows[1].today, { state: "locked" });
  assert.deepEqual(rows[0].today, { state: "xp", xp: 10, point: null });
  const settled = buildDevelopmentRows({ runs: RUNS, riders: [rider("b", { racingToday: true })], todayKey: "2026-11-19", seasonGains: {} });
  assert.equal(settled[0].today.state, "xp");
  const preview = buildDevelopmentRows({ runs: RUNS, riders: [rider("b", { racingToday: true })], todayKey: "2026-11-19", seasonGains: {}, forceUnsettled: true });
  assert.equal(preview[0].today.state, "locked");
});

test("before today's training there is no XP today, not a zero", () => {
  const rows = buildDevelopmentRows({ runs: RUNS, riders: [rider("a")], todayKey: "2026-11-20", seasonGains: {} });
  assert.deepEqual(rows[0].today, { state: "none" });
});

test("a rider missing from today's receipt (e.g. signed after training) is unknown, not a measured zero", () => {
  const rows = buildDevelopmentRows({ runs: RUNS, riders: [rider("new")], todayKey: "2026-11-19", seasonGains: {} });
  assert.deepEqual(rows[0].today, { state: "none" });
  assert.equal(rows[0].next, null);
  assert.equal(rows[0].xp30, 0);
});

test("the summary line adds up the rows", () => {
  const rows = buildDevelopmentRows({ runs: RUNS, riders: [rider("a"), rider("b", { racingToday: true })], todayKey: "2026-11-19", seasonGains: { a: { climbing: 3 } }, forceUnsettled: true });
  assert.deepEqual(devSummary(rows), { riders: 2, xpToday: 30, unsettled: 1, xp30: 115, seasonPoints: 3, close: 1 });
  assert.equal(devSummary([]).seasonPoints, null);
});

test("sorting: missing values last in both directions, text A-Z first", () => {
  const rows = buildDevelopmentRows({ runs: RUNS, riders: [rider("a", { rating: 60 }), rider("b", { rating: null }), rider("c", { rating: 75 })], todayKey: "2026-11-19", seasonGains: {} });
  assert.deepEqual(sortDevRows(rows, { key: "rating", dir: -1 }).map(r => r.id), ["c", "a", "b"]);
  assert.deepEqual(sortDevRows(rows, { key: "rating", dir: 1 }).map(r => r.id), ["a", "c", "b"]);
  assert.deepEqual(sortDevRows(rows, DEFAULT_SORT).map(r => r.id), ["a", "b", "c"]);
  assert.deepEqual(nextSort(DEFAULT_SORT, "rider"), { key: "rider", dir: 1 });
  assert.deepEqual(nextSort(DEFAULT_SORT, "xp30"), { key: "xp30", dir: 1 });
});

test("the surface: off by default, live only with the switch and XP in the receipts, fixture only on the preview", () => {
  assert.equal(xpDevelopmentMode({ preview: false, flagOn: false, hasXp: true }), "off");
  assert.equal(xpDevelopmentMode({ preview: false, flagOn: true, hasXp: false }), "off");
  assert.equal(xpDevelopmentMode({ preview: false, flagOn: true, hasXp: true }), "live");
  assert.equal(xpDevelopmentMode({ preview: true, flagOn: false, hasXp: false }), "fixture");
  assert.equal(previewXpDevelopment(true, "?tab=development&xp=1"), true);
  assert.equal(previewXpDevelopment(false, "?xp=1"), false, "never outside the preview build");
  assert.equal(previewXpDevelopment(true, "?tab=development"), false);
});

test("the preview fixture fills every column", () => {
  const fx = buildDevelopmentFixture();
  const rows = buildDevelopmentRows({ runs: fx.runs, riders: fx.riders, todayKey: DEV_FIXTURE_TODAY, seasonGains: fx.seasonGains, forceUnsettled: true });
  assert.ok(rows.length >= 8);
  assert.ok(rows.some(r => r.today.state === "locked"));
  assert.ok(rows.some(r => r.today.state === "xp"));
  assert.ok(rows.every(r => r.next && r.abilities.length > 0 && r.abilities.length <= MAX_ABILITIES));
  assert.ok(rows.some(r => r.top.kind === "view"));
  assert.ok(rows.every(r => r.xp30 > 0 && r.spark.length === 30));
});
