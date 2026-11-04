// scripts/ops/db-watchdog.test.mjs
// Alarmregel + checks for databasevagten (#5878).
// Run: node --test scripts/ops/db-watchdog.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  API_5XX_MIN_COUNT,
  buildPayload,
  checkBackend,
  checkPostgrest,
  checkPostmaster,
  classifyPsqlFailure,
  CONFIRM_DELAY_MS,
  emptyState,
  evaluate,
  evaluateApi5xx,
  evaluateSlowQueries,
  fetchApi5xxSample,
  fetchSlowStatements,
  FRESH_RESTART_MS,
  main,
  missingEnv,
  normalizeState,
  rollbackUnsent,
  SLOW_COOLDOWN_MS,
  SLOW_FETCH_LIMIT,
  SLOW_MIN_CALLS,
  SLOW_SQL,
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
  // #7662: en genstart er alvorlig nok til at pinge ejeren.
  assert.equal(buildPayload(restart, { mention: "<@123>" }).content, "<@123>");
  const slow = { kind: "slow", items: [{ id: "1", query: "select 1", calls: 4, meanMs: 2000 }], omitted: 0, at: t(0) };
  assert.equal(buildPayload(slow, { mention: "<@123>" }).content, undefined);
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
    if (new URL(url).hostname === "discord.example") {
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

const noSleep = async () => {};

test("main: fuldt forløb ned -> ned -> ned -> oppe giver præcis to Discord-beskeder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbw-"));
  const healthy = { value: true };
  const h = harness({ healthy });
  const env = makeEnv(dir);
  const run = (min) => main({ env, fetchFn: h.fetchFn, execFn: h.execFn, now: () => new Date(t(min)), log: () => {}, sleep: noSleep });

  assert.equal(await run(0), 0);
  healthy.value = false;
  // #6854: fejlen bekræftes i samme kørsel, så alarmen ikke venter på næste kørsel.
  await run(5);
  assert.equal(h.discord.length, 1);
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
    if (new URL(url).hostname === "discord.example") {
      sent.push(opts.body);
      return { ok: discordOk, status: discordOk ? 204 : 500 };
    }
    return { status: 503, ok: false };
  };
  const run = (min) => main({ env, fetchFn, execFn, now: () => new Date(t(min)), log: () => {}, sleep: noSleep });
  await run(0);
  assert.equal(sent.length, 1);
  discordOk = true;
  await run(5);
  assert.equal(sent.length, 2, "alarmen prøves igen");
  await run(10);
  assert.equal(sent.length, 2, "men ikke igen efter succes");
});

test("main (#6854): én kørsel midt i et udfald alarmerer selv, efter én pause", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbw-"));
  const h = harness({ healthy: { value: false } });
  const sleeps = [];
  const code = await main({
    env: makeEnv(dir), fetchFn: h.fetchFn, execFn: h.execFn,
    now: () => new Date(t(0)), log: () => {}, sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(code, 0);
  assert.equal(h.discord.length, 1);
  assert.match(h.discord[0].embeds[0].title, /svarer ikke/);
  assert.deepEqual(sleeps, [CONFIRM_DELAY_MS], "stopper når alarmen er sendt");
});

test("main (#6854): et kort blip der er grønt ved anden måling alarmerer ikke", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbw-"));
  const healthy = { value: false };
  const h = harness({ healthy });
  const code = await main({
    env: makeEnv(dir), fetchFn: h.fetchFn, execFn: h.execFn,
    now: () => new Date(t(0)), log: () => {}, sleep: async () => { healthy.value = true; },
  });
  assert.equal(code, 0);
  assert.equal(h.discord.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")).consecutiveFailures, 0);
});

// --- #7662: genstart uden baseline --------------------------------------------

test("#7662 genstart: første kørsel med gammel starttid er kun baseline (ingen falsk alarm)", () => {
  const r = evaluate(emptyState(), green(START_A), t(0));
  assert.deepEqual(r.messages, []);
  assert.equal(r.state.lastPostmasterStart, START_A);
});

test("#7662 genstart: helt frisk start uden baseline (tabt tilstand) alarmerer alligevel", () => {
  const now = t(0);
  const fresh = new Date(new Date(now).getTime() - FRESH_RESTART_MS + 60_000).toISOString().replace(/\.\d+Z$/, "Z");
  const r = evaluate(emptyState(), green(fresh), now);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].kind, "restart");
  assert.equal(r.messages[0].previousStart, null);
  assert.match(buildPayload(r.messages[0], { mention: null }).embeds[0].description, /tabt/);
  // Næste kørsel med samme starttid er stille.
  assert.deepEqual(evaluate(r.state, green(fresh), t(5)).messages, []);
});

