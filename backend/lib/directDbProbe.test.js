// #8143 trin 1 · Måleprøven: slukket uden linje og uden kontakt, måler begge veje,
// tæller fejl uden at kaste, gemmer aldrig fejltekst, rydder op efter 14 dage og
// kører aldrig to runder oven i hinanden.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DIRECT_DB_PROBE_FLAG_KEY,
  DIRECT_DB_PROBE_INTERVAL_MS,
  DIRECT_DB_PROBE_TABLE,
  createDirectDbProbe,
  isDirectDbProbeOn,
} from "./directDbProbe.ts";
import { DirectDbError } from "./directDb.ts";

const NOW = Date.parse("2026-11-13T18:00:00.000Z");

// Lille supabase-attrap: app_config-læsninger, indsættelser og sletninger logges.
function fakeSupabase({ flag = "on", flagError = null, webError = null, webThrows = null, insertError = null, insertThrows = null } = {}) {
  const calls = { reads: [], inserts: [], deletes: [], signals: [] };
  let appConfigReads = 0;
  // Hvert kald skal have sin egen tidsgrænse, så et hængende web-kald aldrig
  // låser prøven: abortSignal() er det eneste, der afslutter insert/delete.
  const bounded = (label, run) => ({
    abortSignal(signal) {
      assert.ok(signal instanceof AbortSignal);
      calls.signals.push(label);
      return run();
    },
  });
  const supabase = {
    calls,
    from(table) {
      const state = { table, filters: [] };
      const builder = {
        select(cols) { state.cols = cols; return builder; },
        eq(col, value) { state.filters.push([col, value]); return builder; },
        abortSignal(signal) { assert.ok(signal instanceof AbortSignal); state.signal = signal; return builder; },
        async maybeSingle() {
          assert.equal(table, "app_config");
          assert.ok(state.signal, "app_config-læsningen skal have en tidsgrænse");
          calls.signals.push(state.cols === "value" ? "flag" : "web");
          appConfigReads += 1;
          calls.reads.push({ cols: state.cols, filters: state.filters });
          if (state.cols === "value") {
            if (flagError) return { data: null, error: flagError };
            return { data: flag === null ? null : { value: flag }, error: null };
          }
          if (webThrows) throw webThrows;
          return webError ? { data: null, error: webError } : { data: { key: DIRECT_DB_PROBE_FLAG_KEY }, error: null };
        },
        insert(rows) {
          calls.inserts.push({ table, rows });
          return bounded("insert", async () => {
            if (insertThrows) throw insertThrows;
            return { error: insertError };
          });
        },
        delete() {
          return {
            lt: (col, value) => {
              calls.deletes.push({ table, col, value });
              return bounded("delete", async () => ({ error: null }));
            },
          };
        },
      };
      return builder;
    },
    get appConfigReads() { return appConfigReads; },
  };
  return supabase;
}

function fakeDirectDb({ enabled = true, fail = null } = {}) {
  const calls = [];
  return {
    calls,
    isEnabled: () => enabled,
    async query(text, params, options) {
      calls.push(text);
      if (fail) throw fail;
      options?.onTiming?.({ acquireMs: 2.04, queryMs: 9.96, newConnection: calls.length === 1 });
      return { rows: [{ ok: 1 }], rowCount: 1 };
    },
  };
}

function setup(opts = {}) {
  const supabase = opts.supabase ?? fakeSupabase(opts);
  const directDb = opts.directDb ?? fakeDirectDb(opts);
  let perf = 0;
  let clock = opts.now ?? NOW;
  const timers = [];
  const logger = { lines: [], warn: (...a) => logger.lines.push(a.join(" ")), log: (...a) => logger.lines.push(a.join(" ")) };
  const probe = createDirectDbProbe({
    supabase,
    directDb,
    perfNow: () => (perf += 40),
    now: () => clock,
    setIntervalFn: (fn, ms) => {
      const handle = { fn, ms, unrefCalled: false, unref() { this.unrefCalled = true; } };
      timers.push(handle);
      return handle;
    },
    clearIntervalFn: (handle) => { handle.cleared = true; },
    logger,
  });
  return { probe, supabase, directDb, timers, logger, advance: (ms) => { clock += ms; } };
}

test("#8143: uden direkte linje starter prøven ikke og rører ikke databasen", async () => {
  const { probe, supabase, timers } = setup({ enabled: false });
  assert.equal(probe.start(), false);
  assert.equal(timers.length, 0);
  assert.deepEqual(await probe.tick(), { status: "no-line" });
  assert.equal(supabase.appConfigReads, 0);
});

test("#8143: kontakten slukket (ingen række, off, beta, fejl) = ingen måling", async () => {
  for (const opts of [{ flag: null }, { flag: "off" }, { flag: "beta" }, { flag: false }, { flagError: { message: "boom" } }]) {
    const { probe, supabase, directDb } = setup(opts);
    assert.deepEqual(await probe.tick(), { status: "off" }, JSON.stringify(opts));
    assert.equal(supabase.calls.inserts.length, 0);
    assert.equal(directDb.calls.length, 0);
  }
});

test("#8143: isDirectDbProbeOn: kun \"on\" og true tænder, og en kastet fejl giver slukket", async () => {
  assert.equal(await isDirectDbProbeOn(fakeSupabase({ flag: "on" })), true);
  assert.equal(await isDirectDbProbeOn(fakeSupabase({ flag: true })), true);
  assert.equal(await isDirectDbProbeOn(fakeSupabase({ flag: "off" })), false);
  assert.equal(await isDirectDbProbeOn({ from() { throw new Error("netværk"); } }), false);
});

