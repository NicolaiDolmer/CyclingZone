// #5497 R2 — fit af den typefri produktionsfunktion mod en sæson-simulering.
//
// Mål: ln(E[præmie]) pr. rytter fra simuleringen (samme mål som v4-fittet,
// fitRiderValuationV4.js — ryttere med E[præmie] > 0).
//
// Parametre: programandele (softmax-logits, ét terræn fast på 0), beta (log),
// alpha (logit). For givne (andele, beta, alpha) er a, b, c lukket-form OLS på
// [1, O, O²]. Den ydre søgning er Nelder-Mead — deterministisk (fast start,
// ingen tilfældighed), så samme input giver samme fit.

import { TERRAIN_KEYS, effectiveOutput, normalizeShares, terrainRatings, softBest } from "./abilityProduction.js";
import { meanAbilityScore } from "../riderValuation.js";

function ols3(xs, ys) {
  // Normal-ligninger for [1, x, x²].
  const S = Array.from({ length: 3 }, () => Array(4).fill(0));
  for (let i = 0; i < xs.length; i++) {
    const f = [1, xs[i], xs[i] * xs[i]];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) S[r][c] += f[r] * f[c];
      S[r][3] += f[r] * ys[i];
    }
  }
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(S[j][i]) > Math.abs(S[p][i])) p = j;
    [S[i], S[p]] = [S[p], S[i]];
    const v = S[i][i];
    if (Math.abs(v) < 1e-12) return null;
    for (let j = i; j < 4; j++) S[i][j] /= v;
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = S[k][i];
      for (let j = i; j < 4; j++) S[k][j] -= f * S[i][j];
    }
  }
  return { a: S[0][3], b: S[1][3], c: S[2][3] };
}

export function nelderMead(f, x0, { step = 0.5, maxIter = 4000, tol = 1e-9 } = {}) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] += step;
    simplex.push(x);
  }
  let vals = simplex.map(f);
  let iter = 0;
  for (; iter < maxIter; iter++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map((i) => simplex[i]);
    vals = order.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < tol) break;
    const centroid = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    const at = (t) => centroid.map((c, j) => c + t * (simplex[n][j] - c));
    const xr = at(-1);
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = at(-2);
      const fe = f(xe);
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) {
      simplex[n] = xr; vals[n] = fr;
    } else {
      const xc = at(0.5);
      const fc = f(xc);
      if (fc < vals[n]) { simplex[n] = xc; vals[n] = fc; } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          vals[i] = f(simplex[i]);
        }
      }
    }
  }
  return { x: simplex[0], fx: vals[0], iterations: iter };
}

function unpackFixed(theta, shares) {
  return { shares, beta: Math.exp(theta[0]), alpha: 1 / (1 + Math.exp(-theta[1])) };
}

function unpack(theta) {
  const k = TERRAIN_KEYS.length;
  const logits = [0, ...theta.slice(0, k - 1)];
  const m = Math.max(...logits);
  const e = logits.map((l) => Math.exp(l - m));
  const sum = e.reduce((s, v) => s + v, 0);
  const shares = e.map((v) => v / sum);
  const beta = Math.exp(theta[k - 1]);
  const alpha = 1 / (1 + Math.exp(-theta[k]));
  return { shares, beta, alpha };
}

// samples: [{ abilities, e_prize }]. Returnerer produktions-parametre + fit-mål.
// fixedShares: programandele låst (R1: programmets faktiske terrænfordeling;
// indtil da lige vægt). Så fittes kun beta, alpha, a, b, c. Fri fit af andelene
// kan degenerere til det terræn simuleringen tilfældigvis betaler mest for.
export function fitTypefreeProduction(samples, { maxIter = 4000, fixedShares = null } = {}) {
  const fixed = fixedShares ? normalizeShares(fixedShares) : null;
  const rows = samples.filter((s) => Number(s.e_prize) > 0 && s.abilities);
  const R = rows.map((s) => terrainRatings(s.abilities));
  const M = rows.map((s) => meanAbilityScore(s.abilities));
  const y = rows.map((s) => Math.log(Number(s.e_prize)));
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const sst = y.reduce((s, v) => s + (v - yMean) ** 2, 0);

  const evalTheta = (theta) => {
    const { shares, beta, alpha } = fixed ? unpackFixed(theta, fixed) : unpack(theta);
    const O = R.map((r, i) => alpha * softBest(r, shares, beta) + (1 - alpha) * M[i]);
    const coef = ols3(O, y);
    if (!coef) return { sse: Infinity };
    let sse = 0;
    for (let i = 0; i < O.length; i++) {
      const p = coef.a + coef.b * O[i] + coef.c * O[i] * O[i];
      sse += (y[i] - p) ** 2;
    }
    return { sse, coef, shares, beta, alpha, O };
  };

  const k = TERRAIN_KEYS.length;
  const theta0 = fixed ? [Math.log(0.2), 2] : [...Array(k - 1).fill(0), Math.log(0.2), 2];
  const res = nelderMead((t) => evalTheta(t).sse, theta0, { maxIter });
  const best = evalTheta(res.x);
  if (!best.coef) throw new Error("fitTypefreeProduction: singular normal system (too few or degenerate output values)");
  const oMax = Math.max(...best.O);
  return {
    params: {
      shares: Object.fromEntries(TERRAIN_KEYS.map((key, i) => [key, best.shares[i]])),
      beta: best.beta,
      alpha: best.alpha,
      a: best.coef.a,
      b: best.coef.b,
      c: best.coef.c,
      output_max: oMax,
    },
    r2_log: 1 - best.sse / sst,
    n_samples: rows.length,
    iterations: res.iterations,
  };
}

// R² for en vilkårlig O-funktion på samme mål (bruges til at sammenligne med
// v4's type-keyede output på samme simulering).
export function r2ForOutput(samples, outputFn) {
  const rows = samples.filter((s) => Number(s.e_prize) > 0 && s.abilities);
  const O = rows.map(outputFn);
  const y = rows.map((s) => Math.log(Number(s.e_prize)));
  const coef = ols3(O, y);
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < O.length; i++) {
    sse += (y[i] - (coef.a + coef.b * O[i] + coef.c * O[i] * O[i])) ** 2;
    sst += (y[i] - yMean) ** 2;
  }
  return { r2_log: 1 - sse / sst, coef };
}

export { effectiveOutput };