test("#7662 genstart: en start lidt ældre end vinduet uden baseline er stadig kun baseline", () => {
  const now = t(0);
  const old = new Date(new Date(now).getTime() - FRESH_RESTART_MS - 60_000).toISOString().replace(/\.\d+Z$/, "Z");
  assert.deepEqual(evaluate(emptyState(), green(old), now).messages, []);
});

test("#7662 genstart: mislykket afsendelse af en frisk-genstart-besked prøves igen, også efter vinduet", () => {
  const now = t(0);
  const fresh = new Date(new Date(now).getTime() - 60_000).toISOString().replace(/\.\d+Z$/, "Z");
  const first = evaluate(emptyState(), green(fresh), now);
  const rolled = rollbackUnsent(first.state, emptyState(), first.messages[0]);
  assert.equal(rolled.lastPostmasterStart, null);
  assert.equal(rolled.pendingRestartStart, fresh);
  const later = new Date(new Date(now).getTime() + 2 * FRESH_RESTART_MS).toISOString();
  const retry = evaluate(rolled, green(fresh), later);
  assert.deepEqual(retry.messages.map((m) => m.kind), ["restart"]);
  assert.equal(retry.state.pendingRestartStart, null);
  assert.deepEqual(evaluate(retry.state, green(fresh), later).messages, []);
});

test("#7662 genstart nulstiller query-snapshot (tællerne starter forfra)", () => {
  const prev = { ...evaluate(emptyState(), green(START_A), t(0)).state, slowSnapshot: { a: { calls: 5, totalMs: 100 } } };
  const r = evaluate(prev, green(START_B), t(5));
  assert.equal(r.messages[0].kind, "restart");
  assert.equal(r.state.slowSnapshot, null);
});

// --- #7662: 5xx-regel -----------------------------------------------------------

test("#7662 5xx: første måling lægger kun baseline, selv ved høj fejlandel", () => {
  const r = evaluateApi5xx(emptyState(), { errors: 500, total: 600 }, t(0));
  assert.deepEqual(r.messages, []);
  assert.ok(r.state.api5xxBaselineRate > 0.8);
  assert.equal(r.state.api5xxActive, false);
});

test("#7662 5xx: roligt niveau alarmerer ikke og glider baseline", () => {
  let s = evaluateApi5xx(emptyState(), { errors: 1, total: 1000 }, t(0)).state;
  const r = evaluateApi5xx(s, { errors: 2, total: 1000 }, t(15));
  assert.deepEqual(r.messages, []);
  assert.ok(r.state.api5xxBaselineRate > 0.001 && r.state.api5xxBaselineRate < 0.002);
});

test("#7662 5xx: stigning giver præcis én besked og ingen gentagelser mens den varer", () => {
  let s = evaluateApi5xx(emptyState(), { errors: 1, total: 1000 }, t(0)).state;
  const spike = evaluateApi5xx(s, { errors: 80, total: 400 }, t(15));
  assert.equal(spike.messages.length, 1);
  assert.equal(spike.messages[0].kind, "api5xx");
  assert.equal(spike.state.api5xxActive, true);
  assert.equal(spike.state.api5xxBaselineRate, s.api5xxBaselineRate, "baseline følger ikke udfaldet");
  const again = evaluateApi5xx(spike.state, { errors: 90, total: 400 }, t(30));
  assert.deepEqual(again.messages, []);
  const over = evaluateApi5xx(again.state, { errors: 0, total: 400 }, t(45));
  assert.equal(over.state.api5xxActive, false);
  const second = evaluateApi5xx(over.state, { errors: 80, total: 400 }, t(60));
  assert.equal(second.messages.length, 1, "ny stigning kan alarmere igen");
});

test("#7662 5xx: for få fejl alarmerer ikke, selv ved høj andel af få kald", () => {
  const s = evaluateApi5xx(emptyState(), { errors: 0, total: 1000 }, t(0)).state;
  const r = evaluateApi5xx(s, { errors: API_5XX_MIN_COUNT - 1, total: API_5XX_MIN_COUNT }, t(15));
  assert.deepEqual(r.messages, []);
});

test("#7662 5xx: en høj normalandel hæver grænsen (ingen larm på vedvarende støj)", () => {
  let s = evaluateApi5xx(emptyState(), { errors: 100, total: 1000 }, t(0)).state;
  const r = evaluateApi5xx(s, { errors: 120, total: 1000 }, t(15));
  assert.deepEqual(r.messages, []);
});

