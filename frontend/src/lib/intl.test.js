import { test } from "node:test";
import assert from "node:assert/strict";
import { currencyForLocale, formatCurrency } from "./intl.js";

// i18n er IKKE initialiseret i node:test → currentLocale() falder tilbage
// til "en", så default-stien kan testes deterministisk.

// Normalisér NBSP (U+00A0) / narrow NBSP (U+202F) til alm. space så tests
// ikke er skøre på tværs af ICU-versioner.
const normalize = (s) => s.replace(/[\u00A0\u202F]/g, " ");

test("currencyForLocale — da → DKK, alt andet → EUR (#1104)", () => {
  assert.equal(currencyForLocale("da"), "DKK");
  assert.equal(currencyForLocale("da-DK"), "DKK");
  assert.equal(currencyForLocale("en"), "EUR");
  assert.equal(currencyForLocale("en-GB"), "EUR");
  assert.equal(currencyForLocale("de"), "EUR");
});

test("currencyForLocale — uden argument bruges i18n-locale (fallback en → EUR)", () => {
  assert.equal(currencyForLocale(), "EUR");
});

test("formatCurrency — default-valuta følger locale (en → EUR)", () => {
  assert.equal(normalize(formatCurrency(6.57)), "€6.57");
  assert.equal(normalize(formatCurrency(1500, "DKK")), "DKK 1,500.00");
});

test("formatCurrency — fraction-digit options respekteres (hele beløb uden decimaler)", () => {
  assert.equal(
    normalize(formatCurrency(49, "DKK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })),
    "DKK 49"
  );
});
