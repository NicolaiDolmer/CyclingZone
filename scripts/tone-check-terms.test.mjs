import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findLocaleTermViolations,
  findDocTermViolations,
  findPatchNotesTermViolations,
} from "./tone-check-terms.mjs";

test("locale scanner flags dead tier names", () => {
  const locale = {
    tierPatron: { name: "Patron" },
    waitlist: { proAnalyst: "Pro Analyst monthly" },
  };

  const found = findLocaleTermViolations(locale, "fixture.json");
  assert.equal(found.length, 2);
  assert.ok(found.some((v) => v.includes("Patron (tier-navn)")));
  assert.ok(found.some((v) => v.includes("Pro Analyst")));
});

test("locale scanner flags a bare 'Premium' value under a tier key", () => {
  const locale = { tierPremium: { name: "Premium" } };

  assert.deepEqual(findLocaleTermViolations(locale, "fixture.json"), [
    'fixture.json → tierPremium.name: Premium som tier-navn · "Premium"',
  ]);
});

test("locale scanner allows 'premium' as an ordinary word", () => {
  const locale = {
    sale: { colPremium: "Premium", caption: "Sale premium is the amount above market value" },
    promise: "Premium can unlock identity and convenience, never results",
  };

  assert.deepEqual(findLocaleTermViolations(locale, "fixture.json"), []);
});

test("doc scanner flags forbidden terms line by line", () => {
  const source = [
    "En linje om Founder Supporter.",
    "En linje om noget helt andet.",
    "Vi lover free forever.",
  ].join("\n");

  const found = findDocTermViolations(source, "fixture.md");
  assert.deepEqual(found, [
    "fixture.md:1: Founder Supporter · En linje om Founder Supporter.",
    "fixture.md:3: free forever · Vi lover free forever.",
  ]);
});

test("doc scanner respects disable blocks", () => {
  const source = [
    "<!-- tone-check-terms:disable -->",
    "| Pro Analyst | dødt tier-navn |",
    "<!-- tone-check-terms:enable -->",
    "Pro Analyst uden for blokken.",
  ].join("\n");

  assert.deepEqual(findDocTermViolations(source, "fixture.md"), [
    "fixture.md:4: Pro Analyst · Pro Analyst uden for blokken.",
  ]);
});

test("patch-notes scanner only covers entries from the freeze date onwards", () => {
  const patches = [
    {
      version: "9.0",
      date: "2026-09-10",
      changes: [{ en: { body: "The Patron tier is back" } }],
    },
    {
      version: "3.64",
      date: "2026-05-19",
      changes: [{ en: { body: "Four tiers: Free, Premium, Pro Analyst, Patron" } }],
    },
  ];

  const found = findPatchNotesTermViolations(
    patches,
    "patchNotes.js",
    "2026-09-08",
  );
  assert.equal(found.length, 1);
  assert.ok(found[0].includes("v9.0"));
  assert.ok(found[0].includes("Patron (tier-navn)"));
});
