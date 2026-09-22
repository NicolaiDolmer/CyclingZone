// CYCLINGZONE-66/67: et 2xx uden JSON-krop må aldrig nå state som null.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeActionSummary } from "./actionSummaryShape.js";

test("null/ikke-objekt/forkert form afvises (kaldstedet beholder forrige state)", () => {
  assert.equal(normalizeActionSummary(null), null);
  assert.equal(normalizeActionSummary(undefined), null);
  assert.equal(normalizeActionSummary("<html>"), null);
  assert.equal(normalizeActionSummary({}), null);
  assert.equal(normalizeActionSummary({ transfer_offers: [] }), null);
});

test("gyldigt svar passerer uændret igennem", () => {
  const data = {
    transfer_offers: [{ id: 1 }],
    swap_offers: [],
    counts: { transfer_offers: 1, swap_offers: 0, total: 1 },
  };
  assert.deepEqual(normalizeActionSummary(data), data);
});

test("manglende counts udledes af listerne", () => {
  const out = normalizeActionSummary({ transfer_offers: [{}, {}], swap_offers: [{}] });
  assert.deepEqual(out.counts, { transfer_offers: 2, swap_offers: 1, total: 3 });
});

test("hooket sender res.data gennem formvagten, aldrig direkte i state", () => {
  const src = readFileSync(new URL("../hooks/useActionSummary.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /setPending\(res\.data\)/);
  assert.match(src, /normalizeActionSummary\(res\.data\)/);
});
