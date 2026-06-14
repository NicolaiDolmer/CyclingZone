import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "IconBase.jsx"), "utf8");

test("IconBase foelger hus-spec (24-grid, stroke 2, currentColor, fill none)", () => {
  assert.match(src, /viewBox="0 0 24 24"/);
  assert.match(src, /strokeWidth=\{?2\}?|stroke-width="2"|strokeWidth="2"/);
  assert.match(src, /stroke="currentColor"/);
  assert.match(src, /fill="none"/);
  assert.match(src, /strokeLinecap="round"/);
});
