// #6181 PR 3 · pengelaas-kalderne (saleEscrowFlow6181.js) mod en rigtig Postgres (PGlite)
// med den RIGTIGE M1-migration og den RIGTIGE increment_balance_with_audit.
//
// En lille supabase-lignende adapter oversaetter de kald, modulet og flushParkedRider
// laver (from/select/update/eq/in/is/order/maybeSingle + rpc), til SQL. Hold og
// ryttere er aliaser (Hold A/B/C), ingen prod-data.
//
// Det bevises her:
//   - slukket kontakt: betalingen er PRAECIS den gamle funktion, og flushen roerer
//     aldrig sale_escrows (off = samme adfaerd som foer PR 3)
//   - taendt: koeber betaler een gang, saelger krediteres foerst ved holdskiftet, i een
//     transaktion, ogsaa gennem den rigtige flushParkedRider
//   - bytte frigives foerst, naar begge ryttere er flyttet
//   - refusion ved pension/kontraktudloeb (hul 6) og reconcile som sikkerhedsnet,
//     ogsaa efter at kontakten er slukket igen
//   - penge opstaar eller forsvinder aldrig (saldi + holdte escrows er konstant)
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

import { incrementBalanceWithAudit } from "./balanceRpc.js";
import { clearFlagStageCache } from "./featureStage.js";
import {
  SALE_ESCROW_FLAG_KEY,
  classifyHeldEscrow,
  isSaleEscrowEnabled,
  reconcileHeldSaleEscrows,
  listHeldSaleEscrowsForAdmin,
  refundSaleEscrowsForReleasedRiders,
  releaseSaleEscrowForFlush,
  resolveStuckSaleEscrow,
  saleEscrowPayment,
  saleEscrowStatusForDeal,
} from "./saleEscrowFlow6181.js";
import { flushParkedRider } from "./stageRaceTransferDefer.js";

const file = (name) => readFile(new URL(`../../database/${name}`, import.meta.url), "utf8");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TEAM = { A: id(1), B: id(2), C: id(3) };
const RIDER = { r1: id(11), r2: id(12), r3: id(13) };
const DEAL = { t1: id(101), t2: id(102), a1: id(201), s1: id(301) };
const START = 1_000_000;
const FLUSHED_AT = "2026-11-08T10:00:00.000Z";

const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE teams (id uuid PRIMARY KEY, balance bigint NOT NULL);
CREATE TABLE riders (id uuid PRIMARY KEY, firstname text, lastname text, team_id uuid, pending_team_id uuid, acquired_at timestamptz);
CREATE TABLE app_config (key text PRIMARY KEY, value jsonb);
CREATE TABLE finance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id),
  type text NOT NULL CHECK (type IN ('transfer_in', 'transfer_out', 'prize')),
  amount bigint NOT NULL, description text, season_id uuid, race_id uuid, related_loan_id uuid,
  actor_type text, actor_id uuid, source_path text, reason_code text,
  before_balance bigint, after_balance bigint,
  related_entity_type text CHECK (related_entity_type IS NULL OR related_entity_type IN
    ('auction','loan','transfer','swap','race','season','manual')),
  related_entity_id uuid, idempotency_key text, metadata jsonb,
  created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX uniq_finance_idempotency_key ON finance_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
