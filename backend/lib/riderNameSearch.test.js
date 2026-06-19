import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeNameToken, nameSearchTokens, applyNameSearch } from "./riderNameSearch.js";

function mockQuery() {
  const calls = [];
  const q = { or(s) { calls.push(s); return q; }, _calls: calls };
  return q;
}

test("nameSearchTokens splitter på whitespace og dropper tomme", () => {
  assert.deepEqual(nameSearchTokens("Tadej Pog"), ["Tadej", "Pog"]);
  assert.deepEqual(nameSearchTokens("  Tadej   Pogacar  "), ["Tadej", "Pogacar"]);
  assert.deepEqual(nameSearchTokens(""), []);
  assert.deepEqual(nameSearchTokens(null), []);
});

test("sanitizeNameToken fjerner injektions-tegn + wildcards, bevarer navne-tegn", () => {
  assert.equal(sanitizeNameToken("a,b"), "ab");
  assert.equal(sanitizeNameToken("(x)"), "x");
  assert.equal(sanitizeNameToken("50%"), "50");
  assert.equal(sanitizeNameToken("a_b"), "ab");
  assert.equal(sanitizeNameToken("a\\b"), "ab");
  assert.equal(sanitizeNameToken("a*b"), "ab");
  assert.equal(sanitizeNameToken("O'Brien-Smith"), "O'Brien-Smith");
  assert.equal(sanitizeNameToken("Pogačar"), "Pogačar");
});

test("applyNameSearch bygger ét or-kald pr. token", () => {
  const q = applyNameSearch(mockQuery(), "Tadej Pog");
  assert.deepEqual(q._calls, [
    "firstname.ilike.%Tadej%,lastname.ilike.%Tadej%",
    "firstname.ilike.%Pog%,lastname.ilike.%Pog%",
  ]);
});

test("applyNameSearch med tom / kun-metakarakter q tilføjer intet filter", () => {
  assert.deepEqual(applyNameSearch(mockQuery(), "")._calls, []);
  assert.deepEqual(applyNameSearch(mockQuery(), "   ")._calls, []);
  assert.deepEqual(applyNameSearch(mockQuery(), ",,,")._calls, []);
});

test("injektions-token kan ikke åbne en ny or-betingelse", () => {
  const q = applyNameSearch(mockQuery(), "x,or(id.gt.0)");
  assert.equal(q._calls.length, 1);
  assert.equal(q._calls[0], "firstname.ilike.%xorid.gt.0%,lastname.ilike.%xorid.gt.0%");
  assert.ok(!/[()]/.test(q._calls[0]));
});
