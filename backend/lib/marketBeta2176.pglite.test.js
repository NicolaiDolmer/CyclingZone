import test from 'node:test';
import assert from 'node:assert/strict';
import { betaDatabase2176 as database } from './__fixtures__/marketBeta2176Db.js';

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const A = id(1), B = id(2), C = id(3), D = id(4);
const AUCTION = id(700);
const NOW = '2026-11-10T10:00:00Z', END = '2026-11-10T14:00:00Z';
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];


const scope = async (db, team, auction = null) => (await one(db, 'SELECT market_scope_2176($1,$2) AS yes', [team, auction])).yes;
const pair = async (db, seller, buyer) => (await one(db, 'SELECT auto_accept_pair_2176($1,$2) AS yes', [seller,buyer])).yes;

test('SQL beta cohort is canonical admin-or-beta; both participants needed at auto price', async t => {
  const db = await database(t);
  assert.equal(await pair(db,A,C),true); assert.equal(await pair(db,A,A),true);
  assert.equal(await pair(db,A,B),false); assert.equal(await pair(db,B,A),false); assert.equal(await pair(db,B,D),false);
  assert.equal(await pair(db,A,null),false);
  assert.equal(await scope(db,A),true); assert.equal(await scope(db,C),true);
  assert.equal(await scope(db,B),false); assert.equal(await scope(db,D),false);
});

test('public auto auction protects non-beta bidder, proxy holder and seller, then releases scope', async t => {
  const db = await database(t);
  await db.exec(`INSERT INTO auctions(id,rider_id,seller_team_id,current_price,current_bidder_id,requested_start,calculated_end,origin,source_listing_id,buyer_duration_minutes)
    VALUES('${AUCTION}','${id(101)}','${D}',400000,'${B}','${NOW}','${END}','auto_accept','${id(701)}',60);`);
  assert.equal(await scope(db,B),true); assert.equal(await scope(db,D),true);
  assert.equal(await scope(db,B,AUCTION),true);
  await db.exec(`INSERT INTO auction_proxy_bids(auction_id,team_id,max_amount) VALUES('${AUCTION}','${C}',500000);
    UPDATE auctions SET current_bidder_id='${C}' WHERE id='${AUCTION}';`);
  assert.equal(await scope(db,B),false,'outbid without proxy releases its money scope');
  await db.exec(`INSERT INTO auction_proxy_bids(auction_id,team_id,max_amount) VALUES('${AUCTION}','${B}',450000);`);
  assert.equal(await scope(db,B),true);
  await db.exec(`UPDATE auctions SET status='completed' WHERE id='${AUCTION}';`);
  assert.equal(await scope(db,B),false); assert.equal(await scope(db,D),false);
});

test('ordinary non-beta obligations do not enroll a team, and existing auto obligations survive revocation', async t => {
  const db = await database(t);
  await db.exec(`INSERT INTO auctions(id,rider_id,seller_team_id,current_price,current_bidder_id,requested_start,calculated_end)
    VALUES('${AUCTION}','${id(101)}','${D}',400000,'${B}','${NOW}','${END}');`);
  assert.equal(await scope(db,B),false); assert.equal(await scope(db,D),false);
  await db.exec(`UPDATE auctions SET origin='auto_accept',source_listing_id='${id(701)}',buyer_duration_minutes=60,current_bidder_id='${A}' WHERE id='${AUCTION}';
    UPDATE users SET is_beta_tester=false WHERE id='${A}';`);
  assert.equal(await scope(db,A),true);
  assert.equal(await pair(db,A,C),false,'revocation prevents a new beta start');
});

test('SQL on/off retain global legacy values and new functions are service-only', async t => {
  const db = await database(t);
  for (const value of ['on',true,'off',false]) {
    await db.query('UPDATE app_config SET value=$1::jsonb WHERE key IN (\'auto_accept_enabled\',\'market_commitment_6181\')', [JSON.stringify(value)]);
    assert.equal(await scope(db,B),value === 'on' || value === true);
    assert.equal(await pair(db,B,D),value === 'on' || value === true);
  }
  for (const signature of ['public.market_team_beta_2176(uuid)','public.market_scope_2176(uuid,uuid,text)',
    'public.market_transport_2176()','public.auto_accept_pair_2176(uuid,uuid)']) {
    for (const [role, expected] of [['anon',false],['authenticated',false],['service_role',true]]) {
      assert.equal((await one(db,"SELECT has_function_privilege($1,$2,'EXECUTE') AS ok",[role,signature])).ok,expected);
    }
  }
});

async function publicAuction(db) {
  await db.exec(`INSERT INTO auctions(id,rider_id,seller_team_id,current_price,current_bidder_id,requested_start,calculated_end,origin,source_listing_id,buyer_duration_minutes)
    VALUES('${AUCTION}','${id(101)}','${D}',300000,'${C}','${NOW}','${END}','auto_accept','${id(701)}',60);`);
}
const bid = async (db, team, amount, auction = AUCTION) => (await one(db,
  'SELECT place_auction_bid_6181($1,$2,$3,$4) AS r',[auction,team,amount,NOW])).r;

