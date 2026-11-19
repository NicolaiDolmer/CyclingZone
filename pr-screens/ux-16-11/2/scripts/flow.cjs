const { chromium } = require('playwright');
const OUT='/tmp/claude-0/aud/flow'; const B='http://localhost:5173';
const only=process.argv[2];
const R=(id,fn,ln,team,extra={})=>({id,firstname:fn,lastname:ln,nationality_code:'no',birthdate:'2001-03-10',base_value:1200000,market_value:1200000,salary:90000,contract_length:2,contract_end_season:4,primary_type:'sprinter',secondary_type:'leadout',team,climbing:58,time_trial:56,flat:61,tempo:54,sprint:70,acceleration:68,punch:62,endurance:60,recovery:57,durability:59,descending:52,cobblestone:48,positioning:63,aggression:45,tactics:51,...extra});
const TEAM={id:'team-test',name:'E2E Racing'}; const RIV={id:'team-rival-x',name:'Fjord Velo'};
const INJECT={
 '/api/transfers':[{id:'l1',rider:R('r-m1','Eskil','Varden',RIV),asking_price:1300000,seller:RIV,created_at:'2026-11-10T00:00:00Z'},{id:'l2',rider:R('r-m2','Teo','Marsk',RIV,{market_value:640000,salary:38000}),asking_price:590000,seller:RIV,created_at:'2026-11-12T00:00:00Z'},{id:'l3',rider:R('r-o1','Brage','Holt',TEAM,{market_value:820000}),asking_price:700000,seller:TEAM,created_at:'2026-11-11T00:00:00Z'}],
 '/api/transfers/my-offers':{sent:[{id:'o2',status:'countered',offer_amount:900000,counter_amount:1150000,round:2,rider:R('r-m1','Eskil','Varden',RIV),seller:RIV,buyer:TEAM,created_at:'2026-11-15T10:00:00Z'}],received:[{id:'o1',status:'pending',offer_amount:650000,round:1,message:'Good fit for our sprint train.',rider:R('r-o1','Brage','Holt',TEAM,{market_value:820000}),buyer:RIV,seller:TEAM,created_at:'2026-11-16T08:00:00Z'}],archivedSent:[],archivedReceived:[]},
 '/api/inbox/pending':{transfer_offers:[{id:'o1'}],swap_offers:[],counts:{transfer_offers:1,swap_offers:0,total:1}},
};
async function ctxFor(browser,vp,theme='light',inject=true){
  const opts=vp==='390'?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900},deviceScaleFactor:1};
  const ctx=await browser.newContext({...opts,locale:'en-US'});
  await ctx.addInitScript(([t,inj,doInj])=>{try{localStorage.setItem('cz_consent_v1',JSON.stringify({version:1,necessary:true,analytics:false,marketing:false,email_marketing:false,updated_at:new Date().toISOString()}));localStorage.setItem('cz-theme',t);}catch(e){}
    if(!doInj) return; const nativeF=window.fetch; let inner=nativeF, installed=false;
    const wrap=function(u,i){const s=typeof u==='string'?u:(u&&u.url)||''; const m=(i&&i.method)||'GET'; try{const p=new URL(s,location.origin).pathname; if(m==='GET'&&inj[p]!==undefined) return Promise.resolve(new Response(JSON.stringify(inj[p]),{status:200,headers:{'content-type':'application/json'}}));}catch(e){} return inner.apply(this,arguments);};
    Object.defineProperty(window,'fetch',{configurable:true,get(){return installed?wrap:nativeF},set(v){inner=v;installed=true}});
  },[theme,INJECT,inject]);
  return ctx;
}
const steps={
 async auctionBid(page){await page.goto(B+'/auctions');await page.waitForTimeout(3000);
   const card=page.locator('text=HIGHEST BID').first(); await card.scrollIntoViewIfNeeded().catch(()=>{}); await page.evaluate(y=>window.scrollBy(0,y),500);await page.waitForTimeout(400);
   await page.screenshot({path:OUT+'/a1-auction-card.png'});
   await page.getByRole('button',{name:/^Bid$/}).first().click().catch(e=>console.log('nobid',e.message)); await page.waitForTimeout(1200);
   await page.screenshot({path:OUT+'/a2-after-bid.png'});
   await page.goto(B+'/auctions');await page.waitForTimeout(3000);await page.evaluate(y=>window.scrollBy(0,y),500);
   await page.getByRole('button',{name:/auto-bid/i}).first().click().catch(e=>console.log('noauto',e.message)); await page.waitForTimeout(1000);
   await page.screenshot({path:OUT+'/a3-autobid.png'}); await page.screenshot({path:OUT+'/a3-autobid-full.png',fullPage:true});},
 async transfersMarket(page){await page.goto(B+'/transfers?tab=market');await page.waitForTimeout(3000);
   await page.screenshot({path:OUT+'/t1-market.png'});await page.screenshot({path:OUT+'/t1-market-full.png',fullPage:true});
   const b=page.getByRole('button',{name:/offer/i}).first(); await b.click().catch(e=>console.log('nooffer',e.message)); await page.waitForTimeout(1000);
   await page.screenshot({path:OUT+'/t2-offer-form.png'});await page.screenshot({path:OUT+'/t2-offer-form-full.png',fullPage:true});},
 async transfersHandle(page){for(const tab of ['offers','negotiations','feed']){await page.goto(B+'/transfers?tab='+tab);await page.waitForTimeout(2800);await page.screenshot({path:OUT+`/t3-${tab}-full.png`,fullPage:true});}
   await page.goto(B+'/transfers');await page.waitForTimeout(2800);console.log('default tab url',page.url());await page.screenshot({path:OUT+'/t3-default-full.png',fullPage:true});},
 async finance(page){for(const tab of ['loans','sponsor','history']){await page.goto(B+'/finance?tab='+tab);await page.waitForTimeout(2500);const t=page.getByRole('tab',{name:new RegExp(tab,'i')}).first();await t.click().catch(()=>{});await page.waitForTimeout(800);await page.screenshot({path:OUT+`/f-${tab}-full.png`,fullPage:true});}},
 async board(page){for(const tab of ['Mandate','Vision','Board']){await page.goto(B+'/board');await page.waitForTimeout(2500);await page.getByRole('tab',{name:tab,exact:true}).first().click().catch(e=>console.log('notab',tab));await page.waitForTimeout(800);await page.screenshot({path:OUT+`/b-${tab}-full.png`,fullPage:true});}},
 async sponsors(page){for(const tab of ['Deal','Payments','Next season']){await page.goto(B+'/sponsors');await page.waitForTimeout(2500);await page.getByRole('tab',{name:tab}).first().click().catch(e=>console.log('notab',tab));await page.waitForTimeout(800);await page.screenshot({path:OUT+`/s-${tab.replace(' ','-')}-full.png`,fullPage:true});}},
 async profile(page){await page.goto(B+'/riders/rider-1');await page.waitForTimeout(3000);await page.evaluate(y=>window.scrollBy(0,y),900);await page.waitForTimeout(500);await page.screenshot({path:OUT+'/p1-own-hero.png'});
   for(const n of [/^List/i,/Extend/i]){await page.goto(B+'/riders/rider-1');await page.waitForTimeout(3000);const b=page.getByRole('button',{name:n}).first();await b.scrollIntoViewIfNeeded().catch(()=>{});await b.click().catch(e=>console.log('nobtn',n));await page.waitForTimeout(1000);await page.screenshot({path:OUT+`/p2-${String(n).replace(/\W/g,'')}.png`});await page.screenshot({path:OUT+`/p2-${String(n).replace(/\W/g,'')}-full.png`,fullPage:true});}
   await page.goto(B+'/riders/rider-2');await page.waitForTimeout(3000);await page.screenshot({path:OUT+'/p3-pending-full.png',fullPage:true});
   await page.goto(B+'/riders/rider-bidwar');await page.waitForTimeout(3000);await page.screenshot({path:OUT+'/p4-bidwar-full.png',fullPage:true});},
 async team(page){await page.goto(B+'/team');await page.waitForTimeout(3000);for(const tab of [/Contract/i,/Transfer/i]){const t=page.getByRole('tab',{name:tab}).first();await t.click().catch(e=>console.log('notab',tab));await page.waitForTimeout(900);await page.screenshot({path:OUT+`/team-${String(tab).replace(/\W/g,'')}-full.png`,fullPage:true});}},
};
(async()=>{const browser=await chromium.launch();
 for(const vp of ['390','1440']){const ctx=await ctxFor(browser,vp);const page=await ctx.newPage(); page.setDefaultTimeout(8000);
  for(const [k,fn] of Object.entries(steps)){ if(only&&!only.split(',').includes(k)) continue; const orig=OUT; console.log('step',k,vp);try{await fn(page)}catch(e){console.log('ERR',k,e.message)} }
  // rename outputs per vp
  const fs=require('fs'); for(const f of fs.readdirSync(OUT)) if(!/-(390|1440)\.png$/.test(f)) fs.renameSync(OUT+'/'+f, OUT+'/'+f.replace(/\.png$/,`-${vp}.png`));
  await ctx.close();}
 await browser.close();})();
