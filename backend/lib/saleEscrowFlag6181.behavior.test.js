// #6181 · Adfaerdsproeve: kontakten for saelgers laaste penge er binaer OVERALT.
//
// Et tabelstyret bevis over raa vaerdier i app_config (ingen raekke, null, "off", "beta", "on", true,
// false, "ON", ukendt). For HVER vaerdi skal alle laeserne vaere enige, og ingen maa laese "beta" som
// andet end slukket:
//   1. isSaleEscrowEnabled (JS-laeseren bag alle penge-stierne)
//   2. GET /api/feature-flags (det spilleren og Hjaelp ser), ogsaa for en beta-tester
//   3. GET /api/admin/feature-flags (tavlen: stadie, valgmuligheder, advarsel)
//   4. SQL: saleEscrowPayment -> hold_sale_escrow mod en rigtig Postgres (PGlite) med den rigtige M1-migration
//      (escrow-raekken findes, og saelger er ikke krediteret, praecis naar kontakten er tændt)
// Og:
//   5. PATCH /api/admin/feature-flags/sale_escrow_enabled med "beta" giver 409 og ingen skrivning (den
//      rigtige handler koeres, ikke tekst-moenstre over kildekoden).
//   6. Slukket kontakt med holdte raekker: de vises stadig og afregnes stadig (ingen penge sidder fast).
//
// Handleren koeres mod en lille PostgREST-lignende server paa localhost (app_config og admin_log), saa
// den rigtige supabase-klient i api.js bruges uden at roere prod. Hold og ryttere er aliaser (Hold A/B).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { PGlite } from "@electric-sql/pglite";

import { clearFlagStageCache } from "./featureStage.js";
import { createFeatureFlagsRouter } from "../api/featureFlagsApi.js";
import { PLAYER_VISIBLE_BINARY_FLAG_KEYS, STAGE_FLAGS } from "./stageFlagCatalog.js";
import {
  SALE_ESCROW_FLAG_KEY,
  isSaleEscrowEnabled,
  listHeldSaleEscrowsForAdmin,
  reconcileHeldSaleEscrows,
  saleEscrowPayment,
} from "./saleEscrowFlow6181.js";
import { loadLockedSalesForTeam } from "./saleEscrowView6181.js";
import { flushParkedRider } from "./stageRaceTransferDefer.js";
import { MIGRATIONS, SCHEMA } from "./__fixtures__/saleEscrow6181Schema.js";

const KEY = SALE_ESCROW_FLAG_KEY;
const ABSENT = Symbol("ingen raekke");

// [navn, raa vaerdi i app_config, taendt?]. Kun "on" og true taender; alt andet er slukket.
const CASES = [
  ["ingen raekke", ABSENT, false],
  ["null", null, false],
  ['"off"', "off", false],
  ['"beta"', "beta", false],
  ['"on"', "on", true],
  ["true", true, true],
  ["false", false, false],
  ['"ON" (forkert skrivemaade)', "ON", false],
  ['ukendt streng', "maybe", false],
];

// ── PostgREST-lignende server for app_config og admin_log ──────────────────────
const store = new Map(); // key -> { value, updated_at }
const writes = []; // hver skrivning (tabel + body)

function parseIn(filter) {
  const inner = filter.replace(/^in\.\(/, "").replace(/\)$/, "");
  return inner.split(",").map((s) => s.replace(/^"|"$/g, ""));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const table = url.pathname.replace("/rest/v1/", "");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
  const send = (code, payload) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(payload === undefined ? "" : JSON.stringify(payload));
  };
  if (req.method === "POST") {
    writes.push({ table, body });
    if (table === "app_config") {
      for (const row of Array.isArray(body) ? body : [body]) {
        store.set(row.key, { ...(store.get(row.key) ?? {}), ...row });
      }
    }
    return send(201);
  }
  if (req.method === "GET" && table === "app_config") {
    let rows = [...store.entries()].map(([key, row]) => ({ key, value: row.value, updated_at: row.updated_at ?? null }));
    const keyFilter = url.searchParams.get("key");
    if (keyFilter?.startsWith("eq.")) rows = rows.filter((r) => r.key === keyFilter.slice(3));
    else if (keyFilter?.startsWith("in.")) rows = rows.filter((r) => parseIn(keyFilter).includes(r.key));
    const wantsObject = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    return wantsObject ? send(rows.length === 1 ? 200 : 406, rows[0] ?? {}) : send(200, rows);
  }
  return send(404, { message: `ukendt kald ${req.method} ${req.url}` });
});

