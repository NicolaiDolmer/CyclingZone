import { test } from "node:test";
import assert from "node:assert/strict";

import {
  certaintyStep,
  coachInputFromView,
  estimateLineOf,
  potentialViewOf,
  potentialViewValue,
} from "./potentialEstimateDisplay.ts";

const shown = { hidden: false, value: 74, certainty: "fair", previousValue: 71, previousCertainty: "unsure", changedAt: "2026-11-01T04:00:00.000Z" };

test("slukket flag: intet felt giver null, så fladen bruger sin gamle visning", () => {
  assert.equal(potentialViewOf({ lo: 3, hi: 4, prog: { lo: 40, hi: 48 } }), null);
  assert.equal(potentialViewOf(null), null);
  assert.equal(potentialViewOf(undefined), null);
});

test("et synligt skøn læses med tal, ord og det forrige skøn", () => {
  assert.deepEqual(potentialViewOf({ potentialView: shown }), shown);
});

test("et første skøn uden forrige værdi giver null-felter, ikke undefined", () => {
  const view = potentialViewOf({ potentialView: { hidden: false, value: 61, certainty: "unsure" } });
  assert.deepEqual(view, { hidden: false, value: 61, certainty: "unsure", previousValue: null, previousCertainty: null, changedAt: null });
});

test("de to tomme tilstande bevares", () => {
  assert.deepEqual(potentialViewOf({ potentialView: { hidden: true, reason: "unscouted" } }), { hidden: true, reason: "unscouted" });
  assert.deepEqual(
    potentialViewOf({ potentialView: { hidden: true, reason: "learning", trainings: 3, trainingsNeeded: 5 } }),
    { hidden: true, reason: "learning", trainings: 3, trainingsNeeded: 5 },
  );
});

test("en ukendt form viser ikke et gættet tal", () => {
  for (const potentialView of [
    { hidden: false, value: 74, certainty: "maybe" },
    { hidden: false, value: "74", certainty: "fair" },
    { value: 74, certainty: "fair" },
    { hidden: true, reason: "other" },
    { hidden: true, reason: "learning", trainings: 3 },
  ]) {
    assert.equal(potentialViewOf({ potentialView }), null, JSON.stringify(potentialView));
  }
});

test("et interval ved siden af skønnet følger aldrig med ud af læseren", () => {
  const view = potentialViewOf({ potentialView: { ...shown, lo: 60, hi: 80, loft: 93, prog: { lo: 1, hi: 2 } } });
  assert.deepEqual(Object.keys(view ?? {}).sort(), ["certainty", "changedAt", "hidden", "previousCertainty", "previousValue", "value"]);
});

test("kun et synligt skøn har et tal at sortere på", () => {
  assert.equal(potentialViewValue(potentialViewOf({ potentialView: shown })), 74);
  assert.equal(potentialViewValue({ hidden: true, reason: "unscouted" }), null);
  assert.equal(potentialViewValue({ hidden: true, reason: "learning", trainings: 1, trainingsNeeded: 5 }), null);
  assert.equal(potentialViewValue(null), null);
});

test("måleren har tre trin i ordenes rækkefølge", () => {
  assert.deepEqual(["unsure", "fair", "sure"].map((word) => certaintyStep(word as "fair")), [1, 2, 3]);
});

test("kurven mod skønnet sorteres og mister ugyldige punkter", () => {
  const line = estimateLineOf({ estimateLine: [{ season: 2, value: 50 }, { season: 0, value: 40 }, { season: 1, value: null }] });
  assert.deepEqual(line, [{ season: 0, value: 40 }, { season: 2, value: 50 }]);
  assert.deepEqual(estimateLineOf({ band: [] }), []);
  assert.deepEqual(estimateLineOf(null), []);
});

test("trænerens ord bygger på tallet, og kun et sikkert skøn er endeligt", () => {
  assert.deepEqual(coachInputFromView({ ...shown, certainty: "sure" } as never), { band: { lo: 74, hi: 74 }, knowledgeStage: "final" });
  assert.deepEqual(coachInputFromView({ ...shown, certainty: "fair" } as never), { band: { lo: 74, hi: 74 }, knowledgeStage: "learning" });
  assert.deepEqual(coachInputFromView({ hidden: true, reason: "unscouted" }), { band: null, knowledgeStage: "learning" });
});
