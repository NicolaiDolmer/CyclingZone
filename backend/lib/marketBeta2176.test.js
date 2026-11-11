import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAutoAcceptActorEnabled2176, isAutoAcceptPairEnabled2176, projectAutoAcceptListings2176,
  isMarketTransportEnabled2176, isMarketProtectionEnabled2176, isMarketBetaMode2176,
  projectAutoAcceptOffers2176,
  readMarketSpendIssue2176,
} from './marketBeta2176.ts';

function fixture({ auto = 'beta', market = 'beta', sellerBeta = true, buyerBeta = true, sellerRole = 'user', buyerRole = 'user', scope = false, fail = null } = {}) {
  const tables = {
    app_config: [{ key: 'auto_accept_enabled', value: auto }, { key: 'market_commitment_6181', value: market }],
    teams: [{ id: 'seller', user_id: 'seller-user' }, { id: 'buyer', user_id: 'buyer-user' }],
    users: [{ id: 'seller-user', role: sellerRole, is_beta_tester: sellerBeta }, { id: 'buyer-user', role: buyerRole, is_beta_tester: buyerBeta }],
  };
  const reads = [], rpcs = [];
  const client = {
    reads, rpcs,
    from(table) {
      reads.push(table);
      let rows = [...(tables[table] || [])];
      const result = () => ({ data: rows, error: fail === table ? { message: 'lookup failed' } : null });
      const q = {
        select() { return q; },
        eq(key, value) { rows = rows.filter(row => row[key] === value); return q; },
        in(key, values) { rows = rows.filter(row => values.includes(row[key])); return q; },
        maybeSingle() { return Promise.resolve({ ...result(), data: rows[0] ?? null }); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return q;
    },
    rpc(name, args) { rpcs.push({ name, args }); return Promise.resolve({ data: scope, error: fail === 'rpc' ? { message: 'scope failed' } : null }); },
  };
  return client;
}

for (const market of ['on', true]) test(`auto-accept beta keeps atomic writer transport with global M3=${market}`,async()=>{
  assert.equal(await isMarketBetaMode2176(fixture({market,auto:'beta'})),true);
  assert.equal(await isMarketBetaMode2176(fixture({market,auto:'on'})),false);
  assert.equal(await isMarketBetaMode2176(fixture({market,auto:'off'})),false);
});

for (const [sellerBeta, buyerBeta, expected] of [[true, true, true], [true, false, false], [false, true, false], [false, false, false]]) {
  test(`beta pair seller=${sellerBeta}, buyer=${buyerBeta}: only both qualify`, async () => {
    const db = fixture({ sellerBeta, buyerBeta });
    assert.equal(await isAutoAcceptPairEnabled2176(db, { sellerTeamId: 'seller', buyerTeamId: 'buyer' }), expected);
    const result = await projectAutoAcceptListings2176(db, [{ id: 'listing', seller_team_id: 'seller', auto_accept_price: 700 }], { userId: 'buyer-user' });
    assert.equal(Object.hasOwn(result[0], 'auto_accept_price'), expected);
    if (expected) assert.equal(result[0].auto_accept_price, 700);
    assert.equal(result[0].id, 'listing');
  });
}

test('admin is canonical implicit beta, and own beta seller can edit', async () => {
  const db = fixture({ buyerBeta: false, buyerRole: 'admin' });
  assert.equal(await isAutoAcceptActorEnabled2176(db, { userId: 'buyer-user' }), true);
  assert.equal(await isAutoAcceptActorEnabled2176(db, { teamId: 'seller' }), true);
  assert.equal(await isAutoAcceptPairEnabled2176(db, { sellerTeamId: 'seller', buyerTeamId: 'buyer' }), true);
});

test('listing endpoint nested seller identity is honored without exposing owner roles', async () => {
  const rows = [{ id: 'nested', seller: { id: 'seller', name: 'Seller' }, auto_accept_price: 700 }];
  const result = await projectAutoAcceptListings2176(fixture(), rows, { userId: 'buyer-user' });
  assert.equal(result[0].auto_accept_price, 700);
  assert.deepEqual(result[0].seller, { id: 'seller', name: 'Seller' });
});

test('beta seller must negotiate normally with a non-beta buyer, including counter UI eligibility', async () => {
  const groups = { sent: [], received: [{ id: 'offer', buyer: { id: 'buyer', name: 'Buyer' } }], archivedSent: [], archivedReceived: [] };
  const nonBeta = await projectAutoAcceptOffers2176(fixture({ buyerBeta: false }), groups, 'seller');
  assert.equal(nonBeta.received[0].auto_accept_eligible, false);
  assert.deepEqual(nonBeta.received[0].buyer, { id: 'buyer', name: 'Buyer' });
  const beta = await projectAutoAcceptOffers2176(fixture(), groups, 'seller');
  assert.equal(beta.received[0].auto_accept_eligible, true);
  for (const auto of ['on','off']) assert.deepEqual(await projectAutoAcceptOffers2176(fixture({ auto }), groups, 'seller'), groups);
});

test('beta without trusted actor/pair identity fails closed; non-beta owner gets no price', async () => {
  const db = fixture({ sellerBeta: false });
  assert.equal(await isAutoAcceptActorEnabled2176(db), false);
  assert.equal(await isAutoAcceptPairEnabled2176(db, { sellerTeamId: 'seller' }), false);
  const row = { id: 'own', seller_team_id: 'seller', auto_accept_price: 700 };
  assert.equal(Object.hasOwn((await projectAutoAcceptListings2176(db, [row], { userId: 'seller-user' }))[0], 'auto_accept_price'), false);
  assert.equal(row.auto_accept_price, 700, 'projection does not mutate another viewer\'s source row');
});

for (const value of ['on', true, 'off', false, null, 'unknown']) {
  test(`on/off projection and pair preserve legacy stage ${value}`, async () => {
    const db = fixture({ auto: value, sellerBeta: false, buyerBeta: false });
    const expected = value === 'on' || value === true;
    assert.equal(await isAutoAcceptActorEnabled2176(db), expected);
    assert.equal(await isAutoAcceptPairEnabled2176(db, { sellerTeamId: 'seller', buyerTeamId: 'buyer' }), expected);
    const result = await projectAutoAcceptListings2176(db, [{ seller_team_id: 'seller', auto_accept_price: 700 }]);
    assert.equal(Object.hasOwn(result[0], 'auto_accept_price'), expected);
    assert.ok(db.reads.every(table => table === 'app_config'), 'disabled/global modes do not query cohorts');
  });
}

test('cohort is fresh: revocation changes next pair/read, and lookup failures throw', async () => {
  for (const fail of ['app_config', 'users', 'teams']) {
    const db = fixture({ fail });
    await assert.rejects(isAutoAcceptPairEnabled2176(db, { sellerTeamId: 'seller', buyerTeamId: 'buyer' }), error => error.message.includes('lookup failed'));
  }
  assert.equal(await isAutoAcceptPairEnabled2176(fixture(), { sellerTeamId: 'seller', buyerTeamId: 'buyer' }), true);
  assert.equal(await isAutoAcceptPairEnabled2176(fixture({ buyerBeta: false }), { sellerTeamId: 'seller', buyerTeamId: 'buyer' }), false);
});

test('beta transaction transport is distinct from server/database financial scope', async () => {
  const db = fixture();
  assert.equal(await isMarketTransportEnabled2176(db), true);
  assert.equal(await isMarketProtectionEnabled2176(db, { teamId: 'buyer', auctionId: 'public-auction' }), false);
  assert.deepEqual(db.rpcs, [{ name: 'market_scope_2176', args: { p_team_id: 'buyer', p_auction_id: 'public-auction' } }]);
  assert.equal(await isMarketProtectionEnabled2176(fixture({ scope: true }), { teamId: 'buyer' }), true);
  await assert.rejects(isMarketProtectionEnabled2176(fixture({ fail: 'rpc' }), { teamId: 'buyer' }), /scope failed/);
});

test('market on/off do not query new scope RPCs', async () => {
  for (const market of ['on', true, 'off', false, null]) {
    const db = fixture({ market });
    const expected = market === 'on' || market === true;
    assert.equal(await isMarketTransportEnabled2176(db), expected);
    assert.equal(await isMarketProtectionEnabled2176(db, { teamId: 'buyer' }), expected);
    assert.equal(db.rpcs.length, 0);
  }
});

test('typed finance refusal reuses available-balance errors without masking other DB failures', () => {
  assert.deepEqual(readMarketSpendIssue2176({code:'P0001',message:'market_gate_6181:insufficient_available_balance',details:'{"available":100,"locked":400}'}),
    {error:'insufficient_available_balance',available:100,locked:400});
  assert.equal(readMarketSpendIssue2176({code:'23505',message:'duplicate'}),null);
  assert.deepEqual(readMarketSpendIssue2176({code:'P0001',message:'market_gate_6181:insufficient_available_balance',details:'not json'}),
    {error:'insufficient_available_balance'});
});
