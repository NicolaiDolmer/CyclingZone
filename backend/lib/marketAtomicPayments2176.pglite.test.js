// #2176: the money guard and the four atomic payment paths must stay on when
// auto-accept goes from beta to on for everyone. Fixed clock throughout.
// The base database carries every migration production already has for these
// functions (beta scope + #8015), so comparisons are against the live shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  betaDatabase2176, productionDatabase2176, migrationsTouching2176, migrationSource2176,
  MARKET_ATOMIC_2176, BETA_SCOPE_2176, PATCHED_AFTER_BETA_2176, GATED_FUNCTIONS_2176,
} from './__fixtures__/marketBeta2176Db.js';

const migration = () => migrationSource2176(MARKET_ATOMIC_2176);
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const A = id(1), B = id(2), D = id(4), R = id(201), DEAL = id(901), AUCTION = id(700);
const NOW = '2026-11-10T10:00:00Z', END = '2026-11-10T14:00:00Z';
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const scalar = async (db, sql, params = []) => (await one(db, sql, params)).n;
const balance = (db, team) => scalar(db, 'SELECT balance::int AS n FROM teams WHERE id=$1', [team]);
const owner = (db, rider = R) => scalar(db, 'SELECT team_id AS n FROM riders WHERE id=$1', [rider]);
// #8015 made a zero floor disable the seller departure check entirely.
const FLOOR_8015 = /IF p_min_riders > 0 AND \(v_count-1-cardinality\(v_outgoing\)-v_risk<p_min_riders\) THEN/;

async function database(t) {
  const db = await productionDatabase2176(t);
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

const CREATE = GATED[4];
const METADATA = `SELECT p.proacl::text AS acl,p.prosecdef,p.proconfig,p.proowner::regrole::text AS owner
  FROM pg_proc p WHERE p.oid=$1::regprocedure`;

test('the five production bodies are unchanged apart from the gate call', async t => {
  const db = await productionDatabase2176(t);
  const before = {}, meta = {};
  for (const signature of GATED) {
    before[signature] = await definition(db, signature);
    meta[signature] = await one(db, METADATA, ['public.' + signature]);
  }
  assert.match(before[CREATE], FLOOR_8015, 'the comparison base is the #8015-patched production definition');
  await db.exec(await migration());
  for (const signature of GATED) {
    assert.equal(before[signature].split('public.market_beta_mode_2176()').length - 1, 1, `${signature}: exactly one old gate`);
    assert.equal(await definition(db, signature),
      before[signature].replace('public.market_beta_mode_2176()', 'public.market_atomic_payments_2176()'), signature);
    assert.deepEqual(await one(db, METADATA, ['public.' + signature]), meta[signature], `${signature}: ACL, owner, security`);
  }
  assert.match(await definition(db, CREATE), FLOOR_8015, 'the #8015 floor survives');
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='market_discretionary_finance_guard_2176'`)).n, 1,
    'the existing guard trigger stays attached');
});

test('the migration aborts instead of guessing when a gate call is not exactly one', async t => {
  const db = await productionDatabase2176(t);
  const def = await definition(db, CREATE);
  await db.exec(def.replace('PERFORM public.auto_accept_lock_teams', 'PERFORM public.market_beta_mode_2176(); PERFORM public.auto_accept_lock_teams'));
  await assert.rejects(db.exec(await migration()), /#2176: unexpected gate calls in public\.create_market_auction_2176/);
  await db.exec('ROLLBACK');
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM pg_proc WHERE proname='market_atomic_payments_2176'`)).n, 0,
    'nothing is applied: one transaction');
});

// A team whose only owned riders are youth (no seniors at all) lists one on an
// ordinary auction with the backend's zero floor. #8015 made this `created`.
async function youthOnlyCreate(db) {
  await db.exec(`INSERT INTO riders(id,team_id,is_academy,squad) VALUES('${id(601)}','${A}',true,'junior'),('${id(602)}','${A}',true,'u23')`);
  const data = { rider_id: id(601), seller_team_id: A, starting_price: 100000, current_price: 100000, current_bidder_id: null,
    min_increment: 1000, calculated_end: END, is_flash: false };
  return (await one(db, `SELECT create_market_auction_2176($1,$2,0,'{}') AS r`, [data, A])).r.status;
}

for (const [market, auto] of [['on', 'beta'], ['on', 'on']]) {
  test(`${market}/${auto}: a youth-only team can list a youth rider with floor 0 after the migration`, async t => {
    const db = await database(t); await flags(db, market, auto);
    assert.equal(await youthOnlyCreate(db), 'created');
  });
}

test('guard: every migration touching the gated functions, in filename order, keeps #8015 and the new gate', async t => {
  const touching = await migrationsTouching2176(GATED_FUNCTIONS_2176);
  assert.equal(touching[0], BETA_SCOPE_2176);
  assert.ok(touching.includes(MARKET_ATOMIC_2176));
  assert.deepEqual(touching.filter(name => name > BETA_SCOPE_2176 && name < MARKET_ATOMIC_2176), PATCHED_AFTER_BETA_2176,
    'a migration between beta scope and atomic payments patches a gated function: add it to PATCHED_AFTER_BETA_2176');
  // Beta scope is already applied by the fixture; replay every later one, twice.
  const db = await betaDatabase2176(t);
  // #8034 uses the promotion allowance from #7323, which does not itself
  // edit a gated market function and therefore is outside the discovery scan.
  await db.exec(`
    ALTER TABLE riders ADD COLUMN promotion_pending_to text, ADD COLUMN promotion_pending_since timestamptz,
      ADD COLUMN firstname text, ADD COLUMN lastname text;
    CREATE TABLE academy_graduation (
      rider_id uuid, team_id uuid, season_id uuid, from_squad text, to_squad text,
      status text, deadline timestamptz, resolved_at timestamptz, PRIMARY KEY(rider_id, season_id)
    );
  `);
  const later = [...new Set([...touching.slice(1), "2026-11-24-7323-season-squad-promotion.sql"])].sort();
  for (let pass = 0; pass < 2; pass++) for (const name of later) await db.exec(await migrationSource2176(name));
  assert.match(await definition(db, CREATE), FLOOR_8015, 'a later migration rewrote create_market_auction_2176 with an older body');
  for (const signature of GATED) {
    const def = await definition(db, signature);
    assert.equal(def.includes('public.market_beta_mode_2176()'), false, `${signature}: old gate came back`);
    assert.equal(def.split('public.market_atomic_payments_2176()').length - 1, 1, `${signature}: one atomic gate`);
  }
  await flags(db, 'on', 'beta');
  assert.equal(await youthOnlyCreate(db), 'created');
});

test('negative control: a copied pre-#8015 body is caught by the floor guard and blocks youth listing', async t => {
  const db = await database(t); await flags(db, 'on', 'beta');
  const old = (await migrationSource2176(BETA_SCOPE_2176))
    .match(/CREATE OR REPLACE FUNCTION public\.create_market_auction_2176\([\s\S]*?END; \$\$;/);
  assert.ok(old, 'the beta-scope body is still extractable');
  await db.exec(old[0].replace('public.market_beta_mode_2176()', 'public.market_atomic_payments_2176()'));
  assert.doesNotMatch(await definition(db, CREATE), FLOOR_8015, 'the guard pattern detects the rollback');
  assert.equal(await youthOnlyCreate(db), 'seller_squad_floor', 'this is the regression the judge found');
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
