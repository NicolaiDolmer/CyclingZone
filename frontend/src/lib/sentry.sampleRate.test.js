import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// sentry.jsx er en JSX-fil (SentryBoundary/AppErrorFallback bruger JSX), saa den
// kan ikke importeres direkte af "node --test" uden en JSX-loader (samme grund
// til at sentry.boundary.test.js laeser kilden som tekst i stedet for at
// importere modulet). toSampleRate() er heller ikke exporteret — den er en
// intern helper for Sentry.init-opsaetningen. Vi udtraekker funktionskroppen fra
// kildeteksten og evaluerer den rigtige funktion, saa testen kalder den ægte
// implementering (ikke en genskrevet kopi der kan afvige, #4970 CodeRabbit).
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sentry.jsx"), "utf8");

function extractToSampleRate() {
  const start = src.indexOf("function toSampleRate(");
  assert.ok(start > -1, "kunne ikke finde toSampleRate i sentry.jsx");
  const end = src.indexOf("\n}", start);
  assert.ok(end > start, "kunne ikke afgraense toSampleRate i sentry.jsx");
  const fnSource = src.slice(start, end + 2);
  const factory = new Function(`${fnSource}\nreturn toSampleRate;`);
  return factory();
}

const toSampleRate = extractToSampleRate();

// #4970 (CodeRabbit): tom streng, ikke-numeriske vaerdier og finite tal udenfor
// [0, 1] skal falde tilbage til `fallback`. @sentry/react kraever tal i [0, 1]
// for tracesSampleRate/replaysSessionSampleRate/replaysOnErrorSampleRate.
test("toSampleRate falder tilbage til fallback for tom streng", () => {
  assert.equal(toSampleRate("", 0.1), 0.1);
  assert.equal(toSampleRate("", 0), 0);
});

test("toSampleRate falder tilbage til fallback for ikke-numeriske vaerdier", () => {
  assert.equal(toSampleRate("not-a-number", 0.1), 0.1);
});

test("toSampleRate falder tilbage til fallback for tal under 0", () => {
  assert.equal(toSampleRate(-0.1, 0.1), 0.1);
  assert.equal(toSampleRate("-0.1", 0.1), 0.1);
});

test("toSampleRate falder tilbage til fallback for tal over 1", () => {
  assert.equal(toSampleRate(1.1, 0.1), 0.1);
  assert.equal(toSampleRate("1.1", 0.1), 0.1);
  assert.equal(toSampleRate("2", 0.1), 0.1);
});

test("toSampleRate bevarer gyldige graensevaerdier (0 og 1)", () => {
  assert.equal(toSampleRate(0, 0.1), 0);
  assert.equal(toSampleRate("0", 0.1), 0);
  assert.equal(toSampleRate(1, 0.1), 1);
  assert.equal(toSampleRate("1", 0.1), 1);
});

test("toSampleRate bevarer en gyldig vaerdi midt i intervallet", () => {
  assert.equal(toSampleRate(0.25, 0), 0.25);
  assert.equal(toSampleRate("0.25", 0), 0.25);
});

test("toSampleRate falder tilbage til fallback for undefined/null (uaendret adfaerd)", () => {
  assert.equal(toSampleRate(undefined, 0.1), 0.1);
  assert.equal(toSampleRate(null, 0.1), 0.1);
});
