import test from "node:test";
import assert from "node:assert/strict";

import { resolveLegacyFinanceMessage } from "./legacyFinanceMessage.js";

const cases = [
  [{ type: "sponsor", description: "Sponsor sæson 1" }, "tx.legacy.sponsor", { season: "1" }],
  [{ type: "salary", description: "Løn sæson 2" }, "tx.legacy.salary", { season: "2" }],
  [{ type: "prize", description: "Præmiepenge — Tour Test" }, "tx.legacy.prize", { raceName: "Tour Test" }],
  [{ type: "transfer_out", description: "Køb af Test Rider" }, "tx.legacy.transferPurchase", { detail: "Test Rider" }],
  [{ type: "transfer_in", description: "Salg af Test Rider" }, "tx.legacy.transferSale", { detail: "Test Rider" }],
  [{ type: "loan_received", description: "Lån optaget" }, "tx.legacy.loanReceived", {}],
  [{ type: "loan_repayment", description: "Låneafdrag" }, "tx.legacy.loanRepayment", {}],
  [{ type: "loan_interest", description: "Lånerente" }, "tx.legacy.loanInterest", {}],
  [{ type: "emergency_loan", description: "Nødlån oprettet" }, "tx.legacy.emergencyLoan", {}],
  [{ type: "bonus", description: "Divisionsbonus" }, "tx.legacy.bonus", {}],
  [{ type: "interest", description: "Renter på negativ saldo" }, "tx.legacy.interest", {}],
  [{ type: "admin_adjustment", description: "Admin justering" }, "tx.legacy.adminAdjustment", {}],
];

test("resolveLegacyFinanceMessage maps recognized Danish legacy rows to stable codes", () => {
  for (const [tx, code, params] of cases) {
    assert.deepEqual(resolveLegacyFinanceMessage(tx), { code, params });
  }
});

test("resolveLegacyFinanceMessage preserves existing structured metadata", () => {
  const metadata = { code: "tx.salary", params: { count: 8 } };
  assert.equal(resolveLegacyFinanceMessage({
    type: "salary",
    description: "Løn sæson 1",
    metadata,
  }), metadata);
});

test("resolveLegacyFinanceMessage uses localized type fallback for known types", () => {
  assert.deepEqual(
    resolveLegacyFinanceMessage({ type: "salary", description: "Historisk specialtekst" }),
    { typeKey: "transactions.type.salary" },
  );
});

test("resolveLegacyFinanceMessage keeps raw prose only for unknown types", () => {
  assert.deepEqual(
    resolveLegacyFinanceMessage({ type: "mystery", description: "Ukendt historisk tekst" }),
    { fallback: "Ukendt historisk tekst" },
  );
});
