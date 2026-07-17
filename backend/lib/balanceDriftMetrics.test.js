import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BALANCE_DRIFT_BANDS,
  ALARM_ELIGIBLE_METRICS,
  computeDayMetrics,
  classifyMetric,
  classifyDay,
  findConsecutiveBreaches,
} from "./balanceDriftMetrics.js";

// ── classifyMetric ───────────────────────────────────────────────────────────

test("classifyMetric: n/a for null/undefined/NaN", () => {
  assert.equal(classifyMetric(null, { min: 0.25, max: 0.40 }), "n/a");
  assert.equal(classifyMetric(undefined, { min: 0.25, max: 0.40 }), "n/a");
  assert.equal(classifyMetric(NaN, { min: 0.25, max: 0.40 }), "n/a");
});

test("classifyMetric: report-only bånd er altid 'info', uanset værdi", () => {
  assert.equal(classifyMetric(0.42, { min: 0.01, max: 0.07, reportOnly: true }), "info");
  assert.equal(classifyMetric(0.03, { min: 0.01, max: 0.07, reportOnly: true }), "info");
});

test("classifyMetric: grøn inden for bånd, rød godt uden for, gul lige uden for margin", () => {
  const band = { min: 0.25, max: 0.40 }; // bredde 0.15, margin 0.0225
  assert.equal(classifyMetric(0.30, band), "green");
  assert.equal(classifyMetric(0.25, band), "green");
  assert.equal(classifyMetric(0.40, band), "green");
  assert.equal(classifyMetric(0.41, band), "yellow"); // 0.01 over, margin 0.0225
  assert.equal(classifyMetric(0.24, band), "yellow");
  assert.equal(classifyMetric(0.53, band), "red"); // #2224-baseline-niveau (53%) — klart rødt
  assert.equal(classifyMetric(0.10, band), "red");
});

test("classifyMetric: ensidet bånd (kun max) — share4PlusSameTeamTop10-stil", () => {
  const band = BALANCE_DRIFT_BANDS.share4PlusSameTeamTop10; // { max: 0.05 }
  assert.equal(classifyMetric(0.03, band), "green");
  assert.equal(classifyMetric(0.05, band), "green");
  assert.equal(classifyMetric(0.052, band), "yellow"); // margin = 0.05*0.15 = 0.0075
  assert.equal(classifyMetric(0.20, band), "red");
});

test("classifyMetric: ensidet bånd (kun min) — avgDistinctTeamsTop10-stil", () => {
  const band = BALANCE_DRIFT_BANDS.avgDistinctTeamsTop10; // { min: 7.5 }
  assert.equal(classifyMetric(8, band), "green");
  assert.equal(classifyMetric(7.0, band), "yellow");
  assert.equal(classifyMetric(3, band), "red");
});

// ── computeDayMetrics ─────────────────────────────────────────────────────────

test("computeDayMetrics: aggregerer observations/incidents/win-rates korrekt", () => {
  const observations = [
    { terrain: "flat", favoriteWon: true, favoritePodium: true, maxSameTeamTop10: 2, distinctTeamsTop10: 8 },
    { terrain: "flat", favoriteWon: false, favoritePodium: true, maxSameTeamTop10: 3, distinctTeamsTop10: 7 },
  ];
  const incidentObservations = [
    { profileType: "flat", fieldSize: 100, hitCount: 2, hitSharePct: 2, dnfCount: 1, dnfSharePct: 1, timeLossCount: 1, timeLossSharePct: 1 },
  ];
  const winsByRider = new Map([["r1", 3]]);
  const startsByRider = new Map([["r1", 6]]);

  const metrics = computeDayMetrics({
    observations,
    incidentObservations,
    winsByRider,
    startsByRider,
    jourSansHits: 5,
    riderStageCount: 200,
    breakawayWins: 1,
    breakawayEligibleStages: 20,
  });

  assert.equal(metrics.favoriteWinRate, 0.5);
  assert.equal(metrics.favoritePodiumRate, 1);
  assert.equal(metrics.stageInstances, 2);
  assert.equal(metrics.dnfRatePct, 1);
  assert.equal(metrics.maxRiderWinRate, 0.5);
  assert.equal(metrics.jourSansSharePct, 2.5);
  assert.equal(metrics.breakawayWinSharePct, 5);
});

test("computeDayMetrics: tom dag (ingen løb) giver n/a-værdier, ikke crash", () => {
  const metrics = computeDayMetrics({});
  assert.equal(metrics.favoriteWinRate, null);
  assert.equal(metrics.dnfRatePct, null);
  assert.equal(metrics.jourSansSharePct, null);
  assert.equal(metrics.breakawayWinSharePct, null);
  assert.equal(metrics.stageInstances, 0);
});

