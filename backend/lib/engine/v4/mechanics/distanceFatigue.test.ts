// backend/lib/engine/v4/mechanics/distanceFatigue.test.ts
// Kontrakt-tests + property-tests (fast-check, 200 runs, seeded) for M7
// (distance-slid). SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-
// intra-stage-design.md §4 M7 + §8 beslutning 12.
//
// Testene laaser HENSIGTEN (retning + bounded stoerrelse), ikke implementations-
// detaljer: (a) monument-draeningen er 0 foer threshold, ALDRIG faldende i km,
// og mildnes (aldrig forvaerres) af hoejere endurance; (b) condition-
// multiplikatoren er ALDRIG faldende i condition; (c) den kombinerede
// modifikator reducerer CP, forstaerker den aldrig, og er altid > 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  applyDistanceFatigueToCp,
  conditionCpMultiplier,
  DISTANCE_FATIGUE_TUNING,
  distanceFatigueCpMultiplier,
  monumentDrainFraction,
} from "./distanceFatigue.ts";

// ── Kontrakt: monument-draening ────────────────────────────────────────────

test("monumentDrainFraction: 0 foer threshold", () => {
  assert.equal(monumentDrainFraction(0, DISTANCE_FATIGUE_TUNING), 0);
  assert.equal(monumentDrainFraction(DISTANCE_FATIGUE_TUNING.monumentThresholdKm, DISTANCE_FATIGUE_TUNING), 0);
});

test("monumentDrainFraction: naar (og forbliver paa) maks efter rampen", () => {
  const { monumentThresholdKm, monumentRampKm, monumentMaxCpPenalty } = DISTANCE_FATIGUE_TUNING;
  const atRampEnd = monumentDrainFraction(monumentThresholdKm + monumentRampKm, DISTANCE_FATIGUE_TUNING);
  const wayBeyond = monumentDrainFraction(monumentThresholdKm + monumentRampKm + 500, DISTANCE_FATIGUE_TUNING);
  assert.ok(Math.abs(atRampEnd - monumentMaxCpPenalty) < 1e-9);
  assert.ok(Math.abs(wayBeyond - monumentMaxCpPenalty) < 1e-9, "draeningen maa ikke vokse ud over loftet");
});

test("monumentDrainFraction: ALDRIG faldende i km (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(fc.float({ min: 0, max: 500, noNaN: true }), fc.float({ min: 0, max: 500, noNaN: true }), (kmA, kmB) => {
      const lo = Math.min(kmA, kmB);
      const hi = Math.max(kmA, kmB);
      const drainLo = monumentDrainFraction(lo, DISTANCE_FATIGUE_TUNING);
      const drainHi = monumentDrainFraction(hi, DISTANCE_FATIGUE_TUNING);
      assert.ok(drainHi >= drainLo - 1e-9, `draening faldt: km ${lo}->${hi}, ${drainLo}->${drainHi}`);
    }),
    { numRuns: 200, seed: 4030 },
  );
});

// ── Kontrakt: distance-CP-multiplikator, endurance-mildning ───────────────

test("distanceFatigueCpMultiplier: 1 (ingen straf) foer threshold, uanset endurance", () => {
  assert.equal(distanceFatigueCpMultiplier(50, 0), 1);
  assert.equal(distanceFatigueCpMultiplier(50, 99), 1);
});

test("distanceFatigueCpMultiplier: hoejere endurance giver ALDRIG lavere (vaerre) multiplikator end lavere endurance, samme km", () => {
  const km = DISTANCE_FATIGUE_TUNING.monumentThresholdKm + DISTANCE_FATIGUE_TUNING.monumentRampKm; // fuld draening
  const weak = distanceFatigueCpMultiplier(km, 0);
  const strong = distanceFatigueCpMultiplier(km, 99);
  assert.ok(strong >= weak, `stark endurance (${strong}) skal vaere >= svag endurance (${weak}) ved samme km`);
  assert.ok(strong < 1, "selv fuld endurance skal maerke NOGET draening ved fuld rampe (mitigation < 1 i default-tuning)");
  assert.ok(weak < strong, "0-endurance skal maerke MERE draening end 99-endurance");
});

