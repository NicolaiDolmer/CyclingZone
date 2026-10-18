import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOutagePayload,
  createOutageMonitor,
  emptyOutageState,
  formatDuration,
  OUTAGE_FAILURE_THRESHOLD,
  OUTAGE_PROBE_INTERVAL_MS,
  OUTAGE_RECOVERY_CONSECUTIVE_OK,
  probePostgrest,
  recordProbe,
} from "./outageMonitor.js";

const FAIL = { ok: false, detail: "HTTP 503" };
const OK = { ok: true, detail: "HTTP 200" };
const step = OUTAGE_PROBE_INTERVAL_MS;

function feed(state, probes, startMs = 0) {
  const messages = [];
  let s = state;
  probes.forEach((p, i) => {
    const r = recordProbe(s, p, startMs + i * step);
    s = r.state;
    if (r.message) messages.push(r.message);
  });
  return { state: s, messages };
}

test("recordProbe: alarm først når fejl i vinduet er OVER tærsklen (20)", () => {
  const atThreshold = feed(emptyOutageState(), Array(OUTAGE_FAILURE_THRESHOLD).fill(FAIL));
  assert.equal(atThreshold.messages.length, 0);
  const over = feed(emptyOutageState(), Array(OUTAGE_FAILURE_THRESHOLD + 1).fill(FAIL));
  assert.equal(over.messages.length, 1);
  assert.equal(over.messages[0].kind, "down");
  assert.equal(over.messages[0].since, 0);
  assert.equal(over.state.alertActive, true);
});

test("recordProbe: 18/10-mønstret (ca. 9 af 10 fejl) alarmerer inden for 10 min", () => {
  const probes = Array.from({ length: 40 }, (_, i) => (i % 10 === 9 ? OK : FAIL));
  const { messages } = feed(emptyOutageState(), probes);
  assert.equal(messages.length, 1);
  const idx = probes.length; // alle 40 prober = 10 min
  assert.ok(idx * step <= 10 * 60_000);
});

test("recordProbe: spredte fejl over mere end 10 min alarmerer aldrig", () => {
  // én fejl pr. 2 prober (30 s) giver højst 20 i et 10-min-vindue
  const probes = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? FAIL : OK));
  assert.equal(feed(emptyOutageState(), probes).messages.length, 0);
});

test("recordProbe: ingen gentagen alarm mens udfaldet varer, og én 'oppe igen' efter 1 min grønt", () => {
  const down = feed(emptyOutageState(), Array(60).fill(FAIL));
  assert.equal(down.messages.length, 1);
  const almost = feed(down.state, Array(OUTAGE_RECOVERY_CONSECUTIVE_OK - 1).fill(OK), 60 * step);
  assert.equal(almost.messages.length, 0);
  const up = feed(almost.state, [OK], (60 + OUTAGE_RECOVERY_CONSECUTIVE_OK - 1) * step);
  assert.equal(up.messages.length, 1);
  assert.equal(up.messages[0].kind, "recovered");
  assert.equal(up.messages[0].since, 0);
  assert.equal(up.state.alertActive, false);
  assert.deepEqual(up.state.failures, []);
});

test("recordProbe: et grønt blip midt i udfaldet sender ikke 'oppe igen'", () => {
  const down = feed(emptyOutageState(), Array(30).fill(FAIL));
  const blip = feed(down.state, [OK, OK, FAIL, OK], 30 * step);
  assert.equal(blip.messages.length, 0);
  assert.equal(blip.state.alertActive, true);
});

test("buildOutagePayload: nedetid har mention og dansk tid, oppe-igen er rolig", () => {
  const since = Date.UTC(2026, 9, 18, 3, 42);
  const down = buildOutagePayload({ kind: "down", since, failures: 23, detail: "HTTP 503" }, "<@1>");
  assert.equal(down.content, "<@1>");
  assert.match(down.embeds[0].description, /05.42/);
  assert.match(down.embeds[0].description, /23 prober/);
  const up = buildOutagePayload({ kind: "recovered", since, until: since + 158 * 60_000 }, "<@1>");
  assert.equal(up.content, undefined);
  assert.match(up.embeds[0].description, /ca\. 2 t 38 min/);
});

test("formatDuration: minutter og timer", () => {
  assert.equal(formatDuration(0, 4 * 60_000), "ca. 4 min");
  assert.equal(formatDuration(0, 120 * 60_000), "ca. 2 t");
});

