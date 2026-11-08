import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as rules from './auctionRules.ts';
import * as market from './marketCommitment6181.js';
import { getSquadRiskViolation } from './marketUtils.js';
import { computeReleaseBuyoutFee } from './contractSeed.js';
import { getParkedRiderReleaseIssue } from './parkedRiderGuard6181.js';
import { isLateBidTriggerError } from './auctionEngine.js';

// Execute the registered production handlers, with the real M3 helpers and a
// database boundary double. SQL transaction/concurrency is tested separately.
const source = readFileSync(new URL('../routes/api.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const NOW = Date.parse('2026-11-08T15:00:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
const TEAM = '00000000-0000-0000-0000-000000000001';
const AUCTION = '00000000-0000-0000-0000-000000000011';
const RIDER = '00000000-0000-0000-0000-000000000021';
const moneyError = { code: 'P0001', message: 'market_gate_6181:insufficient_available_balance' };

function fixture({ flag = 'off', flagError = false, proxyError = null, bidError = null, startError = null, futureCount = 10, outgoing = 0, afterBidInsert = null } = {}) {
  const auction = { id: AUCTION, rider_id: RIDER, current_price: 100, current_bidder_id: null,
    status: 'active', calculated_end: '2026-11-08T18:00:00Z', seller_team_id: 'other', is_youth: false,
    rider: { id: RIDER, firstname: 'Test', lastname: 'Rider', team_id: null } };
  const rider = { id: RIDER,firstname:'Test',lastname:'Rider',team_id:null,is_retired:false,is_academy:false,pending_team_id:null,salary:0,contract_end_season:5 };
  const bids = []; const proxies = []; const writes = []; const createdAuctions=[];
  const teamState = { id: TEAM, balance: 10000, total_count: futureCount, future_count: futureCount, squad_limits: { min: 0, max: 30 } };
  const client = {
    from(table) {
      let action = 'select'; let payload; const filters = [];
      const query = {
        select() { return query; }, eq(k,v) { filters.push([k,v]); return query; },
        in() { return query; }, is() { return query; }, neq() { return query; }, order() { return query; }, limit() { return query; },
        lt(k,v) { filters.push(['lt',k,v]); return query; },
        insert(v) { action='insert'; payload=v; return query; },
        upsert(v) { action='upsert'; payload=v; return query; },
        update(v) { action='update'; payload=v; return query; },
        delete() { action='delete'; return query; },
        single: async () => run(true), maybeSingle: async () => run(true),
        then(resolve,reject) { return Promise.resolve(run(false)).then(resolve,reject); },
      };
      function run(single) {
        if (action !== 'select') {
          writes.push({ table, action });
          if (table==='auction_bids' && bidError) return { data:null, error:bidError };
          if (table==='auction_proxy_bids' && proxyError) return { data:null, error:proxyError };
          if (table==='auctions' && action==='insert') {
            if(startError) return {data:null,error:startError};
            const created={id:AUCTION,...payload};createdAuctions.push(created);return {data:created,error:null};
          }
          if (table==='auction_bids') {
            bids.push(payload);
            if (market.isMarketCommitmentValueOn(flag)) Object.assign(auction,{current_price:payload.amount,current_bidder_id:payload.team_id});
            if (afterBidInsert) Object.assign(auction,afterBidInsert);
          }
          if (table==='auction_proxy_bids') proxies.push(payload);
          if (table==='riders') {Object.assign(rider,payload);return {data:[{id:RIDER}],error:null};}
          if (table==='auctions' && !filters.some(f=>f[0]==='lt' && auction[f[1]]>=f[2])) Object.assign(auction,payload);
          return { data:[], error:null };
        }
        if (table==='app_config') return { data: flagError ? null : {value:flag}, error:flagError ? {message:'flag unavailable'} : null };
        if (table==='auctions') return { data:single ? (filters.some(f=>f[0]==='rider_id') ? null : auction) : [], count:0,error:null };
        if (table==='teams') return {data:single ? teamState : [teamState],error:null};
        if (table==='riders') return {data:single ? rider : [],error:null};
        if (table==='seasons') return {data:{id:'season',number:5},error:null};
        if (table==='auction_proxy_bids') return {data:single ? null : proxies,error:null};
        return { data:single ? null : [],error:null };
      }
      return query;
    },
    async rpc(name) {
      if (name==='team_market_commitment') return {data:0,error:null};
      if (name==='team_outgoing_auction_rider_ids') return {data:Array.from({length:outgoing},(_,i)=>`outgoing-${i}`),error:null};
      if (name==='market_bid_issue_6181') return {data:null,error:null};
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const cascade = [];
  const context = {
    ...rules,...market,Date:FixedDate,console,isLateBidTriggerError,
    supabase:client, requireAuth(){},bidLimiter(){},marketWriteLimiter(){},
    assertMarketOpen:async()=>true,assertTeamNotTransferFrozen:()=>true,
    isAuctionExpired:end=>Date.parse(end)<=NOW,
    fetchTeamCommitment:async()=>({leadingAuctions:[],allMyProxies:[]}),
    getTeamMarketState:async()=>structuredClone(teamState),
    assertSigningAllowed:async()=>null, getAuctionConfig:async()=>({}),
    recordIdentityEvent(){}, awardXP:async()=>{}, notifyTeamOwnerBuilt:async()=>{},notifyTeamOwner:async()=>{},
    notifyOutbid:async()=>{},transferNotif:{},
    applyLeaderShiftExtension:async()=>({extensionApplied:false,newEnd:null}),
    getActiveSeasonNumber:async()=>5,fetchSeasonTransitionBoundary:async()=>null,
    calculateRiderMarketValue:()=>100,calculateAuctionEnd:()=>new FixedDate('2026-11-09T15:00:00Z'),
    getAuctionSeasonBoundaryIssue:()=>null,FREE_AGENT_MIN_DURATION_HOURS:12,
    fetchOwnProxiesByAuctionId:async()=>new Map(),
    safePauseTransferListingsForAuction:async()=>{},logActivity:async()=>{},notifyNewAuction:async()=>{},
    loadOwnedSeniorRiderForAction:async()=>({rider}),getParkedRiderReleaseIssue,
    assertRiderNotOnActiveAuction:async()=>({}),computeReleaseBuyoutFee,
    fetchAtRiskRiders:async()=>[],getSquadRiskViolation,
    buildAtRiskErrorParams:issue=>({minRiders:issue.minRiders}),invalidateNamespace(){},
    resolveProxyBids:async args=>{cascade.push(args);return {finalLeaderId:auction.current_bidder_id,outbidNotified:new Set()};},
  };
  return {client,auction,rider,bids,proxies,writes,context,cascade,teamState,createdAuctions};
}

function route(method,path,f,extra={}) {
  let handler; const marker=`router.${method}("${path}"`;
  const start=source.indexOf(marker); assert.ok(start>=0,marker);
  const end=source.indexOf('\n});',start); assert.ok(end>start);
  const context={...f.context,...extra,router:{[method]:(...args)=>{handler=args.at(-1);}}};
  vm.runInNewContext(source.slice(start,end+4),context);
  return async(body={})=>{
    let status=200; let response;
    const res={status(code){status=code;return res;},json(value){response=value;return res;}};
    await handler({team:{id:TEAM,name:'Test Team',balance:10000},user:{id:'test-user'},params:{id:AUCTION},body},res);
    return {status,body:JSON.parse(JSON.stringify(response))};
  };
}

for (const flag of ['off','on']) {
  test(`bid route ${flag}: a persisted bid succeeds and uses the appropriate cascade`,async()=>{
    const f=fixture({flag});
    const out=await route('post','/auctions/:id/bid',f)({amount:150});
    assert.equal(out.status,200);assert.equal(out.body.success,true);
    assert.equal(f.bids.length,1);assert.equal(f.auction.current_bidder_id,TEAM);
    assert.equal(f.cascade[0].canAffordAutoBidFn===market.canAffordAutoBid6181,flag==='on');
  });
}

test('bid route: rejected attached proxy cannot turn a persisted bid into failure',async()=>{
  const f=fixture({flag:'on',proxyError:moneyError});
  const out=await route('post','/auctions/:id/bid',f)({amount:150,proxy_max:200});
  assert.equal(out.status,200);assert.equal(out.body.success,true);assert.equal(out.body.bid_placed,true);
  assert.equal(f.bids.length,1);assert.equal(f.proxies.length,0);
  assert.equal(out.body.warnings[0].code,'proxy_rejected');
  assert.equal(out.body.warnings[0].errorCode,'insufficient_balance_after_proxy');
});

for (const [method,path,body] of [['post','/auctions/:id/bid',{amount:150}],['patch','/auctions/:id/proxy',{max_amount:200}]]) {
  test(`${method} ${path}: unknown flag stops before any write`,async()=>{
    const f=fixture({flagError:true});
    await assert.rejects(()=>route(method,path,f)(body),/flag unavailable/);
    assert.equal(f.writes.length,0);assert.equal(f.bids.length,0);assert.equal(f.proxies.length,0);
  });
}

for (const flag of ['off','on']) {
  test(`PATCH proxy ${flag}: persists the proxy and uses the appropriate cascade`,async()=>{
    const f=fixture({flag});
    const out=await route('patch','/auctions/:id/proxy',f)({max_amount:200});
    assert.equal(out.status,200);assert.equal(out.body.success,true);
    assert.equal(f.proxies[0].max_amount,200);assert.equal(f.bids.length,1);
    assert.equal(f.cascade[0].canAffordAutoBidFn===market.canAffordAutoBid6181,flag==='on');
  });
  test(`POST auctions ${flag}: the M3 seat gate is used only when enabled`,async()=>{
    const f=fixture({flag,futureCount:30});
    const out=await route('post','/auctions',f)({rider_id:RIDER,starting_price:150});
    assert.equal(out.status,flag==='on'?400:201);
    if(flag==='on') {assert.equal(out.body.errorCode,'squad_full_bid');assert.equal(f.createdAuctions.length,0);}
    else {assert.equal(f.createdAuctions.length,1);assert.equal(f.bids.length,1);}
  });
  test(`POST release ${flag}: outgoing auctions affect the seller floor only when enabled`,async()=>{
    const f=fixture({flag,futureCount:10,outgoing:2});f.rider.team_id=TEAM;
    const out=await route('post','/riders/:id/release',f)({});
    assert.equal(out.status,flag==='on'?409:200);
    if(flag==='on') {assert.equal(out.body.errorCode,'cannot_release_squad_risk');assert.equal(f.rider.team_id,TEAM);}
    else {assert.equal(out.body.success,true);assert.equal(f.rider.team_id,null);}
  });
}

for (const [path,body] of [['/auctions',{rider_id:RIDER,starting_price:150}],['/riders/:id/release',{}]]) {
  test(`${path}: unreadable market flag cannot reach a mutation`,async()=>{
    const f=fixture({flagError:true});
    await assert.rejects(()=>route('post',path,f)(body),/flag unavailable/);
    assert.equal(f.writes.length,0);
  });
}

for(const [error,status,code] of [
  [moneyError,400,'insufficient_balance_after_bids'],
  [{code:'P0001',message:'market_gate_6181:squad_full'},400,'squad_full_bid'],
  [{code:'P0001',message:'market_gate_6181:price_changed'},409,null],
]) {
  test(`bid route translates DB rejection ${error.message} before committing a bid`,async()=>{
    const f=fixture({flag:'on',bidError:error});
    const out=await route('post','/auctions/:id/bid',f)({amount:150});
    assert.equal(out.status,status);assert.equal(f.bids.length,0);assert.equal(f.auction.current_price,100);
    if(code)assert.equal(out.body.errorCode,code);else assert.equal(out.body.error,'price_changed');
  });
}

test('PATCH proxy translates a DB gate rejection without saving a proxy or placing an opening bid',async()=>{
  const f=fixture({flag:'on',proxyError:moneyError});
  const out=await route('patch','/auctions/:id/proxy',f)({max_amount:200});
  assert.equal(out.status,400);assert.equal(out.body.errorCode,'insufficient_balance_after_proxy');
  assert.equal(f.proxies.length,0);assert.equal(f.bids.length,0);
});

test('PATCH proxy on: a later higher bid cannot be overwritten by the opening-bid update',async()=>{
  const f=fixture({flag:'on',afterBidInsert:{current_price:500,current_bidder_id:'later-rival'}});
  const out=await route('patch','/auctions/:id/proxy',f)({max_amount:200});
  assert.equal(out.status,200);assert.equal(f.bids.length,1);
  assert.equal(f.auction.current_price,500);assert.equal(f.auction.current_bidder_id,'later-rival');
});

test('POST auctions translates an atomic start-bid rejection without creating an auction',async()=>{
  const f=fixture({flag:'on',startError:moneyError});
  const out=await route('post','/auctions',f)({rider_id:RIDER,starting_price:150});
  assert.equal(out.status,400);assert.equal(out.body.errorCode,'start_bid_exceeds_balance');
  assert.equal(f.createdAuctions.length,0);assert.equal(f.bids.length,0);
});
