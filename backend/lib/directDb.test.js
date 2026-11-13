// #8143 trin 1 · directDb.ts uden netværk: slukket uden miljøvariabel, tidsgrænser,
// fejlmodtager, rensning af fejltekst, reglen om én handel ad gangen, og vagten
// der kun tillader de udpegede filer at importere den direkte linje.
// Prøven mod en rigtig Postgres står i directDb.pg.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIRECT_DB_LIMITS,
  DIRECT_DB_URL_ENV,
  DIRECT_DB_CA_ENV,
  DirectDbError,
  TRANSACTION_PREAMBLE,
  assertTransactionScoped,
  buildPoolConfig,
  createDirectDb,
  isDirectDbConfigured,
  redactConnectionDetails,
  sanitizeDbError,
} from "./directDb.ts";

// En opdigtet adresse (".invalid" findes aldrig), sat sammen af dele, så ingen
// hemmelighedsskanner tager den for en rigtig.
const FAKE_HOST = "db.example.invalid";
const FAKE_USER = "probe_user";
const FAKE_PASSWORD = "not-a-real-password";
const FAKE_URL = ["postgresql", "://", FAKE_USER, ":", FAKE_PASSWORD, "@", FAKE_HOST, ":6543/postgres"].join("");
const ENV = Object.freeze({ [DIRECT_DB_URL_ENV]: FAKE_URL });

function fakeClient(queryImpl) {
  const client = new EventEmitter();
  client.queries = [];
  client.released = [];
  client.query = async (text, params) => {
    client.queries.push({ text, params });
    return queryImpl ? queryImpl(text, params, client) : { rows: [{ ok: 1 }], rowCount: 1 };
  };
  client.release = (destroy) => { client.released.push(destroy); };
  return client;
}

function fakePool({ queryImpl, connectImpl } = {}) {
  const pool = new EventEmitter();
  pool.clients = [];
  pool.ended = false;
  pool.connect = async () => {
    if (connectImpl) return connectImpl();
    const client = pool.reuse ?? fakeClient(queryImpl);
    pool.clients.push(client);
    return client;
  };
  pool.end = async () => { pool.ended = true; };
  return pool;
}

function silentLogger() {
  const lines = [];
  return { lines, warn: (...args) => lines.push(args.join(" ")) };
}

function setup({ pool = fakePool(), env = ENV } = {}) {
  const logger = silentLogger();
  const configs = [];
  let t = 0;
  const db = createDirectDb({
    env,
    logger,
    now: () => (t += 5),
    createPool: (config) => { configs.push(config); return pool; },
  });
  return { db, pool, logger, configs };
}

function assertNoSecrets(text) {
  for (const secret of [FAKE_URL, FAKE_HOST, FAKE_PASSWORD, FAKE_USER]) {
    assert.ok(!String(text).includes(secret), `teksten røber "${secret}": ${text}`);
  }
}

// ── Slukket uden miljøvariabel ─────────────────────────────────────────────

test("#8143: uden DIRECT_DB_URL er linjen slukket: ingen pulje, ingen log, ingen fejl ved lukning", async () => {
  const { db, configs, logger } = setup({ env: {} });
  assert.equal(db.isEnabled(), false);
  await assert.rejects(db.query("SELECT 1"), (err) => err instanceof DirectDbError && err.kind === "off");
  await assert.rejects(db.transaction(async () => 1), (err) => err instanceof DirectDbError && err.kind === "off");
  await db.close();
  assert.equal(configs.length, 0, "puljen må ikke oprettes, når linjen er slukket");
  assert.deepEqual(logger.lines, []);
});

test("#8143: isDirectDbConfigured kræver en ikke-tom værdi", () => {
  assert.equal(isDirectDbConfigured({}), false);
  assert.equal(isDirectDbConfigured({ [DIRECT_DB_URL_ENV]: "   " }), false);
  assert.equal(isDirectDbConfigured(ENV), true);
});

test("#8143: at importere modulet åbner ingen forbindelse (puljen oprettes først ved brug)", () => {
  const { db, configs } = setup();
  assert.equal(db.isEnabled(), true);
  assert.equal(configs.length, 0);
});

// ── Pulje og tidsgrænser ───────────────────────────────────────────────────

