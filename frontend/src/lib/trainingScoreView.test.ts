// #5486 — traeningsscore-sparklinens serie maa ikke have huller paa loebsdage.

import test from "node:test";
import assert from "node:assert/strict";

import { filterTrainingScoreSpark, receiptPassScore, latestReceiptPassScore, type TrainingScoreSparkPoint } from "./trainingScoreView.ts";

test("receipt scores match date, season and race day; summary is the latest training pass", () => {
  const view = { sessions: [
    {date:"2026-09-29",seasonId:"s4",gameDay:8,score:56,raceDay:false},
    {date:"2026-09-29",seasonId:"s3",gameDay:8,score:90,raceDay:false},
    {date:"2026-09-29",seasonId:"s4",gameDay:6,score:52,raceDay:false},
    {date:"2026-09-29",seasonId:"s4",gameDay:7,score:null,raceDay:true},
  ]};
  const activities=[{game_day:6,intensity:"hard"},{game_day:7,race_day:true},{game_day:8,intensity:"hard"},{game_day:9,intensity:"rest"}];
  assert.equal(receiptPassScore(view,"2026-09-29","s4",activities[0]),52);
  assert.equal(receiptPassScore(view,"2026-09-29","s4",activities[1]),null);
  assert.equal(receiptPassScore(view,"2026-09-29","s4",activities[3]),null);
  assert.equal(latestReceiptPassScore(view,"2026-09-29","s4",activities),56);
});

test("receipt scores never substitute gain scores, uncertain evidence or another slot", () => {
  const view={sessions:[{date:"2026-09-29",seasonId:"s4",gameDay:6,score:52}]};
  assert.equal(receiptPassScore(view,"2026-09-29","s4",{game_day:8,score:4}),null);
  assert.equal(receiptPassScore(view,"2026-09-29","s4",{game_day:6,status:"unknown_pending"}),null);
  assert.equal(receiptPassScore(view,"2026-09-29","s4",{game_day:6,settlement_status:"needs_reconciliation"}),null);
});

test("legacy spark fallback is only safe for a single unslotted session on the date", () => {
  const view={spark:[{date:"2026-09-29",score:52}]};
  assert.equal(receiptPassScore(view,"2026-09-29",null,{intensity:"normal"}),52);
  assert.equal(receiptPassScore(view,"2026-09-29","s4",{game_day:6}),null);
  assert.equal(receiptPassScore({spark:[...view.spark,...view.spark]},"2026-09-29",null,{}),null);
});

test("legacy reports without season metadata match only one unslotted ledger session", () => {
  const session={date:"2026-09-29",seasonId:"s4",gameDay:null,score:52};
  assert.equal(receiptPassScore({sessions:[session]},"2026-09-29",null,{}),52);
  assert.equal(receiptPassScore({sessions:[session,{...session,seasonId:"s3"}]},"2026-09-29",null,{}),null);
});

function point(date: string, score: number | null, raceDay = false): TrainingScoreSparkPoint {
  return { date, score, raceDay };
}

test("T,T,L,T,T giver 4 punkter — loebsdagen er ikke med, hverken som 0 eller null", () => {
  const raw = [
    point("2026-09-01", 40),
    point("2026-09-02", 55),
    point("2026-09-03", null, true),
    point("2026-09-04", 60),
    point("2026-09-05", 72),
  ];
  const filtered = filterTrainingScoreSpark(raw);
  assert.equal(filtered.length, 4, "loebsdagen skal filtreres vaek, ikke give et 5. (null-)punkt");
  assert.deepEqual(filtered.map((p) => p.score), [40, 55, 60, 72]);
  assert.deepEqual(filtered.map((p) => p.date), ["2026-09-01", "2026-09-02", "2026-09-04", "2026-09-05"],
    "de resterende dage skal bevare deres raekkefoelge og datoer");
});

test("flere loebsdage i traek (fx training_tick_per_race_day) udelades alle", () => {
  const raw = [
    point("2026-09-01", 40),
    point("2026-09-02", null, true),
    point("2026-09-02", null, true),
    point("2026-09-02", null, true),
    point("2026-09-03", 60),
  ];
  const filtered = filterTrainingScoreSpark(raw);
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((p) => p.score), [40, 60]);
});

test("null/undefined-input giver et tomt array, ikke et kast", () => {
  assert.deepEqual(filterTrainingScoreSpark(null), []);
  assert.deepEqual(filterTrainingScoreSpark(undefined), []);
  assert.deepEqual(filterTrainingScoreSpark([]), []);
});

test("en raekke uden raceDay-flag men med null-score filtreres ogsaa vaek", () => {
  // Filteret kigger kun paa `score` — ikke paa `raceDay` — saa det er robust
  // uanset hvad der forårsagede det manglende tal.
  const raw = [point("2026-09-01", 40), { date: "2026-09-02", score: null }];
  assert.deepEqual(filterTrainingScoreSpark(raw).map((p) => p.score), [40]);
});

test("en raekke der IKKE er et objekt, springes over uden at kaste", () => {
  const raw = [point("2026-09-01", 40), null, undefined];
  assert.deepEqual(filterTrainingScoreSpark(raw).map((p) => p.score), [40]);
});
