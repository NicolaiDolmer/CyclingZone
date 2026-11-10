import test from 'node:test';
import assert from 'node:assert/strict';
import { betaDatabase2176 as database } from './__fixtures__/marketBeta2176Db.js';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const A=id(1),B=id(2),C=id(3),D=id(4),R=id(201),DEAL=id(901),AUCTION=id(700);
const NOW='2026-11-10T10:00:00Z',END='2026-11-10T14:00:00Z';
const one=async(db,sql,params=[])=>(await db.query(sql,params)).rows[0];
const scalar=async(db,sql,params=[])=>(await one(db,sql,params)).n;
const balance=(db,team)=>scalar(db,'SELECT balance::int AS n FROM teams WHERE id=$1',[team]);
const owner=(db,rider=R)=>scalar(db,'SELECT team_id AS n FROM riders WHERE id=$1',[rider]);
async function squad(db,team,count=12,first=201){await db.exec(`INSERT INTO riders(id,team_id) SELECT
 ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${team}' FROM generate_series(${first},${first+count-1}) n;`);}
async function hold(db,team=B){await db.exec(`INSERT INTO auctions(id,rider_id,seller_team_id,current_price,current_bidder_id,requested_start,calculated_end,origin,source_listing_id,buyer_duration_minutes)
 VALUES('${AUCTION}','${id(101)}','${D}',400000,'${team}','${NOW}','${END}','auto_accept','${id(701)}',60);`);}
function payload(side,deal='transfer',amount=600000){return{type:side==='payer'?'transfer_out':'transfer_in',amount:side==='payer'?-amount:amount,
 description:'fixture',actor_type:'api',source_path:`transferExecution.execute${deal==='transfer'?'TransferOffer':'SwapOffer'}.${side}`,
 reason_code:deal==='transfer'?(side==='payer'?'transfer_purchase':'transfer_sale'):'swap_cash_delta',related_entity_type:deal,related_entity_id:DEAL,
 idempotency_key:`${deal==='transfer'?(side==='payer'?'transfer_buyer':'transfer_seller'):(side==='payer'?'swap_payer':'swap_receiver')}:${DEAL}`};}
async function buy(db,{parked=false,price=600000}={}){return(await one(db,`SELECT auto_accept_claim_transfer_paid(
 $1,$2,$3,$4,$5,'{}',8,'{}',30,$6,$7,$8,$9,'{}') AS r`,[R,D,B,parked,NOW,price,DEAL,payload('payer','transfer',price),payload('payee','transfer',price)])).r;}

test('beta transfer pays within the claim, including a non-beta writer before first public participation',async t=>{
 const db=await database(t);await squad(db,D);
 assert.equal((await buy(db)).payment_handled,true);
 assert.equal(await owner(db),B);assert.equal(await balance(db,B),400000);assert.equal(await balance(db,D),1600000);
 assert.equal((await buy(db)).status,'rider_state_changed');assert.equal(await scalar(db,'SELECT count(*)::int AS n FROM finance_transactions'),2);
});

test('ordinary non-beta transfer does not acquire new auction-seat or seller-outgoing rules',async t=>{
 const db=await database(t);await squad(db,D);await squad(db,B,29,400);
 await db.exec(`INSERT INTO auctions(rider_id,seller_team_id,current_price,current_bidder_id,calculated_end)
 VALUES('${id(250)}','${A}',100000,'${B}','${END}'),('${id(251)}','${A}',100000,'${B}','${END}');
 INSERT INTO auctions(rider_id,seller_team_id,current_price,current_bidder_id,calculated_end)
 SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${D}',100000,'${C}','${END}' FROM generate_series(202,207)n;`);
 assert.equal((await buy(db)).status,'claimed');assert.equal(await owner(db),B);
});

test('protected non-beta transfer rechecks money and preserves parked escrow/refund restoration',async t=>{
 const db=await database(t);await squad(db,D);await hold(db);
 assert.equal((await buy(db,{price:700000})).status,'buyer_insufficient_balance');assert.equal(await owner(db),D);
 await db.exec(`INSERT INTO app_config(key,value) VALUES('sale_escrow_enabled','"on"') ON CONFLICT(key)DO UPDATE SET value=excluded.value;`);
 assert.equal((await buy(db,{parked:true,price:500000})).payment_handled,true);
 assert.equal(await balance(db,B),500000);assert.equal(await balance(db,D),1000000);
 const escrow=await one(db,'SELECT id,status FROM sale_escrows');assert.equal(escrow.status,'held');
 assert.equal((await one(db,`SELECT settle_sale_escrow($1,'refund','{"type":"transfer_in","description":"refund","source_path":"test.refund"}',$2) AS r`,[escrow.id,NOW])).r.status,'refunded');
 assert.equal(await owner(db),D);assert.equal(await balance(db,B),1000000);assert.equal((await buy(db)).status,'rider_state_changed');
});

