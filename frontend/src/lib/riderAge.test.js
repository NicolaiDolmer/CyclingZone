import test from "node:test";
import assert from "node:assert/strict";
import { getRiderAge, ageBadgeKey, isU23, isU25, ageForSeason } from "./riderAge.js";

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

// #2032/#109/#2073: sæson-drevet alder = referenceåret − fødselsår (cykelsport-
// konvention: alderen rytteren fylder i sæsonens kalenderår), IKKE wall-clock.
test("ageForSeason — referenceår − fødselsår", () => {
  assert.equal(ageForSeason("2000-01-01", 2026), 26);
  assert.equal(ageForSeason("2010-06-15", 2026), 16);
  // Sæson-drevet: samme rytter i en senere sæson er ældre uafhængigt af dags dato.
  assert.equal(ageForSeason("2010-06-15", 2030), 20);
});

test("ageForSeason — null ved manglende fødselsdato eller ugyldigt referenceår", () => {
  assert.equal(ageForSeason(null, 2026), null);
  assert.equal(ageForSeason(undefined, 2026), null);
  assert.equal(ageForSeason("2000-01-01", null), null);
  assert.equal(ageForSeason("2000-01-01", undefined), null);
  assert.equal(ageForSeason("2000-01-01", NaN), null);
});

test("getRiderAge delegerer til ageForSeason(now.getFullYear())", () => {
  // Uændret adfærd: getRiderAge = ageForSeason med now's kalenderår som referenceår.
  assert.equal(getRiderAge("2004-12-31", NOW), ageForSeason("2004-12-31", 2026));
  assert.equal(getRiderAge("2004-12-31", NOW), 22);
});

// #109/#2073: U25 sæson-afledt — < 25 år ved referenceåret ⇔ født > referenceår-25.
test("isU25 — sæson-alder < 25 er U25", () => {
  assert.equal(isU25("2010-06-15", 2026), true); // 16
  assert.equal(isU25("2005-06-15", 2026), true); // 21
  assert.equal(isU25("2002-01-01", 2026), true); // 24
});

test("isU25 — boundary: præcis 25 år er IKKE U25", () => {
  // 25-årig: født referenceår-25. birthYear = 2001 = 2026-25 → IKKE > 2026-25.
  assert.equal(isU25("2001-01-01", 2026), false); // 25
  assert.equal(isU25("2001-12-31", 2026), false); // stadig fødselsår 2001 → 25
  assert.equal(isU25("2000-06-15", 2026), false); // 26
});

test("isU25 — sæson-drevet: samme rytter kan falde ud af U25 ved sæsonskift", () => {
  // Født 2002 → U25 i 2026 (24), men IKKE i 2027 (25). Følger sæsonen, ikke fødselsdag.
  assert.equal(isU25("2002-06-15", 2026), true);  // 24
  assert.equal(isU25("2002-06-15", 2027), false); // 25
});

test("isU25 — robust ved manglende fødselsdato/ugyldigt referenceår", () => {
  assert.equal(isU25(null, 2026), false);
  assert.equal(isU25(undefined, 2026), false);
  assert.equal(isU25("2010-06-15", null), false);
  assert.equal(isU25("2010-06-15", NaN), false);
});
