// #6110 byggetrin 1b. Syntetiske parametre, ikke kalibreringen (privat).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ratingLoft, shareOverLoft, fitLoft } from "./ratingLoft6110.mjs";

const P = { lo: 20, hi: 90, gamma: 1.2 };

test("loftet er monotont i talent og ligger mellem lo og hi", () => {
  let prev = -Infinity;
  for (let g = 1; g <= 99; g++) {
    const l = ratingLoft(g, P);
    assert.ok(l >= prev);
    assert.ok(l >= P.lo - 1e-9 && l <= P.hi + 1e-9);
    prev = l;
  }
  assert.equal(ratingLoft(1, P), P.lo);
  assert.equal(ratingLoft(99, P), P.hi);
});

test("andel over loftet tæller kun ryttere, hvis rating er over", () => {
  const rows = [{ rating: 10, talent: 1 }, { rating: 30, talent: 1 }, { rating: 50, talent: 99 }, { rating: 95, talent: 99 }];
  assert.equal(shareOverLoft(rows, P), 0.5);
});

test("fitteren rammer målandelen over loftet på syntetiske data", () => {
  const rows = [];
  for (let i = 0; i < 2000; i++) {
    const talent = 1 + (i % 99);
    rows.push({ talent, rating: Math.round(15 + talent * 0.5 + ((i * 37) % 21) - 10) });
  }
  const best = fitLoft(rows, {
    hi: 90, targetShare: 0.1, highBar: 80, targetHighShare: 0.05, overWeight: 3,
    loGrid: [10, 15, 20, 25, 30, 35, 40], gammaGrid: [0.5, 0.75, 1, 1.25, 1.5, 2],
  });
  assert.ok(Math.abs(best.over - 0.1) < 0.05, `over ${best.over}`);
});