test("#8143: lofter og tidsgrænser er designets", () => {
  assert.deepEqual(
    { ...DIRECT_DB_LIMITS },
    {
      maxConnections: 8,
      minConnections: 0,
      idleCloseMs: 30_000,
      connectTimeoutMs: 3_000,
      statementTimeoutMs: 15_000,
      lockTimeoutMs: 3_000,
      idleInTransactionMs: 10_000,
      shutdownTimeoutMs: 5_000,
    },
  );
});

test("#8143: puljens indstillinger: loft, ledige lukkes, 3 s for en forbindelse, 15 s pr. spørgsmål", () => {
  const config = buildPoolConfig(FAKE_URL);
  assert.equal(config.max, 8);
  assert.equal(config.min, 0);
  assert.equal(config.idleTimeoutMillis, 30_000);
  assert.equal(config.connectionTimeoutMillis, 3_000);
  assert.equal(config.query_timeout, 15_000);
  assert.equal(config.allowExitOnIdle, true);
  assert.equal(config.host, FAKE_HOST);
  assert.equal(config.port, 6543);
  assert.equal(config.user, FAKE_USER);
  assert.equal(config.database, "postgres");
  assert.equal("connectionString" in config, false, "pg må aldrig se den samlede adresse");
});

test("#8143: krypteret forbindelse MED tjek af modpartens bevis, også når adressen beder om andet", () => {
  for (const suffix of ["", "?sslmode=disable", "?sslmode=require", "?sslmode=no-verify"]) {
    const config = buildPoolConfig(FAKE_URL + suffix);
    assert.equal(config.ssl.rejectUnauthorized, true, `sslmode i "${suffix}" må ikke slå tjekket fra`);
    assert.equal(config.ssl.servername, FAKE_HOST);
    assert.equal(config.ssl.ca, undefined);
  }
  const withCa = buildPoolConfig(FAKE_URL, { [DIRECT_DB_CA_ENV]: "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----" });
  assert.equal(withCa.ssl.rejectUnauthorized, true);
  assert.equal(withCa.ssl.ca, "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----");
});

test("#8143: en ulæselig adresse giver en config-fejl uden at gentage adressen", () => {
  const broken = FAKE_URL.replace("postgresql://", "postgresql//");
  assert.throws(() => buildPoolConfig(broken), (err) => {
    assert.equal(err.kind, "config");
    assertNoSecrets(err.message);
    return true;
  });
  assert.throws(() => buildPoolConfig(["mysql://", FAKE_USER, ":", FAKE_PASSWORD, "@", FAKE_HOST].join("")),
    (err) => err.kind === "config");
});

test("#8143: hver handel sætter sine egne tidsgrænser, kun for handlen (set_config ..., true)", () => {
  assert.match(TRANSACTION_PREAMBLE, /^BEGIN; SELECT /);
  assert.match(TRANSACTION_PREAMBLE, /set_config\('statement_timeout', '15000', true\)/);
  assert.match(TRANSACTION_PREAMBLE, /set_config\('lock_timeout', '3000', true\)/);
  assert.match(TRANSACTION_PREAMBLE, /set_config\('idle_in_transaction_session_timeout', '10000', true\)/);
  assert.doesNotMatch(TRANSACTION_PREAMBLE, /, false\)/);
});

test("#8143: en handel: tidsgrænser først, COMMIT til sidst, forbindelsen leveres tilbage", async () => {
  const { db, pool } = setup();
  const result = await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [42]);
    const r = await tx.query("SELECT 1 AS ok");
    return r.rows[0].ok;
  });
  assert.equal(result, 1);
  const [client] = pool.clients;
  assert.deepEqual(client.queries.map((q) => q.text), [
    TRANSACTION_PREAMBLE,
    "SELECT pg_advisory_xact_lock($1)",
    "SELECT 1 AS ok",
    "COMMIT",
  ]);
  assert.deepEqual(client.released, [undefined]);
  assert.equal(client.listenerCount("error"), 0, "fejlmodtageren fjernes, når forbindelsen leveres tilbage");
});

