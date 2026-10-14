import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SENTRY_V10_COMPAT_OPTIONS } from "./sentryCompatOptions.js";

// #6607: Sentry 11's dataCollection-default er mere tilladende end v10 (IP,
// cookies, bodies). Baseline'en skal eksplicit holde v10's restriktive adfaerd.

test("v10-baseline: ingen bruger-IP, cookies eller bodies", () => {
  const { attachStacktrace, dataCollection } = SENTRY_V10_COMPAT_OPTIONS;
  assert.equal(attachStacktrace, false);
  assert.equal(dataCollection.userInfo, false);
  assert.equal(dataCollection.cookies, false);
  assert.deepEqual(dataCollection.httpBodies, []);
  assert.deepEqual(dataCollection.genAI, { inputs: false, outputs: false });
  for (const direction of ["request", "response"]) {
    assert.ok(dataCollection.httpHeaders[direction].deny.includes("forwarded"));
    assert.ok(dataCollection.httpHeaders[direction].deny.includes("-ip"));
  }
});

test("sentry.jsx spreder baseline'en ind i Sentry.init", () => {
  const source = readFileSync(new URL("./sentry.jsx", import.meta.url), "utf8");
  assert.match(source, /\.\.\.SENTRY_V10_COMPAT_OPTIONS/);
});
