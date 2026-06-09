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
