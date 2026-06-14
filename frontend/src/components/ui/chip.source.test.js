import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Chip.jsx"), "utf8");

test("Chip bruger chipClass og forwarder rest-props", () => {
  assert.match(src, /chipClass\(/);
  assert.match(src, /\.\.\.rest/);
});

test("Chip har en valgfri ikon-slot (aria-hidden)", () => {
  assert.match(src, /icon/);
  assert.match(src, /aria-hidden/);
});
