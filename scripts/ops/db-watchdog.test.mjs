// scripts/ops/db-watchdog.test.mjs
// Alarmregel + checks for databasevagten (#5878).
// Run: node --test scripts/ops/db-watchdog.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPayload,
  checkBackend,
  checkPostgrest,
  checkPostmaster,
  classifyPsqlFailure,
  emptyState,
  evaluate,
  main,
  missingEnv,
  normalizeState,
  rollbackUnsent,
  sentryCheckinUrl,
} from "./db-watchdog.mjs";

const OK = { ok: true, detail: "HTTP 200" };
const BAD = { ok: false, detail: "HTTP 503" };
const START_A = "2026-10-02T17:26:00Z";
const START_B = "2026-10-06T11:00:37Z";

const green = (startTime = START_A) => ({
  backend: OK,
  postgrest: OK,
  postmaster: { ok: true, detail: `oppe siden ${startTime}`, startTime },
});
const red = () => ({
  backend: BAD,
  postgrest: BAD,
  postmaster: { ok: false, detail: "connect timeout (5 s)" },
});

const t = (min) => new Date(Date.UTC(2026, 9, 10, 12, min)).toISOString();

test("groen kørsel uden historik giver ingen besked og gemmer baseline", () => {
  const { state, messages } = evaluate(emptyState(), green(), t(0));
  assert.deepEqual(messages, []);
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.lastPostmasterStart, START_A);
});

test("én enkelt fejl alarmerer ikke (deploy-vindue)", () => {
  const first = evaluate(emptyState(), green(), t(0));
  const second = evaluate(first.state, red(), t(5));
  assert.deepEqual(second.messages, []);
  assert.equal(second.state.consecutiveFailures, 1);
  assert.equal(second.state.alertActive, false);
});

test("fejl efterfulgt af groen nulstiller tælleren uden alarm eller 'oppe igen'", () => {
  let s = evaluate(emptyState(), green(), t(0)).state;
  s = evaluate(s, red(), t(5)).state;
  const r = evaluate(s, green(), t(10));
  assert.deepEqual(r.messages, []);
  assert.equal(r.state.consecutiveFailures, 0);
  assert.equal(r.state.firstFailureAt, null);
});

test("to fejl i træk giver præcis én 'down'-besked med starttidspunkt for første fejl", () => {
  let s = evaluate(emptyState(), green(), t(0)).state;
  s = evaluate(s, red(), t(5)).state;
  const r = evaluate(s, red(), t(10));
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].kind, "down");
  assert.equal(r.messages[0].since, t(5));
  assert.equal(r.messages[0].failures, 2);
  assert.equal(r.state.alertActive, true);
});

test("ingen gentagne alarmer mens nedetiden varer", () => {
  let s = evaluate(emptyState(), green(), t(0)).state;
  s = evaluate(s, red(), t(5)).state;
  s = evaluate(s, red(), t(10)).state;
  for (let i = 3; i < 12; i += 1) {
    const r = evaluate(s, red(), t(i * 5));
    assert.deepEqual(r.messages, [], `kørsel ${i}`);
    s = r.state;
  }
  assert.equal(s.alertActive, true);
  assert.equal(s.consecutiveFailures, 11);
});

test("'oppe igen' sendes præcis én gang med varighed, og tilstanden nulstilles", () => {
  let s = evaluate(emptyState(), green(), t(0)).state;
  s = evaluate(s, red(), t(5)).state;
  s = evaluate(s, red(), t(10)).state;
  const up = evaluate(s, green(), t(25));
  assert.equal(up.messages.length, 1);
  assert.equal(up.messages[0].kind, "recovered");
  assert.equal(up.messages[0].since, t(5));
  assert.equal(up.messages[0].until, t(25));
  assert.equal(up.state.alertActive, false);
  assert.equal(up.state.consecutiveFailures, 0);

  const again = evaluate(up.state, green(), t(30));
  assert.deepEqual(again.messages, []);
});

