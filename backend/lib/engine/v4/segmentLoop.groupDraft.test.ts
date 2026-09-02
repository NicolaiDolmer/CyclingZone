// backend/lib/engine/v4/segmentLoop.groupDraft.test.ts
// #4604: property-tests for M1's gruppe-lae-fart-gevinst (groupDraftSpeedGain).
//
// Baggrund: gruppe-hastigheden blev udelukkende afledt af gruppens staerkeste
// ryttere UDEN noget stoerrelses-led, saa en solo elite-rytter var hurtigere
// end en 180-mands peloton og ethvert forspring voksede monotont. Se
// tuning.ts's GROUP_DRAFT_EXTRA_TUNING-kommentar for maalingen bag.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { groupDraftSpeedGain } from "./segmentLoop.ts";
import { GROUP_DRAFT_EXTRA_TUNING, RACE_V4_TUNING } from "./tuning.ts";
import type { SegmentKind } from "./types.ts";

const KINDS: SegmentKind[] = ["flat", "rolling", "climb", "descent", "cobbles"];

test("#4604 solo-rytter faar aldrig laegevinst", () => {
  for (const kind of KINDS) {
    assert.equal(groupDraftSpeedGain(1, kind, RACE_V4_TUNING), 0, `${kind}: én rytter => ingen gevinst`);
    assert.equal(groupDraftSpeedGain(0, kind, RACE_V4_TUNING), 0, `${kind}: tom gruppe => ingen gevinst`);
    assert.equal(groupDraftSpeedGain(Number.NaN, kind, RACE_V4_TUNING), 0, `${kind}: NaN => ingen gevinst`);
  }
});

test("#4604 gevinsten er monotont ikke-faldende i gruppestoerrelse og bounded", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 400 }),
      fc.integer({ min: 1, max: 400 }),
      fc.constantFrom(...KINDS),
      (a, b, kind) => {
        const [small, large] = a <= b ? [a, b] : [b, a];
        const gainSmall = groupDraftSpeedGain(small, kind, RACE_V4_TUNING);
        const gainLarge = groupDraftSpeedGain(large, kind, RACE_V4_TUNING);
        assert.ok(gainLarge >= gainSmall - 1e-12, "stoerre gruppe maa aldrig give mindre laegevinst");
        assert.ok(gainLarge >= 0, "gevinsten er aldrig negativ");
        assert.ok(
          gainLarge <= GROUP_DRAFT_EXTRA_TUNING.maxSpeedGain + 1e-12,
          "gevinsten overstiger aldrig loftet",
        );
      },
    ),
    { numRuns: 300 },
  );
});

test("#4604 gevinsten foelger hjul-rabattens terraen-rangorden: stoerst paa flad, mindst op ad bakke", () => {
  const n = 150;
  const flat = groupDraftSpeedGain(n, "flat", RACE_V4_TUNING);
  const rolling = groupDraftSpeedGain(n, "rolling", RACE_V4_TUNING);
  const descent = groupDraftSpeedGain(n, "descent", RACE_V4_TUNING);
  const cobbles = groupDraftSpeedGain(n, "cobbles", RACE_V4_TUNING);
  const climb = groupDraftSpeedGain(n, "climb", RACE_V4_TUNING);

  assert.ok(flat > rolling, "flad har hoejere hjul-rabat end rolling => stoerre laegevinst");
  assert.ok(rolling > descent, "rolling over nedkoersel");
  assert.ok(descent > cobbles, "nedkoersel over brosten");
  assert.ok(cobbles > climb, "brosten over klatring");
  assert.ok(climb > 0, "selv op ad bakke er der en (lille) gevinst ved at koere i en gruppe");
});

test("#4604 en peloton er hurtigere end en solo-rytter med samme kollektive CP", () => {
  // Selve regressionen: FOER fixet var de to identiske, saa et solo-forspring
  // paa flad vej voksede uden nogen modkraft.
  const peloton = groupDraftSpeedGain(180, "flat", RACE_V4_TUNING);
  const solo = groupDraftSpeedGain(1, "flat", RACE_V4_TUNING);
  assert.ok(peloton > solo, "180 ryttere skal have maalbar fordel over én");
  assert.ok(peloton > 0.02, "fordelen skal vaere stor nok til reelt at lukke et forspring");
});
