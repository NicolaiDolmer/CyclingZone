import { test } from "node:test";
import assert from "node:assert/strict";
import { riderSuitability } from "./suitability.js";

test("riderSuitability: perfekt rytter (alle 99) rammer ~100", () => {
  const ab = { climbing: 99, tempo: 99, endurance: 99 };
  const demand = { climbing: 0.5, tempo: 0.12, endurance: 0.14, randomness: 0.1 };
  const { score } = riderSuitability(ab, demand);
  assert.ok(score >= 98 && score <= 100, `score=${score}`);
});

test("riderSuitability: svag rytter mod krævet evne → lav score", () => {
  const climber = riderSuitability({ climbing: 90, tempo: 70 }, { climbing: 0.6, tempo: 0.4 }).score;
  const sprinter = riderSuitability({ climbing: 30, tempo: 40 }, { climbing: 0.6, tempo: 0.4 }).score;
  assert.ok(climber > sprinter, `${climber} skal slå ${sprinter}`);
});

test("riderSuitability: contributions sorteret efter demand-vægt (mest krævede først)", () => {
  const { contributions } = riderSuitability({ climbing: 80, tempo: 80, sprint: 80 }, { sprint: 0.2, climbing: 0.5, tempo: 0.3 });
  assert.equal(contributions[0].ability, "climbing");
  assert.equal(contributions[1].ability, "tempo");
});

test("riderSuitability: manglende demand → 0, ingen contributions", () => {
  assert.deepEqual(riderSuitability({ climbing: 90 }, null), { score: 0, contributions: [] });
});

test("riderSuitability: 'randomness' i demand tælles ikke (ikke en evne)", () => {
  const a = riderSuitability({ climbing: 60 }, { climbing: 1.0 }).score;
  const b = riderSuitability({ climbing: 60 }, { climbing: 1.0, randomness: 0.5 }).score;
  assert.equal(a, b);
});

// #6207: DELT TESTVEKTOR med backend/lib/raceAutopick.test.js (displaySuitability /
// displayStageSuitabilityScores). Samme evner og etaper, samme forventede tal. Løbets
// demand-vektor er summen af etapernes.
test("riderSuitability: paritet med backendens visnings-egnethed (delt testvektor, #6207)", () => {
  const abilities = { climbing: 80, sprint: 40, endurance: 60, tempo: 50, time_trial: 70 };
  const stage1 = { climbing: 0.5, endurance: 0.3, tempo: 0.1, randomness: 0.1 };
  const stage2 = { sprint: 0.6, endurance: 0.3, randomness: 0.1 };
  assert.equal(riderSuitability(abilities, stage1).score, 71);
  assert.equal(riderSuitability(abilities, stage2).score, 47);
  const race = { climbing: 0.5, endurance: 0.6, tempo: 0.1, sprint: 0.6, randomness: 0.2 };
  assert.equal(riderSuitability(abilities, race).score, 59);
});
