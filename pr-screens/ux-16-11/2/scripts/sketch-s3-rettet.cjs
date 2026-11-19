const { chromium } = require('playwright');
const OUT='/tmp/claude-0/aud/sk'; const B='http://localhost:5173';
const TEAM={id:'team-e2e',name:'E2E Racing'}; const RIV={id:'team-rival-x',name:'Fjord Velo'};
const R=(id,fn,ln,team,x={})=>({id,firstname:fn,lastname:ln,nationality_code:'no',birthdate:'2001-03-10',base_value:1200000,market_value:1200000,salary:90000,contract_length:2,contract_end_season:4,primary_type:'sprinter',secondary_type:'leadout',team,...x});
const INJECT={'/api/transfers':[{id:'l3',rider:R('r-o1','Brage','Holt',TEAM,{market_value:820000}),asking_price:700000,seller:TEAM,created_at:'2026-11-11T00:00:00Z'}],
 '/api/transfers/my-offers':{sent:[],received:[{id:'o1',status:'pending',offer_amount:650000,round:1,message:'Good fit for our sprint train.',rider:R('r-o1','Brage','Holt',TEAM,{market_value:820000}),buyer:RIV,seller:TEAM,created_at:'2026-11-16T08:00:00Z'}],archivedSent:[],archivedReceived:[]}};
async function mk(browser,vp){const opts=vp==='390'?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900},deviceScaleFactor:1};
 const ctx=await browser.newContext({...opts,locale:'en-US'});
 await ctx.addInitScript((inj)=>{try{localStorage.setItem('cz_consent_v1',JSON.stringify({version:1,necessary:true,analytics:false,marketing:false,email_marketing:false,updated_at:new Date().toISOString()}));localStorage.setItem('cz-theme','light');}catch(e){}
  const nativeF=window.fetch; let inner=nativeF, installed=false; const wrap=function(u,i){const s=typeof u==='string'?u:(u&&u.url)||''; const m=(i&&i.method)||'GET'; try{const p=new URL(s,location.origin).pathname; if(m==='GET'&&inj[p]!==undefined) return Promise.resolve(new Response(JSON.stringify(inj[p]),{status:200,headers:{'content-type':'application/json'}}));}catch(e){} return inner.apply(this,arguments);};
  Object.defineProperty(window,'fetch',{configurable:true,get(){return installed?wrap:nativeF},set(v){inner=v;installed=true}});},INJECT);
 const p=await ctx.newPage(); p.setDefaultTimeout(8000); return [ctx,p];}
const dismissHint=async p=>{await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>/dismiss|close/i.test(b.getAttribute('aria-label')||'')&&b.closest('[class*=accent]'));});};
(async()=>{const browser=await chromium.launch();
 // S3 bid row (390)
 {const [c,p]=await mk(browser,'390'); await p.goto(B+'/auctions'); await p.waitForTimeout(3000);
  const y=await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='HIGHEST BID'||e.textContent.trim()==='Highest bid'&&e.children.length===0); const r=e.getBoundingClientRect(); window.scrollBy(0,r.top-60); return 1;});
  await p.getByRole('button',{name:/auto-bid/i}).first().click().catch(()=>{}); await p.waitForTimeout(800);
  await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^highest bid$/i.test(e.textContent.trim())); window.scrollBy(0,e.getBoundingClientRect().top-40);});
  await p.screenshot({path:OUT+'/s3-before.png'});
  await p.evaluate(()=>{
   const inputs=[...document.querySelectorAll('input')].filter(i=>i.value==='50000'); const first=inputs[0];
   // find container holding bid input row: go up until contains both inputs
   const rowOf=(el)=>{let r=el; while(r.parentElement && !/highest bid/i.test(r.parentElement.textContent)) r=r.parentElement; return r;};
   const rows=[...new Set(inputs.map(rowOf))];
   const box=document.createElement('div'); rows[0].parentElement.insertBefore(box,rows[0]); rows.forEach(r=>r.style.display='none');
   const green=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/below est\. value/.test(e.textContent)); if(green){green.style.display='none';}
   box.innerHTML=`<div style="font-family:inherit">
    <div style="display:flex;border:1px solid var(--border,#ddd);border-radius:5px;overflow:hidden;margin-bottom:10px;font-size:14px">
      <div style="flex:1;text-align:center;padding:11px 0;background:var(--bg-subtle,#eee);font-weight:600">Bid once</div>
      <div style="flex:1;text-align:center;padding:11px 0;color:var(--text-2,#555)">Auto-bid up to</div></div>
    <div style="display:flex;gap:8px;align-items:stretch">
      <div style="flex:1;border:1px solid var(--border,#ddd);border-radius:5px;padding:10px 12px;font-size:20px;font-variant-numeric:tabular-nums;background:var(--bg-card,#fff)">50,000 <span style="font-size:13px;color:var(--text-3,#777)">CZ$</span></div>
      <div style="min-width:96px;display:flex;align-items:center;justify-content:center;border-radius:5px;background:#E8C547;color:#1b1b1b;font-weight:600;font-size:16px">Bid</div></div>
    <div style="display:flex;gap:8px;margin-top:8px">${['Min 50,000','+10,000','+50,000'].map(x=>`<div style="flex:1;text-align:center;border:1px solid var(--border,#ddd);border-radius:999px;padding:10px 0;font-size:13px;font-variant-numeric:tabular-nums">${x}</div>`).join('')}</div>
    <div style="margin-top:8px;font-size:12px;color:var(--text-3,#777)">Available after this bid: 400,000 CZ$ (now 450,000)</div></div>`;
  });
  await p.screenshot({path:OUT+'/s3-after.png'}); await c.close();}
 await browser.close();})();
