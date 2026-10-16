import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Tooltip.jsx"), "utf8");

test("Tooltip er group-ankret med role=tooltip + tooltipClass", () => {
  assert.match(src, /className="group relative/);
  assert.match(src, /role="tooltip"/);
  assert.match(src, /tooltipClass\(/);
});

test("open tvinger boblen synlig (kitchen-sink/snapshot)", () => {
  assert.match(src, /active \|\| open/);
  assert.match(src, /opacity-100!/);
});

// #6728: en lukket boble maa ikke ligge usynligt i siden, ellers kan den goere
// siden bredere end skaermen (loebssiden var 461 px bred paa 375 px).
test("lukket boble renderes ikke; aaben boble ligger i en Portal med fixed position", () => {
  assert.match(src, /\{visible && \(/);
  assert.match(src, /<Portal>/);
  assert.match(src, /position: "fixed"/);
  assert.match(src, /placeTooltip\(/);
});

// Codex-review #6734: boblen skal maales med det endelige bredde-loft, ellers
// passer hoejden ikke paa skaerme under 336 px.
test("bredde-loftet saettes foer boblen maales", () => {
  const set = src.indexOf("bubble.style.maxWidth");
  const measure = src.indexOf("bubble.getBoundingClientRect()");
  assert.ok(set > 0 && measure > set, "maxWidth skal saettes foer getBoundingClientRect");
});
