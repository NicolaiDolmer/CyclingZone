import test from "node:test";
import assert from "node:assert/strict";

import {
  BALANCE_DRIFT_BANDS,
  V4_SERIES_METRICS,
  ENGINE_SERIES_V4,
  computeV4DayMetrics,
  classifyV4Day,
  classifyDay,
  findConsecutiveV4Breaches,
  evaluateBreachAlert,
  formatBreachAlert,
} from "./balanceDriftMetrics.js";
import { observeIncidents } from "./raceDominanceMetrics.js";

// #5516 — ren-lib-delen af balance-drift-vagtens v4-serie. I/O-adapteren og
// ende-til-ende-forløbet (tom/blandet/ren v4-dag, bit-identitet) ligger i
// balanceDriftWatch.v4.test.js. Alle tal er syntetiske.

const obs = (over = {}) => ({
  terrain: "flat",
  raceId: "r",
  fieldSize: 12,
  winnerId: "w",
  favoriteId: "f",
  favoriteRank: 2,
  favoriteWon: false,
  favoritePodium: true,
  maxSameTeamTop10: 1,
  distinctTeamsTop10: 10,
  ...over,
});

test("computeV4DayMetrics: tom dag giver null-rater og nul etaper, aldrig NaN", () => {
  const m = computeV4DayMetrics();
  for (const key of V4_SERIES_METRICS) assert.equal(m[key], null, key);
  assert.equal(m.timeLimitRatePct, null);
  assert.equal(m.stageInstances, 0);
  assert.equal(m.incidentStages, 0);
  assert.equal(m.favoriteUnknownStages, 0);
});

test("computeV4DayMetrics: aggregerer som v3 (uvægtet pr. etape) og tæller ukendte favoritter", () => {
  const m = computeV4DayMetrics({
    observations: [
      obs({ favoriteWon: true, favoritePodium: true, maxSameTeamTop10: 4, distinctTeamsTop10: 7 }),
      obs({ favoriteWon: false, favoritePodium: false, distinctTeamsTop10: 10 }),
      obs({ favoriteId: null, favoriteWon: false, favoritePodium: false, distinctTeamsTop10: 10 }),
      obs({ favoriteWon: false, favoritePodium: true, distinctTeamsTop10: 9 }),
    ],
  });
  assert.equal(m.favoriteWinRate, 1 / 4);
  assert.equal(m.favoritePodiumRate, 2 / 4);
  assert.equal(m.share4PlusSameTeamTop10, 1 / 4);
  assert.equal(m.avgDistinctTeamsTop10, 36 / 4);
  assert.equal(m.stageInstances, 4);
  assert.equal(m.favoriteUnknownStages, 1);
});

test("computeV4DayMetrics: tidsgrænsen holdes ude af dnfRatePct og rapporteres separat", () => {
  const stageIncidents = [
    { kind: "crash", outcome: "abandon" },
    { kind: "crash", outcome: "time_loss" },
    { kind: "time_limit", outcome: "abandon" },
    { kind: "time_limit", outcome: "abandon" },
  ];
  const fieldSize = 20;
  const m = computeV4DayMetrics({
    incidentObservations: [
      observeIncidents({ incidents: stageIncidents.filter((i) => i.kind !== "time_limit"), fieldSize }),
    ],
    timeLimitObservations: [
      observeIncidents({ incidents: stageIncidents.filter((i) => i.kind === "time_limit"), fieldSize }),
    ],
  });
  assert.equal(m.dnfRatePct, 100 / 20, "kun styrt-udgåelsen tæller som DNF");
  assert.equal(m.timeLimitRatePct, 200 / 20);
  assert.equal(m.incidentStages, 1);
});

test("classifyV4Day: samme kanoniske bånd som v3, kun v4-seriens metrikker", () => {
  const metricsV4 = {
    favoriteWinRate: 0.3,
    favoritePodiumRate: 0.9,
    share4PlusSameTeamTop10: 0,
    avgDistinctTeamsTop10: 9,
    dnfRatePct: null,
    stageInstances: 10,
  };
  const out = classifyV4Day(metricsV4, { robust: false });
  assert.deepEqual(Object.keys(out), [...V4_SERIES_METRICS]);
  const reference = classifyDay(metricsV4, { robust: false });
  for (const key of V4_SERIES_METRICS) {
    assert.equal(out[key].band, BALANCE_DRIFT_BANDS[key]);
    assert.deepEqual(out[key], reference[key], `${key} klassificeres præcis som classifyDay`);
  }
  assert.equal(out.favoriteWinRate.status, "green");
  assert.equal(out.favoritePodiumRate.status, "red");
  assert.equal(out.dnfRatePct.status, "n/a");
});

