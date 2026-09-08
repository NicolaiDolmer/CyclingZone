// #4818 — skrive-rettigheder pr. forum-kategori (visnings-laget).
import test from "node:test";
import assert from "node:assert/strict";
import {
  FORUM_CATEGORY_ORDER,
  forumCategoryPostRole,
  isAdminOnlyCategory,
  canCreateForumThread,
  postableForumCategories,
  showsNewThreadButton,
} from "./forumCategories.js";

test("roadmap ligger oeverst i raekkefoelgen", () => {
  assert.equal(FORUM_CATEGORY_ORDER[0], "roadmap");
  assert.equal(FORUM_CATEGORY_ORDER.length, 7);
  // "archive" er et filter, ikke en kategori — den maa aldrig snige sig ind her.
  assert.ok(!FORUM_CATEGORY_ORDER.includes("archive"));
});

test("forumCategoryPostRole: roadmap kraever admin, resten er aabne", () => {
  assert.equal(forumCategoryPostRole("roadmap"), "admin");
  for (const category of FORUM_CATEGORY_ORDER.filter((c) => c !== "roadmap")) {
    assert.equal(forumCategoryPostRole(category), "everyone", category);
  }
  // Ukendt kategori er aaben — CHECK-constrainten i DB afviser den, ikke denne regel.
  assert.equal(forumCategoryPostRole("nonsense"), "everyone");
  assert.equal(forumCategoryPostRole(undefined), "everyone");
});

test("isAdminOnlyCategory: kun roadmap", () => {
  assert.equal(isAdminOnlyCategory("roadmap"), true);
  assert.equal(isAdminOnlyCategory("general"), false);
  assert.equal(isAdminOnlyCategory(null), false);
});

test("canCreateForumThread: admin maa alt, spiller maa alt undtagen roadmap", () => {
  assert.equal(canCreateForumThread("roadmap", { isAdmin: true }), true);
  assert.equal(canCreateForumThread("roadmap", { isAdmin: false }), false);
  assert.equal(canCreateForumThread("general", { isAdmin: false }), true);
  assert.equal(canCreateForumThread("off_topic", { isAdmin: true }), true);
});

test("canCreateForumThread: fail closed paa alt der ikke er eksplicit true", () => {
  // Rollen er ikke hentet endnu (undefined), fejlede (null) eller kom som en
  // truthy streng fra et forkert felt — ingen af delene maa aabne roadmap.
  assert.equal(canCreateForumThread("roadmap"), false);
  assert.equal(canCreateForumThread("roadmap", {}), false);
  assert.equal(canCreateForumThread("roadmap", { isAdmin: undefined }), false);
  assert.equal(canCreateForumThread("roadmap", { isAdmin: null }), false);
  assert.equal(canCreateForumThread("roadmap", { isAdmin: "admin" }), false);
  assert.equal(canCreateForumThread("roadmap", { isAdmin: 1 }), false);
});

test("postableForumCategories: roadmap kun med i admins vaelger", () => {
  assert.deepEqual(postableForumCategories({ isAdmin: true }), FORUM_CATEGORY_ORDER);
  const playerChoices = postableForumCategories({ isAdmin: false });
  assert.ok(!playerChoices.includes("roadmap"));
  assert.equal(playerChoices.length, FORUM_CATEGORY_ORDER.length - 1);
  // Raekkefoelgen bevares naar roadmap filtreres fra.
  assert.equal(playerChoices[0], "general");
  assert.deepEqual(postableForumCategories(), playerChoices);
});

test("showsNewThreadButton: skjules kun paa roadmap-fanen for ikke-admin", () => {
  assert.equal(showsNewThreadButton("roadmap", { isAdmin: false }), false);
  assert.equal(showsNewThreadButton("roadmap", { isAdmin: true }), true);
  assert.equal(showsNewThreadButton("general", { isAdmin: false }), true);
  // "All"-fanen (tom kategori) og arkiv-filteret beholder knappen: der er
  // stadig et sted at skrive, og modalen vaelger selv en lovlig kategori.
  assert.equal(showsNewThreadButton("", { isAdmin: false }), true);
  assert.equal(showsNewThreadButton("archive", { isAdmin: false }), true);
});
