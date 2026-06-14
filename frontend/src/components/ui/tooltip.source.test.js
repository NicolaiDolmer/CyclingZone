import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Tooltip.jsx"), "utf8");

test("Tooltip er group-ankret med role=tooltip + tooltipClass", () => {
  assert.match(src, /className="group relative/);
  assert.match(src, /role="tooltip"/);
  assert.match(src, /tooltipClass\(/);
});

test("open tvinger boblen synlig (kitchen-sink/snapshot)", () => {
  assert.match(src, /!opacity-100/);
});
