import test from "node:test";
import assert from "node:assert/strict";

import {
  getPriceBandViolation,
  getSwapPriceBandViolation,
  readTransferPriceBandConfig,
  TRANSFER_PRICE_CAP_MULTIPLE_KEY,
  TRANSFER_PRICE_FLOOR_PCT_KEY,
} from "./transferPriceBand.js";

// ── getPriceBandViolation ─────────────────────────────────────────────────

test("getPriceBandViolation — disabled-state (floorPct=0, capMultiple=null) tillader alt", () => {
  assert.equal(getPriceBandViolation({ price: 1, marketValue: 1_000_000, floorPct: 0, capMultiple: null }), null);
  assert.equal(getPriceBandViolation({ price: 50_000_000, marketValue: 1_000_000, floorPct: 0, capMultiple: null }), null);
  assert.equal(getPriceBandViolation({ price: 0, marketValue: 1_000_000, floorPct: 0, capMultiple: null }), null);
});

test("getPriceBandViolation — afviser under gulv", () => {
  const issue = getPriceBandViolation({ price: 100_000, marketValue: 1_000_000, floorPct: 0.25, capMultiple: 3 });
  assert.ok(issue, "pris 100.000 < 25% af 1.000.000 (250.000) skal afvises");
  assert.equal(issue.code, "below_price_floor");
  assert.equal(issue.floorPrice, 250_000);
  assert.equal(issue.floorPct, 0.25);
  assert.equal(issue.marketValue, 1_000_000);
  assert.equal(issue.price, 100_000);
});

test("getPriceBandViolation — afviser over loft", () => {
  const issue = getPriceBandViolation({ price: 4_000_000, marketValue: 1_000_000, floorPct: 0.25, capMultiple: 3 });
  assert.ok(issue, "pris 4.000.000 > 3× af 1.000.000 (3.000.000) skal afvises");
  assert.equal(issue.code, "above_price_cap");
  assert.equal(issue.capPrice, 3_000_000);
  assert.equal(issue.capMultiple, 3);
});

test("getPriceBandViolation — tillader pris inden for båndet (grænseværdier inklusive)", () => {
  assert.equal(getPriceBandViolation({ price: 250_000, marketValue: 1_000_000, floorPct: 0.25, capMultiple: 3 }), null, "nøjagtig på gulvet skal tillades");
  assert.equal(getPriceBandViolation({ price: 3_000_000, marketValue: 1_000_000, floorPct: 0.25, capMultiple: 3 }), null, "nøjagtig på loftet skal tillades");
  assert.equal(getPriceBandViolation({ price: 500_000, marketValue: 1_000_000, floorPct: 0.25, capMultiple: 3 }), null);
});

test("getPriceBandViolation — kun gulv sat (capMultiple=null) håndhæver ikke loft", () => {
  assert.equal(getPriceBandViolation({ price: 100_000_000, marketValue: 1_000_000, floorPct: 0.25, capMultiple: null }), null);
  const issue = getPriceBandViolation({ price: 1, marketValue: 1_000_000, floorPct: 0.25, capMultiple: null });
  assert.equal(issue.code, "below_price_floor");
});

test("getPriceBandViolation — kun loft sat (floorPct=0) håndhæver ikke gulv", () => {
  assert.equal(getPriceBandViolation({ price: 1, marketValue: 1_000_000, floorPct: 0, capMultiple: 3 }), null);
  const issue = getPriceBandViolation({ price: 5_000_000, marketValue: 1_000_000, floorPct: 0, capMultiple: 3 });
  assert.equal(issue.code, "above_price_cap");
});

