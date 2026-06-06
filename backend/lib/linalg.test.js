import test from "node:test";
import assert from "node:assert/strict";

import { transpose, matmul, matvec, solveLinearSystem, ridgeFit, rSquared } from "./linalg.js";

test("transpose flips dimensions", () => {
  assert.deepEqual(transpose([[1, 2, 3], [4, 5, 6]]), [[1, 4], [2, 5], [3, 6]]);
});

test("matmul computes product", () => {
  assert.deepEqual(matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]]), [[19, 22], [43, 50]]);
});

test("matmul rejects dim mismatch", () => {
  assert.throws(() => matmul([[1, 2]], [[1, 2]]));
});

test("matvec multiplies matrix by vector", () => {
  assert.deepEqual(matvec([[1, 2], [3, 4]], [1, 1]), [3, 7]);
});

test("solveLinearSystem solves a known system", () => {
  // 2x + y = 5 ; x + 3y = 10  → x=1, y=3
  const x = solveLinearSystem([[2, 1], [1, 3]], [5, 10]);
  assert.ok(Math.abs(x[0] - 1) < 1e-9);
  assert.ok(Math.abs(x[1] - 3) < 1e-9);
});

test("solveLinearSystem throws on singular matrix", () => {
  assert.throws(() => solveLinearSystem([[1, 2], [2, 4]], [1, 2]));
});

test("ridgeFit recovers a clean linear relationship", () => {
  // y = 2 + 3*f, intercept-kolonne + én feature. λ lille → nær OLS.
  const X = [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]];
  const y = [2, 5, 8, 11, 14];
  const b = ridgeFit(X, y, 1e-6);
  assert.ok(Math.abs(b[0] - 2) < 1e-2, `intercept ~2, fik ${b[0]}`);
  assert.ok(Math.abs(b[1] - 3) < 1e-2, `slope ~3, fik ${b[1]}`);
});

test("ridgeFit shrinks coefficients toward zero as lambda grows", () => {
  const X = [[1, -2], [1, -1], [1, 0], [1, 1], [1, 2]];
  const y = [-4, -2, 0, 2, 4]; // slope 2
  const small = ridgeFit(X, y, 0.01)[1];
  const large = ridgeFit(X, y, 100)[1];
  assert.ok(Math.abs(large) < Math.abs(small), "større λ → mindre |slope|");
});

test("ridgeFit does not penalize intercept by default", () => {
  // Konstant y → intercept skal ramme middelværdien uanset λ.
  const X = [[1, 1], [1, 2], [1, 3]];
  const y = [5, 5, 5];
  const b = ridgeFit(X, y, 1000);
  assert.ok(Math.abs(b[0] - 5) < 1e-6, `intercept ~5, fik ${b[0]}`);
});

test("rSquared is 1 for a perfect fit and 0 for mean-only", () => {
  assert.equal(rSquared([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(rSquared([1, 2, 3], [2, 2, 2]), 0);
});
