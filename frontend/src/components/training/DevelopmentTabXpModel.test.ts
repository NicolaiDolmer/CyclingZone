import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandText, barPct, buildDevelopmentRows, devSummary, nextSort, previewXpDevelopment, sortDevRows, topOf, topSortValue,
  xpDevelopmentMode, buildDevelopmentFixture, seasonRatingChange, signedText, DEFAULT_SORT, DEV_FIXTURE_TODAY, MAX_ABILITIES, type DevRiderInput,
  dayKeyMinus, dayXpByAbility, gainsLast30, xpLineOf,
  DEV_COLUMNS, defaultDevColumns, parseDevColumns, serializeDevColumns, sortAfterColumns, toggleDevColumn,
} from "./DevelopmentTabXpModel.ts";
import type { XpReceipt } from "../../lib/trainingReportXp.ts";
import { riderOverallRating as riderOverallRatingJs } from "../../lib/riderRating.js";

const riderOverallRating = riderOverallRatingJs as unknown as (rider: Record<string, unknown>) => number | null;

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
  id, name: id.toUpperCase(), nation: "dk", natural: { primary: "climber", secondary: "puncheur" }, bestRole: "climber", rating: 70,
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
  assert.deepEqual(a.next, { key: "flat", pct: 87, xp: 35, price: 40 }, "ejer 19/11: the next point carries x / y XP");
  assert.equal(a.season, 3);
  assert.deepEqual(a.abilities.map(x => [x.key, x.now, x.season, x.pct]), [["climbing", 72, 3, 25], ["flat", 60, 0, 87]]);
  const b = rows.find(r => r.id === "b")!;
  assert.equal(b.season, null, "no season to count shows a dash, not +0");
  assert.equal(b.abilities[0].season, null);
});

test("ejer 20/11: a rider in a race today shows his XP so far until the date is settled; locked only without a row", () => {
  const pending = [receipt("2026-11-19", "pending", [{ id: "a", xp: { climbing: 10 } }, { id: "b", xp: { sprint: 7 }, race: true }]), RUNS[1]];
  const rows = buildDevelopmentRows({ runs: pending, riders: [rider("a"), rider("b", { racingToday: true }), rider("c", { racingToday: true })], todayKey: "2026-11-19", seasonGains: {} });
  assert.deepEqual(rows[1].today, { state: "xp", xp: 7, point: null, soFar: true });
  assert.deepEqual(rows[2].today, { state: "locked" }, "no row yet = nothing known, never a measured zero");
  assert.deepEqual(rows[0].today, { state: "xp", xp: 10, point: null });
  assert.equal(devSummary(rows).unsettled, 2);
  const settled = buildDevelopmentRows({ runs: RUNS, riders: [rider("b", { racingToday: true })], todayKey: "2026-11-19", seasonGains: {} });
  assert.equal(settled[0].today.state, "xp");
  assert.equal(settled[0].today.state === "xp" && settled[0].today.soFar, undefined, "settled = the day's final XP");
  const preview = buildDevelopmentRows({ runs: RUNS, riders: [rider("b", { racingToday: true })], todayKey: "2026-11-19", seasonGains: {}, forceUnsettled: true });
  assert.equal(preview[0].today.state === "xp" && preview[0].today.soFar, true);
});

test("Train now before the evening settlement: the point that already landed shows, a payout does not", () => {
  const pendingRun = (trainedNow: Record<string, number>, barPaid: Record<string, number> | null = null) => {
    const run = receipt("2026-11-19", "pending", [{ id: "a", xp: { climbing: 20 } }]);
    const row = run.report.riders[0] as unknown as Record<string, unknown>;
    row.trained_now = { gains: trainedNow, gains_detail: {}, gain_percent: {} };
    row.bar_paid = barPaid;
    return [run, RUNS[1]];
  };
  const point = (runs: XpReceipt[]) => buildDevelopmentRows({ runs, riders: [rider("a")], todayKey: "2026-11-19", seasonGains: {} })[0].today;
  assert.deepEqual(point(pendingRun({ climbing: 1 })), { state: "xp", xp: 20, point: "climbing" });
  assert.deepEqual(point(pendingRun({ climbing: 1 }, { climbing: 1 })), { state: "xp", xp: 20, point: null }, "a payout from saved XP is not a new point");
  assert.deepEqual(point(pendingRun({ climbing: 1, flat: 1 })), { state: "xp", xp: 20, point: null }, "two points: no single ability to name");
  assert.deepEqual(point(pendingRun({})), { state: "xp", xp: 20, point: null });
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
  // ejer 20/11: the racing rider's XP so far counts in the summary, and he still counts as unsettled.
  const rows = buildDevelopmentRows({ runs: RUNS, riders: [rider("a"), rider("b", { racingToday: true })], todayKey: "2026-11-19", seasonGains: { a: { climbing: 3 } }, forceUnsettled: true });
  assert.deepEqual(devSummary(rows), { riders: 2, days: 2, riderDays: 4, xpToday: 50, unsettled: 1, xp30: 115, seasonPoints: 3, close: 1 });
  assert.equal(rows.reduce((a, r) => a + r.xpDays, 0), devSummary(rows).riderDays, "the summary divides by the same dates as the rows");
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
  assert.ok(rows.some(r => r.today.state === "locked" || (r.today.state === "xp" && r.today.soFar)), "ejer 20/11: racing riders show XP so far");
  assert.ok(rows.some(r => r.today.state === "xp"));
  assert.ok(rows.every(r => r.next && r.abilities.length > 0 && r.abilities.length <= MAX_ABILITIES));
  assert.ok(rows.some(r => r.top.kind === "view"));
  assert.ok(rows.every(r => r.xp30 > 0 && r.spark.length === 30));
});

