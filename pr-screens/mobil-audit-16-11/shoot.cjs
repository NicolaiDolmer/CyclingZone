const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const PAGES = [
  ['dashboard','/dashboard'],['notifications','/notifications'],['team','/team'],
  ['planning','/planning'],['training','/training'],['auctions','/auctions'],
  ['riders','/riders'],['standings','/standings'],['squad-u23','/squads/u23'],
  ['rider-profile','/riders/rider-1'],
];
const metricsFn = () => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const docW = document.documentElement.scrollWidth;
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; };
  const sel = 'a[href],button,[role=button],[role=tab],input:not([type=hidden]),select,textarea,[role=checkbox],[role=switch],summary';
  const small = [];
  document.querySelectorAll(sel).forEach(el => { if(!vis(el)) return; const r = el.getBoundingClientRect();
    if (r.width<44 || r.height<44) small.push({tag:el.tagName.toLowerCase(), w:Math.round(r.width), h:Math.round(r.height), y:Math.round(r.top+scrollY), txt:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||'').trim().slice(0,40)}); });
  const overflow = []; // elements extending past right edge
  document.querySelectorAll('body *').forEach(el => { if(!vis(el)) return; const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.width < 3000) { let p = el.parentElement, clipped=false;
      while (p) { const s=getComputedStyle(p); if (['auto','scroll','hidden','clip'].includes(s.overflowX)) { const pr=p.getBoundingClientRect(); if (pr.right<=vw+1) {clipped=true;break;} } p=p.parentElement; }
      if(!clipped) overflow.push({tag:el.tagName.toLowerCase(), cls:(el.className&&el.className.baseVal===undefined?el.className:'').toString().slice(0,60), right:Math.round(r.right), txt:(el.textContent||'').trim().slice(0,30)}); }});
  const scrollers = []; document.querySelectorAll('body *').forEach(el => { if(!vis(el)) return; const s=getComputedStyle(el);
    if ((s.overflowX==='auto'||s.overflowX==='scroll') && el.scrollWidth > el.clientWidth+2) scrollers.push({tag:el.tagName.toLowerCase(), cls:el.className.toString().slice(0,60), sw:el.scrollWidth, cw:el.clientWidth, y:Math.round(el.getBoundingClientRect().top+scrollY), txt:(el.textContent||'').trim().slice(0,40)}); });
  const trunc = []; document.querySelectorAll('body *').forEach(el => { if(!vis(el) || el.children.length>2) return; const s=getComputedStyle(el);
    if (s.textOverflow==='ellipsis' && el.scrollWidth>el.clientWidth+1) trunc.push({txt:(el.textContent||'').trim().slice(0,40), y:Math.round(el.getBoundingClientRect().top+scrollY)}); });
  const firstRow = document.querySelector('tbody tr, [role=row]:not(:first-child)');
  const h1 = document.querySelector('h1');
  const tables = [...document.querySelectorAll('table')].filter(vis).map(t=>{const r=t.getBoundingClientRect(); return {w:Math.round(r.width), y:Math.round(r.top+scrollY), cols:t.querySelectorAll('thead th').length, rows:t.querySelectorAll('tbody tr').length};});
  return { vw, vh, docW, docH: document.documentElement.scrollHeight, hScroll: docW>vw+1, h1: h1&&h1.textContent.trim().slice(0,60), h1Y: h1&&Math.round(h1.getBoundingClientRect().top+scrollY),
    firstRowY: firstRow? Math.round(firstRow.getBoundingClientRect().top+scrollY):null, tables, smallTargets: small, smallCount: small.length, overflow: overflow.slice(0,15), overflowCount: overflow.length, scrollers, trunc: trunc.slice(0,20), truncCount: trunc.length };
};
(async () => {
  const browser = await chromium.launch();
  const res = {};
  for (const [vpName, opts] of [['390',{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}],['1440',{viewport:{width:1440,height:900},deviceScaleFactor:1}]]) {
    const ctx = await browser.newContext({...opts, locale:'en-US'});
    await ctx.addInitScript(() => { try { localStorage.setItem('cz_consent_v1', JSON.stringify({version:1,necessary:true,analytics:false,marketing:false,email_marketing:false,updated_at:new Date().toISOString()})); } catch(e){} });
    const page = await ctx.newPage();
    for (const [name,path] of PAGES) {
      try {
        await page.goto('http://localhost:5173'+path, {waitUntil:'networkidle', timeout:45000});
      } catch(e) {}
      await page.waitForTimeout(2500);
      // dismiss onboarding/modals if any
      await page.keyboard.press('Escape').catch(()=>{});
      await page.waitForTimeout(300);
      await page.screenshot({path:`${OUT}/${name}-${vpName}.png`});
      if (vpName==='390') await page.screenshot({path:`${OUT}/${name}-${vpName}-full.png`, fullPage:true});
      res[`${name}-${vpName}`] = { url: page.url(), ...(await page.evaluate(metricsFn)) };
      console.log(name, vpName, page.url(), res[`${name}-${vpName}`].hScroll, res[`${name}-${vpName}`].smallCount);
    }
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/metrics.json`, JSON.stringify(res,null,1));
  await browser.close();
})();
