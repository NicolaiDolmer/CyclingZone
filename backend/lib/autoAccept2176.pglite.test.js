// #2176 auto-accept M2 mod en rigtig Postgres (PGlite): auto-prisen, prisloggen,
// klient-vagten og RPC'erne set_listing_auto_accept_price / start_auto_accept_auction /
// auto_accept_release_rider (frigivelse under samme holdlaas, Codex P2 paa #7878).
//
// Bruger den RIGTIGE migration og den RIGTIGE reject_late_auction_bid-trigger fra
// database/. Hold og ryttere er aliaser (Hold A/B/C), ingen prod-data.
//
// Samtidighed: PGlite har een forbindelse, saa samtidige kald koeres efter
// hinanden, hvert i sin egen transaktion. Testen viser, at tjek og skrivning
// sker i samme transaktion (ingen dobbeltstart, ingen overbooking). Den aegte
// laase-test med flere forbindelser koeres mod PG17 uden for CI (se PR-body).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from './__fixtures__/autoAccept2176Schema.js';

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


const openDatabases = new Set();
afterEach(async () => {
  for (const db of openDatabases) await db.close();
  openDatabases.clear();
});

async function database({ marketGate = false, beforeMigration = null } = {}) {
  const db = new PGlite();
  openDatabases.add(db);
  await db.exec(SCHEMA);
  await db.exec(await file('2026-05-10-reject-late-auction-bid-trigger.sql'));
  // Eksisterende raekker foer migrationen: de maa ikke aendres af den.
  await db.exec(`INSERT INTO teams VALUES ('${TEAM.A}', ${START}), ('${TEAM.B}', ${START}), ('${TEAM.C}', ${START}), ('${TEAM.D}', ${START});
    INSERT INTO auctions(id, rider_id, seller_team_id, calculated_end) VALUES ('${id(700)}', '${id(799)}', '${TEAM.D}', '2026-11-01T12:00:00Z');`);
  const migration = await file(MIGRATION);
  if (beforeMigration) await beforeMigration(db);
  await db.exec(migration);
  await db.exec(migration); // idempotent
  if (marketGate) {
    await db.exec(await file('2026-11-07-6181-m3-market-commitment.sql'));
    await db.exec(`UPDATE app_config SET value='"on"' WHERE key='market_commitment_6181'`);
  }
  return db;
}

test('listing identities remain stable and new rows match their owner', async () => {
  const db = await database();
  const riders = await squad(db, TEAM.A, 12);
  const l = await listing(db, riders[0], { auto: 500000 });
  await assert.rejects(db.query('UPDATE transfer_listings SET rider_id=$2 WHERE id=$1', [l, riders[1]]), /listing_identity_immutable/);
  await assert.rejects(db.query('UPDATE transfer_listings SET seller_team_id=$2 WHERE id=$1', [l, TEAM.C]), /listing_owner_mismatch/);
  await assert.rejects(db.query('INSERT INTO transfer_listings(rider_id,seller_team_id,asking_price) VALUES ($1,$2,1)', [riders[2], TEAM.C]), /listing_owner_mismatch/);
});

test('price updates validate existing listing state', async () => {
  const r=id(89001); const l=id(89002);
  const db=await database({beforeMigration:async db=>{
    await db.query('INSERT INTO riders(id,team_id) VALUES ($1,$2)',[r,TEAM.B]);
    await db.query('INSERT INTO transfer_listings(id,rider_id,seller_team_id,asking_price) VALUES ($1,$2,$3,1)',[l,r,TEAM.A]);
  }});
  assert.equal((await setPrice(db,l,{price:500000})).status,'rider_not_with_seller');
});

