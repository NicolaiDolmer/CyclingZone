const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const p=await ctx.newPage(); p.on('pageerror',e=>console.log('E',e.message));
for (const n of [1,2,3,4,5,6,7,8,9,12]) { await p.goto(`http://localhost:5173/src/preview/sketches/mobil-top15/index.html?fix=${n}`,{waitUntil:'networkidle'}); await p.waitForTimeout(800);
 await p.screenshot({path:`after/fix${n}.png`});
 const small = await p.evaluate(()=>[...document.querySelectorAll('a,button,label')].filter(e=>e.offsetWidth&&!e.closest('nav')&&!e.closest('header')).map(e=>{const r=e.getBoundingClientRect();return [r.width,r.height,(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,20)]}).filter(([w,h])=>w<44||h<44));
 console.log(n, JSON.stringify(small)); }
await b.close();})();
