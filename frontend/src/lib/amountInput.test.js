import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmountInput, parseDecimalInput, parseAdjustmentValue } from "./amountInput.js";

// #3495: "150.000" (dansk tusindtalsseparator) blev til 150 — faktor 1000-fejl
// på rigtige penge. Denne suite dækker alle separator-varianter nævnt i
// issuet plus de tvetydige/edge-cases der skal AFVISES i stedet for gættes.

test("parseAmountInput — plain digits", () => {
  assert.deepEqual(parseAmountInput("150000"), { valid: true, value: 150000 });
  assert.deepEqual(parseAmountInput("0"), { valid: true, value: 0 });
  assert.deepEqual(parseAmountInput("5"), { valid: true, value: 5 });
});

test("parseAmountInput — dansk tusindtalsseparator (punktum) — den rapporterede bug", () => {
  assert.deepEqual(parseAmountInput("150.000"), { valid: true, value: 150000 });
  assert.deepEqual(parseAmountInput("1.680.000"), { valid: true, value: 1680000 });
  assert.deepEqual(parseAmountInput("1.234.567"), { valid: true, value: 1234567 });
});

test("parseAmountInput — komma som tusindtalsseparator", () => {
  assert.deepEqual(parseAmountInput("150,000"), { valid: true, value: 150000 });
  assert.deepEqual(parseAmountInput("1,234,567"), { valid: true, value: 1234567 });
});

test("parseAmountInput — mellemrum som tusindtalsseparator (inkl. nbsp)", () => {
  assert.deepEqual(parseAmountInput("150 000"), { valid: true, value: 150000 });
  assert.deepEqual(parseAmountInput("1 234 567"), { valid: true, value: 1234567 });
  assert.deepEqual(parseAmountInput("150 000"), { valid: true, value: 150000 });
});

test("parseAmountInput — blandet gruppering + decimal (europæisk/amerikansk stil)", () => {
  // Amerikansk: komma-gruppering + punktum-decimal, decimal er 0 → droppes
  assert.deepEqual(parseAmountInput("1,234,567.00"), { valid: true, value: 1234567 });
  // Europæisk: punktum-gruppering + komma-decimal, decimal er 0 → droppes
  assert.deepEqual(parseAmountInput("1.234.567,00"), { valid: true, value: 1234567 });
});

test("parseAmountInput — decimal med rene nuller er en harmløs heltalsnotation", () => {
  assert.deepEqual(parseAmountInput("150.00"), { valid: true, value: 150 });
  assert.deepEqual(parseAmountInput("150,00"), { valid: true, value: 150 });
  assert.deepEqual(parseAmountInput("150.0"), { valid: true, value: 150 });
});

test("parseAmountInput — tvetydig/reel decimal AFVISES, trunkeres ikke stiltiende", () => {
  assert.deepEqual(parseAmountInput("150.5"), { valid: false, value: null });
  assert.deepEqual(parseAmountInput("150,5"), { valid: false, value: null });
  assert.deepEqual(parseAmountInput("150.50"), { valid: false, value: null });
  // Blandet med en reel (ikke-nul) brøkdel skal også afvises
  assert.deepEqual(parseAmountInput("1,234,567.50"), { valid: false, value: null });
});

test("parseAmountInput — ugyldige grupperinger afvises frem for at gætte", () => {
  assert.deepEqual(parseAmountInput("150.00.0"), { valid: false, value: null }); // sidste gruppe ikke 3 cifre
  assert.deepEqual(parseAmountInput("1234.5678"), { valid: false, value: null }); // hverken gruppering eller ren decimal
  assert.deepEqual(parseAmountInput(".000"), { valid: false, value: null });
  assert.deepEqual(parseAmountInput("150."), { valid: false, value: null });
});

test("parseAmountInput — tomt/whitespace/null/undefined er ugyldigt", () => {
  assert.equal(parseAmountInput("").valid, false);
  assert.equal(parseAmountInput("   ").valid, false);
  assert.equal(parseAmountInput(null).valid, false);
  assert.equal(parseAmountInput(undefined).valid, false);
});

