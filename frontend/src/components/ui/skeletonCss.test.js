import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.css"), "utf8");

test("shimmer-keyframe + .cz-skeleton findes", () => {
  assert.match(css, /@keyframes cz-shimmer/);
  assert.match(css, /\.cz-skeleton/);
});

test("reduced-motion slaar shimmer fra (spec A6, hard krav)", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*cz-skeleton::after[^}]*animation:\s*none/s);
});
