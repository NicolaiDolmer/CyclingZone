// backend/lib/engine/v4/physiology.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  applyDayformToCp,
  dayformComponent,
  deriveCp,
  deriveRechargeRate,
  deriveWprimeMax,
  jourSansComponent,
  jourSansProbability,
  planSubTicks,
  tickPhysiology,
  tickPhysiologyOverSegment,
} from "./physiology.ts";
import { PHYSIOLOGY_SUBTICK_TUNING, RACE_V4_TUNING } from "./tuning.ts";
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

// ── planSubTicks + tickPhysiologyOverSegment (#4030 fixture-fund 21/8) ──────
// SSOT: tuning.ts's physiologySubTick-kommentar + physiology.ts's docblocks.
// Laaser HENSIGTEN (retning + bounded stoerrelse), ikke implementeringsdetaljer:
// (1) genopladning bliver mere gradvis end ét stort Euler-skridt over hele
// segmentet, (2) taering forbliver vaerdimaessigt UAENDRET (lineaer ODE,
// sub-tick-invariant) — kun genopladningens noejagtighed forbedres.

test("planSubTicks: mindst ét sub-tick, dtSubSeconds*count summer til dtSeconds", () => {
  const plan = planSubTicks({ dtSeconds: 3600, segmentLengthKm: 12, kmPerSubTick: 1, maxSubTicksPerSegment: 300 });
  assert.ok(plan.count >= 1);
  assert.ok(Math.abs(plan.dtSubSeconds * plan.count - 3600) < 1e-9);
});

test("planSubTicks: laengere segment giver flere (eller lige saa mange) sub-tick end et kortere, samme dtSeconds", () => {
  const short = planSubTicks({ dtSeconds: 1000, segmentLengthKm: 2, kmPerSubTick: 1, maxSubTicksPerSegment: 300 });
  const long = planSubTicks({ dtSeconds: 1000, segmentLengthKm: 20, kmPerSubTick: 1, maxSubTicksPerSegment: 300 });
  assert.ok(long.count >= short.count, `long.count=${long.count} skal vaere >= short.count=${short.count}`);
});

test("planSubTicks: clampes af maxSubTicksPerSegment (perf-/determinisme-gulv)", () => {
  const plan = planSubTicks({ dtSeconds: 100000, segmentLengthKm: 5000, kmPerSubTick: 1, maxSubTicksPerSegment: 300 });
  assert.equal(plan.count, 300);
});

test("planSubTicks: degenererer sikkert til ét sub-tick ved 0-laengde/0-varighed input (ingen NaN/deling med 0)", () => {
  assert.deepEqual(planSubTicks({ dtSeconds: 0, segmentLengthKm: 10, kmPerSubTick: 1, maxSubTicksPerSegment: 300 }), {
    count: 1,
    dtSubSeconds: 0,
  });
  assert.deepEqual(planSubTicks({ dtSeconds: 500, segmentLengthKm: 0, kmPerSubTick: 1, maxSubTicksPerSegment: 300 }), {
    count: 1,
    dtSubSeconds: 500,
  });
});

test("tickPhysiologyOverSegment: taering (demand>cp) er VAERDIMAESSIGT UAENDRET af sub-tick-antallet (lineaer ODE-invariant)", () => {
  fc.assert(
    fc.property(
      fc.record({
        cp: fc.double({ min: 0, max: 0.9, noNaN: true }),
        wprimeMax: fc.double({ min: 0.1, max: 1, noNaN: true }),
        wprimeFrac: fc.double({ min: 0, max: 1, noNaN: true }),
        demandExtra: fc.double({ min: 0.01, max: 1, noNaN: true }), // demand = cp + demandExtra > cp
        dtSeconds: fc.double({ min: 1, max: 5000, noNaN: true }),
        segmentLengthKm: fc.double({ min: 0.1, max: 250, noNaN: true }),
        rechargeRate: fc.double({ min: 0, max: 0.01, noNaN: true }),
      }),
      ({ cp, wprimeMax, wprimeFrac, demandExtra, dtSeconds, segmentLengthKm, rechargeRate }) => {
        const wprime = wprimeFrac * wprimeMax;
        const demand = cp + demandExtra;
        const single = tickPhysiology({ cp, wprimeMax, wprime, demand, dtSeconds, rechargeRate });
        const sub = tickPhysiologyOverSegment({
          cp,
          wprimeMax,
          wprime,
          demand,
          dtSeconds,
          rechargeRate,
          segmentLengthKm,
          subTick: PHYSIOLOGY_SUBTICK_TUNING,
        });
        assert.ok(Math.abs(sub.wprime - single.wprime) < 1e-9, `sub=${sub.wprime} single=${single.wprime}`);
        assert.ok(
          Math.abs(sub.secondsOverCp - single.secondsOverCp) < 1e-9,
          `sub=${sub.secondsOverCp} single=${single.secondsOverCp}`,
        );
        assert.ok(Math.abs(sub.workNorm - single.workNorm) < 1e-9);
      },
    ),
    { numRuns: 200 },
  );
});