test("expected top: an academy intake rider keeps his academy prognosis (estimates send only academyPrognosis)", () => {
  const prognosis = { band: { lo: 50, hi: 60 }, learning: false };
  const top = topOf({ academyPrognosis: prognosis });
  assert.equal(top.kind, "academy");
  assert.equal(top.kind === "academy" ? top.prognosis : null, prognosis);
  assert.equal(topSortValue(top), null);
});

test("rating this season: the rating now minus the rating with this season's points taken off (ejer 19/11)", () => {
  const rows = buildDevelopmentRows({ runs: RUNS, riders: [rider("a"), rider("b")], todayKey: "2026-11-19", seasonGains: { a: { climbing: 3, flat: 0 }, b: null } });
  const expected = riderOverallRating({ climbing: 72, flat: 60 })! - riderOverallRating({ climbing: 69, flat: 60 })!;
  assert.ok(expected > 0, "the test values must move the rating");
  assert.equal(rows.find(r => r.id === "a")!.ratingSeason, expected);
  assert.equal(rows.find(r => r.id === "a")!.season, 3, "the ability points stay for the summary line and the opened row");
  assert.equal(rows.find(r => r.id === "b")!.ratingSeason, null, "no season data shows a dash");
  assert.equal(signedText(rows.find(r => r.id === "b")!.ratingSeason), "—");
});

test("rating this season: unknown stays unknown, no gains is a measured zero, losses are not points", () => {
  assert.equal(seasonRatingChange({ climbing: 72 }, null), null);
  assert.equal(seasonRatingChange({ climbing: 72 }, undefined), null);
  assert.equal(seasonRatingChange({ climbing: 72, flat: 60 }, {}), 0);
  assert.equal(seasonRatingChange({ climbing: 72, flat: 60 }, { climbing: -2 }), 0);
  assert.equal(seasonRatingChange({}, { climbing: 3 }), null, "no abilities, no rating");
  // A cached rating on the row is never read as the rating at season start.
  assert.equal(seasonRatingChange({ best_role: "climber", best_role_rating: 70 }, { climbing: 3 }), null);
  // A point on an ability the rider has no value for is skipped, not subtracted from nothing.
  assert.equal(seasonRatingChange({ climbing: 72 }, { flat: 3 }), 0);
});

test("signedText: '+3', '0', '-1' and a dash", () => {
  assert.equal(signedText(3), "+3");
  assert.equal(signedText(0), "0");
  assert.equal(signedText(-1), "-1");
  assert.equal(signedText(null), "—");
});

test("sorting the season column sorts on the rating change; unknown last", () => {
  const rows = buildDevelopmentRows({
    runs: RUNS, riders: [rider("a"), rider("b"), rider("c")], todayKey: "2026-11-19",
    seasonGains: { a: { climbing: 1 }, b: null, c: { climbing: 5 } },
  });
  assert.deepEqual(sortDevRows(rows, { key: "season", dir: -1 }).map(r => r.id), ["c", "a", "b"]);
  assert.deepEqual(sortDevRows(rows, { key: "season", dir: 1 }).map(r => r.id), ["a", "c", "b"]);
});

