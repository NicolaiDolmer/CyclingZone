import test from "node:test";
import assert from "node:assert/strict";

import { formatDeadlineDayCountdown } from "./deadlineDayCountdown.js";

function translator(values) {
  return (key, params = {}) => {
    if (key === "deadlineDayBanner.countdownHours") {
      return values.hours
        .replace("{h}", String(params.h))
        .replace("{m}", params.m)
        .replace("{s}", params.s);
    }
    return key;
  };
}

test("formatDeadlineDayCountdown localizes English hour units", () => {
  assert.equal(
    formatDeadlineDayCountdown(3909, translator({ hours: "{h}h {m}m {s}s" })),
    "1h 05m 09s",
  );
});

test("formatDeadlineDayCountdown localizes Danish hour units", () => {
  assert.equal(
    formatDeadlineDayCountdown(3909, translator({ hours: "{h}t {m}m {s}s" })),
    "1t 05m 09s",
  );
});

test("formatDeadlineDayCountdown keeps minute-only countdown numeric", () => {
  assert.equal(formatDeadlineDayCountdown(309, translator({ hours: "" })), "05:09");
  assert.equal(formatDeadlineDayCountdown(0, translator({ hours: "" })), null);
});