test("ny nedetid efter 'oppe igen' kan alarmere igen", () => {
  let s = evaluate(emptyState(), green(), t(0)).state;
  s = evaluate(s, red(), t(5)).state;
  s = evaluate(s, red(), t(10)).state;
  s = evaluate(s, green(), t(15)).state;
  s = evaluate(s, red(), t(20)).state;
  const r = evaluate(s, red(), t(25));
  assert.deepEqual(r.messages.map((m) => m.kind), ["down"]);
});

test("genstart-markør: ændret starttid giver én besked, også når alt er groent", () => {
  const s = evaluate(emptyState(), green(START_A), t(0)).state;
  const r = evaluate(s, green(START_B), t(5));
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].kind, "restart");
  assert.equal(r.messages[0].previousStart, START_A);
  assert.equal(r.messages[0].newStart, START_B);
  assert.equal(r.messages[0].healthyNow, true);
  assert.equal(r.state.lastPostmasterStart, START_B);

  const same = evaluate(r.state, green(START_B), t(10));
  assert.deepEqual(same.messages, []);
});

test("manglende starttid (fejlet check) bevarer sidste kendte værdi", () => {
  let s = evaluate(emptyState(), green(START_A), t(0)).state;
  s = evaluate(s, red(), t(5)).state;
  assert.equal(s.lastPostmasterStart, START_A);
  s = evaluate(s, red(), t(10)).state;
  const r = evaluate(s, green(START_B), t(15));
  assert.deepEqual(r.messages.map((m) => m.kind).sort(), ["recovered", "restart"]);
});

test("rollback: mislykket afsendelse prøves igen næste kørsel", () => {
  let s = evaluate(emptyState(), green(), t(0)).state;
  s = evaluate(s, red(), t(5)).state;
  const prev = s;
  const down = evaluate(prev, red(), t(10));
  const rolled = rollbackUnsent(down.state, prev, down.messages[0]);
  assert.equal(rolled.alertActive, false);
  const retry = evaluate(rolled, red(), t(15));
  assert.deepEqual(retry.messages.map((m) => m.kind), ["down"]);

  const activePrev = down.state;
  const up = evaluate(activePrev, green(), t(20));
  const rolledUp = rollbackUnsent(up.state, activePrev, up.messages[0]);
  assert.equal(rolledUp.alertActive, true);
  assert.equal(rolledUp.firstFailureAt, activePrev.firstFailureAt);

  const restartPrev = evaluate(emptyState(), green(START_A), t(0)).state;
  const restart = evaluate(restartPrev, green(START_B), t(5));
  const rolledRestart = rollbackUnsent(restart.state, restartPrev, restart.messages[0]);
  assert.equal(rolledRestart.lastPostmasterStart, START_A);
});

test("ødelagt eller manglende tilstand starter forfra", () => {
  assert.deepEqual(normalizeState(null), emptyState());
  assert.deepEqual(normalizeState("x"), emptyState());
  assert.deepEqual(normalizeState({ consecutiveFailures: -3, alertActive: "ja" }), emptyState());
});

test("payload: @mention kun på nedetids-alarmen, og ingen secrets i teksten", () => {
  const down = evaluate(
    evaluate(evaluate(emptyState(), green(), t(0)).state, red(), t(5)).state,
    red(),
    t(10)
  ).messages[0];
  const withMention = buildPayload(down, { mention: "<@123>", runUrl: "https://example.test/run/1" });
  assert.equal(withMention.content, "<@123>");
  assert.deepEqual(withMention.allowed_mentions, { parse: ["users"] });
  assert.match(withMention.embeds[0].title, /svarer ikke/);
  assert.match(withMention.embeds[0].description, /PostgREST og backend/);
  assert.match(withMention.embeds[0].description, /example\.test/);

  const recovered = { kind: "recovered", since: t(5), until: t(25), checks: green() };
  const rec = buildPayload(recovered, { mention: "<@123>" });
  assert.equal(rec.content, undefined);
  assert.match(rec.embeds[0].description, /ca\. 20 min/);

  const restart = { kind: "restart", previousStart: START_A, newStart: START_B, healthyNow: true };
  assert.equal(buildPayload(restart, { mention: "<@123>" }).content, undefined);
});

