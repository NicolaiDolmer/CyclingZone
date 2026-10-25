// #6950 + #3564: Udviklingsscore B og kurve B taendt samtidig.
//
// Arbejdsdelingen: kurve B bestemmer HVOR MEGET et point koster (basis-fremdriften:
// niveau, blødt loft, belastningsevne). Udviklingsscore B er DAGENS KVALITETSLED
// (rytter-leddet, devMult). Under begge er scorens devMult rytter-leddet; kurvens
// alders-neutrale traeningsscore bruges ikke, og traeneren ganges ikke pr. evne.
//
// Kurve B lander i PR #7184 (modul + dailyTraining.js). Indtil den er merget,
// springes testene over; de aktiveres af sig selv, naar developmentCurveB.ts findes.
// Syntetiske tal (hard rule 17).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { applyDailyTick } from "./dailyTraining.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { validateDevelopmentScoreWiringParams, developmentTickArgs } from "./developmentScoreWiring.js";
import { SCORE_PARAMS } from "./developmentScoreWiring.fixtures.js";

const CURVE_B_MODULE = new URL("./developmentCurveB.ts", import.meta.url);
const hasCurveB = existsSync(CURVE_B_MODULE);
const skip = hasCurveB ? false : "kurve B (#7184) er ikke merget endnu";

const CURVE_B_RAW = {
  rate: 10, levelExponent: 2, capExponent: 0.5,
  load: { fromAge: 16, fullAge: 24, floor: 0.5 },
  potentialCeiling: [0.5, 0.6, 0.7, 0.8, 0.9, 1],
};

async function curveBParams() {
  const mod = await import(CURVE_B_MODULE.href);
  const params = mod.validateDevelopmentCurveBParams(CURVE_B_RAW);
  assert.ok(params, "syntetiske kurve-params er gyldige");
  return params;
}

const TICK = Object.freeze({
  riderId: "r1", dateStr: "2026-06-12", age: 19,
  abilities: Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 40])),
  caps: Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 85])),
  progress: {}, program: { focus: "vo2max", intensity: "hard" }, conditionMult: 0.9, potentiale: 4,
  primaryType: "climber", secondaryType: null, staff: null, facilityTier: null, riderLevel: "senior",
});

const progressSum = (r) => VISIBLE_ABILITIES.reduce((s, k) => s + Number(r.progress[k] ?? 0) + Number(r.gains[k] ?? 0), 0);

test("#6950 + #3564: scoren er kvalitetsleddet under kurve B (dobbelt devMult = dobbelt fremdrift)", { skip }, async () => {
  const curveB = await curveBParams();
  // Smaa devMult, saa ingen evne naar et helt point, og fremdriften kan sammenlignes direkte.
  const day = { score: 55, devMult: 0.01, kind: "training" };
  const one = applyDailyTick({ ...TICK, curveB, developmentScore: day });
  const two = applyDailyTick({ ...TICK, curveB, developmentScore: { ...day, devMult: 0.02 } });
  assert.deepEqual(two.gains, {});
  assert.ok(progressSum(one) > 0, "forudsaetning: der er fremdrift");
  for (const k of VISIBLE_ABILITIES) {
    assert.ok(Math.abs((two.progress[k] ?? 0) - 2 * (one.progress[k] ?? 0)) < 1e-12, k);
  }
});

test("#6950 + #3564: kurven bestemmer basis; scoren alene og kurven alene giver hver deres udvikling", { skip }, async () => {
  const curveB = await curveBParams();
  const day = { score: 55, devMult: 1, kind: "training" };
  const both = applyDailyTick({ ...TICK, curveB, developmentScore: day });
  const scoreOnly = applyDailyTick({ ...TICK, developmentScore: day });
  const curveOnly = applyDailyTick({ ...TICK, curveB });
  assert.notDeepEqual(both.progress, scoreOnly.progress, "kurven aendrer basis under scoren");
  assert.notDeepEqual(both.progress, curveOnly.progress, "scoren aendrer kvalitetsleddet under kurven");
  assert.equal(both.trainingScore.score, 55, "det viste tal er scorens, ogsaa under kurven");
  assert.equal(both.trainingScore.contributions, null);
});

test("#6950 + #3564: kondition og alder roerer ikke kvalitetsleddet under begge (S29)", { skip }, async () => {
  const curveB = await curveBParams();
  const params = validateDevelopmentScoreWiringParams(SCORE_PARAMS);
  const args = developmentTickArgs({ developmentScoreB: params, dayKey: "d1", tickArgs: TICK });
  const a = applyDailyTick({ ...TICK, curveB, ...args });
  const b = applyDailyTick({ ...TICK, curveB, ...args, conditionMult: 0.5 });
  assert.deepEqual(a.progress, b.progress);
});
