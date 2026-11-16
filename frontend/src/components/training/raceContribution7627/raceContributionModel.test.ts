import test from "node:test";
import assert from "node:assert/strict";
import { raceSourceBreakdown, dayRaceShare } from "./raceContributionModel.ts";
import type { TrainingActivity } from "../../../lib/trainingDailyReceipt.ts";

// #7627: invented riders and numbers, no game balance. Progress is the fraction
// of the way to the next whole point, as the receipt stores it per slot.
const slot = (kind: "training" | "race" | "rest", before: Record<string, number>, after: Record<string, number>,
  gains: Record<string, number> = {}): TrainingActivity => ({
  rider_id: "r1", race_day: kind === "race", intensity: kind === "rest" ? "rest" : "normal",
  focus: kind === "training" ? "climbing" : null, progress_before: before, progress_after: after, gains,
});

test("#7627 splits each ability into training and race, and the parts add up to the total", () => {
  const b = raceSourceBreakdown([
    slot("training", { climbing: 0.6, endurance: 0.2 }, { climbing: 0.8, endurance: 0.3 }),
    slot("race", { climbing: 0.8, endurance: 0.3, punch: 0.1 }, { climbing: 0.9, endurance: 0.5, punch: 0.36 }),
  ], { gains: {} })!;
  assert.deepEqual(b.rows.map(r => [r.key, r.training, r.race, r.total, r.whole]), [
    ["climbing", 20, 10, 30, 0], ["punch", 0, 26, 26, 0], ["endurance", 10, 20, 30, 0],
  ]);
  assert.equal(b.showTraining, true);
  assert.equal(b.showRace, true);
  for (const row of b.rows) assert.equal(row.training + row.race, row.total);
});

test("#7627 an ability that lands a whole point counts the crossing and is marked whole", () => {
  const b = raceSourceBreakdown([
    slot("training", { climbing: 0.6 }, { climbing: 0.95 }),
    slot("race", { climbing: 0.95 }, { climbing: 0.2 }, { climbing: 1 }),
  ], { gains: { climbing: 1 } })!;
  assert.deepEqual(b.rows, [{ key: "climbing", training: 35, race: 25, total: 60, whole: 1 }]);
});

test("#7627 a point that has not landed never reads as 100 %", () => {
  const b = raceSourceBreakdown([
    slot("training", { sprint: 0.004 }, { sprint: 0.5 }),
    slot("race", { sprint: 0.5 }, { sprint: 0.9999 }),
  ], { gains: {} })!;
  assert.equal(b.rows[0].total, 99);
  assert.equal(b.rows[0].training + b.rows[0].race, 99);
});

test("#7627 a rider without a race on the date shows training only, no race column", () => {
  const b = raceSourceBreakdown([
    slot("training", { recovery: 0.3 }, { recovery: 0.42 }),
    slot("training", { recovery: 0.42 }, { recovery: 0.53 }),
  ], { gains: {} })!;
  assert.equal(b.showRace, false);
  assert.equal(b.showTraining, true);
  assert.deepEqual(b.rows, [{ key: "recovery", training: 23, race: 0, total: 23, whole: 0 }]);
  assert.equal(b.raceRaw, 0);
});

test("#7627 a rider who only raced shows the race column only", () => {
  const b = raceSourceBreakdown([
    slot("race", { sprint: 0.85, acceleration: 0.4 }, { sprint: 0.94, acceleration: 0.5 }),
    slot("race", { sprint: 0.94, acceleration: 0.5 }, { sprint: 0.02, acceleration: 0.59 }, { sprint: 1 }),
  ], { gains: { sprint: 1 } })!;
  assert.equal(b.showTraining, false);
  assert.equal(b.showRace, true);
  assert.deepEqual(b.rows.map(r => [r.key, r.training, r.race, r.whole]), [["sprint", 0, 17, 1], ["acceleration", 0, 19, 0]]);
});

test("#7627 a rest day beside a race does not open an empty training column", () => {
  const b = raceSourceBreakdown([
    slot("rest", { tactics: 0.5 }, { tactics: 0.5 }),
    slot("race", { tactics: 0.5 }, { tactics: 0.6 }),
  ], { gains: {} })!;
  assert.equal(b.showTraining, false);
  assert.equal(b.rows[0].race, 10);
});

