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
  findSaleEscrowsBlockingBetaReset,
  refundSaleEscrowsForReleasedRiders,
  releaseSaleEscrowForFlush,
  resolveStuckSaleEscrow,
  saleEscrowPayment,
  saleEscrowStatusForDeal,
  squadRestoreImage,
} from "./saleEscrowFlow6181.js";
import { flushParkedRider } from "./stageRaceTransferDefer.js";
import { seniorSquadPatch } from "./squads.js";
import { runFullBetaReset } from "./betaResetService.js";
import { MIGRATIONS, SCHEMA } from "./__fixtures__/saleEscrow6181Schema.js";

const file = (name) => readFile(new URL(`../../database/${name}`, import.meta.url), "utf8");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TEAM = { A: id(1), B: id(2), C: id(3) };
const RIDER = { r1: id(11), r2: id(12), r3: id(13) };
const DEAL = { t1: id(101), t2: id(102), a1: id(201), s1: id(301) };
const START = 1_000_000;
const FLUSHED_AT = "2026-11-08T10:00:00.000Z";

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
  for (const migration of MIGRATIONS) await db.exec(await file(migration));
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
    p_rider_ids: "uuid[]", p_target_team_ids: "uuid[]", p_payer_payload: "jsonb", p_payee_payload: "jsonb", p_rider_restore: "jsonb",
  },
  settle_sale_escrow: { p_escrow_id: "uuid", p_outcome: "text", p_refund_payload: "jsonb", p_settled_at: "timestamptz" },
  resolve_stuck_sale_escrow: { p_escrow_id: "uuid", p_outcome: "text", p_payload: "jsonb", p_settled_at: "timestamptz" },
  sale_escrow_undo_failed_hold: { p_deal_type: "text", p_deal_id: "uuid", p_payer_team_id: "uuid", p_payee_team_id: "uuid", p_rider_ids: "uuid[]", p_target_team_ids: "uuid[]", p_rider_restore: "jsonb" },
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

// ── #7871: Codex P1 og M1-review ──────────────────────────────────────────────

const squadOf = async (db, r) => one(db, "SELECT is_academy, squad FROM riders WHERE id = $1", [r]);
const FLUSH_OPTS = { notifyTeamOwner: async () => {}, flushedAt: FLUSHED_AT, arrival: { reason: "dealCompleted" } };
// Som flushen uden escrow (heal-sweepet foer escrow'en findes): team_id flyttes.
const flushWithoutEscrow = (db, r, team) => db.query("UPDATE riders SET team_id = $2, pending_team_id = NULL WHERE id = $1", [r, team]);

test("Codex P1: et byttes ene ben flyttes af heal-sweepet mellem parkering og hold -> escrow med det leverede ben, ingen gratis rytter", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  await park(db, RIDER.r1, TEAM.B);
  await park(db, RIDER.r2, TEAM.A);
  // Loebet slutter imellem: r1 flyttes, foer handlen naar hold_sale_escrow.
  await flushWithoutEscrow(db, RIDER.r1, TEAM.B);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "swap", dealId: DEAL.s1, riderIds: [RIDER.r1, RIDER.r2], targetTeamIds: [TEAM.B, TEAM.A] });
  await payBoth(supabase, pay, swapLegs(DEAL.s1, 70_000));
  assert.equal(await balance(db, TEAM.B), START - 70_000, "betaleren har betalt");
  assert.equal(await balance(db, TEAM.A), START, "modtageren venter paa det andet ben");
  const held = await one(db, "SELECT status, delivered_rider_ids FROM sale_escrows");
  assert.deepEqual(held, { status: "held", delivered_rider_ids: [RIDER.r1] }, "det leverede ben er noteret ved oprettelsen");

  // Andet ben: flushen afregner byttet i een transaktion.
  assert.equal(await flushParkedRider(supabase, { id: RIDER.r2, team_id: TEAM.B, pending_team_id: TEAM.A }, FLUSH_OPTS), true);
  assert.equal((await rider(db, RIDER.r2)).team_id, TEAM.A);
  assert.equal(await balance(db, TEAM.A), START + 70_000);
  assert.deepEqual(await escrows(db), [{ status: "released", deal_type: "swap", amount: 70_000 }]);
  assert.equal(await total(db), before);
});

