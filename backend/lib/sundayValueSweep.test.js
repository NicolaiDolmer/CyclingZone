// #4419 · Tests for søndagens værdi-pipeline.
//
// Datoer: 2026-06-21 er en SØNDAG, 2026-06-20 en lørdag. Alle tidspunkter
// skrives i UTC og oversættes i testnavnet til dansk sommertid (CEST = UTC+2).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runSundayValueSweep, SUNDAY_VALUE_FROM_HOUR } from "./sundayValueSweep.js";

const SUNDAY_0700 = new Date("2026-06-21T05:00:00Z"); // søndag 07:00 CEST
const SUNDAY_0500 = new Date("2026-06-21T03:00:00Z"); // søndag 05:00 CEST
const SATURDAY_0700 = new Date("2026-06-20T05:00:00Z"); // lørdag 07:00 CEST

const supabase = { from: () => ({}) };

function harness(overrides = {}) {
  const calls = { refresh: 0, market: 0, claim: 0, complete: [] };
  const base = {
    supabase,
    refreshValues: async () => { calls.refresh++; return { scanned: 10, changed: 3, written: 3 }; },
    runMarketValueSweep: async () => { calls.market++; return { ran: false, skipped: "flag_off" }; },
    claimRunDate: async () => { calls.claim++; return { claimed: true, tableMissing: false }; },
    completeRun: async ({ summary }) => { calls.complete.push(summary); },
    captureExceptionFn: () => {},
  };
  return { calls, args: { ...base, ...overrides } };
}

describe("runSundayValueSweep, gates", () => {
  it("vinduet starter kl. 06 dansk tid (ejer-beslutning 30/8)", () => {
    assert.equal(SUNDAY_VALUE_FROM_HOUR, 6);
  });

  it("kører IKKE på en lørdag", async () => {
    const { calls, args } = harness();
    const r = await runSundayValueSweep({ ...args, now: SATURDAY_0700 });
    assert.equal(r.ran, false);
    assert.equal(r.skipped, "not_sunday");
    assert.equal(calls.claim, 0);
    assert.equal(calls.refresh, 0);
  });

  it("kører IKKE søndag før kl. 06, og claimer ikke dagen", async () => {
    const { calls, args } = harness();
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0500 });
    assert.equal(r.skipped, "before_window");
    assert.equal(calls.claim, 0, "et claim før vinduet ville spærre dagens rigtige kørsel");
  });

  it("kører søndag efter kl. 06", async () => {
    const { calls, args } = harness();
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.equal(r.ran, true);
    assert.equal(r.runDate, "2026-06-21");
    assert.equal(calls.refresh, 1);
  });

  it("kræver eksplicit `now` (AGENTS.md hard rule 16)", async () => {
    const { args } = harness();
    await assert.rejects(() => runSundayValueSweep({ ...args }), /eksplicit `now`/);
  });
});

describe("runSundayValueSweep, dato-claim", () => {
  it("allerede claimet dato → ingen mutation (Railway-genstart samme søndag)", async () => {
    const { calls, args } = harness({
      claimRunDate: async () => ({ claimed: false, tableMissing: false }),
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.equal(r.skipped, "already_ran_today");
    assert.equal(calls.refresh, 0, "en anden kørsel ville skrive dagens markedsblend væk");
    assert.equal(calls.market, 0);
  });

  it("manglende log-tabel → kører INTET (fail-safe, migration ikke kørt)", async () => {
    const { calls, args } = harness({
      claimRunDate: async () => ({ claimed: false, tableMissing: true }),
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.equal(r.skipped, "log_table_missing");
    assert.equal(calls.refresh, 0);
  });

  it("claimer FØR første skrivning", async () => {
    const order = [];
    const { args } = harness({
      claimRunDate: async () => { order.push("claim"); return { claimed: true, tableMissing: false }; },
      refreshValues: async () => { order.push("refresh"); return { scanned: 1, changed: 0, written: 0 }; },
    });
    await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.deepEqual(order, ["claim", "refresh"]);
  });
});

describe("runSundayValueSweep, rækkefølge og fejlhåndtering", () => {
  it("kører markedsblendet EFTER v4-refresh'en (#3448 rækkefølge)", async () => {
    const order = [];
    const { args } = harness({
      refreshValues: async () => { order.push("v4-refresh"); return { scanned: 1, changed: 1, written: 1 }; },
      runMarketValueSweep: async ({ now }) => {
        order.push("market-blend");
        assert.equal(now, SUNDAY_0700, "blendet skal have det injicerede `now`, ikke vægur-tiden");
        return { ran: true, scanned: 1, changed: 1, written: 1 };
      },
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.deepEqual(order, ["v4-refresh", "market-blend"]);
    assert.equal(r.marketValueSweep.ran, true);
  });

  it("en fejlende v4-refresh stopper ikke markedsblendet, og logges", async () => {
    const captured = [];
    const { calls, args } = harness({
      refreshValues: async () => { throw new Error("v4 nede"); },
      captureExceptionFn: (err, ctx) => captured.push(ctx?.tags?.stage),
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.equal(r.ran, true);
    assert.equal(r.valueRefresh, null);
    assert.equal(calls.market, 1);
    assert.deepEqual(captured, ["value-refresh"]);
    assert.equal(calls.complete[0].valueRefreshFailed, true);
  });

  it("et fejlende markedsblend vælter ikke kørslen", async () => {
    const captured = [];
    const { args } = harness({
      runMarketValueSweep: async () => { throw new Error("blend nede"); },
      captureExceptionFn: (err, ctx) => captured.push(ctx?.tags?.stage),
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.equal(r.ran, true);
    assert.equal(r.marketValueSweep, null);
    assert.deepEqual(captured, ["market-value-sweep"]);
  });

  it("opsummerer kørslen i log-rækken", async () => {
    const { calls, args } = harness({
      runMarketValueSweep: async () => ({ ran: true, written: 42 }),
    });
    await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.deepEqual(calls.complete[0], {
      scanned: 10, changed: 3, written: 3,
      marketSweepRan: true, marketSweepWritten: 42, valueRefreshFailed: false,
    });
  });

  it("en fejlende opsummering rapporterer stadig kørslen som kørt", async () => {
    const { args } = harness({
      completeRun: async () => { throw new Error("update fejlede"); },
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.equal(r.ran, true, "claim'et står, dagen må ikke fremstå som ikke-kørt");
  });
});
