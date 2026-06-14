import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Toast.jsx"), "utf8");

test("Toast er role=status med toastClass, tone-ikon + valgfri X-luk", () => {
  assert.match(src, /export function Toast\b/);
  assert.match(src, /role="status"/);
  assert.match(src, /toastClass\(/);
  assert.match(src, /cz-toast-item/);
  assert.match(src, /XIcon/);
});

test("ToastViewport portaler, ligger paa z-toast og auto-afviser", () => {
  assert.match(src, /export function ToastViewport\b/);
  assert.match(src, /Portal/);
  assert.match(src, /z-toast/);
  assert.match(src, /setTimeout/);
  assert.match(src, /clearTimeout/);
});

test("ToastViewport-container er pointer-transparent (klik gaar igennem til siden)", () => {
  assert.match(src, /pointer-events-none fixed/);
});
