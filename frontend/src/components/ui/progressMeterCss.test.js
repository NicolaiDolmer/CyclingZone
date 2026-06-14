import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.css"), "utf8");

test("cz-progress-fill har en bredde-overgang paa motion-tokens", () => {
  assert.match(css, /\.cz-progress-fill\s*\{\s*transition:\s*width var\(--dur-slow\) var\(--ease\)/);
});

test("reduced-motion slaar fyld-overgangen fra (A6, hard krav)", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*cz-progress-fill\s*\{\s*transition:\s*none/);
});
