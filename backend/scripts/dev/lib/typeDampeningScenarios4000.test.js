import test from "node:test";
import assert from "node:assert/strict";

import {
  regularizeOffset,
  regularizeOffsetTable,
  buildScenarioCatalog,
  buildScenarioModel,
  median,
  quantile,
  mean,
  pctDelta,
  normalizationFactor,
  checkTypeMonotonicity,
  OFFSET_K_VALUES,
  ALPHA_VALUES,
} from "./typeDampeningScenarios4000.mjs";
import { predictBaseValueV4 } from "../../../lib/riderCareerNpv.js";
import { VISIBLE_ABILITIES } from "../../../lib/abilityDerivation.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function fixtureModel() {
  return {
    version: 4,
    fit: {
      alpha: 1,
      a: 4.407784,
      b: 0.10097084,
      c: -0.0001198094,
      offset: {
        sprinter: -0.08007,
        tt: -0.139055,
        climber: 0.179844,
        puncheur: 2.070607,
        brostensrytter: 0.849752,
        baroudeur: 0.0269,
        rouleur: 0.029417,
        gc: 0.46318,
      },
    },
    type_stats: {
      sprinter: { n: 1190 },
      tt: { n: 2622 },
      climber: { n: 1947 },
      puncheur: { n: 19 },
      brostensrytter: { n: 59 },
      baroudeur: { n: 34 },
      rouleur: { n: 122 },
      gc: { n: 34 },
    },
    scale: 2.9779287,
    discount: 0.8,
    elite_premium: { overall_threshold: 45, k: 0.095009, floor_overall: 58, floor: 8315500 },
  };
}

// ── regularizeOffset ──────────────────────────────────────────────────────────

test("regularizeOffset: n/(n+k) vægtning — stort n ≈ urørt, lille n → 0", () => {
  // n=19 (puncheur), k=100 → vægt 19/119 ≈ 0.1597
  const damped = regularizeOffset(2.070607, 19, 100);
  assert.ok(Math.abs(damped - 2.070607 * (19 / 119)) < 1e-9);
  assert.ok(damped < 2.070607, "skal dæmpes nedad mod 0");
  assert.ok(damped > 0, "skal ikke krydse 0 for et positivt offset");
});

test("regularizeOffset: n=0 giver fuld dæmpning til 0", () => {
  assert.equal(regularizeOffset(2.0, 0, 100), 0);
});

test("regularizeOffset: k=0 giver INGEN dæmpning (vægt=1 for alle n>0)", () => {
  assert.equal(regularizeOffset(2.070607, 19, 0), 2.070607);
});

test("regularizeOffset: meget stort n er næsten urørt selv ved stort k", () => {
  const damped = regularizeOffset(-0.139055, 2622, 200);
  const ratio = damped / -0.139055;
  assert.ok(ratio > 0.9, `tt (n=2622) skal forblive >90% intakt, fik ratio ${ratio}`);
});

test("regularizeOffset: negativt offset dæmpes også MOD 0 (ikke væk fra 0)", () => {
  const damped = regularizeOffset(-0.139055, 100, 100);
  assert.ok(damped > -0.139055, "skal krybe op mod 0, ikke blive mere negativ");
  assert.ok(damped < 0, "skal forblive negativt ved moderat dæmpning");
});

test("regularizeOffsetTable: dæmper hver type efter sit EGET n, ukendt type er urørt", () => {
  const m = fixtureModel();
  const out = regularizeOffsetTable(m.fit.offset, m.type_stats, 100);
  assert.equal(Object.keys(out).length, Object.keys(m.fit.offset).length);
  // puncheur (n=19) dæmpes MERE end tt (n=2622), relativt set
  const puncheurRatio = out.puncheur / m.fit.offset.puncheur;
  const ttRatio = out.tt / m.fit.offset.tt;
  assert.ok(puncheurRatio < ttRatio, "lille-n type skal dæmpes relativt mere end stort-n type");
});

// ── buildScenarioCatalog / buildScenarioModel ────────────────────────────────

test("buildScenarioCatalog: 1 baseline + 3 offset + 3 alpha + 9 combo = 16 scenarier, unikke id'er", () => {
  const scenarios = buildScenarioCatalog();
  assert.equal(scenarios.length, 1 + OFFSET_K_VALUES.length + ALPHA_VALUES.length + OFFSET_K_VALUES.length * ALPHA_VALUES.length);
  const ids = new Set(scenarios.map((s) => s.id));
  assert.equal(ids.size, scenarios.length, "alle scenarie-id'er skal være unikke");
});

test("buildScenarioModel: baseline (offsetK=null, alpha=null) er BYTE-IDENTISK med input", () => {
  const base = fixtureModel();
  const model = buildScenarioModel(base, { offsetK: null, alpha: null });
  assert.deepEqual(model.fit.offset, base.fit.offset);
  assert.equal(model.fit.alpha, base.fit.alpha);
});

