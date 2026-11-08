// #6181 + #2176 pengelaas PR 5 (M3): holdets markedsforpligtelse og den atomiske
// bud-gate mod en rigtig Postgres (PGlite), plus backend-oversaettelsen af gatens
// fejl. Bruger den RIGTIGE M3-migration og den RIGTIGE reject_late_auction_bid-
// trigger fra database/. Hold og ryttere er aliaser (Hold A/B/C), ingen prod-data.
//
// Den aegte samtidigheds-test (8 samtidige bud mod penge til 1) kraever en lokal
// Postgres og koerer kun, naar MARKET_GATE_PG_BIN peger paa dens bin-mappe; PGlite
// har kun een forbindelse og kan ikke vise et kapploeb.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

import { computeWorstCaseCommitment } from './auctionRules.ts';
import { MAX_SQUAD_SIZE } from './marketUtils.js';
import {
  applyMarketSeatCounts,
  applySellerOutgoingAuctions6181,
  applyTransferMarketCommitment6181,
  auctionStartCommitmentResponse6181,
  getAuctionStartCommitmentIssue,
  isMarketCommitmentValueOn,
  isMarketCommitment6181On,
  marketGateCode,
  marketGateResponse6181,
} from './marketCommitment6181.js';
import { clearFlagStageCache } from './featureStage.js';

const file = name => readFile(new URL(`../../database/${name}`, import.meta.url), 'utf8');
const MIGRATION = '2026-11-07-6181-m3-market-commitment.sql';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const TEAM = { A: id(1), B: id(2), C: id(3) };
const FUTURE = '2099-01-01T12:00:00Z';
const FIXED_BID_TIME = '2026-11-08T15:00:00Z';

// Minimalt udsnit af prod-skemaet: de kolonner M3 laeser og skriver.
const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE app_config (key text PRIMARY KEY, value jsonb NOT NULL, description text);
CREATE TABLE teams (id uuid PRIMARY KEY, balance bigint NOT NULL, division int DEFAULT 3);
CREATE TABLE riders (id uuid PRIMARY KEY, team_id uuid, pending_team_id uuid,
  squad text NOT NULL DEFAULT 'senior', is_academy boolean NOT NULL DEFAULT false, is_retired boolean NOT NULL DEFAULT false);
CREATE TABLE auctions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rider_id uuid NOT NULL, seller_team_id uuid,
  starting_price bigint, current_price bigint NOT NULL, current_bidder_id uuid REFERENCES teams(id),
  status text DEFAULT 'active' CHECK (status IN ('active','extended','completed','cancelled')),
  calculated_end timestamptz NOT NULL DEFAULT '${FUTURE}', is_youth boolean DEFAULT false);
CREATE UNIQUE INDEX uniq_auctions_one_active_per_rider ON auctions(rider_id) WHERE status IN ('active','extended');
CREATE TABLE auction_bids (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auction_id uuid NOT NULL REFERENCES auctions(id),
  team_id uuid NOT NULL REFERENCES teams(id), amount bigint NOT NULL, bid_time timestamptz NOT NULL DEFAULT '${FIXED_BID_TIME}',
  triggered_extension boolean DEFAULT false, is_proxy boolean DEFAULT false);
