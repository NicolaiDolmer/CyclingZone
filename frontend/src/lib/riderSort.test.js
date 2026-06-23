import { test } from "node:test";
import assert from "node:assert/strict";
import { cycleSortState, defaultSortDir, RIDER_SORT_KEYS } from "./riderSort.js";

// #1755 — delt sort-cyklus for alle rytter-oversigter. Holder den fælles
// klik-adfærd ærlig så ingen side genintroducerer en afvigende toggle.

test("klik på en NY nøgle skifter nøgle + bruger default-retning", () => {
  // Numerisk nøgle → desc først (dyrest/bedst øverst).
  assert.deepEqual(cycleSortState({ sort: "value", dir: "asc" }, "salary"), { sort: "salary", dir: "desc" });
  // Tekst/navn → asc først (A→Å).
  assert.deepEqual(cycleSortState({ sort: "value", dir: "desc" }, "firstname"), { sort: "firstname", dir: "asc" });
});

test("klik på den AKTIVE nøgle vender retning", () => {
  assert.deepEqual(cycleSortState({ sort: "salary", dir: "desc" }, "salary"), { sort: "salary", dir: "asc" });
  assert.deepEqual(cycleSortState({ sort: "salary", dir: "asc" }, "salary"), { sort: "salary", dir: "desc" });
});

test("defaultSortDir: tekst/kategori asc, numerisk desc", () => {
  assert.equal(defaultSortDir("firstname"), "asc");
  assert.equal(defaultSortDir("nationality_code"), "asc");
  assert.equal(defaultSortDir("primary_type"), "asc");
  assert.equal(defaultSortDir("value"), "desc");
  assert.equal(defaultSortDir("birthdate"), "desc");
});

test("tom/undefined current-state håndteres som ny nøgle", () => {
  assert.deepEqual(cycleSortState(undefined, "value"), { sort: "value", dir: "desc" });
  assert.deepEqual(cycleSortState({}, "firstname"), { sort: "firstname", dir: "asc" });
});

test("RIDER_SORT_KEYS dækker de kanoniske kerne-attributter (#1755)", () => {
  // Alder + ryttertype skal være med — det var den tilbagevendende mangel (#1674).
  assert.equal(RIDER_SORT_KEYS.age, "birthdate");
  assert.equal(RIDER_SORT_KEYS.type, "primary_type");
  assert.equal(RIDER_SORT_KEYS.value, "value");
  assert.equal(RIDER_SORT_KEYS.salary, "salary");
  assert.equal(RIDER_SORT_KEYS.nation, "nationality_code");
});