test("#7662 5xx: manglende måling ændrer intet", () => {
  const s = { ...emptyState(), api5xxBaselineRate: 0.01, api5xxActive: true };
  const r = evaluateApi5xx(s, null, t(0));
  assert.deepEqual(r.state, s);
  assert.deepEqual(r.messages, []);
});

test("#7662 5xx: rollback efter mislykket afsendelse prøver igen næste gang", () => {
  const base = evaluateApi5xx(emptyState(), { errors: 0, total: 1000 }, t(0)).state;
  const spike = evaluateApi5xx(base, { errors: 80, total: 400 }, t(15));
  const rolled = rollbackUnsent(spike.state, base, spike.messages[0]);
  assert.equal(rolled.api5xxActive, false);
  assert.equal(evaluateApi5xx(rolled, { errors: 80, total: 400 }, t(30)).messages.length, 1);
});

test("#7662 5xx: fetchApi5xxSample læser tællere, afviser fejl og kaster aldrig", async () => {
  const now = new Date(t(0));
  let seen;
  const ok = await fetchApi5xxSample(async (url, opts) => {
    seen = { url: String(url), auth: opts.headers.Authorization };
    return { ok: true, status: 200, json: async () => ({ result: [{ errors: "7", total: 120 }] }) };
  }, "tok", "ref123", now);
  assert.deepEqual(ok.sample, { errors: 7, total: 120 });
  assert.match(seen.url, /projects\/ref123\/analytics\/endpoints\/logs/);
  assert.equal(seen.auth, "Bearer tok");

  const empty = await fetchApi5xxSample(async () => ({ ok: true, json: async () => ({ result: [] }) }), "t", "r", now);
  assert.deepEqual(empty.sample, { errors: 0, total: 0 });
  const http = await fetchApi5xxSample(async () => ({ ok: false, status: 401 }), "t", "r", now);
  assert.equal(http.sample, null);
  assert.match(http.reason, /401/);
  const sqlErr = await fetchApi5xxSample(async () => ({ ok: true, json: async () => ({ error: "boom" }) }), "t", "r", now);
  assert.equal(sqlErr.sample, null);
  const bad = await fetchApi5xxSample(async () => ({ ok: true, json: async () => ({ result: [{ errors: -1, total: 5 }] }) }), "t", "r", now);
  assert.equal(bad.sample, null);
  const net = await fetchApi5xxSample(async () => { throw Object.assign(new Error("x"), { cause: { code: "ECONNRESET" } }); }, "t", "r", now);
  assert.equal(net.sample, null);
  assert.doesNotMatch(net.reason, /tok/);
});

// --- #7662: langsom-forespørgsel-regel -----------------------------------------

const row = (id, calls, totalMs, query = `select ${id}`) => ({ id, calls, totalMs, query });

test("#7662 langsom: første kørsel lægger kun snapshot, selv med enorme akkumulerede tal", () => {
  const r = evaluateSlowQueries(emptyState(), [row("a", 1000, 9_000_000)], t(0));
  assert.deepEqual(r.messages, []);
  assert.deepEqual(r.state.slowSnapshot, { a: { calls: 1000, totalMs: 9_000_000 } });
});

test("#7662 langsom: gentagne langsomme kald siden sidst giver én besked med de rigtige tal", () => {
  const s = evaluateSlowQueries(emptyState(), [row("a", 10, 500), row("b", 10, 100)], t(0)).state;
  const r = evaluateSlowQueries(s, [row("a", 10 + SLOW_MIN_CALLS, 500 + 3 * 2500), row("b", 20, 400)], t(60));
  assert.equal(r.messages.length, 1);
  assert.deepEqual(r.messages[0].items.map((i) => [i.id, i.calls, i.meanMs]), [["a", SLOW_MIN_CALLS, 2500]]);
  assert.match(buildPayload(r.messages[0], { mention: null }).embeds[0].description, /2500 ms/);
});

test("#7662 langsom: et enkelt langsomt kald eller hurtigt gennemsnit alarmerer ikke", () => {
  const s = evaluateSlowQueries(emptyState(), [row("a", 10, 500), row("b", 10, 500)], t(0)).state;
  const r = evaluateSlowQueries(s, [row("a", 11, 500 + 9000), row("b", 100, 500 + 90 * 50)], t(60));
  assert.deepEqual(r.messages, []);
});

