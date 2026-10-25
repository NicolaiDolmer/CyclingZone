import test from "node:test";
import assert from "node:assert/strict";
import { buildAllDecisions, buildDailyDecision, DECISION_RISK_FROM, MAX_DECISION_SUGGESTIONS } from "./DailyDecisionModel.ts";

type Row = { fatigue: number; risk: number; racing?: boolean; injured?: boolean; easy?: boolean };

function run(rows: Record<string, Row>) {
  return buildDailyDecision({
    riderIds: Object.keys(rows),
    condition: (id) => rows[id],
    isRacing: (id) => Boolean(rows[id].racing),
    isInjured: (id) => Boolean(rows[id].injured),
    isEasyDay: (id) => Boolean(rows[id].easy),
  });
}

test("kun ryttere med skaderisiko over graensen faar et forslag, aktiv restitution", () => {
  const out = run({ a: { fatigue: 90, risk: 0.2 }, b: { fatigue: 60, risk: 0 }, c: { fatigue: 75, risk: DECISION_RISK_FROM - 0.01 } });
  assert.deepEqual(out, [{ riderId: "a", dayType: "recovery", fatigue: 90 }]);
});

test("loeb slaar traening, skadet og allerede let dag giver intet forslag", () => {
  const out = run({
    a: { fatigue: 90, risk: 0.3, racing: true },
    b: { fatigue: 88, risk: 0.3, injured: true },
    c: { fatigue: 85, risk: 0.3, easy: true },
    d: { fatigue: 80, risk: 0.3 },
  });
  assert.deepEqual(out.map((s) => s.riderId), ["d"]);
});

test("traetteste foerst, hoejst tre, stabil raekkefoelge ved lige traethed", () => {
  const rows: Record<string, Row> = {};
  for (const [i, id] of ["e", "d", "c", "b", "a"].entries()) rows[id] = { fatigue: i < 2 ? 80 : 70 + i, risk: 0.3 };
  const out = run(rows);
  assert.equal(out.length, MAX_DECISION_SUGGESTIONS);
  assert.ok(out[0].fatigue >= out[1].fatigue && out[1].fatigue >= out[2].fatigue);
  const tied = run({ z: { fatigue: 80, risk: 0.3 }, y: { fatigue: 80, risk: 0.3 } });
  assert.deepEqual(tied.map((s) => s.riderId), ["y", "z"]);
});

test("manglende condition eller ikke-tal giver intet forslag", () => {
  const out = buildDailyDecision({
    riderIds: ["a", "b"],
    condition: (id) => (id === "a" ? null : { fatigue: null, risk: 0.4 }),
    isRacing: () => false,
    isInjured: () => false,
    isEasyDay: () => false,
  });
  assert.deepEqual(out, []);
});

test("buildAllDecisions har intet loeft; kortet (buildDailyDecision) viser de foerste tre", () => {
  const rows: Record<string, Row> = {};
  for (const [i, id] of ["a", "b", "c", "d", "e"].entries()) rows[id] = { fatigue: 90 - i, risk: 0.3 };
  const input = {
    riderIds: Object.keys(rows),
    condition: (id: string) => rows[id],
    isRacing: () => false,
    isInjured: () => false,
    isEasyDay: () => false,
  };
  assert.equal(buildAllDecisions(input).length, 5);
  assert.deepEqual(buildDailyDecision(input).map((s) => s.riderId), ["a", "b", "c"]);
});