const release=async(db,{academy=false,fee=800000}={})=>(await one(db,`SELECT auto_accept_release_paid_2176($1,$2,8,'{}',$3,$4,$5) AS r`,
 [R,B,academy,fee,{type:'transfer_out',amount:-fee,actor_type:'api',source_path:academy?'api.academy.release':'api.riders.release',reason_code:'rider_release_buyout'}])).r;
for(const academy of [false,true])test(`beta release academy=${academy}: refused fee moves no rider; successful fee is atomic`,async t=>{
 const db=await database(t);await squad(db,B);await hold(db);
 if(academy)await db.exec(`UPDATE riders SET is_academy=true,squad='u23' WHERE id='${R}'`);
 assert.equal((await release(db,{academy})).status,'insufficient_available_balance');assert.equal(await owner(db),B);assert.equal(await balance(db,B),1000000);
 const done=await release(db,{academy,fee:300000});assert.equal(done.payment_handled,true);assert.equal(done.status,'released');
 assert.equal(await owner(db),null);assert.equal(await balance(db,B),700000);
});

async function swap(db,{parked=false,amount=600000}={}){const pay={payer_team_id:B,payee_team_id:D,amount,
 payer_payload:payload('payer','swap',amount),payee_payload:payload('payee','swap',amount),rider_restore:{}};
 return(await one(db,`SELECT auto_accept_claim_swap_paid($1,$2,$3,$4,$5,$6,'{}','{}',$7,$8,$9) AS r`,[id(400),R,B,D,parked,NOW,DEAL,amount,pay])).r;}
test('cash swap protects public binding, then moves both legs and money together',async t=>{
 const db=await database(t);await squad(db,D);await squad(db,B,1,400);await hold(db);
 assert.equal((await swap(db,{amount:700000})).status,'payer_insufficient_balance');
 assert.equal(await owner(db,id(400)),B);assert.equal(await owner(db),D);
 assert.equal((await swap(db,{amount:500000})).payment_handled,true);
 assert.equal(await owner(db,id(400)),D);assert.equal(await owner(db),B);assert.equal(await balance(db,B),500000);assert.equal(await balance(db,D),1500000);
});

test('scout assignment and debit rollback together when an auto-auction binding wins',async t=>{
 const db=await database(t);await hold(db);
 const data={team_id:B,kind:'mission',mission_criteria:{scope:'country',value:'DK'},travel_cost:800000,started_on:'2026-11-10',ready_on:'2026-11-12',season_id:null};
 const audit={type:'scout_travel',amount:-800000,description:null,actor_type:'cron',actor_id:null,source_path:'scoutAssignmentService.startMission',reason_code:'scout_travel',metadata:{code:'tx.scoutTravel',params:{kind:'mission'}}};
 await assert.rejects(db.query('SELECT market_scout_assignment_2176($1,$2,$3)',[B,data,audit]),/market_gate_6181:insufficient_available_balance/);
 assert.equal(await scalar(db,'SELECT count(*)::int AS n FROM scout_assignments'),0);assert.equal(await balance(db,B),1000000);
 data.travel_cost=300000;audit.amount=-300000;
 assert.equal((await one(db,'SELECT market_scout_assignment_2176($1,$2,$3) AS r',[B,data,audit])).r.status,'created');
 assert.equal(await scalar(db,'SELECT count(*)::int AS n FROM scout_assignments'),1);assert.equal(await balance(db,B),700000);
});

test('a late receiver audit failure rolls back both swap riders and the payer ledger',async t=>{
 const db=await database(t);await squad(db,D);await squad(db,B,1,400);
 await db.exec(`CREATE FUNCTION test_late_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.team_id='${D}' THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN NEW; END; $$;
 CREATE TRIGGER test_late_audit_failure AFTER INSERT ON finance_transactions FOR EACH ROW EXECUTE FUNCTION test_late_audit_failure();`);
 await assert.rejects(swap(db,{amount:500000}),/synthetic_audit_failure/);
 assert.equal(await owner(db,id(400)),B);assert.equal(await owner(db),D);
 assert.equal(await balance(db,B),1000000);assert.equal(await balance(db,D),1000000);
 assert.equal(await scalar(db,'SELECT count(*)::int AS n FROM finance_transactions'),0);
});

