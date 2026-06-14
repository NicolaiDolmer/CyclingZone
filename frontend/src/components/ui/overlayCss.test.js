import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.css"), "utf8");

test("overlay-reveal-keyframes + klasser findes", () => {
  assert.match(css, /@keyframes cz-overlay-fade/);
  assert.match(css, /@keyframes cz-overlay-pop/);
  assert.match(css, /@keyframes cz-toast-in/);
  for (const cls of [".cz-overlay-backdrop", ".cz-overlay-panel", ".cz-menu-panel", ".cz-toast-item"]) {
    assert.ok(css.includes(cls), `mangler ${cls}`);
  }
});

test("reveals bruger motion-tokens (ingen haardkodet ms)", () => {
  assert.match(css, /\.cz-overlay-panel\s*\{\s*animation:\s*cz-overlay-pop var\(--dur-slow\) var\(--ease\)/);
  assert.match(css, /\.cz-toast-item\s*\{\s*animation:\s*cz-toast-in var\(--dur\) var\(--ease\)/);
});

test("reduced-motion slaar alle overlay-reveals + tooltip-transition fra (A6, hard krav)", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*cz-overlay-panel[\s\S]*animation:\s*none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*cz-tooltip\s*\{\s*transition:\s*none/);
});