test("getPriceBandViolation — manglende/ugyldig market_value skipper tjekket (fail-open på datamangel)", () => {
  assert.equal(getPriceBandViolation({ price: 100, marketValue: 0, floorPct: 0.25, capMultiple: 3 }), null);
  assert.equal(getPriceBandViolation({ price: 100, marketValue: null, floorPct: 0.25, capMultiple: 3 }), null);
  assert.equal(getPriceBandViolation({ price: 100, marketValue: undefined, floorPct: 0.25, capMultiple: 3 }), null);
  assert.equal(getPriceBandViolation({ price: 100, marketValue: -5, floorPct: 0.25, capMultiple: 3 }), null);
  assert.equal(getPriceBandViolation({ price: 100, marketValue: NaN, floorPct: 0.25, capMultiple: 3 }), null);
});

// ── getSwapPriceBandViolation — cash_adjustment-summering ────────────────

test("getSwapPriceBandViolation — disabled-state tillader alt uanset cash_adjustment", () => {
  assert.equal(
    getSwapPriceBandViolation({
      offeredMarketValue: 10_000,
      requestedMarketValue: 2_000_000,
      cashAdjustment: 1_900_000,
      floorPct: 0,
      capMultiple: null,
    }),
    null,
  );
});

test("getSwapPriceBandViolation — afviser #2221-mønster: billig rytter + massiv kontant for dyr rytter (proposing over loft)", () => {
  // Reyes-cases fra #2776/#2221-familien: lav-værdi rytter + kontant sweetener
  // for en høj-værdi rytter. offered=10.000, cash=1.900.000 → proposing "betaler"
  // 1.910.000 for en rytter kun værd 200.000 → langt over 3×.
  const issue = getSwapPriceBandViolation({
    offeredMarketValue: 10_000,
    requestedMarketValue: 200_000,
    cashAdjustment: 1_900_000,
    floorPct: 0.25,
    capMultiple: 3,
  });
  assert.ok(issue, "1.910.000 for en 200.000-rytter er langt over 3× loftet");
  assert.equal(issue.code, "above_price_cap");
  assert.equal(issue.side, "proposing");
  assert.equal(issue.effectivePrice, 1_910_000);
  assert.equal(issue.comparedMarketValue, 200_000);
});

test("getSwapPriceBandViolation — negativ cash (receiving betaler proposing) fanges på proposing-benet når det presser prisen under gulvet", () => {
  // offered=1.000.000, requested=1.000.000, cash=-800.000 (receiving betaler
  // 800.000 til proposing oven i deres rytter).
  // proposingPaid = offered(1.000.000) + cash(-800.000) = 200.000 mod
  // requested=1.000.000 → 0,20× < 0,25 gulv → proposing modtog en samlet
  // modydelse (requested-rytter) der reelt kun "kostede" dem 200.000, langt
  // under gulvet. Fanges på proposing-benet, below_price_floor.
  const issue = getSwapPriceBandViolation({
    offeredMarketValue: 1_000_000,
    requestedMarketValue: 1_000_000,
    cashAdjustment: -800_000,
    floorPct: 0.25,
    capMultiple: 3,
  });
  assert.ok(issue);
  assert.equal(issue.side, "proposing");
  assert.equal(issue.code, "below_price_floor");
  assert.equal(issue.effectivePrice, 200_000);
});

test("getSwapPriceBandViolation — rammer receiving-benet når proposing overbetaler kontant oven i en lige-værdi-swap", () => {
  // offered=requested=1.000.000, cash=+1.000.000 (proposing betaler 1 mio.
  // OVEN I sin rytter for en lige så meget værd rytter tilbage).
  // proposingPaid = 1.000.000 + 1.000.000 = 2.000.000 mod requested=1.000.000
  // → 2× — inden for 3×-loftet, ingen violation på proposing-benet.
  // receivingPaid = requested(1.000.000) - cash(1.000.000) = 0 mod
  // offered=1.000.000 → receiving fik reelt rytteren GRATIS (0 < 25% gulv).
  // Netop den slags asymmetri (én side "generøs", den anden side får en rytter
  // foræret) skal dobbelt-tjekket fange, selvom proposing-siden alene ser fin ud.
  const issue = getSwapPriceBandViolation({
    offeredMarketValue: 1_000_000,
    requestedMarketValue: 1_000_000,
    cashAdjustment: 1_000_000,
    floorPct: 0.25,
    capMultiple: 3,
  });
  assert.ok(issue);
  assert.equal(issue.side, "receiving");
  assert.equal(issue.code, "below_price_floor");
  assert.equal(issue.effectivePrice, 0);
});

