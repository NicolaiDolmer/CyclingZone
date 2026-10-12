// #4419 · Tests for søndagens værdi-pipeline.
//
// Datoer: 2026-06-21 er en SØNDAG, 2026-06-20 en lørdag. Alle tidspunkter
// skrives i UTC og oversættes i testnavnet til dansk sommertid (CEST = UTC+2).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runSundayValueSweep, sundaySweepSummaryLine, resolveTransitionGate, SUNDAY_VALUE_FROM_HOUR, RIDER_VALUE_SUNDAY_LOG_TABLE, TRANSITION_ANCHOR_LOOKBACK_HOURS } from "./sundayValueSweep.js";

const SUNDAY_IN_WINDOW = new Date("2026-06-21T13:00:00Z"); // søndag 15:00 CEST
const SUNDAY_NEXT_TICK = new Date("2026-06-21T14:00:00Z"); // søndag 16:00 CEST, næste tick
const SUNDAY_BEFORE_WINDOW = new Date("2026-06-21T11:00:00Z"); // søndag 13:00 CEST
const SATURDAY_IN_HOUR = new Date("2026-06-20T13:00:00Z"); // lørdag 15:00 CEST

const supabase = { from: () => ({}) };

function harness(overrides = {}) {
  const calls = { refresh: 0, market: 0, claim: 0, release: 0, complete: [], refreshOpts: [], phaseWrites: [] };
  const base = {
    supabase,
    refreshValues: async (_sb, opts) => { calls.refresh++; calls.refreshOpts.push(opts); return { scanned: 10, changed: 3, written: 3 }; },
    readPhaseStep: async () => 0,
    advancePhaseStep: async (_sb, step) => { calls.phaseWrites.push(step); },
    runMarketValueSweep: async () => { calls.market++; return { ran: false, skipped: "flag_off" }; },
    claimRunDate: async () => { calls.claim++; return { claimed: true, tableMissing: false }; },
    releaseRunDate: async () => { calls.release++; },
    completeRun: async ({ summary }) => { calls.complete.push(summary); },
    // #5842: normal uge, aktiv sæson med løb langt frem, intet skifte i gang.
    loadTransitionState: async () => {
      calls.transitionChecks = (calls.transitionChecks ?? 0) + 1;
      return { latestSeason: { status: "active" }, lastRaceAt: "2026-07-26T14:00:00Z", latestAnchor: null };
    },
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
  it("vinduet starter mellem kl. 14 og 20 dansk tid (ejer 28/9, #5842)", () => {
    assert.ok(Number.isInteger(SUNDAY_VALUE_FROM_HOUR));
    assert.ok(SUNDAY_VALUE_FROM_HOUR >= 14 && SUNDAY_VALUE_FROM_HOUR <= 20, `kl. ${SUNDAY_VALUE_FROM_HOUR} ligger uden for 14-20`);
  });

  it("kører IKKE søndag morgen (kl. 06:45, som 4/10), og claimer ikke dagen", async () => {
    const { calls, args } = harness();
    const r = await runSundayValueSweep({ ...args, now: new Date("2026-06-21T04:45:00Z") });
    assert.equal(r.skipped, "before_window");
    assert.equal(calls.claim, 0);
    assert.equal(calls.refresh, 0);
  });

  it("kører ved første tick i vinduets time", async () => {
    const { calls, args } = harness();
    const r = await runSundayValueSweep({ ...args, now: new Date(Date.UTC(2026, 5, 21, SUNDAY_VALUE_FROM_HOUR - 2, 0)) }); // CEST = UTC+2
    assert.equal(r.ran, true);
    assert.equal(calls.refresh, 1);
  });

  it("kører IKKE på en lørdag", async () => {
    const { calls, args } = harness();
    const r = await runSundayValueSweep({ ...args, now: SATURDAY_IN_HOUR });
    assert.equal(r.ran, false);
    assert.equal(r.skipped, "not_sunday");
    assert.equal(calls.claim, 0);
    assert.equal(calls.refresh, 0);
  });

  it("kører IKKE søndag lige før vinduet, og claimer ikke dagen", async () => {
    const { calls, args } = harness();
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_BEFORE_WINDOW });
    assert.equal(r.skipped, "before_window");
    assert.equal(calls.claim, 0, "et claim før vinduet ville spærre dagens rigtige kørsel");
  });

  it("kører søndag i vinduet", async () => {
    const { calls, args } = harness();
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
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
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
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
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
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
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
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
    await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
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
    const r = await runSundayValueSweep({ ...args, supabase: sb, now: SUNDAY_IN_WINDOW });
    assert.equal(r.ran, true);
    assert.equal(sb.seen.table, RIDER_VALUE_SUNDAY_LOG_TABLE);
    assert.deepEqual(sb.seen.inserts, [{ run_date: "2026-06-21" }]);
  });

  it("23505 (UNIQUE) → already_ran_today, ingen mutation", async () => {
    const sb = mockSupabase({ insertError: { code: "23505", message: "duplicate key value violates unique constraint" } });
    const { calls, args } = harness();
    delete args.claimRunDate;
    const r = await runSundayValueSweep({ ...args, supabase: sb, now: SUNDAY_IN_WINDOW });
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
      const r = await runSundayValueSweep({ ...args, supabase: sb, now: SUNDAY_IN_WINDOW });
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
      () => runSundayValueSweep({ ...args, supabase: sb, now: SUNDAY_IN_WINDOW }),
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
        assert.equal(now, SUNDAY_IN_WINDOW, "blendet skal have det injicerede `now`, ikke vægur-tiden");
        return { ran: true, scanned: 1, changed: 1, written: 1 };
      },
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
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
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
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
    const first = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
    assert.equal(first.skipped, "value_refresh_failed");
    const second = await runSundayValueSweep({ ...args, now: SUNDAY_NEXT_TICK });
    assert.equal(second.ran, true, "den frigivne dag skal kunne claimes igen samme søndag");
    assert.equal(calls.refresh, 2);
    assert.equal(calls.market, 1);
  });

  it("default-frigivelsen sletter netop dagens række", async () => {
    const sb = mockSupabase();
    const { args } = harness({ refreshValues: async () => { throw new Error("v4 nede"); } });
    delete args.claimRunDate;
    delete args.releaseRunDate;
    const r = await runSundayValueSweep({ ...args, supabase: sb, now: SUNDAY_IN_WINDOW });
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
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
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
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
    assert.equal(r.ran, true);
    assert.equal(r.marketValueSweep, null);
    assert.deepEqual(captured, ["market-value-sweep"]);
  });

  it("opsummerer kørslen i log-rækken", async () => {
    const { calls, args } = harness({
      runMarketValueSweep: async () => ({ ran: true, written: 42 }),
    });
    await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
    assert.deepEqual(calls.complete[0], {
      scanned: 10, changed: 3, written: 3,
      marketSweepRan: true, marketSweepWritten: 42,
    });
  });

  it("en fejlende opsummering rapporterer stadig kørslen som kørt", async () => {
    const { args } = harness({
      completeRun: async () => { throw new Error("update fejlede"); },
    });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
    assert.equal(r.ran, true, "claim'et står, dagen må ikke fremstå som ikke-kørt");
  });
});