let base;
let router; // api.js' rigtige router
let client; // samme slags supabase-klient som api.js bruger, mod serveren ovenfor

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_URL = base;
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  client = createClient(base, "test-service-key", { auth: { persistSession: false, autoRefreshToken: false } });
  ({ default: router } = await import("../routes/api.js"));
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function setRaw(raw) {
  store.clear();
  writes.length = 0;
  if (raw !== ABSENT) store.set(KEY, { key: KEY, value: raw, updated_at: "2026-11-15T08:00:00.000Z" });
  clearFlagStageCache();
}

// ── handlere og endpoints ──────────────────────────────────────────────────────
function routeHandler(method, path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method} ${path} findes ikke paa routeren`);
  return layer.route.stack.at(-1).handle; // selve handleren; adgang og rate-limit er ikke det, der proeves her
}
function fakeRes() {
  return {
    code: 200, body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    set() { return this; },
  };
}
async function adminBoard() {
  const res = fakeRes();
  await routeHandler("get", "/admin/feature-flags")({ user: { id: "admin-a" }, headers: {} }, res);
  assert.equal(res.code, 200);
  return res.body.flags.find((f) => f.key === KEY);
}
async function adminPatch(stage) {
  const res = fakeRes();
  await routeHandler("patch", "/admin/feature-flags/:key")({ user: { id: "admin-a" }, params: { key: KEY }, body: { stage }, headers: {} }, res);
  return res;
}
async function playerFlags({ betaTester = false } = {}) {
  const app = express();
  app.use("/api/feature-flags", createFeatureFlagsRouter({
    supabase: client,
    requireAuth: async (_req, _res, next) => next(),
    isViewerBetaTester: async () => betaTester,
  }));
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => srv.once("listening", resolve));
  try {
    const headers = betaTester ? { authorization: "Bearer beta-tester" } : {};
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/feature-flags`, { headers });
    assert.equal(res.status, 200);
    return (await res.json()).flags;
  } finally {
    srv.closeAllConnections();
    await new Promise((resolve) => srv.close(resolve));
  }
}

// ── PGlite med den rigtige pengelaas ───────────────────────────────────────────
const file = (name) => readFile(new URL(`../../database/${name}`, import.meta.url), "utf8");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TEAM = { A: id(1), B: id(2) };
const START = 1_000_000;
const PRICE = 250_000;
const FLUSHED_AT = "2026-11-15T10:00:00.000Z";

async function balanceRpc() {
  const source = await file("2026-05-26-backend-message-codes.sql");
  const match = source.match(/CREATE OR REPLACE FUNCTION increment_balance_with_audit\([\s\S]*?\$\$ LANGUAGE plpgsql;/);
  assert.ok(match, "increment_balance_with_audit not found in its migration");
  return match[0];
}

// Een database til hele filen (opsaetningen koster flere sekunder): hver case bruger sin egen rytter og sit eget salg.
let sharedDb;
function database() {
  sharedDb ??= buildDatabase(RIDERS);
  return sharedDb;
}
const RIDERS = 20;
async function buildDatabase(riders) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  // loadLockedSalesForTeam laeser loebs-kolonner, som fixturen ikke har; kun additivt, kun her.
  await db.exec("ALTER TABLE races ADD COLUMN race_type text, ADD COLUMN name text;");
  await db.exec(await balanceRpc());
  for (const migration of MIGRATIONS) await db.exec(await file(migration));
  await db.exec(`INSERT INTO teams VALUES ('${TEAM.A}', ${START}), ('${TEAM.B}', ${START});`);
  for (let i = 1; i <= riders; i += 1) {
    await db.query("INSERT INTO riders(id, firstname, lastname, team_id) VALUES ($1, 'Rytter', $2, $3)", [id(100 + i), `Nr${i}`, TEAM.A]);
  }
  return db;
}

