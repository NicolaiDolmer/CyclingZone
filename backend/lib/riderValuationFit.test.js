import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  olsSolve,
  fitValuationModel,
  checkAnchorOrdering,
  isMonotoneIncreasingOn,
  evaluateFitGuards,
} from "./riderValuationFit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const committedModel = JSON.parse(readFileSync(join(__dirname, "./riderValuationModel.json"), "utf8"));

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

// ── #1198 fit-guards ──────────────────────────────────────────────────────────

test("isMonotoneIncreasingOn: committed model er voksende på [0,99]", () => {
  assert.equal(isMonotoneIncreasingOn(committedModel.b, Number(committedModel.c)), true);
});

test("isMonotoneIncreasingOn fanger BEGGE fortegns-kombinationer", () => {
  // Konkav med toppunkt i domænet (den gamle guards case): b>0, c<0, top ved O=50.
  assert.equal(isMonotoneIncreasingOn(0.1, -0.001), false);
  // Konveks med BUNDPUNKT i domænet (#1198 VM-M2 — U-kurve, hullet i den gamle
  // guard): b<0, c>0, bund ved O≈47 → kurven FALDER på [0,47].
  assert.equal(isMonotoneIncreasingOn(-0.361, 0.0038), false);
  // Konkav men toppunkt EFTER domænet → ok.
  assert.equal(isMonotoneIncreasingOn(0.3, -0.001), true);
});

test("VM-M2-mutanten (ekstra-nuller-typo i bund-anchors) afvises af fit-guards", () => {
  // Replay af gatens egen sekvens på de committede anchors med to typos:
  // Ian Kimpe 60K→6M og D'Arcy Sanders 30K→3M giver OLS en U-formet ln-kurve.
  const anchors = committedModel.anchors_fit.map((an) => ({
    ...an,
    target: an.name === "Ian Kimpe" ? 6_000_000 : an.name === "D'Arcy Sanders" ? 3_000_000 : an.target,
  }));
  const fit = fitValuationModel(anchors, { quadratic: true });
  const failures = evaluateFitGuards(anchors, fit);
  assert.ok(failures.some((f) => /monoton/.test(f)), `forventede monotoni-brud: ${failures.join("; ")}`);
});

test("VM-M1-mutanten (alle ≥15M-anchors droppet) afvises: hård-båndet må ikke være tomt", () => {
  const anchors = committedModel.anchors_fit.filter((an) => an.target < 15e6);
  assert.ok(anchors.length >= 5, "mutanten skal stadig have nok anchors til et fit");
  const fit = fitValuationModel(anchors, { quadratic: true });
  const failures = evaluateFitGuards(anchors, fit);
  assert.ok(failures.some((f) => /hårde ordens-guard er de facto slukket/.test(f)), failures.join("; "));
});

test("committed anchors + committed fit består alle fit-guards (baseline grøn)", () => {
  const anchors = committedModel.anchors_fit;
  const fit = fitValuationModel(anchors, { quadratic: true });
  assert.deepEqual(evaluateFitGuards(anchors, fit), []);
});
