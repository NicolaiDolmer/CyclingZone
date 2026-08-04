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
  computeTierBreakdown,
  classifyTierBreakdown,
  findConsecutiveTierBreaches,
  wilsonLowerBound,
  maxRiderWinRateLowerBound,
  maxRiderWinCountAboveRateFloor,
  poolDailyRate,
  foldRiderWindowRows,
  computeShare4PlusRaceSnapshot,
  clusterCorrectedRate,
  distanceInStandardErrors,
  poolClusterCorrectedShare4Plus,
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

// ── computeTierBreakdown (#2557) ─────────────────────────────────────────────

function obs({ tier, favoriteWon = false, favoritePodium = false, maxSameTeamTop10 = 1, distinctTeamsTop10 = 10 }) {
  return { tier, favoriteWon, favoritePodium, maxSameTeamTop10, distinctTeamsTop10 };
}

test("computeTierBreakdown: grupperer pr. tier og aggregerer hver gruppe for sig", () => {
  const out = computeTierBreakdown([
    obs({ tier: 3, favoriteWon: true, favoritePodium: true, maxSameTeamTop10: 5 }),
    obs({ tier: 3, favoriteWon: true, favoritePodium: true, maxSameTeamTop10: 4 }),
    obs({ tier: 4 }),
    obs({ tier: 4 }),
  ]);
  assert.deepEqual(Object.keys(out).sort(), ["tier3", "tier4"]);
  assert.equal(out.tier3.stages, 2);
  assert.equal(out.tier3.favoriteWinRate, 1);
  assert.equal(out.tier3.share4PlusSameTeamTop10, 1);
  assert.equal(out.tier4.stages, 2);
  assert.equal(out.tier4.favoriteWinRate, 0);
  assert.equal(out.tier4.share4PlusSameTeamTop10, 0);
});

test("computeTierBreakdown: nedbrydningen afslører et bimodalt aggregat", () => {
  // 2 tier3-etaper hvor favoritten altid vinder + 2 tier4 hvor den aldrig gør.
  // Aggregatet ville sige 0,5 — men ingen af tierne ligger dér.
  const out = computeTierBreakdown([
    obs({ tier: 3, favoriteWon: true }), obs({ tier: 3, favoriteWon: true }),
    obs({ tier: 4 }), obs({ tier: 4 }),
  ]);
  assert.equal(out.tier3.favoriteWinRate, 1);
  assert.equal(out.tier4.favoriteWinRate, 0);
});

test("computeTierBreakdown: manglende tier grupperes som 'unknown' (aldrig gættet)", () => {
  const out = computeTierBreakdown([obs({ tier: null }), obs({})]);
  assert.deepEqual(Object.keys(out), ["unknown"]);
  assert.equal(out.unknown.stages, 2);
});