// #5497 · trin-tælleren for elitepræmiens udfasning (indfasningsplan §5).
// Nøglen er det trin der SIDST er skrevet; søndagen regner med næste trin.
describe("runSundayValueSweep, trin-tælleren (#5497)", () => {
  const v6Refresh = (calls) => async (_sb, opts) => {
    calls.refresh++;
    calls.refreshOpts.push(opts);
    return { scanned: 10, changed: 3, written: 3, modelId: "v6", typefree: true, phaseStep: opts.phaseStep, productionChanged: 0 };
  };

  it("søndag 1 efter kørselsdagen (nøgle 0) regner trin 1 og gemmer 1", async () => {
    const { calls, args } = harness();
    args.refreshValues = v6Refresh(calls);
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
    assert.equal(calls.refreshOpts[0].phaseStep, 1);
    assert.deepEqual(calls.phaseWrites, [1]);
    assert.deepEqual(r.phase, { step: 1, advanced: true });
  });

  it("loft 4: nøgle 3 → 4, nøgle 4 bliver stående på 4", async () => {
    for (const [stored, expected] of [[3, 4], [4, 4]]) {
      const { calls, args } = harness({ readPhaseStep: async () => stored });
      args.refreshValues = v6Refresh(calls);
      await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
      assert.equal(calls.refreshOpts[0].phaseStep, expected, `nøgle ${stored}`);
      assert.deepEqual(calls.phaseWrites, [expected], `nøgle ${stored}`);
    }
  });

  it("v4/v5: nøglen røres IKKE", async () => {
    for (const modelId of ["v4", "v5"]) {
      const { calls, args } = harness({
        refreshValues: async () => ({ scanned: 10, changed: 3, written: 3, modelId, typefree: false, phaseStep: null, productionChanged: 0 }),
      });
      const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
      assert.equal(r.ran, true);
      assert.deepEqual(calls.phaseWrites, [], modelId);
      assert.deepEqual(r.phase, { step: null, advanced: false });
    }
  });

  it("kun ved FULDFØRT kørsel: en fejlende refresh tæller ikke op", async () => {
    const { calls, args } = harness({ refreshValues: async () => { throw new Error("v6 nede"); } });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
    assert.equal(r.skipped, "value_refresh_failed");
    assert.deepEqual(calls.phaseWrites, []);
  });

  it("en ulæselig nøgle stopper kørslen og frigiver dagen (intet gættet trin)", async () => {
    const { calls, args } = harness({ readPhaseStep: async () => { throw new Error("app_config nede"); } });
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
    assert.equal(r.skipped, "value_refresh_failed");
    assert.equal(r.claimReleased, true);
    assert.equal(calls.refresh, 0, "refresh'en må ikke køre på et gættet trin");
    assert.deepEqual(calls.phaseWrites, []);
  });

  it("en fejlende op-tælling vælter ikke kørslen og rapporteres", async () => {
    const captured = [];
    const { calls, args } = harness({
      advancePhaseStep: async () => { throw new Error("upsert nede"); },
      captureExceptionFn: (err, ctx) => captured.push(ctx?.tags?.stage),
    });
    args.refreshValues = v6Refresh(calls);
    const r = await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
    assert.equal(r.ran, true);
    assert.deepEqual(r.phase, { step: 1, advanced: false });
    assert.deepEqual(captured, ["phase-step"]);
  });

  it("log-linjen viser trin og løngrundlag til post-verify i Railway", async () => {
    const lines = [];
    const { calls, args } = harness({ log: (l) => lines.push(l) });
    args.refreshValues = v6Refresh(calls);
    await runSundayValueSweep({ ...args, now: SUNDAY_IN_WINDOW });
    assert.ok(lines.includes("sunday-value-sweep: model v6 · phase step 1 · production_value changed: 0"), lines.join("\n"));
    assert.equal(
      sundaySweepSummaryLine({ valueRefresh: { modelId: "v4", productionChanged: 2 }, phase: { step: null } }),
      "sunday-value-sweep: model v4 · phase step - · production_value changed: 2"
    );
  });
});

