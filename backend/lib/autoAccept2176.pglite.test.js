// #2176 auto-accept M2 mod en rigtig Postgres (PGlite): auto-prisen, prisloggen,
// klient-vagten og RPC'erne set_listing_auto_accept_price / start_auto_accept_auction.
//
// Bruger den RIGTIGE migration og den RIGTIGE reject_late_auction_bid-trigger fra
// database/. Hold og ryttere er aliaser (Hold A/B/C), ingen prod-data.
//
// Samtidighed: PGlite har een forbindelse, saa samtidige kald koeres efter
// hinanden, hvert i sin egen transaktion. Testen viser, at tjek og skrivning
// sker i samme transaktion (ingen dobbeltstart, ingen overbooking). Den aegte
// laase-test med flere forbindelser koeres mod PG17 uden for CI (se PR-body).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const file = name => readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8');
const MIGRATION = '2026-11-07-2176-m2-auto-accept.sql';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const TEAM = { A: id(1), B: id(2), C: id(3), D: id(4) };
const USER = id(901);
const START = 1_000_000;
const NOW = '2026-11-09T10:00:00Z';
const END = '2026-11-09T14:00:00Z'; // 4 t vaegur, rigeligt til 60 min aktiv tid
const MAX = 30;
const FLOOR = 8;

// Minimalt udsnit af prod-skemaet: de kolonner, checks og indeks RPC'erne roerer.
const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE teams (id uuid PRIMARY KEY, balance bigint NOT NULL);
CREATE TABLE riders (id uuid PRIMARY KEY, team_id uuid, pending_team_id uuid,
  squad text NOT NULL DEFAULT 'senior', is_academy boolean NOT NULL DEFAULT false, is_retired boolean DEFAULT false);
CREATE TABLE transfer_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL, seller_team_id uuid NOT NULL, asking_price integer NOT NULL,
  status text DEFAULT 'open' CHECK (status IN ('open', 'negotiating', 'sold', 'withdrawn', 'paused')),
  created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX uniq_transfer_listings_one_active_per_rider ON transfer_listings(rider_id) WHERE status IN ('open', 'negotiating');
CREATE TABLE auctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL, seller_team_id uuid,
  starting_price integer NOT NULL DEFAULT 1, current_price integer NOT NULL DEFAULT 1, current_bidder_id uuid,
  min_increment integer DEFAULT 1, requested_start timestamptz NOT NULL DEFAULT now(),
  calculated_end timestamptz NOT NULL, actual_end timestamptz,
  status text DEFAULT 'active' CHECK (status IN ('active', 'extended', 'completed', 'cancelled')),
  extension_count integer DEFAULT 0, is_flash boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX uniq_auctions_one_active_per_rider ON auctions(rider_id) WHERE status IN ('active', 'extended');
CREATE TABLE auction_bids (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auction_id uuid NOT NULL, team_id uuid NOT NULL,
  amount integer NOT NULL, bid_time timestamptz NOT NULL DEFAULT now(), triggered_extension boolean DEFAULT false, is_proxy boolean DEFAULT false);
