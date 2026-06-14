import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Avatar.jsx"), "utf8");

test("Avatar bruger avatarClass + initialsFrom", () => {
  assert.match(src, /avatarClass\(/);
  assert.match(src, /initialsFrom\(/);
});

test("Avatar viser billede naar src er sat, ellers initialer", () => {
  assert.match(src, /src \?/);
  assert.match(src, /<img/);
  assert.match(src, /object-cover/);
});

test("Avatar er a11y-maerket (role=img + aria-label)", () => {
  assert.match(src, /role="img"/);
  assert.match(src, /aria-label=/);
});