// ── #5842 · Skiftedagen: én værdiskrivning, efter det fuldførte skifte ────────
//
// 2026-10-25 er en søndag og S4's sidste løbsdag. Sommertiden slutter samme
// nat, så eftermiddagen er CET (UTC+1).

const SHIFT_DAY_1500 = new Date("2026-10-25T14:00:00Z"); // 15:00 CET
const SHIFT_DAY_1700 = new Date("2026-10-25T16:00:00Z"); // 17:00 CET
const SHIFT_DAY_2100 = new Date("2026-10-25T20:00:00Z"); // 21:00 CET
const SHIFT_DAY_2200 = new Date("2026-10-25T21:00:00Z"); // 22:00 CET
const S4_LAST_RACE = "2026-10-25T14:00:00Z";
const S5_LAST_RACE = "2026-11-22T15:00:00Z";

// Ét claim-lager for hele dagen, som rider_value_sunday_log's UNIQUE(run_date).
function claimStore() {
  const days = new Set();
  return {
    claimRunDate: async ({ runDate }) => {
      if (days.has(runDate)) return { claimed: false, tableMissing: false };
      days.add(runDate);
      return { claimed: true, tableMissing: false };
    },
  };
}

describe("resolveTransitionGate (#5842)", () => {
  const runDate = "2026-10-25";

  it("normal søndag midt i sæsonen: åben", () => {
    assert.deepEqual(
      resolveTransitionGate({ latestSeason: { status: "active" }, lastRaceAt: S5_LAST_RACE, latestAnchor: null, runDate }),
      { blocked: false },
    );
  });

  it("sæsonens sidste løbsdag er i dag: venter på skiftet", () => {
    assert.equal(resolveTransitionGate({ latestSeason: { status: "active" }, lastRaceAt: S4_LAST_RACE, runDate }).reason, "transition_pending");
  });

  it("sidste løb var i går, skiftet ikke kørt: venter stadig", () => {
    assert.equal(resolveTransitionGate({ latestSeason: { status: "active" }, lastRaceAt: "2026-10-24T14:00:00Z", runDate }).reason, "transition_pending");
  });

  it("sæsonen er afsluttet, ingen ny aktiv sæson: venter", () => {
    assert.equal(resolveTransitionGate({ latestSeason: { status: "completed" }, lastRaceAt: null, runDate }).reason, "transition_pending");
  });

  it("skiftet kører eller fejlede: venter", () => {
    const active = { status: "active" };
    assert.equal(resolveTransitionGate({ latestSeason: active, lastRaceAt: S5_LAST_RACE, latestAnchor: { status: "started" }, runDate }).reason, "transition_running");
    assert.equal(resolveTransitionGate({ latestSeason: active, lastRaceAt: S5_LAST_RACE, latestAnchor: { status: "failed" }, runDate }).reason, "transition_failed");
  });

  it("skiftet er fuldført og den nye sæson har løb frem: åben", () => {
    assert.deepEqual(
      resolveTransitionGate({ latestSeason: { status: "active" }, lastRaceAt: S5_LAST_RACE, latestAnchor: { status: "completed" }, runDate }),
      { blocked: false },
    );
  });

  it("en ny sæson uden løb endnu blokerer ikke", () => {
    assert.deepEqual(resolveTransitionGate({ latestSeason: { status: "active" }, lastRaceAt: null, runDate }), { blocked: false });
  });

  it("dato-grænsen er dansk tid: et løb kl. 00:30 dansk tid i morgen er i morgen", () => {
    // 2026-10-25T23:30Z = 26/10 kl. 00:30 CET.
    assert.deepEqual(resolveTransitionGate({ latestSeason: { status: "active" }, lastRaceAt: "2026-10-25T23:30:00Z", runDate }), { blocked: false });
  });
});