test("computeTierBreakdown: tom input giver tomt objekt", () => {
  assert.deepEqual(computeTierBreakdown([]), {});
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

// ── #2557 afsnit 5b: klynge-korrigeret share4Plus-SE ─────────────────────────

function dominanceObs({ raceId, maxSameTeamTop10 = 1 }) {
  return { raceId, maxSameTeamTop10, favoriteWon: false, favoritePodium: false, distinctTeamsTop10: 10 };
}

test("computeShare4PlusRaceSnapshot: grupperer etaper pr. raceId, hit = maxSameTeamTop10>=4", () => {
  const observations = [
    dominanceObs({ raceId: "raceA", maxSameTeamTop10: 5 }), // hit
    dominanceObs({ raceId: "raceA", maxSameTeamTop10: 3 }), // ikke hit
    dominanceObs({ raceId: "raceB", maxSameTeamTop10: 4 }), // hit
  ];
  const snap = computeShare4PlusRaceSnapshot(observations);
  assert.deepEqual(snap, {
    raceA: { hits: 1, stages: 2 },
    raceB: { hits: 1, stages: 1 },
  });
});

test("computeShare4PlusRaceSnapshot: ukendt raceId (null/undefined) udelades — kan ikke klynges", () => {
  const observations = [
    dominanceObs({ raceId: null, maxSameTeamTop10: 5 }),
    dominanceObs({ raceId: undefined, maxSameTeamTop10: 5 }),
    dominanceObs({ raceId: "raceA", maxSameTeamTop10: 5 }),
  ];
  const snap = computeShare4PlusRaceSnapshot(observations);
  assert.deepEqual(Object.keys(snap), ["raceA"]);
});

test("computeShare4PlusRaceSnapshot: tom liste giver tomt objekt", () => {
  assert.deepEqual(computeShare4PlusRaceSnapshot([]), {});
});

test("clusterCorrectedRate: syntetisk klynge-eksempel — ét stærkt korreleret løb dominerer det naive estimat", () => {
  // Race A: 5/5 etaper er brud (ét vedvarende matchup, som Tour des Alpes
  // Juliennes Div3-D i auditen). Race B/C/D: helt rene løb.
  const byCluster = {
    raceA: { hits: 5, stages: 5 },
    raceB: { hits: 0, stages: 4 },
    raceC: { hits: 0, stages: 3 },
    raceD: { hits: 0, stages: 1 },
  };
  const out = clusterCorrectedRate(byCluster);

  assert.equal(out.clusters, 4);
  assert.equal(out.stages, 13);
  assert.equal(out.hits, 5);
  // Naivt (pr.-etape) estimat: 5/13.
  assert.equal(Number(out.naiveEstimate.toFixed(4)), 0.3846);
  // Naiv Bernoulli-SE: sqrt(0.3846*0.6154/13) ≈ 0.1349.
  assert.equal(Number(out.naiveSe.toFixed(4)), 0.1349);
  // Klynge-estimat: uvægtet middel af løbs-raterne [1, 0, 0, 0] = 0,25 — IKKE
  // 0,3846. Sample-sd (n-1=3): sqrt(0,75/3) = 0,5. SE = 0,5/sqrt(4) = 0,25.
  assert.equal(out.clusterEstimate, 0.25);
  assert.equal(out.clusterSd, 0.5);
  assert.equal(out.clusterSe, 0.25);

  // Afstanden til bånd-max (0,05) er DRAMATISK mindre klynge-korrigeret:
  // naivt (0,3846-0,05)/0,1349 ≈ 2,48 SE; klynge-korrigeret (0,25-0,05)/0,25 = 0,8 SE.
  // Samme punktestimat-retning, meget forskellig sikkerhed — netop auditens pointe.
  const naiveDistance = distanceInStandardErrors(out.naiveEstimate, out.naiveSe, BALANCE_DRIFT_BANDS.share4PlusSameTeamTop10);
  const clusterDistance = distanceInStandardErrors(out.clusterEstimate, out.clusterSe, BALANCE_DRIFT_BANDS.share4PlusSameTeamTop10);
  assert.equal(Number(naiveDistance.toFixed(2)), 2.48);
  assert.equal(clusterDistance, 0.8);
  assert.ok(clusterDistance < naiveDistance, "klynge-korrektion skal ALDRIG se mere signifikant ud end den naive SE her");
});

test("clusterCorrectedRate: 0 klynger giver alle-null, aldrig NaN/crash", () => {
  const out = clusterCorrectedRate({});
  assert.deepEqual(out, {
    clusters: 0, stages: 0, hits: 0,
    naiveEstimate: null, naiveSe: null,
    clusterEstimate: null, clusterSd: null, clusterSe: null,
  });
});

test("clusterCorrectedRate: 1 klynge giver et estimat men INGEN SE (sd udefineret ved n=1)", () => {
  const out = clusterCorrectedRate({ soloRace: { hits: 2, stages: 4 } });
  assert.equal(out.clusters, 1);
  assert.equal(out.clusterEstimate, 0.5);
  assert.equal(out.clusterSd, null);
  assert.equal(out.clusterSe, null);
});

test("clusterCorrectedRate: klynger uden brugbare stages (0/negativ/ikke-finit) springes over", () => {
  const out = clusterCorrectedRate({
    ok: { hits: 1, stages: 2 },
    zero: { hits: 0, stages: 0 },
    bad: { hits: NaN, stages: 3 },
  });
  assert.equal(out.clusters, 1);
  assert.equal(out.stages, 2);
});

test("distanceInStandardErrors: positiv over max-baand, positiv under min-baand, 0 inde i baandet", () => {
  const band = { min: 0.25, max: 0.40 };
  assert.equal(distanceInStandardErrors(0.32, 0.02, band), 0);
  assert.equal(Number(distanceInStandardErrors(0.50, 0.05, band).toFixed(6)), 2); // (0.50-0.40)/0.05
  assert.equal(Number(distanceInStandardErrors(0.10, 0.05, band).toFixed(6)), 3); // (0.25-0.10)/0.05
});

test("distanceInStandardErrors: ensidet baand (kun max) — share4PlusSameTeamTop10-stil", () => {
  const band = BALANCE_DRIFT_BANDS.share4PlusSameTeamTop10; // { max: 0.05 }
  assert.equal(distanceInStandardErrors(0.03, 0.01, band), 0);
  assert.equal(Number(distanceInStandardErrors(0.15, 0.05, band).toFixed(6)), 2);
});

test("distanceInStandardErrors: null ved manglende/ikke-endeligt/ikke-positivt estimat eller SE", () => {
  const band = { max: 0.05 };
  assert.equal(distanceInStandardErrors(null, 0.05, band), null);
  assert.equal(distanceInStandardErrors(0.10, null, band), null);
  assert.equal(distanceInStandardErrors(0.10, 0, band), null);
  assert.equal(distanceInStandardErrors(0.10, NaN, band), null);
  assert.equal(distanceInStandardErrors(NaN, 0.05, band), null);
});

test("poolClusterCorrectedShare4Plus: SAMME løb over flere dage tælles som ÉN klynge, ikke N", () => {
  // Et 3-etapeløb (raceX) der bryder alle 3 dage, plus 2 rene enkeltdags-løb.
  // Naivt pr.-etape ville dette se ud som 3 uafhængige brud af 5 etaper i alt.
  const rows = [
    { date: "2026-08-01", metrics: { share4PlusByRace: { raceX: { hits: 1, stages: 1 }, raceY: { hits: 0, stages: 1 } } } },
    { date: "2026-08-02", metrics: { share4PlusByRace: { raceX: { hits: 1, stages: 1 }, raceZ: { hits: 0, stages: 1 } } } },
    { date: "2026-08-03", metrics: { share4PlusByRace: { raceX: { hits: 1, stages: 1 } } } },
  ];
  const out = poolClusterCorrectedShare4Plus(rows, 7);

  assert.equal(out.days, 3);
  assert.equal(out.clusters, 3, "raceX skal merges til ÉN klynge på tværs af 3 dage, ikke 3");
  assert.equal(out.stages, 5);
  assert.equal(out.hits, 3);
  // raceX-klyngen: 3/3 = 1,0 (merged hits/stages). raceY/raceZ: 0/1 hver.
  // Uvægtet middel: (1,0 + 0 + 0)/3 = 0,3333.
  assert.equal(Number(out.clusterEstimate.toFixed(4)), 0.3333);
  // Naivt pr.-etape (fejlagtigt hvis man IKKE klynge-korrigerer): 3/5 = 0,6.
  assert.equal(Number(out.naiveEstimate.toFixed(4)), 0.6);
});

test("poolClusterCorrectedShare4Plus: respekterer windowDays og springer raekker uden snapshot over", () => {
  const rows = [
    { date: "2026-08-03", metrics: {} }, // intet share4PlusByRace — springes over
    { date: "2026-08-02", metrics: { share4PlusByRace: { raceA: { hits: 1, stages: 1 } } } },
    { date: "2026-08-01", metrics: { share4PlusByRace: { raceB: { hits: 0, stages: 1 } } } },
    { date: "2026-07-31", metrics: { share4PlusByRace: { raceC: { hits: 0, stages: 1 } } } }, // uden for vindue=3
  ];
  const out = poolClusterCorrectedShare4Plus(rows, 3);
  assert.equal(out.days, 2, "kun 08-02 og 08-01 bidrager brugbare snapshots inden for vinduet");
  assert.equal(out.clusters, 2);
});

test("poolClusterCorrectedShare4Plus: tom rows-liste giver 0 klynger, ikke crash", () => {
  const out = poolClusterCorrectedShare4Plus([], 7);
  assert.equal(out.clusters, 0);
  assert.equal(out.days, 0);
});

// ── #2731-opfølgning B: maxRiderWinCountAboveRateFloor (spor B1, del A) ──────

test("maxRiderWinCountAboveRateFloor: reproducerer Rubio-casen (7/17, prod 2/8)", () => {
  const starts = new Map([["rubio", 17]]);
  const wins = new Map([["rubio", 7]]);
  const out = maxRiderWinCountAboveRateFloor({ winsByRider: wins, startsByRider: starts });
  assert.equal(out.maxWinsAboveRateFloor, 7);
  assert.equal(out.leader.riderId, "rubio");
  assert.equal(Number(out.leader.rate.toFixed(3)), 0.412);
  assert.equal(out.riders, 1);
});

test("maxRiderWinCountAboveRateFloor: vaelger HOEJESTE SEJRSANTAL, ikke hoejeste rate (den praecise Wilson-blinde-vinkel)", () => {
  // Wouters (5/7=0,714) har den hoejeste rate OG hoejere Wilson-LB end Rubio
  // (0,359 mod 0,216, jf. #3245-auditen) — men Rubios 7 sejre er det stoerre,
  // mere trovaerdige antal. Count-maalet skal vaelge Rubio, IKKE Wouters.
  const starts = new Map([["rubio", 17], ["wouters", 7]]);
  const wins = new Map([["rubio", 7], ["wouters", 5]]);
  const out = maxRiderWinCountAboveRateFloor({ winsByRider: wins, startsByRider: starts });
  assert.equal(out.maxWinsAboveRateFloor, 7);
  assert.equal(out.leader.riderId, "rubio");
  assert.equal(out.riders, 2, "begge klarer default-rate-gulvet 0,40");
});

test("maxRiderWinCountAboveRateFloor: rate-gulvet udelukker highvolume/lav-rate-ryttere", () => {
  // 6 sejre af 37 starter (rate 0,162, observeret i prod-scanningen 5/7-3/8)
  // er IKKE dominans — bare mange starter. Skal ekskluderes helt, ikke bare
  // rangere lavere, ellers ville en volumen-rytter kunne overtrumfe en aegte
  // dominator paa ren sejrs-optaelling.
  const starts = new Map([["grinder", 37], ["rubio", 17]]);
  const wins = new Map([["grinder", 6], ["rubio", 7]]);
  const out = maxRiderWinCountAboveRateFloor({ winsByRider: wins, startsByRider: starts });
  assert.equal(out.riders, 1, "kun rubio klarer rate-gulvet");
  assert.equal(out.leader.riderId, "rubio");
});

test("maxRiderWinCountAboveRateFloor: respekterer minStarts og minRate-parametre", () => {
  const starts = new Map([["a", 4], ["b", 10]]);
  const wins = new Map([["a", 4], ["b", 4]]); // a: 1,00 rate men under minStarts=5
  const out = maxRiderWinCountAboveRateFloor({ winsByRider: wins, startsByRider: starts, minStarts: 5, minRate: 0.30 });
  assert.equal(out.riders, 1);
  assert.equal(out.leader.riderId, "b");
  assert.equal(out.maxWinsAboveRateFloor, 4);
});

test("maxRiderWinCountAboveRateFloor: tomt input -> null, aldrig NaN", () => {
  const out = maxRiderWinCountAboveRateFloor({});
  assert.equal(out.maxWinsAboveRateFloor, null);
  assert.equal(out.leader, null);
  assert.equal(out.riders, 0);
});

test("computeDayMetrics: eksponerer maxRiderDominantWinCount, altid beregnet (samme moenster som maxRiderWinRateLb)", () => {
  const m = computeDayMetrics({
    winsByRider: new Map([["rubio", 7]]),
    startsByRider: new Map([["rubio", 17]]),
  });
  assert.equal(m.maxRiderDominantWinCount, 7);
  assert.equal(m.maxRiderDominantWinCountRiders, 1);
});

test("maxRiderDominantWinCount-baandet er reportOnly: klassificerer altid 'info', deltager aldrig i alarmen", () => {
  const band = BALANCE_DRIFT_BANDS.maxRiderDominantWinCount;
  assert.equal(band.reportOnly, true);
  assert.equal(classifyMetric(9, band), "info");
  assert.equal(classifyMetric(0, band), "info");
  assert.ok(!ALARM_ELIGIBLE_METRICS.includes("maxRiderDominantWinCount"));

  const statuses = classifyDay({ maxRiderDominantWinCount: 9 });
  assert.equal(statuses.maxRiderDominantWinCount.status, "info");
  assert.equal(statuses.maxRiderDominantWinCount.value, 9);
});

// ── #2557/#3250-opfølgning: classifyTierBreakdown + findConsecutiveTierBreaches (spor B1, del B) ──

test("classifyTierBreakdown: klassificerer hver tier mod de kanoniske baand", () => {
  // Ægte prod-tal 2026-08-02 (eneste dag med persisteret byTier paa
  // skrivetidspunktet): global favoriteWinRate var 'yellow' mens tier1/3/4
  // hver isoleret bryder baandet (0,25-0,40).
  const byTier = {
    tier1: { stages: 20, favoriteWinRate: 0.2, favoritePodiumRate: null, share4PlusSameTeamTop10: null, avgDistinctTeamsTop10: null },
    tier2: { stages: 24, favoriteWinRate: 0.25, favoritePodiumRate: null, share4PlusSameTeamTop10: null, avgDistinctTeamsTop10: null },
    tier3: { stages: 12, favoriteWinRate: 0.5833333333333334, favoritePodiumRate: null, share4PlusSameTeamTop10: null, avgDistinctTeamsTop10: null },
    tier4: { stages: 16, favoriteWinRate: 0.1875, favoritePodiumRate: null, share4PlusSameTeamTop10: null, avgDistinctTeamsTop10: null },
  };
  const out = classifyTierBreakdown(byTier);
  assert.equal(out.tier1.favoriteWinRate.status, "red");
  assert.equal(out.tier2.favoriteWinRate.status, "green");
  assert.equal(out.tier3.favoriteWinRate.status, "red");
  assert.equal(out.tier4.favoriteWinRate.status, "red");
});

test("classifyTierBreakdown: null-vaerdier -> n/a, ikke krak", () => {
  const out = classifyTierBreakdown({ tier3: { stages: 0, favoriteWinRate: null, favoritePodiumRate: null, share4PlusSameTeamTop10: null, avgDistinctTeamsTop10: null } });
  assert.equal(out.tier3.favoriteWinRate.status, "n/a");
});

test("classifyTierBreakdown: tomt input -> tomt objekt", () => {
  assert.deepEqual(classifyTierBreakdown({}), {});
});

test("findConsecutiveTierBreaches: tier3 trippper ALENE i 3+ dage selvom global er groen hele perioden", () => {
  const rows = [
    {
      date: "2026-07-28",
      tierStatuses: { tier3: { favoriteWinRate: { status: "red" } }, tier1: { favoriteWinRate: { status: "green" } } },
    },
    {
      date: "2026-07-29",
      tierStatuses: { tier3: { favoriteWinRate: { status: "red" } }, tier1: { favoriteWinRate: { status: "green" } } },
    },
    {
      date: "2026-07-30",
      tierStatuses: { tier3: { favoriteWinRate: { status: "red" } }, tier1: { favoriteWinRate: { status: "green" } } },
    },
  ];
  // Det GLOBALE aggregat (findConsecutiveBreaches) er groent hele perioden —
  // simuleret ved slet ikke at give den nogen roede statuses.
  const globalRows = rows.map((r) => ({ date: r.date, statuses: { favoriteWinRate: { status: "green" } } }));
  const globalBreaches = findConsecutiveBreaches(globalRows, { minConsecutiveDays: 3 });
  assert.deepEqual(globalBreaches, [], "det globale aggregat skal IKKE bryde i dette scenarie");

  const tierBreaches = findConsecutiveTierBreaches(rows, { minConsecutiveDays: 3 });
  assert.equal(tierBreaches.length, 1);
  assert.equal(tierBreaches[0].tier, "tier3");
  assert.equal(tierBreaches[0].metric, "favoriteWinRate");
  assert.equal(tierBreaches[0].days, 3);
  assert.equal(tierBreaches[0].since, "2026-07-28");
});

test("findConsecutiveTierBreaches: hul i datoerne nulstiller streaken (samme regel som findConsecutiveBreaches)", () => {
  const rows = [
    { date: "2026-07-28", tierStatuses: { tier3: { favoriteWinRate: { status: "red" } } } },
    { date: "2026-07-29", tierStatuses: { tier3: { favoriteWinRate: { status: "red" } } } },
    // Hul: 7/30 mangler helt (manglende cron-tick).
    { date: "2026-07-31", tierStatuses: { tier3: { favoriteWinRate: { status: "red" } } } },
  ];
  assert.deepEqual(findConsecutiveTierBreaches(rows, { minConsecutiveDays: 3 }), []);
});

test("findConsecutiveTierBreaches: flere (tier, metric)-par kan bryde samtidigt, sorteret", () => {
  const rows = ["2026-07-28", "2026-07-29", "2026-07-30"].map((date) => ({
    date,
    tierStatuses: {
      tier1: { favoriteWinRate: { status: "red" } },
      tier3: { favoriteWinRate: { status: "red" }, favoritePodiumRate: { status: "red" } },
    },
  }));
  const out = findConsecutiveTierBreaches(rows, { minConsecutiveDays: 3 });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((b) => `${b.tier}:${b.metric}`), ["tier1:favoriteWinRate", "tier3:favoritePodiumRate", "tier3:favoriteWinRate"]);
});

test("findConsecutiveTierBreaches: under 3 dage -> ingen brud; tom liste -> tom liste", () => {
  const rows = [
    { date: "2026-07-29", tierStatuses: { tier3: { favoriteWinRate: { status: "red" } } } },
    { date: "2026-07-30", tierStatuses: { tier3: { favoriteWinRate: { status: "red" } } } },
  ];
  assert.deepEqual(findConsecutiveTierBreaches(rows, { minConsecutiveDays: 3 }), []);
  assert.deepEqual(findConsecutiveTierBreaches([], { minConsecutiveDays: 3 }), []);
});