test("Codex P1: begge ben flyttet foer hold -> betales som ved oejeblikkeligt skifte, ingen escrow", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  await park(db, RIDER.r1, TEAM.B);
  await park(db, RIDER.r2, TEAM.A);
  await flushWithoutEscrow(db, RIDER.r1, TEAM.B);
  await flushWithoutEscrow(db, RIDER.r2, TEAM.A);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "swap", dealId: DEAL.s1, riderIds: [RIDER.r1, RIDER.r2], targetTeamIds: [TEAM.B, TEAM.A] }), swapLegs(DEAL.s1, 70_000));
  assert.equal(await balance(db, TEAM.A), START + 70_000);
  assert.equal(await balance(db, TEAM.B), START - 70_000);
  assert.deepEqual(await escrows(db), []);
  assert.equal(await total(db), before);
});

test("Codex P1: refusion af et bytte gendanner trup-status for den rytter, der bliver hos sit hold", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  // r2 er akademirytter hos Hold B; byttet graduerer ham ved parkeringen (som executeSwapOffer).
  await db.query("UPDATE riders SET is_academy = true, squad = 'u23' WHERE id = $1", [RIDER.r2]);
  const r2Before = await squadOf(db, RIDER.r2);
  const graduate = seniorSquadPatch();
  await park(db, RIDER.r1, TEAM.B);
  await db.query("UPDATE riders SET pending_team_id = $2, is_academy = $3, squad = $4 WHERE id = $1", [RIDER.r2, TEAM.A, graduate.is_academy, graduate.squad]);
  const pay = await saleEscrowPayment(supabase, {
    parked: true, dealType: "swap", dealId: DEAL.s1, riderIds: [RIDER.r1, RIDER.r2], targetTeamIds: [TEAM.B, TEAM.A],
    riderRestore: [squadRestoreImage({ is_academy: false, squad: "senior" }, {}), squadRestoreImage(r2Before, graduate)],
  });
  await payBoth(supabase, pay, swapLegs(DEAL.s1, 50_000));
  assert.deepEqual(await squadOf(db, RIDER.r2), { is_academy: false, squad: "senior" }, "gradueret ved parkeringen");

  // r1 pensioneres foer flushen: byttet annulleres, betaleren refunderes.
  await db.query("UPDATE riders SET team_id = NULL, pending_team_id = NULL WHERE id = $1", [RIDER.r1]);
  assert.deepEqual(await refundSaleEscrowsForReleasedRiders(supabase, [RIDER.r1], { now: new Date(FLUSHED_AT), sourcePath: "test" }), { refunded: 1, failed: 0 });
  assert.deepEqual(await rider(db, RIDER.r2), { team_id: TEAM.B, pending_team_id: null, acquired_at: null });
  assert.deepEqual(await squadOf(db, RIDER.r2), r2Before, "akademipladsen er tilbage");
  assert.equal(await balance(db, TEAM.B), START);
  assert.equal(await total(db), before);
});

test("Codex P1: en refunderet transfer gendanner trup-status, men aldrig for en leveret rytter", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  await db.query("UPDATE riders SET is_academy = true, squad = 'junior' WHERE id IN ($1, $2)", [RIDER.r1, RIDER.r3]);
  const image = squadRestoreImage({ is_academy: true, squad: "junior" }, seniorSquadPatch());
  for (const [r, deal] of [[RIDER.r1, DEAL.t1], [RIDER.r3, DEAL.t2]]) {
    await db.query("UPDATE riders SET pending_team_id = $2, is_academy = false, squad = 'senior' WHERE id = $1", [r, TEAM.B]);
    await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: deal, riderIds: [r], targetTeamIds: [TEAM.B], riderRestore: [image] }), transferLegs(deal, 20_000));
  }
  // r1: parkeringen ryddes (handlen annulleret) -> refusion + gendannelse.
  await db.query("UPDATE riders SET pending_team_id = NULL WHERE id = $1", [RIDER.r1]);
  // r3: leveret -> release; trup-felterne roeres ikke.
  assert.equal(await flushParkedRider(supabase, { id: RIDER.r3, team_id: TEAM.A, pending_team_id: TEAM.B }, FLUSH_OPTS), true);
  const result = await reconcileHeldSaleEscrows({ supabase, now: new Date(FLUSHED_AT) });
  assert.equal(result.refunded, 1);
  assert.deepEqual(await squadOf(db, RIDER.r1), { is_academy: true, squad: "junior" });
  assert.deepEqual(await squadOf(db, RIDER.r3), { is_academy: false, squad: "senior" }, "koeberen beholder sin senior");
});