test('start argument shape requires an identity-aware request', async () => {
  const db=await database();
  const [r]=await squad(db,TEAM.A,12);
  const l=await listing(db,r,{auto:500000});
  const result=await one(db,'SELECT public.start_auto_accept_auction($1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9) AS r',
    [l,TEAM.B,500000,60,END,MAX,FLOOR,'{}',NOW]);
  assert.equal(result.r.status,'rider_state_changed');
  const valueSnapshot=JSON.stringify({market_value:1000000,base_value:1000000,prize_earnings_bonus:0});
  const previous=await one(db,'SELECT public.start_auto_accept_auction($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::uuid[],$11) AS r',
    [l,TEAM.B,r,valueSnapshot,500000,60,END,MAX,FLOOR,'{}',NOW]);
  assert.equal(previous.r.status,'rider_state_changed');
  for (const signature of [
    'uuid,uuid,bigint,integer,timestamptz,integer,integer,uuid[],timestamptz',
    'uuid,uuid,uuid,jsonb,bigint,integer,timestamptz,integer,integer,uuid[],timestamptz',
    'uuid,uuid,uuid,uuid,jsonb,bigint,integer,timestamptz,integer,integer,uuid[],timestamptz',
  ]) {
    for (const role of ['anon','authenticated','service_role']) {
      const privilege=await one(db,"SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,`public.start_auto_accept_auction(${signature})`]);
      assert.equal(privilege.allowed,role==='service_role');
    }
  }
});

test('listing lifecycle permits closure and validates client writes', async () => {
  const db=await database();
  const riders=await squad(db,TEAM.A,12);
  await db.exec('SET ROLE authenticated');
  const l=await one(db,'INSERT INTO transfer_listings(rider_id,seller_team_id,asking_price) VALUES ($1,$2,1) RETURNING id',[riders[0],TEAM.A]);
  await assert.rejects(db.query('UPDATE transfer_listings SET rider_id=$2 WHERE id=$1',[l.id,riders[1]]),/listing_identity_immutable/);
  await assert.rejects(db.query('INSERT INTO transfer_listings(rider_id,seller_team_id,asking_price) VALUES ($1,$2,1)',[riders[2],TEAM.C]),/listing_owner_mismatch/);
  await db.exec('RESET ROLE');
  await db.query('UPDATE riders SET team_id=$2 WHERE id=$1',[riders[0],TEAM.B]);
  await db.query("UPDATE transfer_listings SET status='paused' WHERE id=$1",[l.id]);
  await db.query("UPDATE transfer_listings SET status='withdrawn' WHERE id=$1",[l.id]);
  await assert.rejects(db.query("UPDATE transfer_listings SET status='open' WHERE id=$1",[l.id]),/listing_owner_mismatch/);
});

test('start validation binds locked identity and current value', async () => {
  const db=await database();
  const riders=await squad(db,TEAM.A,12);
  const l=await listing(db,riders[0],{auto:500000});
  assert.equal((await start(db,l,{expectedRider:riders[1]})).status,'rider_state_changed');
  const args=await startArgs(db,l);
  await db.query('UPDATE riders SET market_value=market_value+1 WHERE id=$1',[riders[0]]);
  assert.equal((await one(db,START_SQL,args)).r.status,'rider_state_changed');
  assert.equal(Number((await one(db,'SELECT count(*) AS n FROM auction_bids')).n),0);
  assert.equal((await start(db,l)).status,'started');
});

test('start validation binds the server listing context', async () => {
  const db=await database();
  const [r]=await squad(db,TEAM.A,12);
  await squad(db,TEAM.C,FLOOR);
  const l=await listing(db,r,{auto:500000});
  const args=await startArgs(db,l);
  await db.query('UPDATE riders SET team_id=$2 WHERE id=$1',[r,TEAM.C]);
  await db.query('UPDATE transfer_listings SET seller_team_id=$2 WHERE id=$1',[l,TEAM.C]);
  assert.equal((await one(db,START_SQL,args)).r.status,'rider_state_changed');
  assert.equal(Number((await one(db,'SELECT count(*) AS n FROM auction_bids')).n),0);
});

test('start validation rechecks context at the lock boundary', async () => {
  const db=await database();
  const [r]=await squad(db,TEAM.A,12);
  const l=await listing(db,r,{auto:500000});
  await db.exec(`CREATE OR REPLACE FUNCTION public.auto_accept_lock_teams(p_a uuid,p_b uuid)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      UPDATE public.riders SET team_id='${TEAM.C}' WHERE id='${r}';
      UPDATE public.transfer_listings SET seller_team_id='${TEAM.C}' WHERE id='${l}';
      PERFORM pg_advisory_xact_lock(hashtextextended(least(p_a,p_b)::text,0));
      IF p_a IS DISTINCT FROM p_b THEN PERFORM pg_advisory_xact_lock(hashtextextended(greatest(p_a,p_b)::text,0)); END IF;
    END; $$;`);
  assert.equal((await start(db,l)).status,'rider_state_changed');
  assert.equal(Number((await one(db,'SELECT count(*) AS n FROM auction_bids')).n),0);
});

test('M2 plus M3 enabled: auto-accept start reserves money/seat and ordinary bids see it', async () => {
  const db = await database({ marketGate: true });
  const riders = await squad(db, TEAM.A, 12);
  const first = await listing(db, riders[0], { auto: 600_000 });
  const second = await listing(db, riders[1], { auto: 600_000 });
  assert.equal((await start(db, first, { expected: 600_000 })).status, 'started');
  assert.equal(Number((await one(db, 'SELECT public.team_market_commitment($1) AS n', [TEAM.B])).n), 600_000);
  assert.equal(Number((await one(db, 'SELECT public.team_seat_commitment($1) AS n', [TEAM.B])).n), 1);
  assert.equal((await start(db, second, { expected: 600_000 })).status, 'insufficient_funds');
  const auction = await one(db, `INSERT INTO auctions(rider_id,calculated_end) VALUES ($1,'${END}') RETURNING id`, [riders[2]]);
  await assert.rejects(db.query(`INSERT INTO auction_bids(auction_id,team_id,amount,bid_time) VALUES ($1,$2,500000,'${NOW}')`,
    [auction.id, TEAM.B]), /market_gate_6181:insufficient_available_balance/);
  assert.equal(Number((await one(db, 'SELECT count(*) AS n FROM auction_bids')).n), 1);
});

test('M2 plus M3 enabled: auto-started auction uses the shared atomic proxy RPC', async () => {
  const db = await database({ marketGate: true });
  const [rider] = await squad(db, TEAM.A, 12);
  const listingId = await listing(db, rider, { auto: 600_000 });
  const started = await start(db, listingId, { expected: 600_000 });
  assert.equal(started.status, 'started');
  await db.exec('SET ROLE service_role');
  const proxy = (max, opening) => db.query(
    'SELECT public.set_auction_proxy_6181($1,$2,$3,$4,$5)',
    [started.auction_id, TEAM.B, max, opening, NOW],
  );
  const state = () => one(db, `SELECT a.current_price,a.current_bidder_id,p.max_amount,
    (SELECT count(*) FROM auction_bids WHERE auction_id=a.id) AS bids,
    public.team_market_commitment($2) AS commitment
    FROM auctions a JOIN auction_proxy_bids p ON p.auction_id=a.id AND p.team_id=$2 WHERE a.id=$1`,
  [started.auction_id, TEAM.B]);
  await proxy(700_000, null);
  const before = await state();
  assert.equal(Number(before.current_price), 600_000);
  assert.equal(before.current_bidder_id, TEAM.B);
  assert.equal(Number(before.commitment), 700_000);
  await assert.rejects(proxy(900_000, 500_000), /market_gate_6181:price_changed/);
  assert.deepEqual(await state(), before);
  await proxy(800_000, 650_000);
  const after = await state();
  assert.equal(Number(after.current_price), 650_000);
  assert.equal(after.current_bidder_id, TEAM.B);
  assert.equal(Number(after.max_amount), 800_000);
  assert.equal(Number(after.commitment), 800_000);
  assert.equal(Number(after.bids), 2);
  assert.equal(Number((await one(db, 'SELECT count(*) AS n FROM auction_proxy_bids')).n), 1);
});

test('M3 seller reservation: unbid active auctions also reserve the last departure', async t => {
  for (const action of ['start', 'release', 'claim']) {
    await t.test(action, async () => {
      const db = await database({ marketGate: true });
      const riders = await squad(db, TEAM.A, FLOOR + 1);
      await db.query(`INSERT INTO auctions(rider_id,seller_team_id,calculated_end) VALUES ($1,$2,'${END}')`, [riders[0], TEAM.A]);
      const l = await listing(db, riders[1], { auto: 500_000 });
      const answer = action === 'start' ? await start(db, l)
        : action === 'release' ? await release(db, riders[1]) : await claim(db, riders[1]);
      assert.equal(answer.status, action === 'release' ? 'squad_floor' : 'seller_squad_floor');
      assert.equal(Number((await one(db, 'SELECT count(*) AS n FROM riders WHERE team_id=$1', [TEAM.A])).n), FLOOR + 1);
      assert.equal(Number((await one(db, 'SELECT count(*) AS n FROM auction_bids')).n), 0);
      // One additional rider makes the departure valid. The unbid auction's
      // rider is also at risk and must not be subtracted for a second time.
      await squad(db, TEAM.A, 1);
      const retry = action === 'start' ? await start(db, l, { atRisk: [riders[0]] })
        : action === 'release' ? await release(db, riders[1], { atRisk: [riders[0]] })
          : await claim(db, riders[1], { atRisk: [riders[0]] });
      assert.equal(retry.status, { start: 'started', release: 'released', claim: 'claimed' }[action]);
    });
  }
});

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
const START_SQL = 'SELECT public.start_auto_accept_auction($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::uuid[],$12) AS r';
async function startArgs(db, listingId, { buyer = TEAM.B, expectedRider, expectedSeller, expectedValue, expected = 500_000, minutes = 60, end = END, max = MAX, floor = FLOOR, atRisk = [], now = NOW } = {}) {
  const view = await one(db, 'SELECT l.rider_id,l.seller_team_id,r.market_value,r.base_value,r.prize_earnings_bonus FROM transfer_listings l LEFT JOIN riders r ON r.id=l.rider_id WHERE l.id=$1', [listingId]);
  const value = key => view?.[key] == null ? null : Number(view[key]);
  const snapshot = expectedValue ?? { market_value: value('market_value'), base_value: value('base_value'), prize_earnings_bonus: value('prize_earnings_bonus') };
  return [listingId,buyer,expectedRider ?? view?.rider_id ?? id(0),expectedSeller ?? view?.seller_team_id ?? id(0),JSON.stringify(snapshot),expected,minutes,end,max,floor,`{${atRisk.join(',')}}`,now];
}
async function start(db, listingId, options) {
  return (await one(db, START_SQL, await startArgs(db, listingId, options))).r;
}
async function release(db, rider, { team = TEAM.A, floor = FLOOR, atRisk = [] } = {}) {
  return (await one(db, 'SELECT public.auto_accept_release_rider($1,$2,$3,$4::uuid[]) AS r',
    [rider, team, floor, `{${atRisk.join(',')}}`])).r;
}

async function claim(db, rider, { buyer = TEAM.B, defer = false, patch = {}, floor = FLOOR, atRisk = [], max = MAX } = {}) {
  return (await one(db, 'SELECT public.auto_accept_claim_transfer($1,$2,$3,$4,$5,$6::jsonb,$7,$8::uuid[],$9) AS r',
    [rider, TEAM.A, buyer, defer, NOW, JSON.stringify(patch), floor, `{${atRisk.join(',')}}`, max])).r;
}

test('transfer-claim: immediate and parked ownership preserve inheritance, patch shape and role grants', async () => {
  const db = await database();
  const [direct, parked, graduate] = await squad(db, TEAM.A, 12);
  assert.equal((await claim(db, direct)).status, 'claimed');
  assert.deepEqual(await one(db, 'SELECT team_id, pending_team_id, salary, contract_length, contract_end_season FROM riders WHERE id=$1', [direct]),
    { team_id: TEAM.B, pending_team_id: null, salary: 1000, contract_length: 2, contract_end_season: 3 });
  assert.equal((await claim(db, parked, { defer: true, patch: { salary: 2500, contract_length: 4, contract_end_season: 9 } })).status, 'claimed');
  const row = await one(db, 'SELECT team_id, pending_team_id, salary, contract_length, contract_end_season, updated_at FROM riders WHERE id=$1', [parked]);
  assert.equal(row.team_id, TEAM.A);
  assert.equal(row.pending_team_id, TEAM.B);
  assert.equal(row.salary, 2500);
  assert.equal(row.contract_length, 4);
  assert.equal(row.contract_end_season, 9);
  assert.equal(row.updated_at.toISOString(), new Date(NOW).toISOString());
  await db.query("UPDATE riders SET is_academy=true, squad='junior' WHERE id=$1", [graduate]);
  assert.equal((await claim(db, graduate, { patch: { is_academy: false, squad: 'senior', salary: null } })).status, 'claimed');
  assert.deepEqual(await one(db, 'SELECT is_academy,squad,salary FROM riders WHERE id=$1', [graduate]),
    { is_academy: false, squad: 'senior', salary: null });
  await assert.rejects(claim(db, id(555), { patch: { team_id: TEAM.C } }), /invalid patch/);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const privilege = await one(db, `SELECT has_function_privilege($1,
      'public.auto_accept_claim_transfer(uuid,uuid,uuid,boolean,timestamptz,jsonb,integer,uuid[],integer)', 'EXECUTE') AS allowed`, [role]);
    assert.equal(privilege.allowed, role === 'service_role');
    const helperPrivilege = await one(db, `SELECT has_function_privilege($1,
      'public.auto_accept_seller_outgoing_rider_ids(uuid,uuid)', 'EXECUTE') AS allowed`, [role]);
    assert.equal(helperPrivilege.allowed, role === 'service_role');
  }
});

