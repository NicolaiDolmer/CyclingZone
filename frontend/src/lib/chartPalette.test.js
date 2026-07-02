import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHART_PALETTE, chartColor } from "./chartPalette.js";

test("CHART_PALETTE has 9 categorical colors", () => {
  assert.equal(CHART_PALETTE.length, 9);
});

test("chartColor wraps by index", () => {
  assert.equal(chartColor(0), CHART_PALETTE[0]);
  assert.equal(chartColor(9), CHART_PALETTE[0]);
  assert.equal(chartColor(10), CHART_PALETTE[1]);
  assert.equal(chartColor(-1), CHART_PALETTE[8]);
});

test("colors are token-backed, no raw hex leaks", () => {
  for (const c of CHART_PALETTE) {
    assert.ok(/^rgb\(var\(--cz-chart-\d\)\)$/.test(c), c);
    assert.ok(!/#[0-9a-fA-F]{6}/.test(c), `raw hex in ${c}`);
  }
});

// ── Colorblind-safety guard (#2033) ───────────────────────────────────────────
// --cz-chart-4 (amber) and --cz-chart-8 (yellow) used to sit ~2 deltaE apart
// under red-green colour-vision deficiency — below the ~2.3 just-noticeable
// threshold, so colourblind players could not tell donut/line segments apart.
// This test reads the live CSS-variable RGB triplets from index.css (single
// source of truth) and locks a minimum perceptual distance (CIEDE2000) between
// the two colours after simulating deuteranopia AND protanopia. Self-contained
// colour maths — no runtime deps — so it runs under Node's `node --test`.

// sRGB (0-255) → linear-light
const srgbToLinear = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
// linear-light → sRGB (0-255)
const linearToSrgb = (c) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};
// linear-RGB → CIE XYZ (sRGB / D65)
const linRgbToXyz = ([r, g, b]) => [
  0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
  0.2126729 * r + 0.7151522 * g + 0.072175 * b,
  0.0193339 * r + 0.119192 * g + 0.9503041 * b,
];

// Viénot–Brettel–Mollon (1999) dichromat simulation matrices, applied in
// linear-RGB. Standard reference matrices for protanopia/deuteranopia.
const CVD_MATRICES = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};
const applyMatrix = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const simulateCVD = (rgb255, type) =>
  applyMatrix(CVD_MATRICES[type], rgb255.map(srgbToLinear)).map(linearToSrgb);

// XYZ → CIE Lab (D65 white point)
const Xn = 0.95047,
  Yn = 1.0,
  Zn = 1.08883;
const xyzToLab = ([x, y, z]) => {
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / Xn),
    fy = f(y / Yn),
    fz = f(z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const rgb255ToLab = (rgb255) => xyzToLab(linRgbToXyz(rgb255.map(srgbToLinear)));

// CIEDE2000 perceptual colour difference
function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const avgLp = (L1 + L2) / 2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;
  const G =
    0.5 *
    (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) / 2;
  const h1p =
    (Math.atan2(b1, a1p) * 180) / Math.PI +
    (Math.atan2(b1, a1p) < 0 ? 360 : 0);
  const h2p =
    (Math.atan2(b2, a2p) * 180) / Math.PI +
    (Math.atan2(b2, a2p) < 0 ? 360 : 0);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);
  let avghp;
  if (C1p * C2p === 0) avghp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) avghp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) avghp = (h1p + h2p + 360) / 2;
  else avghp = (h1p + h2p - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos(((avghp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * avghp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * avghp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * avghp - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-Math.pow((avghp - 275) / 25, 2));
  const Rc =
    2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const Sl =
    1 +
    (0.015 * Math.pow(avgLp - 50, 2)) /
      Math.sqrt(20 + Math.pow(avgLp - 50, 2));
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const Rt = -Math.sin((2 * dTheta * Math.PI) / 180) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh),
  );
}

const deltaEUnderCVD = (rgbA, rgbB, type) =>
  deltaE2000(
    rgb255ToLab(simulateCVD(rgbA, type)),
    rgb255ToLab(simulateCVD(rgbB, type)),
  );

// Parse a `--cz-chart-N: R G B;` triplet straight from index.css so the guard
// tracks the real values instead of a hard-coded copy.
function readChartRgb(css, n) {
  const m = css.match(new RegExp(`--cz-chart-${n}:\\s*([0-9]+)\\s+([0-9]+)\\s+([0-9]+)`));
  assert.ok(m, `--cz-chart-${n} not found in index.css`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

test("amber (chart-4) and yellow (chart-8) stay distinct under deuteranopia + protanopia (#2033)", () => {
  const cssPath = fileURLToPath(new URL("../index.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  const amber = readChartRgb(css, 4);
  const yellow = readChartRgb(css, 8);

  // Minimum perceptual distance under simulated red-green CVD. 6.0 sits well
  // above the ~2.3 just-noticeable-difference threshold; the former amber
  // #fbbf24 scored ~1.95 (deut) / ~2.60 (prot) and would fail this guard.
  const MIN_DELTA_E = 6.0;

  for (const type of ["deuteranopia", "protanopia"]) {
    const dE = deltaEUnderCVD(amber, yellow, type);
    assert.ok(
      dE >= MIN_DELTA_E,
      `chart-4 vs chart-8 deltaE under ${type} = ${dE.toFixed(2)}, ` +
        `below required ${MIN_DELTA_E} (colours too close for colourblind players)`,
    );
  }
});
