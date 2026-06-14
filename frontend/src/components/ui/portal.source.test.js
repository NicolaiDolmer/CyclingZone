import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), "utf8");

test("Portal renderer via createPortal til document.body med SSR-guard", () => {
  const src = read("Portal.jsx");
  assert.match(src, /createPortal/);
  assert.match(src, /document\.body/);
  assert.match(src, /typeof document === "undefined"/);
});

test("useDismiss lytter paa mousedown + Escape og rydder op", () => {
  const src = read("useDismiss.js");
  assert.match(src, /addEventListener\("mousedown"/);
  assert.match(src, /"Escape"/);
  assert.match(src, /removeEventListener\("mousedown"/);
  assert.match(src, /removeEventListener\("keydown"/);
});
