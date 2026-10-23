import test from "node:test";
import assert from "node:assert/strict";
import { scoutSortValue } from "./scouting.js";
test("unknown academy prognosis cannot be sorted using a stale scout estimate", () => {
  assert.equal(scoutSortValue({ academyPrognosis: { band: null }, lo: 6, hi: 6, prog: { lo: 90, hi: 99 } }), null);
});
test("academy sort uses exactly the displayed academy band", () => {
  assert.equal(scoutSortValue({ academyPrognosis: { band: { lo: 31, hi: 57 } }, lo: 6, hi: 6 }), 44);
});
