import { test } from "node:test";
import assert from "node:assert/strict";
import { ratingChange } from "./xpRatingChange.ts";
import { ABILITY_KEYS } from "./abilities.js";
import { DISPLAY_RECIPES } from "./generated/displayRecipes.js";
import { riderBestRole } from "./riderRating.js";

// Invented, flat abilities: every ability on the same level, so the best-role
// rating is that level whatever the recipes' weights are.
const flat = (level: number): Record<string, number> => Object.fromEntries((ABILITY_KEYS as readonly string[]).map(k => [k, level]));
const allJump = (from: number, to: number) => Object.fromEntries((ABILITY_KEYS as readonly string[]).map(k => [k, { from, to }]));

test("#7947 rating before and after the date's points, the game's best-role rating", () => {
  assert.deepEqual(ratingChange(flat(41), allJump(40, 41)), { from: 40, to: 41 });
});

test("#7947 the rating is the same as riderBestRole on the same abilities", () => {
  const rider = { ...flat(40), sprint: 53, acceleration: 48 };
  const detail = { sprint: { from: 51, to: 53 }, acceleration: { from: 46, to: 48 } };
  const expectFrom = riderBestRole({ ...rider, sprint: 51, acceleration: 46 }).rating;
  const expectTo = riderBestRole({ ...rider, sprint: 53, acceleration: 48 }).rating;
  const got = ratingChange(rider, detail);
  if (expectFrom === expectTo) assert.equal(got, null);
  else assert.deepEqual(got, { from: expectFrom, to: expectTo });
});

test("#7947 a roster that moved on past the date gives nothing (no per-date snapshot, Codex P2)", () => {
  // The jumped ability no longer stands where the date left it: the rider trained since.
  assert.equal(ratingChange(flat(60), allJump(40, 41)), null);
  assert.equal(ratingChange({ ...flat(40), sprint: 43 }, { sprint: { from: 41, to: 42 } }), null);
});

test("#7947 a roster loaded before the date settled (at from) still shows the change (Codex P2 20/11)", () => {
  // "Train now" refreshes the receipts but not the roster: the roster still stands where the date found it.
  assert.deepEqual(ratingChange(flat(40), allJump(40, 41)), { from: 40, to: 41 });
  // Half before, half after belongs to no single moment: nothing.
  assert.equal(ratingChange({ ...flat(40), sprint: 41 }, { sprint: { from: 40, to: 41 }, climbing: { from: 40, to: 41 } }), null);
});

test("#7947 no change in the rating = nothing to show", () => {
  const counted = new Set(DISPLAY_RECIPES.flatMap(r => Object.keys(r.weights)));
  const uncounted = (ABILITY_KEYS as readonly string[]).find(k => !counted.has(k));
  if (uncounted) assert.equal(ratingChange({ ...flat(40), [uncounted]: 41 }, { [uncounted]: { from: 40, to: 41 } }), null);
  assert.equal(ratingChange(flat(40), { sprint: { from: 40, to: 40 } }), null);
});

test("#7947 without data nothing is shown, never an invented rating", () => {
  assert.equal(ratingChange(null, allJump(40, 41)), null);
  assert.equal(ratingChange(undefined, allJump(40, 41)), null);
  assert.equal(ratingChange(flat(40), null), null);
  assert.equal(ratingChange(flat(40), {}), null);
  assert.equal(ratingChange(flat(40), { sprint: { from: Number.NaN, to: 41 } }), null);
  assert.equal(ratingChange(flat(40), { sprint: null }), null);
  // A roster row without abilities (only the cached rating) cannot be rated per date.
  assert.equal(ratingChange({ best_role_rating: 70, best_role: "sprinter" }, { sprint: { from: 40, to: 41 } }), null);
  assert.equal(ratingChange({ sprint: null }, { sprint: { from: 40, to: 41 } }), null);
});
