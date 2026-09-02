import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "FilterBar.jsx"), "utf8");

// #4625 (slice 3 af #4622, TASTE fork 1) — ét idiom for T2-filterlinjer: søg +
// maks 3 selects + "More filters" lukket som standard. Erstatter håndrullede
// paneler med 8-12 aabne felter (audit 2026-09: Ryttere, Auktioner, Transfers).
test("FilterBar kaster i dev over 3 filtre", () => {
  assert.match(src, /filters\.length > 3/);
  assert.match(src, /throw new Error/);
});

test("FilterBar bruger sm-Select/Input og et lukket details/summary for 'more filters'", () => {
  assert.match(src, /size="sm"/);
  assert.match(src, /<details open=\{moreDefaultOpen\}/);
  assert.match(src, /moreDefaultOpen = false/, "More filters skal vaere lukket som standard");
  assert.match(src, /<summary/);
});

test("FilterBar's soegefelt er en Input, ikke en haandrullet <input>", () => {
  assert.match(src, /import Input from "\.\/Input\.jsx"/);
  assert.match(src, /<Input\b/);
});
