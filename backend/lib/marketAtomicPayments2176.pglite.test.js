// #2176: the money guard and the four atomic payment paths must stay on when
// auto-accept goes from beta to on for everyone. Fixed clock throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { betaDatabase2176 } from './__fixtures__/marketBeta2176Db.js';

const ATOMIC = '2026-11-14-2176-market-atomic-payments.sql';
const migration = () => readFile(new URL('../../database/' + ATOMIC, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const A = id(1), B = id(2), D = id(4), R = id(201), DEAL = id(901), AUCTION = id(700);
const NOW = '2026-11-10T10:00:00Z', END = '2026-11-10T14:00:00Z';
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const scalar = async (db, sql, params = []) => (await one(db, sql, params)).n;
const balance = (db, team) => scalar(db, 'SELECT balance::int AS n FROM teams WHERE id=$1', [team]);
const owner = (db, rider = R) => scalar(db, 'SELECT team_id AS n FROM riders WHERE id=$1', [rider]);

async function database(t) {
  const db = await betaDatabase2176(t);
  const sql = await migration();
  await db.exec(sql); await db.exec(sql); // idempotent re-apply
  return db;
}
async function flags(db, market, auto) {
  await db.query(`UPDATE app_config SET value=$1::jsonb WHERE key='market_commitment_6181'`, [JSON.stringify(market)]);
  await db.query(`UPDATE app_config SET value=$1::jsonb WHERE key='auto_accept_enabled'`, [JSON.stringify(auto)]);
}
async function squad(db, team, count = 12, first = 201) {
  await db.exec(`INSERT INTO riders(id,team_id) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${team}'
    FROM generate_series(${first},${first + count - 1}) n;`);
}
// Team B (no beta access) leads a public auto-auction: money is bound.
async function hold(db) {
  await db.exec(`INSERT INTO auctions(id,rider_id,seller_team_id,current_price,current_bidder_id,requested_start,calculated_end,origin,source_listing_id,buyer_duration_minutes)
    VALUES('${AUCTION}','${id(101)}','${D}',400000,'${B}','${NOW}','${END}','auto_accept','${id(701)}',60);`);
}
function payload(side, deal = 'transfer', amount = 600000) {
  return { type: side === 'payer' ? 'transfer_out' : 'transfer_in', amount: side === 'payer' ? -amount : amount,
    description: 'fixture', actor_type: 'api', source_path: `transferExecution.execute${deal === 'transfer' ? 'TransferOffer' : 'SwapOffer'}.${side}`,
    reason_code: deal === 'transfer' ? (side === 'payer' ? 'transfer_purchase' : 'transfer_sale') : 'swap_cash_delta',
    related_entity_type: deal, related_entity_id: DEAL,
    idempotency_key: `${deal === 'transfer' ? (side === 'payer' ? 'transfer_buyer' : 'transfer_seller') : (side === 'payer' ? 'swap_payer' : 'swap_receiver')}:${DEAL}` };
}
const release = async (db, fee) => (await one(db, `SELECT auto_accept_release_paid_2176($1,$2,8,'{}',false,$3,$4) AS r`,
  [R, B, fee, { type: 'transfer_out', amount: -fee, actor_type: 'api', source_path: 'api.riders.release', reason_code: 'rider_release_buyout' }])).r;
const swap = async (db, amount) => (await one(db, `SELECT auto_accept_claim_swap_paid($1,$2,$3,$4,false,$5,'{}','{}',$6,$7,$8) AS r`,
  [id(400), R, B, D, NOW, DEAL, amount, { payer_team_id: B, payee_team_id: D, amount,
    payer_payload: payload('payer', 'swap', amount), payee_payload: payload('payee', 'swap', amount), rider_restore: {} }])).r;
const facility = (db, amount) => db.query('SELECT increment_balance_with_audit($1,$2,$3)', [B, -amount,
  { type: 'facility_purchase', amount: -amount, actor_type: 'api', source_path: 'facilityService.purchaseFacilityUpgrade',
    reason_code: 'facility_purchase', idempotency_key: `atomic-facility-${amount}` }]);
function scout(db, cost) {
  const data = { team_id: B, kind: 'mission', mission_criteria: { scope: 'country', value: 'DK' }, travel_cost: cost,
    started_on: '2026-11-10', ready_on: '2026-11-12', season_id: null };
  const audit = { type: 'scout_travel', amount: -cost, description: null, actor_type: 'cron', actor_id: null,
    source_path: 'scoutAssignmentService.startMission', reason_code: 'scout_travel', metadata: { code: 'tx.scoutTravel', params: { kind: 'mission' } } };
  return db.query('SELECT market_scout_assignment_2176($1,$2,$3) AS r', [B, data, audit]);
}

const GATED = ['market_discretionary_finance_guard_2176()', 'auto_accept_release_paid_2176(uuid,uuid,integer,uuid[],boolean,bigint,jsonb)',
  'auto_accept_claim_swap_paid(uuid,uuid,uuid,uuid,boolean,timestamptz,jsonb,jsonb,uuid,bigint,jsonb)',
  'market_scout_assignment_2176(uuid,jsonb,jsonb)', 'create_market_auction_2176(jsonb,uuid,integer,uuid[])'];
// Line endings depend on the checkout (CRLF on Windows), not on the migration.
const definition = async (db, signature) =>
  (await one(db, 'SELECT pg_get_functiondef($1::regprocedure) AS def', ['public.' + signature])).def.replace(/\r\n/g, '\n');

test('the five gated bodies are verbatim apart from the gate call', async t => {
  const db = await betaDatabase2176(t);
  const before = {};
  for (const signature of GATED) before[signature] = await definition(db, signature);
  await db.exec(await migration());
  for (const signature of GATED) {
    assert.equal(before[signature].split('public.market_beta_mode_2176()').length - 1, 1, `${signature}: exactly one old gate`);
    assert.equal(await definition(db, signature),
      before[signature].replace('public.market_beta_mode_2176()', 'public.market_atomic_payments_2176()'), signature);
  }
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='market_discretionary_finance_guard_2176'`)).n, 1,
    'the existing guard trigger stays attached');
});

const STAGES = ['off', 'beta', 'on', true, false];
test('atomic gate equals the old gate in every flag state except bid lock on with auto-accept on', async t => {
  const db = await database(t);
  for (const market of STAGES) for (const auto of STAGES) {
    await flags(db, market, auto);
    const row = await one(db, 'SELECT market_beta_mode_2176() AS old, market_atomic_payments_2176() AS atomic');
    const bothOn = (market === 'on' || market === true) && (auto === 'on' || auto === true);
    assert.equal(row.atomic, row.old || bothOn, `market=${market} auto=${auto}`);
    if (bothOn) assert.equal(row.old, false, 'beta mode itself is unchanged: it stays false when both are on');
  }
  await db.exec(`DELETE FROM app_config WHERE key='auto_accept_enabled'`);
  await db.query(`UPDATE app_config SET value='"on"' WHERE key='market_commitment_6181'`);
  assert.equal((await one(db, 'SELECT market_atomic_payments_2176() AS v')).v, false, 'a missing auto-accept key keeps legacy');
  await db.exec(`DELETE FROM app_config WHERE key='market_commitment_6181'`);
  assert.equal((await one(db, 'SELECT market_atomic_payments_2176() AS v')).v, false, 'a missing bid-lock key keeps legacy');
});

test('global on/off still retain the legacy scope and pair values after the migration', async t => {
  const db = await database(t);
  for (const value of ['on', true, 'off', false]) {
    await flags(db, value, value);
    const expected = value === 'on' || value === true;
    assert.equal((await one(db, 'SELECT market_scope_2176($1,NULL) AS yes', [B])).yes, expected);
    assert.equal((await one(db, 'SELECT auto_accept_pair_2176($1,$2) AS yes', [B, D])).yes, expected);
  }
});

// [bid lock, auto-accept, atomic expected]
const MODES = [['off', 'off', false], ['on', 'beta', true], ['on', 'on', true], ['beta', 'beta', true]];
for (const [market, auto, atomic] of MODES) {
  const label = `${market}/${auto}`;

  test(`${label}: discretionary guard and scouting ${atomic ? 'refuse bound money' : 'keep legacy'}`, async t => {
    const db = await database(t); await flags(db, market, auto); await hold(db);
    if (atomic) {
      await assert.rejects(facility(db, 800000), /market_gate_6181:insufficient_available_balance/);
      assert.equal(await balance(db, B), 1000000);
      await assert.rejects(scout(db, 800000), /market_gate_6181:insufficient_available_balance/);
      assert.equal(await scalar(db, 'SELECT count(*)::int AS n FROM scout_assignments'), 0, 'assignment rolls back with the debit');
      assert.equal((await scout(db, 300000)).rows[0].r.status, 'created');
      assert.equal(await balance(db, B), 700000);
    } else {
      await facility(db, 800000);
      assert.equal(await balance(db, B), 200000, 'legacy: no new DB guard');
      assert.equal((await scout(db, 300000)).rows[0].r.status, 'legacy');
      assert.equal(await scalar(db, 'SELECT count(*)::int AS n FROM scout_assignments'), 0);
    }
  });

  test(`${label}: paid release is ${atomic ? 'atomic' : 'legacy'}`, async t => {
    const db = await database(t); await flags(db, market, auto); await squad(db, B); await hold(db);
    if (!atomic) { assert.equal((await release(db, 800000)).status, 'legacy'); assert.equal(await owner(db), B); return; }
    assert.equal((await release(db, 800000)).status, 'insufficient_available_balance');
    assert.equal(await owner(db), B); assert.equal(await balance(db, B), 1000000);
    const done = await release(db, 300000);
    assert.equal(done.status, 'released'); assert.equal(done.payment_handled, true);
    assert.equal(await owner(db), null); assert.equal(await balance(db, B), 700000);
  });

  test(`${label}: paid cash swap is ${atomic ? 'atomic' : 'legacy'}`, async t => {
    const db = await database(t); await flags(db, market, auto); await squad(db, D); await squad(db, B, 1, 400); await hold(db);
    if (!atomic) { assert.equal((await swap(db, 500000)).status, 'legacy'); assert.equal(await owner(db), D); return; }
    assert.equal((await swap(db, 700000)).status, 'payer_insufficient_balance');
    assert.equal(await owner(db, id(400)), B); assert.equal(await owner(db), D);
    assert.equal((await swap(db, 500000)).payment_handled, true);
    assert.equal(await owner(db, id(400)), D); assert.equal(await owner(db), B);
    assert.equal(await balance(db, B), 500000); assert.equal(await balance(db, D), 1500000);
  });

  test(`${label}: ordinary auction creation ${atomic ? 'rechecks ownership under the lock' : 'keeps legacy'}`, async t => {
    const db = await database(t); await flags(db, market, auto);
    await db.exec(`INSERT INTO riders(id,team_id) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${A}' FROM generate_series(201,209)n`);
    const data = { rider_id: id(201), seller_team_id: A, starting_price: 100000, current_price: 100000, current_bidder_id: null,
      min_increment: 1000, calculated_end: END, is_flash: false };
    const create = async () => (await one(db, 'SELECT create_market_auction_2176($1,$2,8,$3) AS r', [data, A, []])).r;
    if (!atomic) { assert.equal((await create()).status, 'legacy'); return; }
    assert.equal((await create()).status, 'created');
    data.rider_id = id(202); assert.equal((await create()).status, 'seller_squad_floor');
    await db.exec(`UPDATE riders SET team_id='${B}' WHERE id='${id(203)}'`);
    data.rider_id = id(203); assert.equal((await create()).status, 'rider_state_changed');
  });
}

test('on/on: transfer still pays inside the claim and rechecks bound money', async t => {
  const db = await database(t); await flags(db, 'on', 'on'); await squad(db, D); await squad(db, B, 12, 400); await hold(db);
  const buy = async price => (await one(db, `SELECT auto_accept_claim_transfer_paid($1,$2,$3,false,$4,'{}',8,'{}',30,$5,$6,$7,$8,'{}') AS r`,
    [R, D, B, NOW, price, DEAL, payload('payer', 'transfer', price), payload('payee', 'transfer', price)])).r;
  assert.equal((await buy(700000)).status, 'buyer_insufficient_balance'); assert.equal(await owner(db), D);
  assert.equal((await buy(500000)).payment_handled, true);
  assert.equal(await owner(db), B); assert.equal(await balance(db, B), 500000); assert.equal(await balance(db, D), 1500000);
});

test('new gate and replaced RPCs stay service-only; the trigger function is not callable', async t => {
  const db = await database(t);
  const rows = (await db.query(`SELECT p.proname,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1)`,
  [['market_atomic_payments_2176', 'auto_accept_release_paid_2176', 'auto_accept_claim_swap_paid', 'market_scout_assignment_2176',
    'create_market_auction_2176', 'market_discretionary_finance_guard_2176']])).rows;
  assert.equal(rows.length, 6);
  for (const row of rows) {
    assert.equal(row.anon, false, row.proname); assert.equal(row.authenticated, false, row.proname);
    assert.equal(row.service, row.proname !== 'market_discretionary_finance_guard_2176', row.proname);
  }
});
