import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.css"), "utf8");

test("global focus-visible ring er defineret (laast: 2px / 1px offset, accent-t)", () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid rgb\(var\(--accent-t\)\)/s);
  assert.match(css, /:focus-visible\s*\{[^}]*outline-offset:\s*1px/s);
});
