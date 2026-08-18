import test from "node:test";
import assert from "node:assert/strict";

import { scoutPrecisionInfo, CEIL_HALF_WIDTH_BY_LEVEL } from "./scoutingReport.js";

// #3671 — regressionsbevis for det RELATIVE gulv (scoutEngine.scoutHalfWidth).
//
// Før: minHalfWidthByScoutRating var en ABSOLUT konstant (5,0 ved overall 40),
// level-UAFHÆNGIG. Med basis [9,6,4,3] klippede den niveau 2 OG 3 ned til
// nøjagtig 5,0 for enhver spejder under overall 60 — altså for 150 af 203
// menneskehold (default-spejder, overall 40, ingen chefscout). scoutPrecisionInfo
// er den funktion der oversætter det til noget spilleren og knappen kan bruge:
// hvad køber NÆSTE niveau helt konkret. Disse tests holder fast at defekten er
// væk for præcis den gruppe der blev ramt.
const MAX_LEVEL = CEIL_HALF_WIDTH_BY_LEVEL.length - 1; // 3

test("#3671: default-spejder (overall 40, 150/203 hold) — niveau 2→3 køber MÅLBART, ikke nul", () => {
  const info = scoutPrecisionInfo(2, MAX_LEVEL, { overall: 40 });
  assert.ok(
    info.nextGain > 0,
    `niveau 2→3 købte ${info.nextGain} for default-spejderen — det var præcis #3671-defekten`,
  );
  // MIN_USEFUL_GAIN i scoutingReport.js — under denne er gevinsten usynlig i
  // den afrundede UI, uanset hvad knappen lover.
  assert.ok(
    info.nextGain >= 0.25,
    `niveau 2→3 gav kun ${info.nextGain} point — under UI-opløsningen (0,25)`,
  );
  assert.equal(info.nextLevelIsUseless, false, "default-spejderen skal IKKE længere flagges 'ubrugelig' på niveau 3");
  assert.notEqual(
    info.halfWidth, info.nextHalfWidth,
    "niveau 2 og 3 må ikke give samme halvbredde — det var netop symptomet (bit-identisk gulv)",
  );
});

test("#3671: niveau 3 er en selvstændig værdi, ikke en kopi af niveau 2, for hele scout-spektret", () => {
  for (const overall of [40, 48, 55, 59, 70, 85, 99]) {
    const atLevel2 = scoutPrecisionInfo(2, MAX_LEVEL, { overall });
    const atLevel3 = scoutPrecisionInfo(3, MAX_LEVEL, { overall });
    assert.notEqual(
      atLevel2.halfWidth, atLevel3.halfWidth,
      `spejder overall ${overall}: niveau 2 (${atLevel2.halfWidth}) == niveau 3 (${atLevel3.halfWidth})`,
    );
  }
});

test("#3671: over hele spejder-spektret er der intet niveau der køber under UI-opløsningen", () => {
  // Ejerens 14/8-måling: 0 af 180 kombinationer (overall 40-99 × niveau 0-2)
  // under 0,25 point. Stikprøve her, ikke fuld 180-kombinations-sweep.
  for (let overall = 40; overall <= 99; overall += 3) {
    for (let level = 0; level < MAX_LEVEL; level += 1) {
      const info = scoutPrecisionInfo(level, MAX_LEVEL, { overall });
      assert.ok(
        !info.nextLevelIsUseless,
        `overall ${overall}, niveau ${level}→${level + 1}: flagget ubrugelig (gevinst ${info.nextGain})`,
      );
    }
  }
});

test("scoutPrecisionInfo: ved max niveau er der intet næste at købe", () => {
  const info = scoutPrecisionInfo(MAX_LEVEL, MAX_LEVEL, { overall: 40 });
  assert.equal(info.nextHalfWidth, null);
  assert.equal(info.nextGain, 0);
  assert.equal(info.nextLevelIsUseless, false, "intet næste niveau er ikke det samme som et ubrugeligt næste niveau");
});

test("scoutPrecisionInfo: maxUsefulLevel dækker alle niveauer efter #3671-fixet, for enhver spejder", () => {
  for (const overall of [40, 48, 55, 70, 85, 99]) {
    const info = scoutPrecisionInfo(0, MAX_LEVEL, { overall });
    assert.equal(
      info.maxUsefulLevel, MAX_LEVEL,
      `spejder overall ${overall}: maxUsefulLevel ${info.maxUsefulLevel} < ${MAX_LEVEL} — mindst ét niveau køber stadig for lidt`,
    );
  }
});

test("scoutPrecisionInfo: DEFAULT_SCOUT bruges når intet scout gives", () => {
  const withDefault = scoutPrecisionInfo(2, MAX_LEVEL);
  const explicit = scoutPrecisionInfo(2, MAX_LEVEL, { overall: 40 });
  assert.deepEqual(withDefault, explicit);
});