test("#7662 langsom: nedkøling pr. forespørgsel, så den ikke larmer hver kørsel", () => {
  let s = evaluateSlowQueries(emptyState(), [row("a", 0, 0)], t(0)).state;
  const first = evaluateSlowQueries(s, [row("a", 5, 20_000)], t(60));
  assert.equal(first.messages.length, 1);
  const second = evaluateSlowQueries(first.state, [row("a", 10, 40_000)], t(120));
  assert.deepEqual(second.messages, [], "inden for nedkølingen");
  const later = new Date(new Date(t(60)).getTime() + SLOW_COOLDOWN_MS + 1000).toISOString();
  const third = evaluateSlowQueries(second.state, [row("a", 15, 60_000)], later);
  assert.equal(third.messages.length, 1, "efter nedkølingen");
});

test("#7662 langsom: en ny forespørgsel der er langsom i sit første interval opdages (komplet snapshot)", () => {
  const s = evaluateSlowQueries(emptyState(), [row("a", 10, 100)], t(0)).state;
  const r = evaluateSlowQueries(s, [row("a", 10, 100), row("new", 4, 12_000)], t(60));
  assert.deepEqual(r.messages[0].items.map((i) => i.id), ["new"]);
});

test("#7662 langsom: en forespørgsel uden for et afkortet snapshot er kun baseline", () => {
  const full = Object.fromEntries(Array.from({ length: SLOW_FETCH_LIMIT }, (_, i) => [`q${i}`, { calls: 1, totalMs: 1 }]));
  const s = { ...emptyState(), slowSnapshot: full };
  const r = evaluateSlowQueries(s, [row("late", 900, 9_000_000)], t(60));
  assert.deepEqual(r.messages, []);
});

test("#7662 langsom: SQL'en lægger tællere sammen pr. queryid og har bred grænse", () => {
  assert.match(SLOW_SQL, /group by queryid/);
  assert.match(SLOW_SQL, new RegExp(`limit ${SLOW_FETCH_LIMIT}\\)`));
});

test("#7662 langsom: nulstillede tællere (genstart) giver ingen falsk alarm", () => {
  const s = evaluateSlowQueries(emptyState(), [row("a", 1000, 5_000_000)], t(0)).state;
  const r = evaluateSlowQueries(s, [row("a", 4, 20_000)], t(60));
  assert.deepEqual(r.messages, []);
});

test("#7662 langsom: mislykket måling ændrer ingen tilstand", () => {
  const s = evaluateSlowQueries(emptyState(), [row("a", 1, 1)], t(0)).state;
  const r = evaluateSlowQueries(s, null, t(60));
  assert.deepEqual(r.state, s);
  assert.deepEqual(r.messages, []);
});

test("#7662 langsom: rollback efter mislykket afsendelse bevarer forskellen til næste kørsel", () => {
  const base = evaluateSlowQueries(emptyState(), [row("a", 0, 0)], t(0)).state;
  const hit = evaluateSlowQueries(base, [row("a", 5, 20_000)], t(60));
  const rolled = rollbackUnsent(hit.state, base, hit.messages[0]);
  assert.equal(rolled.slowAlertedAt.a, undefined);
  assert.deepEqual(rolled.slowSnapshot.a, { calls: 0, totalMs: 0 });
  const retry = evaluateSlowQueries(rolled, [row("a", 6, 24_000)], t(120));
  assert.equal(retry.messages.length, 1);
});

test("#7662 langsom: kun de værste vises, resten tælles", () => {
  const base = evaluateSlowQueries(emptyState(), Array.from({ length: 8 }, (_, i) => row(`q${i}`, 0, 0)), t(0)).state;
  const r = evaluateSlowQueries(base, Array.from({ length: 8 }, (_, i) => row(`q${i}`, 5, 5 * (2000 + i * 100))), t(60));
  assert.equal(r.messages[0].items.length, 5);
  assert.equal(r.messages[0].omitted, 3);
  assert.equal(r.messages[0].items[0].id, "q7");
});

test("#7662 langsom: fetchSlowStatements parser JSON, dropper ugyldige rækker og skjuler URL ved fejl", async () => {
  const ok = await fetchSlowStatements(async (cmd, args, opts) => {
    assert.equal(cmd, "psql");
    assert.equal(args[0], "postgres://secret-url");
    assert.match(args[args.length - 1], /pg_stat_statements/);
    assert.match(opts.env.PGOPTIONS, /statement_timeout=5s/);
    return { stdout: JSON.stringify([{ id: "1", calls: 3, total_ms: "900", query: "select 1" }, { id: "", calls: 1, total_ms: 1 }, { id: "2", calls: -1, total_ms: 1 }]) + "\n" };
  }, "postgres://secret-url");
  assert.deepEqual(ok.rows, [{ id: "1", calls: 3, totalMs: 900, query: "select 1" }]);

  const garbage = await fetchSlowStatements(async () => ({ stdout: "SET\n" }), "postgres://x");
  assert.equal(garbage.rows, null);
  const bad = await fetchSlowStatements(async () => {
    throw Object.assign(new Error("Command failed: psql postgres://secret-url"), { stderr: "timeout expired at db.secret-host" });
  }, "postgres://secret-url");
  assert.equal(bad.rows, null);
  assert.doesNotMatch(JSON.stringify(bad), /secret/);
});

