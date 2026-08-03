import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BALANCE_DRIFT_BANDS,
  ALARM_ELIGIBLE_METRICS,
  computeDayMetrics,
  classifyMetric,
  classifyDay,
  findConsecutiveBreaches,
  evaluateBreachAlert,
  wilsonLowerBound,
  maxRiderWinRateLowerBound,
  poolDailyRate,
  foldRiderWindowRows,
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

// ── evaluateBreachAlert (#2730 — edge-triggered dedup) ────────────────────────

test("evaluateBreachAlert: nyt brud uden tidligere signatur → alarmér", () => {
  const breaches = [{ metric: "maxRiderWinRate", since: "2026-07-16" }];
  const r = evaluateBreachAlert(breaches, "");
  assert.equal(r.shouldAlert, true);
  assert.equal(r.changed, true);
  assert.equal(r.signature, "maxRiderWinRate@2026-07-16");
});

test("evaluateBreachAlert: SAMME brud igen (uændret signatur) → tavs (spam-fixet)", () => {
  // Rod-scenariet: boot-kørsel efter deploy ser det uændrede vedvarende brud.
  const breaches = [{ metric: "maxRiderWinRate", since: "2026-07-16" }];
  const prev = "maxRiderWinRate@2026-07-16";
  const r = evaluateBreachAlert(breaches, prev);
  assert.equal(r.shouldAlert, false);
  assert.equal(r.changed, false);
});

test("evaluateBreachAlert: brud der bare bliver ÆLDRE (samme since) → tavs", () => {
  // findConsecutiveBreaches øger `days`, men `since` er uændret → ingen ny alarm.
  const r = evaluateBreachAlert([{ metric: "maxRiderWinRate", since: "2026-07-16", days: 8 }], "maxRiderWinRate@2026-07-16");
  assert.equal(r.shouldAlert, false);
});

test("evaluateBreachAlert: NYT brud oveni et eksisterende → alarmér (signatur ændret)", () => {
  const breaches = [
    { metric: "maxRiderWinRate", since: "2026-07-16" },
    { metric: "favoriteWinRate", since: "2026-07-18" },
  ];
  const r = evaluateBreachAlert(breaches, "maxRiderWinRate@2026-07-16");
  assert.equal(r.shouldAlert, true);
  assert.equal(r.changed, true);
  assert.equal(r.signature, "favoriteWinRate@2026-07-18|maxRiderWinRate@2026-07-16"); // sorteret
});

test("evaluateBreachAlert: streak brudt og genstartet (ny since) → alarmér igen", () => {
  const r = evaluateBreachAlert([{ metric: "maxRiderWinRate", since: "2026-07-20" }], "maxRiderWinRate@2026-07-16");
  assert.equal(r.shouldAlert, true);
  assert.equal(r.signature, "maxRiderWinRate@2026-07-20");
});

test("evaluateBreachAlert: brud RYDDET (tom liste) efter tidligere brud → tavs men changed=true", () => {
  // changed=true så caller persisterer den tomme signatur; et fremtidigt identisk
  // brud alarmerer så igen i stedet for at blive fejlagtigt undertrykt.
  const r = evaluateBreachAlert([], "maxRiderWinRate@2026-07-16");
  assert.equal(r.shouldAlert, false);
  assert.equal(r.changed, true);
  assert.equal(r.signature, "");
});

test("evaluateBreachAlert: ingen brud og ingen tidligere signatur → tavs, changed=false", () => {
  const r = evaluateBreachAlert([], "");
  assert.equal(r.shouldAlert, false);
  assert.equal(r.changed, false);
  assert.equal(r.signature, "");
});

test("evaluateBreachAlert: signatur er rækkefølge-uafhængig (deterministisk sort)", () => {
  const a = evaluateBreachAlert([
    { metric: "favoriteWinRate", since: "2026-07-18" },
    { metric: "maxRiderWinRate", since: "2026-07-16" },
  ], "").signature;
  const b = evaluateBreachAlert([
    { metric: "maxRiderWinRate", since: "2026-07-16" },
    { metric: "favoriteWinRate", since: "2026-07-18" },
  ], "").signature;
  assert.equal(a, b);
});

// ── #2731: robuste estimatorer (Wilson-LB + pooling) ─────────────────────────

test("wilsonLowerBound: reproducerer de prod-verificerede vaerdier fra #2731-auditen", () => {
  // 5/7 = 0,714 raa (roed mod baand 0,45) -> LB 0,359 (groen). Prod 2/8.
  assert.equal(Number(wilsonLowerBound(5, 7).toFixed(4)), 0.3589);
  // 4/6 = 0,667 raa -> LB 0,300. Prod 2/8 (nr. 2 paa listen).
  assert.equal(Number(wilsonLowerBound(4, 6).toFixed(4)), 0.3000);
  // 12/17 = 0,706 over et REALISTISK antal starter -> LB 0,469 = stadig ROED.
  // Dette er foelsomheds-garantien: en aegte dominator slipper ikke igennem.
  assert.ok(wilsonLowerBound(12, 17) > 0.45);
});