CREATE TABLE auction_proxy_bids (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auction_id uuid NOT NULL REFERENCES auctions(id),
  team_id uuid NOT NULL REFERENCES teams(id), max_amount bigint NOT NULL, created_at timestamptz DEFAULT '${FIXED_BID_TIME}',
  UNIQUE (auction_id, team_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON teams,riders,auctions,auction_bids,auction_proxy_bids TO service_role;
`;

const openDatabases = new Set();
afterEach(async()=>{for(const db of openDatabases)await db.close();openDatabases.clear();});
async function database({ flag = null } = {}) {
  const db = new PGlite();
  openDatabases.add(db);
  await db.exec(SCHEMA);
  await db.exec(await file('2026-05-10-reject-late-auction-bid-trigger.sql'));
  const migration = await file(MIGRATION);
  await db.exec(migration);
  await db.exec(migration); // idempotent
  if (flag !== null) await setFlag(db, flag);
  await db.exec(`INSERT INTO teams(id, balance) VALUES ('${TEAM.A}', 100), ('${TEAM.B}', 1000), ('${TEAM.C}', 1000);`);
  return db;
}
const setFlag = (db, value) => db.query(`UPDATE app_config SET value = $1::jsonb WHERE key = 'market_commitment_6181'`, [JSON.stringify(value)]);
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
let riderSeq = 1000;
async function rider(db, { team = null, pending = null, squad = 'senior', academy = false, retired = false } = {}) {
  const r = id(riderSeq++);
  await db.query('INSERT INTO riders(id, team_id, pending_team_id, squad, is_academy, is_retired) VALUES ($1,$2,$3,$4,$5,$6)',
    [r, team, pending, squad, academy, retired]);
  return r;
}
async function auction(db, { price = 10, bidder = null, youth = false, riderTeam = null, status = 'active' } = {}) {
  const r = await rider(db, { team: riderTeam });
  return (await one(db, `INSERT INTO auctions(rider_id, current_price, current_bidder_id, is_youth, status)
    VALUES ($1,$2,$3,$4,$5) RETURNING id`, [r, price, bidder, youth, status])).id;
}
const bid = (db, auctionId, team, amount, isProxy = false) =>
  db.query('INSERT INTO auction_bids(auction_id, team_id, amount, is_proxy) VALUES ($1,$2,$3,$4)', [auctionId, team, amount, isProxy]);
const proxy = (db, auctionId, team, max) => db.query(`INSERT INTO auction_proxy_bids(auction_id, team_id, max_amount) VALUES ($1,$2,$3)
  ON CONFLICT (auction_id, team_id) DO UPDATE SET max_amount = EXCLUDED.max_amount`, [auctionId, team, max]);
const leader = (db, a) => one(db, 'SELECT current_price::int AS price, current_bidder_id AS bidder FROM auctions WHERE id = $1', [a]);
const gateError = async (promise) => {
  try { await promise; } catch (e) { return marketGateCode({ code: e.code, message: e.message }) ?? `other:${e.message}`; }
  return null;
};

test('bid eligibility distinguishes initial, current and proxy leadership',async()=>{
  const db=await database({flag:'on'});
  const a=await auction(db,{price:10});
  assert.equal(await gateError(bid(db,a,TEAM.B,10)),null);
  assert.equal(await gateError(bid(db,a,TEAM.C,10)),'price_changed');
  assert.deepEqual(await leader(db,a),{price:10,bidder:TEAM.B});
  assert.equal(await gateError(bid(db,a,TEAM.B,10)),null);
  assert.equal(await gateError(bid(db,a,TEAM.C,10,true)),null);
});

test('bid gate validates locked auction state independently',async()=>{
  const db=await database({flag:'on'});
  const a=await auction(db);
  await db.exec(`CREATE OR REPLACE FUNCTION public.reject_late_auction_bid() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN UPDATE public.auctions SET status='completed' WHERE id=NEW.auction_id; RETURN NEW; END; $$;`);
  await assert.rejects(bid(db,a,TEAM.B,20),error=>error.code==='P0001' && error.message==='auction_not_active');
  assert.equal(Number((await one(db,'SELECT count(*) AS n FROM auction_bids')).n),0);
});

test('proxy program and opening bid form one SQL operation',async()=>{
  const db=await database({flag:'on'});
  const a=await auction(db,{price:50,bidder:TEAM.C});
  const write=(max,opening)=>db.query('SELECT public.set_auction_proxy_6181($1,$2,$3,$4,$5)',[a,TEAM.B,max,opening,FIXED_BID_TIME]);
  assert.equal(await gateError(write(100,40)),'price_changed');
  assert.equal(Number((await one(db,'SELECT count(*) AS n FROM auction_proxy_bids')).n),0);
  await proxy(db,a,TEAM.B,70);
  assert.equal(await gateError(write(100,40)),'price_changed');
  assert.equal(Number((await one(db,'SELECT max_amount FROM auction_proxy_bids WHERE auction_id=$1 AND team_id=$2',[a,TEAM.B])).max_amount),70);
  assert.equal(Number((await one(db,'SELECT count(*) AS n FROM auction_bids')).n),0);
  await write(100,51);
  assert.deepEqual(await leader(db,a),{price:51,bidder:TEAM.B});
  assert.equal(Number((await one(db,'SELECT max_amount FROM auction_proxy_bids WHERE auction_id=$1 AND team_id=$2',[a,TEAM.B])).max_amount),100);
  for(const role of ['anon','authenticated','service_role']){
    const row=await one(db,"SELECT has_function_privilege($1,'public.set_auction_proxy_6181(uuid,uuid,bigint,integer,timestamptz)','EXECUTE') AS allowed",[role]);
    assert.equal(row.allowed,role==='service_role');
  }
  await db.exec('SET ROLE service_role');
  await write(120,null);
  await db.exec('RESET ROLE');
  assert.equal(Number((await one(db,'SELECT max_amount FROM auction_proxy_bids WHERE auction_id=$1 AND team_id=$2',[a,TEAM.B])).max_amount),120);
  assert.equal(Number((await one(db,'SELECT count(*) AS n FROM auction_bids')).n),1);
  for(let i=0;i<MAX_SQUAD_SIZE-1;i++)await rider(db,{team:TEAM.B});
  const b=await auction(db,{price:50,bidder:TEAM.C});
  assert.equal(await gateError(db.query('SELECT public.set_auction_proxy_6181($1,$2,$3,$4,$5)',
    [b,TEAM.B,100,51,FIXED_BID_TIME])),'squad_full');
  assert.equal(Number((await one(db,'SELECT count(*) AS n FROM auction_proxy_bids WHERE auction_id=$1 AND team_id=$2',[b,TEAM.B])).n),0);
  assert.equal(Number((await one(db,'SELECT public.team_market_commitment($1) AS n',[TEAM.B])).n),120);
});

test('kontakten seedes slukket; en ejer-flyttet vaerdi overskrives ikke ved gen-apply', async () => {
  const db = await database();
  assert.deepEqual((await one(db, `SELECT value FROM app_config WHERE key = 'market_commitment_6181'`)).value, 'off');
  assert.equal((await one(db, 'SELECT public.market_commitment_6181_on() AS on')).on, false);
  await setFlag(db, 'on');
  await db.exec(await file(MIGRATION));
  assert.equal((await one(db, 'SELECT public.market_commitment_6181_on() AS on')).on, true);
  for (const v of ['beta', 'off', false]) {
    await setFlag(db, v);
    assert.equal((await one(db, 'SELECT public.market_commitment_6181_on() AS on')).on, false, `${v} taender ikke`);
  }
  await setFlag(db, true);
  assert.equal((await one(db, 'SELECT public.market_commitment_6181_on() AS on')).on, true);
});

test('slukket: triggerne roerer intet (overbooking som i dag, ingen foerer-opdatering)', async () => {
  const db = await database();
  const auctions = [];
  for (let i = 0; i < 8; i++) auctions.push(await auction(db));
  for (const a of auctions) assert.equal(await gateError(bid(db, a, TEAM.A, 60)), null);
  // Uden kontakten saetter triggeren ikke foereren; det goer kalderen som i dag.
  for (const a of auctions) assert.deepEqual(await leader(db, a), { price: 10, bidder: null });
  assert.equal(await gateError(proxy(db, auctions[0], TEAM.A, 5000)), null);
  assert.equal(await gateError(db.query(`INSERT INTO auctions(rider_id, current_price, current_bidder_id) VALUES ($1, 5000, $2)`,
    [await rider(db), TEAM.A])), null);
  // Et for sent bud afvises stadig af sin egen trigger.
  const late = await auction(db);
  await db.query(`UPDATE auctions SET calculated_end = $2::timestamptz - interval '1 minute' WHERE id = $1`, [late,FIXED_BID_TIME]);
  assert.match(await gateError(bid(db, late, TEAM.A, 20)), /auction_expired_at_insert/);
});

test('taendt: 8 bud mod penge til 1 giver praecis een foering', async () => {
  const db = await database({ flag: 'on' });
  const auctions = [];
  for (let i = 0; i < 8; i++) auctions.push(await auction(db));
  const results = [];
  for (const a of auctions) results.push(await gateError(bid(db, a, TEAM.A, 60)));
  assert.equal(results.filter(r => r === null).length, 1);
  assert.deepEqual(results.filter(r => r !== null), Array(7).fill('insufficient_available_balance'));
  // Buddet tog foeringen i samme transaktion.
  assert.deepEqual(await leader(db, auctions[0]), { price: 60, bidder: TEAM.A });
  assert.equal(Number((await one(db, 'SELECT public.team_market_commitment($1) AS c', [TEAM.A])).c), 60);
  // Et forsvarsbud paa egen foering maa haeve, saa laenge pengene rakker.
  assert.equal(await gateError(bid(db, auctions[0], TEAM.A, 100)), null);
  assert.equal(await gateError(bid(db, auctions[0], TEAM.A, 101)), 'insufficient_available_balance');
});

test('taendt: prisen kan ikke falde, et autobud paa samme auktion taeller med', async () => {
  const db = await database({ flag: 'on' });
  const a = await auction(db, { price: 10 });
  assert.equal(await gateError(bid(db, a, TEAM.B, 50)), null);
  assert.equal(await gateError(bid(db, a, TEAM.C, 40)), 'price_changed');
  // Tie-break: et autobud paa praecis prisen tager foeringen tilbage.
  assert.equal(await gateError(bid(db, a, TEAM.C, 50, true)), null);
  assert.deepEqual(await leader(db, a), { price: 50, bidder: TEAM.C });

  // Holdets autobud paa denne auktion indgaar: buddet + loftet maa ikke overstige saldoen.
  const b = await auction(db, { price: 10 });
  const c = await auction(db, { price: 10 });
  await proxy(db, b, TEAM.A, 90);
  assert.equal(await gateError(bid(db, c, TEAM.A, 20)), 'insufficient_available_balance');
  assert.equal(await gateError(bid(db, b, TEAM.A, 20)), null, 'autobuddets loft er allerede talt med');
});

test('taendt: plads, ungdomsauktion og forsvarsbud', async () => {
  const db = await database({ flag: 'on' });
  await db.query('UPDATE teams SET balance = 100000 WHERE id = $1', [TEAM.B]);
  for (let i = 0; i < MAX_SQUAD_SIZE - 1; i++) await rider(db, { team: TEAM.B });
  // Ryttere der ikke optager en senior-plads.
  await rider(db, { team: TEAM.B, academy: true, squad: 'u23' });
  await rider(db, { team: TEAM.B, retired: true });
  await rider(db, { team: TEAM.B, pending: TEAM.C }); // paa vej vaek
  assert.equal((await one(db, 'SELECT public.team_seat_commitment($1) AS s', [TEAM.B])).s, MAX_SQUAD_SIZE - 1);

  const first = await auction(db);
  const second = await auction(db);
  assert.equal(await gateError(bid(db, first, TEAM.B, 20)), null);
  assert.equal((await one(db, 'SELECT public.team_seat_commitment($1) AS s', [TEAM.B])).s, MAX_SQUAD_SIZE);
  assert.equal(await gateError(bid(db, second, TEAM.B, 20)), 'squad_full');
  assert.equal(await gateError(bid(db, first, TEAM.B, 30)), null, 'forsvarsbud blokeres aldrig paa plads');
  const youth = await auction(db, { youth: true });
  assert.equal(await gateError(bid(db, youth, TEAM.B, 20)), null, 'ungdom kan gaa til akademiet; ruten tjekker');
  // En rytter paa vej IND optager en plads.
  await rider(db, { pending: TEAM.B });
  assert.equal((await one(db, 'SELECT public.team_seat_commitment($1) AS s', [TEAM.B])).s, MAX_SQUAD_SIZE + 2);
});

test('taendt: autobud-loft og startbyder gates paa penge', async () => {
  const db = await database({ flag: 'on' });
  const a = await auction(db, { price: 10 });
  const b = await auction(db, { price: 10 });
  assert.equal(await gateError(proxy(db, a, TEAM.A, 80)), null);
  assert.equal(await gateError(proxy(db, b, TEAM.A, 30)), 'insufficient_available_balance');
  assert.equal(await gateError(proxy(db, a, TEAM.A, 100)), null, 'haevet loft inden for saldoen');
  assert.equal(await gateError(proxy(db, a, TEAM.A, 101)), 'insufficient_available_balance');
  assert.equal(await gateError(db.query('UPDATE auction_proxy_bids SET max_amount = 5 WHERE auction_id = $1', [a])), null, 'saenket loft frigiver kun');

  const r = await rider(db);
  assert.equal(await gateError(db.query('INSERT INTO auctions(rider_id, current_price, current_bidder_id) VALUES ($1, 96, $2)', [r, TEAM.A])),
    'insufficient_available_balance');
  assert.equal(await gateError(db.query('INSERT INTO auctions(rider_id, current_price, current_bidder_id) VALUES ($1, 95, $2)', [r, TEAM.A])), null);
  // Auktioner uden startbyder (egen rytter, ungdomsmarked) roeres ikke.
  assert.equal(await gateError(db.query('INSERT INTO auctions(rider_id, current_price) VALUES ($1, 999999)', [await rider(db)])), null);
});

test('team_market_commitment = computeWorstCaseCommitment (auctionRules.ts) i blandede tilfaelde', async () => {
  const db = await database();
  const t = TEAM.B;
  const scenarios = [
    { price: 100, lead: true, proxy: null },
    { price: 100, lead: true, proxy: 250 },
    { price: 300, lead: true, proxy: 120 }, // stale autobud under prisen
    { price: 80, lead: false, proxy: 200 },
    { price: 80, lead: false, proxy: null },
    { price: 500, lead: true, proxy: null, status: 'completed' },
    { price: 70, lead: false, proxy: 90, status: 'cancelled' },
    { price: 60, lead: true, proxy: 75, status: 'extended' },
  ];
  const leadingAuctions = [];
  const allMyProxies = [];
  for (const s of scenarios) {
    const a = await auction(db, { price: s.price, bidder: s.lead ? t : TEAM.C, status: s.status ?? 'active' });
    if (s.proxy != null) await proxy(db, a, t, s.proxy);
    const active = ['active', 'extended'].includes(s.status ?? 'active');
    if (active && s.lead) leadingAuctions.push({ id: a, current_price: s.price });
    if (active && s.proxy != null) allMyProxies.push({ auction_id: a, max_amount: s.proxy });
  }
  const sql = Number((await one(db, 'SELECT public.team_market_commitment($1) AS c', [t])).c);
  assert.equal(sql, computeWorstCaseCommitment({ leadingAuctions, allMyProxies }));
  const skip = leadingAuctions[1].id;
  const sqlSkip = Number((await one(db, 'SELECT public.team_market_commitment($1, $2) AS c', [t, skip])).c);
  assert.equal(sqlSkip, computeWorstCaseCommitment({
    leadingAuctions: leadingAuctions.filter(r => r.id !== skip),
    allMyProxies: allMyProxies.filter(p => p.auction_id !== skip),
  }));
});

test('market_squad_max = MAX_SQUAD_SIZE (marketUtils.js)', async () => {
  const db = await database();
  assert.equal((await one(db, 'SELECT public.market_squad_max() AS m')).m, MAX_SQUAD_SIZE);
});

test('team_outgoing_auction_count: egne senior-ryttere paa aktiv auktion', async () => {
  const db = await database();
  const own = await auction(db, { riderTeam: TEAM.A });
  await auction(db, { riderTeam: TEAM.A });
  await auction(db, { riderTeam: TEAM.A, status: 'completed' });
  await auction(db, { riderTeam: TEAM.B });
  const academy = await rider(db, { team: TEAM.A, academy: true, squad: 'u23' });
  await db.query('INSERT INTO auctions(rider_id, current_price) VALUES ($1, 5)', [academy]);
  const leaving = await rider(db, { team: TEAM.A, pending: TEAM.C });
  await db.query('INSERT INTO auctions(rider_id, current_price) VALUES ($1, 5)', [leaving]);
  assert.equal((await one(db, 'SELECT public.team_outgoing_auction_count($1) AS n', [TEAM.A])).n, 2);
  const ownRider = (await one(db, 'SELECT rider_id FROM auctions WHERE id = $1', [own])).rider_id;
  assert.equal((await one(db, 'SELECT public.team_outgoing_auction_count($1, $2) AS n', [TEAM.A, ownRider])).n, 1);
  assert.deepEqual((await one(db, 'SELECT public.team_outgoing_auction_rider_ids($1, $2) AS ids', [TEAM.A, ownRider])).ids.length, 1);
  assert.equal((await one(db, 'SELECT public.team_outgoing_auction_rider_ids($1) AS ids', [TEAM.A])).ids.length, 2);
});

test('rettigheder: kun service_role kan kalde funktionerne', async () => {
  const db = await database();
  const rows = (await db.query(`SELECT p.proname,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
    FROM pg_proc p WHERE p.proname IN ('team_market_commitment','team_seat_commitment','team_outgoing_auction_count','team_outgoing_auction_rider_ids',
      'market_bid_issue_6181','market_commitment_6181_on','market_squad_max') ORDER BY 1`)).rows;
  assert.equal(rows.length, 7);
  for (const row of rows) assert.deepEqual([row.anon, row.auth, row.svc], [false, false, true], row.proname);
});

// ── Backend-siden ────────────────────────────────────────────────────────────

// Lille fake-klient: app_config + de opslag helperne laver.
function fakeSupabase({ flag = 'off', flagError = null, flagThrows = false, leading = 0, outgoing = 0, commitment = 0, balance = 0, riders = [], calls = [] } = {}) {
  const builder = (table) => {
    const q = {
      _table: table,
      select() { return q; }, eq() { return q; }, in() { return q; }, lt() { return q; }, update() { return q; },
      maybeSingle: async () => {
        calls.push(table);
        if (table === 'app_config') {
          if (flagThrows) throw new Error('flag transport unavailable');
          return { data: flagError ? null : { value: flag }, error: flagError };
        }
        if (table === 'teams') return { data: { balance }, error: null };
        return { data: null, error: null };
      },
      then(resolve) {
        calls.push(table);
        if (table === 'auctions') return resolve({ count: leading, data: [], error: null });
        if (table === 'auction_proxy_bids') return resolve({ data: [], error: null });
        if (table === 'riders') return resolve({ data: riders, error: null });
        return resolve({ data: [], error: null });
      },
    };
    return q;
  };
  return {
    from: (t) => builder(t),
    rpc: async (name) => {
      calls.push(`rpc:${name}`);
      if (name === 'team_outgoing_auction_rider_ids') return { data: Array.from({ length: outgoing }, (_, i) => id(500 + i)), error: null };
      if (name === 'team_market_commitment') return { data: commitment, error: null };
      return { data: null, error: null };
    },
  };
}

test('kontakt-vaerdier: kun "on" og true taender (beta er slukket her)', () => {
  assert.equal(isMarketCommitmentValueOn('on'), true);
  assert.equal(isMarketCommitmentValueOn(true), true);
  for (const v of ['beta', 'off', false, null, undefined, 'ON']) assert.equal(isMarketCommitmentValueOn(v), false);
});

test('kontakt-opslagsfejl stopper markedsreglerne uden at mutere tilstanden eller vaelge legacy', async () => {
  for (const failure of [{ flagError: { message: 'flag query unavailable' } }, { flagThrows: true }]) {
    const calls = [];
    const supabase = fakeSupabase({ ...failure, calls, leading: 3, outgoing: 2 });
    const buyerState = { id: TEAM.B, future_count: 28 };
    const sellerState = { id: TEAM.A, future_count: 9 };
    await assert.rejects(() => isMarketCommitment6181On(supabase), /flag|marketCommitment/i);
    await assert.rejects(() => applyTransferMarketCommitment6181(supabase, { buyerState, sellerState }), /flag|marketCommitment/i);
    await assert.rejects(() => applySellerOutgoingAuctions6181(supabase, sellerState), /flag|marketCommitment/i);
    await assert.rejects(() => auctionStartCommitmentResponse6181(supabase, { teamId: TEAM.B, teamState: buyerState, price: 1 }), /flag|marketCommitment/i);
    assert.deepEqual(buyerState, { id: TEAM.B, future_count: 28 });
    assert.deepEqual(sellerState, { id: TEAM.A, future_count: 9 });
    assert.deepEqual([...new Set(calls)], ['app_config']);
  }
});

test('bekraeftet manglende eller slukket kontakt beholder legacy-stien', async () => {
  for (const flag of [null, undefined, 'off', false, 'beta']) {
    assert.equal(await isMarketCommitment6181On(fakeSupabase({ flag })), false);
  }
});

test('marketGateCode genkender kun M3-gatens fejl', () => {
  assert.equal(marketGateCode({ code: 'P0001', message: 'market_gate_6181:squad_full' }), 'squad_full');
  assert.equal(marketGateCode({ code: 'P0001', message: 'market_gate_6181:insufficient_available_balance' }), 'insufficient_available_balance');
  assert.equal(marketGateCode({ code: 'P0001', message: 'auction_expired_at_insert (bid_time=x)' }), null);
  assert.equal(marketGateCode({ code: '23505', message: 'market_gate_6181:squad_full' }), null);
  assert.equal(marketGateCode(null), null);
});

test('slukket = bit-identisk: helperne laver kun kontakt-opslaget og roerer ikke tilstanden', async () => {
  clearFlagStageCache();
  const calls = [];
  const supabase = fakeSupabase({ flag: 'off', leading: 5, outgoing: 3, calls });
  const buyerState = { id: TEAM.B, future_count: 20, total_count: 20, balance: 10 };
  const sellerState = { id: TEAM.A, future_count: 9, total_count: 9, at_risk_count: 1 };
  const before = structuredClone({ buyerState, sellerState });
  assert.equal(await applyTransferMarketCommitment6181(supabase, { buyerState, sellerState, riderId: id(9) }), false);
  assert.equal(await applySellerOutgoingAuctions6181(supabase, sellerState, id(9)), false);
  assert.equal(await auctionStartCommitmentResponse6181(supabase, { teamId: TEAM.B, teamState: buyerState, price: 999 }), null);
  assert.deepEqual({ buyerState, sellerState }, before);
  assert.deepEqual([...new Set(calls)], ['app_config']);
  // Uden gate-fejl giver oversaetteren null; ruten falder igennem til sin gamle sti.
  assert.equal(await marketGateResponse6181(supabase, { code: 'P0001', message: 'auction_not_active' }, { kind: 'bid', teamId: TEAM.B }), null);
});

test('taendt: transfer-bekraeftelse taeller foerende auktioner og saelgers ryttere paa auktion', async () => {
  clearFlagStageCache();
  const supabase = fakeSupabase({ flag: 'on', leading: 2, outgoing: 3 });
  const buyerState = { id: TEAM.B, future_count: 28 };
  const sellerState = { id: TEAM.A, future_count: 12 };
  assert.equal(await applyTransferMarketCommitment6181(supabase, { buyerState, sellerState, riderId: id(9) }), true);
  assert.equal(buyerState.future_count, 30);
  assert.equal(sellerState.future_count, 9);
});

test('taendt: en rytter paa auktion, der ogsaa er i risiko, taelles kun een gang (Codex P2)', async () => {
  clearFlagStageCache();
  const season = 5;
  // Hold A: rytteren paa auktion har kontrakt, der udloeber; en anden rytter er ogsaa i risiko.
  const riders = [
    { id: id(500), contract_end_season: season, is_retired: false, pending_team_id: null },
    { id: id(600), contract_end_season: season, is_retired: false, pending_team_id: null },
    { id: id(601), contract_end_season: season + 3, is_retired: false, pending_team_id: null },
  ];
  const supabase = fakeSupabase({ flag: 'on', outgoing: 1, riders });
  // Kalderen har talt begge risiko-ryttere (kun den handlede rytter udeladt).
  const sellerState = { id: TEAM.A, future_count: 10, at_risk_count: 2 };
  assert.equal(await applySellerOutgoingAuctions6181(supabase, sellerState, id(9), { seasonNumber: season }), true);
  assert.equal(sellerState.future_count, 9, 'auktionsrytteren er udgaaende');
  assert.equal(sellerState.at_risk_count, 1, 'og taelles ikke ogsaa som risiko');
});

test('ren regel: applyMarketSeatCounts og startbyderens krav', () => {
  const buyer = { future_count: 10 };
  const seller = { total_count: 10 };
  applyMarketSeatCounts({ buyerState: buyer, sellerState: seller, buyerLeading: 0, sellerOutgoing: 0 });
  assert.deepEqual([buyer, seller], [{ future_count: 10 }, { total_count: 10 }], 'nul aendrer intet');
  applyMarketSeatCounts({ buyerState: buyer, sellerState: seller, buyerLeading: 1, sellerOutgoing: 2 });
  assert.equal(buyer.future_count, 11);
  assert.equal(seller.future_count, 8);

  assert.equal(getAuctionStartCommitmentIssue({ balance: 100, commitment: 40, price: 60, seatsInUse: 29 }), null);
  assert.deepEqual(getAuctionStartCommitmentIssue({ balance: 100, commitment: 41, price: 60, seatsInUse: 0 }), { code: 'start_bid_exceeds_balance' });
  assert.deepEqual(getAuctionStartCommitmentIssue({ balance: 100, commitment: 0, price: 60, seatsInUse: MAX_SQUAD_SIZE }),
    { code: 'squad_full_bid', maxRiders: MAX_SQUAD_SIZE });
});

test('taendt: gatens fejl bliver til de eksisterende fejlkoder', async () => {
  clearFlagStageCache();
  const supabase = fakeSupabase({ flag: 'on', commitment: 300, balance: 1000 });
  const money = { code: 'P0001', message: 'market_gate_6181:insufficient_available_balance' };
  assert.deepEqual(await marketGateResponse6181(supabase, money, { kind: 'bid', teamId: TEAM.B, auctionId: id(5) }), {
    status: 400,
    body: { error: `You have ${(700).toLocaleString('da-DK')} CZ$ left after your existing bids`, errorCode: 'insufficient_balance_after_bids', errorParams: { available: 700 } },
  });
  assert.equal((await marketGateResponse6181(supabase, money, { kind: 'proxy', teamId: TEAM.B, auctionId: id(5) })).body.errorCode,
    'insufficient_balance_after_proxy');
  assert.equal((await marketGateResponse6181(supabase, money, { kind: 'start', teamId: TEAM.B })).body.errorCode, 'start_bid_exceeds_balance');
  const seat = await marketGateResponse6181(supabase, { code: 'P0001', message: 'market_gate_6181:squad_full' }, { kind: 'bid', teamId: TEAM.B });
  assert.deepEqual(seat, { status: 400, body: { error: `Your squad is full (${MAX_SQUAD_SIZE} riders). Sell a rider before you bid on a new one.`,
    errorCode: 'squad_full_bid', errorParams: { maxRiders: MAX_SQUAD_SIZE } } });
});

// ── Aegte samtidighed (lokal Postgres) ───────────────────────────────────────

const PG_BIN = process.env.MARKET_GATE_PG_BIN;

function run(cmd, args, opts = {}) {
  const r = spawnSync(join(PG_BIN, cmd), args, { encoding: 'utf8', windowsHide: true,
    timeout: cmd === 'initdb' ? 120000 : 30000, ...opts,
    env: { ...process.env, PGCONNECT_TIMEOUT: '5', ...opts.env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}
function psqlAsync(port, sql) {
  return new Promise((resolve) => {
    const p = spawn(join(PG_BIN, 'psql'), ['-X', '-q', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'gate', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-c', `SET statement_timeout='30s'; ${sql}`],
      { windowsHide: true, env: { ...process.env, PGCONNECT_TIMEOUT: '5' } });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', error => resolve({ ok: false, err: error.message }));
    p.on('close', code => resolve({ ok: code === 0, err }));
  });
}

function controlledPsql(port, sql) {
  const child=spawn(join(PG_BIN,'psql'),['-X','-q','-t','-A','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','gate','-v','ON_ERROR_STOP=1'],
    {windowsHide:true,stdio:['pipe','ignore','pipe'],env:{...process.env,PGCONNECT_TIMEOUT:'5'}});
  let err='';
  child.stderr.on('data',part=>{err+=part;});
  child.stdin.on('error',error=>{err+=error.message;});
  const closed=new Promise(resolve=>{
    child.on('error',error=>resolve({code:-1,err:error.message}));
    child.on('close',code=>resolve({code,err}));
  });
  const sent=new Promise(resolve=>child.stdin.write(sql,()=>resolve()));
  return {child,closed,sent};
}

function awaitPgState(psql, condition) {
  psql(`DO $$ BEGIN FOR i IN 1..400 LOOP
    PERFORM pg_stat_clear_snapshot();
    IF ${condition} THEN RETURN; END IF;
    PERFORM pg_sleep(0.025);
  END LOOP; RAISE EXCEPTION 'test state barrier timed out'; END $$;`);
}

test('PG17: budget, equal-price and locked-state boundaries', { skip: !PG_BIN && 'MARKET_GATE_PG_BIN er ikke sat', timeout:600000 }, async (t) => {
  const version = run('psql', ['--version']).trim();
  assert.match(version, /PostgreSQL\) 17\./, 'the concurrency evidence requires real PostgreSQL 17');
  const temporaryRoot=resolve(tmpdir());
  const dir = await mkdtemp(join(temporaryRoot, 'm3gate-'));
  const data = join(dir, 'data');
  const port = 56000 + Math.floor(Math.random() * 1000);
  let serverStarted = false;
  const failures=[];
  try {
    run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C']);
    // stdio ignore: serveren arver ellers pipen, og spawnSync venter for evigt (Windows).
    const started = spawnSync(join(PG_BIN, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c max_connections=40`, '-w', '-l', join(dir, 'pg.log'), 'start'], { stdio: 'ignore', windowsHide: true });
    assert.equal(started.status, 0, 'pg_ctl start failed');
    serverStarted = true;
    // SQL via stdin som UTF-8: kommandolinjen paa Windows mister tegnkodningen.
    const psql = (sql) => run('psql', ['-X', '-q', '-t', '-A', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'gate', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });
    run('psql', ['-X', '-q', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-c', 'CREATE DATABASE gate']);
    psql(SCHEMA);
    psql(await file('2026-05-10-reject-late-auction-bid-trigger.sql'));
    psql(await file(MIGRATION));
    const rounds = 10;
    let overbooked = 0;
    let maxLeads = 0;
    let accepted = 0;
    let gateRejected = 0;
    for (let round = 0; round < rounds; round++) {
      psql(`TRUNCATE auction_bids, auction_proxy_bids, auctions, riders, teams CASCADE;
        UPDATE app_config SET value = '"on"' WHERE key = 'market_commitment_6181';
        INSERT INTO teams(id, balance) VALUES ('${TEAM.A}', 100);
        INSERT INTO riders(id) SELECT gen_random_uuid() FROM generate_series(1, 8);
        INSERT INTO auctions(rider_id, current_price) SELECT id, 10 FROM riders;`);
      const ids = psql('SELECT id FROM auctions ORDER BY id').trim().split(/\s+/);
      assert.equal(ids.length, 8);
      const outcomes = await Promise.all(ids.map(a => psqlAsync(port, `INSERT INTO auction_bids(auction_id, team_id, amount) VALUES ('${a}', '${TEAM.A}', 60)`)));
      assert.equal(outcomes.filter(result => result.ok).length, 1, `round ${round + 1}: exactly one bid must succeed`);
      for (const result of outcomes.filter(result => !result.ok)) {
        assert.match(result.err, /market_gate_6181:insufficient_available_balance/, `round ${round + 1}: unexpected SQL failure`);
      }
      accepted += outcomes.filter(result => result.ok).length;
      gateRejected += outcomes.filter(result => !result.ok).length;
      const leads = Number(psql(`SELECT count(*) FROM auctions WHERE current_bidder_id = '${TEAM.A}'`).trim());
      const committed = Number(psql(`SELECT public.team_market_commitment('${TEAM.A}')`).trim());
      if (leads !== 1 || committed > 100) overbooked++;
      maxLeads = Math.max(maxLeads, leads);
    }
    assert.equal(overbooked, 0, `overbooket i ${overbooked} af ${rounds} runder (flest foeringer: ${maxLeads})`);
    assert.equal(maxLeads, 1);
    t.diagnostic(`${version}; rounds=${rounds}; connections_per_round=8; attempted=${rounds * 8}; accepted=${accepted}; gate_rejected=${gateRejected}; overbooked=${overbooked}; max_leads=${maxLeads}`);
    const stateAuction=id(91000); const stateRider=id(91001);
    const resetState=()=>psql(`TRUNCATE auction_bids,auction_proxy_bids,auctions,riders,teams CASCADE;
      INSERT INTO teams(id,balance) VALUES('${TEAM.A}',100);
      INSERT INTO riders(id) VALUES('${stateRider}');
      INSERT INTO auctions(id,rider_id,current_price) VALUES('${stateAuction}','${stateRider}',10);`);
    resetState();
    psql(`INSERT INTO teams(id,balance) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,1000 FROM generate_series(500,507) n;`);
    const equalOutcomes=await Promise.all(Array.from({length:8},(_,n)=>psqlAsync(port,
      `INSERT INTO auction_bids(auction_id,team_id,amount,bid_time) VALUES('${stateAuction}','${id(500+n)}',50,'${FIXED_BID_TIME}')`)));
    assert.equal(equalOutcomes.filter(outcome=>outcome.ok).length,1);
    for(const outcome of equalOutcomes.filter(outcome=>!outcome.ok))assert.match(outcome.err,/market_gate_6181:price_changed/);
    t.diagnostic('equal_price_attempts=8; equal_price_accepted=1; equal_price_rejected=7');

    resetState();
    const owner=controlledPsql(port,`SET application_name='m3-state-owner'; SET statement_timeout='30s'; BEGIN;
      SELECT id FROM auctions WHERE id='${stateAuction}' FOR UPDATE;\n`);
    let waitingBid;
    try {
      await owner.sent;
      awaitPgState(psql,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='m3-state-owner' AND state='idle in transaction' AND query LIKE '%FOR UPDATE%')");
      waitingBid=psqlAsync(port,`SET application_name='m3-state-bid'; INSERT INTO auction_bids(auction_id,team_id,amount,bid_time)
        VALUES('${stateAuction}','${TEAM.A}',20,'${FIXED_BID_TIME}')`);
      awaitPgState(psql,"EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='m3-state-bid' AND wait_event_type='Lock')");
      owner.child.stdin.end(`UPDATE auctions SET status='completed' WHERE id='${stateAuction}'; COMMIT;\n`);
      const ownerResult=await owner.closed;
      assert.equal(ownerResult.code,0,ownerResult.err);
      const result=await waitingBid;
      assert.equal(result.ok,false);
      assert.match(result.err,/P0001:.*auction_not_active/s);
      assert.equal(Number(psql('SELECT count(*) FROM auction_bids').trim()),0);
      assert.equal(psql(`SELECT status FROM auctions WHERE id='${stateAuction}'`).trim(),'completed');
      t.diagnostic('inactive_after_row_lock_rejected=true; sqlstate=P0001');
    } finally {
      if(owner.child.exitCode===null && !owner.child.stdin.writableEnded && !owner.child.stdin.destroyed)owner.child.stdin.end('ROLLBACK;\n');
      await owner.closed;
      if(waitingBid)await waitingBid;
    }
  } catch(error) {
    failures.push(error);
  } finally {
    try {
      const stopped = spawnSync(join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore', windowsHide: true,timeout:30000 });
      if (serverStarted) {
        assert.equal(stopped.status, 0, 'temporary PG17 server must have stopped');
        const status=spawnSync(join(PG_BIN,'pg_ctl'),['-D',data,'status'],{stdio:'ignore',windowsHide:true,timeout:30000});
        assert.equal(status.status,3,'pg_ctl must report no server running');
        t.diagnostic('temporary_pg17_server_stopped=true');
      }
      assert.equal(dirname(resolve(dir)),temporaryRoot);
      try {await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
      catch(error){if(['EBUSY','EPERM'].includes(error.code))t.diagnostic(`temporary_pg17_cleanup_deferred=${dir}`);else failures.push(error);}
    } catch(error) {
      failures.push(error);
    }
  }
  if(failures.length===1)throw failures[0];
  if(failures.length>1)throw new AggregateError(failures,'PG17 verification and cleanup failed');
});