test("hold_sale_escrow afviser et foer-billede, der ikke passer til handlens ryttere", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  await park(db, RIDER.r1, TEAM.B);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B], riderRestore: [{ is_academy: "ja" }] });
  const [buyer, seller] = transferLegs(DEAL.t1, 10_000);
  await pay.incrementBalanceWithAudit(supabase, buyer);
  await assert.rejects(() => pay.incrementBalanceWithAudit(supabase, seller), (e) => /rider_restore/.test(e.message));
  assert.equal(await balance(db, TEAM.B), START);
  assert.deepEqual(await escrows(db), []);
});

test("M1-review krav 3: et parkeret ben, der ikke staar paa sit kildehold, laases ikke og betales ikke", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  // r3 tilhoerer Hold A, men handlen paastaar, at Hold C saelger.
  await park(db, RIDER.r3, TEAM.B);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t2, riderIds: [RIDER.r3], targetTeamIds: [TEAM.B] });
  const [buyer, seller] = transferLegs(DEAL.t2, 45_000, { seller: TEAM.C });
  await pay.incrementBalanceWithAudit(supabase, buyer);
  await assert.rejects(() => pay.incrementBalanceWithAudit(supabase, seller), /not_parked/);
  assert.equal(await balance(db, TEAM.B), START);
  assert.equal(await balance(db, TEAM.C), START);
  assert.deepEqual(await escrows(db), []);
});

test("M1-review krav 4: en koeber-debitering, der er reverseret, stoles ikke paa; en staaende bruges een gang", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  const [buyer, seller] = transferLegs(DEAL.t1, 35_000);
  // Den gamle sti naaede at traekke koeberen, og en manuel reversering gav pengene tilbage.
  await incrementBalanceWithAudit(supabase, buyer);
  await incrementBalanceWithAudit(supabase, { teamId: TEAM.B, delta: 35_000, payload: { type: "transfer_in", amount: 35_000, source_path: "test.reversal", related_entity_type: "transfer", related_entity_id: DEAL.t1, idempotency_key: `test_reversal:${DEAL.t1}` } });
  await park(db, RIDER.r1, TEAM.B);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] });
  await pay.incrementBalanceWithAudit(supabase, buyer, { allowDuplicate: true });
  await assert.rejects(() => pay.incrementBalanceWithAudit(supabase, seller, { allowDuplicate: true }), /payer_debit_not_standing/);
  assert.deepEqual(await escrows(db), [], "ingen escrow uden en betaling bag");
  assert.equal(await balance(db, TEAM.A), START);
  assert.equal(await total(db), before);

  // Staaende debitering (anden handel): escrow'en oprettes uden at traekke igen.
  const [buyer2, seller2] = transferLegs(DEAL.t2, 15_000);
  await incrementBalanceWithAudit(supabase, buyer2);
  await park(db, RIDER.r3, TEAM.B);
  const pay2 = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t2, riderIds: [RIDER.r3], targetTeamIds: [TEAM.B] });
  await payBoth(supabase, pay2, [buyer2, seller2]);
  assert.equal(await balance(db, TEAM.B), START - 15_000, "traekket een gang");
  assert.deepEqual(await escrows(db), [{ status: "held", deal_type: "transfer", amount: 15_000 }]);
  assert.equal(await total(db), before);
});

