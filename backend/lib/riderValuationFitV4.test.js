import test from "node:test";
import assert from "node:assert/strict";

import { fitProductionModel, predictProductionLn, FLOOR } from "./riderValuationFitV4.js";
import { blendedOutput } from "./riderValuation.js";

// ── Syntetisk fixture ────────────────────────────────────────────────────────
// 13 ability-nøgler (riderTypes.js ABILITY_KEYS). For sprinter/climber sættes de
// 4 positiv-vægtede speciale-abilities til 50+s (uniform → outputScore = 50+s
// præcist, uafhængigt af de interne vægte) og de øvrige 9 til 50+m. Det giver
// O(alpha) = alpha·(50+s) + (1-alpha)·(50+(4s+9m)/13) — en alpha-afhængig blanding
// af to UAFHÆNGIGE akser (s, m), så forskellige alpha-valg reelt giver forskellig
// forklaringskraft (ingen alpha-invarians-degenerering).
const ALL13 = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration",
  "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "aggression",
];
const SPEC = {
  sprinter: ["acceleration", "sprint", "flat", "durability"],
  climber: ["climbing", "tempo", "punch", "endurance"],
};

function mkAbilities(type, s, m) {
  const spec = SPEC[type];
  const ab = {};
  for (const k of ALL13) ab[k] = spec.includes(k) ? 50 + s : 50 + m;
  return ab;
}

// (s, m)-par: ikke-kollineære (forskellige s/m-forhold), holder abilities i [20,80].
const POINTS = [
  [0, 0], [20, -10], [-15, 25], [10, 10], [-20, -20],
  [30, 5], [15, -25], [-10, -5], [5, 20], [-25, 15],
];

// Bygger samples for to typer ud fra en kendt "sandheds"-model
// (a0,b0,c0,offset0,trueAlpha) — INGEN støj, så fittet kan verificeres eksakt.
function buildSyntheticSamples({ trueAlpha, a0, b0, c0, offset0 }) {
  const samples = [];
  for (const type of Object.keys(SPEC)) {
    for (const [s, m] of POINTS) {
      const abilities = mkAbilities(type, s, m);
      const O = blendedOutput(abilities, type, trueAlpha);
      const y = a0 + b0 * O + c0 * O * O + (offset0?.[type] ?? 0);
      samples.push({ primary_type: type, abilities, e_prize: Math.exp(y) });
    }
  }
  return samples;
}

const TRUTH = { trueAlpha: 0.5, a0: 7, b0: 0.05, c0: 0.0003, offset0: { sprinter: 0.2, climber: -0.2 } };
const TOL = 1e-6;

test("fitProductionModel vælger den alpha der genererede data (grid-search over log-R²)", () => {
  const samples = buildSyntheticSamples(TRUTH);
  const fit = fitProductionModel(samples, { alphaGrid: [0, 0.25, 0.5, 0.75, 1] });
  assert.equal(fit.alpha, TRUTH.trueAlpha, `valgt alpha=${fit.alpha}, forventet ${TRUTH.trueAlpha}`);
  assert.ok(fit.r2_log > 0.999, `r2_log ~1 ved sand alpha (${fit.r2_log})`);
});

test("fitProductionModel genfinder b/c eksakt og a+offset[type] eksakt (ingen støj)", () => {
  const samples = buildSyntheticSamples(TRUTH);
  const fit = fitProductionModel(samples, { alphaGrid: [0, 0.25, 0.5, 0.75, 1] });
  assert.ok(Math.abs(fit.b - TRUTH.b0) < TOL, `b~${TRUTH.b0} (fik ${fit.b})`);
  assert.ok(Math.abs(fit.c - TRUTH.c0) < TOL, `c~${TRUTH.c0} (fik ${fit.c})`);
  // a og offset er kun jointly identificeret (a absorberer typernes fælles niveau);
  // med zero-mean offset0 (sprinter +0.2, climber -0.2) er a og offset dog hver
  // for sig eksakt genfundet.
  assert.ok(Math.abs(fit.a - TRUTH.a0) < TOL, `a~${TRUTH.a0} (fik ${fit.a})`);
  assert.ok(Math.abs(fit.offset.sprinter - TRUTH.offset0.sprinter) < TOL, `offset.sprinter (${fit.offset.sprinter})`);
  assert.ok(Math.abs(fit.offset.climber - TRUTH.offset0.climber) < TOL, `offset.climber (${fit.offset.climber})`);
  assert.equal(fit.n_samples, samples.length);
});

