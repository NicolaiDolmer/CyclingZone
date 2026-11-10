// A7: losing atomicity between ownership and payment must fail these regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA, ESCROW_SCHEMA } from './__fixtures__/autoAccept2176Schema.js';

const file = name => readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SELLER = id(1), BUYER = id(2), RIDER = id(100), DEAL = id(9000);
const NOW = '2026-11-10T10:00:00Z';
const MIGRATION = '2026-11-10-2176-transfer-payment-atomic.sql';
const baseMigrations = [
  '2026-11-07-2176-m2-auto-accept.sql', '2026-11-07-6181-m3-market-commitment.sql',
  '2026-11-07-6181-sale-escrow-m1.sql', '2026-11-07-6181-sale-escrow-m2-guards.sql',
  '2026-11-09-2176-m3-auto-accept-claim-swap.sql', '2026-11-09-2176-counter-auction-boundary.sql',
  '2026-11-10-2176-autopris-ved-listepris.sql',
];
const payload = side => ({ type: side === 'buyer' ? 'transfer_out' : 'transfer_in', amount: side === 'buyer' ? -600000 : 600000,
  description: side, metadata: { code: side === 'buyer' ? 'tx.transferBuy' : 'tx.transferSell', params: { riderName: 'Test Rider' } },
  actor_type: 'api', source_path: `transferExecution.executeTransferOffer.${side}`,
  reason_code: side === 'buyer' ? 'transfer_purchase' : 'transfer_sale', related_entity_type: 'transfer',
  related_entity_id: DEAL, idempotency_key: `transfer_${side}:${DEAL}` });
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

async function database(t, { market = 'on', escrow = 'off', apply = true } = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(SCHEMA + ESCROW_SCHEMA);
  await db.exec(`CREATE TABLE transfer_offers(id uuid PRIMARY KEY, rider_id uuid, seller_team_id uuid, buyer_team_id uuid,
    offer_amount bigint,counter_amount bigint,status text,buyer_confirmed boolean,seller_confirmed boolean);`);
  const balance = (await file('2026-05-26-backend-message-codes.sql')).match(/CREATE OR REPLACE FUNCTION increment_balance_with_audit\([\s\S]*?\$\$ LANGUAGE plpgsql;/);
  assert.ok(balance);
  await db.exec(balance[0]);
  for (const migration of baseMigrations) await db.exec(await file(migration));
  await db.query(`UPDATE app_config SET value=$1::jsonb WHERE key='market_commitment_6181'`, [JSON.stringify(market)]);
  await db.exec(`UPDATE app_config SET value='"on"' WHERE key='auto_accept_enabled';
    INSERT INTO teams VALUES('${SELLER}',1000000),('${BUYER}',1000000);
    INSERT INTO riders(id,team_id) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${SELLER}' FROM generate_series(100,111) n;`);
  await db.query(`INSERT INTO app_config(key,value) VALUES('sale_escrow_enabled',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [JSON.stringify(escrow)]);
  if (apply) { await db.exec(await file(MIGRATION)); await db.exec(await file(MIGRATION)); }
  return db;
}
const claim = async (db, { parked = false, buyerPayload = payload('buyer'), sellerPayload = payload('seller') } = {}) =>
  (await one(db, `SELECT public.auto_accept_claim_transfer_paid($1,$2,$3,$4,$5,'{}',8,'{}',30,600000,$6,$7,$8,'{}') AS r`,
    [RIDER, SELLER, BUYER, parked, NOW, DEAL, buyerPayload, sellerPayload])).r;
const snapshot = db => one(db, `SELECT (SELECT balance FROM teams WHERE id='${BUYER}')::int AS buyer,
  (SELECT balance FROM teams WHERE id='${SELLER}')::int AS seller,
  (SELECT team_id FROM riders WHERE id='${RIDER}') AS owner,
  (SELECT pending_team_id FROM riders WHERE id='${RIDER}') AS pending,
  (SELECT count(*) FROM finance_transactions)::int AS transactions`);

test('A7: ownership and both audited payments commit together; repeat cannot pay again', async t => {
  const db = await database(t);
  assert.equal((await claim(db)).payment_handled, true);
  assert.deepEqual(await snapshot(db), { buyer: 400000, seller: 1600000, owner: BUYER, pending: null, transactions: 2 });
  assert.equal((await claim(db)).status, 'rider_state_changed');
  assert.equal((await snapshot(db)).transactions, 2);
});

test('A7: failing seller audit rolls buyer debit and ownership back', async t => {
  const db = await database(t);
  // A valid payload must pass pre-validation and fail only after buyer debit.
  await db.exec(`CREATE FUNCTION test_fail_seller_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.team_id='${SELLER}' THEN
      IF (SELECT balance FROM teams WHERE id='${BUYER}') <> 400000
        OR (SELECT team_id FROM riders WHERE id='${RIDER}') <> '${BUYER}' THEN
        RAISE EXCEPTION 'test failure happened before claim and debit';
      END IF;
      RAISE EXCEPTION 'test seller audit failed after claim and debit';
    END IF;
    RETURN NEW;
  END; $$;
  CREATE TRIGGER test_seller_audit BEFORE INSERT ON finance_transactions
    FOR EACH ROW EXECUTE FUNCTION test_fail_seller_audit();`);
  await assert.rejects(claim(db), /test seller audit failed after claim and debit/);
  assert.deepEqual(await snapshot(db), { buyer: 1000000, seller: 1000000, owner: SELLER, pending: null, transactions: 0 });
});

test('A7: parked sale holds escrow atomically; refund restores buyer and prevents revival', async t => {
  const db = await database(t, { escrow: 'on' });
  assert.equal((await claim(db, { parked: true })).payment_handled, true);
  assert.deepEqual(await snapshot(db), { buyer: 400000, seller: 1000000, owner: SELLER, pending: BUYER, transactions: 1 });
  const held = await one(db, 'SELECT id,status,amount::int FROM sale_escrows');
  assert.equal(held.status, 'held'); assert.equal(held.amount, 600000);
  const refund = { type: 'transfer_in', description: 'refund', source_path: 'test.refund' };
  assert.equal((await one(db, `SELECT settle_sale_escrow($1,'refund',$2,$3) AS r`, [held.id, refund, NOW])).r.status, 'refunded');
  assert.equal((await claim(db, { parked: true })).status, 'rider_state_changed');
  assert.deepEqual(await snapshot(db), { buyer: 1000000, seller: 1000000, owner: SELLER, pending: null, transactions: 2 });
});

test('A7: parked sale without escrow pays both legs in the claim', async t => {
  const db = await database(t);
  assert.equal((await claim(db, { parked: true })).payment_handled, true);
  assert.deepEqual(await snapshot(db), { buyer: 400000, seller: 1600000, owner: SELLER, pending: BUYER, transactions: 2 });
});

test('A7: market off preserves unpaid claim; roles cannot invoke paid RPC', async t => {
  const db = await database(t, { market: 'off' });
  assert.notEqual((await claim(db)).payment_handled, true);
  assert.deepEqual(await snapshot(db), { buyer: 1000000, seller: 1000000, owner: BUYER, pending: null, transactions: 0 });
  const signature = 'public.auto_accept_claim_transfer_paid(uuid,uuid,uuid,boolean,timestamptz,jsonb,integer,uuid[],integer,bigint,uuid,jsonb,jsonb,jsonb)';
  for (const [role, expected] of [['anon', false], ['authenticated', false], ['service_role', true]]) {
    assert.equal((await one(db, `SELECT has_function_privilege($1,$2,'EXECUTE') AS ok`, [role, signature])).ok, expected);
  }
});