test('transfer-claim and auto-accept: both orderings protect seller floor, same rider and buyer seat', async () => {
  for (const defer of [false, true]) {
    for (const first of ['claim', 'start']) {
      const db = await database();
      const riders = await squad(db, TEAM.A, FLOOR + 1);
      const l = await listing(db, riders[0], { auto: 500_000 });
      let started; let claimed;
      if (first === 'claim') {
        claimed = await claim(db, riders[1], { buyer: TEAM.C, defer });
        started = await start(db, l);
      } else {
        started = await start(db, l);
        claimed = await claim(db, riders[1], { buyer: TEAM.C, defer });
      }
      assert.equal(Number(started.status === 'started') + Number(claimed.status === 'claimed'), 1);
      assert.equal((first === 'claim' ? started : claimed).status, 'seller_squad_floor');
    }
  }
  const db = await database();
  const riders = await squad(db, TEAM.A, 14);
  const l = await listing(db, riders[0], { auto: 500_000 });
  assert.equal((await start(db, l)).status, 'started');
  assert.equal((await claim(db, riders[0])).status, 'rider_on_auction');
  const l2 = await listing(db, riders[1], { auto: 500_000 });
  assert.equal((await claim(db, riders[1], { defer: true })).status, 'claimed');
  assert.equal((await start(db, l2)).status, 'rider_pending_transfer');
  await squad(db, TEAM.C, MAX - 1);
  const l3 = await listing(db, riders[2], { auto: 500_000 });
  assert.equal((await start(db, l3, { buyer: TEAM.C })).status, 'started');
  assert.deepEqual(await claim(db, riders[3], { buyer: TEAM.C }), { status: 'squad_full', max_riders: MAX });
});
// Advisory-laase holdt af den aabne transaktion (holdlaasene).
const advisoryLocks = async (tx) => (await tx.query(
  "SELECT (classid::text::numeric * 4294967296 + objid::text::numeric)::text AS k FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() ORDER BY 1"))
  .rows.map(r => String(r.k));
