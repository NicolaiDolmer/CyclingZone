import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findDoubleBraceViolations,
  valueHasDoubleBrace,
} from "./i18n-check-icu-braces.mjs";

test("flagger dobbelt-klamme-antipattern, ikke ICU enkelt-klamme", () => {
  const locale = {
    ok: "Season {number}",
    okPlain: "No placeholders here",
    nested: {
      bug: "Season {{number}}",
      multiBug: "{{auctions}} auctions · {{transfers}} transfers",
    },
  };

  assert.deepEqual(findDoubleBraceViolations(locale, "fixture.json"), [
    'fixture.json → nested.bug: "Season {{number}}"',
    'fixture.json → nested.multiBug: "{{auctions}} auctions · {{transfers}} transfers"',
  ]);
});

test("undtager inline ICU plural/select (legitim nesting kan give {{)", () => {
  // ICU other-branch der er praecis en placeholder → indeholder {{n}}, men er gyldig ICU.
  assert.equal(valueHasDoubleBrace("{n, plural, one {# day} other {{n} days}}"), false);
  assert.equal(valueHasDoubleBrace("{g, select, male {{name} is here} other {they are here}}"), false);
});

test("enkelt-klamme + plain tekst er rent", () => {
  assert.equal(valueHasDoubleBrace("Injured: {days}d left"), false);
  assert.equal(valueHasDoubleBrace("Plain text"), false);
  assert.equal(valueHasDoubleBrace(42), false);
});

test("fanger dot-path-placeholder", () => {
  assert.equal(valueHasDoubleBrace("{{rider.name}} crashed"), true);
});
