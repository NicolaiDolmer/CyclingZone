import test from "node:test";
import assert from "node:assert/strict";
import { isBootNetworkError, runBootWithNetworkRetry } from "./cron.js";

// #5015 (CYCLINGZONE-5N): boot-kørslerne af de to Alunta-vagter kastede en
// generisk error-issue uden fingerprint hver gang Railway-containerens
// netværk ikke var klar i det første sekund efter en kold start. Disse tests
// dækker klassifikationen (kun netværksklassen retry'es) og selve
// retry+warning-capture-adfærden, uafhængigt af de ægte Alunta-vagter.

// ── isBootNetworkError ───────────────────────────────────────────────────────

test("isBootNetworkError: fetch failed / ECONNRESET / ETIMEDOUT / ENETUNREACH er netværksklassen", () => {
  assert.equal(isBootNetworkError(new TypeError("fetch failed")), true);
  assert.equal(isBootNetworkError(new Error("connect ECONNRESET")), true);
  assert.equal(isBootNetworkError(new Error("connect ETIMEDOUT 116.202.105.220:443")), true);
  assert.equal(isBootNetworkError(new Error("connect ENETUNREACH 2a01:4f8::443")), true);
});

test("isBootNetworkError: AggregateError klassificeres via sine underliggende fejl (CYCLINGZONE-5N's faktiske form)", () => {
  const inner1 = new Error("connect ETIMEDOUT 116.202.105.220:443");
  const inner2 = new Error("connect ENETUNREACH 2a01:4f8::443");
  const agg = new AggregateError([inner1, inner2], "fetch failed");
  assert.equal(isBootNetworkError(agg), true);
});

test("isBootNetworkError: en ÆGTE Alunta-fejl (4xx/5xx, programfejl) er IKKE netværksklassen", () => {
  assert.equal(isBootNetworkError(new Error("Alunta GET /invoices -> 500")), false);
  assert.equal(isBootNetworkError(new Error("Unauthorized")), false);
  assert.equal(isBootNetworkError(new TypeError("Cannot read properties of undefined")), false);
  assert.equal(isBootNetworkError(null), false);
  assert.equal(isBootNetworkError(undefined), false);
});

// ── runBootWithNetworkRetry ──────────────────────────────────────────────────

test("runBootWithNetworkRetry: netværksfejl 2x, success 3. forsøg → ingen capture (issuets eget acceptkriterie)", async () => {
  let calls = 0;
  const captured = [];
  const sleeps = [];
  await runBootWithNetworkRetry("test-watch", async () => {
    calls += 1;
    if (calls < 3) throw new TypeError("fetch failed");
  }, {
    captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
    sleepFn: async (ms) => { sleeps.push(ms); },
    randomFn: () => 0,
  });
  assert.equal(calls, 3);
  assert.equal(captured.length, 0, "en netværksfejl der ender med success må ALDRIG capture'es");
  assert.equal(sleeps.length, 2, "kun mellem forsøg, ikke efter det sidste");
});

test("runBootWithNetworkRetry: netværksfejl på ALLE forsøg → én warning-capture med fast fingerprint", async () => {
  const captured = [];
  await runBootWithNetworkRetry("alunta-overdue-watch (boot)", async () => {
    throw new Error("connect ENETUNREACH 2a01:4f8::443");
  }, {
    captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
    sleepFn: async () => {},
    randomFn: () => 0,
  });
  assert.equal(captured.length, 1, "vedvarende netværksfejl skal capture'es NETOP én gang (ikke også af trackedTick)");
  assert.equal(captured[0].ctx.level, "warning");
  assert.deepEqual(captured[0].ctx.fingerprint, ["alunta-network-unreachable"]);
  assert.equal(captured[0].ctx.tags.flow, "billing");
});

test("runBootWithNetworkRetry: en ÆGTE fejl (ikke netværk) kastes med det samme, uden retry og uden egen capture", async () => {
  let calls = 0;
  const captured = [];
  await assert.rejects(
    () => runBootWithNetworkRetry("test-watch", async () => {
      calls += 1;
      throw new Error("Alunta GET /invoices -> 500");
    }, {
      captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
      sleepFn: async () => { throw new Error("skal ALDRIG sove for en ægte fejl"); },
    }),
    /Alunta GET \/invoices -> 500/,
  );
  assert.equal(calls, 1, "ingen retry for en ikke-netværksfejl");
  assert.equal(captured.length, 0, "wrapperen selv capture'er ikke — den bobler til trackedTick's normale error-vej");
});

test("runBootWithNetworkRetry: respekterer attempts/delay-parametrene (custom konfiguration)", async () => {
  let calls = 0;
  const sleeps = [];
  const captured = [];
  await runBootWithNetworkRetry("test-watch", async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }, {
    attempts: 2,
    minDelayMs: 1000,
    maxDelayMs: 1000,
    captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
    sleepFn: async (ms) => sleeps.push(ms),
    randomFn: () => 0,
  });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(captured.length, 1);
});