test("videresalg: en rytter leveret i et holdt bytte kan saelges videre, og hver flush afregner sin egen escrow", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  await park(db, RIDER.r1, TEAM.B);
  await park(db, RIDER.r2, TEAM.A);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "swap", dealId: DEAL.s1, riderIds: [RIDER.r1, RIDER.r2], targetTeamIds: [TEAM.B, TEAM.A] }), swapLegs(DEAL.s1, 25_000));
  assert.equal(await flushParkedRider(supabase, { id: RIDER.r1, team_id: TEAM.A, pending_team_id: TEAM.B }, FLUSH_OPTS), true);

  // Hold B saelger r1 videre til Hold C, mens r2 stadig koerer for Hold B.
  await park(db, RIDER.r1, TEAM.C);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.C] }),
    transferLegs(DEAL.t1, 60_000, { buyer: TEAM.C, seller: TEAM.B }));
  assert.equal(await balance(db, TEAM.C), START - 60_000);

  assert.equal(await flushParkedRider(supabase, { id: RIDER.r1, team_id: TEAM.B, pending_team_id: TEAM.C }, FLUSH_OPTS), true);
  assert.equal((await rider(db, RIDER.r1)).team_id, TEAM.C);
  assert.equal(await balance(db, TEAM.B), START - 25_000 + 60_000, "videresalget er afregnet");
  assert.equal(await balance(db, TEAM.A), START, "byttet venter stadig paa r2");

  assert.equal(await flushParkedRider(supabase, { id: RIDER.r2, team_id: TEAM.B, pending_team_id: TEAM.A }, FLUSH_OPTS), true);
  assert.equal(await balance(db, TEAM.A), START + 25_000);
  assert.deepEqual((await escrows(db)).map((e) => e.status), ["released", "released"]);
  assert.equal(await total(db), before);
});

test("M1-review krav 5: en deadlock i RPC'en proeves igen; transaktionen er rullet tilbage, saa intet sker to gange", async () => {
  const db = await database();
  await setFlag(db, "on");
  const base = adapter(db);
  let failures = 0;
  const supabase = {
    ...base,
    async rpc(name, args) {
      if ((name === "hold_sale_escrow" || name === "settle_sale_escrow") && failures < 2) {
        failures += 1;
        return { data: null, error: { code: "40P01", message: "deadlock detected" } };
      }
      return base.rpc(name, args);
    },
  };
  const before = await total(db);
  await park(db, RIDER.r1, TEAM.B);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] }), transferLegs(DEAL.t1, 12_000));
  assert.equal(failures, 2);
  assert.equal(await balance(db, TEAM.B), START - 12_000, "traekket een gang");
  failures = 0;
  assert.equal(await flushParkedRider(supabase, { id: RIDER.r1, team_id: TEAM.A, pending_team_id: TEAM.B }, FLUSH_OPTS), true);
  assert.equal(failures, 2);
  assert.equal(await balance(db, TEAM.A), START + 12_000);
  assert.equal(await total(db), before);

  // Tre deadlocks i traek: fejlen gives videre (ingen uendelig loekke).
  const alwaysLocked = { ...base, rpc: async () => ({ data: null, error: { code: "40P01", message: "deadlock detected" } }) };
  await park(db, RIDER.r3, TEAM.B);
  const pay = await saleEscrowPayment(alwaysLocked, { parked: true, dealType: "transfer", dealId: DEAL.t2, riderIds: [RIDER.r3], targetTeamIds: [TEAM.B] });
  const [buyer, seller] = transferLegs(DEAL.t2, 5_000);
  await pay.incrementBalanceWithAudit(alwaysLocked, buyer);
  await assert.rejects(() => pay.incrementBalanceWithAudit(alwaysLocked, seller), (e) => e.code === "40P01");
});

// ── Tjeklisten 9/11 ───────────────────────────────────────────────────────────
const USER = { A: id(901), B: id(902) };
const failingHold = (supabase, result = { data: null, error: { code: "XX000", message: "laasen fejlede" } }, { commit = false } = {}) => ({
  ...supabase,
  async rpc(name, args) {
    if (name !== "hold_sale_escrow") return supabase.rpc(name, args);
    if (commit) await supabase.rpc(name, args);
    return result;
  },
});
const contractOf = (db, r) => one(db, "SELECT salary, contract_length, contract_end_season FROM riders WHERE id = $1", [r]);
const notifications = async (db) => (await db.query("SELECT user_id, type, title, message, related_id, metadata FROM notifications ORDER BY title")).rows;
async function parkAcademySale(db, r, deal, buyer = TEAM.B) {
  await db.query("UPDATE riders SET is_academy = true, squad = 'u23', salary = NULL, contract_length = NULL, contract_end_season = NULL WHERE id = $1", [r]);
  await db.query("INSERT INTO academy_graduation(team_id, rider_id, status, resolved_at) VALUES ($1, $2, 'sold', now())", [TEAM.A, r]);
  await db.query("UPDATE riders SET pending_team_id = $2, is_academy = false, squad = 'senior', salary = 900, contract_length = 2, contract_end_season = 7 WHERE id = $1", [r, buyer]);
  await db.query("INSERT INTO transfer_offers(id, status) VALUES ($1, 'accepted')", [deal]);
  return squadRestoreImage({ is_academy: true, squad: "u23", salary: null, contract_end_season: null }, seniorSquadPatch());
}

