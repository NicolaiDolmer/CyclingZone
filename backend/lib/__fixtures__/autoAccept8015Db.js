import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareBetaDatabase2176 } from './marketBeta2176Db.js';
const migration = () => readFile(new URL('../../../database/2026-11-11-8015-auto-accept-academy-riders.sql', import.meta.url),'utf8');
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const B=id(2),D=id(4),R=id(101),L=id(701),DEAL=id(901);
const NOW='2026-11-11T10:00:00Z',END='2026-11-11T14:00:00Z';
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
const json=x=>quote(JSON.stringify(x))+'::jsonb';
const signatures=`SELECT p.oid::regprocedure::text AS signature,p.proacl::text AS acl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) AS definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
 ('set_listing_auto_accept_price','start_auto_accept_auction','start_auto_accept_auction_bid','auto_accept_claim_transfer','auto_accept_release_rider','create_market_auction_2176') ORDER BY 1`;
export async function verifyAutoAccept8015(db,{ productionDefinitions }={}) {
  await prepareBetaDatabase2176(db);
  if(productionDefinitions) for(const row of productionDefinitions) await db.exec(row.definition);
  const one=async source=>(await db.query(source)).rows[0];
  const result=async source=>(await one('SELECT '+source+' AS r')).r;
  await db.exec(`UPDATE users SET is_beta_tester=true WHERE id IN('${B}','${D}'); UPDATE riders SET is_academy=true,squad='junior' WHERE id='${R}';`);
  const price=()=>result(`set_listing_auto_accept_price('${L}','${D}',500000,NULL,'${D}')`);
  assert.equal((await price()).status,'rider_is_academy','negative control on current definitions');
  const before=(await db.query(signatures)).rows;
  const source=await migration();await db.exec(source);
  const after=(await db.query(signatures)).rows;
  const metadata = row => { const value={...row};delete value.definition;return value; };
  assert.deepEqual(after.map(metadata),before.map(metadata),'ACL, identity, security and search_path unchanged');
  await db.exec(source);
  assert.deepEqual((await db.query(signatures)).rows,after,'reapplication changes nothing');
  const reset=async(mode,academy=true,squad='junior')=>{
    await db.exec(`TRUNCATE sale_escrows,finance_transactions,auction_bids,auction_proxy_bids,auctions,transfer_listing_price_log,transfer_listings,swap_offers,riders CASCADE;
      UPDATE teams SET balance=1000000; UPDATE app_config SET value='"${mode}"' WHERE key IN('auto_accept_enabled','market_commitment_6181');
      INSERT INTO riders(id,team_id,is_academy,squad,contract_end_season) VALUES('${R}','${D}',${academy},'${squad}',1);
      INSERT INTO transfer_listings(id,rider_id,seller_team_id,asking_price) VALUES('${L}','${R}','${D}',100000);`);
  };
  for(const mode of ['beta','on']) for(const squad of ['junior','u23','senior']) {
    await reset(mode,true,squad);
    assert.equal((await price()).status,'updated');
    const started=await result(`start_auto_accept_auction_bid('${L}','${B}','${R}','${D}',
      '{"market_value":1000000,"base_value":1000000,"prize_earnings_bonus":0}',500000,60,'${END}',30,0,'{}','${NOW}',500000)`);
    assert.equal(started.status,'started',mode+'/'+squad);
    assert.deepEqual(await one(`SELECT team_id,is_academy,squad FROM riders WHERE id='${R}'`),{team_id:D,is_academy:true,squad},'listing/start must not graduate');
    await db.exec(`UPDATE auctions SET status='completed' WHERE id='${started.auction_id}'`);
    const payload=side=>({type:side==='buyer'?'transfer_out':'transfer_in',amount:side==='buyer'?-500000:500000,
      description:'synthetic sale',source_path:'test.8015.'+side,reason_code:side==='buyer'?'transfer_purchase':'transfer_sale',
      idempotency_key:'transfer_'+side+':'+DEAL,related_entity_type:'transfer',related_entity_id:DEAL});
    const claim=()=>result(`auto_accept_claim_transfer_paid('${R}','${D}','${B}',false,'${NOW}',
      '{"is_academy":false,"squad":"senior"}',0,'{}',30,500000,'${DEAL}',${json(payload('buyer'))},${json(payload('seller'))},'{}')`);
    assert.equal((await claim()).payment_handled,true);
    assert.deepEqual(await one(`SELECT team_id,is_academy,squad FROM riders WHERE id='${R}'`),{team_id:B,is_academy:false,squad:'senior'});
    assert.equal(Number((await one(`SELECT count(*) AS n FROM riders WHERE team_id='${D}'`)).n),0);
    assert.equal(Number((await one(`SELECT balance FROM teams WHERE id='${B}'`)).balance),500000);
    assert.equal(Number((await one(`SELECT balance FROM teams WHERE id='${D}'`)).balance),1500000);
    assert.equal((await claim()).status,'rider_state_changed');
    assert.equal(Number((await one('SELECT count(*) AS n FROM finance_transactions')).n),2);
  }
  for(const mode of ['off','beta','on']) for(const squad of ['senior','u23','junior']) {
    await reset(mode,false,squad);
    assert.equal((await result(`auto_accept_release_rider('${R}','${D}',0,ARRAY['${R}']::uuid[])`)).status,'released');
    assert.equal((await one(`SELECT team_id FROM riders WHERE id='${R}'`)).team_id,null);
    await reset(mode,true,squad);
    const auction={id:id(750),rider_id:R,seller_team_id:D,starting_price:500000,current_price:500000,min_increment:1,is_flash:false,requested_start:NOW,calculated_end:END};
    assert.equal((await result(`create_market_auction_2176(${json(auction)},'${D}',0,'{}')`)).status,mode==='beta'?'created':'legacy');
  }
  return { productionDefinitions:productionDefinitions?.length||0,graduatedTransferClaims:6,releaseCases:9,auctionCases:9,aclUnchanged:true,idempotent:true };
}