const RPC_ARGS = {
  increment_balance_with_audit: { p_team_id: "uuid", p_delta: "bigint", p_finance_payload: "jsonb" },
  hold_sale_escrow: {
    p_deal_type: "text", p_deal_id: "uuid", p_payer_team_id: "uuid", p_payee_team_id: "uuid", p_amount: "bigint",
    p_rider_ids: "uuid[]", p_target_team_ids: "uuid[]", p_payer_payload: "jsonb", p_payee_payload: "jsonb", p_rider_restore: "jsonb",
  },
  settle_sale_escrow: { p_escrow_id: "uuid", p_outcome: "text", p_refund_payload: "jsonb", p_settled_at: "timestamptz" },
  sale_escrow_undo_failed_hold: { p_deal_type: "text", p_deal_id: "uuid", p_payer_team_id: "uuid", p_payee_team_id: "uuid", p_rider_ids: "uuid[]", p_target_team_ids: "uuid[]", p_rider_restore: "jsonb" },
};
const pgValue = (v, type) => {
  if (v == null) return null;
  if (type === "jsonb") return JSON.stringify(v);
  if (type.endsWith("[]")) return `{${v.join(",")}}`;
  return v;
};
const pgError = (e) => ({ data: null, error: { code: e.code, message: e.message } });

/** supabase-lignende adapter over PGlite: de kald pengelaasen, visningen og flushen laver. */
function adapter(db) {
  function query(table, action, payload) {
    const where = [];
    const params = [];
    let columns = "*";
    let returning = null;
    let single = false;
    const param = (v) => { params.push(v); return `$${params.length}`; };
    async function run() {
      let sql;
      if (action === "select") {
        sql = `SELECT ${columns} FROM ${table}`;
      } else {
        const sets = Object.entries(payload).map(([k, v]) => `${k} = ${param(v)}`);
        sql = `UPDATE ${table} SET ${sets.join(", ")}`;
      }
      if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
      if (action === "update" && returning) sql += ` RETURNING ${returning}`;
      try {
        const res = await db.query(sql, params);
        return single ? { data: res.rows[0] ?? null, error: null } : { data: action === "update" && !returning ? null : res.rows, error: null };
      } catch (e) {
        return pgError(e);
      }
    }
    const chain = {
      select(cols = "*") { if (action === "select") columns = cols; else returning = cols; return chain; },
      eq(col, v) { where.push(`${col} = ${param(v)}`); return chain; },
      neq(col, v) { where.push(`${col} <> ${param(v)}`); return chain; },
      in(col, vs) { where.push(vs.length ? `${col} = ANY(${param(`{${vs.join(",")}}`)})` : "false"); return chain; },
      is(col, v) { assert.equal(v, null); where.push(`${col} IS NULL`); return chain; },
      not(col, op, v) { assert.equal(op, "is"); assert.equal(v, null); where.push(`${col} IS NOT NULL`); return chain; },
      gt(col, v) { where.push(`${col} > ${param(v)}`); return chain; },
      gte(col, v) { where.push(`${col} >= ${param(v)}`); return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() { single = true; return run(); },
      single() { single = true; return run(); },
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    return chain;
  }
  return {
    from(table) {
      return {
        select: (cols) => query(table, "select").select(cols),
        update: (patch) => query(table, "update", patch),
        delete: () => query(table, "delete"),
        insert: async () => ({ data: null, error: null }),
      };
    },
    async rpc(name, args) {
      const sig = RPC_ARGS[name];
      assert.ok(sig, `ukendt rpc ${name}`);
      const keys = Object.keys(sig).filter((k) => k in args);
      const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}::${sig[k]}`).join(", ")}) AS r`;
      try {
        const res = await db.query(sql, keys.map((k, i) => pgValue(args[keys[i]], sig[keys[i]])));
        return { data: res.rows[0].r, error: null };
      } catch (e) {
        return pgError(e);
      }
    },
  };
}

async function setDbFlag(db, raw) {
  await db.query("DELETE FROM app_config WHERE key = $1", [KEY]);
  if (raw !== ABSENT) await db.query("INSERT INTO app_config(key, value) VALUES ($1, $2)", [KEY, JSON.stringify(raw)]);
  clearFlagStageCache();
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const balance = async (db, team) => Number((await one(db, "SELECT balance FROM teams WHERE id = $1", [team])).balance);
const escrowRows = async (db, deal) => (await db.query("SELECT status, amount FROM sale_escrows WHERE deal_id = $1", [deal])).rows
  .map((e) => ({ ...e, amount: Number(e.amount) }));

function transferLegs(deal) {
  return [
    { teamId: TEAM.B, delta: -PRICE, payload: { type: "transfer_out", amount: -PRICE, reason_code: "transfer_purchase", source_path: "test.buyer", related_entity_type: "transfer", related_entity_id: deal, idempotency_key: `transfer_buyer:${deal}` } },
    { teamId: TEAM.A, delta: PRICE, payload: { type: "transfer_in", amount: PRICE, reason_code: "transfer_sale", source_path: "test.seller", related_entity_type: "transfer", related_entity_id: deal, idempotency_key: `transfer_seller:${deal}` } },
  ];
}

/** Et parkeret salg af rytter `n` (hold A saelger til hold B), betalt gennem saleEscrowPayment. */
async function sellParkedRider(db, supabase, n) {
  const rider = id(100 + n);
  const deal = id(300 + n);
  await db.query("UPDATE riders SET pending_team_id = $2 WHERE id = $1", [rider, TEAM.B]);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: deal, riderIds: [rider], targetTeamIds: [TEAM.B] });
  for (const leg of transferLegs(deal)) await pay.incrementBalanceWithAudit(supabase, leg, { allowDuplicate: true });
  return { rider, deal };
}

