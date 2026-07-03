import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #261 — hver dual-slider skal have to-vejs-synkede tal-inputs (min/max) som
// supplement til slideren. Kilde-inspektion (samme mønster som de øvrige
// *.source/*.test.js her): DOM-testing-lib er ikke sat op i frontend/.
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "RiderFilters.jsx"),
  "utf8",
);

test("DualStatSlider har number-inputs for både min og max (#261)", () => {
  const min = src.match(/data-testid={`stat-min-\$\{statKey\}`}/);
  const max = src.match(/data-testid={`stat-max-\$\{statKey\}`}/);
  assert.ok(min, "mangler stat-min number-input");
  assert.ok(max, "mangler stat-max number-input");
  assert.match(src, /type="number"/, "tal-input skal være type=number");
});

test("tal-inputtene deler _min/_max state-nøgler med slideren (to-vejs sync)", () => {
  // commitMinInput/commitMaxInput skal committe til samme minKey/maxKey som
  // slideren — dvs. genbruge commitMin/commitMax, ikke egne nøgler.
  assert.match(src, /const commitMinInput = /);
  assert.match(src, /const commitMaxInput = /);
  assert.match(src, /commitMinInput\b/);
  assert.match(src, /commitMaxInput\b/);
  // Ingen nye _min/_max-nøgler ud over de eksisterende minKey/maxKey.
  assert.match(src, /const minKey = `\$\{statKey\}_min`/);
  assert.match(src, /const maxKey = `\$\{statKey\}_max`/);
});

test("tal-input er additivt — slideren beholdes (#261)", () => {
  const rangeInputs = src.match(/type="range"/g) || [];
  assert.equal(rangeInputs.length, 2, "begge range-sliders skal stadig findes");
});

test("tal-input klampes til 0-99 og respekterer min<=max", () => {
  assert.match(src, /function clampStat\(/);
  assert.match(src, /Math\.min\(Math\.max\(n, floor\), ceil\)/);
  // min-input må ikke overstige localMax; max-input må ikke gå under localMin.
  assert.match(src, /ceil: localMax/);
  assert.match(src, /floor: localMin/);
});

test("tal-input har tilgængeligt aria-label pr. evne", () => {
  assert.match(src, /aria-label={t\("stats\.minInput", \{ label \}\)}/);
  assert.match(src, /aria-label={t\("stats\.maxInput", \{ label \}\)}/);
});