test("#7627 two races on one date add up in the race column", () => {
  const b = raceSourceBreakdown([
    slot("training", { punch: 0.1 }, { punch: 0.2 }),
    slot("race", { punch: 0.2 }, { punch: 0.34 }),
    slot("race", { punch: 0.34 }, { punch: 0.46 }),
  ], { gains: {} })!;
  assert.deepEqual(b.rows, [{ key: "punch", training: 10, race: 26, total: 36, whole: 0 }]);
});

test("#7627 sparse maps: an ability absent from a stored snapshot starts at zero", () => {
  const b = raceSourceBreakdown([
    slot("race", {}, { punch: 0.14 }),
  ], { gains: {} })!;
  assert.deepEqual(b.rows, [{ key: "punch", training: 0, race: 14, total: 14, whole: 0 }]);
});

test("#7627 a slot without its own end point leaves the split unknown, never guessed", () => {
  const missing = { ...slot("race", { punch: 0.1 }, {}), progress_after: undefined };
  assert.equal(raceSourceBreakdown([slot("training", { punch: 0 }, { punch: 0.1 }), missing], { gains: {} }), null);
  assert.equal(raceSourceBreakdown([], { gains: {} }), null);
});

test("#7627 a source never shows a loss: the report has no penalty to tell", () => {
  const b = raceSourceBreakdown([
    slot("training", { climbing: 0.3 }, { climbing: 0.5 }),
    slot("race", { climbing: 0.5 }, { climbing: 0.45 }),
  ], { gains: {} })!;
  assert.equal(b.rows[0].race, 0);
  assert.ok(b.rows.every(r => r.training >= 0 && r.race >= 0));
});

test("#7627 the day strip: share of the squad's progress that came from races", () => {
  const a = raceSourceBreakdown([
    slot("training", { climbing: 0.6 }, { climbing: 0.9 }),
    slot("race", { climbing: 0.9, punch: 0 }, { climbing: 0.95, punch: 0.15 }),
  ], { gains: {} });
  const b = raceSourceBreakdown([slot("race", { sprint: 0.1 }, { sprint: 0.4 })], { gains: {} });
  const c = raceSourceBreakdown([slot("training", { recovery: 0.2 }, { recovery: 0.7 })], { gains: {} });
  // race 0.05 + 0.15 + 0.3 = 0.5 of 0.3 + 0.5 + 0.5 = 1.3 in all
  assert.equal(dayRaceShare([a, b, c]), 38);
});

test("#7627 the day strip only shows when the squad raced, and never on unknown splits", () => {
  const training = raceSourceBreakdown([slot("training", { recovery: 0.2 }, { recovery: 0.7 })], { gains: {} });
  const race = raceSourceBreakdown([slot("race", { sprint: 0.1 }, { sprint: 0.4 })], { gains: {} });
  assert.equal(dayRaceShare([training]), null);
  assert.equal(dayRaceShare([]), null);
  assert.equal(dayRaceShare([race, null]), null);
  assert.equal(dayRaceShare([raceSourceBreakdown([slot("race", { sprint: 0.1 }, { sprint: 0.1 })], { gains: {} })]), null);
  assert.equal(dayRaceShare([race]), 100);
});

test("#7627 the day strip never rounds a source away", () => {
  const big = raceSourceBreakdown([slot("race", { sprint: 0 }, { sprint: 0.999 })], { gains: {} });
  const sliver = raceSourceBreakdown([slot("training", { sprint: 0 }, { sprint: 0.001 })], { gains: {} });
  assert.equal(dayRaceShare([big, sliver]), 99);
  const tiny = raceSourceBreakdown([slot("race", { sprint: 0 }, { sprint: 0.001 })], { gains: {} });
  const lots = raceSourceBreakdown([slot("training", { sprint: 0 }, { sprint: 0.999 })], { gains: {} });
  assert.equal(dayRaceShare([tiny, lots]), 1);
});
