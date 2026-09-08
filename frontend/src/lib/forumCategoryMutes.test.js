// #5013 — abonnement pr. forum-kategori, delt klientlogik.
import test from "node:test";
import assert from "node:assert/strict";
import {
  FORUM_CATEGORY_KEYS,
  isSubscribableCategory,
  normalizeCategoryMutes,
  applyCategoryMute,
  isCategoryMuted,
  followedCategoryCount,
} from "./forumCategoryMutes.js";
import { FORUM_CATEGORY_ORDER } from "../components/forum/forumCategories.js";

test("isSubscribableCategory: alle kategorier, aldrig arkiv-filteret (#4492)", () => {
  for (const key of FORUM_CATEGORY_KEYS) assert.ok(isSubscribableCategory(key), key);
  assert.ok(!isSubscribableCategory("archive"));
  assert.ok(!isSubscribableCategory(""));
  assert.ok(!isSubscribableCategory(undefined));
});

// Kataloget deles med #4818. Testen findes fordi en egen liste her lod
// "roadmap" lande paa forumsiden uden at kunne slaas fra: en admin-only
// kategori kan alle stadig laese og svare i, saa alle skal kunne daempe den.
test("kataloget er #4818's — roadmap kan ogsaa foelges/daempes", () => {
  assert.deepEqual(FORUM_CATEGORY_KEYS, FORUM_CATEGORY_ORDER);
  assert.ok(isSubscribableCategory("roadmap"));
  assert.equal(normalizeCategoryMutes({}).length, FORUM_CATEGORY_ORDER.length);
  assert.ok(isCategoryMuted(
    applyCategoryMute(normalizeCategoryMutes({}), "roadmap", true),
    "roadmap"
  ));
});

test("normalizeCategoryMutes: tomt/defekt svar = følger alt (den sikre default)", () => {
  for (const payload of [null, undefined, {}, { categories: null }, { categories: [] }]) {
    const rows = normalizeCategoryMutes(payload);
    assert.deepEqual(rows.map((r) => r.category), FORUM_CATEGORY_KEYS);
    assert.ok(rows.every((r) => r.muted === false));
  }
});

test("normalizeCategoryMutes: kanonisk rækkefølge, ukendte kategorier ignoreres", () => {
  const rows = normalizeCategoryMutes({
    categories: [
      { category: "off_topic", muted: true },
      { category: "ancient_category", muted: true },
      { category: "archive", muted: true },
      { category: "general", muted: false },
    ],
  });
  assert.deepEqual(rows.map((r) => r.category), FORUM_CATEGORY_KEYS);
  assert.deepEqual(rows.filter((r) => r.muted).map((r) => r.category), ["off_topic"]);
});

test("applyCategoryMute + isCategoryMuted: optimistisk toggle rører kun én række", () => {
  const before = normalizeCategoryMutes({});
  const after = applyCategoryMute(before, "tactics", true);
  assert.ok(isCategoryMuted(after, "tactics"));
  assert.ok(!isCategoryMuted(after, "general"));
  assert.ok(!isCategoryMuted(before, "tactics")); // ingen mutation af input
  assert.ok(!isCategoryMuted(after, "archive")); // ukendt = følger
  assert.ok(!isCategoryMuted(applyCategoryMute(after, "tactics", false), "tactics"));
});

test("followedCategoryCount: tæller kategorier der IKKE er slået fra", () => {
  const all = normalizeCategoryMutes({});
  assert.equal(followedCategoryCount(all), FORUM_CATEGORY_KEYS.length);
  assert.equal(followedCategoryCount(applyCategoryMute(all, "questions", true)), FORUM_CATEGORY_KEYS.length - 1);
  assert.equal(followedCategoryCount(null), 0);
});
