import test from "node:test";
import assert from "node:assert/strict";
import { getRiderAge, ageBadgeKey, isU23 } from "./riderAge.js";

// Fast referencepunkt så testen er deterministisk uafhængigt af kørselsdato.
const NOW = new Date("2026-06-15T12:00:00Z");

test("getRiderAge — alder = år-differens, null ved manglende fødselsdato", () => {
  assert.equal(getRiderAge("2000-01-01", NOW), 26);
  assert.equal(getRiderAge("2004-12-31", NOW), 22);
  assert.equal(getRiderAge(null, NOW), null);
  assert.equal(getRiderAge(undefined, NOW), null);
});

test("ageBadgeKey — <23 → u23 (yngste gældende)", () => {
  assert.equal(ageBadgeKey({ birthdate: "2004-06-01" }, NOW), "u23"); // 22
  assert.equal(ageBadgeKey({ birthdate: "2010-01-01" }, NOW), "u23"); // 16
});

test("ageBadgeKey — 23–24 → u25", () => {
  assert.equal(ageBadgeKey({ birthdate: "2003-01-01" }, NOW), "u25"); // 23
  assert.equal(ageBadgeKey({ birthdate: "2002-01-01" }, NOW), "u25"); // 24
});

test("ageBadgeKey — ≥25 → ingen alders-badge", () => {
  assert.equal(ageBadgeKey({ birthdate: "2001-01-01" }, NOW), null); // 25
  assert.equal(ageBadgeKey({ birthdate: "1990-01-01" }, NOW), null); // 36
});

test("ageBadgeKey — robust ved manglende rytter/fødselsdato", () => {
  assert.equal(ageBadgeKey(null, NOW), null);
  assert.equal(ageBadgeKey({}, NOW), null);
  assert.equal(ageBadgeKey({ birthdate: null }, NOW), null);
});

// #42: U23-filter-grænsen SKAL matche u23-badge (alder < 23). En 23-årig bærer
// u25-badge og må derfor ikke matche U23 — det var bug'en (filter brugte ≤23).
test("isU23 — alder < 23 (≤22 år) er U23", () => {
  assert.equal(isU23("2004-06-01", NOW), true);  // 22
  assert.equal(isU23("2010-01-01", NOW), true);  // 16
});

test("isU23 — boundary: præcis 23 år er IKKE U23 (bærer u25-badge)", () => {
  // 23-årig: født CURRENT_YEAR-23. Skal ekskluderes fra U23, men u25-badge.
  assert.equal(isU23("2003-01-01", NOW), false); // 23 → ikke U23
  assert.equal(ageBadgeKey({ birthdate: "2003-01-01" }, NOW), "u25"); // men u25
  assert.equal(isU23("2002-01-01", NOW), false); // 24 → ikke U23
});

test("isU23 — robust ved manglende fødselsdato", () => {
  assert.equal(isU23(null, NOW), false);
  assert.equal(isU23(undefined, NOW), false);
});