// ── 1-3: alle laesere er enige ─────────────────────────────────────────────────
test("sale_escrow_enabled er i listen over binaere noegler og paa tavlen", () => {
  assert.ok(PLAYER_VISIBLE_BINARY_FLAG_KEYS.includes(KEY));
  assert.ok(STAGE_FLAGS.some((f) => f.key === KEY));
});

for (const [name, raw, enabled] of CASES) {
  test(`laeserne er enige om ${name}: ${enabled ? "taendt" : "slukket"}`, async () => {
    setRaw(raw);

    // 1. JS-laeseren (friskt og med den korte cache; begge veje).
    assert.equal(await isSaleEscrowEnabled(client), enabled, "isSaleEscrowEnabled (frisk)");
    assert.equal(await isSaleEscrowEnabled(client, { fresh: false }), enabled, "isSaleEscrowEnabled (cache)");

    // 2. Det spilleren faar: ogsaa en beta-tester. Beta tænder aldrig en binaer noegle.
    assert.equal((await playerFlags())[KEY], enabled, "GET /api/feature-flags (spiller)");
    assert.equal((await playerFlags({ betaTester: true }))[KEY], enabled, "GET /api/feature-flags (beta-tester)");

    // 3. Tavlen viser det samme som spilleren faar, og tilbyder aldrig beta.
    const board = await adminBoard();
    assert.equal(board.stage, enabled ? "on" : "off", "tavlens stadie");
    assert.equal(board.boolean_only, true, "binaer noegle");
    assert.deepEqual(board.offered_stages, ["off", "on"], "beta tilbydes aldrig");
    assert.equal(board.warning, raw === "beta" ? "beta_reads_as_off" : null, "advarsel kun ved en skrevet beta");
    assert.equal(board.raw_value, raw === ABSENT ? null : raw, "den raa vaerdi vises uaendret");
    assert.equal(board.configured, raw !== ABSENT);
    assert.equal(board.unknown_value, typeof raw === "string" && !["off", "beta", "on"].includes(raw), "kun en ukendt streng er drift");
    assert.deepEqual(writes, [], "laesning skriver aldrig");
  });
}

