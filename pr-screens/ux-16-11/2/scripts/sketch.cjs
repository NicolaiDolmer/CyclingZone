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
 // S1 desktop auctions table
 {const [c,p]=await mk(browser,'1440'); await p.goto(B+'/auctions'); await p.waitForTimeout(3000);
  await p.screenshot({path:OUT+'/s1-before.png',clip:{x:208,y:0,width:1232,height:620}});
  await p.evaluate(()=>{const t=document.querySelector('table'); const ths=[...t.querySelectorAll('thead th')]; const names=ths.map(th=>th.textContent.trim().replace(/[^A-Za-z ]/g,'').trim());
   const keep=['Rider','Highest bid','Time left','Value','OVR','Age','Salary','Bid']; const order=keep.map(k=>names.findIndex(n=>n.startsWith(k))).filter(i=>i>=0);
   for(const tr of t.querySelectorAll('tr')){const cells=[...tr.children]; if(cells.length!==ths.length) continue; cells.forEach((c,i)=>{if(!order.includes(i)) c.style.display='none'}); order.forEach(i=>tr.appendChild(cells[i]));}
   let el=t.parentElement; while(el&&el!==document.body){el.style.overflowX='visible'; el=el.parentElement;}
   const hint=[...document.querySelectorAll('*')].find(e=>e.textContent.trim().startsWith('Win the bid')&&e.children.length>2); });
  await p.waitForTimeout(300); await p.screenshot({path:OUT+'/s1-after.png',clip:{x:208,y:0,width:1232,height:620}}); await c.close();}
 // S2 available balance (390)
 {const [c,p]=await mk(browser,'390'); await p.goto(B+'/auctions'); await p.waitForTimeout(3000);
  await p.screenshot({path:OUT+'/s2-before.png'});
  await p.evaluate(()=>{for(const e of document.querySelectorAll('p,div,span')){if(e.children.length===0&&/^Balance 500,000 CZ\$/.test(e.textContent.trim())){e.innerHTML='<b style="font-weight:600;color:var(--text-1,#111)" class="tabular-nums">Available 450,000 CZ$</b> · 50,000 locked in bids'; }}});
  await p.screenshot({path:OUT+'/s2-after.png'}); await c.close();}
 // S3 bid row (390)
 {const [c,p]=await mk(browser,'390'); await p.goto(B+'/auctions'); await p.waitForTimeout(3000);
  const y=await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='HIGHEST BID'||e.textContent.trim()==='Highest bid'&&e.children.length===0); const r=e.getBoundingClientRect(); window.scrollBy(0,r.top-60); return 1;});
  await p.getByRole('button',{name:/auto-bid/i}).first().click().catch(()=>{}); await p.waitForTimeout(800);
  await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^highest bid$/i.test(e.textContent.trim())); window.scrollBy(0,e.getBoundingClientRect().top-40);});
  await p.screenshot({path:OUT+'/s3-before.png'});
  await p.evaluate(()=>{
   const inputs=[...document.querySelectorAll('input')].filter(i=>i.value==='50000'); const first=inputs[0];
   // find container holding bid input row: go up until contains both inputs
   let card=first; while(card&&!(inputs.every(i=>card.contains(i)))) card=card.parentElement;
   while(card && !/highest bid/i.test(card.textContent)) card=card.parentElement;
   const kids=[...card.children]; const hide=kids.filter(k=>k.querySelector('input')||/Min\. bid|I bid up to|= 50,000/.test(k.textContent)); hide.forEach(k=>k.style.display='none');
   const box=document.createElement('div'); card.appendChild(box);
   const green=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/below est\. value/.test(e.textContent)); if(green){green.textContent='Start price · value 1,400,000 CZ$'; green.style.color='var(--text-3,#666)';}
   box.innerHTML=`<div style="font-family:inherit">
    <div style="display:flex;border:1px solid var(--border,#ddd);border-radius:5px;overflow:hidden;margin-bottom:10px;font-size:14px">
      <div style="flex:1;text-align:center;padding:11px 0;background:var(--bg-subtle,#eee);font-weight:600">Bid once</div>
      <div style="flex:1;text-align:center;padding:11px 0;color:var(--text-2,#555)">Auto-bid up to</div></div>
    <div style="display:flex;gap:8px;align-items:stretch">
      <div style="flex:1;border:1px solid var(--border,#ddd);border-radius:5px;padding:10px 12px;font-size:20px;font-variant-numeric:tabular-nums;background:var(--bg-card,#fff)">50,000 <span style="font-size:13px;color:var(--text-3,#777)">CZ$</span></div>
      <div style="min-width:96px;display:flex;align-items:center;justify-content:center;border-radius:5px;background:#E8C547;color:#1b1b1b;font-weight:600;font-size:16px">Bid</div></div>
    <div style="display:flex;gap:8px;margin-top:8px">${['Min 50,000','+10,000','+50,000'].map(x=>`<div style="flex:1;text-align:center;border:1px solid var(--border,#ddd);border-radius:999px;padding:10px 0;font-size:13px;font-variant-numeric:tabular-nums">${x}</div>`).join('')}</div>
    <div style="margin-top:8px;font-size:12px;color:var(--text-3,#777)">450,000 CZ$ available after this bid: 400,000 CZ$</div></div>`;
  });
  await p.screenshot({path:OUT+'/s3-after.png'}); await c.close();}
 // S4 offer card (390)
 {const [c,p]=await mk(browser,'390'); await p.goto(B+'/transfers?tab=offers'); await p.waitForTimeout(3000);
  await p.evaluate(()=>window.scrollBy(0,330)); await p.waitForTimeout(300);
  await p.screenshot({path:OUT+'/s4-before.png'});
  await p.evaluate(()=>{
   const val=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='Value'); const box=val.parentElement.closest('div[class*=bg-]')||val.parentElement.parentElement;
   box.innerHTML=`<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3,#777)">Offer</div>
    <div style="font-size:28px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text-1,#111)">650,000 CZ$</div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:6px 12px;margin-top:10px;font-size:14px;font-variant-numeric:tabular-nums">
     <span style="color:var(--text-3,#777)">Your asking price</span><span>700,000 CZ$ <span style="color:#b42318">−7%</span></span>
     <span style="color:var(--text-3,#777)">Market value</span><span>820,000 CZ$ <span style="color:#b42318">−21%</span></span>
     <span style="color:var(--text-3,#777)">Salary you save</span><span>90,000 CZ$/season</span></div>
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border,#ddd);font-size:14px;line-height:1.45">
     <b style="font-weight:600">If you accept:</b> the buyer confirms, then 650,000 CZ$ is locked until he changes team. Squad 1 → 0 of 30. Offer expires in 2 days.</div>`;
   const btns=[...document.querySelectorAll('button')]; const acc=btns.find(b=>/Accept/.test(b.textContent)); const ctr=btns.find(b=>/Counter/.test(b.textContent)); const rej=btns.find(b=>/Reject/.test(b.textContent));
   const row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;align-items:center;margin-top:4px';
   row.innerHTML=`<div style="flex:1;text-align:center;padding:12px 0;border-radius:5px;background:#E8C547;color:#1b1b1b;font-weight:600">Accept 650,000</div><div style="flex:1;text-align:center;padding:12px 0;border-radius:5px;border:1px solid var(--border,#ccc);font-weight:600">Counter</div><div style="padding:12px 10px;color:var(--text-2,#555);text-decoration:underline">Reject</div>`;
   acc.parentElement.insertBefore(row,acc); [acc,ctr,rej].forEach(b=>b&&(b.style.display='none'));
   const msgb=btns.find(b=>/Message the other/.test(b.textContent)); if(msgb){msgb.style.display='none'}
  });
  await p.screenshot({path:OUT+'/s4-after.png'}); await c.close();}
 // S5 market hub (390)
 {const [c,p]=await mk(browser,'390'); await p.goto(B+'/transfers?tab=offers'); await p.waitForTimeout(3000);
  await p.screenshot({path:OUT+'/s5-before.png'});
  await p.evaluate(()=>{
   const h1=document.querySelector('h1'); h1.textContent='Market'; const sub=h1.parentElement.querySelector('p'); if(sub) sub.innerHTML='<b style="font-weight:600">Available 450,000 CZ$</b> · 1 offer to answer';
   const bar=document.createElement('div'); bar.style.cssText='display:flex;gap:6px;margin:14px 0 4px;overflow:hidden';
   bar.innerHTML=[['Auctions',''],['Transfers','1'],['Watchlist',''],['History','']].map(([l,n],i)=>`<div style="flex:none;padding:9px 14px;border-radius:999px;border:1px solid ${i==1?'var(--text-1,#111)':'var(--border,#ddd)'};font-size:14px;font-weight:${i==1?600:500}">${l}${n?` <span style="display:inline-block;min-width:18px;padding:0 5px;border-radius:999px;background:#E8C547;color:#1b1b1b;font-size:11px;text-align:center">${n}</span>`:''}</div>`).join('');
   h1.parentElement.appendChild(bar);
   const nav=[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')==='/auctions'&&a.closest('nav')); if(nav){nav.style.color='#E8C547'; nav.querySelectorAll('*').forEach(e=>e.style.color='#E8C547');}
  });
  await p.screenshot({path:OUT+'/s5-after.png'}); await c.close();}
 await browser.close();})();