describe("runSundayValueSweep, skiftedagen (#5842)", () => {
  it("hele skiftedagen: præcis én værdiskrivning, og den kommer efter skiftet", async () => {
    let state = { latestSeason: { status: "active" }, lastRaceAt: S4_LAST_RACE, latestAnchor: null };
    const store = claimStore();
    const { calls, args } = harness({ ...store, loadTransitionState: async () => state });

    // 15:00: løbene kører stadig, skiftet står for døren.
    const r1 = await runSundayValueSweep({ ...args, now: SHIFT_DAY_1500 });
    assert.equal(r1.skipped, "transition_pending");

    // 17:00: admin har startet skiftet.
    state = { latestSeason: { status: "active" }, lastRaceAt: S4_LAST_RACE, latestAnchor: { status: "started" } };
    const r2 = await runSundayValueSweep({ ...args, now: SHIFT_DAY_1700 });
    assert.equal(r2.skipped, "transition_running");
    assert.equal(calls.refresh, 0, "ingen værdiskrivning før skiftet er fuldført");

    // 21:00: skiftet er fuldført, S5 er aktiv.
    state = { latestSeason: { status: "active" }, lastRaceAt: S5_LAST_RACE, latestAnchor: { status: "completed" } };
    const r3 = await runSundayValueSweep({ ...args, now: SHIFT_DAY_2100 });
    assert.equal(r3.ran, true);
    assert.equal(r3.runDate, "2026-10-25");

    // 22:00: næste tick må ikke skrive igen.
    const r4 = await runSundayValueSweep({ ...args, now: SHIFT_DAY_2200 });
    assert.equal(r4.skipped, "already_ran_today");
    assert.equal(calls.refresh, 1, "præcis én værdiskrivning på skiftedagen");
  });

  it("venter UDEN at claime dagen, så et senere tick samme søndag kan køre", async () => {
    const { calls, args } = harness({
      loadTransitionState: async () => ({ latestSeason: { status: "completed" }, lastRaceAt: null, latestAnchor: null }),
    });
    const r = await runSundayValueSweep({ ...args, now: SHIFT_DAY_1500 });
    assert.equal(r.ran, false);
    assert.equal(r.skipped, "transition_pending");
    assert.equal(calls.claim, 0);
    assert.equal(calls.refresh, 0);
    assert.equal(calls.market, 0);
  });

  it("vinduet gates før skifte-tjekket: ingen DB-opslag om morgenen", async () => {
    const { calls, args } = harness();
    await runSundayValueSweep({ ...args, now: new Date("2026-10-25T05:45:00Z") }); // 06:45 CET
    assert.equal(calls.transitionChecks ?? 0, 0);
  });

  it("et fejlet skifte spærrer og rapporteres", async () => {
    const captured = [];
    const { calls, args } = harness({
      loadTransitionState: async () => ({ latestSeason: { status: "active" }, lastRaceAt: S5_LAST_RACE, latestAnchor: { status: "failed" } }),
      captureExceptionFn: (err, ctx) => captured.push(ctx?.tags?.stage),
    });
    const r = await runSundayValueSweep({ ...args, now: SHIFT_DAY_2100 });
    assert.equal(r.skipped, "transition_failed");
    assert.equal(calls.claim, 0);
    assert.deepEqual(captured, ["transition-gate"]);
  });

  it("retry: et fejlende skifte-tjek springer over uden claim, næste tick kører", async () => {
    const captured = [];
    let fail = true;
    const { calls, args } = harness({
      loadTransitionState: async () => {
        if (fail) throw new Error("statement timeout");
        return { latestSeason: { status: "active" }, lastRaceAt: S5_LAST_RACE, latestAnchor: { status: "completed" } };
      },
      captureExceptionFn: (err, ctx) => captured.push(ctx?.tags?.stage),
    });
    const r1 = await runSundayValueSweep({ ...args, now: SHIFT_DAY_2100 });
    assert.equal(r1.skipped, "transition_check_failed");
    assert.equal(calls.claim, 0, "et fejlet tjek må ikke brænde dagen");
    assert.deepEqual(captured, ["transition-gate"]);
    fail = false;
    const r2 = await runSundayValueSweep({ ...args, now: SHIFT_DAY_2200 });
    assert.equal(r2.ran, true);
    assert.equal(calls.refresh, 1);
  });
});

