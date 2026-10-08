// #6237 — fælles disponibel-saldo-gate. Per-købssti-tests (scout target/mission,
// anlæg, ansættelse, fratrædelse, akademi-signing) ligger ved deres service-mocks:
// scoutAssignmentService.test.js, facilityService.test.js, academyIntake.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  INSUFFICIENT_AVAILABLE_BALANCE,
  fetchAuctionCommitment,
  getAvailableSpendIssue,
  checkAvailableSpend,
} from "./availableBalance.js";
import { auctionCommitmentTable } from "./availableBalanceMock.js";

function client({ leading = [], proxies = [], leadingError = null, proxiesError = null } = {}) {
  return {
    from(table) {
      const chain = auctionCommitmentTable(table, { leading, proxies });
      const err = table === "auctions" ? leadingError : proxiesError;
      if (err) chain.then = (resolve, reject) => Promise.resolve({ data: null, error: err }).then(resolve, reject);
      return chain;
    },
  };
}

test("getAvailableSpendIssue: ingen bud → ok", () => {
  assert.equal(getAvailableSpendIssue({ balance: 1000, commitment: 0, cost: 1000 }), null);
});

test("getAvailableSpendIssue: rå saldo for lav → insufficient_funds (uændret kode)", () => {
  assert.deepEqual(getAvailableSpendIssue({ balance: 999, commitment: 0, cost: 1000 }), { error: "insufficient_funds" });
});

test("getAvailableSpendIssue: nok rå saldo men låst i bud → insufficient_available_balance med locked/available", () => {
  assert.deepEqual(
    getAvailableSpendIssue({ balance: 1500, commitment: 600, cost: 1000 }),
    { error: INSUFFICIENT_AVAILABLE_BALANCE, locked: 600, available: 900 },
  );
});

test("getAvailableSpendIssue: præcis grænse (disponibel == pris) er ok", () => {
  assert.equal(getAvailableSpendIssue({ balance: 1500, commitment: 500, cost: 1000 }), null);
});

test("fetchAuctionCommitment: førende bud + proxy-lofter; proxy på afsluttet auktion ignoreres", async () => {
  const c = client({
    leading: [{ id: "a1", current_price: 400 }],
    proxies: [
      { auction_id: "a1", max_amount: 700, auction: { status: "active" } }, // max(400,700) = 700
      { auction_id: "a2", max_amount: 300, auction: { status: "extended" } }, // +300
      { auction_id: "a3", max_amount: 9999, auction: { status: "completed" } }, // ignoreres
    ],
  });
  assert.equal(await fetchAuctionCommitment(c, "team-1"), 1000);
});

test("fetchAuctionCommitment: læsefejl KASTER (fail closed på pengesti)", async () => {
  await assert.rejects(
    () => fetchAuctionCommitment(client({ leadingError: { message: "boom" } }), "team-1"),
    /could not load leading auctions/,
  );
  await assert.rejects(
    () => fetchAuctionCommitment(client({ proxiesError: { message: "boom" } }), "team-1"),
    /could not load proxy bids/,
  );
});

test("checkAvailableSpend: gratis køb slår ikke bud op; rå-saldo-fejl slår heller ikke bud op", async () => {
  const exploding = { from() { throw new Error("must not query"); } };
  assert.equal(await checkAvailableSpend(exploding, { teamId: "t", balance: 0, cost: 0 }), null);
  assert.deepEqual(await checkAvailableSpend(exploding, { teamId: "t", balance: 5, cost: 10 }), { error: "insufficient_funds" });
});

test("checkAvailableSpend: låst saldo afvises, fri saldo accepteres", async () => {
  const locked = client({ leading: [{ id: "a1", current_price: 400 }] });
  assert.equal((await checkAvailableSpend(locked, { teamId: "t", balance: 1000, cost: 700 })).error, INSUFFICIENT_AVAILABLE_BALANCE);
  assert.equal(await checkAvailableSpend(locked, { teamId: "t", balance: 1000, cost: 600 }), null);
});
