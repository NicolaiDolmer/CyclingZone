// Tests for LocaleBundleBackend's sprog-normalisering (#5177).
//
// `bundleKey` afgoer om et namespace-opslag skal serveres fra den lazy danske
// chunk eller falde igennem til i18next-http-backend. Rammer den forkert, ender
// et opslag enten som 24 HTTP-kald eller som en unoedvendig chunk-hentning.
//
// Selve `read()` testes ikke her: den ville trigge `import("./messages.da.js")`,
// som importerer JSON uden `with { type: "json" }` — lovligt i Vite, men ikke i
// bar Node ESM. Adfaerden er daekket af buildet (chunken emitteres) og af
// e2e-sprogskiftet.

import test from "node:test";
import assert from "node:assert/strict";
import { bundleKey } from "./localeBundleBackend.js";

test("dansk har en lazy bundle", () => {
  assert.equal(bundleKey("da"), "da");
});

test("regionale koder normaliseres til basis-sproget", () => {
  assert.equal(bundleKey("da-DK"), "da");
  assert.equal(bundleKey("DA"), "da");
  assert.equal(bundleKey("  da-dk  "), "da");
});

test("engelsk har INGEN lazy bundle — det ligger inline i resources", () => {
  assert.equal(bundleKey("en"), null);
  assert.equal(bundleKey("en-GB"), null);
});

test("pseudo-locale falder igennem til den inline engelske", () => {
  assert.equal(bundleKey("en-XA"), null);
});

test("ukendt/ugyldigt input giver null i stedet for at kaste", () => {
  assert.equal(bundleKey("de"), null);
  assert.equal(bundleKey(""), null);
  assert.equal(bundleKey(undefined), null);
  assert.equal(bundleKey(null), null);
  assert.equal(bundleKey(42), null);
});

test("prototype-noegler kan ikke lække en 'bundle'", () => {
  assert.equal(bundleKey("constructor"), null);
  assert.equal(bundleKey("__proto__"), null);
});