test("#8143: kalderens egen fejl giver ROLLBACK og sendes uændret videre", async () => {
  const { db, pool } = setup();
  class GameRuleError extends Error {}
  const thrown = new GameRuleError("regel brudt");
  await assert.rejects(db.transaction(async (tx) => {
    await tx.query("SELECT 1");
    throw thrown;
  }), (err) => err === thrown);
  const [client] = pool.clients;
  assert.equal(client.queries.at(-1).text, "ROLLBACK");
  assert.ok(!client.queries.some((q) => q.text === "COMMIT"));
  assert.deepEqual(client.released, [undefined]);
  assert.equal(db.stats().failures, 1);
});

test("#8143: fejler ROLLBACK, lukkes forbindelsen i stedet for at blive genbrugt", async () => {
  const pool = fakePool({
    queryImpl: (text) => {
      if (text === "ROLLBACK") throw Object.assign(new Error("Connection terminated unexpectedly"), {});
      return { rows: [], rowCount: 0 };
    },
  });
  const { db } = setup({ pool });
  await assert.rejects(db.transaction(async () => { throw new Error("stop"); }), /stop/);
  assert.deepEqual(pool.clients[0].released, [true]);
});

test("#8143: 3 s-grænsen for at få en forbindelse bliver til en pool-timeout-fejl", async () => {
  const pool = fakePool({ connectImpl: async () => { throw new Error("timeout exceeded when trying to connect"); } });
  const { db } = setup({ pool });
  await assert.rejects(db.query("SELECT 1"), (err) => err instanceof DirectDbError && err.kind === "pool-timeout");
});

test("#8143: databasens egne tidsgrænser genkendes (statement 57014, lås 55P03)", async () => {
  const pool = fakePool({
    queryImpl: (text) => {
      if (text.includes("slow")) throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
      throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
    },
  });
  const { db } = setup({ pool });
  await assert.rejects(db.query("SELECT slow()"), (err) => err.kind === "timeout" && err.sqlState === "57014");
  await assert.rejects(db.query("SELECT locked()"), (err) => err.kind === "lock-timeout" && err.sqlState === "55P03");
});

test("#8143: tiden for at få en forbindelse og tiden for spørgsmålet måles hver for sig", async () => {
  const pool = fakePool();
  pool.reuse = fakeClient();
  const { db } = setup({ pool });
  const timings = [];
  await db.query("SELECT 1", [], { onTiming: (t) => timings.push(t) });
  await db.query("SELECT 1", [], { onTiming: (t) => timings.push(t) });
  assert.equal(timings.length, 2);
  assert.equal(timings[0].newConnection, true);
  assert.equal(timings[1].newConnection, false, "samme forbindelse anden gang");
  for (const t of timings) {
    assert.ok(t.acquireMs > 0 && t.queryMs > 0);
  }
});

// ── Fejlmodtager ───────────────────────────────────────────────────────────

test("#8143: puljen har sin egen fejlmodtager: en tabt ledig forbindelse vælter ikke serveren", async () => {
  const { db, pool, logger } = setup();
  await db.query("SELECT 1");
  assert.ok(pool.listenerCount("error") >= 1, "puljen skal have en fejlmodtager");
  const err = new Error(`connection to ${FAKE_URL} lost (${FAKE_HOST})`);
  assert.doesNotThrow(() => pool.emit("error", err));
  assert.equal(db.stats().poolErrors, 1);
  assert.equal(logger.lines.length, 1);
  assert.match(logger.lines[0], /^\[direct-db\]/);
  assertNoSecrets(logger.lines[0]);
  // Højst én logline i minuttet.
  pool.emit("error", err);
  assert.equal(db.stats().poolErrors, 2);
  assert.equal(logger.lines.length, 1);
});

test("#8143: en udlånt forbindelse, der falder midt i et spørgsmål, tælles og lukkes", async () => {
  const pool = fakePool({
    queryImpl: (_text, _params, client) => {
      assert.ok(client.listenerCount("error") >= 1, "udlånt forbindelse skal have en fejlmodtager");
      assert.doesNotThrow(() => client.emit("error", new Error("Connection terminated unexpectedly")));
      throw new Error("Connection terminated unexpectedly");
    },
  });
  const { db } = setup({ pool });
  await assert.rejects(db.query("SELECT 1"), (err) => err.kind === "connection");
  assert.equal(db.stats().clientErrors, 1);
  assert.deepEqual(pool.clients[0].released, [true], "en faldet forbindelse må ikke genbruges");
  assert.equal(pool.clients[0].listenerCount("error"), 0);
});