test("payload uden mention sender kun embed", () => {
  const down = { kind: "down", since: t(5), failures: 2, checks: red() };
  const p = buildPayload(down, { mention: null });
  assert.equal(p.content, undefined);
  assert.ok(p.embeds[0]);
});

test("checkBackend: kun HTTP 200 er ok, 503 og netværksfejl er fejl", async () => {
  const ok = await checkBackend(async (url, opts) => {
    assert.equal(url, "https://backend.example/health/ready");
    assert.equal(opts.method, "GET");
    return { status: 200 };
  }, "https://backend.example/");
  assert.equal(ok.ok, true);
  assert.deepEqual(await checkBackend(async () => ({ status: 503 }), "https://b.example"), { ok: false, detail: "HTTP 503" });
  const timeout = await checkBackend(async () => {
    throw Object.assign(new Error("t"), { name: "TimeoutError" });
  }, "https://b.example");
  assert.equal(timeout.ok, false);
  assert.match(timeout.detail, /timeout/);
});

test("checkPostgrest: HEAD med apikey, uden Authorization; 5xx og timeout er fejl", async () => {
  const ok = await checkPostgrest(async (url, opts) => {
    assert.equal(url, "https://proj.example/rest/v1/app_config?select=key&limit=1");
    assert.equal(opts.method, "HEAD");
    assert.deepEqual(opts.headers, { apikey: "pub-key" });
    return { status: 200 };
  }, "https://proj.example/", "pub-key");
  assert.equal(ok.ok, true);
  assert.equal((await checkPostgrest(async () => ({ status: 522 }), "https://p.example", "k")).ok, false);
  assert.equal((await checkPostgrest(async () => ({ status: 401 }), "https://p.example", "k")).ok, false);
  const net = await checkPostgrest(async () => {
    throw Object.assign(new Error("x"), { cause: { code: "ECONNRESET" } });
  }, "https://p.example", "k");
  assert.match(net.detail, /ECONNRESET/);
});

test("checkPostmaster: bruger connect_timeout 5, statement_timeout 5s og printer aldrig URL ved fejl", async () => {
  const ok = await checkPostmaster(async (cmd, args, opts) => {
    assert.equal(cmd, "psql");
    assert.equal(args[0], "postgres://secret-url");
    assert.equal(opts.env.PGCONNECT_TIMEOUT, "5");
    assert.match(opts.env.PGOPTIONS, /statement_timeout=5s/);
    return { stdout: "2026-10-02T17:26:00Z\n" };
  }, "postgres://secret-url");
  assert.deepEqual(ok, { ok: true, detail: "oppe siden 2026-10-02T17:26:00Z", startTime: "2026-10-02T17:26:00Z" });

  const bad = await checkPostmaster(async () => {
    throw Object.assign(new Error("Command failed: psql postgres://secret-url"), {
      stderr: "psql: error: connection to server at db.secret-host failed: timeout expired",
    });
  }, "postgres://secret-url");
  assert.equal(bad.ok, false);
  assert.equal(bad.detail, "connect timeout (5 s)");
  assert.doesNotMatch(JSON.stringify(bad), /secret/);

  const garbage = await checkPostmaster(async () => ({ stdout: "SET\n" }), "postgres://x");
  assert.equal(garbage.ok, false);
});

test("classifyPsqlFailure skelner de typiske fejlklasser", () => {
  assert.equal(classifyPsqlFailure({ code: "ENOENT" }), "psql ikke fundet");
  assert.equal(classifyPsqlFailure({ killed: true }), "psql-timeout");
  assert.equal(classifyPsqlFailure({ stderr: "canceling statement due to statement timeout" }), "statement timeout (5 s)");
  assert.equal(classifyPsqlFailure({ stderr: "FATAL: remaining connection slots are reserved" }), "for mange forbindelser");
  assert.equal(classifyPsqlFailure({ stderr: "weird" }), "forbindelsesfejl");
});