test("buildScenarioModel: MUTERER ALDRIG base-modellen (samme model bruges til flere scenarier)", () => {
  const base = fixtureModel();
  const baseOffsetBefore = JSON.stringify(base.fit.offset);
  const baseAlphaBefore = base.fit.alpha;
  buildScenarioModel(base, { offsetK: 100, alpha: 0.5 });
  assert.equal(JSON.stringify(base.fit.offset), baseOffsetBefore, "base.fit.offset må ikke muteres");
  assert.equal(base.fit.alpha, baseAlphaBefore, "base.fit.alpha må ikke muteres");
});

test("buildScenarioModel: offsetK sætter regulariseret tabel, alpha upåvirket når null", () => {
  const base = fixtureModel();
  const model = buildScenarioModel(base, { offsetK: 100, alpha: null });
  assert.equal(model.fit.alpha, base.fit.alpha);
  assert.notEqual(model.fit.offset.puncheur, base.fit.offset.puncheur);
});

test("buildScenarioModel: alpha sætter alpha, offset-tabel upåvirket når offsetK null", () => {
  const base = fixtureModel();
  const model = buildScenarioModel(base, { offsetK: null, alpha: 0.7 });
  assert.equal(model.fit.alpha, 0.7);
  assert.deepEqual(model.fit.offset, base.fit.offset);
});

test("buildScenarioModel: combo sætter BEGGE dele samtidig", () => {
  const base = fixtureModel();
  const model = buildScenarioModel(base, { offsetK: 100, alpha: 0.7 });
  assert.equal(model.fit.alpha, 0.7);
  assert.notEqual(model.fit.offset.puncheur, base.fit.offset.puncheur);
});

// ── statistik-hjælpere ────────────────────────────────────────────────────────

test("median: lige/ulige længde", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test("quantile: p10/p90 på et kendt array", () => {
  const arr = Array.from({ length: 10 }, (_, i) => i + 1); // 1..10
  assert.equal(quantile(arr, 0.9), 10);
  assert.equal(quantile(arr, 0.1), 2);
});

test("mean: simpelt snit, tomt array → null", () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(mean([]), null);
});

test("pctDelta: standard op/ned, before<=0 → null", () => {
  assert.equal(pctDelta(100, 150), 50);
  assert.equal(pctDelta(100, 56), -44);
  assert.equal(pctDelta(0, 100), null);
  assert.equal(pctDelta(-5, 100), null);
});

test("normalizationFactor: >1 når scenarie-sum er FALDET (skal skaleres OP), <1 når steget", () => {
  assert.ok(normalizationFactor(1000, 900) > 1);
  assert.ok(normalizationFactor(1000, 1100) < 1);
  assert.equal(normalizationFactor(0, 100), null);
});

// ── checkTypeMonotonicity (bruger den ÆGTE predictBaseValueV4) ───────────────

test("checkTypeMonotonicity: baseline-modellen er monoton for puncheur (høj-offset typen)", () => {
  const base = fixtureModel();
  const model = buildScenarioModel(base, {});
  const result = checkTypeMonotonicity(predictBaseValueV4, VISIBLE_ABILITIES, model, "puncheur");
  assert.equal(result.ok, true, `forventede monoton stigning, fik ${JSON.stringify(result.values)}`);
  for (let i = 1; i < result.values.length; i++) {
    assert.ok(result.values[i] > result.values[i - 1]);
  }
});

test("checkTypeMonotonicity: forbliver monoton efter offset-regularisering (offset er en KONSTANT i eksponenten, rører ikke O-hældningen)", () => {
  const base = fixtureModel();
  const model = buildScenarioModel(base, { offsetK: 50 });
  const result = checkTypeMonotonicity(predictBaseValueV4, VISIBLE_ABILITIES, model, "puncheur");
  assert.equal(result.ok, true);
});

test("checkTypeMonotonicity: forbliver monoton efter alpha-sænkning, for ALLE otte typer", () => {
  const base = fixtureModel();
  const model = buildScenarioModel(base, { alpha: 0.5 });
  for (const type of Object.keys(base.fit.offset)) {
    const result = checkTypeMonotonicity(predictBaseValueV4, VISIBLE_ABILITIES, model, type);
    assert.equal(result.ok, true, `${type} skal være monoton, fik ${JSON.stringify(result.values)}`);
  }
});

test("checkTypeMonotonicity: forbliver monoton for combo (offset+alpha), for ALLE otte typer", () => {
  const base = fixtureModel();
  const model = buildScenarioModel(base, { offsetK: 100, alpha: 0.7 });
  for (const type of Object.keys(base.fit.offset)) {
    const result = checkTypeMonotonicity(predictBaseValueV4, VISIBLE_ABILITIES, model, type);
    assert.equal(result.ok, true, `${type} skal være monoton, fik ${JSON.stringify(result.values)}`);
  }
});