test("wilsonLowerBound: samme rate men flere starter giver hoejere nedre graense", () => {
  const r = [wilsonLowerBound(3, 6), wilsonLowerBound(10, 20), wilsonLowerBound(25, 50)];
  assert.ok(r[0] < r[1] && r[1] < r[2], `forventede stigende LB, fik ${r.join(", ")}`);
  // Konvergerer nedefra mod den raa rate.
  assert.ok(r[2] < 0.5);
});

test("wilsonLowerBound: degenererede input -> null, aldrig NaN/negativ", () => {
  assert.equal(wilsonLowerBound(0, 0), null);
  assert.equal(wilsonLowerBound(1, -3), null);
  assert.equal(wilsonLowerBound(NaN, 5), null);
  assert.equal(wilsonLowerBound(0, 10), 0 <= wilsonLowerBound(0, 10) ? wilsonLowerBound(0, 10) : NaN);
  assert.ok(wilsonLowerBound(0, 10) >= 0);
});

test("maxRiderWinRateLowerBound: vaelger hoejeste NEDRE graense, ikke hoejeste raa rate", () => {
  const starts = new Map([["small", 5], ["big", 20], ["tiny", 4]]);
  const wins = new Map([["small", 4], ["big", 12], ["tiny", 4]]);
  const out = maxRiderWinRateLowerBound({ winsByRider: wins, startsByRider: starts, minStarts: 5 });
  // raa: small 0,80 > big 0,60 — men LB: big vinder fordi naevneren baerer.
  assert.equal(out.leader.riderId, "big");
  assert.equal(out.riders, 2, "tiny (4 starter) skal filtreres fra");
});

test("maxRiderWinRateLowerBound: ingen kvalificerede ryttere -> null", () => {
  const out = maxRiderWinRateLowerBound({
    winsByRider: new Map([["a", 1]]), startsByRider: new Map([["a", 2]]), minStarts: 5,
  });
  assert.equal(out.maxLowerBound, null);
  assert.equal(out.leader, null);
});

test("poolDailyRate: vaegter dage efter stageInstances, ikke uvaegtet gennemsnit", () => {
  const rows = [
    { date: "2026-08-02", metrics: { favoriteWinRate: 0.5, stageInstances: 10 } },
    { date: "2026-08-01", metrics: { favoriteWinRate: 0.1, stageInstances: 90 } },
  ];
  const pooled = poolDailyRate(rows, "favoriteWinRate", 7);
  // (0,5*10 + 0,1*90) / 100 = 0,14 — ikke det uvaegtede 0,30.
  assert.equal(Number(pooled.value.toFixed(4)), 0.14);
  assert.equal(pooled.stages, 100);
  assert.equal(pooled.days, 2);
});

test("poolDailyRate: springer raekker uden brugbar naevner over og respekterer vinduet", () => {
  const rows = [
    { date: "2026-08-03", metrics: { favoriteWinRate: 0.4, stageInstances: 0 } },
    { date: "2026-08-02", metrics: { favoriteWinRate: 0.3, stageInstances: 50 } },
    { date: "2026-08-01", metrics: { favoriteWinRate: null, stageInstances: 50 } },
    { date: "2026-07-31", metrics: { favoriteWinRate: 0.9, stageInstances: 50 } },
  ];
  // Vindue 3 dage -> kun 08-03/08-02/08-01; kun 08-02 er brugbar.
  const pooled = poolDailyRate(rows, "favoriteWinRate", 3);
  assert.equal(pooled.value, 0.3);
  assert.equal(pooled.days, 1);
  // Ingen brugbare raekker overhovedet -> null, ikke 0 (0 ville se ud som et baand-brud).
  assert.equal(poolDailyRate([], "favoriteWinRate", 7).value, null);
});

test("classifyDay: robust OFF er felt-for-felt identisk med dags-linsen", () => {
  const metrics = { favoriteWinRate: 0.51, maxRiderWinRate: 0.75, maxRiderWinRateLb: 0.31, stageInstances: 49 };
  const out = classifyDay(metrics, { robust: false });
  assert.equal(out.maxRiderWinRate.value, 0.75);
  assert.equal(out.maxRiderWinRate.status, "red");
  assert.equal(out.maxRiderWinRate.basis, "day");
  assert.equal(out.favoriteWinRate.value, 0.51);
  assert.equal(out.favoriteWinRate.status, "red");
});