test("en almindelig noegle vises uaendret paa tavlen: beta er et aegte stadie", async () => {
  const other = STAGE_FLAGS.find((f) => !PLAYER_VISIBLE_BINARY_FLAG_KEYS.includes(f.key));
  store.clear();
  store.set(other.key, { key: other.key, value: "beta" });
  const res = fakeRes();
  await routeHandler("get", "/admin/feature-flags")({ user: { id: "admin-a" }, headers: {} }, res);
  const row = res.body.flags.find((f) => f.key === other.key);
  assert.equal(row.stage, "beta");
  assert.equal(row.boolean_only, false);
  assert.deepEqual(row.offered_stages, ["off", "beta", "on"]);
  assert.equal(row.warning, null);
});

// ── 4: SQL (hold_sale_escrow) er enig ──────────────────────────────────────────
test("SQL er enig: hold_sale_escrow bruges praecis naar kontakten er taendt", async () => {
  const db = await database();
  const supabase = adapter(db);
  for (const [index, [name, raw, enabled]] of CASES.entries()) {
    await setDbFlag(db, raw);
    const sellerBefore = await balance(db, TEAM.A);
    const buyerBefore = await balance(db, TEAM.B);
    const { deal } = await sellParkedRider(db, supabase, index + 1);
    const rows = await escrowRows(db, deal);
    if (enabled) {
      assert.deepEqual(rows, [{ status: "held", amount: PRICE }], `${name}: pengene laases`);
      assert.equal(await balance(db, TEAM.A), sellerBefore, `${name}: saelger faar intet, mens rytteren venter`);
    } else {
      assert.deepEqual(rows, [], `${name}: ingen escrow`);
      assert.equal(await balance(db, TEAM.A), sellerBefore + PRICE, `${name}: saelger krediteres straks, som i dag`);
    }
    assert.equal(await balance(db, TEAM.B), buyerBefore - PRICE, `${name}: koeber betaler een gang i begge tilfaelde`);
  }
});

// ── 5: PATCH med beta ──────────────────────────────────────────────────────────
for (const [name, raw] of CASES) {
  test(`PATCH med "beta" afvises med 409 uden skrivning, naar vaerdien er ${name}`, async () => {
    setRaw(raw);
    const res = await adminPatch("beta");
    assert.equal(res.code, 409);
    assert.equal(res.body.errorCode, "flag_boolean_only");
    assert.deepEqual(writes, [], "hverken app_config eller admin_log er skrevet");
    assert.deepEqual(store.has(KEY) ? store.get(KEY).value : ABSENT, raw, "vaerdien er uroert");
    assert.equal(await isSaleEscrowEnabled(client), raw === "on" || raw === true, "kontakten er uaendret");
  });
}

test("PATCH med on og off virker stadig, og en skrevet beta kan rettes til off", async () => {
  setRaw("beta");
  assert.equal((await adminPatch("off")).code, 200);
  assert.equal(store.get(KEY).value, "off");
  assert.equal(await isSaleEscrowEnabled(client), false);
  assert.equal((await adminBoard()).warning, null, "advarslen forsvinder, naar vaerdien er rettet");

  assert.equal((await adminPatch("on")).code, 200);
  assert.equal(store.get(KEY).value, "on");
  assert.equal(await isSaleEscrowEnabled(client), true);
  assert.equal((await adminBoard()).stage, "on");
  assert.equal((await playerFlags())[KEY], true);

  assert.equal((await adminPatch("off")).code, 200);
  assert.equal(await isSaleEscrowEnabled(client), false);
  assert.equal(writes.filter((w) => w.table === "app_config").length, 3, "tre bevidste skrivninger");
});