test("sentryCheckinUrl bygges ud fra DSN og afviser ugyldig DSN", () => {
  assert.equal(
    sentryCheckinUrl("https://abc123@o42.ingest.sentry.io/777"),
    "https://o42.ingest.sentry.io/api/777/cron/db-watchdog/abc123/?status=ok&environment=production"
  );
  assert.equal(sentryCheckinUrl("not a url"), null);
  assert.equal(sentryCheckinUrl("https://o42.ingest.sentry.io/777"), null);
});

test("missingEnv navngiver præcis de manglende secrets", () => {
  assert.deepEqual(
    missingEnv({ SUPABASE_URL: "x", SUPABASE_DB_URL: " ", SUPABASE_PUBLISHABLE_KEY: "k" }),
    ["SUPABASE_DB_URL", "DISCORD_OPS_WEBHOOK_URL"]
  );
});

// --- main(): hele kæden med injiceret IO -----------------------------------

function makeEnv(dir, extra = {}) {
  return {
    SUPABASE_URL: "https://proj.example",
    SUPABASE_PUBLISHABLE_KEY: "pub",
    SUPABASE_DB_URL: "postgres://x",
    DISCORD_OPS_WEBHOOK_URL: "https://discord.example/hook",
    DB_WATCHDOG_STATE: path.join(dir, "state.json"),
    DB_WATCHDOG_BACKEND_URL: "https://backend.example",
    ...extra,
  };
}

function harness({ healthy }) {
  const discord = [];
  const fetchFn = async (url, opts = {}) => {
    if (url.startsWith("https://discord.example")) {
      discord.push(JSON.parse(opts.body));
      return { ok: true, status: 204 };
    }
    return { status: healthy.value ? 200 : 503, ok: healthy.value };
  };
  const execFn = async () => {
    if (!healthy.value) throw Object.assign(new Error("x"), { stderr: "timeout expired" });
    return { stdout: `${healthy.start ?? START_A}\n` };
  };
  return { discord, fetchFn, execFn };
}

test("main: manglende secret fejler (exit 1) uden at sende noget", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbw-"));
  const h = harness({ healthy: { value: false } });
  const code = await main({ env: { SUPABASE_URL: "x" }, fetchFn: h.fetchFn, execFn: h.execFn, log: () => {} });
  assert.equal(code, 1);
  assert.equal(h.discord.length, 0);
  assert.equal(fs.existsSync(path.join(dir, "state.json")), false);
});

test("main: fuldt forløb ned -> ned -> ned -> oppe giver præcis to Discord-beskeder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbw-"));
  const healthy = { value: true };
  const h = harness({ healthy });
  const env = makeEnv(dir);
  const run = (min) => main({ env, fetchFn: h.fetchFn, execFn: h.execFn, now: () => new Date(t(min)), log: () => {} });

  assert.equal(await run(0), 0);
  healthy.value = false;
  await run(5);
  assert.equal(h.discord.length, 0);
  await run(10);
  assert.equal(h.discord.length, 1);
  await run(15);
  assert.equal(h.discord.length, 1);
  healthy.value = true;
  await run(20);
  assert.equal(h.discord.length, 2);
  assert.match(h.discord[1].embeds[0].title, /oppe igen/);
  await run(25);
  assert.equal(h.discord.length, 2);
});

test("main: mislykket Discord-afsendelse gemmer ikke alarmen som sendt", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbw-"));
  const env = makeEnv(dir);
  const execFn = async () => {
    throw Object.assign(new Error("x"), { stderr: "timeout expired" });
  };
  let discordOk = false;
  const sent = [];
  const fetchFn = async (url, opts = {}) => {
    if (url.startsWith("https://discord.example")) {
      sent.push(opts.body);
      return { ok: discordOk, status: discordOk ? 204 : 500 };
    }
    return { status: 503, ok: false };
  };
  const run = (min) => main({ env, fetchFn, execFn, now: () => new Date(t(min)), log: () => {} });
  await run(0);
  await run(5);
  assert.equal(sent.length, 1);
  discordOk = true;
  await run(10);
  assert.equal(sent.length, 2, "alarmen prøves igen");
  await run(15);
  assert.equal(sent.length, 2, "men ikke igen efter succes");
});