CREATE TABLE auction_proxy_bids (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auction_id uuid NOT NULL, team_id uuid NOT NULL, max_amount bigint NOT NULL);
CREATE TABLE swap_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), offered_rider_id uuid, requested_rider_id uuid, status text NOT NULL);
GRANT SELECT, INSERT, UPDATE ON teams, riders, transfer_listings, auctions, auction_bids, auction_proxy_bids, swap_offers TO service_role;
GRANT SELECT, INSERT, UPDATE ON transfer_listings TO authenticated;
`;

async function database() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(await file('2026-05-10-reject-late-auction-bid-trigger.sql'));
  // Eksisterende raekker foer migrationen: de maa ikke aendres af den.
  await db.exec(`INSERT INTO teams VALUES ('${TEAM.A}', ${START}), ('${TEAM.B}', ${START}), ('${TEAM.C}', ${START}), ('${TEAM.D}', ${START});
    INSERT INTO auctions(id, rider_id, seller_team_id, calculated_end) VALUES ('${id(700)}', '${id(799)}', '${TEAM.D}', '2026-11-01T12:00:00Z');`);
  const migration = await file(MIGRATION);
  await db.exec(migration);
  await db.exec(migration); // idempotent
  return db;
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const balance = async (db, team) => Number((await one(db, 'SELECT balance FROM teams WHERE id = $1', [team])).balance);

// Hold A saelger. Giver holdet `count` senior-ryttere og en listing paa den foerste.
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
async function listing(db, rider, { seller = TEAM.A, asking = 100_000, auto = null } = {}) {
  const row = await one(db, 'INSERT INTO transfer_listings(rider_id, seller_team_id, asking_price) VALUES ($1, $2, $3) RETURNING id', [rider, seller, asking]);
  if (auto != null) {
    const set = await setPrice(db, row.id, { price: auto });
    assert.equal(set.status, 'updated');
  }
  return row.id;
}
async function setPrice(db, listingId, { seller = TEAM.A, price, expected = null, actor = USER }) {
  return (await one(db, 'SELECT public.set_listing_auto_accept_price($1,$2,$3,$4,$5) AS r', [listingId, seller, price, expected, actor])).r;
}
async function start(db, listingId, { buyer = TEAM.B, expected = 500_000, minutes = 60, end = END, max = MAX, floor = FLOOR, atRisk = [], now = NOW } = {}) {
  return (await one(db, 'SELECT public.start_auto_accept_auction($1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9) AS r',
    [listingId, buyer, expected, minutes, end, max, floor, `{${atRisk.join(',')}}`, now])).r;
}
const log = async (db, listingId) => (await db.query(
  'SELECT old_asking_price, new_asking_price, old_auto_accept_price, new_auto_accept_price, actor_user_id, source FROM transfer_listing_price_log WHERE listing_id = $1 ORDER BY changed_at, id', [listingId]))
  .rows.map(r => ({ ...r,
    old_asking_price: r.old_asking_price == null ? null : Number(r.old_asking_price),
    new_asking_price: Number(r.new_asking_price),
    old_auto_accept_price: r.old_auto_accept_price == null ? null : Number(r.old_auto_accept_price),
    new_auto_accept_price: r.new_auto_accept_price == null ? null : Number(r.new_auto_accept_price) }));

test('migrationen er additiv: eksisterende auktioner bliver standard, listings faar ingen auto-pris', async () => {
  const db = await database();
  const old = await one(db, `SELECT origin, source_listing_id, buyer_duration_minutes FROM auctions WHERE id = '${id(700)}'`);
  assert.deepEqual(old, { origin: 'standard', source_listing_id: null, buyer_duration_minutes: null });
  await assert.rejects(db.query(`INSERT INTO auctions(rider_id, calculated_end, origin) VALUES ('${id(798)}', now(), 'auto_accept')`), /auctions_auto_accept_shape/);
  await assert.rejects(db.query(`INSERT INTO auctions(rider_id, calculated_end, source_listing_id) VALUES ('${id(798)}', now(), '${id(1)}')`), /auctions_auto_accept_shape/);
  await assert.rejects(db.query(`INSERT INTO auctions(rider_id, calculated_end, origin) VALUES ('${id(798)}', now(), 'other')`), /auctions_origin_check/);
});

test('slukket = ingen spor: listings uden auto-pris logges aldrig', async () => {
  const db = await database();
  const [r] = await squad(db, TEAM.A, 1);
  const l = await listing(db, r);
  await db.query('UPDATE transfer_listings SET asking_price = 120000 WHERE id = $1', [l]);
  await db.query("UPDATE transfer_listings SET status = 'withdrawn' WHERE id = $1", [l]);
  assert.equal(Number((await one(db, 'SELECT count(*) AS n FROM transfer_listing_price_log')).n), 0);
});

test('saelger saetter, aendrer og fjerner Y med forventet pris; alt logges med aktoer', async () => {
  const db = await database();
  const [r] = await squad(db, TEAM.A, 1);
  const l = await listing(db, r);

  assert.deepEqual(await setPrice(db, l, { price: 100_000 }), { status: 'not_above_asking', asking_price: 100000 });
  assert.deepEqual(await setPrice(db, l, { price: 500_000, expected: 400_000 }), { status: 'price_changed', auto_accept_price: null });
  assert.deepEqual(await setPrice(db, l, { seller: TEAM.C, price: 500_000 }), { status: 'not_owner' });
  assert.deepEqual(await setPrice(db, l, { price: 3_000_000_000 }), { status: 'price_too_high' });

  assert.equal((await setPrice(db, l, { price: 500_000 })).status, 'updated');
  // Saelger saa en gammel pris: afvist, intet aendret.
  assert.deepEqual(await setPrice(db, l, { price: 450_000, expected: null }), { status: 'price_changed', auto_accept_price: 500000 });
  assert.deepEqual(await setPrice(db, l, { price: 500_000, expected: 500_000 }), { status: 'unchanged', auto_accept_price: 500000 });
  assert.equal((await setPrice(db, l, { price: 450_000, expected: 500_000 })).status, 'updated');

  // X kan ikke loeftes til Y eller over (CHECK), men en lovlig X-aendring logges.
  await assert.rejects(db.query('UPDATE transfer_listings SET asking_price = 450000 WHERE id = $1', [l]), /transfer_listings_auto_accept_price_check/);
  await db.query('UPDATE transfer_listings SET asking_price = 200000 WHERE id = $1', [l]);
  assert.equal((await setPrice(db, l, { price: null, expected: 450_000 })).status, 'updated');

  assert.deepEqual(await log(db, l), [
    { old_asking_price: 100000, new_asking_price: 100000, old_auto_accept_price: null, new_auto_accept_price: 500000, actor_user_id: USER, source: 'seller_set_price' },
    { old_asking_price: 100000, new_asking_price: 100000, old_auto_accept_price: 500000, new_auto_accept_price: 450000, actor_user_id: USER, source: 'seller_set_price' },
    { old_asking_price: 100000, new_asking_price: 200000, old_auto_accept_price: 450000, new_auto_accept_price: 450000, actor_user_id: null, source: 'listing_update' },
    { old_asking_price: 200000, new_asking_price: 200000, old_auto_accept_price: 450000, new_auto_accept_price: null, actor_user_id: USER, source: 'seller_set_price' },
  ]);

  await db.query("UPDATE transfer_listings SET status = 'withdrawn' WHERE id = $1", [l]);
  assert.deepEqual(await setPrice(db, l, { price: 500_000 }), { status: 'listing_closed' });
});

test('akademiryttere kan ikke faa en auto-pris', async () => {
  const db = await database();
  const r = id(next++);
  await db.query('INSERT INTO riders(id, team_id, is_academy) VALUES ($1, $2, true)', [r, TEAM.A]);
  const l = await listing(db, r);
  assert.deepEqual(await setPrice(db, l, { price: 500_000 }), { status: 'rider_is_academy' });
});

test('klienten kan aldrig selv aendre auto-prisen (RLS-politikken tillader ellers ejeren at opdatere)', async () => {
  const db = await database();
  const [r, r2] = await squad(db, TEAM.A, 2);
  const l = await listing(db, r, { auto: 500_000 });
  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query('UPDATE transfer_listings SET auto_accept_price = 150000 WHERE id = $1', [l]), /only be changed by the server/);
  await assert.rejects(db.query('INSERT INTO transfer_listings(rider_id, seller_team_id, asking_price, auto_accept_price) VALUES ($1, $2, 1, 2)', [r2, TEAM.A]), /only be changed by the server/);
  await assert.rejects(db.query('SELECT * FROM transfer_listing_price_log'), /permission denied/);
  // En X-aendring fra klienten (eksisterende adfaerd) virker stadig og logges.
  await db.query('UPDATE transfer_listings SET asking_price = 110000 WHERE id = $1', [l]);
  await db.exec('RESET ROLE');
  assert.equal(Number((await one(db, 'SELECT auto_accept_price FROM transfer_listings WHERE id = $1', [l])).auto_accept_price), 500000);
  assert.equal((await log(db, l)).at(-1).source, 'listing_update');
});

test('koeberen byder Y: auktion med foerende bud, listing paa pause, ingen penge flyttet', async () => {
  const db = await database();
  const [r] = await squad(db, TEAM.A, 12);
  const l = await listing(db, r, { auto: 500_000 });

  const res = await start(db, l, { minutes: 90 });
  assert.equal(res.status, 'started');
  assert.equal(res.price, 500000);
  const auction = await one(db, 'SELECT * FROM auctions WHERE id = $1', [res.auction_id]);
  assert.equal(auction.origin, 'auto_accept');
  assert.equal(auction.source_listing_id, l);
  assert.equal(auction.buyer_duration_minutes, 90);
  assert.equal(auction.seller_team_id, TEAM.A);
  assert.equal(auction.current_bidder_id, TEAM.B);
  assert.equal(auction.starting_price, 500000);
  assert.equal(auction.current_price, 500000);
  assert.equal(auction.is_flash, false);
  assert.equal(new Date(auction.calculated_end).toISOString(), new Date(END).toISOString());
  const bids = (await db.query('SELECT team_id, amount, is_proxy FROM auction_bids WHERE auction_id = $1', [res.auction_id])).rows;
  assert.deepEqual(bids, [{ team_id: TEAM.B, amount: 500000, is_proxy: false }]);
  assert.equal((await one(db, 'SELECT status FROM transfer_listings WHERE id = $1', [l])).status, 'paused');
  assert.equal(await balance(db, TEAM.B), START, 'pengene er reserveret af buddet, ikke trukket');
  assert.equal(await balance(db, TEAM.A), START);

  // Listingen er paa pause: et nyt klik starter ikke en anden auktion.
  assert.deepEqual(await start(db, l, { buyer: TEAM.C }), { status: 'listing_closed' });
});

test('en prisaendring gaelder kun nye bud: koeberen med den gamle pris faar price_changed', async () => {
  const db = await database();
  const [r] = await squad(db, TEAM.A, 12);
  const l = await listing(db, r, { auto: 500_000 });
  assert.equal((await setPrice(db, l, { price: 600_000, expected: 500_000 })).status, 'updated');
  assert.deepEqual(await start(db, l, { expected: 500_000 }), { status: 'price_changed', auto_accept_price: 600000 });
  assert.equal(Number((await one(db, 'SELECT count(*) AS n FROM auctions WHERE origin = $1', ['auto_accept'])).n), 0);
  assert.equal((await start(db, l, { expected: 600_000 })).status, 'started');
});

test('penge: saldo minus foerende bud og autobud skal daekke Y', async () => {
  const db = await database();
  const [r] = await squad(db, TEAM.A, 12);
  const l = await listing(db, r, { auto: 500_000 });
  // Hold B leder en auktion til 300k og har et autobud paa 250k paa en anden.
  await db.query(`INSERT INTO auctions(id, rider_id, current_price, current_bidder_id, calculated_end) VALUES ('${id(710)}', '${id(790)}', 300000, '${TEAM.B}', '${END}'),
    ('${id(711)}', '${id(791)}', 100000, '${TEAM.C}', '${END}')`);
  await db.query(`INSERT INTO auction_proxy_bids(auction_id, team_id, max_amount) VALUES ('${id(711)}', '${TEAM.B}', 250000)`);
  assert.deepEqual(await start(db, l), { status: 'insufficient_funds', available: 450000 });
  await db.query(`DELETE FROM auction_proxy_bids`);
  assert.equal((await start(db, l)).status, 'started');
});

test('plads: foerende auktioner optager en plads', async () => {
  const db = await database();
  const [r] = await squad(db, TEAM.A, 12);
  const l = await listing(db, r, { auto: 500_000 });
  await squad(db, TEAM.B, 29);
  await db.query(`INSERT INTO auctions(rider_id, current_price, current_bidder_id, calculated_end) VALUES ('${id(792)}', 1000, '${TEAM.B}', '${END}')`);
  assert.deepEqual(await start(db, l), { status: 'squad_full', max_riders: 30 });
  assert.equal((await start(db, l, { max: 31 })).status, 'started');
});

test('saelgers gulv: andre auktioner med byder og risiko-ryttere taeller som udgaaende', async () => {
  const db = await database();
  const riders = await squad(db, TEAM.A, 10);
  const l = await listing(db, riders[0], { auto: 500_000 });
  // 10 ryttere, denne + en anden paa auktion med byder = 8 tilbage: lige paa gulvet.
  await db.query(`INSERT INTO auctions(rider_id, seller_team_id, current_price, current_bidder_id, calculated_end) VALUES ($1, '${TEAM.A}', 1000, '${TEAM.C}', '${END}')`, [riders[1]]);
  // Risiko-rytteren, der allerede er paa auktion, taelles kun een gang.
  assert.deepEqual(await start(db, l, { atRisk: [riders[1], riders[0]], floor: 9 }), { status: 'seller_squad_floor', min_riders: 9 });
  assert.deepEqual(await start(db, l, { atRisk: [riders[2]] }), { status: 'seller_squad_floor', min_riders: 8 });
  assert.equal((await start(db, l, { atRisk: [riders[1]] })).status, 'started');
});

test('rytterstatus og egen listing afvises', async () => {
  const db = await database();
  const [a, b, c, d] = await squad(db, TEAM.A, 12);
  const la = await listing(db, a, { auto: 500_000 });
  assert.deepEqual(await start(db, la, { buyer: TEAM.A }), { status: 'own_listing' });
  assert.deepEqual(await start(db, id(5555)), { status: 'listing_not_found' });

  const lb = await listing(db, b, { auto: 500_000 });
  await db.query('UPDATE riders SET pending_team_id = $2 WHERE id = $1', [b, TEAM.C]);
  assert.deepEqual(await start(db, lb), { status: 'rider_pending_transfer' });

  const lc = await listing(db, c, { auto: 500_000 });
  await db.query(`INSERT INTO swap_offers(offered_rider_id, status) VALUES ($1, 'pending')`, [c]);
  assert.deepEqual(await start(db, lc), { status: 'rider_in_open_swap' });

  const ld = await listing(db, d, { auto: 500_000 });
  await db.query(`INSERT INTO auctions(rider_id, calculated_end) VALUES ($1, '${END}')`, [d]);
  assert.deepEqual(await start(db, ld), { status: 'rider_on_auction' });

  const [e] = await squad(db, TEAM.A, 1);
  const le = await listing(db, e, { auto: 500_000 });
  await db.query('UPDATE riders SET team_id = $2 WHERE id = $1', [e, TEAM.C]);
  assert.deepEqual(await start(db, le), { status: 'rider_not_with_seller' });

  const [f] = await squad(db, TEAM.A, 1);
  const lf = await listing(db, f);
  assert.deepEqual(await start(db, lf), { status: 'no_auto_accept_price' });

  assert.equal(Number((await one(db, "SELECT count(*) AS n FROM auctions WHERE origin = 'auto_accept'")).n), 0);
});

test('laengde og sluttidspunkt valideres (aldrig flash, aldrig kortere end valgt)', async () => {
  const db = await database();
  const [r] = await squad(db, TEAM.A, 12);
  const l = await listing(db, r, { auto: 500_000 });
  await assert.rejects(start(db, l, { minutes: 29 }), /duration must be 30-1440/);
  await assert.rejects(start(db, l, { minutes: 1441 }), /duration must be 30-1440/);
  await assert.rejects(start(db, l, { minutes: 300, end: '2026-11-09T14:00:00Z' }), /calculated_end does not match/);
  await assert.rejects(start(db, l, { end: '2026-11-30T14:00:00Z' }), /calculated_end does not match/);
});

test('samtidighed: otte koebere paa samme listing giver praecis een auktion', async () => {
  const db = await database();
  const [r] = await squad(db, TEAM.A, 12);
  const l = await listing(db, r, { auto: 500_000 });
  const buyers = [];
  for (let i = 0; i < 8; i++) {
    const t = id(400 + i);
    buyers.push(t);
    await db.query('INSERT INTO teams VALUES ($1, $2)', [t, START]);
  }
  const results = await Promise.all(buyers.map(buyer => start(db, l, { buyer })));
  assert.equal(results.filter(x => x.status === 'started').length, 1);
  assert.ok(results.filter(x => x.status !== 'started').every(x => x.status === 'listing_closed'));
  assert.equal(Number((await one(db, 'SELECT count(*) AS n FROM auction_bids')).n), 1);
});

test('samtidighed: een koeber med penge til een start kan ikke starte tre', async () => {
  const db = await database();
  const riders = await squad(db, TEAM.A, 15);
  const listings = [];
  for (const r of riders.slice(0, 3)) listings.push(await listing(db, r, { auto: 600_000 }));
  const results = await Promise.all(listings.map(l => start(db, l, { expected: 600_000 })));
  assert.equal(results.filter(x => x.status === 'started').length, 1);
  assert.equal(results.filter(x => x.status === 'insufficient_funds').length, 2);
});