// --- #7662: main() med de nye regler -------------------------------------------

test("#7662 main: første kørsel (ingen tilstand) sender ingen alarm, uanset 5xx og langsomme tal", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbw-"));
  const discord = [];
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.hostname === "discord.example") { discord.push(JSON.parse(opts.body)); return { ok: true, status: 204 }; }
    if (u.hostname === "api.supabase.com") return { ok: true, status: 200, json: async () => ({ result: [{ errors: 900, total: 1000 }] }) };
    return { status: 200, ok: true };
  };
  const execFn = async (cmd, args) => {
    if (/pg_stat_statements/.test(args[args.length - 1])) {
      return { stdout: JSON.stringify([{ id: "a", calls: 5000, total_ms: 99_000_000, query: "select slow" }]) };
    }
    return { stdout: `${START_A}\n` };
  };
  const env = makeEnv(dir, { SUPABASE_ACCESS_TOKEN: "tok" });
  const logs = [];
  const code = await main({ env, fetchFn, execFn, now: () => new Date(t(0)), log: (l) => logs.push(l), sleep: noSleep });
  assert.equal(code, 0);
  assert.deepEqual(discord, []);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.ok(saved.slowSnapshot.a);
  assert.ok(saved.api5xxBaselineRate > 0.8);
  assert.ok(logs.some((l) => /Tilstandsfil mangler/.test(l)), "tabt tilstand logges som advarsel");
});

test("#7662 main: anden kørsel alarmerer ved 5xx-stigning og gentagen langsom forespørgsel, og en manglende token springer 5xx over", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbw-"));
  const discord = [];
  let errors = 1;
  let slowCalls = 0;
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.hostname === "discord.example") { discord.push(JSON.parse(opts.body)); return { ok: true, status: 204 }; }
    if (u.hostname === "api.supabase.com") return { ok: true, status: 200, json: async () => ({ result: [{ errors, total: 1000 }] }) };
    return { status: 200, ok: true };
  };
  const execFn = async (cmd, args) => {
    if (/pg_stat_statements/.test(args[args.length - 1])) {
      return { stdout: JSON.stringify([{ id: "a", calls: slowCalls, total_ms: slowCalls * 3000, query: "select slow" }]) };
    }
    return { stdout: `${START_A}\n` };
  };
  const env = makeEnv(dir, { SUPABASE_ACCESS_TOKEN: "tok" });
  const run = (min, e = env) => main({ env: e, fetchFn, execFn, now: () => new Date(t(min)), log: () => {}, sleep: noSleep });
  await run(0);
  errors = 400;
  slowCalls = 6;
  await run(20);
  assert.deepEqual(discord.map((m) => m.embeds[0].title).sort(), [
    "Databasevagt: 5xx-fejl stiger på Supabase-API'et",
    "Databasevagt: langsomme forespørgsler gentager sig",
  ].sort());
  await run(40);
  assert.equal(discord.length, 2, "ingen gentagelse mens begge er aktive/nedkølet");

  const { SUPABASE_ACCESS_TOKEN, ...noToken } = env;
  const logs = [];
  await main({ env: noToken, fetchFn, execFn, now: () => new Date(t(60)), log: (l) => logs.push(l), sleep: noSleep });
  assert.ok(logs.some((l) => /5xx-reglen er slukket/.test(l)));
  assert.equal(discord.length, 2);
});

test("#7662 main: en fejlende 5xx-måling eller query-måling fælder ikke kørslen", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbw-"));
  const fetchFn = async (url) => {
    if (new URL(url).hostname === "api.supabase.com") throw new Error("nede");
    return { status: 200, ok: true };
  };
  const execFn = async (cmd, args) => {
    if (/pg_stat_statements/.test(args[args.length - 1])) throw Object.assign(new Error("x"), { stderr: "permission denied" });
    return { stdout: `${START_A}\n` };
  };
  const code = await main({
    env: makeEnv(dir, { SUPABASE_ACCESS_TOKEN: "tok" }), fetchFn, execFn,
    now: () => new Date(t(0)), log: () => {}, sleep: noSleep,
  });
  assert.equal(code, 0);
});