`;

async function balanceRpc() {
  const source = await file("2026-05-26-backend-message-codes.sql");
  const match = source.match(/CREATE OR REPLACE FUNCTION increment_balance_with_audit\([\s\S]*?\$\$ LANGUAGE plpgsql;/);
  assert.ok(match, "increment_balance_with_audit not found in its migration");
  return match[0];
}

async function database() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(await balanceRpc());
  await db.exec(await file("2026-11-07-6181-sale-escrow-m1.sql"));
  await db.exec(await file("2026-11-07-6181-sale-escrow-m2-guards.sql"));
  await db.exec(`INSERT INTO teams VALUES ('${TEAM.A}', ${START}), ('${TEAM.B}', ${START}), ('${TEAM.C}', ${START});
    INSERT INTO riders(id, firstname, lastname, team_id) VALUES
      ('${RIDER.r1}', 'Rytter', 'En', '${TEAM.A}'), ('${RIDER.r2}', 'Rytter', 'To', '${TEAM.B}'), ('${RIDER.r3}', 'Rytter', 'Tre', '${TEAM.A}');`);
  return db;
}

// ── supabase-adapter over PGlite ──────────────────────────────────────────────
const RPC_ARGS = {
  increment_balance_with_audit: { p_team_id: "uuid", p_delta: "bigint", p_finance_payload: "jsonb" },
  hold_sale_escrow: {
    p_deal_type: "text", p_deal_id: "uuid", p_payer_team_id: "uuid", p_payee_team_id: "uuid", p_amount: "bigint",
    p_rider_ids: "uuid[]", p_target_team_ids: "uuid[]", p_payer_payload: "jsonb", p_payee_payload: "jsonb",
  },
  settle_sale_escrow: { p_escrow_id: "uuid", p_outcome: "text", p_refund_payload: "jsonb", p_settled_at: "timestamptz" },
  resolve_stuck_sale_escrow: { p_escrow_id: "uuid", p_outcome: "text", p_payload: "jsonb", p_settled_at: "timestamptz" },
};
const pgValue = (v, type) => {
  if (v == null) return null;
  if (type === "jsonb") return JSON.stringify(v);
  if (type.endsWith("[]")) return `{${v.join(",")}}`;
  return v;
};
const pgError = (e) => ({ data: null, error: { code: e.code, message: e.message } });

function adapter(db, { log = [] } = {}) {
  function query(table, action, payload) {
    const where = [];
    const params = [];
    let columns = "*";
    let returning = null;
    let single = false;
    const param = (v) => { params.push(v); return `$${params.length}`; };
    async function run() {
      log.push({ table, action });
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
        const rows = res.rows;
        return single ? { data: rows[0] ?? null, error: null } : { data: action === "update" && !returning ? null : rows, error: null };
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
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() { single = true; return run(); },
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
      log.push({ rpc: name });
      const sig = RPC_ARGS[name];
      assert.ok(sig, `ukendt rpc ${name}`);
      const keys = Object.keys(sig).filter((k) => k in args);
      const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}::${sig[k]}`).join(", ")}) AS r`;
      try {
        const res = await db.query(sql, keys.map((k) => pgValue(args[k], sig[k])));
        return { data: res.rows[0].r, error: null };
      } catch (e) {
        return pgError(e);
      }
    },
  };
}

async function setFlag(db, value) {
  await db.query("INSERT INTO app_config(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [SALE_ESCROW_FLAG_KEY, JSON.stringify(value)]);
  clearFlagStageCache();
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const balance = async (db, team) => Number((await one(db, "SELECT balance FROM teams WHERE id = $1", [team])).balance);
const rider = (db, r) => one(db, "SELECT team_id, pending_team_id, acquired_at FROM riders WHERE id = $1", [r]);
const park = (db, r, team) => db.query("UPDATE riders SET pending_team_id = $2 WHERE id = $1", [r, team]);
const escrows = async (db) => (await db.query("SELECT status, deal_type, amount FROM sale_escrows ORDER BY created_at")).rows
  .map((e) => ({ ...e, amount: Number(e.amount) }));
const ledgerKeys = async (db) => (await db.query("SELECT idempotency_key FROM finance_transactions ORDER BY created_at, idempotency_key")).rows.map((r) => r.idempotency_key);
// Penge opstaar eller forsvinder aldrig: hold-saldi + holdte escrows er konstant.
const total = async (db) => Number((await one(db, `SELECT (SELECT sum(balance) FROM teams)
  + coalesce((SELECT sum(amount) FROM sale_escrows WHERE status = 'held'), 0) AS t`)).t);

// Samme ben, som executeTransferOffer sender (nøgler, typer, retning).
function transferLegs(deal, price, { buyer = TEAM.B, seller = TEAM.A } = {}) {
  return [
    { teamId: buyer, delta: -price, payload: { type: "transfer_out", amount: -price, reason_code: "transfer_purchase", source_path: "test.buyer", related_entity_type: "transfer", related_entity_id: deal, idempotency_key: `transfer_buyer:${deal}` } },
    { teamId: seller, delta: price, payload: { type: "transfer_in", amount: price, reason_code: "transfer_sale", source_path: "test.seller", related_entity_type: "transfer", related_entity_id: deal, idempotency_key: `transfer_seller:${deal}` } },
  ];
}
function swapLegs(deal, cash, { payer = TEAM.B, receiver = TEAM.A } = {}) {
  return [
    { teamId: payer, delta: -cash, payload: { type: "transfer_out", amount: -cash, reason_code: "swap_cash_delta", source_path: "test.payer", related_entity_type: "swap", related_entity_id: deal, idempotency_key: `swap_payer:${deal}` } },
    { teamId: receiver, delta: cash, payload: { type: "transfer_in", amount: cash, reason_code: "swap_cash_delta", source_path: "test.receiver", related_entity_type: "swap", related_entity_id: deal, idempotency_key: `swap_receiver:${deal}` } },
  ];
}
async function payBoth(supabase, pay, legs) {
  for (const leg of legs) await pay.incrementBalanceWithAudit(supabase, leg, { allowDuplicate: true });
}

// ── slukket = som foer ─────────────────────────────────────────────────────────

test("slukket kontakt: betalingen er den uaendrede incrementBalanceWithAudit, uanset parkering og kontaktvaerdi", async () => {
  const db = await database();
  const supabase = adapter(db);
  for (const value of [null, false, "off", "beta"]) {
    if (value !== null) await setFlag(db, value);
    assert.equal(await isSaleEscrowEnabled(supabase), false, `vaerdi ${value}`);
    const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] });
    assert.equal(pay.incrementBalanceWithAudit, incrementBalanceWithAudit, `vaerdi ${value}: samme funktion som foer`);
  }
  // Ikke parkeret: kontakten laeses slet ikke.
  await setFlag(db, "on");
  const log = [];
  const pay = await saleEscrowPayment(adapter(db, { log }), { parked: false, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] });
  assert.equal(pay.incrementBalanceWithAudit, incrementBalanceWithAudit);
  assert.deepEqual(log, []);
});

test("slukket kontakt: flush, refusion og saelgerens penge opfoerer sig som foer (saelger krediteret straks, ingen escrow)", async () => {
  const db = await database();
  const log = [];
  const supabase = adapter(db, { log });
  const before = await total(db);
  await park(db, RIDER.r1, TEAM.B);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] });
  await payBoth(supabase, pay, transferLegs(DEAL.t1, 250_000));
  assert.equal(await balance(db, TEAM.A), START + 250_000, "saelger krediteret ved handlen, som i dag");
  assert.equal(await balance(db, TEAM.B), START - 250_000);
  assert.deepEqual(await escrows(db), []);

  log.length = 0;
  assert.equal(await releaseSaleEscrowForFlush(supabase, { id: RIDER.r1, pending_team_id: TEAM.B }, { flushedAt: FLUSHED_AT }), null);
  assert.deepEqual(await refundSaleEscrowsForReleasedRiders(supabase, [RIDER.r1], { now: new Date(FLUSHED_AT), sourcePath: "test" }), { refunded: 0, failed: 0 });
  assert.ok(!log.some((l) => l.table === "sale_escrows" || l.rpc), "slukket: ingen escrow-opslag og ingen rpc");

  const moved = await flushParkedRider(supabase, { id: RIDER.r1, firstname: "Rytter", lastname: "En", team_id: TEAM.A, pending_team_id: TEAM.B },
    { notifyTeamOwner: async () => {}, flushedAt: FLUSHED_AT, arrival: { reason: "dealCompleted" } });
  assert.equal(moved, true);
  assert.equal((await rider(db, RIDER.r1)).team_id, TEAM.B);
  assert.equal(await total(db), before);
});

// ── taendt ─────────────────────────────────────────────────────────────────────

test("taendt, parkeret transfer: koeber betaler een gang, saelger krediteres foerst naar den rigtige flush flytter rytteren", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  await park(db, RIDER.r1, TEAM.B);

  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] });
  await payBoth(supabase, pay, transferLegs(DEAL.t1, 250_000));
  assert.equal(await balance(db, TEAM.B), START - 250_000);
  assert.equal(await balance(db, TEAM.A), START, "saelger faar intet, mens rytteren venter");
  assert.deepEqual(await escrows(db), [{ status: "held", deal_type: "transfer", amount: 250_000 }]);
  assert.equal(await total(db), before);

  // Gentagelse af hele betalingen (fx en retry af bekraeftelsen) traekker ikke igen.
  const again = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] });
  await payBoth(supabase, again, transferLegs(DEAL.t1, 250_000));
  assert.equal(await balance(db, TEAM.B), START - 250_000);
  assert.equal(await balance(db, TEAM.A), START);

  const notices = [];
  const flushed = await flushParkedRider(supabase, { id: RIDER.r1, firstname: "Rytter", lastname: "En", team_id: TEAM.A, pending_team_id: TEAM.B },
    { notifyTeamOwner: async (...a) => { notices.push(a); }, flushedAt: FLUSHED_AT, arrival: { reason: "dealCompleted" } });
  assert.equal(flushed, true);
  const moved = await rider(db, RIDER.r1);
  assert.equal(moved.team_id, TEAM.B);
  assert.equal(moved.pending_team_id, null);
  assert.equal(new Date(moved.acquired_at).toISOString(), FLUSHED_AT);
  assert.equal(await balance(db, TEAM.A), START + 250_000, "saelger krediteret ved holdskiftet");
  assert.deepEqual(await escrows(db), [{ status: "released", deal_type: "transfer", amount: 250_000 }]);
  assert.equal(notices.length, 1, "ankomst-beskeden sendes som foer");
  assert.equal(await total(db), before);
  assert.deepEqual((await ledgerKeys(db)).sort(), [`transfer_buyer:${DEAL.t1}`, `transfer_seller:${DEAL.t1}`].sort());

  // En ny flush/heal finder intet at goere.
  assert.equal(await flushParkedRider(supabase, { id: RIDER.r1, team_id: TEAM.B, pending_team_id: TEAM.B },
    { notifyTeamOwner: async () => {}, flushedAt: FLUSHED_AT, arrival: { reason: "dealCompleted" } }), false);
  assert.equal(await balance(db, TEAM.A), START + 250_000);
});

test("taendt, men rytteren er allerede flyttet (loebet sluttede imellem): betales som foer, ingen escrow", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  await db.query("UPDATE riders SET team_id = $2 WHERE id = $1", [RIDER.r1, TEAM.B]);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] });
  await payBoth(supabase, pay, transferLegs(DEAL.t1, 100_000));
  assert.equal(await balance(db, TEAM.A), START + 100_000);
  assert.equal(await balance(db, TEAM.B), START - 100_000);
  assert.deepEqual(await escrows(db), []);
});

test("taendt, men parkeringen forsvandt foer laasen (fx pension imellem): ingen betaling, handlen fejler", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  // Rytteren staar stadig hos saelger og er ikke parkeret: hverken laas eller betaling.
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] });
  const [buyer, seller] = transferLegs(DEAL.t1, 90_000);
  await pay.incrementBalanceWithAudit(supabase, buyer);
  await assert.rejects(() => pay.incrementBalanceWithAudit(supabase, seller), /hverken laases eller betales \(not_parked\)/);
  assert.equal(await balance(db, TEAM.B), START, "koeberen betaler ikke for en rytter, der ikke kommer");
  assert.equal(await balance(db, TEAM.A), START);
  assert.deepEqual(await ledgerKeys(db), []);
});

test("taendt: forkerte finance-noegler eller ben afvises, foer der flyttes penge", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  await park(db, RIDER.r1, TEAM.B);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] });
  const [buyer, seller] = transferLegs(DEAL.t2, 50_000);
  await pay.incrementBalanceWithAudit(supabase, buyer);
  await assert.rejects(() => pay.incrementBalanceWithAudit(supabase, seller), /faste finance-noegler/);
  assert.equal(await balance(db, TEAM.B), START);
  assert.deepEqual(await escrows(db), []);
});

test("taendt, bytte med kontanter: frigives foerst, naar begge ryttere er flyttet", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  // r1 (Hold A) -> Hold B, r2 (Hold B) -> Hold A; Hold B betaler kontanter.
  await park(db, RIDER.r1, TEAM.B);
  await park(db, RIDER.r2, TEAM.A);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "swap", dealId: DEAL.s1, riderIds: [RIDER.r1, RIDER.r2], targetTeamIds: [TEAM.B, TEAM.A] });
  await payBoth(supabase, pay, swapLegs(DEAL.s1, 80_000));
  assert.equal(await balance(db, TEAM.B), START - 80_000);
  assert.equal(await balance(db, TEAM.A), START);

  const opts = { notifyTeamOwner: async () => {}, flushedAt: FLUSHED_AT, arrival: { reason: "dealCompleted" } };
  // Foerste rytter: den anden venter stadig -> almindelig flush, ingen penge.
  assert.equal(await releaseSaleEscrowForFlush(supabase, { id: RIDER.r1, pending_team_id: TEAM.B }, { flushedAt: FLUSHED_AT }), null);
  assert.equal(await flushParkedRider(supabase, { id: RIDER.r1, team_id: TEAM.A, pending_team_id: TEAM.B }, opts), true);
  assert.equal(await balance(db, TEAM.A), START, "intet til modtageren, foer begge er flyttet");
  assert.deepEqual(await escrows(db), [{ status: "held", deal_type: "swap", amount: 80_000 }]);
  assert.equal(classifyHeldEscrow(
    { rider_ids: [RIDER.r1, RIDER.r2], target_team_ids: [TEAM.B, TEAM.A], delivered_rider_ids: [RIDER.r1] },
    new Map([[RIDER.r2, { team_id: TEAM.B, pending_team_id: TEAM.A }]])), "wait");

  // Anden rytter: settle flytter ham og krediterer i samme transaktion.
  assert.equal(await flushParkedRider(supabase, { id: RIDER.r2, team_id: TEAM.B, pending_team_id: TEAM.A }, opts), true);
  assert.equal((await rider(db, RIDER.r2)).team_id, TEAM.A);
  assert.equal(await balance(db, TEAM.A), START + 80_000);
  assert.deepEqual(await escrows(db), [{ status: "released", deal_type: "swap", amount: 80_000 }]);
  assert.equal(await total(db), before);
});

test("hul 6: pension/kontraktudloeb frigiver en solgt, ventende rytter -> koeberen faar pengene tilbage", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  await park(db, RIDER.r1, TEAM.B);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "auction", dealId: DEAL.a1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] });
  await payBoth(supabase, pay, [
    { teamId: TEAM.B, delta: -120_000, payload: { type: "transfer_out", amount: -120_000, idempotency_key: `auction_winner:${DEAL.a1}` } },
    { teamId: TEAM.A, delta: 120_000, payload: { type: "transfer_in", amount: 120_000, idempotency_key: `auction_seller:${DEAL.a1}` } },
  ]);
  assert.equal(await balance(db, TEAM.B), START - 120_000);

  // Samme opdatering som retirementRelease/contractExpiryRelease (rytteren bliver fri agent).
  await db.query("UPDATE riders SET team_id = NULL, pending_team_id = NULL WHERE id = $1", [RIDER.r1]);
  const stats = await refundSaleEscrowsForReleasedRiders(supabase, [RIDER.r1], { now: new Date(FLUSHED_AT), sourcePath: "retirementRelease.saleEscrowRefund" });
  assert.deepEqual(stats, { refunded: 1, failed: 0 });
  assert.equal(await balance(db, TEAM.B), START, "koeberen har sine penge igen");
  assert.equal(await balance(db, TEAM.A), START, "saelgeren fik aldrig noget");
  assert.deepEqual(await escrows(db), [{ status: "refunded", deal_type: "auction", amount: 120_000 }]);
  assert.equal(new Date((await one(db, "SELECT settled_at FROM sale_escrows")).settled_at).toISOString(), FLUSHED_AT, "afregnet paa det injicerede ur");
  const refund = await one(db, "SELECT reason_code, source_path, type FROM finance_transactions WHERE idempotency_key LIKE 'sale_escrow_refund:%'");
  assert.deepEqual(refund, { reason_code: "sale_escrow_refund", source_path: "retirementRelease.saleEscrowRefund", type: "transfer_in" });
  assert.equal(await total(db), before);

  // Gentagelse refunderer aldrig igen.
  assert.deepEqual(await refundSaleEscrowsForReleasedRiders(supabase, [RIDER.r1], { now: new Date(FLUSHED_AT), sourcePath: "x" }), { refunded: 0, failed: 0 });
  assert.equal(await balance(db, TEAM.B), START);
});

test("sikkerhedsnet: reconcile afregner ogsaa efter at kontakten er slukket igen", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  await park(db, RIDER.r1, TEAM.B);
  await park(db, RIDER.r3, TEAM.C);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] }), transferLegs(DEAL.t1, 200_000));
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t2, riderIds: [RIDER.r3], targetTeamIds: [TEAM.C] }), transferLegs(DEAL.t2, 70_000, { buyer: TEAM.C }));

  await setFlag(db, "off");
  // Slukket: flushen flytter r1 som foer (triggeren noterer leveringen), r3's parkering forsvinder (fx reset).
  assert.equal(await flushParkedRider(supabase, { id: RIDER.r1, team_id: TEAM.A, pending_team_id: TEAM.B },
    { notifyTeamOwner: async () => {}, flushedAt: FLUSHED_AT, arrival: { reason: "dealCompleted" } }), true);
  await db.query("UPDATE riders SET pending_team_id = NULL WHERE id = $1", [RIDER.r3]);
  assert.equal(await balance(db, TEAM.A), START, "endnu ikke krediteret");

  const result = await reconcileHeldSaleEscrows({ supabase, now: new Date(FLUSHED_AT) });
  assert.deepEqual({ ...result, errors: result.errors.length }, { checked: 2, released: 1, refunded: 1, waiting: 0, stuck: 0, failed: 0, errors: 0 });
  assert.equal(await balance(db, TEAM.A), START + 200_000, "saelger af r1 krediteret");
  assert.equal(await balance(db, TEAM.C), START, "koeber af r3 refunderet");
  assert.equal(await total(db), before);

  const again = await reconcileHeldSaleEscrows({ supabase, now: new Date(FLUSHED_AT) });
  assert.equal(again.checked, 0, "intet tilbage at afregne");
});

test("classifyHeldEscrow: release, refund, wait og stuck", () => {
  const swap = { rider_ids: ["x", "y"], target_team_ids: ["B", "A"], delivered_rider_ids: [] };
  const states = (x, y) => new Map([["x", x], ["y", y]]);
  assert.equal(classifyHeldEscrow(swap, states({ team_id: "B" }, { team_id: "A" })), "release");
  assert.equal(classifyHeldEscrow(swap, states({ team_id: "A", pending_team_id: "B" }, { team_id: "B", pending_team_id: "A" })), "wait");
  assert.equal(classifyHeldEscrow(swap, states({ team_id: null }, { team_id: "B", pending_team_id: "A" })), "refund");
  assert.equal(classifyHeldEscrow({ ...swap, delivered_rider_ids: ["x"] }, states({ team_id: "C" }, { team_id: null })), "stuck");
  assert.equal(classifyHeldEscrow({ rider_ids: ["x"], target_team_ids: ["B"] }, new Map()), "refund", "slettet rytter kan ikke leveres");
});

// ── ejer-krav 1 og 2 (#7871) ──────────────────────────────────────────────────

test("ejer-krav 1: efter en refusion kan den gamle saelger-kredit ikke skabe penge, og en gentagelse stoppes foer betaling", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  await park(db, RIDER.r1, TEAM.B);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] }), transferLegs(DEAL.t1, 150_000));
  assert.equal(await saleEscrowStatusForDeal(supabase, { dealType: "transfer", dealId: DEAL.t1 }), "held");

  // Parkeringen forsvinder (fx admin), kontakten slukkes, og reconcile refunderer.
  await db.query("UPDATE riders SET pending_team_id = NULL WHERE id = $1", [RIDER.r1]);
  await setFlag(db, "off");
  const result = await reconcileHeldSaleEscrows({ supabase, now: new Date(FLUSHED_AT) });
  assert.equal(result.refunded, 1);
  assert.equal(await balance(db, TEAM.B), START, "koeberen har sine penge igen");
  assert.equal(await saleEscrowStatusForDeal(supabase, { dealType: "transfer", dealId: DEAL.t1 }), "refunded");

  // En gentagelse af handlen ser refusionen og betaler intet.
  await assert.rejects(() => saleEscrowPayment(supabase, { parked: false, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B], priorEscrow: "refunded" }), /refunderet/);

  // Databasen er den endelige garanti: den gamle sti (koeberens traek er en dublet,
  // saelgers kredit ikke) afvises under holdlaasen, og saldoen rulles tilbage.
  const [buyerLeg, sellerLeg] = transferLegs(DEAL.t1, 150_000);
  await incrementBalanceWithAudit(supabase, buyerLeg, { allowDuplicate: true });
  await assert.rejects(() => incrementBalanceWithAudit(supabase, sellerLeg, { allowDuplicate: true }), (e) => /sale_escrow_refunded/.test(e.message));
  assert.equal(await balance(db, TEAM.A), START, "saelgeren krediteres aldrig efter refusionen");
  assert.equal(await balance(db, TEAM.B), START);
  assert.equal(await total(db), before, "ingen penge er opstaaet");

  // En anden handels saelger-kredit roeres ikke af vaernet.
  await incrementBalanceWithAudit(supabase, transferLegs(DEAL.t2, 10_000)[1]);
  assert.equal(await balance(db, TEAM.A), START + 10_000);
});

test("ejer-krav 1: en gentagelse, mens escrow'en holder, betaler ingen af benene igen (ogsaa med kontakten slukket)", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const legs = [
    { teamId: TEAM.B, delta: -60_000, payload: { type: "transfer_out", amount: -60_000, idempotency_key: `auction_winner:${DEAL.a1}` } },
    { teamId: TEAM.A, delta: 60_000, payload: { type: "transfer_in", amount: 60_000, idempotency_key: `auction_seller:${DEAL.a1}` } },
  ];
  await park(db, RIDER.r1, TEAM.B);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "auction", dealId: DEAL.a1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] }), legs);
  await setFlag(db, "off");
  const priorEscrow = await saleEscrowStatusForDeal(supabase, { dealType: "auction", dealId: DEAL.a1 });
  assert.equal(priorEscrow, "held");
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: false, dealType: "auction", dealId: DEAL.a1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B], priorEscrow }), legs);
  assert.equal(await balance(db, TEAM.A), START, "saelger venter stadig paa holdskiftet");
  assert.equal(await balance(db, TEAM.B), START - 60_000);
  assert.equal(await saleEscrowStatusForDeal(supabase, { dealType: "transfer", dealId: DEAL.t2 }), "none");
});

async function stuckSwap(db, supabase) {
  await park(db, RIDER.r1, TEAM.B);
  await park(db, RIDER.r2, TEAM.A);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "swap", dealId: DEAL.s1, riderIds: [RIDER.r1, RIDER.r2], targetTeamIds: [TEAM.B, TEAM.A] }), swapLegs(DEAL.s1, 40_000));
  // r1 flyttes (leveret), r2 pensioneres, foer han flyttes: byttet sidder fast.
  await flushParkedRider(supabase, { id: RIDER.r1, team_id: TEAM.A, pending_team_id: TEAM.B },
    { notifyTeamOwner: async () => {}, flushedAt: FLUSHED_AT, arrival: { reason: "dealCompleted" } });
  await db.query("UPDATE riders SET team_id = NULL, pending_team_id = NULL WHERE id = $1", [RIDER.r2]);
  const result = await reconcileHeldSaleEscrows({ supabase, now: new Date(FLUSHED_AT) });
  assert.equal(result.stuck, 1, "reconcile kan ikke afregne et fastlaast bytte");
  const [listed] = await listHeldSaleEscrowsForAdmin(supabase);
  assert.equal(listed.action, "stuck");
  return listed.id;
}

test("ejer-krav 2: et fastlaast bytte kan refunderes manuelt, een gang, og modtageren kan ikke krediteres bagefter", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  const escrowId = await stuckSwap(db, supabase);
  assert.equal(await balance(db, TEAM.B), START - 40_000);

  const refunded = await resolveStuckSaleEscrow(supabase, { escrowId, outcome: "refund", adminUserId: null, now: new Date(FLUSHED_AT) });
  assert.equal(refunded.status, "refunded");
  assert.equal(await balance(db, TEAM.B), START, "betaleren har kontanterne igen");
  assert.equal(await balance(db, TEAM.A), START);
  assert.equal((await rider(db, RIDER.r1)).team_id, TEAM.B, "den leverede rytter bliver, hvor han er");
  const post = await one(db, "SELECT reason_code, source_path, actor_type FROM finance_transactions WHERE idempotency_key LIKE 'sale_escrow_refund:%'");
  assert.deepEqual(post, { reason_code: "sale_escrow_refund", source_path: "api.admin.saleEscrowResolve", actor_type: "admin" });
  assert.equal(await total(db), before);

  assert.equal((await resolveStuckSaleEscrow(supabase, { escrowId, outcome: "release", adminUserId: null, now: new Date(FLUSHED_AT) })).status, "already_settled");
  await assert.rejects(() => incrementBalanceWithAudit(supabase, swapLegs(DEAL.s1, 40_000)[1]), (e) => /sale_escrow_refunded/.test(e.message));
  assert.equal(await total(db), before);
  assert.deepEqual(await listHeldSaleEscrowsForAdmin(supabase), [], "intet blokerer saesonskiftet laengere");
});

test("ejer-krav 2: et fastlaast bytte kan frigives manuelt til modtageren", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  const escrowId = await stuckSwap(db, supabase);
  const released = await resolveStuckSaleEscrow(supabase, { escrowId, outcome: "release", adminUserId: null, now: new Date(FLUSHED_AT) });
  assert.equal(released.status, "released");
  assert.equal(await balance(db, TEAM.A), START + 40_000, "modtageren krediteret");
  assert.equal(await balance(db, TEAM.B), START - 40_000);
  assert.deepEqual(await escrows(db), [{ status: "released", deal_type: "swap", amount: 40_000 }]);
  const post = await one(db, "SELECT reason_code, source_path, actor_type FROM finance_transactions WHERE idempotency_key = $1", [`swap_receiver:${DEAL.s1}`]);
  assert.deepEqual(post, { reason_code: "swap_cash_delta", source_path: "api.admin.saleEscrowResolve", actor_type: "admin" });
  assert.equal(await total(db), before);
});

test("ejer-krav 2: den manuelle vej afviser en escrow, der ikke sidder fast", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  await park(db, RIDER.r1, TEAM.B);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] }), transferLegs(DEAL.t1, 30_000));
  const [held] = await listHeldSaleEscrowsForAdmin(supabase);
  assert.equal(held.action, "wait");
  for (const outcome of ["release", "refund"]) {
    assert.equal((await resolveStuckSaleEscrow(supabase, { escrowId: held.id, outcome, adminUserId: null, now: new Date(FLUSHED_AT) })).status, "not_stuck");
  }
  assert.deepEqual(await escrows(db), [{ status: "held", deal_type: "transfer", amount: 30_000 }]);
  await assert.rejects(() => resolveStuckSaleEscrow(supabase, { escrowId: held.id, outcome: "cancel", adminUserId: null }), /release eller refund/);
});