test("parseAmountInput — bogstaver, valutategn og fortegn afvises", () => {
  assert.equal(parseAmountInput("150k").valid, false);
  assert.equal(parseAmountInput("CZ$150000").valid, false);
  assert.equal(parseAmountInput("-150000").valid, false);
  assert.equal(parseAmountInput("+150000").valid, false);
  assert.equal(parseAmountInput("1e5").valid, false);
});

test("parseAmountInput — numerisk input (allerede parset) passerer kun hvis ikke-negativt heltal", () => {
  assert.deepEqual(parseAmountInput(150000), { valid: true, value: 150000 });
  assert.deepEqual(parseAmountInput(0), { valid: true, value: 0 });
  assert.equal(parseAmountInput(150.5).valid, false);
  assert.equal(parseAmountInput(-5).valid, false);
  assert.equal(parseAmountInput(NaN).valid, false);
});

test("parseAmountInput — meget store tal forbliver sikre heltal", () => {
  assert.deepEqual(parseAmountInput("999.999.999"), { valid: true, value: 999999999 });
});

test("parseAmountInput — allowNegative: signeret delta (fx swap cash_adjustment)", () => {
  assert.deepEqual(parseAmountInput("-150.000", { allowNegative: true }), { valid: true, value: -150000 });
  assert.deepEqual(parseAmountInput("-500", { allowNegative: true }), { valid: true, value: -500 });
  assert.deepEqual(parseAmountInput("500", { allowNegative: true }), { valid: true, value: 500 });
  assert.deepEqual(parseAmountInput(-500, { allowNegative: true }), { valid: true, value: -500 });
  assert.equal(parseAmountInput("-", { allowNegative: true }).valid, false);
});

test("parseAmountInput — negativt tal afvises når allowNegative er false (default)", () => {
  assert.equal(parseAmountInput("-150000").valid, false);
  assert.equal(parseAmountInput(-500).valid, false);
});

test("parseDecimalInput — accepterer ægte decimaler (procent-brug)", () => {
  assert.deepEqual(parseDecimalInput("10.5"), { valid: true, value: 10.5 });
  assert.deepEqual(parseDecimalInput("10,5"), { valid: true, value: 10.5 });
  assert.deepEqual(parseDecimalInput("-25"), { valid: true, value: -25 });
  assert.deepEqual(parseDecimalInput("100"), { valid: true, value: 100 });
});

test("parseDecimalInput — afviser tomt/ugyldigt", () => {
  assert.equal(parseDecimalInput("").valid, false);
  assert.equal(parseDecimalInput("abc").valid, false);
  assert.equal(parseDecimalInput(null).valid, false);
});

test("parseAdjustmentValue — mode-bevidst: percent tillader decimal, amount/set kræver heltals-parsing", () => {
  assert.deepEqual(parseAdjustmentValue("10.5", "percent"), { valid: true, value: 10.5 });
  assert.deepEqual(parseAdjustmentValue("150.000", "set"), { valid: true, value: 150000 });
  assert.deepEqual(parseAdjustmentValue("150.000", "amount"), { valid: true, value: 150000 });
  assert.equal(parseAdjustmentValue("150.5", "set").valid, false);
  assert.equal(parseAdjustmentValue("150.5", "amount").valid, false);
});

test("parseAdjustmentValue — amount er en delta og må være negativ, set er absolut og må ikke", () => {
  assert.deepEqual(parseAdjustmentValue("-500", "amount"), { valid: true, value: -500 });
  assert.deepEqual(parseAdjustmentValue("-1.500", "amount"), { valid: true, value: -1500 });
  assert.equal(parseAdjustmentValue("-500", "set").valid, false);
  assert.deepEqual(parseAdjustmentValue("-25", "percent"), { valid: true, value: -25 });
});