test("distanceFatigueCpMultiplier: altid i (0,1] og ALDRIG stigende i km ved fastholdt endurance (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(
      fc.float({ min: 0, max: 500, noNaN: true }),
      fc.float({ min: 0, max: 500, noNaN: true }),
      fc.integer({ min: 0, max: 99 }),
      (kmA, kmB, endurance) => {
        const lo = Math.min(kmA, kmB);
        const hi = Math.max(kmA, kmB);
        const multLo = distanceFatigueCpMultiplier(lo, endurance);
        const multHi = distanceFatigueCpMultiplier(hi, endurance);
        assert.ok(multLo > 0 && multLo <= 1);
        assert.ok(multHi > 0 && multHi <= 1);
        assert.ok(multHi <= multLo + 1e-9, `multiplikator steg: km ${lo}->${hi}, ${multLo}->${multHi}`);
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

test("distanceFatigueCpMultiplier: ALDRIG faldende i endurance ved fastholdt km (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(
      fc.float({ min: 0, max: 500, noNaN: true }),
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 99 }),
      (km, endA, endB) => {
        const lo = Math.min(endA, endB);
        const hi = Math.max(endA, endB);
        const multLo = distanceFatigueCpMultiplier(km, lo);
        const multHi = distanceFatigueCpMultiplier(km, hi);
        assert.ok(multHi >= multLo - 1e-9, `hoejere endurance gav vaerre multiplikator: ${lo}->${hi}, ${multLo}->${multHi}`);
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

// ── Kontrakt: condition-multiplikator ───────────────────────────────────────

test("conditionCpMultiplier: condition=1 => multiplikator 1 (ingen straf); condition=0 => tuning-gulvet", () => {
  assert.equal(conditionCpMultiplier(1), 1);
  assert.equal(conditionCpMultiplier(0), DISTANCE_FATIGUE_TUNING.conditionFloorMultiplier);
});

test("conditionCpMultiplier: ALDRIG faldende i condition (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(fc.float({ min: 0, max: 1, noNaN: true }), fc.float({ min: 0, max: 1, noNaN: true }), (cA, cB) => {
      const lo = Math.min(cA, cB);
      const hi = Math.max(cA, cB);
      const multLo = conditionCpMultiplier(lo);
      const multHi = conditionCpMultiplier(hi);
      assert.ok(multHi >= multLo - 1e-9, `multiplikator faldt: condition ${lo}->${hi}, ${multLo}->${multHi}`);
    }),
    { numRuns: 200, seed: 4030 },
  );
});

test("conditionCpMultiplier: ugyldig/manglende condition falder tilbage til 1 (ingen straf, defensivt)", () => {
  assert.equal(conditionCpMultiplier(Number.NaN), 1);
});

// ── Kontrakt: kombineret modifier-hook ──────────────────────────────────────

test("applyDistanceFatigueToCp: uaendret CP foer threshold ved fuld condition", () => {
  const cp = applyDistanceFatigueToCp(0.7, { kmSoFar: 10, enduranceAbility: 50, condition: 1 });
  assert.ok(Math.abs(cp - 0.7) < 1e-9);
});

test("applyDistanceFatigueToCp: reducerer ALDRIG negativt, og forstaerker ALDRIG CP'en", () => {
  fc.assert(
    fc.property(
      fc.float({ min: 0, max: Math.fround(1.2), noNaN: true }),
      fc.integer({ min: 0, max: 500 }),
      fc.integer({ min: 0, max: 99 }),
      fc.float({ min: 0, max: 1, noNaN: true }),
      (baseCp, km, endurance, condition) => {
        const cp = applyDistanceFatigueToCp(baseCp, { kmSoFar: km, enduranceAbility: endurance, condition });
        assert.ok(cp >= 0, `CP blev negativ: ${cp}`);
        assert.ok(cp <= baseCp + 1e-9, `CP blev FORSTAERKET (${cp} > ${baseCp}) — slid maa aldrig give ekstra energi`);
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

test("applyDistanceFatigueToCp: en 250 km+ etape straffer en 0-condition rytter mere end en frisk rytter ved samme evner", () => {
  const km = 260;
  const freshCp = applyDistanceFatigueToCp(0.7, { kmSoFar: km, enduranceAbility: 50, condition: 1 });
  const wornCp = applyDistanceFatigueToCp(0.7, { kmSoFar: km, enduranceAbility: 50, condition: 0 });
  assert.ok(wornCp < freshCp, `udslidt rytter (${wornCp}) skal have lavere CP end frisk rytter (${freshCp})`);
});

test("determinisme: samme input giver byte-identisk resultat", () => {
  const args = { kmSoFar: 245, enduranceAbility: 72, condition: 0.6 };
  assert.equal(applyDistanceFatigueToCp(0.65, args), applyDistanceFatigueToCp(0.65, args));
});
