// backend/lib/engine/v4/mechanics/grupettoPace.test.ts
// #5581: grupettoen regner paa tidsgraensen — kontrakt-tests for de to rene
// funktioner i grupettoPace.ts. Udsagnene er skala-uafhaengige; tuningens
// stoerrelser er en kalibrering (tvillinge-maalingen).

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { grupettoAllowedDtSeconds, grupettoPaceFloorFactor } from "./grupettoPace.ts";
import type { GrupettoPaceTuning } from "./grupettoPace.ts";

const TUNING: GrupettoPaceTuning = { limitShare: 1, reserveForFullFloor: 0.5 };

const BASE_ARGS = {
  dtFrontSeconds: 600,
  frontElapsedSeconds: 3000,
  nominalElapsedSeconds: 3600,
  nominalTotalSeconds: 7200,
  gapSeconds: 0,
  limitFactor: 0.1,
  tuning: TUNING,
};

test("allowed-dt: ugyldige eller manglende tal giver intet krav (null)", () => {
  for (const patch of [
    { dtFrontSeconds: 0 },
    { nominalElapsedSeconds: 0 },
    { nominalTotalSeconds: 0 },
    { limitFactor: 0 },
    { gapSeconds: Number.NaN },
    { frontElapsedSeconds: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(grupettoAllowedDtSeconds({ ...BASE_ARGS, ...patch }), null, JSON.stringify(patch));
  }
});

test("allowed-dt: budgettet fordeles jaevnt over frontens rest-etape (haand-regnet eksempel)", () => {
  // Frontens tempo = (3000 + 600) / 3600 = 1 -> forventet vindertid 7200 s.
  // Rest for fronten = 7200 - 3000 = 4200 s. Budget = 0,1 x 7200 - 0 = 720 s.
  // Tilladt = 600 x (1 + 720 / 4200).
  const allowed = grupettoAllowedDtSeconds(BASE_ARGS);
  assert.ok(allowed !== null);
  assert.ok(Math.abs(allowed - 600 * (1 + 720 / 4200)) < 1e-9);
});

test("allowed-dt: et opbrugt budget kraever frontens eget tempo, aldrig hurtigere", () => {
  const allowed = grupettoAllowedDtSeconds({ ...BASE_ARGS, gapSeconds: 5000 });
  assert.equal(allowed, BASE_ARGS.dtFrontSeconds);
});

test("allowed-dt: sikkerhedsandelen strammer kravet (limitShare < 1 giver mindre tid)", () => {
  const loose = grupettoAllowedDtSeconds(BASE_ARGS)!;
  const tight = grupettoAllowedDtSeconds({ ...BASE_ARGS, tuning: { ...TUNING, limitShare: 0.5 } })!;
  assert.ok(tight < loose);
  assert.ok(tight > BASE_ARGS.dtFrontSeconds);
});

test("allowed-dt (fast-check): monotont — stoerre afstand giver mindre tid, stoerre graense giver mere, og aldrig under fronten", () => {
  fc.assert(
    fc.property(
      fc.double({ min: 1, max: 3000, noNaN: true }),
      fc.double({ min: 0, max: 20000, noNaN: true }),
      fc.double({ min: 0, max: 3000, noNaN: true }),
      fc.double({ min: 0, max: 3000, noNaN: true }),
      fc.double({ min: 0.01, max: 0.3, noNaN: true }),
      fc.double({ min: 0.01, max: 0.3, noNaN: true }),
      (dtFront, elapsed, gapA, gapB, fA, fB) => {
        const args = { ...BASE_ARGS, dtFrontSeconds: dtFront, frontElapsedSeconds: elapsed };
        const [gLo, gHi] = gapA <= gapB ? [gapA, gapB] : [gapB, gapA];
        const [fLo, fHi] = fA <= fB ? [fA, fB] : [fB, fA];
        const nearer = grupettoAllowedDtSeconds({ ...args, gapSeconds: gLo })!;
        const farther = grupettoAllowedDtSeconds({ ...args, gapSeconds: gHi })!;
        assert.ok(farther <= nearer + 1e-9);
        const strict = grupettoAllowedDtSeconds({ ...args, limitFactor: fLo })!;
        const lenient = grupettoAllowedDtSeconds({ ...args, limitFactor: fHi })!;
        assert.ok(lenient >= strict - 1e-9);
        assert.ok(farther >= dtFront - 1e-9);
      },
    ),
    { numRuns: 300, seed: 5581 },
  );
});

// En simpel, strengt faldende tidsfunktion: dt = 1000 / faktor.
const dtAt = (factor: number) => 1000 / factor;

test("gulv: grupetto-tempoet er hurtigt nok -> uaendret (ren grupetto er stadig langsommere end noedvendigt)", () => {
  assert.equal(grupettoPaceFloorFactor({ baseFactor: 0.8, dtAt, allowedDtSeconds: 1300, reserveFraction: 1, tuning: TUNING }), 0.8);
});

test("gulv: intet krav (null) eller en ugyldig/fuld faktor roerer intet", () => {
  assert.equal(grupettoPaceFloorFactor({ baseFactor: 0.8, dtAt, allowedDtSeconds: null, reserveFraction: 1, tuning: TUNING }), 0.8);
  assert.equal(grupettoPaceFloorFactor({ baseFactor: 1, dtAt, allowedDtSeconds: 900, reserveFraction: 1, tuning: TUNING }), 1);
  assert.equal(grupettoPaceFloorFactor({ baseFactor: Number.NaN, dtAt, allowedDtSeconds: 900, reserveFraction: 1, tuning: TUNING }), 1);
});

test("gulv: haever lige praecis nok til at holde kravet (med fuld reserve)", () => {
  // dt(f) <= 1100  <=>  f >= 1000/1100
  const f = grupettoPaceFloorFactor({ baseFactor: 0.8, dtAt, allowedDtSeconds: 1100, reserveFraction: 1, tuning: TUNING });
  assert.ok(f > 0.8 && f <= 1);
  assert.ok(dtAt(f) <= 1100 + 1e-6, `dt ${dtAt(f)} over kravet`);
  assert.ok(f - 1000 / 1100 < 1e-4, `faktor ${f} er mere end noedvendigt`);
});

test("gulv: kan kravet ikke naas, koerer gruppen sin fulde CP (1) — aldrig mere; han ryger saa stadig ud", () => {
  assert.equal(grupettoPaceFloorFactor({ baseFactor: 0.8, dtAt, allowedDtSeconds: 500, reserveFraction: 1, tuning: TUNING }), 1);
});

test("gulv: uden reserve kan han ikke holde det; halv taerskel giver halvdelen af loeftet", () => {
  const args = { baseFactor: 0.8, dtAt, allowedDtSeconds: 500, tuning: TUNING };
  assert.equal(grupettoPaceFloorFactor({ ...args, reserveFraction: 0 }), 0.8);
  const half = grupettoPaceFloorFactor({ ...args, reserveFraction: TUNING.reserveForFullFloor / 2 });
  assert.ok(Math.abs(half - 0.9) < 1e-9, `halv reserve-taerskel: ${half}`);
});

test("gulv (fast-check): altid i [base, 1], og ikke-faldende i reserven", () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0.05, max: 0.99, noNaN: true }),
      fc.double({ min: 100, max: 5000, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      (base, allowed, rA, rB) => {
        const [rLo, rHi] = rA <= rB ? [rA, rB] : [rB, rA];
        const lo = grupettoPaceFloorFactor({ baseFactor: base, dtAt, allowedDtSeconds: allowed, reserveFraction: rLo, tuning: TUNING });
        const hi = grupettoPaceFloorFactor({ baseFactor: base, dtAt, allowedDtSeconds: allowed, reserveFraction: rHi, tuning: TUNING });
        assert.ok(lo >= base - 1e-12 && lo <= 1 + 1e-12);
        assert.ok(hi >= lo - 1e-12);
      },
    ),
    { numRuns: 300, seed: 5581 },
  );
});
