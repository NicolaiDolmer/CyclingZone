// Selvtest for scripts/ci/deploy-verify-pr-lookup.mjs (#5424).
//
//   node --test scripts/ci/deploy-verify-pr-lookup.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { parsePrLookupResponse } from "./deploy-verify-pr-lookup.mjs";

test("parsePrLookupResponse: udtraekker nummeret fra en normal array med een PR", () => {
  const result = parsePrLookupResponse('[{"number": 1234}]');
  assert.deepEqual(result, { ok: true, number: "1234" });
});

// #5424: en commit uden nogen PR er en LOVLIG sti (direkte push, docs/chore) -
// den skal give et tomt nummer, ikke en fejl.
test("parsePrLookupResponse: tomt array (ingen PR paa commit'et) giver ok med tomt nummer", () => {
  const result = parsePrLookupResponse("[]");
  assert.deepEqual(result, { ok: true, number: "" });
});

test("parsePrLookupResponse: bruger foerste element naar flere PR'er er knyttet til commit'et", () => {
  const result = parsePrLookupResponse('[{"number": 42}, {"number": 43}]');
  assert.deepEqual(result, { ok: true, number: "42" });
});

// Rod-fejlen #5424 blev fundet for: gyldig JSON, men IKKE et array (fx en
// fejl-JSON paa et 200-svar). Foer fixet kastede `jq -r '.[0].number'` sin
// egen raa fejl her i stedet for den tilsigtede ::error::-tekst.
test("parsePrLookupResponse: JSON-objekt (ikke array) er transient, ikke en krasj", () => {
  const result = parsePrLookupResponse('{"message": "API rate limit exceeded"}');
  assert.deepEqual(result, { ok: false, transient: true, reason: "not-array" });
});

test("parsePrLookupResponse: tomt body er transient", () => {
  const result = parsePrLookupResponse("");
  assert.deepEqual(result, { ok: false, transient: true, reason: "empty" });
  const resultWhitespace = parsePrLookupResponse("   \n  ");
  assert.deepEqual(resultWhitespace, { ok: false, transient: true, reason: "empty" });
});

test("parsePrLookupResponse: null/undefined body behandles som tomt (transient)", () => {
  assert.deepEqual(parsePrLookupResponse(null), { ok: false, transient: true, reason: "empty" });
  assert.deepEqual(parsePrLookupResponse(undefined), { ok: false, transient: true, reason: "empty" });
});

test("parsePrLookupResponse: ugyldig JSON er transient, ikke en krasj", () => {
  const result = parsePrLookupResponse("not json at all");
  assert.deepEqual(result, { ok: false, transient: true, reason: "invalid-json" });
});

test("parsePrLookupResponse: array-element uden 'number'-felt giver tomt nummer (ok)", () => {
  const result = parsePrLookupResponse('[{"title": "no number here"}]');
  assert.deepEqual(result, { ok: true, number: "" });
});
