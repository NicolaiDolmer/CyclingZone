import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRiderRankingLink,
  resolveDivisionSelectionFromParams,
  ALL_DIVISIONS_VALUE,
} from "./riderRankingDivisionLink.js";

test("buildRiderRankingLink: division + pool present → both encoded in the URL", () => {
  assert.equal(buildRiderRankingLink({ division: 8, poolId: 42 }), "/standings?tab=riders&division=8&pool=42");
});

test("buildRiderRankingLink: division only (no pool sub-tabs for that tier)", () => {
  assert.equal(buildRiderRankingLink({ division: 2 }), "/standings?tab=riders&division=2");
});

test("buildRiderRankingLink: no team context → unscoped link (pre-#3507 fallback behaviour)", () => {
  assert.equal(buildRiderRankingLink({}), "/standings?tab=riders");
  assert.equal(buildRiderRankingLink(), "/standings?tab=riders");
  assert.equal(buildRiderRankingLink({ division: null, poolId: null }), "/standings?tab=riders");
});

test("buildRiderRankingLink: division=0 is a valid tier, not treated as falsy/absent", () => {
  // Divisions are 1-indexed today (RULES_NUMBERS.minDivision), but the
  // function itself must not special-case 0 — only null/undefined mean "unknown".
  assert.equal(buildRiderRankingLink({ division: 0 }), "/standings?tab=riders&division=0");
});

test("resolveDivisionSelectionFromParams: absent division param → no filter", () => {
  assert.deepEqual(resolveDivisionSelectionFromParams(null, null), { tier: null, poolId: null });
  assert.deepEqual(resolveDivisionSelectionFromParams(undefined, undefined), { tier: null, poolId: null });
});

test(`resolveDivisionSelectionFromParams: division=${ALL_DIVISIONS_VALUE} → no filter`, () => {
  assert.deepEqual(resolveDivisionSelectionFromParams(ALL_DIVISIONS_VALUE, "some-pool"), { tier: null, poolId: null });
});

test("resolveDivisionSelectionFromParams: numeric division + pool → tier + poolId", () => {
  assert.deepEqual(resolveDivisionSelectionFromParams("8", "42"), { tier: 8, poolId: "42" });
});

test("resolveDivisionSelectionFromParams: division set, pool absent/all → poolId null (whole tier)", () => {
  assert.deepEqual(resolveDivisionSelectionFromParams("3", null), { tier: 3, poolId: null });
  assert.deepEqual(resolveDivisionSelectionFromParams("3", ALL_DIVISIONS_VALUE), { tier: 3, poolId: null });
});

test("resolveDivisionSelectionFromParams: invalid division fails open to 'no filter' (never a broken/empty list)", () => {
  assert.deepEqual(resolveDivisionSelectionFromParams("not-a-number", "42"), { tier: null, poolId: null });
});