// ── classifyDay ────────────────────────────────────────────────────────────

test("classifyDay: dækker alle kanoniske bånd-nøgler", () => {
  const day = classifyDay({ favoriteWinRate: 0.32 });
  assert.deepEqual(Object.keys(day).sort(), Object.keys(BALANCE_DRIFT_BANDS).sort());
  assert.equal(day.favoriteWinRate.status, "green");
  assert.equal(day.dnfRatePct.status, "n/a"); // ikke i input
});

// ── findConsecutiveBreaches (#2397: ingen falske positiver på enkeltdage) ────

function dayRow(date, statusesByMetric) {
  const statuses = {};
  for (const key of Object.keys(BALANCE_DRIFT_BANDS)) {
    statuses[key] = { status: statusesByMetric[key] || "green" };
  }
  return { date, statuses };
}

test("findConsecutiveBreaches: ÉN rød dag alarmerer ALDRIG (deploy-støj-lærdom #2397)", () => {
  const rows = [
    dayRow("2026-07-14", { favoriteWinRate: "green" }),
    dayRow("2026-07-15", { favoriteWinRate: "red" }),
    dayRow("2026-07-16", { favoriteWinRate: "green" }),
  ];
  assert.deepEqual(findConsecutiveBreaches(rows), []);
});

test("findConsecutiveBreaches: 2 på hinanden følgende røde dage alarmerer ENDNU IKKE", () => {
  const rows = [
    dayRow("2026-07-14", { favoriteWinRate: "green" }),
    dayRow("2026-07-15", { favoriteWinRate: "red" }),
    dayRow("2026-07-16", { favoriteWinRate: "red" }),
  ];
  assert.deepEqual(findConsecutiveBreaches(rows), []);
});

test("findConsecutiveBreaches: 3 på hinanden følgende røde dage ALARMERER", () => {
  const rows = [
    dayRow("2026-07-14", { favoriteWinRate: "red" }),
    dayRow("2026-07-15", { favoriteWinRate: "red" }),
    dayRow("2026-07-16", { favoriteWinRate: "red" }),
  ];
  const breaches = findConsecutiveBreaches(rows);
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].metric, "favoriteWinRate");
  assert.equal(breaches[0].days, 3);
  assert.equal(breaches[0].since, "2026-07-14");
});

test("findConsecutiveBreaches: hul i datoerne (missed cron-tick) nulstiller streaken", () => {
  const rows = [
    dayRow("2026-07-13", { favoriteWinRate: "red" }),
    dayRow("2026-07-14", { favoriteWinRate: "red" }),
    // 2026-07-15 mangler (missed cron-tick)
    dayRow("2026-07-16", { favoriteWinRate: "red" }),
  ];
  assert.deepEqual(findConsecutiveBreaches(rows), []);
});

test("findConsecutiveBreaches: en enkelt grøn dag midt i en rød-stribe nulstiller streaken", () => {
  const rows = [
    dayRow("2026-07-13", { favoriteWinRate: "red" }),
    dayRow("2026-07-14", { favoriteWinRate: "red" }),
    dayRow("2026-07-15", { favoriteWinRate: "green" }),
    dayRow("2026-07-16", { favoriteWinRate: "red" }),
  ];
  assert.deepEqual(findConsecutiveBreaches(rows), []);
});

test("findConsecutiveBreaches: report-only-metrikker (jourSans/breakaway) alarmerer ALDRIG selv ved 3+ røde dage", () => {
  assert.ok(!ALARM_ELIGIBLE_METRICS.includes("jourSansSharePct"));
  assert.ok(!ALARM_ELIGIBLE_METRICS.includes("breakawayWinSharePct"));

  const rows = [
    dayRow("2026-07-14", { jourSansSharePct: "red", breakawayWinSharePct: "red" }),
    dayRow("2026-07-15", { jourSansSharePct: "red", breakawayWinSharePct: "red" }),
    dayRow("2026-07-16", { jourSansSharePct: "red", breakawayWinSharePct: "red" }),
  ];
  assert.deepEqual(findConsecutiveBreaches(rows), []);
});

test("findConsecutiveBreaches: flere metrikker kan alarmere samtidig, uafhængigt", () => {
  const rows = [
    dayRow("2026-07-14", { favoriteWinRate: "red", dnfRatePct: "red" }),
    dayRow("2026-07-15", { favoriteWinRate: "red", dnfRatePct: "green" }),
    dayRow("2026-07-16", { favoriteWinRate: "red", dnfRatePct: "red" }),
  ];
  const breaches = findConsecutiveBreaches(rows);
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].metric, "favoriteWinRate");
});

test("findConsecutiveBreaches: tom rows-liste giver tom liste, ikke crash", () => {
  assert.deepEqual(findConsecutiveBreaches([]), []);
});