test("the preview fixture shows the rating change and the role he is best in now", () => {
  const fx = buildDevelopmentFixture();
  const rows = buildDevelopmentRows({ runs: fx.runs, riders: fx.riders, todayKey: DEV_FIXTURE_TODAY, seasonGains: fx.seasonGains, forceUnsettled: true });
  assert.ok(rows.every(r => typeof r.ratingSeason === "number"));
  assert.ok(rows.some(r => (r.ratingSeason ?? 0) > 0));
  for (const r of fx.riders) {
    assert.equal(r.rating, riderOverallRating(r.abilities as Record<string, unknown>), "the rating is read from the same abilities");
    assert.equal(typeof r.bestRole, "string", "the role he is best in now");
    assert.ok(r.natural?.primary, "the natural role, as in the other tables");
  }
  assert.ok(fx.riders.some(r => r.natural?.primary !== r.bestRole), "the two forms can differ, which is why both exist");
});

test("type columns (ejer 20/11): Natural type shown and Role now hidden by default", () => {
  assert.deepEqual([...defaultDevColumns()], ["natural"]);
  assert.deepEqual(DEV_COLUMNS.map(c => c.key), ["natural", "role", "rating30"]);
});

test("type columns: the stored choice is read back, and anything unreadable falls back to the default", () => {
  assert.deepEqual([...parseDevColumns(null)], ["natural"]);
  assert.deepEqual([...parseDevColumns("not json")], ["natural"]);
  assert.deepEqual([...parseDevColumns("{\"natural\":true}")], ["natural"]);
  assert.deepEqual([...parseDevColumns("[]")], [], "both hidden is a real choice");
  assert.deepEqual([...parseDevColumns("[\"role\",\"bogus\",3]")], ["role"]);
  const both = toggleDevColumn(defaultDevColumns(), "role");
  assert.equal(serializeDevColumns(both), "[\"natural\",\"role\"]");
  assert.deepEqual([...parseDevColumns(serializeDevColumns(both))].sort(), ["natural", "role"]);
  assert.deepEqual([...toggleDevColumn(both, "natural")], ["role"]);
});

test("type columns: sorting reads each form, and hiding the sorted column falls back to the default sort", () => {
  const rows = buildDevelopmentRows({
    runs: RUNS, todayKey: "2026-11-19", seasonGains: {},
    riders: [
      rider("a", { natural: { primary: "sprinter", secondary: null }, bestRole: "climber" }),
      rider("b", { natural: { primary: "climber", secondary: null }, bestRole: null }),
      rider("c", { natural: null, bestRole: "baroudeur" }),
    ],
  });
  assert.deepEqual(rows.map(r => [r.natural?.primary ?? null, r.bestRole]), [["sprinter", "climber"], ["climber", null], [null, "baroudeur"]]);
  assert.deepEqual(sortDevRows(rows, nextSort(DEFAULT_SORT, "natural")).map(r => r.id), ["b", "a", "c"]);
  assert.deepEqual(sortDevRows(rows, nextSort(DEFAULT_SORT, "role")).map(r => r.id), ["c", "a", "b"]);
  assert.deepEqual(sortAfterColumns({ key: "role", dir: 1 }, defaultDevColumns()), DEFAULT_SORT);
  assert.deepEqual(sortAfterColumns({ key: "natural", dir: 1 }, defaultDevColumns()), { key: "natural", dir: 1 });
  assert.deepEqual(sortAfterColumns({ key: "rating", dir: 1 }, new Set()), { key: "rating", dir: 1 });
});

// --- Ejer 20/11: Rating, 30 d -------------------------------------------------------

test("rating 30 d: the rating now minus the rating with the last 30 days' points taken off", () => {
  const runs = [
    receipt("2026-11-19", "complete", [{ id: "a", xp: { climbing: 10 }, gains: { climbing: 2 } }, { id: "b", xp: {} }]),
    receipt("2026-10-25", "complete", [{ id: "a", xp: { climbing: 10 }, gains: { climbing: 1 } }, { id: "b", xp: {} }]),
    // Outside the window (more than 30 days back): not counted.
    receipt("2026-10-10", "complete", [{ id: "a", xp: { climbing: 10 }, gains: { climbing: 5 } }, { id: "b", xp: {} }]),
  ];
  const rows = buildDevelopmentRows({ runs, riders: [rider("a"), rider("b")], todayKey: "2026-11-19", seasonGains: { a: { climbing: 8 }, b: {} } });
  const a = rows.find(r => r.id === "a")!;
  assert.deepEqual(gainsLast30(runs, "a", "2026-11-19"), { climbing: 3 });
  assert.equal(a.rating30, riderOverallRating({ climbing: 72, flat: 60 })! - riderOverallRating({ climbing: 69, flat: 60 })!);
  assert.notEqual(a.rating30, a.ratingSeason, "30 days and the season are two different windows");
  assert.equal(rows.find(r => r.id === "b")!.rating30, 0, "receipts without points are a measured zero");
});

