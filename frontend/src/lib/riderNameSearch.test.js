import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeNameToken, nameSearchTokens, applyNameSearch, buildAccentInsensitivePattern,
} from "./riderNameSearch.js";

// Mock-query der opsamler .or()-kald (efterligner supabase-js's kæde-API).
function mockQuery() {
  const calls = [];
  const q = { or(s) { calls.push(s); return q; }, _calls: calls };
  return q;
}

test("nameSearchTokens splitter på whitespace og dropper tomme", () => {
  assert.deepEqual(nameSearchTokens("Tadej Pog"), ["Tadej", "Pog"]);
  assert.deepEqual(nameSearchTokens("  Tadej   Pogacar  "), ["Tadej", "Pogacar"]);
  assert.deepEqual(nameSearchTokens(""), []);
  assert.deepEqual(nameSearchTokens("   "), []);
  assert.deepEqual(nameSearchTokens(null), []);
});

test("sanitizeNameToken fjerner injektions-tegn + wildcards, bevarer navne-tegn", () => {
  assert.equal(sanitizeNameToken("a,b"), "ab");      // komma = or-betingelses-separator
  assert.equal(sanitizeNameToken("(x)"), "x");       // parentes = gruppering
  assert.equal(sanitizeNameToken("50%"), "50");      // % = ILIKE-wildcard
  assert.equal(sanitizeNameToken("a_b"), "ab");      // _ = ILIKE-single-char-wildcard
  assert.equal(sanitizeNameToken("a\\b"), "ab");     // backslash = escape-tegn
  assert.equal(sanitizeNameToken("a*b"), "ab");      // * = wildcard-alias
  // Legitime navne-tegn bevares (apostrof, bindestreg, diacritics):
  assert.equal(sanitizeNameToken("O'Brien-Smith"), "O'Brien-Smith");
  assert.equal(sanitizeNameToken("Pogačar"), "Pogačar");
});

test("applyNameSearch bygger ét or-kald pr. token, med imatch accent-fold-mønster", () => {
  const q = applyNameSearch(mockQuery(), "Tadej Pog");
  assert.deepEqual(q._calls, [
    `firstname.imatch.${buildAccentInsensitivePattern("Tadej")},lastname.imatch.${buildAccentInsensitivePattern("Tadej")}`,
    `firstname.imatch.${buildAccentInsensitivePattern("Pog")},lastname.imatch.${buildAccentInsensitivePattern("Pog")}`,
  ]);
});

// #4031: "Lopez" (uden accent) skal finde "López" (med accent) — samme
// normaliseringsfunktion driver RidersPage/Rider Database, RiderComparePage
// og AdminUsersTab (alle kalder applyNameSearch).
test("buildAccentInsensitivePattern — 'Lopez' matcher 'López' case-insensitivt", () => {
  const pattern = buildAccentInsensitivePattern("Lopez");
  const re = new RegExp(pattern, "i");
  assert.ok(re.test("López"), "skal matche López");
  assert.ok(re.test("LOPEZ"), "skal matche versaler");
  assert.ok(re.test("lopez"), "skal matche uden accent (uændret adfærd)");
});

test("buildAccentInsensitivePattern — 'Muller' matcher 'Müller', 'Broz' matcher 'Brož'", () => {
  assert.ok(new RegExp(buildAccentInsensitivePattern("Muller"), "i").test("Müller"));
  assert.ok(new RegExp(buildAccentInsensitivePattern("Broz"), "i").test("Brož"));
});

test("buildAccentInsensitivePattern escaper regex-metategn i navne-tegn (fx apostrof/bindestreg er sikre, punktum escapes)", () => {
  const pattern = buildAccentInsensitivePattern("O'Brien-Smith");
  const re = new RegExp(pattern, "i");
  assert.ok(re.test("O'Brien-Smith"));
  // Punktum i mønsteret må IKKE opføre sig som regex-wildcard.
  const dotPattern = buildAccentInsensitivePattern("a.b");
  assert.ok(new RegExp(dotPattern, "i").test("a.b"));
  assert.ok(!new RegExp(dotPattern, "i").test("axb"));
});

test("applyNameSearch — accent-fold-mønsteret bruges også ved referencedTable (evne-sortering)", () => {
  const q = applyNameSearch(mockQuery(), "Lopez", { referencedTable: "riders" });
  assert.equal(q._calls.length, 1);
  assert.ok(q._calls[0].startsWith("firstname.imatch."));
});

test("applyNameSearch med tom / kun-metakarakter q tilføjer intet filter", () => {
  assert.deepEqual(applyNameSearch(mockQuery(), "")._calls, []);
  assert.deepEqual(applyNameSearch(mockQuery(), "   ")._calls, []);
  assert.deepEqual(applyNameSearch(mockQuery(), ",,,")._calls, []);
});

test("injektions-token kan ikke åbne en ny or-betingelse", () => {
  // Ét token uden whitespace → præcis ét or-kald; komma+parentes strippes, så det
  // eneste komma i strengen er det vi selv indsætter mellem firstname/lastname.
  const q = applyNameSearch(mockQuery(), "x,or(id.gt.0)");
  assert.equal(q._calls.length, 1);
  const cleaned = buildAccentInsensitivePattern("xorid.gt.0");
  assert.equal(q._calls[0], `firstname.imatch.${cleaned},lastname.imatch.${cleaned}`);
  // Ingen parentes i den producerede streng (kun de escapede punktummer fra "id.gt.0").
  assert.ok(!/[()]/.test(q._calls[0]));
});
