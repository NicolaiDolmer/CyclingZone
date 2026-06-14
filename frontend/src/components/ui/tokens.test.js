import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(join(root, "index.css"), "utf8");
const tw = readFileSync(join(root, "..", "tailwind.config.js"), "utf8");

test("index.css definerer fundament-tokens", () => {
  for (const v of ["--radius-sm", "--radius-pill", "--shadow-overlay", "--dur", "--ease", "--z-modal"]) {
    assert.ok(css.includes(v), `index.css mangler ${v}`);
  }
  assert.match(css, /--radius-sm:\s*5px/, "radius-sm skal vaere 5px (laast)");
});

test("tailwind eksponerer fundament-tokens", () => {
  for (const k of ["borderRadius", "cz-pill", "overlay:", "var(--radius-sm)", "zIndex"]) {
    assert.ok(tw.includes(k), `tailwind.config mangler ${k}`);
  }
});