test("rating 30 d: unknown is a dash, never a false zero", () => {
  // No receipt in the window at all.
  assert.equal(gainsLast30([receipt("2026-09-01", "complete", [{ id: "a", xp: {} }])], "a", "2026-11-19"), null);
  assert.equal(gainsLast30([], "a", "2026-11-19"), null);
  // Joined inside the window: missing on the window's first receipt, so his earlier points are not in these receipts.
  const runs = [
    receipt("2026-11-19", "complete", [{ id: "a", xp: {}, gains: { climbing: 1 } }, { id: "new", xp: {}, gains: { climbing: 1 } }]),
    receipt("2026-11-01", "complete", [{ id: "a", xp: {} }]),
  ];
  const rows = buildDevelopmentRows({ runs, riders: [rider("a"), rider("new")], todayKey: "2026-11-19", seasonGains: {} });
  assert.equal(rows.find(r => r.id === "new")!.rating30, null);
  assert.equal(signedText(rows.find(r => r.id === "new")!.rating30), "—");
  assert.equal(typeof rows.find(r => r.id === "a")!.rating30, "number");
});

test("rating 30 d: the window is today and the 29 days before", () => {
  assert.equal(dayKeyMinus("2026-11-19", 29), "2026-10-21");
  assert.equal(dayKeyMinus("2026-03-01", 1), "2026-02-28");
  const edge = [
    receipt("2026-10-21", "complete", [{ id: "a", xp: {}, gains: { climbing: 1 } }]),
    receipt("2026-10-20", "complete", [{ id: "a", xp: {}, gains: { climbing: 4 } }]),
  ];
  assert.deepEqual(gainsLast30(edge, "a", "2026-11-19"), { climbing: 1 });
});

test("rating 30 d: hidden by default, remembered, sortable, and hiding it resets the sort", () => {
  assert.equal(defaultDevColumns().has("rating30"), false);
  assert.equal(parseDevColumns("[\"natural\"]").has("rating30"), false, "an older stored choice keeps it hidden");
  const shown = toggleDevColumn(defaultDevColumns(), "rating30");
  assert.deepEqual([...parseDevColumns(serializeDevColumns(shown))].sort(), ["natural", "rating30"]);
  assert.deepEqual(sortAfterColumns({ key: "rating30", dir: -1 }, defaultDevColumns()), DEFAULT_SORT);
  assert.deepEqual(sortAfterColumns({ key: "rating30", dir: -1 }, shown), { key: "rating30", dir: -1 });
  const runs = [receipt("2026-11-19", "complete", [
    { id: "a", xp: {}, gains: { climbing: 1 } }, { id: "c", xp: {}, gains: { climbing: 6 } },
  ])];
  const rows = buildDevelopmentRows({ runs, riders: [rider("a"), rider("b"), rider("c")], todayKey: "2026-11-19", seasonGains: {} });
  assert.deepEqual(sortDevRows(rows, nextSort(DEFAULT_SORT, "rating30")).map(r => r.id), ["c", "a", "b"], "highest first, unknown last");
});

// --- Ejer 20/11: XP lines as on the Training tab (#8488) -----------------------------

test("xpLineOf: whole numbers, the fill stops at full, unusable bars give nothing", () => {
  assert.deepEqual(xpLineOf({ xp: 312.4, price: 540 }), { xp: 312, price: 540, pct: 57 });
  assert.deepEqual(xpLineOf({ xp: 600, price: 540 }), { xp: 600, price: 540, pct: 100 }, "leftover XP is told honestly");
  assert.equal(xpLineOf({ xp: 5, price: 0 }), null);
  assert.equal(xpLineOf({ xp: -1, price: 40 }), null);
  assert.equal(xpLineOf(null), null);
});

test("dayXpByAbility: training and races added per ability", () => {
  assert.deepEqual(dayXpByAbility([{ xp: { climbing: 10, flat: 0 } }, { xp: { climbing: 5, sprint: 3 } }, { xp: null }]), { climbing: 15, sprint: 3 });
  assert.equal(dayXpByAbility(null), null);
});

