import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as rules from './auctionRules.ts';
import * as market from './marketCommitment6181.js';
import * as autoAccept from './autoAccept2176.js';
import * as betaMarket from './marketBeta2176.ts';
import { FINANCE_ACTOR_TYPE, FINANCE_REASON, FINANCE_RELATED_ENTITY } from './economyConstants.js';
import { getSquadRiskViolation, MIN_RIDERS_FOR_RACE } from './marketUtils.js';
import { computeReleaseBuyoutFee } from './contractSeed.js';
import { getParkedRiderReleaseIssue } from './parkedRiderGuard6181.js';
import { releaseFeeAvailableResponse6181 } from './releaseFeeGate6181.js';
import { isLateBidTriggerError } from './auctionEngine.js';
import { buildKeyedNotification } from './notificationKeys.js';
import * as transferNotif from './transferNotifications.js';

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

function fixture({ flag = 'off', autoFlag = 'off', flagError = false, proxyError = null, bidError = null, startError = null, futureCount = 10, outgoing = 0, afterBidInsert = null, lockedPreviousLeader = undefined, scopeProtected = false } = {}) {
  const auction = { id: AUCTION, rider_id: RIDER, current_price: 100, current_bidder_id: null,
    status: 'active', calculated_end: '2026-11-08T18:00:00Z', seller_team_id: 'other', is_youth: false,
    rider: { id: RIDER, firstname: 'Test', lastname: 'Rider', team_id: null } };
  const rider = { id: RIDER,firstname:'Test',lastname:'Rider',team_id:null,is_retired:false,is_academy:false,pending_team_id:null,salary:0,contract_end_season:5 };
  const bids = []; const proxies = []; const writes = []; const createdAuctions=[];
  const autoOutgoingReads = [];
  const rpcCalls = [];
  const teamState = { id: TEAM, balance: 10000, total_count: futureCount, future_count: futureCount, squad_limits: { min: 0, max: 30 } };
  const client = {
    from(table) {
      let action = 'select'; let payload; const filters = [];
      const query = {
        select() { return query; }, eq(k,v) { filters.push([k,v]); return query; },
        in(k,v) { filters.push(['in',k,v]);return query; }, is() { return query; }, neq() { return query; }, order() { return query; }, limit() { return query; },
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
          if(table==='auctions' && action==='update' && filters.some(f=>f[0]==='in' && !f[2].includes(auction[f[1]])))return {data:[],error:null};
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
        if (table==='app_config') {
          const key = filters.find(([column]) => column === 'key')?.[1];
          const value = key === 'auto_accept_enabled' ? autoFlag : flag;
          return { data: flagError ? null : {value}, error:flagError ? {message:'flag unavailable'} : null };
        }
        if (table==='auctions') return { data:single ? (filters.some(f=>f[0]==='rider_id') ? null : structuredClone(auction)) : [], count:0,error:null };
        if (table==='teams') return {data:single ? teamState : [teamState],error:null};
        if (table==='riders') return {data:single ? rider : [],error:null};
        if (table==='seasons') return {data:{id:'season',number:5},error:null};
        if (table==='auction_proxy_bids') return {data:single ? null : proxies,error:null};
        return { data:single ? null : [],error:null };
      }
      return query;
    },
    async rpc(name,args) {
      rpcCalls.push({name,args});
      if (name==='market_scope_2176') return {data:scopeProtected,error:null};
      if (name==='create_market_auction_2176') {
        if(startError)return {data:null,error:startError};
        const created={id:AUCTION,...args.p_auction};createdAuctions.push(created);
        return {data:{status:'created',auction:created},error:null};
      }
      if (name==='auto_accept_release_paid_2176') {
        Object.assign(rider,{team_id:null,pending_team_id:null});
        writes.push({table:'riders',action:'release-paid-rpc'});
        return {data:{status:'released',rider_id:RIDER,payment_handled:true},error:null};
      }
      if (name==='auto_accept_release_rider') {
        Object.assign(rider,{team_id:null,pending_team_id:null});
        writes.push({table:'riders',action:'release-rpc'});
        return {data:{status:'released',rider_id:RIDER},error:null};
      }
      if(name==='place_auction_bid_6181') {
        if(bidError)return {data:null,error:bidError};
        const previousLeader=lockedPreviousLeader===undefined?auction.current_bidder_id:lockedPreviousLeader;
        bids.push({auction_id:args.p_auction_id,team_id:args.p_team_id,amount:args.p_amount,is_proxy:false});
        Object.assign(auction,{current_price:args.p_amount,current_bidder_id:args.p_team_id});
        if(afterBidInsert)Object.assign(auction,afterBidInsert);
        return {data:{previousLeader,expectedPrice:args.p_amount,expectedLeader:args.p_team_id,placed:true,tieResolved:true,matchedTeam:null,matchRejected:null},error:null};
      }
      if(name==='set_auction_proxy_6181' || name==='set_auction_proxy_context_6181') {
        if(proxyError || (args.p_opening_amount!==null && bidError))return {data:null,error:proxyError??bidError};
        const previousLeader=lockedPreviousLeader===undefined?auction.current_bidder_id:lockedPreviousLeader;
        const expectedPrice=args.p_opening_amount??auction.current_price;
        const expectedLeader=args.p_opening_amount===null?previousLeader:args.p_team_id;
        proxies.push({auction_id:args.p_auction_id,team_id:args.p_team_id,max_amount:args.p_max_amount});
        if(args.p_opening_amount!==null){
          bids.push({auction_id:args.p_auction_id,team_id:args.p_team_id,amount:args.p_opening_amount,is_proxy:true});
          Object.assign(auction,{current_price:args.p_opening_amount,current_bidder_id:args.p_team_id});
          if(afterBidInsert)Object.assign(auction,afterBidInsert);
        }
        return {data:name==='set_auction_proxy_6181'?null:{previousLeader,expectedPrice,expectedLeader,placed:args.p_opening_amount!==null,tieResolved:true,matchedTeam:null,matchRejected:null},error:null};
      }
      if (name==='team_market_commitment') return {data:0,error:null};
      if (name==='team_outgoing_auction_rider_ids') return {data:Array.from({length:outgoing},(_,i)=>`outgoing-${i}`),error:null};
      if (name==='market_bid_issue_6181') return {data:null,error:null};
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const cascade = [];
  const context = {
    ...rules,...market,...autoAccept,...betaMarket,Date:FixedDate,console,isLateBidTriggerError,buildKeyedNotification,
    FINANCE_ACTOR_TYPE,FINANCE_REASON,FINANCE_RELATED_ENTITY,MIN_RIDERS_FOR_RACE,
    countSellerAuctionOutgoing:async()=>{autoOutgoingReads.push(1);return autoFlag==='on' ? outgoing : 0;},
    supabase:client, requireAuth(){},bidLimiter(){},marketWriteLimiter(){},
    assertMarketOpen:async()=>true,assertTeamNotTransferFrozen:()=>true,
    isAuctionExpired:end=>Date.parse(end)<=NOW,
    fetchTeamCommitment:async()=>({leadingAuctions:[],allMyProxies:[]}),
    getTeamMarketState:async()=>structuredClone(teamState),
    assertSigningAllowed:async()=>null, getAuctionConfig:async()=>({}),
    readTransferPriceBandConfig:async()=>({}),getPriceBandViolation:()=>null,
    recordIdentityEvent(){}, awardXP:async()=>{}, notifyTeamOwnerBuilt:async()=>{},notifyTeamOwner:async()=>{},
    notifyOutbid:async()=>{},transferNotif,
    applyLeaderShiftExtension:async()=>({extensionApplied:false,newEnd:null}),
    getActiveSeasonNumber:async()=>5,fetchSeasonTransitionBoundary:async()=>null,
    calculateRiderMarketValue:()=>100,calculateAuctionEnd:()=>new FixedDate('2026-11-09T15:00:00Z'),
    getAuctionSeasonBoundaryIssue:()=>null,FREE_AGENT_MIN_DURATION_HOURS:12,
    fetchOwnProxiesByAuctionId:async()=>new Map(),
    safePauseTransferListingsForAuction:async()=>{},logActivity:async()=>{},notifyNewAuction:async()=>{},
    loadOwnedSeniorRiderForAction:async()=>({rider}),getParkedRiderReleaseIssue,releaseFeeAvailableResponse6181,
    assertRiderNotOnActiveAuction:async()=>({}),computeReleaseBuyoutFee,
    fetchAtRiskRiders:async()=>[],getSquadRiskViolation,
    buildAtRiskErrorParams:issue=>({minRiders:issue.minRiders}),invalidateNamespace(){},
    resolveProxyBids:async args=>{cascade.push(args);return {finalLeaderId:auction.current_bidder_id,outbidNotified:new Set()};},
  };
  return {client,auction,rider,bids,proxies,writes,context,cascade,teamState,createdAuctions,autoOutgoingReads,rpcCalls};
}

for (const flag of ['off','on']) {
  for (const autoFlag of ['off','on']) {
    for (const path of ['/auctions','/riders/:id/release']) {
      test(`combined gates ${flag}/${autoFlag} ${path}: one outgoing auction is counted once`,async()=>{
        const f=fixture({flag,autoFlag,futureCount:10,outgoing:1});
        f.rider.team_id=TEAM;
        const out=await route('post',path,f)({rider_id:RIDER,starting_price:100});
        assert.equal(out.status,path==='/auctions' ? 201 : 200,JSON.stringify(out.body));
        if(path==='/auctions')assert.equal(f.createdAuctions.length,1);
        else assert.equal(f.rider.team_id,null);
        assert.equal(f.autoOutgoingReads.length,flag==='on' ? 0 : 1);
      });
    }
  }
}

for (const [method,path,body,rpcName] of [['post','/auctions/:id/bid',{amount:150},'place_auction_bid_6181'],
  ['patch','/auctions/:id/proxy',{max_amount:200},'set_auction_proxy_context_6181']]) {
  test(`beta ${path}: scope transition uses atomic transport even before public participation`,async()=>{
    const f=fixture({flag:'beta',scopeProtected:false});
    const out=await route(method,path,f)(body);
    assert.equal(out.status,200);
    assert.ok(f.rpcCalls.some(call=>call.name===rpcName));
    assert.equal(f.writes.some(write=>['auction_bids','auction_proxy_bids'].includes(write.table)),false);
    assert.equal(f.cascade[0].databaseOwnsLeaderSync,true);
    assert.equal(typeof f.cascade[0].canAffordAutoBidFn,'function');
  });
}

test('beta senior release includes its fee in the RPC and never charges again',async()=>{
  const f=fixture({flag:'beta',autoFlag:'off'});f.rider.team_id=TEAM;
  let legacyPayments=0;
  const out=await route('post','/riders/:id/release',f,{computeReleaseBuyoutFee:()=>100,incrementBalanceWithAudit:async()=>{legacyPayments++;}})();
  assert.equal(out.status,200);
  const call=f.rpcCalls.find(row=>row.name==='auto_accept_release_paid_2176');
  assert.ok(call);assert.equal(call.args.p_fee,100);assert.equal(call.args.p_finance_payload.amount,-100);
  assert.equal(legacyPayments,0);assert.equal(f.writes.some(row=>row.table==='riders'&&row.action==='update'),false);
});

test('beta academy release includes the same fee/reset in its atomic RPC',async()=>{
  const f=fixture({flag:'beta'});Object.assign(f.rider,{team_id:TEAM,is_academy:true});
  const out=await route('post','/riders/:id/academy-release',f,{
    loadOwnedAcademyRiderForAction:async()=>({rider:f.rider}),computeReleaseBuyoutFee:()=>100,
    incrementBalanceWithAudit:async()=>{throw new Error('duplicate payment');},
    clearFutureRaceEntriesSafe:async()=>{},closeTransferListingsForRiders:async()=>{},findPendingGraduation:async()=>null,
  })();
  assert.equal(out.status,200);
  const call=f.rpcCalls.find(row=>row.name==='auto_accept_release_paid_2176');
  assert.equal(call.args.p_academy,true);assert.equal(call.args.p_fee,100);
  assert.equal(call.args.p_finance_payload.source_path,'api.academy.release');
  assert.equal(f.writes.some(row=>row.table==='riders'&&row.action==='update'),false);
});

for(const owned of [false,true])test(`beta ordinary auction creation owned=${owned} uses the shared transaction`,async()=>{
  const f=fixture({flag:'beta',scopeProtected:owned});if(owned)f.rider.team_id=TEAM;
  const out=await route('post','/auctions',f)({rider_id:RIDER,starting_price:owned?50:150});
  assert.equal(out.status,201,JSON.stringify(out.body));
  const call=f.rpcCalls.find(row=>row.name==='create_market_auction_2176');
  assert.ok(call);assert.equal(call.args.p_expected_owner,owned?TEAM:null);
  assert.equal(call.args.p_min_riders,MIN_RIDERS_FOR_RACE);
  assert.equal(f.writes.some(row=>row.table==='auctions'&&row.action==='insert'),false);
});

for(const flag of ['on',true])test(`AA beta with global M3=${flag} uses atomic release/payment`,async()=>{
  const f=fixture({flag,autoFlag:'beta'});f.rider.team_id=TEAM;
  const out=await route('post','/riders/:id/release',f,{computeReleaseBuyoutFee:()=>100,incrementBalanceWithAudit:async()=>{throw new Error('duplicate release payment');}})();
  assert.equal(out.status,200);
  assert.ok(f.rpcCalls.some(row=>row.name==='auto_accept_release_paid_2176'));
});

test('unprotected ordinary autobid checks its next amount, not an exhausted old proxy ceiling',async()=>{
  const f=fixture({flag:'beta',scopeProtected:false});
  let amount;
  const from=f.client.from.bind(f.client);
  f.client.from=table=>table==='auction_proxy_bids'?{
    select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{max_amount:1000},error:null}),
  }:from(table);
  const rpc=f.client.rpc.bind(f.client);
  f.client.rpc=async(name,args)=>{
    if(name==='market_bid_issue_6181'){amount=args.p_amount;return {data:args.p_amount>500?'insufficient_available_balance':null,error:null};}
    return rpc(name,args);
  };
  assert.equal(await market.canAffordAutoBidScoped2176(f.client,TEAM,200,AUCTION),true);
  assert.equal(amount,200);
});

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
    assert.equal(Boolean(f.cascade[0].databaseOwnsLeaderSync),flag==='on');
  });
}

