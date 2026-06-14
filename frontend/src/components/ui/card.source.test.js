import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Card.jsx"), "utf8");

test("Card er hairline (border + cz-card), skarp radius, ingen glow", () => {
  assert.match(src, /border-cz-border/);
  assert.match(src, /bg-cz-card/);
  assert.match(src, /rounded-cz/);
  assert.ok(!/shadow-\[0_0/.test(src), "Card maa ikke have glow");
});