test("PATCH afviser ukendte stadier og ukendte noegler uden skrivning", async () => {
  setRaw("off");
  assert.equal((await adminPatch("maybe")).code, 400);
  const res = fakeRes();
  await routeHandler("patch", "/admin/feature-flags/:key")({ user: { id: "admin-a" }, params: { key: "no_such_flag" }, body: { stage: "on" }, headers: {} }, res);
  assert.equal(res.code, 400);
  assert.deepEqual(writes, []);
});

// ── 6: slukket kontakt med holdte raekker ──────────────────────────────────────
for (const [index, [name, raw, enabled]] of CASES.filter(([, , on]) => !on).entries()) {
  test(`kontakten er slukket (${name}) med en holdt raekke: den vises og afregnes stadig`, async () => {
    const db = await database();
    const supabase = adapter(db);
    const n = CASES.length + 1 + index; // egen rytter, uden om tabellen for SQL-beviset
    // Saelget, mens kontakten var taendt. (SQL-beviset ovenfor kan have efterladt andre holdte salg.)
    await setDbFlag(db, "on");
    const lockedBefore = (await loadLockedSalesForTeam(supabase, TEAM.A, { now: new Date(FLUSHED_AT) })).total;
    assert.equal(await isSaleEscrowEnabled(supabase), true);
    const { rider, deal } = await sellParkedRider(db, supabase, n);
    assert.deepEqual(await escrowRows(db, deal), [{ status: "held", amount: PRICE }]);
    const sellerHeld = await balance(db, TEAM.A);

    // Kontakten bliver slukket (eller staar paa en vaerdi, der laeses som slukket).
    await setDbFlag(db, raw);
    assert.equal(await isSaleEscrowEnabled(supabase), enabled);

    // Visningen er ikke bag kontakten: saelgeren ser sit laaste salg, admin ser raekken.
    const locked = await loadLockedSalesForTeam(supabase, TEAM.A, { now: new Date(FLUSHED_AT) });
    assert.equal(locked.total, lockedBefore + PRICE, "laast beloeb vises");
    assert.equal(locked.sales.filter((sale) => sale.amount === PRICE).length >= 1, true);
    const held = (await listHeldSaleEscrowsForAdmin(supabase)).filter((e) => e.deal_id === deal);
    assert.equal(held.length, 1);
    assert.equal(held[0].action, "wait", "venter paa holdskiftet");

    // Rytteren skifter hold via den almindelige flush (kontakten er slukket), og sikkerhedsnettet afregner.
    const flushed = await flushParkedRider(supabase, { id: rider, firstname: "Rytter", lastname: `Nr${n}`, team_id: TEAM.A, pending_team_id: TEAM.B },
      { notifyTeamOwner: async () => {}, flushedAt: FLUSHED_AT, arrival: { reason: "dealCompleted" } });
    assert.equal(flushed, true);
    assert.equal((await one(db, "SELECT team_id FROM riders WHERE id = $1", [rider])).team_id, TEAM.B);
    assert.equal(await balance(db, TEAM.A), sellerHeld, "endnu ikke udbetalt");

    const result = await reconcileHeldSaleEscrows({ supabase, now: new Date(FLUSHED_AT), notifyReleased: async () => {} });
    assert.equal(result.released, 1, "afregnet uden kontakten");
    assert.equal(result.failed, 0);
    assert.equal(await balance(db, TEAM.A), sellerHeld + PRICE, "saelger faar pengene");
    assert.deepEqual(await escrowRows(db, deal), [{ status: "released", amount: PRICE }]);
    assert.equal((await loadLockedSalesForTeam(supabase, TEAM.A, { now: new Date(FLUSHED_AT) })).total, lockedBefore, "intet af dette salg staar laast mere");
    // Penge opstaar eller forsvinder aldrig.
    assert.equal(await balance(db, TEAM.A) + await balance(db, TEAM.B) + Number((await one(db, "SELECT coalesce(sum(amount), 0) AS t FROM sale_escrows WHERE status = 'held'")).t), 2 * START);
  });
}
