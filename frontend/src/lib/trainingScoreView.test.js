// #5486 — traeningsscore-sparklinens serie maa ikke have huller paa loebsdage.

import test from "node:test";
import assert from "node:assert/strict";

import { filterTrainingScoreSpark } from "./trainingScoreView.js";

function point(date, score, raceDay = false) {
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