test("#8143: en fejl ved oprettelsen af puljen huskes ikke; næste kald prøver igen", async () => {
  let attempts = 0;
  const logger = silentLogger();
  const pool = fakePool();
  const db = createDirectDb({
    env: ENV,
    logger,
    createPool: () => {
      attempts += 1;
      if (attempts === 1) throw new DirectDbError("driver-missing", "Biblioteket pg kunne ikke indlæses");
      return pool;
    },
  });
  await assert.rejects(db.query("SELECT 1"), (err) => err.kind === "driver-missing");
  await db.query("SELECT 1");
  assert.equal(attempts, 2);
});

test("#8143: pæn lukning: puljen lukkes, og linjen er derefter slukket", async () => {
  const { db, pool } = setup();
  await db.query("SELECT 1");
  await db.close();
  assert.equal(pool.ended, true);
  assert.equal(db.isEnabled(), false);
  await assert.rejects(db.query("SELECT 1"), (err) => err.kind === "off");
});

// ── Rensning af fejltekst ──────────────────────────────────────────────────

test("#8143: fejltekster renses for adresse, vært, bruger og adgangskode", async () => {
  const pool = fakePool({
    queryImpl: () => {
      throw Object.assign(new Error(`could not connect to ${FAKE_URL}: password authentication failed for user "${FAKE_USER}" at ${FAKE_HOST} (${FAKE_PASSWORD})`), { code: "28P01" });
    },
  });
  const { db } = setup({ pool });
  await assert.rejects(db.query("SELECT 1"), (err) => {
    assert.ok(err instanceof DirectDbError);
    assert.equal(err.kind, "auth");
    assert.equal(err.sqlState, "28P01");
    assertNoSecrets(err.message);
    assert.equal(err.cause, undefined, "den oprindelige fejl må ikke hænge ved");
    return true;
  });
});

test("#8143: redactConnectionDetails fjerner enhver postgres-adresse, også ukendte", () => {
  const other = ["postgres://", "someone:else@", "other.example.invalid", "/db"].join("");
  const out = redactConnectionDetails(`a ${other} b`);
  assert.ok(!out.includes("other.example.invalid"));
  assert.match(out, /postgres:\/\/\[skjult\]/);
  const sanitized = sanitizeDbError(new Error(`x ${FAKE_HOST} y`), [FAKE_HOST]);
  assert.equal(sanitized.message, "x [skjult] y");
});

// ── Én handel ad gangen ────────────────────────────────────────────────────

test("#8143: kun indstillinger og låse for én handel: session-varianter afvises", async () => {
  const rejected = [
    "SET statement_timeout = 0",
    "set search_path = public",
    "SET SESSION lock_timeout = '1s'",
    "RESET ALL",
    "SELECT pg_advisory_lock(1)",
    "SELECT pg_try_advisory_lock(1)",
    "LISTEN things",
    "PREPARE q AS SELECT 1",
    "DISCARD ALL",
    "CREATE TEMP TABLE x (id int)",
    "SELECT set_config('lock_timeout', '1s', false)",
    "SELECT 1; SET work_mem = '1GB'",
  ];
  for (const sql of rejected) {
    assert.throws(() => assertTransactionScoped(sql), (err) => err.kind === "session-scope", sql);
  }
  const allowed = [
    "SET LOCAL lock_timeout = '1s'",
    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
    "SET CONSTRAINTS ALL DEFERRED",
    "SELECT pg_advisory_xact_lock(1)",
    "SELECT set_config('lock_timeout', '1s', true)",
    "UPDATE riders SET team_id = $1 WHERE id = $2",
    "INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = excluded.a",
    "SELECT 1",
  ];
  for (const sql of allowed) {
    assert.doesNotThrow(() => assertTransactionScoped(sql), sql);
  }
  // Afvist før der overhovedet lånes en forbindelse.
  const { db, pool } = setup();
  await assert.rejects(db.query("SET statement_timeout = 0"), (err) => err.kind === "session-scope");
  assert.equal(pool.clients.length, 0);
  await assert.rejects(db.transaction((tx) => tx.query("SELECT pg_advisory_lock(7)")), (err) => err.kind === "session-scope");
  assert.equal(pool.clients[0].queries.at(-1).text, "ROLLBACK");
});