test("fitProductionModel: andre alpha-værdier i grid'et giver strengt lavere log-R²", () => {
  const samples = buildSyntheticSamples(TRUTH);
  const grid = [0, 0.25, 0.5, 0.75, 1];
  const r2ByAlpha = new Map();
  for (const alpha of grid) {
    const fit = fitProductionModel(samples, { alphaGrid: [alpha] });
    r2ByAlpha.set(alpha, fit.r2_log);
  }
  const r2AtTruth = r2ByAlpha.get(TRUTH.trueAlpha);
  for (const [alpha, r2] of r2ByAlpha) {
    if (alpha === TRUTH.trueAlpha) continue;
    assert.ok(r2 < r2AtTruth - 0.01, `alpha=${alpha} r2=${r2} skal være klart under sand-alpha r2=${r2AtTruth}`);
  }
});

test("predictProductionLn reproducerer ln(e_prize) for de samples modellen blev fittet på", () => {
  const samples = buildSyntheticSamples(TRUTH);
  const fit = fitProductionModel(samples, { alphaGrid: [0, 0.25, 0.5, 0.75, 1] });
  for (const s of samples) {
    const predictedLn = predictProductionLn(s, fit);
    const targetLn = Math.log(s.e_prize);
    assert.ok(Math.abs(predictedLn - targetLn) < 1e-4, `predictProductionLn afviger (${predictedLn} vs ${targetLn})`);
  }
});

test("predictProductionLn falder tilbage til laveste fittede offset for en type UDEN samples", () => {
  const samples = buildSyntheticSamples(TRUTH);
  const fit = fitProductionModel(samples, { alphaGrid: [0.5] }); // kun sprinter+climber har offsets
  assert.ok(!("gc" in fit.offset), "gc har ingen samples i fixturen");
  const floorOffset = Math.min(...Object.values(fit.offset));
  const abilities = mkAbilities("sprinter", 10, 10); // vilkårlige, gyldige abilities
  const lnWithFallback = predictProductionLn({ abilities, primary_type: "gc" }, fit);
  const O = blendedOutput(abilities, "gc", fit.alpha);
  const expected = fit.a + fit.b * O + fit.c * O * O + floorOffset;
  assert.ok(Math.abs(lnWithFallback - expected) < TOL, `fallback til laveste offset (${lnWithFallback} vs ${expected})`);
});

test("FLOOR: e_prize=0 floores til 1 før log (ln(0)=-Infinity undgås, ikke NaN/Infinity i fit)", () => {
  const samples = buildSyntheticSamples(TRUTH);
  samples[0] = { ...samples[0], e_prize: 0 };
  samples[1] = { ...samples[1], e_prize: -5 }; // defensivt: negativ skal også floores
  const fit = fitProductionModel(samples, { alphaGrid: [0, 0.5, 1] });
  assert.ok(Number.isFinite(fit.a) && Number.isFinite(fit.b) && Number.isFinite(fit.c), "koefficienter er finite");
  assert.ok(Number.isFinite(fit.r2_log), "r2_log er finite");
  assert.equal(FLOOR, 1);
  // Den floorede sample bidrager ln(1)=0 til y — ikke -Infinity.
  const predicted = predictProductionLn(samples[0], fit);
  assert.ok(Number.isFinite(predicted));
});

test("fitProductionModel kaster ved for få samples", () => {
  assert.throws(() => fitProductionModel([{ primary_type: "sprinter", abilities: {}, e_prize: 100 }]));
});

test("fitProductionModel kaster ved tom alphaGrid", () => {
  const samples = buildSyntheticSamples(TRUTH);
  assert.throws(() => fitProductionModel(samples, { alphaGrid: [] }));
});