test("classifyDay: robust ON bedoemmer maxRiderWinRate paa Wilson-LB (prod 2/8-tallene)", () => {
  // Faktiske tal 2026-08-02: raa 0,714 (roed) — LB 0,359 (groen).
  const metrics = { maxRiderWinRate: 0.7142857142857143, maxRiderWinRateLb: 0.3589, stageInstances: 41 };
  const out = classifyDay(metrics, { robust: true, recentRows: [{ date: "2026-08-02", metrics }] });
  assert.equal(out.maxRiderWinRate.status, "green");
  assert.equal(out.maxRiderWinRate.basis, "wilson-lb");
  // Dags-vaerdien bevares saa admin-trenden kan vise begge linser.
  assert.equal(out.maxRiderWinRate.dayValue, 0.7142857142857143);
});

test("classifyDay: robust ON falder tilbage til dags-vaerdien naar LB mangler (gamle raekker)", () => {
  const metrics = { maxRiderWinRate: 0.75, stageInstances: 49 };
  const out = classifyDay(metrics, { robust: true, recentRows: [{ date: "2026-07-16", metrics }] });
  assert.equal(out.maxRiderWinRate.value, 0.75);
  assert.equal(out.maxRiderWinRate.basis, "day");
  assert.equal(out.maxRiderWinRate.status, "red", "fejler mod at alarmere, ikke mod at tie");
});

test("classifyDay: robust ON pooler dags-raterne over vinduet (stoej-dagen alene var roed)", () => {
  // Prod 2026-07-28: favoriteWinRate 0,078 paa 51 etaper = roed. Poolet over
  // ugen er niveauet 0,212 — stadig under 0,25, men uden dags-udsvinget.
  const rows = [
    { date: "2026-07-28", metrics: { favoriteWinRate: 0.078, stageInstances: 51 } },
    { date: "2026-07-27", metrics: { favoriteWinRate: 0.194, stageInstances: 31 } },
    { date: "2026-07-26", metrics: { favoriteWinRate: 0.245, stageInstances: 49 } },
    { date: "2026-07-25", metrics: { favoriteWinRate: 0.313, stageInstances: 48 } },
  ];
  const out = classifyDay(rows[0].metrics, { robust: true, recentRows: rows, poolWindowDays: 7 });
  assert.equal(out.favoriteWinRate.basis, "pooled-4d");
  assert.ok(out.favoriteWinRate.value > 0.19 && out.favoriteWinRate.value < 0.22,
    `forventede ~0,21, fik ${out.favoriteWinRate.value}`);
  assert.equal(out.favoriteWinRate.dayValue, 0.078);
});

test("computeDayMetrics: eksponerer maxRiderWinRateLb ved siden af den raa max", () => {
  const m = computeDayMetrics({
    winsByRider: new Map([["a", 5]]),
    startsByRider: new Map([["a", 7]]),
  });
  assert.equal(m.maxRiderWinRate, 5 / 7);
  assert.equal(Number(m.maxRiderWinRateLb.toFixed(4)), 0.3589);
  assert.equal(m.maxRiderWinRateRiders, 1);
});

test("foldRiderWindowRows: NULL rider_id klumpes IKKE sammen til een phantom-rytter", () => {
  // Prod-formen: 25,7 pct af raekkerne i 14-dages-vinduet har rider_id=NULL
  // (auto-fill-raekker) og baerer ogsaa etapesejre. En bar map.set() ville give
  // dem alle noeglen `null` og skabe een "rytter" med tusindvis af starter.
  const rows = [
    { rider_id: null, rank: 1 },
    { rider_id: null, rank: 1 },
    { rider_id: null, rank: 7 },
    { rider_id: "", rank: 1 },
    { rider_id: "a", rank: 1 },
    { rider_id: "a", rank: 4 },
  ];
  const out = foldRiderWindowRows(rows);
  assert.equal(out.skippedNullRiderRows, 4);
  assert.equal(out.startsByRider.size, 1, "kun den identificerede rytter taeller");
  assert.equal(out.startsByRider.get("a"), 2);
  assert.equal(out.winsByRider.get("a"), 1);
  assert.ok(!out.startsByRider.has(null), "ingen null-noegle");
  assert.ok(!out.startsByRider.has(""), "ingen tom-streng-noegle");
});

test("foldRiderWindowRows: phantom-raekker forurener ikke maxRiderWinRate", () => {
  // 60 NULL-raekker med 30 sejre ville som samlet noegle give win-rate 0,50 og
  // dermed vaere naer baandet — de skal vaere helt vaek fra estimatoren.
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ rider_id: null, rank: i < 30 ? 1 : 5 });
  for (let i = 0; i < 10; i++) rows.push({ rider_id: "real", rank: i < 2 ? 1 : 9 });
  const { winsByRider, startsByRider, skippedNullRiderRows } = foldRiderWindowRows(rows);
  assert.equal(skippedNullRiderRows, 60);
  const stats = maxRiderWinRateLowerBound({ winsByRider, startsByRider, minStarts: 5 });
  assert.equal(stats.riders, 1);
  assert.equal(stats.leader.riderId, "real");
});
