import test from "node:test";
import assert from "node:assert/strict";

import {
  bootstrapWeights,
  makeRng,
  nnlsCoordinateDescent,
  normalizeWeights,
  rawWeightsFromSamples,
  weightConcentration,
} from "./valuationWeightDerivation.js";

// ── nnlsCoordinateDescent ────────────────────────────────────────────────────

test("nnlsCoordinateDescent genfinder kendte ikke-negative vægte på ren data", () => {
  // y = 2·x1 + 0·x2 + 0,5·x3, ingen støj, kolonner centreret.
  const truth = [2, 0, 0.5];
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const x = [(i % 7) - 3, (i % 5) - 2, ((i * 3) % 11) - 5];
    rows.push(x);
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const cm = [0, 1, 2].map((j) => mean(rows.map((r) => r[j])));
  const X = rows.map((r) => r.map((v, j) => v - cm[j]));
  const yRaw = X.map((r) => truth.reduce((s, t, j) => s + t * r[j], 0));
  const y = yRaw.map((v) => v - mean(yRaw));
  const w = nnlsCoordinateDescent(X, y);
  assert.ok(Math.abs(w[0] - 2) < 1e-6, `w0=${w[0]}`);
  assert.ok(Math.abs(w[2] - 0.5) < 1e-6, `w2=${w[2]}`);
  // Den evne der ikke forklarer noget må ikke få en reel vægt (numerisk støj ok).
  assert.ok(w[1] >= 0 && w[1] < 1e-9, `w1=${w[1]}`);
});

test("nnlsCoordinateDescent klipper en ÆGTE negativ sammenhæng til 0", () => {
  // Sandheden er −3 på den eneste prædiktor. NNLS må aldrig give et negativt tal:
  // en negativ vægt ville betyde at en evne gør rytteren mindre værd.
  const X = [[-3], [-1], [1], [3], [5]].map((r) => [r[0]]);
  const y = X.map((r) => -3 * r[0]);
  const w = nnlsCoordinateDescent(X, y);
  assert.equal(w[0], 0);
});

test("nnlsCoordinateDescent håndterer en konstant kolonne uden at dividere med nul", () => {
  const X = [[1, 0], [2, 0], [3, 0], [4, 0]];
  const y = [1, 2, 3, 4];
  const w = nnlsCoordinateDescent(X, y);
  assert.ok(Number.isFinite(w[0]) && Number.isFinite(w[1]));
  assert.equal(w[1], 0);
});

test("nnlsCoordinateDescent på tomt input giver tomt resultat", () => {
  assert.deepEqual(nnlsCoordinateDescent([], []), []);
});

// ── rawWeightsFromSamples ────────────────────────────────────────────────────

const KEYS = ["flat", "climbing", "sprint"];

function mkSamples(n, coef) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const abilities = {
      flat: 30 + ((i * 7) % 40),
      climbing: 20 + ((i * 3) % 50),
      sprint: 10 + ((i * 11) % 60),
    };
    const lnPrize = KEYS.reduce((s, k) => s + coef[k] * abilities[k], 0) / 20;
    out.push({ abilities, e_prize: Math.exp(lnPrize) });
  }
  return out;
}

test("rawWeightsFromSamples finder den evne der driver præmiepengene", () => {
  const { raw, n } = rawWeightsFromSamples(mkSamples(120, { flat: 3, climbing: 0, sprint: 1 }), KEYS);
  assert.equal(n, 120);
  assert.ok(raw.flat > raw.sprint, `flat=${raw.flat} sprint=${raw.sprint}`);
  assert.equal(raw.climbing, 0);
});

test("rawWeightsFromSamples: for få rækker giver nul-vægte i stedet for at kaste", () => {
  const { raw, n } = rawWeightsFromSamples(mkSamples(2, { flat: 1, climbing: 1, sprint: 1 }), KEYS);
  assert.equal(n, 2);
  assert.deepEqual(raw, { flat: 0, climbing: 0, sprint: 0 });
});

test("rawWeightsFromSamples springer rækker med manglende evner over", () => {
  const good = mkSamples(80, { flat: 2, climbing: 0, sprint: 1 });
  const broken = [{ abilities: { flat: 50, climbing: null }, e_prize: 100 }];
  const { n } = rawWeightsFromSamples([...good, ...broken], KEYS);
  assert.equal(n, 80);
});

// ── normalizeWeights / weightConcentration ───────────────────────────────────

test("normalizeWeights sætter den tungeste evne til topWeight og runder", () => {
  const out = normalizeWeights({ flat: 4, climbing: 2, sprint: 1 }, { topWeight: 5, decimals: 1 });
  assert.equal(out.flat, 5);
  assert.equal(out.climbing, 2.5);
  assert.equal(out.sprint, 1.3);
});

test("normalizeWeights smider støj-vægte under minShare væk", () => {
  const out = normalizeWeights({ flat: 100, climbing: 1 }, { minShare: 0.05 });
  assert.deepEqual(Object.keys(out), ["flat"]);
});

test("normalizeWeights: ingen positive vægte ⇒ null (kalderen må ikke få en blind tabel)", () => {
  assert.equal(normalizeWeights({ flat: 0, climbing: 0 }), null);
  assert.equal(normalizeWeights({}), null);
  assert.equal(normalizeWeights(null), null);
});

test("weightConcentration måler andelen på den tungeste evne", () => {
  assert.equal(weightConcentration({ time_trial: 3 }), 1);
  assert.ok(Math.abs(weightConcentration({ flat: 4, endurance: 1 }) - 0.8) < 1e-12);
  assert.ok(Math.abs(weightConcentration({ a: 1, b: 1, c: 1, d: 1 }) - 0.25) < 1e-12);
  assert.equal(weightConcentration({}), null);
});

// ── bootstrap ────────────────────────────────────────────────────────────────

test("bootstrapWeights er deterministisk for samme seed og finder lav spredning på ren data", () => {
  const samples = mkSamples(150, { flat: 3, climbing: 0, sprint: 1 });
  const a = bootstrapWeights(samples, KEYS, makeRng(7), { reps: 12 });
  const b = bootstrapWeights(samples, KEYS, makeRng(7), { reps: 12 });
  assert.deepEqual(a, b);
  assert.equal(a.flat.mean, 5); // tungeste evne normaliseres altid til top
  assert.ok(a.sprint.sd < 0.5, `sd=${a.sprint.sd}`);
});
