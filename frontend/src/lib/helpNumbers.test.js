// Drift guard for the hard numbers shown on /help (#1916).
//
// help.json used to hardcode the core economy/squad numbers in prose, so they
// drifted silently when a backend constant changed (#1907: startbudget 800k→500k,
// trup 8→12, præmie ×1500→×75). The tal-bearing strings now use ICU {placeholders}
// that HelpPage fills from RULES_NUMBERS, which is itself pinned to the backend
// constants by rulesNumbers.test.js. This test guards that wiring so /help can't
// drift the way /rules can't:
//   • buildHelpNumbers reflects RULES_NUMBERS        (closes the help→RULES_NUMBERS link)
//   • every {token} in help.json is a provided key   (nothing renders unresolved)
//   • every pinned key appears in both locales       (interpolation is actually wired)
//   • the old hardcoded numbers can't sneak back     (anti re-hardcode regression)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { RULES_NUMBERS } from "./rulesNumbers.js";
import { buildHelpNumbers, interpolateHelp, HELP_NUMBER_KEYS } from "./helpNumbers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(__dirname, "..", "..", "public", "locales");
const loadHelp = (lng) => JSON.parse(readFileSync(join(LOCALES, lng, "help.json"), "utf8"));
const EN = loadHelp("en");
const DA = loadHelp("da");

// Collect every leaf string in a nested JSON object (scans orphan keys too).
function collectStrings(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => collectStrings(n, out));
  else if (node && typeof node === "object") Object.values(node).forEach((n) => collectStrings(n, out));
  return out;
}

// ICU single-brace argument; never matches {count, plural, ...} (the comma breaks it).
const TOKEN_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
function tokensIn(strings) {
  const set = new Set();
  for (const s of strings) {
    for (const m of s.matchAll(TOKEN_RE)) set.add(m[1]);
  }
  return set;
}

test("buildHelpNumbers reflects RULES_NUMBERS (the help→RULES_NUMBERS pin)", () => {
  const en = buildHelpNumbers("en");
  assert.equal(en.startingBalance, RULES_NUMBERS.startingBalance.toLocaleString("en-US"));
  assert.equal(en.prizePerPoint, String(RULES_NUMBERS.prizePerPoint));
  assert.equal(en.squadCap, String(RULES_NUMBERS.squadCap));
  assert.equal(en.initialSquad, String(RULES_NUMBERS.initialSquadSize));
  assert.equal(en.academySlots, String(RULES_NUMBERS.academySlots));

  // Danish formats thousands with a dot; unknown languages fall back to en-US.
  assert.equal(buildHelpNumbers("da").startingBalance, RULES_NUMBERS.startingBalance.toLocaleString("da-DK"));
  assert.equal(buildHelpNumbers("fr").startingBalance, RULES_NUMBERS.startingBalance.toLocaleString("en-US"));
});

test("HELP_NUMBER_KEYS exactly covers buildHelpNumbers output", () => {
  assert.deepEqual([...HELP_NUMBER_KEYS].sort(), Object.keys(buildHelpNumbers("en")).sort());
});

for (const [lng, tree] of [["en", EN], ["da", DA]]) {
  const strings = collectStrings(tree);

  test(`[${lng}] every {token} in help.json is a known, provided key`, () => {
    const tokens = tokensIn(strings);
    assert.ok(tokens.size > 0, "expected at least one interpolated token");
    for (const tok of tokens) {
      assert.ok(HELP_NUMBER_KEYS.includes(tok), `unknown help token {${tok}} — would render literally`);
    }
  });

  test(`[${lng}] every pinned key appears at least once (interpolation wired)`, () => {
    const tokens = tokensIn(strings);
    for (const key of HELP_NUMBER_KEYS) {
      assert.ok(tokens.has(key), `{${key}} missing from ${lng}/help.json — number not pinned`);
    }
  });

  test(`[${lng}] no string renders an unresolved help token`, () => {
    const vars = buildHelpNumbers(lng);
    for (const s of strings) {
      const rendered = interpolateHelp(s, vars);
      assert.equal(tokensIn([rendered]).size, 0, `unresolved token in: ${s.slice(0, 80)}`);
    }
  });

  test(`[${lng}] old hardcoded numbers can't sneak back into prose`, () => {
    const blob = strings.join("\n");
    const forbidden = lng === "da"
      ? ["500.000 CZ$", "12-rytter", "× 75 CZ$", "= 75 CZ$"]
      : ["500,000 CZ$", "12-rider", "× 75 CZ$", "= 75 CZ$"];
    for (const f of forbidden) {
      assert.ok(!blob.includes(f), `re-hardcoded "${f}" in ${lng}/help.json — use the {placeholder}`);
    }
  });
}

test("end-to-end: rendered firstSteps prose carries the backend-derived numbers", () => {
  // sections.start.firstSteps.steps is a returnObjects array on /help (the path
  // i18next-icu does NOT interpolate, so HelpPage runs it through interpolateHelp).
  for (const [lng, tree] of [["en", EN], ["da", DA]]) {
    const vars = buildHelpNumbers(lng);
    const rendered = interpolateHelp(tree.sections.start.firstSteps.steps, vars).join("\n");
    assert.ok(rendered.includes(vars.startingBalance), `${lng}: startingBalance not rendered`);
    assert.ok(rendered.includes(vars.initialSquad), `${lng}: initialSquad not rendered`);
    assert.equal(tokensIn([rendered]).size, 0, `${lng}: unresolved token after render`);
  }
});
