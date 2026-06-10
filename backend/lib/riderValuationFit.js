// Fit-kerne for værdimodellen (#1101 v3) — ren og testbar; bruges af
// scripts/fitRiderValuationModel.js.
//
//   ln(value) = a + b·O + c·O² + offset[primary_type]
//   O = blendet output (riderValuation.js: blendedOutput)
//
// To-trins-fit (samme princip som v2): (1) OLS af ln(target) på [1, O, O²];
// (2) type-offset = gennemsnitlig residual pr. type (fixed effect; typer uden
// anchor får 0 = neutral). checkAnchorOrdering håndhæver ejer-rækkefølgen:
// "MvdP dyrere end Pogačar" må aldrig slippe stille igennem et re-fit igen.

// OLS via normalligninger + Gauss-Jordan. Lille (k ≤ 3) og eksakt nok her;
// generel numerik er bevidst fravalgt (YAGNI).
export function olsSolve(X, y) {
  const k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let r = 0; r < k; r++) {
      Xty[r] += X[i][r] * y[i];
      for (let c = 0; c < k; c++) XtX[r][c] += X[i][r] * X[i][c];
    }
  }
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < k; col++) {
    let p = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r;
    [A[col], A[p]] = [A[p], A[col]];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= k; c++) A[r][c] -= f * A[col][c];
    }
  }
  // Efter Gauss-Jordan er row[i] diagonal-elementet; løsningen er row[k]/row[i].
  return A.map((row, i) => row[k] / row[i]);
}

// anchors: [{ name, type, output, target }] → { a, b, c, offset, r2, predictLn }.
export function fitValuationModel(anchors, { quadratic = true } = {}) {
  const Ys = anchors.map((an) => Math.log(an.target));
  const X = anchors.map((an) => (quadratic ? [1, an.output, an.output ** 2] : [1, an.output]));
  const [a, b, c = 0] = olsSolve(X, Ys);
  const lin = (o) => a + b * o + c * o * o;

  const resByType = {};
  anchors.forEach((an, i) => (resByType[an.type] ??= []).push(Ys[i] - lin(an.output)));
  const offset = {};
  for (const [t, arr] of Object.entries(resByType)) {
    offset[t] = arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  const predictLn = (an) => lin(an.output) + (offset[an.type] ?? 0);
  let ssRes = 0, ssTot = 0;
  const mY = Ys.reduce((s, v) => s + v, 0) / Ys.length;
  anchors.forEach((an, i) => {
    ssRes += (Ys[i] - predictLn(an)) ** 2;
    ssTot += (Ys[i] - mY) ** 2;
  });
  return { a, b, c, offset, r2: 1 - ssRes / ssTot, predictLn };
}

// Monotoni-guard (#1198 VM-M2): ln-kurven a+bO+cO² skal være VOKSENDE på hele
// [lo,hi]. Afledt b+2cO er lineær i O, så det er tilstrækkeligt at tjekke begge
// endepunkter. Fanger BÅDE konkav-med-toppunkt (c<0 — den gamle guard) og
// konveks-med-bundpunkt (b<0, c>0 — U-kurve hvor vrag-ryttere er dyrest, som
// to ekstra-nuller-typos i bund-anchors kan give).
export function isMonotoneIncreasingOn(b, c, lo = 0, hi = 99) {
  return b + 2 * c * lo > 0 && b + 2 * c * hi > 0;
}

// Gate-integritets-guards (#1198): evalueres af fitRiderValuationModel.js FØR
// rapport/skriv — brud afviser fittet (exit 1).
//   1. Monotoni på hele output-domænet (se ovenfor).
//   2. Hård-bånds-befolkning (VM-M1): ordens-guarden håndhæver kun par hvor
//      høj-målet er ≥ hardMin. Resolver INGEN anchors i hård-båndet (fx alle
//      topstjerner droppet pga. manglende ability-rækker), er guarden de facto
//      slukket og superstjerne-skalaen ukalibreret — det skal fejle højt.
export function evaluateFitGuards(anchors = [], fit = {}, { hardMin = 15e6, domain = [0, 99] } = {}) {
  const failures = [];
  if (!isMonotoneIncreasingOn(fit.b, fit.c, domain[0], domain[1])) {
    failures.push(
      `modellen er ikke monoton voksende på [${domain[0]},${domain[1]}] (b=${Number(fit.b).toFixed(4)}, c=${Number(fit.c).toExponential(3)}) — bedre ryttere skal altid være dyrere`
    );
  }
  const hardBand = anchors.filter((a) => a.target >= hardMin);
  if (hardBand.length === 0) {
    failures.push(
      `0 resolved anchors med mål ≥${hardMin / 1e6}M — den hårde ordens-guard er de facto slukket (topstjerne-anchors droppet ved resolution?)`
    );
  }
  return failures;
}

// Ordens-guard: for alle anchor-par hvor mål adskiller sig > ratio skal forudsigelsen
// bevare ejerens rækkefølge. Brud med høj-anchor-mål ≥ hardMin er HÅRDE (fit afvises);
// resten er bløde (rapporteres — ægte anchor/ability-uenigheder i midterfeltet).
export function checkAnchorOrdering(anchors, predict, { ratio = 1.3, hardMin = 15e6 } = {}) {
  const hard = [], soft = [];
  for (const hi of anchors) {
    for (const lo of anchors) {
      if (hi.target > lo.target * ratio && predict(hi) <= predict(lo)) {
        (hi.target >= hardMin ? hard : soft).push({
          high: hi.name, low: lo.name,
          predHigh: Math.round(predict(hi)), predLow: Math.round(predict(lo)),
        });
      }
    }
  }
  return { hard, soft };
}
