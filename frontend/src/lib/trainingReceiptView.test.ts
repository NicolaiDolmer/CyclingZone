import { test } from "node:test";
import assert from "node:assert/strict";
import { ABILITY_KEYS } from "./abilities.js";
import { orderAbilities, progressOnlyEntries, wholePointEntries } from "./trainingReceiptView.ts";

test("#7746 abilities follow the rider profile's order, not storage order", () => {
  const stored = ["positioning", "flat", "leadership", "climbing", "cobblestone", "sprint"];
  const ordered = orderAbilities(stored);
  assert.deepEqual(ordered, [...stored].sort((a, b) => ABILITY_KEYS.indexOf(a) - ABILITY_KEYS.indexOf(b)));
  assert.equal(ordered[0], "climbing");
  assert.equal(ordered.at(-1), "positioning");
});

test("#7746 unknown keys from older reports are kept, after the known ones", () => {
  assert.deepEqual(orderAbilities(["zeta_legacy", "tempo", "alpha_legacy", "climbing"]), ["climbing", "tempo", "alpha_legacy", "zeta_legacy"]);
});

test("#7745 whole points and progress toward the next point never share a list", () => {
  const dev = {
    gains: { positioning: 1, climbing: 1, tempo: 0 },
    gain_percent: { positioning: 120, climbing: 104, tempo: 40, flat: 3, sprint: null, punch: 0 },
  };
  assert.deepEqual(wholePointEntries(dev), [{ key: "climbing", points: 1 }, { key: "positioning", points: 1 }]);
  assert.deepEqual(progressOnlyEntries(dev), [{ key: "tempo", percent: 40 }, { key: "flat", percent: 3 }]);
});
