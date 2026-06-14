import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), "utf8");

test("Divider er en hairline (border-cz-border) med valgfri label", () => {
  const src = read("Divider.jsx");
  assert.match(src, /border-cz-border|bg-cz-border/);
  assert.match(src, /label/);
});

test("Link bruger accent-t + underline og understoetter as-prop", () => {
  const src = read("Link.jsx");
  assert.match(src, /text-cz-accent-t/);
  assert.match(src, /underline/);
  assert.match(src, /as:\s*As|as = /);
});
