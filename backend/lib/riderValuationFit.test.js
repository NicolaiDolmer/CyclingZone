import test from "node:test";
import assert from "node:assert/strict";

import { olsSolve, fitValuationModel, checkAnchorOrdering } from "./riderValuationFit.js";

test("olsSolve løser y=2x eksakt", () => {
  const beta = olsSolve([[1, 1], [1, 2], [1, 3]], [2, 4, 6]);
  assert.ok(Math.abs(beta[0]) < 1e-9, `intercept ~0 (${beta[0]})`);
  assert.ok(Math.abs(beta[1] - 2) < 1e-9, `hældning ~2 (${beta[1]})`);
});

test("olsSolve genfinder et kvadratisk polynomium eksakt", () => {
  const f = (x) => 1 + 2 * x + 0.5 * x * x;
  const xs = [1, 2, 3, 5, 8];
  const beta = olsSolve(xs.map((x) => [1, x, x * x]), xs.map(f));
  assert.ok(
    Math.abs(beta[0] - 1) < 1e-9 && Math.abs(beta[1] - 2) < 1e-9 && Math.abs(beta[2] - 0.5) < 1e-9,
    `beta=[1,2,0.5] (${beta})`
  );
});

test("fitValuationModel rammer syntetiske anchors perfekt når data følger modellen", () => {
  const mk = (type, output) => ({
    name: `${type}-${output}`, type, output,
    target: Math.exp(2 + 0.1 * output + 0.001 * output ** 2 + (type === "gc" ? 0.3 : -0.3)),
  });
  const anchors = [mk("gc", 60), mk("gc", 70), mk("gc", 90), mk("tt", 55), mk("tt", 75), mk("tt", 85)];
  const fit = fitValuationModel(anchors);
  assert.ok(fit.r2 > 0.999, `R² ~1 (${fit.r2})`);
  assert.ok(
    Math.abs(fit.offset.gc - 0.3) < 0.01 && Math.abs(fit.offset.tt + 0.3) < 0.01,
    `type-offsets genfundet (${JSON.stringify(fit.offset)})`
  );
});

test("checkAnchorOrdering skelner hårde (mål ≥15M) og bløde brud", () => {
  const anchors = [
    { name: "Stjerne", target: 100e6 }, { name: "Naeststjerne", target: 50e6 },
    { name: "Mellem", target: 8e6 }, { name: "Billig", target: 3e6 },
  ];
  // predict inverterer Stjerne/Naeststjerne (hård zone) og Mellem/Billig (blød zone).
  const preds = { Stjerne: 40e6, Naeststjerne: 60e6, Mellem: 2e6, Billig: 4e6 };
  const { hard, soft } = checkAnchorOrdering(anchors, (a) => preds[a.name]);
  assert.equal(hard.length, 1);
  assert.equal(hard[0].high, "Stjerne");
  assert.equal(soft.length, 1);
  assert.equal(soft[0].high, "Mellem");
});

test("checkAnchorOrdering er tom når ordenen holder", () => {
  const anchors = [{ name: "A", target: 10e6 }, { name: "B", target: 1e6 }];
  const { hard, soft } = checkAnchorOrdering(anchors, (a) => a.target);
  assert.equal(hard.length + soft.length, 0);
});
