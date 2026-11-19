const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const OUT = '/home/user/CyclingZone/pr-screens/mobil-audit-16-11/foer-efter';
const FIX = [
 [1,'navnecellen','/riders',380,'Navnecellen','Navnet får sin egen linje og knækker kun mellem ord, mens nation, alder og mærker flytter til underlinjen.'],
 [2,'forside-paamindelser','/dashboard',0,'Påmindelseskort på forsiden','Resultatet står øverst, og sæsontilmelding og survey bliver to linjer på 44 px under det.'],
 [3,'auktioner-forklaring','/auctions',0,'Forklaringskortet på Auktioner','Forklaringen bliver én Hjælp-linje, så første auktion og Bid står over folden.'],
 [4,'trykflader-44','/planning',300,'44 px-trykflader','Tekstknapperne ser ud som i dag, men får en trykflade på 44 × 44 px, og dagsstrimlen og Season/Day bliver 44 px høje.'],
 [5,'planlaegning-bundark','/planning','bottom','Rytterpuljen i bundark','Ryttere tilføjes fra et ark over bundmenuen i stedet for nederst på en lang side.'],
 [6,'filterlinjen','/standings',0,'Filterlinjen','Søg plus to halve selects, og Compare og op/nedrykning flytter ud af vejen, så tabellen står højt.'],
 [7,'rytterprofil-hero','/riders/rider-1',0,'Rytterprofilens hero','Mærker inline, auktion som én linje og kontrakt samlet, så fanerne og evnerne ses på første skærm.'],
 [8,'team-herostats','/team',0,'HeroStats på Team/Squad','Holdets tal står i ét gitter og auktions-banneret bliver én linje, så truppen rykker op.'],
 [9,'indbakke-trykflader','/notifications',0,'Indbakkens trykflader','Hele rækken åbner beskeden, og slet ligger bag en menu på 44 px i stedet for et lille X.'],
 [12,'faner-mere-markoer','/notifications',0,'Faner med mere-markør','En opak pil til højre viser, at der er flere faner, og tager dig videre.'],
];
(async()=>{const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'en-US'});
await ctx.addInitScript(()=>{try{localStorage.setItem('cz_consent_v1',JSON.stringify({version:1,necessary:true,analytics:false,marketing:false,email_marketing:false,updated_at:new Date().toISOString()}))}catch(e){}});
const p=await ctx.newPage();
for (const [n,slug,url,scroll] of FIX) {
  await p.goto('http://localhost:5173'+url,{waitUntil:'networkidle'}); await p.waitForTimeout(2500);
  await p.evaluate((s)=>window.scrollTo(0, s==='bottom'?document.documentElement.scrollHeight:s), scroll); await p.waitForTimeout(500);
  await p.screenshot({path:`before/fix${n}.png`});
}
const cp=await b.newPage({viewport:{width:900,height:1000},deviceScaleFactor:2});
for (const [n,slug,url,scroll,name,line] of FIX) {
  const img = f => 'data:image/png;base64,'+fs.readFileSync(f).toString('base64');
  await cp.setContent(`<html><body style="margin:0;background:#e9e6de;font-family:system-ui,sans-serif;color:#15161c">
  <div id="w" style="width:860px;padding:20px">
   <div style="font-size:22px;font-weight:700">${n} · ${name}</div>
   <div style="font-size:15px;margin-top:6px;line-height:1.4">${line}</div>
   <div style="display:flex;gap:40px;margin-top:16px">
    ${[['FØR (i dag)',`before/fix${n}.png`],['EFTER (skitse)',`after/fix${n}.png`]].map(([l,f])=>`<div><div style="font-size:12px;font-weight:700;letter-spacing:.08em;margin-bottom:6px">${l}</div><img src="${img(f)}" style="width:390px;height:844px;display:block;border:1px solid #c9c4b8"></div>`).join('')}
   </div>
   <div style="font-size:11px;margin-top:10px;color:#5b5a55">390 × 844 · preview-mock · PR #8236 / #8073</div>
  </div></body></html>`);
  const el = await cp.$('#w'); await el.screenshot({path:path.join(OUT,`${String(n).padStart(2,'0')}-${slug}.png`)});
}
await b.close();})();