test("squadRestoreImage: kontrakten kommer kun med, naar handlen skriver en, og aldrig uden kolonnen", () => {
  const full = { is_academy: false, squad: "senior", salary: 10, contract_end_season: 5 };
  assert.equal(squadRestoreImage(full, {}), null);
  assert.deepEqual(squadRestoreImage({ ...full, salary: null, contract_end_season: null }, {}), { salary: null, contract_length: null, contract_end_season: null });
  assert.equal(squadRestoreImage({ is_academy: false, squad: "senior" }, {}), null, "uden salary i SELECT'en er intet kendt");
  assert.deepEqual(squadRestoreImage({ ...full, contract_end_season: null }, {}), { salary: 10, contract_end_season: null }, "ukendt laengde roeres ikke (Codex P1)");
  assert.deepEqual(squadRestoreImage({ ...full, contract_end_season: null, contract_length: 3 }, {}), { salary: 10, contract_end_season: null, contract_length: 3 });
  assert.deepEqual(squadRestoreImage({ ...full, is_academy: true, squad: "u23" }, seniorSquadPatch()), { is_academy: true, squad: "u23" });
});

test("tjekliste 1: en fejlet laas fjerner parkeringen, gendanner rytteren, og flushen kan ikke flytte ham gratis", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  const before = await total(db);
  const image = await parkAcademySale(db, RIDER.r1, DEAL.t1);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B], riderRestore: [image] });
  const [buyer, seller] = transferLegs(DEAL.t1, 40_000);
  const broken = failingHold(supabase);
  await pay.incrementBalanceWithAudit(broken, buyer);
  await assert.rejects(() => pay.incrementBalanceWithAudit(broken, seller), (e) => /laasen fejlede/.test(e.message));

  assert.deepEqual(await rider(db, RIDER.r1), { team_id: TEAM.A, pending_team_id: null, acquired_at: null });
  assert.deepEqual(await squadOf(db, RIDER.r1), { is_academy: true, squad: "u23" });
  assert.deepEqual(await contractOf(db, RIDER.r1), { salary: null, contract_length: null, contract_end_season: null });
  assert.equal((await one(db, "SELECT status FROM academy_graduation WHERE rider_id = $1", [RIDER.r1])).status, "pending");
  assert.equal(await balance(db, TEAM.B), START);
  assert.equal(await total(db), before);
  assert.deepEqual(await escrows(db), []);
  assert.equal(await flushParkedRider(supabase, { id: RIDER.r1, team_id: TEAM.A, pending_team_id: TEAM.B }, FLUSH_OPTS), false, "intet at flytte");
  assert.equal((await rider(db, RIDER.r1)).team_id, TEAM.A);
});

test("tjekliste 1: kan laasen hverken oprettes eller betales, fortrydes parkeringen ogsaa", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  await park(db, RIDER.r1, TEAM.B);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] }), transferLegs(DEAL.t1, 10_000));
  // En anden handel forsoeger samme rytter: rider_already_escrowed. Parkeringen tilhoerer
  // den holdte escrow, men her er den peget mod Hold C, saa kun den nye handels ben roeres.
  await db.query("UPDATE riders SET pending_team_id = $2 WHERE id = $1", [RIDER.r1, TEAM.C]);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t2, riderIds: [RIDER.r1], targetTeamIds: [TEAM.C] });
  await assert.rejects(() => payBoth(supabase, pay, transferLegs(DEAL.t2, 10_000, { buyer: TEAM.C })), /rider_already_escrowed/);
  assert.equal((await rider(db, RIDER.r1)).pending_team_id, null);
  assert.equal(await balance(db, TEAM.C), START);
});

