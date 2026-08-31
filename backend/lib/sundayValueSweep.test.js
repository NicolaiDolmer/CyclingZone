// #4419 · Tests for søndagens værdi-pipeline.
//
// Datoer: 2026-06-21 er en SØNDAG, 2026-06-20 en lørdag. Alle tidspunkter
// skrives i UTC og oversættes i testnavnet til dansk sommertid (CEST = UTC+2).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runSundayValueSweep, SUNDAY_VALUE_FROM_HOUR, RIDER_VALUE_SUNDAY_LOG_TABLE } from "./sundayValueSweep.js";

const SUNDAY_0700 = new Date("2026-06-21T05:00:00Z"); // søndag 07:00 CEST
const SUNDAY_0800 = new Date("2026-06-21T06:00:00Z"); // søndag 08:00 CEST, næste tick
const SUNDAY_0500 = new Date("2026-06-21T03:00:00Z"); // søndag 05:00 CEST
const SATURDAY_0700 = new Date("2026-06-20T05:00:00Z"); // lørdag 07:00 CEST

const supabase = { from: () => ({}) };

function harness(overrides = {}) {
  const calls = { refresh: 0, market: 0, claim: 0, release: 0, complete: [] };
  const base = {
    supabase,
    refreshValues: async () => { calls.refresh++; return { scanned: 10, changed: 3, written: 3 }; },
    runMarketValueSweep: async () => { calls.market++; return { ran: false, skipped: "flag_off" }; },
    claimRunDate: async () => { calls.claim++; return { claimed: true, tableMissing: false }; },
    releaseRunDate: async () => { calls.release++; },
    completeRun: async ({ summary }) => { calls.complete.push(summary); },
    captureExceptionFn: () => {},
  };
  return { calls, args: { ...base, ...overrides } };
}

