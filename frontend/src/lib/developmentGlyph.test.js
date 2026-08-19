// developmentGlyph.test.js — #3721: pct() bag DevelopmentGlyph
// (components/development/DevelopmentGlyph.jsx). Testet her, ikke i .jsx-
// filen — `node --test` har ingen JSX-loader (samme mønster som
// lib/trainingReport.js ↔ AbilityReceiptRow.jsx).

import { test } from "node:test";
import assert from "node:assert/strict";
import { pct } from "./developmentGlyph.js";

test("#3721 pct: 0 og max mapper til 0% og 100%", () => {
  assert.equal(pct(0, 99), 0);
  assert.equal(pct(99, 99), 100);
});

test("#3721 pct: midtpunkt regner korrekt (49.5/99 -> 50%)", () => {
  assert.equal(pct(49.5, 99), 50);
});

test("#3721 pct: klampes til [0,100] for værdier uden for skalaen", () => {
  assert.equal(pct(-5, 99), 0);
  assert.equal(pct(150, 99), 100);
});

test("#3721 pct: null for ikke-endelige input (skelnes fra et reelt 0-tal)", () => {
  assert.equal(pct(null, 99), null);
  assert.equal(pct(undefined, 99), null);
  assert.equal(pct(NaN, 99), null);
  assert.equal(pct(50, 0), null);
  assert.equal(pct(50, null), null);
});

test("#3721 pct: respekterer et brugerdefineret max", () => {
  assert.equal(pct(5, 10), 50);
});