// ── Vagten: hvem må bruge den direkte linje ────────────────────────────────

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(BACKEND_ROOT, "..");
// Listen udvides bevidst, én tung vej ad gangen, hver med dommer og egen kontakt.
const ALLOWED_IMPORTERS = new Set([
  "backend/lib/directDbProbe.ts",
  "backend/lib/directDb.test.js",
  "backend/lib/directDb.pg.test.js",
  "backend/lib/directDbProbe.test.js",
]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
const CODE_FILE = /\.(c|m)?(j|t)sx?$/;
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'`]([^"'`]*?(?:^|\/)directDb(?:\.ts|\.js)?)["'`]/g;

// Andre tests i samme kørsel opretter og sletter midlertidige filer under
// backend/; en fil, der forsvinder midt i skanningen, springes over.
function readIfPresent(read) {
  try {
    return read();
  } catch (err) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return null;
    throw err;
  }
}

function codeFiles(dir, out = []) {
  for (const entry of readIfPresent(() => readdirSync(dir, { withFileTypes: true })) ?? []) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) codeFiles(path.join(dir, entry.name), out);
    } else if (CODE_FILE.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// Kun filer i git: midlertidige filer fra andre tests i samme kørsel tæller ikke.
// Uden git (fx en udpakket kopi) skannes mapperne i stedet.
function trackedCodeFiles(roots) {
  try {
    const rels = roots.map((root) => path.relative(REPO_ROOT, root));
    const out = execFileSync("git", ["ls-files", "-z", "--", ...rels], { cwd: REPO_ROOT, encoding: "utf8" });
    const files = out.split("\0").filter((rel) => rel && CODE_FILE.test(rel)
      && !rel.split("/").some((part) => SKIP_DIRS.has(part)));
    if (files.length > 0) return files.map((rel) => path.join(REPO_ROOT, rel));
  } catch {
    // best-effort: ingen git, så falder vi tilbage til at skanne mapperne.
  }
  return roots.flatMap((root) => codeFiles(root));
}

function findDirectDbImporters(roots) {
  const found = [];
  for (const file of trackedCodeFiles(roots)) {
    const source = readIfPresent(() => readFileSync(file, "utf8"));
    if (source === null || !source.includes("directDb")) continue;
    for (const m of source.matchAll(IMPORT_RE)) {
      found.push({ file: path.relative(REPO_ROOT, file).split(path.sep).join("/"), specifier: m[1] });
    }
  }
  return found;
}

test("#8143 vagt: kun de udpegede filer må importere den direkte linje", () => {
  const roots = ["backend", "scripts"].map((p) => path.join(REPO_ROOT, p));
  const importers = findDirectDbImporters(roots);
  const files = new Set(importers.map((i) => i.file));
  assert.ok(files.has("backend/lib/directDbProbe.ts"), "vagten skal finde prøvens import (ellers er regexen holdt op med at matche)");
  const offenders = importers.filter((i) => !ALLOWED_IMPORTERS.has(i.file));
  assert.deepEqual(offenders, [],
    "Den direkte linje må kun bruges af de udpegede veje (#8143). En ny vej kræver dommer, egen kontakt og en bevidst udvidelse af ALLOWED_IMPORTERS.");
});

test("#8143 vagt: regexen fanger alle importformer, men ikke directDbProbe", () => {
  const samples = [
    ['import { directQuery } from "./directDb.ts";', true],
    ["import x from '../lib/directDb.js'", true],
    ['const m = await import("./lib/directDb.ts")', true],
    ['import "./directDb"', true],
    ['import { startDirectDbProbe } from "./lib/directDbProbe.ts";', false],
    ['import { x } from "./directDbHelpers.ts";', false],
  ];
  for (const [source, expected] of samples) {
    assert.equal([...source.matchAll(IMPORT_RE)].length > 0, expected, source);
  }
});
