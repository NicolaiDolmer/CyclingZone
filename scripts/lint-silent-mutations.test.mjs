// scripts/lint-silent-mutations.test.mjs
// ============================================================
// Tests for the feedback-kontrakt forward-guard (#2465).
// Run: node --test scripts/lint-silent-mutations.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { findSilentMutations, EXEMPT_FILES } from "./lint-silent-mutations.mjs";

test("flags a bare fire-and-forget call (the #2465 TrainingPage.jsx bug)", () => {
  const src = `
    const pickFocus = (f) => {
      if (busy) return;
      setPlan(rider.id, f, intensity);
    };
  `;
  const findings = findSilentMutations(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fn, "setPlan");
});

test("flags a member-access call (hook returned as prop object)", () => {
  const src = `training.setPlan(rider.id, f, intensity);`;
  assert.equal(findSilentMutations(src).length, 1);
});

test("does not flag an awaited call", () => {
  const src = `const r = await setPlan(rider.id, f, intensity); if (!r.ok) setError(r.error);`;
  assert.equal(findSilentMutations(src).length, 0);
});

test("does not flag an awaited member-access call", () => {
  const src = `await facs.upgrade(track);`;
  assert.equal(findSilentMutations(src).length, 0);
});

test("does not flag a returned call (delegated to an awaiting caller)", () => {
  const src = `
    const onCreatePeak = (riderId, raceId) => {
      return createPeak(riderId, raceId);
    };
  `;
  assert.equal(findSilentMutations(src).length, 0);
});

test("does not flag a .then()-chained call", () => {
  const src = `scout(riderId).then((r) => { if (!r.ok) setError(r.error); });`;
  assert.equal(findSilentMutations(src).length, 0);
});

test("does not flag calls inside strings or comments", () => {
  const src = `
    // setPlan(riderId, focus, intensity) is called by the training hook
    const msg = "call setPlan(id) to start";
  `;
  assert.equal(findSilentMutations(src).length, 0);
});

test("does not false-positive on similarly-named identifiers (word boundary)", () => {
  const src = `resetPlan(rider.id); refire(id); rehire(id);`;
  assert.equal(findSilentMutations(src).length, 0);
});

test("flags multiple unhandled calls in one file", () => {
  const src = `
    onClick={() => clearPlan(rider.id)}
    onClick={() => setPlan(rider.id, plan.focus, k)}
  `;
  assert.equal(findSilentMutations(src).length, 2);
});

test("EXEMPT_FILES lists exactly the 6 hook definition files", () => {
  assert.equal(EXEMPT_FILES.size, 6);
  assert.ok(EXEMPT_FILES.has("frontend/src/lib/useTraining.js"));
  assert.ok(EXEMPT_FILES.has("frontend/src/lib/useScoutingCentral.js"));
});