for(const [method,path,body] of [
  ['post','/auctions/:id/bid',{amount:150}],
  ['patch','/auctions/:id/proxy',{max_amount:200}],
]){
  test(`${method} ${path} uses the predecessor captured by the accepted SQL bid`,async()=>{
    const f=fixture({flag:'on',lockedPreviousLeader:'locked-predecessor'});
    f.auction.current_bidder_id='earlier-read';
    const out=await route(method,path,f)(body);
    assert.equal(out.status,200);
    assert.equal(f.cascade[0].previousLeader,'locked-predecessor');
    assert.equal(f.cascade[0].tieBreakContext.previousLeader,'locked-predecessor');
    assert.equal(f.cascade[0].tieBreakContext.expectedLeader,TEAM);
    assert.equal(f.cascade[0].tieBreakContext.placed,true);
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
    assert.equal(Boolean(f.cascade[0].databaseOwnsLeaderSync),flag==='on');
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

for (const [flag,status] of [['on',200],['off',400]]) {
  test(`PATCH proxy ${flag}: a lowered cap on an over-committed team answers ${status}`,async()=>{
    const f=fixture({flag});
    f.auction.current_bidder_id=TEAM;
    f.context.fetchTeamCommitment=async()=>({leadingAuctions:[],allMyProxies:[{auction_id:AUCTION,max_amount:20000}]});
    const out=await route('patch','/auctions/:id/proxy',f)({max_amount:15000});
    assert.equal(out.status,status,JSON.stringify(out.body));
    if(flag==='off')assert.equal(out.body.errorCode,'insufficient_balance_after_proxy');
    else assert.equal(f.proxies.at(-1).max_amount,15000);
  });
}

test('PATCH proxy: a raised cap on an over-committed team is still rejected',async()=>{
  const f=fixture({flag:'on'});
  f.auction.current_bidder_id=TEAM;
  f.context.fetchTeamCommitment=async()=>({leadingAuctions:[],allMyProxies:[{auction_id:AUCTION,max_amount:12000}]});
  const out=await route('patch','/auctions/:id/proxy',f)({max_amount:15000});
  assert.equal(out.status,400);assert.equal(out.body.errorCode,'insufficient_balance_after_proxy');
});

test('PATCH proxy translates a DB gate rejection without saving a proxy or placing an opening bid',async()=>{
  const f=fixture({flag:'on',proxyError:moneyError});
  const out=await route('patch','/auctions/:id/proxy',f)({max_amount:200});
  assert.equal(out.status,400);assert.equal(out.body.errorCode,'insufficient_balance_after_proxy');
  assert.equal(f.proxies.length,0);assert.equal(f.bids.length,0);
});

test('proxy opening rejection preserves the previous proxy state',async()=>{
  const f=fixture({flag:'on',bidError:moneyError});
  const out=await route('patch','/auctions/:id/proxy',f)({max_amount:200});
  assert.equal(out.status,400);
  assert.equal(f.proxies.length,0);
  assert.equal(f.bids.length,0);
});

for(const flag of ['off','on']){
  test(`proxy status response ${flag} retains its mode contract`,async()=>{
    const f=fixture({flag,proxyError:{code:'P0001',message:'auction_not_active'}});
    const out=await route('patch','/auctions/:id/proxy',f)({max_amount:200});
    assert.equal(out.status,flag==='on'?400:500);
    assert.equal(out.body.errorCode,flag==='on'?'auction_expired':'proxy_save_failed');
  });
}

test('leader sync preserves inactive state',async()=>{
  const f=fixture({flag:'on'});
  Object.assign(f.auction,{status:'completed',current_price:100,current_bidder_id:'settled-team'});
  await market.syncBidLeader6181(f.client,{auctionId:AUCTION,amount:200,teamId:TEAM});
  assert.equal(f.auction.current_price,100);
  assert.equal(f.auction.current_bidder_id,'settled-team');
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
