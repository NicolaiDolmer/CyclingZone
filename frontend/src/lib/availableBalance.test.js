import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReservedBalance, computeAvailableBalance, fetchReservedBalance } from "./availableBalance.js";

// #3508 — dashboard-headeren viste rå team.balance mens FinancePage viste
// disponibel saldo (rå minus bundet i førende auktionsbud + proxy-max).
// Denne fil dækker den delte, rene beregning (extraheret fra FinancePage's
// oprindelige #44-loop) så begge sider garanteret bruger samme tal.

test("#3508 computeReservedBalance: ingen auktioner og ingen proxy-bud giver 0", () => {
  assert.equal(computeReservedBalance([], []), 0);
  assert.equal(computeReservedBalance(undefined, undefined), 0);
});

test("#3508 computeReservedBalance: leading auktion uden proxy-bud reserverer current_price", () => {
  const leading = [{ id: "a1", current_price: 1000 }];
  assert.equal(computeReservedBalance(leading, []), 1000);
});

test("#3508 computeReservedBalance: leading auktion med lavere proxy-max end current_price bruger current_price (MAX)", () => {
  const leading = [{ id: "a1", current_price: 1000 }];
  const proxies = [{ auction_id: "a1", max_amount: 400, auction: { status: "active" } }];
  assert.equal(computeReservedBalance(leading, proxies), 1000);
});

test("#3508 computeReservedBalance: leading auktion med højere proxy-max end current_price bruger proxy-max (MAX)", () => {
  const leading = [{ id: "a1", current_price: 1000 }];
  const proxies = [{ auction_id: "a1", max_amount: 5000, auction: { status: "active" } }];
  assert.equal(computeReservedBalance(leading, proxies), 5000);
});

test("#3508 computeReservedBalance: ikke-leading proxy-bud på aktiv auktion reserverer proxy-max fuldt", () => {
  const proxies = [{ auction_id: "a2", max_amount: 2000, auction: { status: "extended" } }];
  assert.equal(computeReservedBalance([], proxies), 2000);
});

test("#3508 computeReservedBalance: proxy-bud på afsluttet/anden-status auktion tæller ikke med", () => {
  const proxies = [{ auction_id: "a3", max_amount: 3000, auction: { status: "completed" } }];
  assert.equal(computeReservedBalance([], proxies), 0);
});

test("#3508 computeReservedBalance: flere samtidige auktioner (leading + kun proxy) summeres korrekt", () => {
  // Prod-eksempel fra #3508: to aktive auktioner (185.112 + 5.911), reserveret ~191.023.
  const leading = [{ id: "a1", current_price: 185112 }];
  const proxies = [
    { auction_id: "a1", max_amount: 190000, auction: { status: "active" } }, // leading, proxy højere → MAX vinder
    { auction_id: "a2", max_amount: 5911, auction: { status: "active" } },   // ikke-leading, tæller fuldt
  ];
  assert.equal(computeReservedBalance(leading, proxies), 190000 + 5911);
});

test("#3508 computeAvailableBalance: trækker reserveret fra rå saldo", () => {
  assert.equal(computeAvailableBalance(316004, 191023), 316004 - 191023);
});

test("#3508 computeAvailableBalance: bunder aldrig under 0 (reserveret > rå saldo)", () => {
  assert.equal(computeAvailableBalance(1000, 5000), 0);
});

test("#3508 computeAvailableBalance: null/undefined balance eller reserveret behandles som 0", () => {
  assert.equal(computeAvailableBalance(null, undefined), 0);
  assert.equal(computeAvailableBalance(500, null), 500);
});

test("#3508 fetchReservedBalance: kører de to forventede queries (current_bidder_id + team_id) og bruger computeReservedBalance", async () => {
  const calls = [];
  const fakeSupabase = {
    from(table) {
      calls.push(table);
      const builder = {
        select() { return builder; },
        in() { return builder; },
        eq() { return builder; },
        then(resolve) {
          if (table === "auctions") return resolve({ data: [{ id: "a1", current_price: 1000 }] });
          if (table === "auction_proxy_bids") {
            return resolve({ data: [{ auction_id: "a2", max_amount: 250, auction: { status: "active" } }] });
          }
          return resolve({ data: [] });
        },
      };
      return builder;
    },
  };

  const reserved = await fetchReservedBalance(fakeSupabase, "team-123");
  assert.equal(reserved, 1000 + 250);
  assert.deepEqual(calls.sort(), ["auction_proxy_bids", "auctions"]);
});
