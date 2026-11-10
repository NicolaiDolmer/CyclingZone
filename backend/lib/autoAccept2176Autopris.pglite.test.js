// #2176 + #6181 dommer-fund 10/11 mod en rigtig Postgres (PGlite):
//   - auto-prisen maa vaere lig listeprisen (CHECK + set_listing_auto_accept_price),
//   - transfer-claimet tjekker koeberens disponible saldo under holdlaasen, naar
//     pengelaasen er taendt; slukket = uaendret.
// Bruger de RIGTIGE migrationer fra database/. Hold og ryttere er aliaser.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from './__fixtures__/autoAccept2176Schema.js';

const file = name => readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8');
const NEW = '2026-11-10-2176-autopris-ved-listepris.sql';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const TEAM = { A: id(1), B: id(2), C: id(3) };
const USER = id(901);
const START = 1_000_000;
const NOW = '2026-11-10T10:00:00Z';
const END = '2026-11-10T14:00:00Z';

const openDatabases = new Set();
afterEach(async () => {
  for (const db of openDatabases) await db.close();
  openDatabases.clear();
});

async function database({ marketGate = false, applyNew = true } = {}) {
  const db = new PGlite();
  openDatabases.add(db);
  await db.exec(SCHEMA);
  await db.exec(await file('2026-05-10-reject-late-auction-bid-trigger.sql'));
  await db.exec(`INSERT INTO teams VALUES ('${TEAM.A}', ${START}), ('${TEAM.B}', ${START}), ('${TEAM.C}', ${START});`);
  await db.exec(await file('2026-11-07-2176-m2-auto-accept.sql'));
  await db.exec(await file('2026-11-09-2176-m3-auto-accept-claim-swap.sql'));
  await db.exec(await file('2026-11-07-6181-m3-market-commitment.sql'));
  if (marketGate) await db.exec(`UPDATE app_config SET value='"on"' WHERE key='market_commitment_6181'`);
  await db.exec(`CREATE TABLE transfer_offers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rider_id uuid,seller_team_id uuid,buyer_team_id uuid,
    offer_amount bigint,counter_amount bigint,status text,buyer_confirmed boolean DEFAULT false,seller_confirmed boolean DEFAULT false);`);
  await db.exec(await file('2026-11-09-2176-counter-auction-boundary.sql'));
  if (applyNew) {
    const migration = await file(NEW);
    await db.exec(migration);
    await db.exec(migration); // idempotent
  }
  return db;
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
let next = 100;
async function squad(db, team, count) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const r = id(next++);
    ids.push(r);
    await db.query('INSERT INTO riders(id, team_id) VALUES ($1, $2)', [r, team]);
  }
  return ids;
}
async function listing(db, rider, { asking = 100_000 } = {}) {
  return (await one(db, 'INSERT INTO transfer_listings(rider_id, seller_team_id, asking_price) VALUES ($1, $2, $3) RETURNING id', [rider, TEAM.A, asking])).id;
}
const setPrice = async (db, l, { price, expected = null }) =>
  (await one(db, 'SELECT public.set_listing_auto_accept_price($1,$2,$3,$4,$5) AS r', [l, TEAM.A, price, expected, USER])).r;
const claimAt = async (db, rider, price) =>
  (await one(db, "SELECT public.auto_accept_claim_transfer_at_price($1,$2,$3,false,$4,'{}',8,'{}',30,$5) AS r", [rider, TEAM.A, TEAM.B, NOW, price])).r;
const owner = async (db, r) => (await one(db, 'SELECT team_id FROM riders WHERE id=$1', [r])).team_id;
// Hold B foerer en auktion med hele sin saldo (en auktionsstart i samme splitsekund).
async function leadAuctionWithAll(db) {
  await db.query(`INSERT INTO auctions(id, rider_id, seller_team_id, current_price, current_bidder_id, calculated_end)
    VALUES ($1, $2, $3, $4, $5, $6)`, [id(700), id(799), TEAM.C, START, TEAM.B, END]);
}

test('Y = X er tilladt; Y < X afvises med below_asking; CHECK folger med', async () => {
  const db = await database();
  const [r1, r2] = await squad(db, TEAM.A, 12);
  const l1 = await listing(db, r1);
  assert.deepEqual(await setPrice(db, l1, { price: 99_999 }), { status: 'below_asking', asking_price: 100000 });
  assert.equal((await setPrice(db, l1, { price: 100_000 })).status, 'updated');
  // Listeprisen kan stige til Y, men ikke over.
  await db.query('UPDATE transfer_listings SET asking_price = 100000 WHERE id = $1', [l1]);
  await assert.rejects(db.query('UPDATE transfer_listings SET asking_price = 100001 WHERE id = $1', [l1]), /transfer_listings_auto_accept_price_check/);
  const l2 = await listing(db, r2);
  assert.equal((await setPrice(db, l2, { price: 150_000 })).status, 'updated');
  for (const [role, expected] of [['anon', false], ['authenticated', false], ['service_role', true]]) {
    const ok = (await one(db, "SELECT has_function_privilege($1, 'public.set_listing_auto_accept_price(uuid,uuid,bigint,bigint,uuid)', 'EXECUTE') AS ok", [role])).ok;
    assert.equal(ok, expected, role);
  }
});

test('foer migrationen: Y = X afvises (beviser at migrationen er aendringen)', async () => {
  const db = await database({ applyNew: false });
  const [r] = await squad(db, TEAM.A, 12);
  const l = await listing(db, r);
  assert.equal((await setPrice(db, l, { price: 100_000 })).status, 'not_above_asking');
});

test('pengelaas taendt: claim afvises, naar koeberens penge er bundet i et foerende bud', async () => {
  const db = await database({ marketGate: true });
  await db.exec(`UPDATE app_config SET value='"on"' WHERE key='auto_accept_enabled'`);
  const [r] = await squad(db, TEAM.A, 12);
  await leadAuctionWithAll(db);
  assert.deepEqual(await claimAt(db, r, 500_000), { status: 'buyer_insufficient_balance' });
  assert.equal(await owner(db, r), TEAM.A);
  // Uden bundne penge gaar claimet igennem.
  await db.query("UPDATE auctions SET status='completed' WHERE id=$1", [id(700)]);
  assert.equal((await claimAt(db, r, 500_000)).status, 'claimed');
  assert.equal(await owner(db, r), TEAM.B);
});

test('pengelaas slukket: claimet er uaendret (ingen pengetjek i SQL)', async () => {
  const db = await database({ marketGate: false });
  await db.exec(`UPDATE app_config SET value='"on"' WHERE key='auto_accept_enabled'`);
  const [r] = await squad(db, TEAM.A, 12);
  await leadAuctionWithAll(db);
  assert.equal((await claimAt(db, r, 500_000)).status, 'claimed');
  assert.equal(await owner(db, r), TEAM.B);
});

test('claim-RPC beholder rollerne', async () => {
  const db = await database();
  const sig = 'public.auto_accept_claim_transfer_at_price(uuid,uuid,uuid,boolean,timestamptz,jsonb,integer,uuid[],integer,bigint)';
  for (const [role, expected] of [['anon', false], ['authenticated', false], ['service_role', true]]) {
    assert.equal((await one(db, "SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, sig])).ok, expected, role);
  }
});