test("classifyV4Day robust-mode: pooler KUN metrics.v4, aldrig v3-værdierne på rod-niveau", () => {
  const recentRows = [
    // I dag: v4-rate 0.3 over 10 etaper. v3-raten på rod-niveau er vildt anderledes.
    { date: "2026-09-10", metrics: { favoriteWinRate: 0.9, stageInstances: 1000, v4: { favoriteWinRate: 0.3, stageInstances: 10 } } },
    { date: "2026-09-09", metrics: { favoriteWinRate: 0.9, stageInstances: 1000, v4: { favoriteWinRate: 0.5, stageInstances: 30 } } },
    // En dag uden v4-serie: springes over i puljen (ikke poolet som 0).
    { date: "2026-09-08", metrics: { favoriteWinRate: 0.9, stageInstances: 1000 } },
  ];
  const out = classifyV4Day(recentRows[0].metrics.v4, { recentRows, robust: true, poolWindowDays: 7 });
  const expected = (0.3 * 10 + 0.5 * 30) / 40;
  assert.equal(out.favoriteWinRate.value, expected);
  assert.equal(out.favoriteWinRate.basis, "pooled-2d");
  assert.equal(out.favoriteWinRate.dayValue, 0.3);
});

test("findConsecutiveV4Breaches: læser statuses.v4, ignorerer v3-brud og mærker engine=v4", () => {
  const red = { status: "red" };
  const rows = [
    { date: "2026-09-08", statuses: { favoriteWinRate: red, [ENGINE_SERIES_V4]: { favoriteWinRate: red } } },
    { date: "2026-09-09", statuses: { favoriteWinRate: red, [ENGINE_SERIES_V4]: { favoriteWinRate: red, dnfRatePct: red } } },
    { date: "2026-09-10", statuses: { favoriteWinRate: red, dnfRatePct: red, [ENGINE_SERIES_V4]: { favoriteWinRate: red, dnfRatePct: red } } },
  ];
  assert.deepEqual(findConsecutiveV4Breaches(rows), [
    { metric: "favoriteWinRate", days: 3, since: "2026-09-08", engine: "v4" },
  ]);
});

test("findConsecutiveV4Breaches: en dag uden v4-serie bryder streaken", () => {
  const red = { status: "red" };
  const rows = [
    { date: "2026-09-08", statuses: { v4: { favoriteWinRate: red } } },
    { date: "2026-09-09", statuses: {} },
    { date: "2026-09-10", statuses: { v4: { favoriteWinRate: red } } },
  ];
  assert.deepEqual(findConsecutiveV4Breaches(rows), []);
});

test("evaluateBreachAlert: v3-signaturen er uændret, v4 får motor-præfiks", () => {
  const v3 = { metric: "favoriteWinRate", days: 3, since: "2026-09-08" };
  const v4 = { ...v3, engine: "v4" };
  assert.equal(evaluateBreachAlert([v3]).signature, "favoriteWinRate@2026-09-08");
  assert.equal(evaluateBreachAlert([v4]).signature, "v4:favoriteWinRate@2026-09-08");
  assert.equal(evaluateBreachAlert([v4, v3]).signature, "favoriteWinRate@2026-09-08|v4:favoriteWinRate@2026-09-08");
  // Samme metrik i to motorer er to forskellige brud — et nyt v4-brud oven på
  // et kendt v3-brud SKAL ændre signaturen (og dermed alarmere).
  assert.equal(evaluateBreachAlert([v3, v4], "favoriteWinRate@2026-09-08").changed, true);
});

test("formatBreachAlert: kun v3-brud giver præcis den gamle tekst", () => {
  const text = formatBreachAlert({
    breaches: [{ metric: "dnfRatePct", days: 4, since: "2026-09-07" }],
    metrics: { dnfRatePct: 2.5, v4: { dnfRatePct: 9 } },
    targetDate: "2026-09-10",
  });
  assert.deepEqual(text, {
    title: "⚠️ Balance-drift-vagt: 1 bånd-brud i 3+ dage",
    description: "Race v3-kalibreringen har drevet uden for kanoniske bånd i mindst 3 på hinanden følgende dage (seneste målt: 2026-09-10). Read-only vagt — ingen automatisk handling.",
    fields: [{ name: "dnfRatePct", value: "4 dage i træk (siden 2026-09-07) · seneste værdi 2.5" }],
  });
});

test("formatBreachAlert: v4-brud nævner v4 og viser v4-seriens seneste værdi", () => {
  const only = formatBreachAlert({
    breaches: [{ metric: "dnfRatePct", days: 3, since: "2026-09-08", engine: "v4" }],
    metrics: { dnfRatePct: 2.5, v4: { dnfRatePct: 9 } },
    targetDate: "2026-09-10",
  });
  assert.match(only.description, /^Race v4-kalibreringen har drevet/);
  assert.deepEqual(only.fields, [{ name: "v4 · dnfRatePct", value: "3 dage i træk (siden 2026-09-08) · seneste værdi 9" }]);

  const both = formatBreachAlert({
    breaches: [
      { metric: "dnfRatePct", days: 4, since: "2026-09-07" },
      { metric: "dnfRatePct", days: 3, since: "2026-09-08", engine: "v4" },
    ],
    metrics: { dnfRatePct: 2.5, v4: { dnfRatePct: 9 } },
    targetDate: "2026-09-10",
  });
  assert.equal(both.title, "⚠️ Balance-drift-vagt: 2 bånd-brud i 3+ dage");
  assert.match(both.description, /^Race v3- og v4-kalibreringen har drevet/);
  assert.deepEqual(both.fields.map((f) => f.name), ["v3 · dnfRatePct", "v4 · dnfRatePct"]);
  assert.match(both.fields[0].value, /seneste værdi 2\.5$/);
  assert.match(both.fields[1].value, /seneste værdi 9$/);
});