test('a release audit failure restores ownership and contract fields in the same transaction',async t=>{
 const db=await database(t);await squad(db,B);
 const before=await one(db,'SELECT team_id,salary,contract_length,contract_end_season,acquired_at FROM riders WHERE id=$1',[R]);
 await db.exec(`CREATE FUNCTION test_release_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'synthetic_release_audit_failure'; END; $$;
 CREATE TRIGGER test_release_audit_failure AFTER INSERT ON finance_transactions FOR EACH ROW EXECUTE FUNCTION test_release_audit_failure();`);
 await assert.rejects(release(db,{fee:300000}),/synthetic_release_audit_failure/);
 assert.deepEqual(await one(db,'SELECT team_id,salary,contract_length,contract_end_season,acquired_at FROM riders WHERE id=$1',[R]),before);
 assert.equal(await balance(db,B),1000000);
});

test('beta cash swap parks both riders with one escrow and does not pay twice',async t=>{
 const db=await database(t);await squad(db,D);await squad(db,B,1,400);
 await db.exec(`INSERT INTO app_config(key,value) VALUES('sale_escrow_enabled','"on"') ON CONFLICT(key)DO UPDATE SET value=excluded.value`);
 assert.equal((await swap(db,{parked:true,amount:500000})).payment_handled,true);
 assert.equal(await owner(db,id(400)),B);assert.equal(await owner(db),D);
 assert.equal((await one(db,'SELECT pending_team_id FROM riders WHERE id=$1',[id(400)])).pending_team_id,D);
 assert.equal((await one(db,'SELECT pending_team_id FROM riders WHERE id=$1',[R])).pending_team_id,B);
 assert.equal(await balance(db,B),500000);assert.equal(await balance(db,D),1000000);
 assert.equal((await swap(db,{parked:true,amount:500000})).status,'rider_state_changed');
 assert.equal(await scalar(db,'SELECT count(*)::int AS n FROM sale_escrows'),1);
 assert.equal(await scalar(db,'SELECT count(*)::int AS n FROM finance_transactions'),1);
});

for(const stage of ['"on"','true'])test(`AA beta with global M3=${stage} preserves atomic payments`,async t=>{
 const db=await database(t);await squad(db,D);await squad(db,B,12,400);await hold(db);
 await db.exec(`UPDATE app_config SET value='${stage}' WHERE key='market_commitment_6181'`);
 assert.equal((await one(db,'SELECT market_beta_mode_2176() AS enabled')).enabled,true);
 assert.equal((await one(db,`SELECT auto_accept_release_paid_2176($1,$2,8,'{}',false,800000,$3) AS r`,
   [id(400),B,{type:'transfer_out',amount:-800000,reason_code:'rider_release_buyout'}])).r.status,'insufficient_available_balance');
 assert.equal(await owner(db),D);
 assert.equal((await buy(db,{price:500000})).payment_handled,true);
 assert.equal(await owner(db),B);assert.equal(await balance(db,B),500000);
});

test('every new beta helper/payment RPC is service-only after repeated migration apply',async t=>{
 const db=await database(t);
 const names=['market_team_beta_2176','auto_accept_pair_2176','market_transport_2176','market_beta_mode_2176',
   'market_scope_2176','market_bid_issue_scoped_2176','auto_accept_outgoing_2176',
   'auto_accept_release_paid_2176','auto_accept_claim_swap_paid','market_scout_assignment_2176','create_market_auction_2176'];
 const rows=(await db.query(`SELECT p.proname,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
   has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
   has_function_privilege('service_role',p.oid,'EXECUTE') AS service
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1)`,[names])).rows;
 assert.deepEqual(new Set(rows.map(row=>row.proname)),new Set(names));
 for(const row of rows){assert.equal(row.anon,false,row.proname);assert.equal(row.authenticated,false,row.proname);assert.equal(row.service,true,row.proname);}
});

test('service role can use paid release and public bid triggers without direct trigger-function grants',async t=>{
 const db=await database(t);await squad(db,B);
 await db.exec(`INSERT INTO auctions(id,rider_id,seller_team_id,current_price,requested_start,calculated_end,origin,source_listing_id,buyer_duration_minutes)
 VALUES('${AUCTION}','${id(101)}','${D}',1,'${NOW}','${END}','auto_accept','${id(701)}',60);
 SET ROLE service_role;`);
 try {
   assert.equal((await one(db,'SELECT place_auction_bid_6181($1,$2,600000,$3) AS r',[AUCTION,B,NOW])).r.placed,true);
   assert.equal((await release(db,{fee:300000})).payment_handled,true);
 } finally {await db.exec('RESET ROLE');}
 assert.equal(await balance(db,B),700000);assert.equal(await owner(db),null);
});