// Minimal PostgREST-agtig mock, KUN til de default-implementationer af claim/
// release/complete der ellers ville køre første gang i prod (review 31/8).
function mockSupabase({ insertError = null, deleteError = null } = {}) {
  const seen = { table: null, inserts: [], deletes: [] };
  return {
    seen,
    from(table) {
      seen.table = table;
      return {
        insert(row) { seen.inserts.push(row); return Promise.resolve({ error: insertError }); },
        delete() {
          return { eq(col, val) { seen.deletes.push([col, val]); return Promise.resolve({ error: deleteError }); } };
        },
        update() { return { eq() { return Promise.resolve({ error: null }); } }; },
      };
    },
  };
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

  it("FORWARD GUARD: træning og værdiopdatering er afkoblet — jobbet kører selv med daily_training_enabled slukket", async () => {
    // Ejer-beslutning 31/8: der skal kunne trænes hver dag, og værdier skal
    // opdateres hver søndag, uafhængigt af hinanden. Et review koblede dem
    // engang, fordi værdi-refresh'en historisk lå bag trainingSweep.js's
    // flag-gate. Genindfører nogen den kobling, fælder denne test.
    //
    // daily_training_enabled bor i app_config (se dailyTrainingFlag.js), så
    // ethvert opslag i den tabel afslører en flag-gate der er sneget sig ind.
    const seen = [];
    const { calls, args } = harness({
      supabase: { from: (tbl) => { seen.push(tbl); return supabase.from(tbl); } },
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.equal(r.ran, true, "søndagens værdiopdatering må ikke afhænge af træningsflaget");
    assert.equal(calls.refresh, 1);
    assert.equal(calls.claim, 1);
    assert.ok(
      !seen.includes("app_config"),
      "jobbet slog app_config op — er der sneget en flag-gate ind igen?",
    );
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

  it("manglende log-tabel → kører INTET, men skriger (fail-safe må ikke være tavs)", async () => {
    const captured = [];
    const { calls, args } = harness({
      claimRunDate: async () => ({ claimed: false, tableMissing: true }),
      captureExceptionFn: (err, ctx) => captured.push([ctx?.tags?.stage, err.message]),
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.equal(r.skipped, "log_table_missing");
    assert.equal(calls.refresh, 0);
    assert.equal(captured.length, 1, "et permanent skip uden alarm ser ud som en normal uge");
    assert.equal(captured[0][0], "claim");
    assert.match(captured[0][1], new RegExp(RIDER_VALUE_SUNDAY_LOG_TABLE));
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

describe("runSundayValueSweep, default-claim mod PostgREST-fejlkoder", () => {
  // Alle øvrige tests injicerer claimRunDate som stub; DISSE kører den rigtige
  // defaultClaimRunDate gennem sweepen, så 23505-detektionen og
  // tabel-fravær-genkendelsen ikke debuterer i prod (review 31/8, punkt 2).
  it("frisk dato → INSERT af run_date, dagen er claimet", async () => {
    const sb = mockSupabase();
    const { args } = harness();
    delete args.claimRunDate;
    const r = await runSundayValueSweep({ ...args, supabase: sb, now: SUNDAY_0700 });
    assert.equal(r.ran, true);
    assert.equal(sb.seen.table, RIDER_VALUE_SUNDAY_LOG_TABLE);
    assert.deepEqual(sb.seen.inserts, [{ run_date: "2026-06-21" }]);
  });

  it("23505 (UNIQUE) → already_ran_today, ingen mutation", async () => {
    const sb = mockSupabase({ insertError: { code: "23505", message: "duplicate key value violates unique constraint" } });
    const { calls, args } = harness();
    delete args.claimRunDate;
    const r = await runSundayValueSweep({ ...args, supabase: sb, now: SUNDAY_0700 });
    assert.equal(r.skipped, "already_ran_today");
    assert.equal(calls.refresh, 0);
  });

  it("42P01 og PGRST205 → tabellen mangler (fail-safe)", async () => {
    for (const error of [
      { code: "42P01", message: 'relation "public.rider_value_sunday_log" does not exist' },
      { code: "PGRST205", message: "Could not find the table 'public.rider_value_sunday_log' in the schema cache" },
    ]) {
      const sb = mockSupabase({ insertError: error });
      const { args } = harness();
      delete args.claimRunDate;
      const r = await runSundayValueSweep({ ...args, supabase: sb, now: SUNDAY_0700 });
      assert.equal(r.skipped, "log_table_missing", `kode ${error.code}`);
    }
  });

  it("PGRST204 (KOLONNE-mismatch) kaster — den må ikke slå jobbet tavst fra", async () => {
    // Den gamle regex matchede "schema cache" og dermed også kolonne-fejl: en
    // omdøbt kolonne ville have stoppet værdi-opdateringer uge efter uge uden
    // log, uden Sentry og uden monitor-udslag (review 31/8, fund 5).
    const sb = mockSupabase({
      insertError: {
        code: "PGRST204",
        message: "Could not find the 'scanned' column of 'rider_value_sunday_log' in the schema cache",
      },
    });
    const { args } = harness();
    delete args.claimRunDate;
    await assert.rejects(
      () => runSundayValueSweep({ ...args, supabase: sb, now: SUNDAY_0700 }),
      /sunday-value-sweep claim/
    );
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

  it("en fejlende v4-refresh FRIGIVER dagens claim og springer blendet over", async () => {
    // Uden frigivelsen kostede ét statement-timeout hele ugens værdiopdatering:
    // næste tick fandt claim-rækken og svarede already_ran_today (review 31/8,
    // fund 2). Blendet springes over, fordi næste forsøgs v4-refresh ellers
    // ville skrive det væk igen.
    const captured = [];
    const { calls, args } = harness({
      refreshValues: async () => { throw new Error("v4 nede"); },
      captureExceptionFn: (err, ctx) => captured.push(ctx?.tags?.stage),
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.equal(r.ran, false);
    assert.equal(r.skipped, "value_refresh_failed");
    assert.equal(r.claimReleased, true);
    assert.equal(calls.release, 1);
    assert.equal(calls.market, 0, "et blend nu ville blive skrevet væk af næste forsøgs refresh");
    assert.equal(calls.complete.length, 0, "der er ingen række at opsummere efter en frigivelse");
    assert.deepEqual(captured, ["value-refresh"]);
  });

  it("næste tick samme søndag KAN køre efter en frigivet dag", async () => {
    // Selve pointen med frigivelsen: en transient fejl må koste 1 time, ikke
    // 1 uge. Claim'et er delt state mellem de to tick, som i basen.
    let claimedDate = null;
    let attempt = 0;
    const { calls, args } = harness({
      claimRunDate: async ({ runDate }) => {
        calls.claim++;
        if (claimedDate === runDate) return { claimed: false, tableMissing: false };
        claimedDate = runDate;
        return { claimed: true, tableMissing: false };
      },
      releaseRunDate: async () => { calls.release++; claimedDate = null; },
      refreshValues: async () => {
        calls.refresh++;
        if (++attempt === 1) throw new Error("statement timeout");
        return { scanned: 10, changed: 3, written: 3 };
      },
    });
    const first = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.equal(first.skipped, "value_refresh_failed");
    const second = await runSundayValueSweep({ ...args, now: SUNDAY_0800 });
    assert.equal(second.ran, true, "den frigivne dag skal kunne claimes igen samme søndag");
    assert.equal(calls.refresh, 2);
    assert.equal(calls.market, 1);
  });

  it("default-frigivelsen sletter netop dagens række", async () => {
    const sb = mockSupabase();
    const { args } = harness({ refreshValues: async () => { throw new Error("v4 nede"); } });
    delete args.claimRunDate;
    delete args.releaseRunDate;
    const r = await runSundayValueSweep({ ...args, supabase: sb, now: SUNDAY_0700 });
    assert.equal(r.claimReleased, true);
    assert.deepEqual(sb.seen.deletes, [["run_date", "2026-06-21"]]);
  });

  it("en fejlende frigivelse rapporteres, så den tabte uge kan ses", async () => {
    const captured = [];
    const { args } = harness({
      refreshValues: async () => { throw new Error("v4 nede"); },
      releaseRunDate: async () => { throw new Error("delete nede"); },
      captureExceptionFn: (err, ctx) => captured.push(ctx?.tags?.stage),
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_0700 });
    assert.equal(r.skipped, "value_refresh_failed");
    assert.equal(r.claimReleased, false);
    assert.deepEqual(captured, ["value-refresh", "release-claim"]);
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
      marketSweepRan: true, marketSweepWritten: 42,
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
