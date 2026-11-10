// Separate PostgreSQL 17 connections: PGlite cannot establish concurrency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { prepareBetaDatabase2176 } from './__fixtures__/marketBeta2176Db.js';

const PG = process.env.AUTO_ACCEPT_PG_BIN;
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const A=id(1),B=id(2),D=id(4),R=id(201),DEAL=id(901);
const NOW='2026-11-10T10:00:00Z',END='2026-11-10T14:00:00Z';
const quote = value => `'${String(value).replaceAll("'","''")}'`;
const json = value => quote(JSON.stringify(value))+'::jsonb';

test('PG17 beta: first public participation serializes every discretionary writer', {
  skip: !PG && 'AUTO_ACCEPT_PG_BIN is not set', timeout:600000,
}, async t => {
  function run(binary,args,input) {
    const out=spawnSync(join(PG,binary),args,{input,encoding:'utf8',windowsHide:true,
      env:{...process.env,PGCLIENTENCODING:'UTF8'},timeout:binary==='initdb'?120000:30000});
    assert.equal(out.status,0,`${binary}: ${out.error?.message||out.stderr}`); return out.stdout;
  }
  const version=run('psql',['--version']).trim();assert.match(version,/PostgreSQL\) 17\./);
  const temporaryRoot=resolve(tmpdir());
  const directory=await mkdtemp(join(temporaryRoot,'market-beta-pg17-'));
  const data=join(directory,'data'),port=58000+Math.floor(Math.random()*1000);
  const args=['-X','-q','-t','-A','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
  const sql=source=>run('psql',args,`SET statement_timeout='15s'; ${source}`);
  const one=source=>JSON.parse(sql(source).trim());
  function connection(source) {
    return new Promise((done,fail)=>{
      const child=spawn(join(PG,'psql'),args,{windowsHide:true,env:{...process.env,PGCLIENTENCODING:'UTF8'}});
      let stdout='',stderr='';child.stdout.on('data',x=>{stdout+=x;});child.stderr.on('data',x=>{stderr+=x;});
      child.on('error',fail);child.on('close',code=>{
        if(code!==0)fail(new Error(`concurrent SQL (${code}): ${stderr}`));
        else {try{done(JSON.parse(stdout.trim()));}catch(error){fail(error);}}
      });child.stdin.end(`SET statement_timeout='15s'; ${source}`);
    });
  }
  let started=false;
  try {
    run('initdb',['-D',data,'-U','postgres','-A','trust','-E','UTF8','--locale=C']);
    const server=spawnSync(join(PG,'pg_ctl'),['-D',data,'-o',`-p ${port} -c listen_addresses=127.0.0.1 -c max_connections=20`,'-w','-l',join(directory,'pg.log'),'start'],{windowsHide:true,stdio:'ignore',timeout:30000});
    assert.equal(server.status,0,'native PG17 must start');started=true;
    await prepareBetaDatabase2176({exec:async source=>sql(source)});
    // Convert only the specified business refusal to a result. Unexpected SQL,
    // timeouts and deadlocks remain failures, including in negative controls.
    sql(`CREATE FUNCTION test_attempt(p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE result jsonb; BEGIN EXECUTE p_sql INTO result; RETURN result;
      EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM<>'market_gate_6181:insufficient_available_balance' THEN RAISE; END IF;
        RETURN '{"status":"insufficient_available_balance"}'::jsonb;
      END; $$;`);
    const reset=()=>sql(`TRUNCATE scout_assignments,sale_escrows,finance_transactions,auction_bids,auction_proxy_bids,
      auctions,transfer_listing_price_log,transfer_listings,swap_offers,riders CASCADE;
      UPDATE teams SET balance=1000000; UPDATE users SET is_beta_tester=(id='${A}');
      UPDATE app_config SET value='"beta"' WHERE key IN('auto_accept_enabled','market_commitment_6181');
      INSERT INTO riders(id,team_id) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${D}' FROM generate_series(201,220)n;
      INSERT INTO riders(id,team_id) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${B}' FROM generate_series(401,412)n;
      INSERT INTO riders(id,team_id) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${A}' FROM generate_series(600,619)n;
      INSERT INTO transfer_listings(id,rider_id,seller_team_id,asking_price) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('00000000-0000-0000-0000-'||lpad((n-100)::text,12,'0'))::uuid,'${A}',1 FROM generate_series(700,706)n;
      INSERT INTO auctions(id,rider_id,seller_team_id,current_price,requested_start,calculated_end,origin,buyer_duration_minutes,source_listing_id)
        SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
        ('00000000-0000-0000-0000-'||lpad((n-100)::text,12,'0'))::uuid,'${A}',1,'${NOW}','${END}','auto_accept',60,('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(700,706)n;
      INSERT INTO auctions(id,rider_id,seller_team_id,current_price,requested_start,calculated_end)
        VALUES('${id(710)}','${id(230)}','${A}',1,'${NOW}','${END}');`);
    const attempt=operation=>`SELECT test_attempt(${quote(operation)})`;
    const bid=(n=700)=>`SELECT place_auction_bid_6181('${id(n)}','${B}',600000,'${NOW}')`;
    const proxy=(n=700)=>`SELECT set_auction_proxy_context_6181('${id(n)}','${B}',600000,NULL,'${NOW}')`;
    const audit=(side,kind='transfer')=>({type:side==='payer'?'transfer_out':'transfer_in',amount:side==='payer'?-600000:600000,
      description:'synthetic',source_path:`test.${kind}.${side}`,reason_code:kind==='transfer'?(side==='payer'?'transfer_purchase':'transfer_sale'):'swap_cash_delta',
      idempotency_key:`${kind==='transfer'?(side==='payer'?'transfer_buyer':'transfer_seller'):(side==='payer'?'swap_payer':'swap_receiver')}:${DEAL}`});
    const debit=type=>`SELECT to_jsonb(increment_balance_with_audit('${B}',-600000,${json({type,amount:-600000,description:'synthetic',source_path:'test.purchase'})}))`;
    const operations={
      ordinaryBid:bid(710),ordinaryProxy:proxy(710),
      transfer:`SELECT auto_accept_claim_transfer_paid('${R}','${D}','${B}',false,'${NOW}','{}',8,'{}',30,600000,'${DEAL}',${json(audit('payer'))},${json(audit('payee'))},'{}')`,
      cashSwap:`SELECT auto_accept_claim_swap_paid('${id(401)}','${R}','${B}','${D}',false,'${NOW}','{}','{}','${DEAL}',600000,${json({payer_team_id:B,payee_team_id:D,amount:600000,payer_payload:audit('payer','swap'),payee_payload:audit('payee','swap'),rider_restore:{}})})`,
      release:`SELECT auto_accept_release_paid_2176('${id(401)}','${B}',8,'{}',false,600000,${json({type:'transfer_out',amount:-600000,reason_code:'rider_release_buyout',source_path:'api.riders.release'})})`,
      scouting:`SELECT market_scout_assignment_2176('${B}',${json({team_id:B,kind:'mission',mission_criteria:{scope:'country',value:'DK'},travel_cost:600000,started_on:'2026-11-10',ready_on:'2026-11-12'})},${json({type:'scout_travel',amount:-600000,actor_type:'cron',source_path:'scoutAssignmentService.startMission',reason_code:'scout_travel'})})`,
      facility:debit('facility_purchase'),severance:debit('staff_severance'),
    };
    const state=()=>one(`SELECT jsonb_build_object('balance',balance,'locked',team_market_commitment('${B}',NULL),
      'finance',(SELECT count(*) FROM finance_transactions),'scouts',(SELECT count(*) FROM scout_assignments),
      'owner',(SELECT team_id FROM riders WHERE id='${R}'),'released',(SELECT team_id IS NULL FROM riders WHERE id='${id(401)}'),
      'public',(SELECT count(*) FROM auctions WHERE origin='auto_accept' AND current_bidder_id='${B}'),
      'proxy',(SELECT count(*) FROM auction_proxy_bids WHERE team_id='${B}' AND max_amount>0)) FROM teams WHERE id='${B}'`);
    let attempts=0;
    for(const [name,operation]of Object.entries(operations)) {
      // Exercise both winning orders separately before the simultaneous starts.
      for(const publicFirst of [false,true]) {
        reset();one(attempt(publicFirst?bid():operation));one(attempt(publicFirst?operation:bid()));
        const end=state();assert.ok(end.locked<=end.balance,`${name}/${publicFirst}: ${JSON.stringify(end)}`);
        assert.ok(end.public+(end.proxy>0?1:0)<=1);
      }
      for(let round=0;round<5;round++) {
        reset();const publicOperations=Array.from({length:7},(_,i)=>round%2?proxy(700+i):bid(700+i));
        await Promise.all([operation,...publicOperations].map(op=>connection(attempt(op))));attempts+=8;
        const end=state();assert.ok(end.locked<=end.balance,`${name}: ${JSON.stringify(end)}`);
        assert.ok(end.public+(end.proxy>0?1:0)<=1);
        if(end.public||end.proxy){assert.equal(end.finance,0);assert.equal(end.scouts,0);assert.equal(end.owner,D);assert.equal(end.released,false);}
        if(name==='transfer'&&end.owner===B)assert.equal(end.finance,2);
        if(name==='scouting'&&end.scouts)assert.equal(end.finance,1);
      }
    }
    // AA beta also supports an already-global M3. The same payment envelope
    // must remain selected for both accepted global representations.
    for(const stage of ['"on"','true'])for(const name of ['transfer','cashSwap','release']) {
      for(const publicFirst of [false,true]) {
        reset();sql(`UPDATE app_config SET value='${stage}' WHERE key='market_commitment_6181'`);
        one(attempt(publicFirst?bid():operations[name]));one(attempt(publicFirst?operations[name]:bid()));
        const end=state();assert.ok(end.locked<=end.balance,`mixed ${stage}/${name}: ${JSON.stringify(end)}`);
      }
      reset();sql(`UPDATE app_config SET value='${stage}' WHERE key='market_commitment_6181'`);
      await Promise.all([operations[name],...Array.from({length:7},(_,i)=>bid(700+i))].map(op=>connection(attempt(op))));attempts+=8;
      const end=state();assert.ok(end.locked<=end.balance);
      if(end.public){assert.equal(end.finance,0);assert.equal(end.owner,D);assert.equal(end.released,false);}
    }
    // Protected seller floor: ordinary auction creation and release share the
    // lock and cannot both consume the final outgoing allowance.
    reset();sql(`UPDATE users SET is_beta_tester=true WHERE id='${D}'; DELETE FROM riders WHERE team_id='${D}' AND id>'${id(209)}'`);
    const sellerCreate=`SELECT create_market_auction_2176(${json({rider_id:id(202),seller_team_id:D,starting_price:1,current_price:1,current_bidder_id:null,min_increment:1,calculated_end:END,is_flash:false})},'${D}',8,'{}')`;
    const sellerRelease=`SELECT auto_accept_release_paid_2176('${R}','${D}',8,'{}',false,0,NULL)`;
    const sellerResults=await Promise.all([sellerCreate,sellerRelease].map(op=>connection(attempt(op))));
    assert.equal(sellerResults.filter(row=>['created','released'].includes(row.status)).length,1);
    assert.equal(sellerResults.filter(row=>['seller_squad_floor','squad_floor'].includes(row.status)).length,1);
    // Auto creation OFF must not abandon an already public obligation, even
    // after beta revocation. Ordinary nonparticipants keep their old DB gate.
    reset();one(attempt(bid()));sql(`UPDATE app_config SET value='"off"' WHERE key='auto_accept_enabled'; UPDATE users SET is_beta_tester=false;`);
    assert.equal(one(attempt(operations.release)).status,'insufficient_available_balance');
    reset();sql(`UPDATE auctions SET origin='standard',source_listing_id=NULL,buyer_duration_minutes=NULL WHERE id='${id(700)}'`);
    one(attempt(bid()));one(attempt(debit('facility_purchase')));assert.equal(state().balance,400000);
    // Negative control: the former separate ownership statement commits before
    // a later rejected debit, proving why the atomic release RPC is necessary.
    reset();one(attempt(bid()));sql(`UPDATE riders SET team_id=NULL WHERE id='${id(401)}'`);
    assert.equal(one(attempt(`SELECT to_jsonb(increment_balance_with_audit('${B}',-600000,${json({type:'transfer_out',amount:-600000,reason_code:'rider_release_buyout'})}))`)).status,'insufficient_available_balance');
    assert.equal(state().released,true);assert.equal(state().finance,0);
    assert.equal(one("SELECT deadlocks FROM pg_stat_database WHERE datname='postgres'"),0);
    t.diagnostic(`${version}; deterministic_orders=28; concurrent_attempts=${attempts}; seller_floor_race=passed; connections=8; overbooked=0; deadlocks=0; old_release_negative_control=reproduced`);
  } finally {
    if(started){run('pg_ctl',['-D',data,'-m','fast','-w','-t','120','stop']);
      const status=spawnSync(join(PG,'pg_ctl'),['-D',data,'status'],{windowsHide:true,stdio:'ignore',timeout:30000});
      assert.equal(status.status,3,'PG17 must positively report stopped');t.diagnostic('temporary_pg17_server_stopped=true');}
    assert.equal(dirname(resolve(directory)),temporaryRoot,'temporary cluster cleanup stays within temp root');
    await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:250});
  }
});