test("#8143: tændt: ét spørgsmål ad hver vej, målt og gemt som to rækker", async () => {
  const { probe, supabase, directDb } = setup();
  const result = await probe.tick();
  assert.equal(result.status, "measured");
  assert.deepEqual(directDb.calls, ["SELECT 1 AS ok"]);
  assert.deepEqual(supabase.calls.signals, ["flag", "web", "insert", "delete"],
    "hvert web-kald (kontakt, måling, gemning, udløb) har sin egen tidsgrænse");
  assert.equal(supabase.calls.inserts.length, 1);
  const { table, rows } = supabase.calls.inserts[0];
  assert.equal(table, DIRECT_DB_PROBE_TABLE);
  assert.equal(rows.length, 2);
  const web = rows.find((r) => r.path === "web");
  const direct = rows.find((r) => r.path === "direct");
  assert.deepEqual(web, {
    sampled_at: new Date(NOW).toISOString(), path: "web", ok: true,
    query_ms: 40, acquire_ms: null, new_connection: null, error_kind: null,
  });
  assert.deepEqual(direct, {
    sampled_at: new Date(NOW).toISOString(), path: "direct", ok: true,
    query_ms: 10, acquire_ms: 2, new_connection: true, error_kind: null,
  });
  assert.equal(probe.stats().measured, 1);
});

test("#8143: vejene skiftes til at gå først", async () => {
  const { probe } = setup();
  const first = await probe.tick();
  const second = await probe.tick();
  assert.deepEqual(first.samples.map((s) => s.path), ["web", "direct"]);
  assert.deepEqual(second.samples.map((s) => s.path), ["direct", "web"]);
});

test("#8143: fejl på den direkte vej tælles uden at kaste, og kun fejlklassen gemmes", async () => {
  const secretText = "could not connect to db.example.invalid with password hunter2";
  const { probe, supabase } = setup({ fail: new DirectDbError("timeout", secretText) });
  const result = await probe.tick();
  assert.equal(result.status, "measured");
  const direct = supabase.calls.inserts[0].rows.find((r) => r.path === "direct");
  assert.equal(direct.ok, false);
  assert.equal(direct.error_kind, "timeout");
  assert.equal(direct.acquire_ms, null);
  assert.ok(!JSON.stringify(supabase.calls.inserts).includes("hunter2"));
  assert.equal(probe.stats().errors.direct, 1);
});

test("#8143: fejl på web-vejen (svar med fejl eller kastet fejl) tælles uden at kaste", async () => {
  const withError = setup({ webError: { message: "upstream", code: "PGRST000" } });
  await withError.probe.tick();
  const row = withError.supabase.calls.inserts[0].rows.find((r) => r.path === "web");
  assert.equal(row.ok, false);
  assert.equal(withError.probe.stats().errors.web, 1);

  const aborted = setup({ webThrows: Object.assign(new Error("This operation was aborted"), { name: "AbortError" }) });
  const result = await aborted.probe.tick();
  assert.equal(result.status, "measured");
  const abortedRow = aborted.supabase.calls.inserts[0].rows.find((r) => r.path === "web");
  assert.equal(abortedRow.error_kind, "timeout");
  assert.equal(aborted.probe.stats().errors.web, 1);
});

test("#8143: en fejlet gemning tælles, og runden kaster ikke", async () => {
  const returned = setup({ insertError: { message: "nope" } });
  assert.equal((await returned.probe.tick()).status, "measured");
  assert.equal(returned.probe.stats().errors.store, 1);

  const thrown = setup({ insertThrows: new Error("fetch failed") });
  assert.equal((await thrown.probe.tick()).status, "measured");
  assert.equal(thrown.probe.stats().errors.store, 1);
});

test("#8143: en uventet fejl inde i runden sluges og tælles", async () => {
  const directDb = { isEnabled: () => { throw new Error("uventet"); }, query: async () => ({ rows: [] }) };
  const { probe } = setup({ directDb });
  assert.deepEqual(await probe.tick(), { status: "error" });
  assert.equal(probe.stats().errors.tick, 1);
});

test("#8143: højst én runde ad gangen", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const directDb = {
    isEnabled: () => true,
    async query(_t, _p, options) {
      await gate;
      options?.onTiming?.({ acquireMs: 1, queryMs: 1, newConnection: false });
      return { rows: [] };
    },
  };
  const { probe } = setup({ directDb });
  const first = probe.tick();
  assert.deepEqual(await probe.tick(), { status: "busy" });
  release();
  assert.equal((await first).status, "measured");
  assert.equal(probe.stats().skippedBusy, 1);
  assert.equal((await probe.tick()).status, "measured", "næste runde kører, når den forrige er færdig");
});

test("#8143: rækker ældre end 14 dage slettes, højst én gang i timen", async () => {
  const { probe, supabase, advance } = setup();
  await probe.tick();
  await probe.tick();
  assert.equal(supabase.calls.deletes.length, 1);
  assert.deepEqual(supabase.calls.deletes[0], {
    table: DIRECT_DB_PROBE_TABLE,
    col: "sampled_at",
    value: new Date(NOW - 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
  advance(60 * 60 * 1000);
  await probe.tick();
  assert.equal(supabase.calls.deletes.length, 2);
});

test("#8143: egen timer hvert minut, der ikke holder processen i live, og som kan stoppes", async () => {
  const { probe, timers } = setup();
  assert.equal(probe.start(), true);
  assert.equal(probe.start(), false, "kun én timer");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, DIRECT_DB_PROBE_INTERVAL_MS);
  assert.equal(DIRECT_DB_PROBE_INTERVAL_MS, 60_000);
  assert.equal(timers[0].unrefCalled, true);
  probe.stopTimer();
  assert.equal(timers[0].cleared, true);
  assert.equal(probe.isRunning(), false);
  await probe.drain();
});
