import { test } from "node:test";
import assert from "node:assert/strict";
import { currencyForLocale, formatCurrency, formatDate } from "./intl.js";

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

// #3724 — ren dato ("YYYY-MM-DD", ingen klokkeslæt, fx sæson-start) må ALDRIG
// vise "dagen før" for en spiller vest for UTC. Testes eksplicit i en
// tidszone vest for UTC (Los Angeles), som er det tilfælde der udløste bugget:
// den gamle kode parsede strengen som UTC-midnat og formaterede den i lokal
// tid, hvilket rullede kalenderdagen en dag tilbage.
test("formatDate — ren dato-streng formateres til SAMME kalenderdag, uanset tidszone (#3724)", () => {
  const env = globalThis.process.env;
  const originalTz = env.TZ;
  env.TZ = "America/Los_Angeles"; // UTC-7/-8, vest for UTC
  try {
    const out = formatDate("2026-05-01", null, { day: "numeric", month: "short", year: "numeric" });
    assert.equal(normalize(out), "May 1, 2026");
  } finally {
    env.TZ = originalTz;
  }
});

test("formatDate — Date-instans og fuld ISO-timestamp er upåvirket af #3724-fixet", () => {
  const env = globalThis.process.env;
  const originalTz = env.TZ;
  env.TZ = "America/Los_Angeles";
  try {
    // Fuld timestamp (med klokkeslæt) skal STADIG konvertere til viewerens
    // lokale tidszone som normalt — kun rene YYYY-MM-DD-strenge er specialcaset.
    const out = formatDate("2026-05-01T23:00:00Z", null, { day: "numeric", month: "short", year: "numeric" });
    assert.equal(normalize(out), "May 1, 2026"); // 23:00 UTC = 16:00 PDT samme dag
  } finally {
    env.TZ = originalTz;
  }
});
