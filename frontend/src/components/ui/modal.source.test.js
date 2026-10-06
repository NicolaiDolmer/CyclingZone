import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Modal.jsx"), "utf8");

test("Modal portaler, traper fokus via useModalA11y og ligger paa z-modal", () => {
  assert.match(src, /Portal/);
  assert.match(src, /useModalA11y/);
  assert.match(src, /z-modal/);
  assert.match(src, /role="dialog"/);
  assert.match(src, /aria-modal="true"/);
});

test("Modal lukker paa backdrop-klik og returnerer null naar lukket", () => {
  assert.match(src, /backdropClass\(/);
  assert.match(src, /onClick=\{onClose\}/);
  assert.match(src, /if \(!open\) return null/);
});

test("DialogSurface bruger panelClass + reveal-klasse + valgfri X-luk-knap", () => {
  assert.match(src, /export function DialogSurface|export const DialogSurface/);
  assert.match(src, /panelClass\(/);
  assert.match(src, /cz-overlay-panel/);
  assert.match(src, /XIcon/);
});

test("scrim er uden blur (A9)", () => {
  assert.ok(!/backdrop-blur/.test(src), "ingen backdrop-blur");
});