test("tickPhysiologyOverSegment: genopladning (demand<=cp) er MERE FORSIGTIG (naermere start-vaerdien) end ét stort Euler-skridt, naar skridtet er langt", () => {
  // Stort dtSeconds (typisk et rigtigt segment) saa ét enkelt Euler-skridt
  // overskyder maalstregen (rate*dt naer/over 1) — sub-tick skal blive
  // MINDST ligesaa taet paa start-wprime (aldrig "springe" laengere end
  // ét-skridt-varianten). Konkret reproduktion af fixture-fundet 21/8.
  const args = { cp: 0.5, wprimeMax: 1, wprime: 0, demand: 0.3, dtSeconds: 1072, rechargeRate: 0.000467 };
  const single = tickPhysiology(args);
  const sub = tickPhysiologyOverSegment({ ...args, segmentLengthKm: 17, subTick: PHYSIOLOGY_SUBTICK_TUNING });
  assert.ok(sub.wprime < single.wprime, `sub.wprime=${sub.wprime} skal vaere < single.wprime=${single.wprime} (mindre "hop" mod fuld reserve)`);
  assert.ok(sub.wprime > 0, "sub-tick skal stadig genoplade NOGET, ikke blive haengende paa 0");
});

test("tickPhysiologyOverSegment: wprime forbliver ALTID i [0, wprimeMax] (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(
      fc.record({
        cp: fc.double({ min: 0, max: 1, noNaN: true }),
        wprimeMax: fc.double({ min: 0.1, max: 1, noNaN: true }),
        wprimeFrac: fc.double({ min: 0, max: 1, noNaN: true }),
        demand: fc.double({ min: 0, max: 1, noNaN: true }),
        dtSeconds: fc.double({ min: 0, max: 10000, noNaN: true }),
        segmentLengthKm: fc.double({ min: 0, max: 300, noNaN: true }),
        rechargeRate: fc.double({ min: 0, max: 0.01, noNaN: true }),
      }),
      ({ cp, wprimeMax, wprimeFrac, demand, dtSeconds, segmentLengthKm, rechargeRate }) => {
        const result = tickPhysiologyOverSegment({
          cp,
          wprimeMax,
          wprime: wprimeFrac * wprimeMax,
          demand,
          dtSeconds,
          rechargeRate,
          segmentLengthKm,
          subTick: PHYSIOLOGY_SUBTICK_TUNING,
        });
        assert.ok(result.wprime >= 0 && result.wprime <= wprimeMax + 1e-9, `wprime=${result.wprime} uden for [0,${wprimeMax}]`);
      },
    ),
    { numRuns: 200 },
  );
});

test("tickPhysiologyOverSegment: deterministisk (samme input -> samme output, gentagne kald)", () => {
  const args = {
    cp: 0.55,
    wprimeMax: 0.8,
    wprime: 0.2,
    demand: 0.35,
    dtSeconds: 900,
    rechargeRate: 0.0005,
    segmentLengthKm: 8,
    subTick: PHYSIOLOGY_SUBTICK_TUNING,
  };
  assert.deepEqual(tickPhysiologyOverSegment(args), tickPhysiologyOverSegment(args));
});
