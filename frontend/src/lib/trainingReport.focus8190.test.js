import test from "node:test";
import assert from "node:assert/strict";
import { focusProgress, progressPct, abilityReceipt } from "./trainingReport.js";
import { focusAbilitiesFor } from "./training.js";

const FOCUS = "vo2max";
const ABILITY = focusAbilitiesFor(FOCUS)[0];

test("#8190 focusProgress viser aldrig 100 for et point der ikke er landet", () => {
  for (const frac of [0.99, 0.995, 0.999, 1, 1.4]) {
    const out = focusProgress(FOCUS, { [ABILITY]: frac });
    assert.equal(out.pct, 99, `frac ${frac}`);
  }
});

test("#8190 focusProgress: lave og ugyldige værdier uændret", () => {
  assert.equal(focusProgress(FOCUS, { [ABILITY]: 0.5 }).pct, 50);
  assert.equal(focusProgress(FOCUS, { [ABILITY]: -0.3 }).pct, 0);
  assert.equal(focusProgress(FOCUS, { [ABILITY]: "x" }), null);
  assert.equal(focusProgress(null, { [ABILITY]: 0.5 }), null);
});

test("#8190 momentet og kvitterings-baren bruger samme regel", () => {
  const [row] = abilityReceipt([ABILITY], { abilities: { [ABILITY]: 70 }, progress: { [ABILITY]: 0.999 } });
  assert.equal(row.pct, 99);
  assert.equal(row.pct, focusProgress(FOCUS, { [ABILITY]: 0.999 }).pct);
  assert.equal(progressPct(0.999), 99);
  assert.equal(progressPct(0.42), 42);
});