test("tjekliste 1: naaede laasen at blive oprettet (tabt svar), staar parkeringen og escrow'en urort", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  await park(db, RIDER.r1, TEAM.B);
  const pay = await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] });
  const lost = failingHold(supabase, { data: null, error: { code: "08006", message: "forbindelsen forsvandt" } }, { commit: true });
  const [buyer, seller] = transferLegs(DEAL.t1, 10_000);
  await pay.incrementBalanceWithAudit(lost, buyer);
  await assert.rejects(() => pay.incrementBalanceWithAudit(lost, seller), (e) => /forsvandt/.test(e.message));
  assert.equal((await rider(db, RIDER.r1)).pending_team_id, TEAM.B);
  assert.deepEqual(await escrows(db), [{ status: "held", deal_type: "transfer", amount: 10_000 }]);
});

test("tjekliste 2: refusion rydder kontrakt, graduering, tilmeldinger og handlens status og sender besked een gang", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  await db.query("UPDATE teams SET user_id = CASE id WHEN $1::uuid THEN $3::uuid WHEN $2::uuid THEN $4::uuid END WHERE id IN ($1, $2)", [TEAM.A, TEAM.B, USER.A, USER.B]);
  const image = await parkAcademySale(db, RIDER.r1, DEAL.t1);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B], riderRestore: [image] }), transferLegs(DEAL.t1, 40_000));
  const [buyerRace, sellerRace, startedRace] = [id(701), id(702), id(703)];
  await db.exec(`INSERT INTO races(id, stages_completed) VALUES ('${buyerRace}', 0), ('${sellerRace}', 0), ('${startedRace}', 2);
    INSERT INTO race_entries VALUES ('${buyerRace}', '${RIDER.r1}', '${TEAM.B}'), ('${sellerRace}', '${RIDER.r2}', '${TEAM.B}'), ('${startedRace}', '${RIDER.r1}', '${TEAM.B}');`);

  await db.query("UPDATE riders SET pending_team_id = NULL WHERE id = $1", [RIDER.r1]);
  const result = await reconcileHeldSaleEscrows({ supabase, now: new Date(FLUSHED_AT) });
  assert.equal(result.refunded, 1);

  assert.deepEqual(await squadOf(db, RIDER.r1), { is_academy: true, squad: "u23" });
  assert.deepEqual(await contractOf(db, RIDER.r1), { salary: null, contract_length: null, contract_end_season: null });
  assert.equal((await one(db, "SELECT status FROM academy_graduation WHERE rider_id = $1", [RIDER.r1])).status, "pending");
  const entries = (await db.query("SELECT race_id FROM race_entries WHERE rider_id = $1 ORDER BY race_id", [RIDER.r1])).rows.map((e) => e.race_id);
  assert.deepEqual(entries, [startedRace], "kun det ikke-startede loeb paa koeberens hold ryddes");
  assert.equal((await one(db, "SELECT count(*)::int AS n FROM race_entries WHERE rider_id = $1", [RIDER.r2])).n, 1, "andre ryttere roeres ikke");
  const offer = await one(db, "SELECT status, updated_at FROM transfer_offers WHERE id = $1", [DEAL.t1]);
  assert.equal(offer.status, "withdrawn");
  assert.equal(new Date(offer.updated_at).toISOString(), FLUSHED_AT);

  const sent = await notifications(db);
  assert.equal(sent.length, 2);
  const buyerNote = sent.find((n) => n.user_id === USER.B);
  const sellerNote = sent.find((n) => n.user_id === USER.A);
  assert.equal(buyerNote.type, "transfer_offer_rejected");
  assert.equal(buyerNote.related_id, DEAL.t1);
  assert.equal(buyerNote.message, "Rytter En did not change teams, so 40,000 CZ$ is back in your balance.");
  assert.deepEqual(buyerNote.metadata, { titleCode: "notif.saleEscrowRefund.buyerTitle", titleParams: {}, messageCode: "notif.saleEscrowRefund.buyerMessage", messageParams: { riders: "Rytter En", amount: 40_000 }, riderId: RIDER.r1 });
  assert.equal(sellerNote.metadata.messageCode, "notif.saleEscrowRefund.sellerMessage");

  const again = await reconcileHeldSaleEscrows({ supabase, now: new Date(FLUSHED_AT) });
  assert.equal(again.checked, 0);
  assert.equal((await notifications(db)).length, 2, "besked en gang");
});