test("probePostgrest: 5xx og netværksfejl er fejl, 4xx er ikke et udfald", async () => {
  const res = (status) => async () => ({ status });
  assert.equal((await probePostgrest(res(503), "https://x", "k")).ok, false);
  assert.equal((await probePostgrest(res(200), "https://x", "k")).ok, true);
  assert.equal((await probePostgrest(res(401), "https://x", "k")).ok, true);
  const boom = async () => { throw Object.assign(new Error("x"), { cause: { code: "ECONNRESET" } }); };
  const r = await probePostgrest(boom, "https://x", "k");
  assert.equal(r.ok, false);
  assert.match(r.detail, /ECONNRESET/);
});

function monitorHarness({ discordOk = true } = {}) {
  const ctx = { healthy: false, discordOk, sent: [], probes: 0, t: 0 };
  const fetchFn = async (url, opts = {}) => {
    if (url.startsWith("https://discord.example")) {
      ctx.sent.push(JSON.parse(opts.body));
      return { ok: ctx.discordOk, status: ctx.discordOk ? 204 : 500 };
    }
    ctx.probes += 1;
    return { status: ctx.healthy ? 200 : 503 };
  };
  const env = {
    SUPABASE_URL: "https://proj.example",
    SUPABASE_SERVICE_KEY: "svc",
    DISCORD_OPS_WEBHOOK_URL: "https://discord.example/hook",
  };
  const tick = createOutageMonitor({ env, fetchFn, now: () => (ctx.t += step), log: () => {} });
  return { ctx, tick };
}

test("createOutageMonitor: alarmen sendes uden databasen og prøves igen hvis Discord fejler", async () => {
  const { ctx, tick } = monitorHarness({ discordOk: false });
  for (let i = 0; i < OUTAGE_FAILURE_THRESHOLD + 1; i += 1) await tick();
  assert.equal(ctx.sent.length, 1);
  ctx.discordOk = true;
  await tick();
  assert.equal(ctx.sent.length, 2, "ny forsøg ved næste probe");
  await tick();
  assert.equal(ctx.sent.length, 2, "men ikke igen efter succes");
  ctx.healthy = true;
  for (let i = 0; i < OUTAGE_RECOVERY_CONSECUTIVE_OK; i += 1) await tick();
  assert.equal(ctx.sent.length, 3);
  assert.match(ctx.sent[2].embeds[0].title, /oppe igen/);
});

test("createOutageMonitor: mangler env, gør vagten intet", async () => {
  let calls = 0;
  const tick = createOutageMonitor({ env: {}, fetchFn: async () => { calls += 1; return { status: 503 }; }, log: () => {} });
  const origError = console.error;
  console.error = () => {};
  try {
    await tick();
    await tick();
  } finally {
    console.error = origError;
  }
  assert.equal(calls, 0);
});

test("createOutageMonitor: fejlet 'oppe igen' prøves igen ved næste grønne probe", async () => {
  const { ctx, tick } = monitorHarness();
  for (let i = 0; i < OUTAGE_FAILURE_THRESHOLD + 1; i += 1) await tick();
  assert.equal(ctx.sent.length, 1);
  ctx.healthy = true;
  ctx.discordOk = false;
  for (let i = 0; i < OUTAGE_RECOVERY_CONSECUTIVE_OK; i += 1) await tick();
  assert.equal(ctx.sent.length, 2, "forsøgt én gang");
  ctx.discordOk = true;
  await tick();
  assert.equal(ctx.sent.length, 3);
  assert.match(ctx.sent[2].embeds[0].title, /oppe igen/);
  await tick();
  assert.equal(ctx.sent.length, 3, "ikke igen efter succes");
});

test("createOutageMonitor: overlappende tik springes over", async () => {
  let release;
  let probes = 0;
  const fetchFn = async () => {
    probes += 1;
    await new Promise((r) => { release = r; });
    return { status: 200 };
  };
  const env = { SUPABASE_URL: "https://p", SUPABASE_SERVICE_KEY: "k", DISCORD_OPS_WEBHOOK_URL: "https://discord.example/h" };
  const tick = createOutageMonitor({ env, fetchFn, log: () => {} });
  const first = tick();
  await tick();
  assert.equal(probes, 1, "andet tik må ikke starte en probe mens det første kører");
  release();
  await first;
});
