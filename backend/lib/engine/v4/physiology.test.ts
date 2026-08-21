// backend/lib/engine/v4/physiology.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyDayformToCp,
  dayformComponent,
  deriveCp,
  deriveRechargeRate,
  deriveWprimeMax,
  jourSansComponent,
  jourSansProbability,
  tickPhysiology,
} from "./physiology.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey } from "./types.ts";

function abilities(overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const base: Record<AbilityKey, number> = {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
  return { ...base, ...overrides };
}

test("deriveCp: klatre-bonus gaelder KUN paa climb, tt-bonus KUN paa flat", () => {
  const a = abilities({ tempo: 99, endurance: 0, climbing: 99, time_trial: 99 });
  const weights = RACE_V4_TUNING.physiology.cpWeights;
  const cpFlat = deriveCp(a, "flat", weights);
  const cpClimb = deriveCp(a, "climb", weights);
  const cpRolling = deriveCp(a, "rolling", weights);
  assert.ok(cpClimb > cpRolling, "climb skal faa climbSpec-bonus, rolling ikke");
  assert.ok(cpFlat > cpRolling, "flat skal faa tt-bonus, rolling ikke");
});

test("deriveCp: 0-abilities giver cp=0, max-abilities giver cp<=vaegtsum", () => {
  const zero = abilities({ tempo: 0, endurance: 0, climbing: 0, time_trial: 0 });
  assert.equal(deriveCp(zero, "climb", RACE_V4_TUNING.physiology.cpWeights), 0);

  const max = abilities({ tempo: 99, endurance: 99, climbing: 99, time_trial: 99 });
  const w = RACE_V4_TUNING.physiology.cpWeights;
  const expectedMaxClimb = w.tempo + w.endurance + w.climbSpec;
  assert.ok(Math.abs(deriveCp(max, "climb", w) - expectedMaxClimb) < 1e-9);
});

test("deriveWprimeMax: monotont stigende med punch/accel/sprint", () => {
  const w = RACE_V4_TUNING.physiology.wprimeWeights;
  const low = deriveWprimeMax(abilities({ punch: 10, acceleration: 10, sprint: 10 }), w);
  const high = deriveWprimeMax(abilities({ punch: 90, acceleration: 90, sprint: 90 }), w);
  assert.ok(high > low);
});

test("deriveRechargeRate: recovery=0 giver gulv-fraktionen, recovery=99 giver naesten fuld rate", () => {
  const t = RACE_V4_TUNING.physiology;
  const zero = deriveRechargeRate(abilities({ recovery: 0 }), t);
  const max = deriveRechargeRate(abilities({ recovery: 99 }), t);
  assert.ok(Math.abs(zero - t.rechargeRateBase * t.recoveryFloorFraction) < 1e-9);
  assert.ok(max > zero);
  assert.ok(max <= t.rechargeRateBase + 1e-9);
});

test("tickPhysiology: demand>cp taerer W', demand<=cp genoplader mod wprimeMax", () => {
  const wear = tickPhysiology({ cp: 0.5, wprimeMax: 1, wprime: 0.8, demand: 0.9, dtSeconds: 10, rechargeRate: 0.01 });
  assert.ok(wear.wprime < 0.8, "over CP skal taere W'");
  assert.equal(wear.secondsOverCp, 10);

  const recharge = tickPhysiology({ cp: 0.5, wprimeMax: 1, wprime: 0.3, demand: 0.2, dtSeconds: 10, rechargeRate: 0.01 });
  assert.ok(recharge.wprime > 0.3, "under CP skal genoplade");
  assert.equal(recharge.secondsOverCp, 0);
});

test("tickPhysiology: W' clampes til [0, wprimeMax]", () => {
  const depleted = tickPhysiology({ cp: 0, wprimeMax: 1, wprime: 0.05, demand: 10, dtSeconds: 100, rechargeRate: 0.01 });
  assert.equal(depleted.wprime, 0);

  const saturated = tickPhysiology({ cp: 1, wprimeMax: 1, wprime: 0.99, demand: 0, dtSeconds: 1000, rechargeRate: 1 });
  assert.equal(saturated.wprime, 1);
});

test("dayformComponent: deterministisk pr. (seed, riderId), symmetrisk fordeling om 0 over mange ryttere", () => {
  const a = dayformComponent({ seed: "stage-1", riderId: "r1", tuning: RACE_V4_TUNING.dayform });
  const aAgen = dayformComponent({ seed: "stage-1", riderId: "r1", tuning: RACE_V4_TUNING.dayform });
  assert.equal(a, aAgen);

  const samples = Array.from({ length: 1000 }, (_, i) =>
    dayformComponent({ seed: "stage-1", riderId: `rider-${i}`, tuning: RACE_V4_TUNING.dayform }),
  );
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  assert.ok(Math.abs(mean) < 0.01, `mean=${mean} skal vaere naer 0`);
});

test("jourSansProbability: lav form => hoejere p end hoej form; manglende form => base", () => {
  const t = RACE_V4_TUNING.dayform;
  const pLow = jourSansProbability(10, t);
  const pHigh = jourSansProbability(90, t);
  const pMissing = jourSansProbability(null, t);
  assert.ok(pLow > pHigh);
  assert.equal(pMissing, t.jourSansPBase);
});

test("jourSansComponent: 0 langt de fleste gange, altid <= 0 naar den rammer", () => {
  let hits = 0;
  for (let i = 0; i < 500; i++) {
    const v = jourSansComponent({ seed: "stage-x", riderId: `r${i}`, form: null, tuning: RACE_V4_TUNING.dayform });
    assert.ok(v <= 0);
    if (v !== 0) hits++;
  }
  // base-rate ~3% => forventet ~15 hits ud af 500, tillad rundhaandet baand.
  assert.ok(hits > 0 && hits < 100, `hits=${hits}`);
});

test("applyDayformToCp: gulv 0, aldrig negativ", () => {
  assert.equal(applyDayformToCp(0.1, -0.5, -0.2), 0);
  assert.ok(Math.abs(applyDayformToCp(0.5, 0.1, -0.05) - 0.55) < 1e-9);
});
