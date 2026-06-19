import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1531 — skadede ryttere skal have et synligt skade-badge i Status-kolonnen
// både på eget hold (TeamPage) og på andres hold (TeamProfilePage). Badget
// rendres af RiderBadges med nøglen "injured", og kræver at injured_until hentes
// (rider_condition-embed via CONDITION_SELECT) + flades op (flattenCondition).
// Tabes embeddet eller badge-kaldet, forsvinder skade-badget stille — denne
// kilde-test holder os ærlige (samme mønster som TeamPage.fields.test.js #1482).

const __dirname = dirname(fileURLToPath(import.meta.url));
const teamPage = readFileSync(join(__dirname, "TeamPage.jsx"), "utf8");
const teamProfile = readFileSync(join(__dirname, "TeamProfilePage.jsx"), "utf8");

for (const [name, source] of [["TeamPage", teamPage], ["TeamProfilePage", teamProfile]]) {
  test(`${name} embedder skade-status via CONDITION_SELECT (#1531)`, () => {
    assert.match(
      source,
      /\$\{CONDITION_SELECT\}/,
      `${name} skal embedde CONDITION_SELECT (rider_condition(injured_until)) — uden det kan skade-badget aldrig vises`,
    );
  });

  test(`${name} flader skade-status op med flattenCondition (#1531)`, () => {
    assert.match(
      source,
      /flattenCondition/,
      `${name} skal mappe fetchede ryttere gennem flattenCondition, så rider.injured_until virker i isRiderInjured`,
    );
  });

  test(`${name} sender "injured"-badget til RiderBadges når skadet (#1531)`, () => {
    assert.match(
      source,
      /isRiderInjured\(r\.injured_until\)\s*&&\s*"injured"/,
      `${name} skal give RiderBadges en "injured"-nøgle gated på isRiderInjured(r.injured_until)`,
    );
  });
}
