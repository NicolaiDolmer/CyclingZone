import { test } from "node:test";
import assert from "node:assert/strict";
import { contractFilterMatches, parseContractFilter, CONTRACT_NONE } from "./contractFilter.js";

test("tomt filter eller ugyldig vaerdi er inaktiv og matcher alt", () => {
  assert.equal(parseContractFilter(""), null);
  assert.equal(parseContractFilter("abc"), null);
  assert.equal(contractFilterMatches(null, ""), true);
  assert.equal(contractFilterMatches(5, undefined), true);
});

test("'none' matcher kun ryttere uden kontrakt", () => {
  assert.equal(contractFilterMatches(null, CONTRACT_NONE), true);
  assert.equal(contractFilterMatches(undefined, CONTRACT_NONE), true);
  assert.equal(contractFilterMatches(3, CONTRACT_NONE), false);
});

test("saesonnummer matcher kontrakter der udloeber senest den saeson", () => {
  assert.equal(contractFilterMatches(3, "4"), true);
  assert.equal(contractFilterMatches(4, "4"), true);
  assert.equal(contractFilterMatches(5, "4"), false);
  assert.equal(contractFilterMatches("2", "4"), true);
});

test("saesonfilter udelukker ryttere uden kontrakt", () => {
  assert.equal(contractFilterMatches(null, "4"), false);
});