test('M3 beta: public non-beta first bid succeeds, and its other commitments are honored', async t => {
  const db = await database(t); await publicAuction(db);
  assert.equal((await bid(db,B,400000)).placed,true);
  assert.equal((await one(db,'SELECT current_bidder_id FROM auctions WHERE id=$1',[AUCTION])).current_bidder_id,B);
  await db.exec(`INSERT INTO auctions(id,rider_id,seller_team_id,current_price,current_bidder_id,calculated_end)
    VALUES('${id(702)}','${id(103)}','${D}',500000,'${B}','${END}');`);
  await assert.rejects(bid(db,B,600000),/market_gate_6181:insufficient_available_balance/);
});

test('M3 beta: unrelated non-beta ordinary DB bid retains legacy budget behavior', async t => {
  const db = await database(t);
  await db.exec(`INSERT INTO auctions(id,rider_id,seller_team_id,current_price,calculated_end)
    VALUES('${AUCTION}','${id(101)}','${D}',100000,'${END}');`);
  assert.equal((await one(db,'SELECT market_bid_issue_6181($1,$2,1500000,false) AS issue',[B,AUCTION])).issue,'insufficient_available_balance',
    'the legacy affordability prefilter remains authoritative even when the new DB financial scope is off');
  assert.equal((await bid(db,B,1500000)).placed,true,'the new DB financial gate stays off for this non-beta operation');
});

test('beta SQL offer boundary follows the pair through offers, counters and confirmation', async t => {
  const db = await database(t);
  await db.exec(`INSERT INTO riders(id,team_id) VALUES('${id(102)}','${A}');
    INSERT INTO transfer_listings(id,rider_id,seller_team_id,asking_price) VALUES('${id(703)}','${id(102)}','${A}',100000);`);
  assert.equal((await one(db,'SELECT set_listing_auto_accept_price($1,$2,600000,NULL,$2) AS r',[id(703),A])).r.status,'updated');
  await assert.rejects(db.exec(`INSERT INTO transfer_offers(id,rider_id,seller_team_id,buyer_team_id,offer_amount,status)
    VALUES('${id(901)}','${id(102)}','${A}','${C}',600000,'pending')`),/offer_at_auto_accept_price/);
  await db.exec(`INSERT INTO transfer_offers(id,rider_id,seller_team_id,buyer_team_id,offer_amount,status)
    VALUES('${id(902)}','${id(102)}','${A}','${B}',700000,'pending');
    UPDATE transfer_offers SET counter_amount=800000,status='awaiting_confirmation',buyer_confirmed=true,seller_confirmed=true WHERE id='${id(902)}';`);
  assert.equal((await one(db,'SELECT status FROM transfer_offers WHERE id=$1',[id(902)])).status,'awaiting_confirmation');
  assert.equal((await one(db,'SELECT set_listing_auto_accept_price($1,$2,600000,NULL,$2) AS r',[id(701),D])).r.status,'disabled');
});

test('non-beta public obligation blocks another discretionary debit atomically', async t => {
  const db = await database(t); await publicAuction(db);
  await db.exec(`UPDATE auctions SET current_bidder_id='${B}',current_price=400000 WHERE id='${AUCTION}'`);
  const payload = { type:'facility_purchase',amount:-800000,actor_type:'api',source_path:'facilityService.purchaseFacilityUpgrade',
    reason_code:'facility_purchase',idempotency_key:'beta-facility-test' };
  await assert.rejects(db.query('SELECT increment_balance_with_audit($1,-800000,$2)',[B,payload]),/market_gate_6181:insufficient_available_balance/);
  assert.equal((await one(db,'SELECT balance::int FROM teams WHERE id=$1',[B])).balance,1000000);
  assert.equal((await one(db,'SELECT count(*)::int AS n FROM finance_transactions')).n,0);
});

test('ordinary beta auction creation rechecks seller ownership and outgoing floor under the team lock',async t=>{
 const db=await database(t);
 await db.exec(`INSERT INTO riders(id,team_id) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${A}' FROM generate_series(201,209)n`);
 const data={rider_id:id(201),seller_team_id:A,starting_price:100000,current_price:100000,current_bidder_id:null,min_increment:1000,calculated_end:'2026-11-10T14:00:00Z',is_flash:false};
 const create=async()=>(await db.query('SELECT create_market_auction_2176($1,$2,8,$3) AS r',[data,A,[]])).rows[0].r;
 assert.equal((await create()).status,'created');
 data.rider_id=id(202);assert.equal((await create()).status,'seller_squad_floor');
 await db.exec(`UPDATE riders SET team_id='${B}' WHERE id='${id(203)}'`);data.rider_id=id(203);assert.equal((await create()).status,'rider_state_changed');
});