const teamLockKey = async (db, team) => {
  const k = BigInt((await one(db, 'SELECT hashtextextended($1::text, 0) AS k', [team])).k);
  return String(k < 0n ? k + (1n << 64n) : k);
};
const log = async (db, listingId) => (await db.query(
  'SELECT old_asking_price, new_asking_price, old_auto_accept_price, new_auto_accept_price, actor_user_id, source FROM transfer_listing_price_log WHERE listing_id = $1 ORDER BY changed_at, id', [listingId]))
  .rows.map(r => ({ ...r,
    old_asking_price: r.old_asking_price == null ? null : Number(r.old_asking_price),
    new_asking_price: Number(r.new_asking_price),
    old_auto_accept_price: r.old_auto_accept_price == null ? null : Number(r.old_auto_accept_price),
    new_auto_accept_price: r.new_auto_accept_price == null ? null : Number(r.new_auto_accept_price) }));

test('migrationen er additiv: eksisterende auktioner bliver standard, listings faar ingen auto-pris', async () => {
  const db = await database();
  assert.equal((await one(db, "SELECT value FROM app_config WHERE key='auto_accept_enabled'")).value, 'off');
  await db.exec(`UPDATE app_config SET value='"on"' WHERE key='auto_accept_enabled'`);
  await db.exec(await file(MIGRATION));
  assert.equal((await one(db, "SELECT value FROM app_config WHERE key='auto_accept_enabled'")).value, 'on', 'reapply preserves an existing operator choice');
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

// ── Frigivelse under samme holdlaas (Codex P2 paa #7878) ─────────────────────

test('frigivelse: rytteren forlader holdet med nulstillet kontrakt; status-vagterne svarer som ruten', async () => {
  const db = await database();
  const [a, b, c] = await squad(db, TEAM.A, 12);
  assert.deepEqual(await release(db, a), { status: 'released', rider_id: a });
  assert.deepEqual(await one(db, 'SELECT team_id, pending_team_id, salary, contract_length, contract_end_season, acquired_at FROM riders WHERE id = $1', [a]),
    { team_id: null, pending_team_id: null, salary: null, contract_length: null, contract_end_season: null, acquired_at: null });

  // Ikke laengere holdets, eller solgt og venter paa holdskifte (#6181).
  assert.deepEqual(await release(db, a), { status: 'rider_state_changed' });
  assert.deepEqual(await release(db, b, { team: TEAM.C }), { status: 'rider_state_changed' });
  assert.deepEqual(await release(db, id(5556)), { status: 'rider_state_changed' });
  await db.query('UPDATE riders SET pending_team_id = $2 WHERE id = $1', [b, TEAM.C]);
  assert.deepEqual(await release(db, b), { status: 'rider_state_changed' });
  assert.equal((await one(db, 'SELECT team_id FROM riders WHERE id = $1', [b])).team_id, TEAM.A);

  await db.query(`INSERT INTO auctions(rider_id, calculated_end) VALUES ($1, '${END}')`, [c]);
  assert.deepEqual(await release(db, c), { status: 'rider_on_auction' });
  await assert.rejects(release(db, c, { floor: null }), /missing argument/);
});

test('frigivelse: gulvet taeller holdets auktioner med en anden byder og risiko-rytterne een gang', async () => {
  const db = await database();
  const riders = await squad(db, TEAM.A, 10);
  // Auktion uden byder eller med saelger selv som byder taeller ikke som udgaaende.
  await db.query(`INSERT INTO auctions(rider_id, seller_team_id, calculated_end) VALUES ($1, '${TEAM.A}', '${END}')`, [riders[2]]);
  await db.query(`INSERT INTO auctions(rider_id, seller_team_id, current_price, current_bidder_id, calculated_end) VALUES ($1, '${TEAM.A}', 1000, '${TEAM.C}', '${END}')`, [riders[1]]);
  // Risiko-rytteren, der allerede er paa auktion, taelles kun een gang.
  assert.deepEqual(await release(db, riders[0], { atRisk: [riders[1]], floor: 9 }), { status: 'squad_floor', min_riders: 9 });
  assert.deepEqual(await release(db, riders[0], { atRisk: [riders[3]] }), { status: 'squad_floor', min_riders: FLOOR });
  assert.equal((await one(db, 'SELECT team_id FROM riders WHERE id = $1', [riders[0]])).team_id, TEAM.A);
  assert.equal((await release(db, riders[0], { atRisk: [riders[1]] })).status, 'released');
});

test('frigivelse og auto-accept-start tager samme holdlaas', async () => {
  const db = await database();
  const riders = await squad(db, TEAM.A, 12);
  const l = await listing(db, riders[0], { auto: 500_000 });
  const sellerKey = await teamLockKey(db, TEAM.A);

  const releaseLocks = await db.transaction(async tx => {
    await tx.query('SELECT public.auto_accept_release_rider($1,$2,$3,$4::uuid[])', [riders[1], TEAM.A, FLOOR, '{}']);
    return advisoryLocks(tx);
  });
  const startLocks = await db.transaction(async tx => {
    await tx.query(START_SQL, await startArgs(tx, l));
    return advisoryLocks(tx);
  });
  assert.deepEqual(releaseLocks, [sellerKey]);
  assert.ok(startLocks.includes(sellerKey), 'start-RPC tager saelgers holdlaas');
});

// Codex-scenariet: Hold A har praecis een rytter over gulvet. En frigivelse og en
// auto-accept-start paa en ANDEN af holdets ryttere kan ikke begge lykkes, uanset
// raekkefoelge. Foer rettelsen laeste ruten gulvet i eet kald og skrev i et andet,
// saa en start imellem blev overset (et forældet forhaandstjek).
test('samtidighed: frigivelse og auto-accept-start kan ikke begge passere saelgers gulv', async () => {
  for (const order of ['start-foerst', 'frigivelse-foerst', 'samtidig']) {
    const db = await database();
    const riders = await squad(db, TEAM.A, FLOOR + 1);
    const l = await listing(db, riders[0], { auto: 500_000 });

    let started; let released;
    if (order === 'start-foerst') {
      started = await start(db, l);
      // Rutens forhaandstjek (uden laas) saa intet udgaaende foer starten; RPC'en
      // regner gulvet igen under laasen.
      released = await release(db, riders[1]);
    } else if (order === 'frigivelse-foerst') {
      released = await release(db, riders[1]);
      started = await start(db, l);
    } else {
      [started, released] = await Promise.all([start(db, l), release(db, riders[1])]);
    }

    const ok = [started.status === 'started', released.status === 'released'].filter(Boolean).length;
    assert.equal(ok, 1, `${order}: praecis een lykkes (start=${started.status}, frigivelse=${released.status})`);
    if (started.status !== 'started') assert.equal(started.status, 'seller_squad_floor', order);
    if (released.status !== 'released') assert.deepEqual(released, { status: 'squad_floor', min_riders: FLOOR }, order);

    // Holdet staar aldrig under gulvet, naar aktive auktioner med byder taelles som udgaaende.
    const left = Number((await one(db, `SELECT count(*) AS n FROM riders x WHERE x.team_id = $1
      AND NOT EXISTS (SELECT 1 FROM auctions a WHERE a.rider_id = x.id AND a.status IN ('active','extended') AND a.current_bidder_id IS NOT NULL)`, [TEAM.A])).n);
    assert.equal(left, FLOOR, order);
  }
});
