import { test } from "node:test";
import assert from "node:assert/strict";
import { seededUnit, estimatePotentialRange, potentialLabelKey } from "./scouting.js";

// ── Determinisme ──────────────────────────────────────────────────────────────

test("seededUnit er deterministisk og ∈ [0,1)", () => {
  const a = seededUnit("scout:r1:t1");
  assert.equal(a, seededUnit("scout:r1:t1"));
  assert.notEqual(a, seededUnit("scout:r1:t2"));
  assert.ok(a >= 0 && a < 1);
});

test("estimatet er stabilt mellem kald (samme input → samme interval)", () => {
  const a = estimatePotentialRange(4.5, 1, 22, "r1", "t1", 3);
  const b = estimatePotentialRange(4.5, 1, 22, "r1", "t1", 3);
  assert.deepEqual(a, b);
});

// ── Konvergens ────────────────────────────────────────────────────────────────

test("fuldt scoutet (level == maxLevel) → eksakt sandhed, exact=true", () => {
  const r = estimatePotentialRange(4.5, 3, 22, "r1", "t1", 3);
  assert.deepEqual(r, { lo: 4.5, hi: 4.5, exact: true, scoutLevel: 3 });
});

test("uscoutet ung rytter → bredt interval der indeholder et spænd", () => {
  const r = estimatePotentialRange(4, 0, 19, "r1", "t1", 3);
  assert.equal(r.exact, false);
  assert.ok(r.hi - r.lo > 1, `forventede bredt interval, fik ${r.lo}-${r.hi}`);
  assert.ok(r.lo >= 1 && r.hi <= 6);
});

test("scouting indsnævrer intervallet målbart (level 0 → 1 → 2)", () => {
  const w0 = estimatePotentialRange(4, 0, 19, "r1", "t1", 3);
  const w1 = estimatePotentialRange(4, 1, 19, "r1", "t1", 3);
  const w2 = estimatePotentialRange(4, 2, 19, "r1", "t1", 3);
  const width = (r) => r.hi - r.lo;
  assert.ok(width(w1) < width(w0), "level 1 smallere end 0");
  assert.ok(width(w2) < width(w1), "level 2 smallere end 1");
});

test("etableret rytter (≥28) starter smallere end ung", () => {
  const young = estimatePotentialRange(4, 0, 19, "r1", "t1", 3);
  const old = estimatePotentialRange(4, 0, 30, "r1", "t1", 3);
  assert.ok((old.hi - old.lo) < (young.hi - young.lo));
});

test("managere ser varierende intervaller for samme rytter (per-manager seed)", () => {
  // Egenskaben er at estimatet VARIERER på tværs af managere — ikke at hvert
  // vilkårligt par afviger (clamping ved 1–6 kan kollapse enkelte par).
  const seen = new Set(
    ["tA", "tB", "tC", "tD", "tE", "tF"].map((t) => {
      const r = estimatePotentialRange(4, 0, 19, "r1", t, 3);
      return `${r.lo}-${r.hi}`;
    })
  );
  assert.ok(seen.size > 1, "forventede mindst to forskellige intervaller på tværs af managere");
});

test("interval clampes til 1–6", () => {
  const hi = estimatePotentialRange(6, 0, 19, "rX", "tX", 3);
  const lo = estimatePotentialRange(1, 0, 19, "rY", "tY", 3);
  assert.ok(hi.hi <= 6 && hi.lo >= 1);
  assert.ok(lo.hi <= 6 && lo.lo >= 1);
});

test("ugyldig potentiale → null", () => {
  assert.equal(estimatePotentialRange(null, 0, 20, "r", "t", 3), null);
  assert.equal(estimatePotentialRange(undefined, 0, 20, "r", "t", 3), null);
});

// ── Labels ────────────────────────────────────────────────────────────────────

test("potentialLabelKey mapper midtpunkt til bånd", () => {
  assert.equal(potentialLabelKey({ lo: 5.5, hi: 6 }), "worldclass");
  assert.equal(potentialLabelKey({ lo: 4, hi: 5 }), "high");
  assert.equal(potentialLabelKey({ lo: 3, hi: 4 }), "solid");
  assert.equal(potentialLabelKey({ lo: 2, hi: 3 }), "rotation");
  assert.equal(potentialLabelKey({ lo: 1, hi: 2 }), "limited");
  assert.equal(potentialLabelKey(null), null);
});
