// Minimal matrix-algebra til ridge-regression (#1101 rider valuation).
// Ren, dependency-fri, deterministisk. Dimensionerne i denne model er små
// (~15 features), så naiv Gaussian elimination er rigeligt og numerisk stabilt
// nok med partial pivoting.

// Transponér en m×n matrix til n×m.
export function transpose(A) {
  const m = A.length;
  const n = A[0]?.length ?? 0;
  const T = Array.from({ length: n }, () => new Array(m));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) T[j][i] = A[i][j];
  }
  return T;
}

// Matrix-produkt A(m×k) · B(k×n) → m×n.
export function matmul(A, B) {
  const m = A.length;
  const k = A[0]?.length ?? 0;
  const n = B[0]?.length ?? 0;
  if (B.length !== k) {
    throw new Error(`matmul dim mismatch: A is ${m}x${k}, B is ${B.length}x${n}`);
  }
  const C = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a === 0) continue;
      for (let j = 0; j < n; j++) C[i][j] += a * B[p][j];
    }
  }
  return C;
}

// Matrix·vektor → vektor.
export function matvec(A, x) {
  return A.map((row) => row.reduce((s, a, j) => s + a * x[j], 0));
}

// Løs et lineært system M·x = b for en kvadratisk M (n×n) via Gaussian
// elimination med partial pivoting. Kaster ved singularitet.
export function solveLinearSystem(M, b) {
  const n = M.length;
  // Augmenteret kopi, så input ikke muteres.
  const A = M.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot: find rækken med størst absolut værdi i denne kolonne.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (Math.abs(A[pivot][col]) < 1e-12) {
      throw new Error("solveLinearSystem: matrix is singular or near-singular");
    }
    if (pivot !== col) [A[col], A[pivot]] = [A[pivot], A[col]];

    // Eliminér under pivot.
    for (let r = col + 1; r < n; r++) {
      const factor = A[r][col] / A[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) A[r][c] -= factor * A[col][c];
    }
  }

  // Back-substitution.
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = A[r][n];
    for (let c = r + 1; c < n; c++) sum -= A[r][c] * x[c];
    x[r] = sum / A[r][r];
  }
  return x;
}

// Ridge-regression: minimér ||Xb - y||² + λ||b'||² hvor b' er koefficienterne
// EKSKL. intercept (intercept-kolonnen straffes ikke). X inkluderer en
// intercept-kolonne (typisk kolonne 0, fyldt med 1). Returnerer koefficient-
// vektoren b (længde = antal kolonner i X).
//
// Løses via normal-ligningerne (XᵀX + λI')b = Xᵀy. Med standardiserede
// features + lille kolonneantal er dette stabilt og hurtigt.
export function ridgeFit(X, y, lambda, { penalizeIntercept = false } = {}) {
  const Xt = transpose(X);
  const XtX = matmul(Xt, X);
  const n = XtX.length;
  for (let i = 0; i < n; i++) {
    // Spring intercept-kolonnen (0) over medmindre eksplicit ønsket.
    if (!penalizeIntercept && i === 0) continue;
    XtX[i][i] += lambda;
  }
  const Xty = matvec(Xt, y);
  return solveLinearSystem(XtX, Xty);
}

// R² (coefficient of determination) for forudsigelser mod faktiske værdier.
export function rSquared(yTrue, yPred) {
  const mean = yTrue.reduce((s, v) => s + v, 0) / yTrue.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < yTrue.length; i++) {
    ssRes += (yTrue[i] - yPred[i]) ** 2;
    ssTot += (yTrue[i] - mean) ** 2;
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}