test("tjekliste 2: hans tilmeldinger hos det hold, han bliver paa, bestaar; AI-hold faar ingen besked", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  await park(db, RIDER.r1, TEAM.B);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "transfer", dealId: DEAL.t1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] }), transferLegs(DEAL.t1, 10_000));
  const race = id(704);
  await db.exec(`INSERT INTO races(id) VALUES ('${race}'); INSERT INTO race_entries VALUES ('${race}', '${RIDER.r1}', '${TEAM.A}');`);
  await db.query("UPDATE riders SET pending_team_id = NULL WHERE id = $1", [RIDER.r1]);
  assert.equal((await reconcileHeldSaleEscrows({ supabase, now: new Date(FLUSHED_AT) })).refunded, 1);
  assert.equal((await one(db, "SELECT count(*)::int AS n FROM race_entries")).n, 1);
  assert.deepEqual(await notifications(db), []);
});

test("tjekliste 2: en refunderet auktion lukkes som annulleret, et refunderet bytte som trukket tilbage", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  await db.query("UPDATE teams SET user_id = $2 WHERE id = $1", [TEAM.B, USER.B]);
  await db.query("INSERT INTO auctions(id, status) VALUES ($1, 'completed')", [DEAL.a1]);
  await db.query("INSERT INTO swap_offers(id, status) VALUES ($1, 'accepted')", [DEAL.s1]);
  await park(db, RIDER.r1, TEAM.B);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "auction", dealId: DEAL.a1, riderIds: [RIDER.r1], targetTeamIds: [TEAM.B] }), [
    { teamId: TEAM.B, delta: -5_000, payload: { type: "transfer_out", amount: -5_000, idempotency_key: `auction_winner:${DEAL.a1}` } },
    { teamId: TEAM.A, delta: 5_000, payload: { type: "transfer_in", amount: 5_000, idempotency_key: `auction_seller:${DEAL.a1}` } },
  ]);
  await park(db, RIDER.r3, TEAM.B);
  await park(db, RIDER.r2, TEAM.A);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "swap", dealId: DEAL.s1, riderIds: [RIDER.r3, RIDER.r2], targetTeamIds: [TEAM.B, TEAM.A] }), swapLegs(DEAL.s1, 7_000));
  await db.query("UPDATE riders SET pending_team_id = NULL WHERE id = ANY($1)", [`{${RIDER.r1},${RIDER.r2},${RIDER.r3}}`]);
  assert.equal((await reconcileHeldSaleEscrows({ supabase, now: new Date(FLUSHED_AT) })).refunded, 2);
  assert.equal((await one(db, "SELECT status FROM auctions WHERE id = $1", [DEAL.a1])).status, "cancelled");
  assert.equal((await one(db, "SELECT status FROM swap_offers WHERE id = $1", [DEAL.s1])).status, "withdrawn");
  const types = (await notifications(db)).map((n) => n.type).sort();
  assert.deepEqual(types, ["auction_cancelled", "transfer_offer_rejected"], "kun Hold B har en ejer");
});

test("tjekliste 6: fuld beta-nulstilling stopper foer noget roeres, hvis et bytte vil sidde fast", async () => {
  const db = await database();
  await setFlag(db, "on");
  const supabase = adapter(db);
  await park(db, RIDER.r1, TEAM.B);
  await park(db, RIDER.r2, TEAM.A);
  await payBoth(supabase, await saleEscrowPayment(supabase, { parked: true, dealType: "swap", dealId: DEAL.s1, riderIds: [RIDER.r1, RIDER.r2], targetTeamIds: [TEAM.B, TEAM.A] }), swapLegs(DEAL.s1, 50_000));
  assert.deepEqual(await findSaleEscrowsBlockingBetaReset(supabase), [], "ingen leveret: refunderes uden problemer");

  assert.equal(await flushParkedRider(supabase, { id: RIDER.r1, team_id: TEAM.A, pending_team_id: TEAM.B }, FLUSH_OPTS), true);
  const blocking = await findSaleEscrowsBlockingBetaReset(supabase);
  assert.equal(blocking.length, 1, "een leveret, den anden venter: ville sidde fast efter nulstillingen");
  const balanceBefore = await balance(db, TEAM.A);
  await assert.rejects(() => runFullBetaReset(supabase), /fastlaast/);
  assert.equal(await balance(db, TEAM.A), balanceBefore);
  assert.equal((await rider(db, RIDER.r2)).pending_team_id, TEAM.A, "intet er roert");
});
