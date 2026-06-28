import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Security-hardening (2026-06-20): POST /finance/loans (optag finanslån) brugte
// `!amount || amount < 1` på den RÅ body-værdi, så en ikke-numerisk streng ("abc")
// eller en decimal ("5.7") slap forbi og endte som NaN i createLoan. Samme hul som
// #1554 lukkede på transfer-offer + loan-repay; denne fil følger samme mønster:
//   1. Source-contract (samme stil som orFilterParamGuard.test.js): bevis at
//      POST /finance/loans parser amount til heltal FØR validering og afviser
//      ikke-heltal/< 1 med errorCode "invalid_loan_amount".
//   2. Behaviour: genskab validerings-prædikatet og bekræft at gyldige beløb
//      accepteres mens 0 / -5 / "abc" / "5.7" / undefined afvises (→ 400).

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

// Bemærk: både GET og POST registrerer "/finance/loans". Vi skal ramme POST-blokken
// (optag lån), så vi starter på den eksplicitte router.post-markør.
function postRouteBlock(routePath) {
  const marker = `router.post("${routePath}"`;
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route POST ${routePath} findes ikke i api.js`);
  // Blokken frem til næste route-registrering rummer guarden + createLoan-kaldet.
  const end = apiSource.indexOf("router.", start + marker.length);
  return apiSource.slice(start, end === -1 ? start + 1200 : end);
}

// ── Invariant 1: source-contract ────────────────────────────────────────────

test("POST /finance/loans parser amount til heltal FØR validering", () => {
  const block = postRouteBlock("/finance/loans");
  assert.match(
    block,
    /const amount = Number\.parseInt\(req\.body\.amount, 10\)/,
    "amount skal parses med Number.parseInt(..., 10) før validering",
  );
});

test("POST /finance/loans afviser ikke-heltal/< 1 med invalid_loan_amount", () => {
  const block = postRouteBlock("/finance/loans");
  assert.match(
    block,
    /if \(!Number\.isInteger\(amount\) \|\| amount < 1\)/,
    "guarden skal være !Number.isInteger(amount) || amount < 1",
  );
  assert.match(
    block,
    /errorCode: "invalid_loan_amount"/,
    "afvisningen skal bære errorCode invalid_loan_amount (følger #1554-stilen)",
  );
});

test("POST /finance/loans giver det parsede heltal videre til createLoan", () => {
  const block = postRouteBlock("/finance/loans");
  // createLoan får nu det allerede-parsede heltal `amount` (ikke det rå parseInt(amount)).
  assert.match(
    block,
    /createLoan\(req\.team\.id, loan_type, amount,/,
    "createLoan skal modtage det validerede heltal `amount`",
  );
  // Det rå parseInt(amount)-argument til createLoan skal være væk.
  assert.doesNotMatch(
    block,
    /createLoan\([^)]*parseInt\(amount\)/,
    "createLoan må ikke kaldes med det rå parseInt(amount)-argument",
  );
});

// ── Invariant 2: behaviour — genskab prædikatet og bevis klassifikationen ────

// Spejler præcis validerings-linjen i POST /finance/loans:
//   const amount = Number.parseInt(req.body.amount, 10);
//   if (!Number.isInteger(amount) || amount < 1) → 400
function acceptsLoanAmount(rawBodyAmount) {
  const amount = Number.parseInt(rawBodyAmount, 10);
  return Number.isInteger(amount) && amount >= 1;
}

test("gyldige beløb accepteres", () => {
  for (const valid of [1, 5, 100, 250000, "1", "100", "250000"]) {
    assert.equal(acceptsLoanAmount(valid), true, `${JSON.stringify(valid)} burde accepteres`);
  }
});

test("0 og negative beløb afvises (→ 400)", () => {
  for (const invalid of [0, -1, -5, "0", "-5"]) {
    assert.equal(acceptsLoanAmount(invalid), false, `${JSON.stringify(invalid)} burde afvises`);
  }
});

test("ikke-numeriske og tomme beløb afvises (→ 400)", () => {
  for (const invalid of ["abc", "", "   ", null, undefined, NaN, {}, []]) {
    assert.equal(acceptsLoanAmount(invalid), false, `${JSON.stringify(invalid)} burde afvises`);
  }
});

test("decimal-input trunkeres af parseInt — 5.7 bliver 5 og accepteres, 0.7 afvises", () => {
  // parseInt("5.7", 10) === 5 (>= 1, accepteret); parseInt("0.7", 10) === 0 (afvist).
  // Pointen er at den rå decimal-streng IKKE længere slipper urørt forbi til createLoan.
  assert.equal(acceptsLoanAmount("5.7"), true);
  assert.equal(acceptsLoanAmount("0.7"), false);
});