describe("runSundayValueSweep, default skifte-opslag (#5842)", () => {
  // Kædbar PostgREST-mock: registrerer filtre pr. tabel og svarer med `rows[table]`.
  function chainSupabase(rows) {
    const seen = {};
    return {
      seen,
      from(table) {
        const q = { table, filters: [] };
        (seen[table] ??= []).push(q);
        const chain = {
          select(cols) { q.select = cols; return chain; },
          neq(c, v) { q.filters.push(["neq", c, v]); return chain; },
          eq(c, v) { q.filters.push(["eq", c, v]); return chain; },
          not(c, op, v) { q.filters.push(["not", c, op, v]); return chain; },
          gte(c, v) { q.filters.push(["gte", c, v]); return chain; },
          order(c, o) { q.order = [c, o]; return chain; },
          limit(n) { q.limit = n; return chain; },
          maybeSingle() { return Promise.resolve({ data: rows[table] ?? null, error: null }); },
        };
        return chain;
      },
    };
  }

  it("læser nyeste sæson, dens sidste løb og transitionens seneste fase-anker", async () => {
    const sb = chainSupabase({
      seasons: { id: "s4", number: 4, status: "active" },
      races: { scheduled_for: S4_LAST_RACE },
      admin_log: null,
    });
    const { calls, args } = harness({ supabase: sb });
    delete args.loadTransitionState;
    const r = await runSundayValueSweep({ ...args, now: SHIFT_DAY_1500 });
    assert.equal(r.skipped, "transition_pending");
    assert.equal(calls.claim, 0);

    const season = sb.seen.seasons[0];
    assert.deepEqual(season.filters, [["neq", "status", "upcoming"]]);
    assert.deepEqual(season.order, ["number", { ascending: false }]);
    const race = sb.seen.races[0];
    assert.deepEqual(race.filters[0], ["eq", "season_id", "s4"]);
    assert.deepEqual(race.order, ["scheduled_for", { ascending: false }]);
    const anchor = sb.seen.admin_log[0];
    assert.ok(anchor.filters.some(([op, c, v]) => op === "eq" && c === "meta->>source" && v === "season_transition_phase"));
    const since = anchor.filters.find(([op]) => op === "gte")[2];
    assert.equal(new Date(since).getTime(), SHIFT_DAY_1500.getTime() - TRANSITION_ANCHOR_LOOKBACK_HOURS * 3600 * 1000);
  });

  it("efter skiftet (ny aktiv sæson, 'completed'-anker) kører den", async () => {
    const sb = chainSupabase({
      seasons: { id: "s5", number: 5, status: "active" },
      races: { scheduled_for: S5_LAST_RACE },
      admin_log: { created_at: "2026-10-25T19:30:00Z", meta: { status: "completed" } },
    });
    const { calls, args } = harness({ supabase: sb });
    delete args.loadTransitionState;
    const r = await runSundayValueSweep({ ...args, now: SHIFT_DAY_2100 });
    assert.equal(r.ran, true);
    assert.equal(calls.refresh, 1);
  });
});
