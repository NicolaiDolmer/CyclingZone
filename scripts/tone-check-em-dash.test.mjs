import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findLocaleEmDashViolations,
  findProseEmDashViolations,
  findHtmlEmDashViolations,
} from "./tone-check-em-dash.mjs";

test("locale scanner flags prose em-dashes and allows standalone empty-value glyphs", () => {
  const locale = {
    emptyValue: "—",
    nested: {
      invalid: "Training is ready — choose a programme",
    },
  };

  assert.deepEqual(findLocaleEmDashViolations(locale, "fixture.json"), [
    'fixture.json → nested.invalid: "Training is ready — choose a programme"',
  ]);
});

test("prose scanner flags string literals with em-dashes", () => {
  const source = `
const heading = "Season ready — select your team";
const emptyValue = "—";
`;

  assert.deepEqual(findProseEmDashViolations(source, "FixturePage.jsx"), [
    'FixturePage.jsx:2: "Season ready — select your team"',
  ]);
});

test("prose scanner ignores comments and quoted empty-value glyph references", () => {
  const source = `
// Player copy — comments are not rendered.
const explanation = "The table used '—' for missing values";
`;

  assert.deepEqual(findProseEmDashViolations(source, "FixturePage.jsx"), []);
});

test("html scanner flags meta-tag em-dashes and ignores HTML comments + middots", () => {
  const source = [
    "<!-- fonts are self-hosted — no render-blocking link -->",
    '<meta name="description" content="Cycling Zone — fair manager MMO." />',
    '<meta property="og:title" content="Cycling Zone · Fair Cycling Manager" />',
  ].join("\n");

  assert.deepEqual(findHtmlEmDashViolations(source, "frontend/index.html"), [
    'frontend/index.html:2: <meta name="description" content="Cycling Zone — fair manager MMO." />',
  ]);
});