test("the opened row: x / y XP per ability and the day's +N XP from the newest receipt", () => {
  const rows = buildDevelopmentRows({ runs: RUNS, riders: [rider("a"), rider("b")], todayKey: "2026-11-19", seasonGains: { a: { climbing: 3 } } });
  const a = rows.find(r => r.id === "a")!;
  assert.deepEqual(a.dayXpWhen, { kind: "today" });
  assert.deepEqual(a.abilities.map(x => [x.key, x.line, x.dayXp]), [
    ["climbing", { xp: 10, price: 40, pct: 25 }, 30],
    ["flat", { xp: 35, price: 40, pct: 87 }, null],
  ]);
  // The day after, before its receipt: the same numbers labelled as yesterday.
  const next = buildDevelopmentRows({ runs: RUNS, riders: [rider("a")], todayKey: "2026-11-20", seasonGains: {} })[0];
  assert.deepEqual(next.dayXpWhen, { kind: "yesterday" });
  const later = buildDevelopmentRows({ runs: RUNS, riders: [rider("a")], todayKey: "2026-11-23", seasonGains: {} })[0];
  assert.deepEqual(later.dayXpWhen, { kind: "dated", date: "2026-11-19" });
  // Not in the newest receipt: no day XP and no label.
  const outsider = buildDevelopmentRows({ runs: RUNS, riders: [rider("new")], todayKey: "2026-11-19", seasonGains: {} })[0];
  assert.equal(outsider.dayXpWhen, null);
});

test("the preview fixture fills the XP lines", () => {
  const fx = buildDevelopmentFixture();
  const rows = buildDevelopmentRows({ runs: fx.runs, riders: fx.riders, todayKey: DEV_FIXTURE_TODAY, seasonGains: fx.seasonGains, forceUnsettled: true });
  assert.ok(rows.every(r => r.next && r.next.price > 0));
  assert.ok(rows.some(r => r.abilities.some(x => x.line && x.dayXp)));
  assert.ok(rows.some(r => typeof r.rating30 === "number"));
});

test("rating 30 d: Train now's confirmed points count before the settlement; an unsettled date without them is unknown", () => {
  const withTrainedNow = (status: XpReceipt["receipt_status"], trainedNow: Record<string, number> | null) => {
    const run = receipt("2026-11-20", status, [{ id: "a", xp: { climbing: 5 } }]);
    (run.report.riders[0] as unknown as Record<string, unknown>).trained_now = trainedNow ? { gains: trainedNow, gains_detail: {}, gain_percent: {} } : null;
    return [run, receipt("2026-11-19", "complete", [{ id: "a", xp: {}, gains: { flat: 1 } }])];
  };
  assert.deepEqual(gainsLast30(withTrainedNow("pending", { climbing: 1 }), "a", "2026-11-20"), { climbing: 1, flat: 1 });
  assert.equal(gainsLast30(withTrainedNow("pending", null), "a", "2026-11-20"), null, "pending without confirmed points is not a measured zero");
  assert.equal(gainsLast30(withTrainedNow("reconciliation", null), "a", "2026-11-20"), null, "a date still being reconciled is unknown");
});

// Fable 20/11: the first XP evening. The older receipts carry no XP fields, so dividing by
// every receipt date showed ~1/30 of the real XP per day and climbed for a month.
test("XP per day divides by the dates with XP, not by every receipt in the window", () => {
  const withoutXp = (date: string) => {
    const run = receipt(date, "complete", [{ id: "a", xp: {} }]);
    for (const row of (run.report as unknown as { riders: Array<{ activities: Array<{ xp?: unknown }> }> }).riders) for (const a of row.activities) delete a.xp;
    return run;
  };
  const old = Array.from({ length: 29 }, (_, i) => withoutXp(dayKeyMinus("2026-11-20", i + 1)));
  const runs = [receipt("2026-11-20", "complete", [{ id: "a", xp: { climbing: 300 } }]), ...old];
  const [row] = buildDevelopmentRows({ runs, riders: [rider("a")], todayKey: "2026-11-20", seasonGains: {} });
  assert.equal(row.xpDays, 1);
  assert.equal(row.xpPerDay, 300);
  assert.equal(devSummary([row]).riderDays, 1);
});

test("no date with XP gives a dash, and no row for today gives no XP today", () => {
  const rows = buildDevelopmentRows({ runs: RUNS, riders: [rider("new")], todayKey: "2026-11-20", seasonGains: {} });
  assert.equal(rows[0].xpPerDay, null);
  assert.equal(devSummary(rows).xpToday, null);
  assert.equal(devSummary(rows).riderDays, 0);
});
