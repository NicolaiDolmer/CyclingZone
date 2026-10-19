import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeNameToken, nameSearchTokens, applyNameSearch, buildAccentInsensitivePattern } from "./riderNameSearch.js";

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
    `firstname.imatch.${buildAccentInsensitivePattern("Tadej", { wordStart: true })},lastname.imatch.${buildAccentInsensitivePattern("Tadej", { wordStart: true })}`,
    `firstname.imatch.${buildAccentInsensitivePattern("Pog", { wordStart: true })},lastname.imatch.${buildAccentInsensitivePattern("Pog", { wordStart: true })}`,
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
  const p = buildAccentInsensitivePattern("xorid.gt.0", { wordStart: true });
  assert.equal(q._calls[0], `firstname.imatch.${p},lastname.imatch.${p}`);
  assert.ok(!/[()]/.test(q._calls[0]));
});

test("#5941: backend-moenstret er ord-praefiks og accent-ufoelsomt (samme kontrakt som frontend)", () => {
  const p = buildAccentInsensitivePattern("Lopez", { wordStart: true });
  assert.ok(p.startsWith("\\m"), "ord-start");
  const re = new RegExp(p.replace(/^\\m/, "(?:^|[^a-z0-9])"), "i");
  assert.ok(re.test("L\u00f3pez"), "accent-ufoelsom");
  const jong = new RegExp(buildAccentInsensitivePattern("ong", { wordStart: true }).replace(/^\\m/, "(?:^|[^a-z0-9])"), "i");
  assert.ok(!jong.test("Jong"), "ikke midt i ordet");
});