test("getSwapPriceBandViolation — ren rytter-for-rytter-swap uden cash inden for bånd tillades", () => {
  assert.equal(
    getSwapPriceBandViolation({
      offeredMarketValue: 1_000_000,
      requestedMarketValue: 1_100_000,
      cashAdjustment: 0,
      floorPct: 0.25,
      capMultiple: 3,
    }),
    null,
  );
});

test("getSwapPriceBandViolation — cash_adjustment=0 og lige værdier er altid tilladt selv med stramt bånd", () => {
  assert.equal(
    getSwapPriceBandViolation({
      offeredMarketValue: 500_000,
      requestedMarketValue: 500_000,
      cashAdjustment: 0,
      floorPct: 0.9,
      capMultiple: 1.1,
    }),
    null,
  );
});

// ── readTransferPriceBandConfig ───────────────────────────────────────────

test("readTransferPriceBandConfig — null/manglende supabase-klient falder tilbage til disabled", async () => {
  assert.deepEqual(await readTransferPriceBandConfig(null), { floorPct: 0, capMultiple: null });
  assert.deepEqual(await readTransferPriceBandConfig(undefined), { floorPct: 0, capMultiple: null });
});

test("readTransferPriceBandConfig — DB-fejl falder tilbage til disabled (fail-open)", async () => {
  const errClient = {
    from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: "boom" } }) }) }),
  };
  assert.deepEqual(await readTransferPriceBandConfig(errClient), { floorPct: 0, capMultiple: null });
});

test("readTransferPriceBandConfig — kastet exception falder tilbage til disabled", async () => {
  const throwingClient = {
    from: () => {
      throw new Error("network down");
    },
  };
  assert.deepEqual(await readTransferPriceBandConfig(throwingClient), { floorPct: 0, capMultiple: null });
});

test("readTransferPriceBandConfig — happy path parser begge numeriske nøgler", async () => {
  const client = {
    from: () => ({
      select: () => ({
        in: async () => ({
          data: [
            { key: TRANSFER_PRICE_FLOOR_PCT_KEY, value: 0.25 },
            { key: TRANSFER_PRICE_CAP_MULTIPLE_KEY, value: 3 },
          ],
          error: null,
        }),
      }),
    }),
  };
  assert.deepEqual(await readTransferPriceBandConfig(client), { floorPct: 0.25, capMultiple: 3 });
});

test("readTransferPriceBandConfig — kun én nøgle sat i DB → den anden default (0 / null)", async () => {
  const client = {
    from: () => ({
      select: () => ({
        in: async () => ({
          data: [{ key: TRANSFER_PRICE_FLOOR_PCT_KEY, value: 0.25 }],
          error: null,
        }),
      }),
    }),
  };
  assert.deepEqual(await readTransferPriceBandConfig(client), { floorPct: 0.25, capMultiple: null });
});

test("readTransferPriceBandConfig — ugyldige værdi-typer (string/negativ/0) falder tilbage til default", async () => {
  const client = {
    from: () => ({
      select: () => ({
        in: async () => ({
          data: [
            { key: TRANSFER_PRICE_FLOOR_PCT_KEY, value: "0.25" }, // string, ikke number → ignoreres
            { key: TRANSFER_PRICE_CAP_MULTIPLE_KEY, value: -3 }, // negativ → ignoreres
          ],
          error: null,
        }),
      }),
    }),
  };
  assert.deepEqual(await readTransferPriceBandConfig(client), { floorPct: 0, capMultiple: null });
});

test("readTransferPriceBandConfig — rows fraværende (tom app_config) → disabled default", async () => {
  const client = {
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  };
  assert.deepEqual(await readTransferPriceBandConfig(client), { floorPct: 0, capMultiple: null });
});
